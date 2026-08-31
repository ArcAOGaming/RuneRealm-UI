mod battle;

use battle::{make_opponent, new_battle, resolve_round, validate_monster, Battle, Monster, Rng};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::ffi::{c_char, CStr};
use std::sync::{Mutex, OnceLock};

pub const PROTOCOL: &str = "runerealm-battle-fleet/1";
pub const ABI: &str = "hyperbeam-json-iface-cstr/1";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkerConfig {
    pub enabled: bool,
    pub game_process: String,
    pub worker_id: String,
    pub capacity: usize,
    pub max_retained: usize,
    pub max_pending: usize,
    pub max_ticket_ttl: i64,
    pub max_outcomes: usize,
    pub max_confirmations: usize,
    pub owner: String,
    pub scheduler: String,
    pub image_id: String,
}

impl WorkerConfig {
    pub fn from_env(env: &Value) -> Result<Self, String> {
        let process = object_field(env, "process").ok_or("AO environment is missing Process")?;
        let tags = tags_map(object_field(process, "tags").unwrap_or(&Value::Null));
        let required = |name: &str| {
            ci_map_get(&tags, name)
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .ok_or_else(|| format!("Process tag '{name}' is required"))
        };
        if required("battle-protocol")? != PROTOCOL {
            return Err("Unsupported battle-fleet protocol".into());
        }
        if required("battle-runtime")? != "rust-wasm@1" {
            return Err("Process battle-runtime must be rust-wasm@1".into());
        }
        if required("battle-abi")? != ABI {
            return Err(format!("Process battle-abi must be {ABI}"));
        }
        if required("battle-clock-mode")? != "trusted-game-clock-v1" {
            return Err("Process battle-clock-mode must be trusted-game-clock-v1".into());
        }
        let enabled = parse_bool(&required("battle-enabled")?)
            .ok_or("Process battle-enabled must be true or false")?;
        let game_process = required("battle-game-process")?;
        if game_process.len() != 43 {
            return Err("Process battle-game-process must be a 43-character id".into());
        }
        let worker_id = required("battle-worker-id")?;
        if !valid_id(&worker_id, 96) {
            return Err("Process battle-worker-id is invalid".into());
        }
        let capacity = parse_bound(&required("battle-worker-capacity")?, 1, 10_000)?;
        let max_retained = parse_bound(&required("battle-worker-retained")?, 1, 10_000)?;
        let max_pending = parse_bound(&required("battle-worker-pending")?, 1, 10_000)?;
        let max_ticket_ttl = parse_i64_bound(
            &required("battle-worker-ticket-ttl")?,
            60_000,
            7 * 24 * 60 * 60 * 1000,
        )?;
        let max_outcomes = parse_bound(&required("battle-worker-outcomes")?, 1, 100_000)?;
        let max_confirmations = parse_bound(&required("battle-worker-confirmations")?, 1, 100_000)?;
        // Only `Id`, `Anchor`, `Owner`, `From`, `Tags`, `Target`, `Data`,
        // `Signature` and `PublicKey` are top-level keys of the Process struct
        // JSON-Iface builds (`dev_json_iface:message_to_json_struct/2`). Every
        // other field of the process message -- `scheduler-location`,
        // `scheduler`, `image` included -- is flattened into `Tags` in HTTP
        // header case. Reading those three as top-level fields therefore worked
        // in the host tests, which hand-build an environment, and failed on a
        // real node with `{"error":"Process scheduler is required"}` before a
        // single battle ran. Check the field first, then the tag.
        let process_value = |name: &str| {
            string_field(process, name).or_else(|| {
                ci_map_get(&tags, name)
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                    .map(str::to_owned)
            })
        };
        let owner = process_value("owner").ok_or("Process Owner is required")?;
        let scheduler = process_value("scheduler-location")
            .or_else(|| process_value("scheduler"))
            .ok_or("Process scheduler is required")?;
        let image_id = process_value("image").ok_or("Process Image is required")?;
        for (name, value) in [
            ("Owner", &owner),
            ("scheduler", &scheduler),
            ("Image", &image_id),
        ] {
            if value.len() != 43 {
                return Err(format!("Process {name} must be a 43-character id"));
            }
        }
        Ok(Self {
            enabled,
            game_process,
            worker_id,
            capacity,
            max_retained,
            max_pending,
            max_ticket_ttl,
            max_outcomes,
            max_confirmations,
            owner,
            scheduler,
            image_id,
        })
    }
}

fn parse_bound(raw: &str, minimum: usize, maximum: usize) -> Result<usize, String> {
    raw.parse::<usize>()
        .ok()
        .filter(|value| (*value >= minimum) && (*value <= maximum))
        .ok_or_else(|| format!("'{raw}' is outside {minimum}..={maximum}"))
}

fn parse_i64_bound(raw: &str, minimum: i64, maximum: i64) -> Result<i64, String> {
    raw.parse::<i64>()
        .ok()
        .filter(|value| (*value >= minimum) && (*value <= maximum))
        .ok_or_else(|| format!("'{raw}' is outside {minimum}..={maximum}"))
}

fn parse_bool(raw: &str) -> Option<bool> {
    match raw.to_ascii_lowercase().as_str() {
        "true" | "1" => Some(true),
        "false" | "0" => Some(false),
        _ => None,
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenPayload {
    protocol: String,
    battle_id: String,
    ticket: String,
    reservation_id: String,
    assignment_id: String,
    player_id: String,
    issued_at: i64,
    expires_at: i64,
    monster: Monster,
    #[serde(default = "default_difficulty")]
    difficulty: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    opponent_faction: Option<String>,
    #[serde(default)]
    reward_plan: Value,
}

fn default_difficulty() -> f64 {
    1.0
}

#[derive(Clone, Debug)]
struct AttackReceipt {
    fingerprint: String,
    accepted_round: u32,
    resulting_round: u32,
}

#[derive(Clone, Debug)]
struct FinalRecord {
    id: String,
    kind: FinalKind,
    payload: Value,
    fingerprint: Option<String>,
    acknowledged: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FinalKind {
    Settlement,
    Cancellation,
    Rejection,
}

impl FinalKind {
    fn name(self) -> &'static str {
        match self {
            Self::Settlement => "settlement",
            Self::Cancellation => "cancellation",
            Self::Rejection => "rejection",
        }
    }
}

#[derive(Clone, Debug)]
struct BattleRecord {
    ticket: String,
    reservation_id: String,
    assignment_id: String,
    player_id: String,
    reward_plan: Value,
    expires_at: i64,
    seed_material: String,
    open_fingerprint: String,
    attacks: HashMap<String, AttackReceipt>,
    battle: Battle,
    settlement: Option<FinalRecord>,
    cancellation: Option<FinalRecord>,
    pre_open_cancelled: bool,
}

#[derive(Clone, Debug)]
struct Rejection {
    id: String,
    assignment_id: String,
    ticket: String,
    reservation_id: String,
    battle_id: String,
    player_id: String,
    fingerprint: String,
    reason: String,
    expires_at: i64,
    acknowledged: bool,
    payload: Value,
}

#[derive(Clone, Debug)]
struct Outcome {
    kind: FinalKind,
    id: String,
    opened_id: Option<String>,
    assignment_id: String,
    ticket: String,
    reservation_id: String,
    battle_id: String,
    player_id: String,
    reason: Option<String>,
    expires_at: i64,
}

#[derive(Clone, Debug)]
struct Confirmation {
    id: String,
    kind: FinalKind,
    final_id: String,
    payload: Value,
    released: bool,
    protect_until: i64,
}

#[derive(Clone, Debug)]
pub struct Worker {
    config: WorkerConfig,
    battles: HashMap<String, BattleRecord>,
    assignments: HashMap<String, String>,
    tickets: HashMap<String, String>,
    reservations: HashMap<String, String>,
    settlements: HashMap<String, String>,
    cancellations: HashMap<String, String>,
    rejections: HashMap<String, Rejection>,
    rejection_by_assignment: HashMap<String, String>,
    outcomes: HashMap<String, Outcome>,
    confirmations: HashMap<String, Confirmation>,
    confirmation_by_id: HashMap<String, String>,
    ended_order: VecDeque<String>,
    rejected_order: VecDeque<String>,
    draining: bool,
    high_water_timestamp: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    protocol: &'static str,
    runtime: &'static str,
    abi: &'static str,
    clock_mode: &'static str,
    image_id: String,
    worker_id: String,
    game_process: String,
    lifecycle: String,
    enabled: bool,
    configured: bool,
    draining: bool,
    accepting: bool,
    active: usize,
    retained_ended: usize,
    retained_finals: usize,
    pending_settlements: usize,
    pending_cancellations: usize,
    pending_finals: usize,
    retained_open_rejections: usize,
    pending_open_rejections: usize,
    pending_deliveries: usize,
    retained_outcomes: usize,
    outcome_limit: usize,
    retained_confirmations: usize,
    pending_confirmations: usize,
    confirmation_limit: usize,
    max_ticket_ttl: i64,
    pending_limit: usize,
    retention_limit: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    admission_blocked_reason: Option<String>,
    capacity: usize,
    available_slots: usize,
    assignment_weight: usize,
    manager_mode: &'static str,
    manager_proxies_rounds: bool,
    direct_action: &'static str,
}

#[derive(Clone, Debug, Serialize)]
struct Tag {
    name: String,
    value: String,
}

#[derive(Clone, Debug, Serialize)]
struct OutboundMessage {
    #[serde(rename = "Target")]
    target: String,
    #[serde(rename = "Data")]
    data: String,
    #[serde(rename = "Tags")]
    tags: Vec<Tag>,
}

#[derive(Clone, Debug, Serialize)]
struct Patch {
    #[serde(rename = "Tags")]
    tags: Vec<Tag>,
}

#[derive(Clone, Debug, Serialize)]
struct ProcessResponse {
    #[serde(rename = "Output")]
    output: Output,
    // Outbox messages AND the state patch, because `patch@1.0` reads the outbox.
    // `dev_json_iface:json_to_message/2` builds `results/outbox` as a numbered
    // MAP from `Messages` but leaves `results/patches` a LIST, and
    // `dev_patch:move/4` folds its source with `maps:fold/3`. Pointing
    // `patch-from` at `/results/patches` therefore crashes the process for every
    // reply -- `{badmap,[]}` on an empty list, `{badmap,[#{...}]}` on a full one
    // -- before any publish happens. A PATCH-tagged entry in `Messages` is the
    // shape that device was written for; `dev_patch` lifts it out of the outbox,
    // so it is applied and never pushed.
    #[serde(rename = "Messages")]
    messages: Vec<Value>,
    #[serde(rename = "Spawns")]
    spawns: Vec<Value>,
    // Kept alongside the outbox entry: it costs one small array, it is what the
    // ABI has always advertised, and a node configured with
    // `patch-from: /results/patches` reads this one.
    patches: Vec<Patch>,
}

#[derive(Clone, Debug, Serialize)]
struct Output {
    data: String,
}

#[derive(Clone, Debug, Serialize)]
struct Envelope {
    ok: bool,
    response: ProcessResponse,
}

#[derive(Default)]
struct Effect {
    output: Value,
    messages: Vec<OutboundMessage>,
    touched: BTreeMap<String, Option<Value>>,
}

impl Effect {
    fn output(value: Value) -> Self {
        Self {
            output: value,
            ..Self::default()
        }
    }
    fn error(message: impl Into<String>) -> Self {
        Self::output(json!({ "error": message.into() }))
    }
}

impl Worker {
    pub fn from_env(env: &Value) -> Result<Self, String> {
        let config = WorkerConfig::from_env(env)?;
        Ok(Self {
            config,
            battles: HashMap::new(),
            assignments: HashMap::new(),
            tickets: HashMap::new(),
            reservations: HashMap::new(),
            settlements: HashMap::new(),
            cancellations: HashMap::new(),
            rejections: HashMap::new(),
            rejection_by_assignment: HashMap::new(),
            outcomes: HashMap::new(),
            confirmations: HashMap::new(),
            confirmation_by_id: HashMap::new(),
            ended_order: VecDeque::new(),
            rejected_order: VecDeque::new(),
            draining: false,
            high_water_timestamp: 0,
        })
    }

    pub fn config(&self) -> &WorkerConfig {
        &self.config
    }

    pub fn handle_value(&mut self, message: &Value) -> Value {
        let action = message_field(message, "action").unwrap_or_else(|| "Fleet.Status".into());
        let normalized_action = action.to_ascii_lowercase();
        let game_origin = matches!(
            normalized_action.as_str(),
            "battle.open"
                | "battle.cancel"
                | "battle.expire"
                | "fleet.settlement.ack"
                | "fleet.cancellation.ack"
                | "fleet.openrejected.ack"
                | "fleet.finalacked.release"
        );
        if game_origin {
            if let Err(error) = self.authenticate_and_advance_game(message) {
                return self.envelope(Effect::error(error));
            }
        }
        let removed = self.prune(self.high_water_timestamp);
        let mut effect = match normalized_action.as_str() {
            "fleet.status" => Effect::output(self.status_value()),
            "fleet.drain" => self.drain(message),
            "battle.open" => self.open(message),
            "battle.attack" => self.attack(message),
            "battle.cancel" => self.cancel(message, false),
            "battle.expire" => self.cancel(message, true),
            "battle.info" => self.battle_info(message),
            "fleet.settlement.ack" => self.ack(message, FinalKind::Settlement),
            "fleet.cancellation.ack" => self.ack(message, FinalKind::Cancellation),
            "fleet.openrejected.ack" => self.ack(message, FinalKind::Rejection),
            "fleet.finalacked.retry" => self.retry_confirmation(message),
            "fleet.finalacked.release" => self.release_confirmation(message),
            "fleet.settlement.retry" => self.retry_final(message, FinalKind::Settlement),
            "fleet.cancellation.retry" => self.retry_final(message, FinalKind::Cancellation),
            "fleet.openrejected.retry" => self.retry_final(message, FinalKind::Rejection),
            _ => Effect::error(format!("Unknown action '{action}'")),
        };
        for id in removed {
            effect.touched.entry(id).or_insert(None);
        }
        self.envelope(effect)
    }

    fn envelope(&self, effect: Effect) -> Value {
        let mut patch_tags = vec![Tag {
            name: "method".into(),
            value: "PATCH".into(),
        }];
        patch_tags.push(Tag {
            name: "fleetstatus".into(),
            value: serde_json::to_string(&self.status()).expect("status is serializable"),
        });
        for (battle_id, value) in effect.touched {
            patch_tags.push(Tag {
                name: format!("battle-{battle_id}"),
                value: value.map_or_else(
                    || "__ao-unset__".into(),
                    |battle| serde_json::to_string(&battle).expect("battle is serializable"),
                ),
            });
        }
        let patch = Patch { tags: patch_tags };
        // The patch goes LAST. `dev_patch` removes the entries it consumes and
        // keeps the rest under their original outbox keys, so a patch at key 1
        // would leave the real outbox numbered from 2 with nothing at 1.
        let mut messages: Vec<Value> = effect
            .messages
            .iter()
            .map(|message| serde_json::to_value(message).expect("message is serializable"))
            .collect();
        messages.push(serde_json::to_value(&patch).expect("patch is serializable"));
        serde_json::to_value(Envelope {
            ok: true,
            response: ProcessResponse {
                output: Output {
                    data: serde_json::to_string(&effect.output).expect("output is serializable"),
                },
                messages,
                spawns: Vec::new(),
                patches: vec![patch],
            },
        })
        .expect("envelope is serializable")
    }

    fn status_value(&self) -> Value {
        serde_json::to_value(self.status()).expect("status is serializable")
    }

    fn status(&self) -> Status {
        let active = self
            .battles
            .values()
            .filter(|record| record.battle.status == "battling")
            .count();
        let retained_ended = self.battles.len().saturating_sub(active);
        let pending_settlements = self
            .battles
            .values()
            .filter(|record| {
                record
                    .settlement
                    .as_ref()
                    .is_some_and(|final_record| !final_record.acknowledged)
            })
            .count();
        let pending_cancellations = self
            .battles
            .values()
            .filter(|record| {
                record
                    .cancellation
                    .as_ref()
                    .is_some_and(|final_record| !final_record.acknowledged)
            })
            .count();
        let pending_open_rejections = self
            .rejections
            .values()
            .filter(|record| !record.acknowledged)
            .count();
        let pending_finals = pending_settlements + pending_cancellations;
        let pending_deliveries = pending_finals + pending_open_rejections;
        let pending_confirmations = self
            .confirmations
            .values()
            .filter(|record| !record.released)
            .count();
        let available_slots = self.config.capacity.saturating_sub(active);
        let configured = !self.config.game_process.is_empty();
        let accepting = self.config.enabled
            && configured
            && !self.draining
            && available_slots > 0
            && pending_deliveries < self.config.max_pending
            && self.outcomes.len() < self.config.max_outcomes
            && self.confirmations.len() < self.config.max_confirmations;
        let admission_blocked_reason = if !self.config.enabled {
            Some("disabled")
        } else if !configured {
            Some("unconfigured")
        } else if self.draining {
            Some("draining")
        } else if pending_deliveries >= self.config.max_pending {
            Some("pending-delivery-backpressure")
        } else if self.outcomes.len() >= self.config.max_outcomes {
            Some("outcome-replay-backpressure")
        } else if self.confirmations.len() >= self.config.max_confirmations {
            Some("confirmation-replay-backpressure")
        } else if available_slots == 0 {
            Some("capacity")
        } else {
            None
        };
        Status {
            protocol: PROTOCOL,
            runtime: "rust-wasm@1",
            abi: ABI,
            clock_mode: "trusted-game-clock-v1",
            image_id: self.config.image_id.clone(),
            worker_id: self.config.worker_id.clone(),
            game_process: self.config.game_process.clone(),
            lifecycle: if !self.config.enabled {
                "disabled"
            } else if !configured {
                "unconfigured"
            } else if self.draining {
                "draining"
            } else {
                "ready"
            }
            .into(),
            enabled: self.config.enabled,
            configured,
            draining: self.draining,
            accepting,
            active,
            retained_ended,
            retained_finals: retained_ended,
            pending_settlements,
            pending_cancellations,
            pending_finals,
            retained_open_rejections: self.rejections.len(),
            pending_open_rejections,
            pending_deliveries,
            retained_outcomes: self.outcomes.len(),
            outcome_limit: self.config.max_outcomes,
            retained_confirmations: self.confirmations.len(),
            pending_confirmations,
            confirmation_limit: self.config.max_confirmations,
            max_ticket_ttl: self.config.max_ticket_ttl,
            pending_limit: self.config.max_pending,
            retention_limit: self.config.max_retained,
            admission_blocked_reason: admission_blocked_reason.map(str::to_owned),
            capacity: self.config.capacity,
            available_slots,
            assignment_weight: if accepting { available_slots } else { 0 },
            manager_mode: "assign-only",
            manager_proxies_rounds: false,
            direct_action: "Battle.Attack",
        }
    }

    fn require_game_identity(&self, message: &Value) -> Result<(), String> {
        if string_field(message, "owner").as_deref() != Some(self.config.scheduler.as_str())
            || string_field(message, "from").as_deref() != Some(self.config.game_process.as_str())
        {
            return Err(
                "Only the scheduler-attested configured game process may perform this action"
                    .into(),
            );
        }
        Ok(())
    }

    fn authenticate_and_advance_game(&mut self, message: &Value) -> Result<(), String> {
        self.require_game_identity(message)?;
        let timestamp = message_field(message, "authority-timestamp")
            .and_then(|value| value.parse::<i64>().ok())
            .filter(|value| *value >= 0)
            .ok_or("Scheduler-attested game action requires an integer Authority-Timestamp")?;
        self.high_water_timestamp = self.high_water_timestamp.max(timestamp);
        Ok(())
    }

    fn require_owner(&self, message: &Value) -> Result<(), String> {
        if string_field(message, "owner").as_deref() != Some(self.config.owner.as_str()) {
            return Err("Not authorised".into());
        }
        Ok(())
    }

    fn drain(&mut self, message: &Value) -> Effect {
        if let Err(error) = self.require_owner(message) {
            return Effect::error(error);
        }
        self.draining = message_field(message, "drain")
            .and_then(|value| parse_bool(&value))
            .unwrap_or(true);
        Effect::output(self.status_value())
    }

    #[allow(clippy::too_many_lines)]
    fn open(&mut self, message: &Value) -> Effect {
        if let Err(error) = self.require_game_identity(message) {
            return Effect::error(error);
        }
        let payload = match data_object::<OpenPayload>(message) {
            Ok(payload) => payload,
            Err(error) => return Effect::error(error),
        };
        if payload.protocol != PROTOCOL {
            return Effect::error("Unsupported battle-fleet protocol");
        }
        if message_field(message, "authority-timestamp").and_then(|value| value.parse::<i64>().ok())
            != Some(payload.issued_at)
        {
            return Effect::error("Battle.Open Authority-Timestamp must equal issuedAt");
        }
        if !valid_id(&payload.assignment_id, 192) {
            return Effect::error("assignmentId is invalid");
        }
        let fingerprint = match canonical(&payload) {
            Ok(value) => value,
            Err(error) => return Effect::error(error),
        };
        if let Some(battle_id) = self.assignments.get(&payload.assignment_id).cloned() {
            let Some(record) = self.battles.get(&battle_id) else {
                return self.outcome_replay(&payload);
            };
            if record.open_fingerprint != fingerprint {
                return Effect::error("assignmentId already belongs to a different open battle");
            }
            if record.pre_open_cancelled {
                return self.cancellation_effect(&battle_id, true);
            }
            let mut effect = Effect::output(self.battle_view(record, Some(true)));
            effect.messages.push(self.opened_message(record));
            effect
                .touched
                .insert(battle_id, Some(self.battle_view(record, None)));
            return effect;
        }
        if self
            .rejection_by_assignment
            .contains_key(&payload.assignment_id)
        {
            return self.rejection_replay(&payload, &fingerprint);
        }
        if self.outcomes.contains_key(&payload.assignment_id) {
            return self.outcome_replay(&payload);
        }
        if !valid_id(&payload.battle_id, 96) {
            return Effect::error("battleId is invalid");
        }
        if !valid_id(&payload.ticket, 192) {
            return Effect::error("ticket is invalid");
        }
        if !valid_id(&payload.reservation_id, 192) {
            return Effect::error("reservationId is invalid");
        }
        if payload.player_id.len() != 43 {
            return Effect::error("playerId is invalid");
        }
        let normalized_error = if payload.expires_at < payload.issued_at {
            Some("ticket timestamps are invalid".to_owned())
        } else if payload.expires_at - payload.issued_at > self.config.max_ticket_ttl {
            Some("ticket lifetime exceeds worker limit".to_owned())
        } else if !(0.25..=4.0).contains(&payload.difficulty) || !payload.difficulty.is_finite() {
            Some("difficulty is invalid".to_owned())
        } else {
            validate_monster(&payload.monster).err()
        };
        if let Some(reason) = normalized_error {
            return self.reject_open(payload, fingerprint, reason);
        }
        if payload.expires_at < self.high_water_timestamp {
            return self.reject_open(payload, fingerprint, "ticket has expired".into());
        }
        if self.tickets.contains_key(&payload.ticket)
            || self
                .outcomes
                .values()
                .any(|value| value.ticket == payload.ticket)
        {
            return self.reject_open(payload, fingerprint, "ticket has already been used".into());
        }
        if self.reservations.contains_key(&payload.reservation_id)
            || self
                .outcomes
                .values()
                .any(|value| value.reservation_id == payload.reservation_id)
        {
            return self.reject_open(
                payload,
                fingerprint,
                "reservation has already been assigned".into(),
            );
        }
        if self.battles.contains_key(&payload.battle_id)
            || self
                .outcomes
                .values()
                .any(|value| value.battle_id == payload.battle_id)
        {
            return self.reject_open(
                payload,
                fingerprint,
                "battleId already belongs to another reservation".into(),
            );
        }
        let status = self.status();
        let admission_error = if !self.config.enabled {
            Some("Battle fleet is disabled")
        } else if self.draining {
            Some("Worker is draining")
        } else if status.active >= self.config.capacity {
            Some("Worker is at capacity")
        } else if status.pending_deliveries >= self.config.max_pending {
            Some("Worker is waiting for delivery acknowledgements")
        } else if self.outcomes.len() >= self.config.max_outcomes {
            Some("Worker replay ledger is at capacity")
        } else if self.confirmations.len() >= self.config.max_confirmations {
            Some("Worker confirmation ledger is at capacity")
        } else {
            None
        };
        if let Some(reason) = admission_error {
            return self.reject_open(payload, fingerprint, reason.into());
        }
        let cancel_id =
            message_field(message, "cancel-id").or_else(|| message_field(message, "cancelid"));
        let cancel_reason = message_field(message, "cancel-reason")
            .or_else(|| message_field(message, "cancelreason"));
        if cancel_id.is_some() != cancel_reason.is_some()
            || cancel_id
                .as_deref()
                .is_some_and(|value| !valid_id(value, 192))
            || cancel_reason.as_deref().is_some_and(str::is_empty)
        {
            return Effect::error("cancel-id and cancel-reason must form a valid recovery intent");
        }
        if cancel_id
            .as_ref()
            .is_some_and(|value| self.cancellations.contains_key(value))
        {
            return Effect::error("cancel-id already belongs to another battle");
        }
        let mut rng = Rng::seeded(&format!(
            "{}/{}/open",
            payload.ticket, payload.assignment_id
        ));
        let opponent = make_opponent(
            payload.monster.level,
            payload.difficulty,
            payload.opponent_faction.as_deref(),
            &mut rng,
        );
        let battle = new_battle(
            &payload.battle_id,
            &payload.monster,
            &payload.player_id,
            &opponent,
            self.high_water_timestamp,
        );
        let battle_id = payload.battle_id.clone();
        let assignment_id = payload.assignment_id.clone();
        let mut record = BattleRecord {
            ticket: payload.ticket.clone(),
            reservation_id: payload.reservation_id.clone(),
            assignment_id: assignment_id.clone(),
            player_id: payload.player_id.clone(),
            reward_plan: payload.reward_plan.clone(),
            expires_at: payload.expires_at,
            seed_material: format!("{}/{}", payload.ticket, assignment_id),
            open_fingerprint: fingerprint,
            attacks: HashMap::new(),
            battle,
            settlement: None,
            cancellation: None,
            pre_open_cancelled: cancel_id.is_some(),
        };
        self.tickets
            .insert(record.ticket.clone(), battle_id.clone());
        self.reservations
            .insert(record.reservation_id.clone(), battle_id.clone());
        self.assignments
            .insert(record.assignment_id.clone(), battle_id.clone());
        if let (Some(cancel_id), Some(reason)) = (cancel_id, cancel_reason) {
            record.battle.status = "cancelled".into();
            record.battle.cancelled_at = Some(self.high_water_timestamp);
            let cancellation_payload = json!({
                "protocol": PROTOCOL, "cancelId": cancel_id, "workerId": self.config.worker_id,
                "battleId": battle_id, "assignmentId": record.assignment_id,
                "reservationId": record.reservation_id, "ticket": record.ticket,
                "playerId": record.player_id, "reason": reason,
                "cancelledAt": self.high_water_timestamp,
            });
            record.cancellation = Some(FinalRecord {
                id: cancel_id.clone(),
                kind: FinalKind::Cancellation,
                payload: cancellation_payload,
                fingerprint: Some(
                    canonical(&json!({
                        "battleId": battle_id, "reservationId": record.reservation_id,
                        "ticket": record.ticket, "cancelId": cancel_id,
                        "reason": reason, "preOpen": true,
                    }))
                    .expect("pre-open cancellation fingerprint is serializable"),
                ),
                acknowledged: false,
            });
            self.cancellations
                .insert(cancel_id.clone(), battle_id.clone());
            self.ended_order.push_back(battle_id.clone());
            self.outcomes.insert(
                assignment_id.clone(),
                Outcome {
                    kind: FinalKind::Cancellation,
                    id: cancel_id,
                    opened_id: None,
                    assignment_id,
                    ticket: record.ticket.clone(),
                    reservation_id: record.reservation_id.clone(),
                    battle_id: battle_id.clone(),
                    player_id: record.player_id.clone(),
                    reason: Some(reason),
                    expires_at: record.expires_at,
                },
            );
            self.battles.insert(battle_id.clone(), record);
            let mut effect = self.cancellation_effect(&battle_id, false);
            if let Some(object) = effect.output.as_object_mut() {
                object.insert("preOpen".into(), Value::Bool(true));
            }
            return effect;
        }
        let opened_id = format!("{}-opened-{assignment_id}", self.config.worker_id);
        self.outcomes.insert(
            assignment_id.clone(),
            Outcome {
                kind: FinalKind::Settlement,
                id: opened_id.clone(),
                opened_id: Some(opened_id),
                assignment_id,
                ticket: record.ticket.clone(),
                reservation_id: record.reservation_id.clone(),
                battle_id: battle_id.clone(),
                player_id: record.player_id.clone(),
                reason: None,
                expires_at: record.expires_at,
            },
        );
        self.battles.insert(battle_id.clone(), record);
        let record = &self.battles[&battle_id];
        let mut effect = Effect::output(self.battle_view(record, None));
        effect.messages.push(self.opened_message(record));
        effect
            .touched
            .insert(battle_id, Some(self.battle_view(record, None)));
        effect
    }

    fn attack(&mut self, message: &Value) -> Effect {
        let battle_id = match message_field(message, "battleid") {
            Some(value) if valid_id(&value, 96) => value,
            _ => return Effect::error("battleId is invalid"),
        };
        let action_id = match message_field(message, "actionid") {
            Some(value) if valid_id(&value, 192) => value,
            _ => return Effect::error("actionId is invalid"),
        };
        let Some(record) = self.battles.get(&battle_id) else {
            return Effect::error("Battle not found");
        };
        let owner = string_field(message, "owner");
        if owner.as_deref() != Some(record.player_id.as_str()) {
            return Effect::error("A participant signature is required");
        }
        if string_field(message, "from")
            .as_deref()
            .is_some_and(|value| value != record.player_id)
        {
            return Effect::error("You are not in this battle");
        }
        let ticket = message_field(message, "ticket").unwrap_or_default();
        if ticket != record.ticket {
            return Effect::error("Ticket does not match this battle");
        }
        let claimed_round =
            message_field(message, "round").and_then(|value| value.parse::<u32>().ok());
        let move_name = message_field(message, "move").unwrap_or_default();
        let fingerprint = canonical(&json!({
            "actor": owner, "battleId": battle_id, "ticket": ticket,
            "actionId": action_id, "round": claimed_round, "move": move_name,
        }))
        .expect("attack fingerprint is serializable");
        if let Some(prior) = record.attacks.get(&action_id) {
            if prior.fingerprint != fingerprint {
                return Effect::error("actionId already belongs to a different attack");
            }
            let mut output = self.battle_view(record, Some(true));
            if let Some(object) = output.as_object_mut() {
                object.insert("actionId".into(), Value::String(action_id));
                object.insert("acceptedRound".into(), json!(prior.accepted_round));
                object.insert("resultingRound".into(), json!(prior.resulting_round));
            }
            let mut effect = Effect::output(output);
            effect
                .touched
                .insert(battle_id, Some(self.battle_view(record, None)));
            return effect;
        }
        if record.battle.status == "ended" {
            return Effect::error("That battle is over");
        }
        if record.battle.status != "battling" {
            return Effect::error("That battle is not active");
        }
        let Some(claimed_round) = claimed_round else {
            return Effect::error("Round is required");
        };
        if claimed_round != record.battle.round {
            return Effect::error(format!(
                "That round has already resolved; current round is {}",
                record.battle.round
            ));
        }
        let record = self
            .battles
            .get_mut(&battle_id)
            .expect("record still exists");
        let mut rng = Rng::seeded(&format!("{}/round:{claimed_round}", record.seed_material));
        if let Err(error) = resolve_round(&mut record.battle, &move_name, &mut rng) {
            return Effect::error(error);
        }
        let terminal = record.battle.status == "ended";
        if terminal && record.settlement.is_none() {
            record.battle.ended_at = Some(self.high_water_timestamp);
            let result = if record.battle.winner.as_deref() == Some("challenger") {
                "win"
            } else {
                "loss"
            };
            let settlement_id = format!("{}-{}", self.config.worker_id, battle_id);
            record.settlement = Some(FinalRecord {
                id: settlement_id.clone(),
                kind: FinalKind::Settlement,
                payload: json!({
                    "protocol": PROTOCOL, "settlementId": settlement_id,
                    "workerId": self.config.worker_id, "battleId": battle_id,
                    "assignmentId": record.assignment_id, "reservationId": record.reservation_id,
                    "ticket": record.ticket, "playerId": record.player_id, "result": result,
                    "winner": record.battle.winner, "rounds": record.battle.round,
                    "timedOut": record.battle.timed_out, "startedAt": record.battle.started_at,
                    "endedAt": self.high_water_timestamp, "rewardPlan": record.reward_plan,
                }),
                fingerprint: None,
                acknowledged: false,
            });
            self.settlements.insert(settlement_id, battle_id.clone());
            self.ended_order.push_back(battle_id.clone());
        }
        record.attacks.insert(
            action_id,
            AttackReceipt {
                fingerprint,
                accepted_round: claimed_round,
                resulting_round: record.battle.round,
            },
        );
        let view = Self::battle_view_with_worker(&self.config.worker_id, record, None);
        let message = if terminal {
            record
                .settlement
                .as_ref()
                .map(|final_record| final_message_for(&self.config, record, final_record))
        } else {
            None
        };
        let mut effect = Effect::output(view.clone());
        if let Some(message) = message {
            effect.messages.push(message);
        }
        effect.touched.insert(battle_id, Some(view));
        effect
    }

    fn cancel(&mut self, message: &Value, expiry_only: bool) -> Effect {
        if let Err(error) = self.require_game_identity(message) {
            return Effect::error(error);
        }
        let battle_id = message_field(message, "battleid").unwrap_or_default();
        let cancel_id = message_field(message, "cancelid").unwrap_or_default();
        if !valid_id(&battle_id, 96) || !valid_id(&cancel_id, 192) {
            return Effect::error("battleId and cancelId are required");
        }
        let reservation_id = message_field(message, "reservationid").unwrap_or_default();
        let ticket = message_field(message, "ticket").unwrap_or_default();
        let reason = message_field(message, "reason")
            .unwrap_or_else(|| if expiry_only { "expired" } else { "authority" }.into());
        let Some(record) = self.battles.get(&battle_id) else {
            return Effect::error("Battle not found");
        };
        if reservation_id != record.reservation_id || ticket != record.ticket {
            return Effect::error("Cancellation does not match reservation");
        }
        let fingerprint = canonical(&json!({
            "battleId": battle_id, "reservationId": reservation_id, "ticket": ticket,
            "cancelId": cancel_id, "reason": reason, "expiryOnly": expiry_only,
        }))
        .expect("cancellation fingerprint is serializable");
        if let Some(prior) = &record.cancellation {
            let prior_fingerprint = prior.fingerprint.as_deref().unwrap_or_default();
            if prior_fingerprint != fingerprint {
                return Effect::error("Battle already has a different cancellation");
            }
            return self.cancellation_effect(&battle_id, true);
        }
        if record.battle.status == "ended" {
            return Effect::error("Battle already settled");
        }
        if record.battle.status != "battling" {
            return Effect::error("Battle is not active");
        }
        if expiry_only && self.high_water_timestamp < record.expires_at {
            return Effect::error("Battle reservation has not expired");
        }
        let record = self
            .battles
            .get_mut(&battle_id)
            .expect("record still exists");
        record.battle.status = "cancelled".into();
        record.battle.cancelled_at = Some(self.high_water_timestamp);
        let payload = json!({
            "protocol": PROTOCOL, "cancelId": cancel_id,
            "openedId": format!("{}-opened-{}", self.config.worker_id, record.assignment_id),
            "workerId": self.config.worker_id, "battleId": battle_id,
            "assignmentId": record.assignment_id, "reservationId": record.reservation_id,
            "ticket": record.ticket, "playerId": record.player_id, "reason": reason,
            "cancelledAt": self.high_water_timestamp,
        });
        record.cancellation = Some(FinalRecord {
            id: cancel_id.clone(),
            kind: FinalKind::Cancellation,
            payload,
            fingerprint: Some(fingerprint),
            acknowledged: false,
        });
        self.cancellations.insert(cancel_id, battle_id.clone());
        self.ended_order.push_back(battle_id.clone());
        self.cancellation_effect(&battle_id, false)
    }

    fn battle_info(&self, message: &Value) -> Effect {
        let battle_id = message_field(message, "battleid").unwrap_or_default();
        let Some(record) = self.battles.get(&battle_id) else {
            return Effect::error("Battle not found");
        };
        let view = self.battle_view(record, None);
        let mut effect = Effect::output(view.clone());
        effect.touched.insert(battle_id, Some(view));
        effect
    }

    fn ack(&mut self, message: &Value, kind: FinalKind) -> Effect {
        if let Err(error) = self.require_game_identity(message) {
            return Effect::error(error);
        }
        let field_name = match kind {
            FinalKind::Settlement => "settlementid",
            FinalKind::Cancellation => "cancelid",
            FinalKind::Rejection => "rejectionid",
        };
        let Some(final_id) =
            message_field(message, field_name).or_else(|| message_field(message, "reference"))
        else {
            return Effect::error("Final reference is required");
        };
        let key = format!("{}:{final_id}", kind.name());
        if let Some(confirmation) = self.confirmations.get(&key) {
            let mut effect = Effect::output(json!({
                field_name_output(kind): final_id, "acknowledged": true, "duplicate": true,
                "confirmationId": confirmation.id,
            }));
            effect
                .messages
                .push(self.confirmation_message(confirmation));
            return effect;
        }
        if self.confirmations.len() >= self.config.max_confirmations {
            return Effect::error(
                "Worker cannot retain another final acknowledgement confirmation",
            );
        }
        let identity = match self.final_identity(kind, &final_id) {
            Some(value) => value,
            None => {
                return Effect::error(match kind {
                    FinalKind::Settlement => "Settlement not found",
                    FinalKind::Cancellation => "Cancellation not found",
                    FinalKind::Rejection => "Open rejection not found",
                })
            }
        };
        self.mark_acknowledged(kind, &final_id);
        let confirmation_id = format!(
            "{}-final-acked-{}-{final_id}",
            self.config.worker_id,
            kind.name()
        );
        let payload = json!({
            "protocol": PROTOCOL, "confirmationId": confirmation_id, "kind": kind.name(),
            "finalId": final_id, "workerId": self.config.worker_id,
            "battleId": identity.battle_id, "assignmentId": identity.assignment_id,
            "reservationId": identity.reservation_id, "ticket": identity.ticket,
            "playerId": identity.player_id,
        });
        let confirmation = Confirmation {
            id: confirmation_id.clone(),
            kind,
            final_id: final_id.clone(),
            payload,
            released: false,
            protect_until: identity
                .expires_at
                .max(self.high_water_timestamp + self.config.max_ticket_ttl),
        };
        self.confirmation_by_id
            .insert(confirmation_id.clone(), key.clone());
        self.confirmations.insert(key.clone(), confirmation);
        let confirmation = &self.confirmations[&key];
        let mut effect = Effect::output(json!({
            field_name_output(kind): final_id, "acknowledged": true, "duplicate": false,
            "confirmationId": confirmation_id,
        }));
        effect
            .messages
            .push(self.confirmation_message(confirmation));
        if kind != FinalKind::Rejection {
            effect.touched.insert(
                identity.battle_id.clone(),
                self.battles
                    .get(&identity.battle_id)
                    .map(|record| self.battle_view(record, None)),
            );
        }
        self.prune_retained(&mut effect.touched);
        effect
    }

    fn retry_confirmation(&self, message: &Value) -> Effect {
        if let Err(error) = self.require_owner(message) {
            return Effect::error(error);
        }
        let id = message_field(message, "confirmationid")
            .or_else(|| message_field(message, "reference"));
        let Some(key) = id
            .as_ref()
            .and_then(|value| self.confirmation_by_id.get(value))
        else {
            return Effect::error("Final acknowledgement confirmation not found");
        };
        let confirmation = &self.confirmations[key];
        let mut effect =
            Effect::output(json!({ "confirmationId": confirmation.id, "retried": true }));
        effect
            .messages
            .push(self.confirmation_message(confirmation));
        effect
    }

    fn release_confirmation(&mut self, message: &Value) -> Effect {
        if let Err(error) = self.require_game_identity(message) {
            return Effect::error(error);
        }
        let id = message_field(message, "confirmationid")
            .or_else(|| message_field(message, "reference"));
        let Some(key) = id
            .as_ref()
            .and_then(|value| self.confirmation_by_id.get(value))
            .cloned()
        else {
            return Effect::error("Final acknowledgement confirmation not found");
        };
        let confirmation = self
            .confirmations
            .get_mut(&key)
            .expect("confirmation index is valid");
        let duplicate = confirmation.released;
        confirmation.released = true;
        let confirmation_id = confirmation.id.clone();
        self.prune(self.high_water_timestamp);
        Effect::output(
            json!({ "confirmationId": confirmation_id, "released": true, "duplicate": duplicate }),
        )
    }

    fn retry_final(&self, message: &Value, kind: FinalKind) -> Effect {
        if let Err(error) = self.require_owner(message) {
            return Effect::error(error);
        }
        let field_name = match kind {
            FinalKind::Settlement => "settlementid",
            FinalKind::Cancellation => "cancelid",
            FinalKind::Rejection => "rejectionid",
        };
        let Some(final_id) =
            message_field(message, field_name).or_else(|| message_field(message, "reference"))
        else {
            return Effect::error("Final reference is required");
        };
        let Some(message) = self.final_message(kind, &final_id) else {
            return Effect::error(match kind {
                FinalKind::Settlement => "Settlement not found",
                FinalKind::Cancellation => "Cancellation not found",
                FinalKind::Rejection => "Open rejection not found",
            });
        };
        let mut effect =
            Effect::output(json!({ field_name_output(kind): final_id, "retried": true }));
        effect.messages.push(message);
        effect
    }

    fn reject_open(&mut self, payload: OpenPayload, fingerprint: String, reason: String) -> Effect {
        if self.status().pending_deliveries >= self.config.max_pending {
            return Effect::error("Worker cannot retain another unacknowledged rejection");
        }
        if self.outcomes.len() >= self.config.max_outcomes {
            return Effect::error("Worker cannot retain another replay outcome");
        }
        if self.confirmations.len() >= self.config.max_confirmations {
            return Effect::error("Worker cannot retain another final confirmation");
        }
        let rejection_id = format!(
            "{}-rejected-{}",
            self.config.worker_id, payload.assignment_id
        );
        let rejection_payload = json!({
            "protocol": PROTOCOL, "rejectionId": rejection_id,
            "workerId": self.config.worker_id, "battleId": payload.battle_id,
            "assignmentId": payload.assignment_id, "reservationId": payload.reservation_id,
            "ticket": payload.ticket, "playerId": payload.player_id, "reason": reason,
        });
        let rejection = Rejection {
            id: rejection_id.clone(),
            assignment_id: payload.assignment_id.clone(),
            ticket: payload.ticket.clone(),
            reservation_id: payload.reservation_id.clone(),
            battle_id: payload.battle_id.clone(),
            player_id: payload.player_id.clone(),
            fingerprint,
            reason: reason.clone(),
            expires_at: payload
                .expires_at
                .min(self.high_water_timestamp + self.config.max_ticket_ttl),
            acknowledged: false,
            payload: rejection_payload,
        };
        self.outcomes.insert(
            payload.assignment_id.clone(),
            Outcome {
                kind: FinalKind::Rejection,
                id: rejection_id.clone(),
                opened_id: None,
                assignment_id: payload.assignment_id.clone(),
                ticket: payload.ticket,
                reservation_id: payload.reservation_id,
                battle_id: payload.battle_id,
                player_id: payload.player_id,
                reason: Some(reason.clone()),
                expires_at: rejection.expires_at,
            },
        );
        self.rejection_by_assignment
            .insert(payload.assignment_id, rejection_id.clone());
        self.rejected_order.push_back(rejection_id.clone());
        self.rejections.insert(rejection_id.clone(), rejection);
        let rejection = &self.rejections[&rejection_id];
        let mut effect = Effect::output(json!({
            "error": reason, "rejectionId": rejection_id, "duplicate": false,
        }));
        effect.messages.push(self.rejection_message(rejection));
        effect
    }

    fn rejection_replay(&self, payload: &OpenPayload, fingerprint: &str) -> Effect {
        let id = &self.rejection_by_assignment[&payload.assignment_id];
        let rejection = &self.rejections[id];
        if rejection.fingerprint != fingerprint {
            return Effect::error("assignmentId already has a different rejection");
        }
        let mut effect = Effect::output(json!({
            "error": rejection.reason, "rejectionId": rejection.id, "duplicate": true,
        }));
        effect.messages.push(self.rejection_message(rejection));
        effect
    }

    fn outcome_replay(&self, payload: &OpenPayload) -> Effect {
        let Some(outcome) = self.outcomes.get(&payload.assignment_id) else {
            return Effect::error("Battle outcome is no longer retained");
        };
        if outcome.ticket != payload.ticket
            || outcome.reservation_id != payload.reservation_id
            || outcome.battle_id != payload.battle_id
            || outcome.player_id != payload.player_id
        {
            return Effect::error("assignmentId already has a different retained outcome");
        }
        match outcome.kind {
            FinalKind::Rejection => {
                let mut effect = Effect::output(json!({
                    "error": outcome.reason, "rejectionId": outcome.id, "duplicate": true,
                }));
                if let Some(message) = self.final_message(FinalKind::Rejection, &outcome.id) {
                    effect.messages.push(message);
                }
                effect
            }
            FinalKind::Cancellation => {
                let mut effect = Effect::output(json!({
                    "battleId": outcome.battle_id, "cancelId": outcome.id,
                    "cancelled": true, "duplicate": true,
                }));
                if let Some(message) = self.final_message(FinalKind::Cancellation, &outcome.id) {
                    effect.messages.push(message);
                }
                effect
            }
            FinalKind::Settlement => {
                let mut effect = Effect::output(json!({
                    "error": "Battle was already opened and its full state has been pruned",
                    "openedId": outcome.opened_id, "duplicate": true,
                }));
                effect.messages.push(self.opened_outcome_message(outcome));
                effect
            }
        }
    }

    fn cancellation_effect(&self, battle_id: &str, duplicate: bool) -> Effect {
        let record = &self.battles[battle_id];
        let cancellation = record.cancellation.as_ref().expect("cancellation exists");
        let mut effect = Effect::output(json!({
            "battleId": battle_id, "cancelId": cancellation.id,
            "cancelled": true, "duplicate": duplicate,
        }));
        if !cancellation.acknowledged {
            effect
                .messages
                .push(final_message_for(&self.config, record, cancellation));
        }
        effect
            .touched
            .insert(battle_id.into(), Some(self.battle_view(record, None)));
        effect
    }

    fn battle_view(&self, record: &BattleRecord, duplicate: Option<bool>) -> Value {
        Self::battle_view_with_worker(&self.config.worker_id, record, duplicate)
    }

    fn battle_view_with_worker(
        worker_id: &str,
        record: &BattleRecord,
        duplicate: Option<bool>,
    ) -> Value {
        let mut value = serde_json::to_value(&record.battle).expect("battle is serializable");
        let object = value.as_object_mut().expect("battle is an object");
        object.insert("protocol".into(), Value::String(PROTOCOL.into()));
        object.insert("workerId".into(), Value::String(worker_id.into()));
        object.insert(
            "challengerAddress".into(),
            Value::String(record.battle.challenger.address.clone()),
        );
        object.insert(
            "accepterAddress".into(),
            Value::String(record.battle.accepter.address.clone()),
        );
        object.insert("waitingOn".into(), Value::Object(Map::new()));
        if let Some(value) = record.settlement.as_ref() {
            object.insert(
                "settlementStatus".into(),
                Value::String(
                    if value.acknowledged {
                        "acknowledged"
                    } else {
                        "pending"
                    }
                    .into(),
                ),
            );
        }
        if let Some(value) = record.cancellation.as_ref() {
            object.insert(
                "cancellationStatus".into(),
                Value::String(
                    if value.acknowledged {
                        "acknowledged"
                    } else {
                        "pending"
                    }
                    .into(),
                ),
            );
        }
        if let Some(duplicate) = duplicate {
            object.insert("duplicate".into(), Value::Bool(duplicate));
        }
        value
    }

    fn opened_message(&self, record: &BattleRecord) -> OutboundMessage {
        let opened_id = format!("{}-opened-{}", self.config.worker_id, record.assignment_id);
        let payload = json!({
            "protocol": PROTOCOL, "openedId": opened_id, "workerId": self.config.worker_id,
            "battleId": record.battle.id, "assignmentId": record.assignment_id,
            "reservationId": record.reservation_id, "ticket": record.ticket,
            "playerId": record.player_id,
        });
        protocol_message(
            &self.config,
            "Battle.Fleet.Opened",
            &opened_id,
            &payload,
            &[
                ("worker-id", &self.config.worker_id),
                ("battle-id", &record.battle.id),
                ("reservation-id", &record.reservation_id),
                ("assignment-id", &record.assignment_id),
                ("player-id", &record.player_id),
            ],
        )
    }

    fn opened_outcome_message(&self, outcome: &Outcome) -> OutboundMessage {
        let opened_id = outcome.opened_id.as_deref().unwrap_or(&outcome.id);
        let payload = json!({
            "protocol": PROTOCOL, "openedId": opened_id, "workerId": self.config.worker_id,
            "battleId": outcome.battle_id, "assignmentId": outcome.assignment_id,
            "reservationId": outcome.reservation_id, "ticket": outcome.ticket,
            "playerId": outcome.player_id,
        });
        protocol_message(
            &self.config,
            "Battle.Fleet.Opened",
            opened_id,
            &payload,
            &[],
        )
    }

    fn rejection_message(&self, rejection: &Rejection) -> OutboundMessage {
        protocol_message(
            &self.config,
            "Battle.Fleet.OpenRejected",
            &rejection.id,
            &rejection.payload,
            &[
                ("worker-id", &self.config.worker_id),
                ("battle-id", &rejection.battle_id),
                ("reservation-id", &rejection.reservation_id),
                ("player-id", &rejection.player_id),
                ("reason", &rejection.reason),
            ],
        )
    }

    fn confirmation_message(&self, confirmation: &Confirmation) -> OutboundMessage {
        let battle_id = confirmation.payload["battleId"]
            .as_str()
            .unwrap_or_default();
        let reservation_id = confirmation.payload["reservationId"]
            .as_str()
            .unwrap_or_default();
        let assignment_id = confirmation.payload["assignmentId"]
            .as_str()
            .unwrap_or_default();
        let player_id = confirmation.payload["playerId"]
            .as_str()
            .unwrap_or_default();
        protocol_message(
            &self.config,
            "Battle.Fleet.FinalAcked",
            &confirmation.id,
            &confirmation.payload,
            &[
                ("kind", confirmation.kind.name()),
                ("final-id", &confirmation.final_id),
                ("worker-id", &self.config.worker_id),
                ("battle-id", battle_id),
                ("reservation-id", reservation_id),
                ("assignment-id", assignment_id),
                ("player-id", player_id),
            ],
        )
    }

    fn final_message(&self, kind: FinalKind, id: &str) -> Option<OutboundMessage> {
        match kind {
            FinalKind::Settlement => {
                let battle_id = self.settlements.get(id)?;
                let record = self.battles.get(battle_id)?;
                Some(final_message_for(
                    &self.config,
                    record,
                    record.settlement.as_ref()?,
                ))
            }
            FinalKind::Cancellation => {
                let battle_id = self.cancellations.get(id)?;
                let record = self.battles.get(battle_id)?;
                Some(final_message_for(
                    &self.config,
                    record,
                    record.cancellation.as_ref()?,
                ))
            }
            FinalKind::Rejection => self
                .rejections
                .get(id)
                .map(|value| self.rejection_message(value)),
        }
    }

    fn final_identity(&self, kind: FinalKind, id: &str) -> Option<Identity> {
        match kind {
            FinalKind::Settlement => {
                let battle_id = self.settlements.get(id)?;
                Some(Identity::from_record(self.battles.get(battle_id)?))
            }
            FinalKind::Cancellation => {
                let battle_id = self.cancellations.get(id)?;
                Some(Identity::from_record(self.battles.get(battle_id)?))
            }
            FinalKind::Rejection => {
                let record = self.rejections.get(id)?;
                Some(Identity {
                    battle_id: record.battle_id.clone(),
                    assignment_id: record.assignment_id.clone(),
                    reservation_id: record.reservation_id.clone(),
                    ticket: record.ticket.clone(),
                    player_id: record.player_id.clone(),
                    expires_at: record.expires_at,
                })
            }
        }
    }

    fn mark_acknowledged(&mut self, kind: FinalKind, id: &str) {
        match kind {
            FinalKind::Settlement => {
                if let Some(record) = self
                    .settlements
                    .get(id)
                    .and_then(|battle| self.battles.get_mut(battle))
                {
                    if let Some(value) = record.settlement.as_mut() {
                        value.acknowledged = true;
                    }
                }
            }
            FinalKind::Cancellation => {
                if let Some(record) = self
                    .cancellations
                    .get(id)
                    .and_then(|battle| self.battles.get_mut(battle))
                {
                    if let Some(value) = record.cancellation.as_mut() {
                        value.acknowledged = true;
                    }
                }
            }
            FinalKind::Rejection => {
                if let Some(value) = self.rejections.get_mut(id) {
                    value.acknowledged = true;
                }
            }
        }
    }

    fn prune(&mut self, timestamp: i64) -> Vec<String> {
        let expired_confirmations: Vec<_> = self
            .confirmations
            .iter()
            .filter(|(_, value)| value.released && timestamp > value.protect_until)
            .map(|(key, value)| (key.clone(), value.id.clone()))
            .collect();
        for (key, id) in expired_confirmations {
            self.confirmations.remove(&key);
            self.confirmation_by_id.remove(&id);
        }
        self.outcomes
            .retain(|_, value| timestamp <= value.expires_at);
        let mut removed = BTreeMap::new();
        self.prune_retained(&mut removed);
        removed.into_keys().collect()
    }

    fn prune_retained(&mut self, touched: &mut BTreeMap<String, Option<Value>>) {
        while self.ended_order.len() > self.config.max_retained {
            let index = self.ended_order.iter().position(|battle_id| {
                self.battles.get(battle_id).is_some_and(|record| {
                    record
                        .settlement
                        .as_ref()
                        .is_some_and(|value| value.acknowledged)
                        || record
                            .cancellation
                            .as_ref()
                            .is_some_and(|value| value.acknowledged)
                })
            });
            let Some(index) = index else {
                break;
            };
            let battle_id = self.ended_order.remove(index).expect("index exists");
            if let Some(record) = self.battles.remove(&battle_id) {
                self.assignments.remove(&record.assignment_id);
                self.tickets.remove(&record.ticket);
                self.reservations.remove(&record.reservation_id);
                if let Some(value) = record.settlement {
                    self.settlements.remove(&value.id);
                }
                if let Some(value) = record.cancellation {
                    self.cancellations.remove(&value.id);
                }
            }
            touched.insert(battle_id, None);
        }
        while self.rejected_order.len() > self.config.max_retained {
            let index = self.rejected_order.iter().position(|id| {
                self.rejections
                    .get(id)
                    .is_some_and(|value| value.acknowledged)
            });
            let Some(index) = index else {
                break;
            };
            let id = self.rejected_order.remove(index).expect("index exists");
            if let Some(record) = self.rejections.remove(&id) {
                self.rejection_by_assignment.remove(&record.assignment_id);
            }
        }
    }
}

#[derive(Clone, Debug)]
struct Identity {
    battle_id: String,
    assignment_id: String,
    reservation_id: String,
    ticket: String,
    player_id: String,
    expires_at: i64,
}

impl Identity {
    fn from_record(record: &BattleRecord) -> Self {
        Self {
            battle_id: record.battle.id.clone(),
            assignment_id: record.assignment_id.clone(),
            reservation_id: record.reservation_id.clone(),
            ticket: record.ticket.clone(),
            player_id: record.player_id.clone(),
            expires_at: record.expires_at,
        }
    }
}

fn field_name_output(kind: FinalKind) -> &'static str {
    match kind {
        FinalKind::Settlement => "settlementId",
        FinalKind::Cancellation => "cancelId",
        FinalKind::Rejection => "rejectionId",
    }
}

fn final_message_for(
    config: &WorkerConfig,
    record: &BattleRecord,
    final_record: &FinalRecord,
) -> OutboundMessage {
    let (action, extras) = match final_record.kind {
        FinalKind::Settlement => (
            "Battle.Fleet.Settle",
            vec![
                (
                    "result",
                    final_record.payload["result"].as_str().unwrap_or_default(),
                ),
                (
                    "rounds",
                    final_record.payload["rounds"]
                        .as_u64()
                        .map(|_| "")
                        .unwrap_or_default(),
                ),
            ],
        ),
        FinalKind::Cancellation => (
            "Battle.Fleet.Cancelled",
            vec![(
                "reason",
                final_record.payload["reason"].as_str().unwrap_or_default(),
            )],
        ),
        FinalKind::Rejection => unreachable!("rejection does not have a battle record"),
    };
    let mut fields = vec![
        ("worker-id", config.worker_id.as_str()),
        ("battle-id", record.battle.id.as_str()),
        ("reservation-id", record.reservation_id.as_str()),
        ("assignment-id", record.assignment_id.as_str()),
        ("player-id", record.player_id.as_str()),
    ];
    fields.extend(extras);
    let mut message = protocol_message(
        config,
        action,
        &final_record.id,
        &final_record.payload,
        &fields,
    );
    if final_record.kind == FinalKind::Settlement {
        if let Some(rounds) = final_record.payload["rounds"].as_u64() {
            if let Some(tag) = message.tags.iter_mut().find(|tag| tag.name == "rounds") {
                tag.value = rounds.to_string();
            }
        }
    }
    message
}

fn protocol_message(
    config: &WorkerConfig,
    action: &str,
    reference: &str,
    payload: &Value,
    fields: &[(&str, &str)],
) -> OutboundMessage {
    let mut tags = vec![
        Tag {
            name: "Action".into(),
            value: action.into(),
        },
        Tag {
            name: "Protocol".into(),
            value: PROTOCOL.into(),
        },
        Tag {
            name: "Reference".into(),
            value: reference.into(),
        },
    ];
    tags.extend(fields.iter().map(|(name, value)| Tag {
        name: (*name).into(),
        value: (*value).into(),
    }));
    OutboundMessage {
        target: config.game_process.clone(),
        data: serde_json::to_string(payload).expect("payload is serializable"),
        tags,
    }
}

fn valid_id(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn canonical<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| error.to_string())
}

fn data_object<T: for<'de> Deserialize<'de>>(message: &Value) -> Result<T, String> {
    let raw = message_field(message, "data").ok_or("Data must be a JSON object")?;
    serde_json::from_str(&raw).map_err(|_| "Data must be a JSON object".into())
}

fn ci_map_get<'a>(map: &'a Map<String, Value>, wanted: &str) -> Option<&'a Value> {
    map.iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(wanted))
        .map(|(_, value)| value)
}

fn object_field<'a>(value: &'a Value, wanted: &str) -> Option<&'a Value> {
    ci_map_get(value.as_object()?, wanted)
}

fn string_field(value: &Value, wanted: &str) -> Option<String> {
    object_field(value, wanted).and_then(|value| match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    })
}

fn tags_map(value: &Value) -> Map<String, Value> {
    if let Some(object) = value.as_object() {
        return object.clone();
    }
    let mut map = Map::new();
    if let Some(tags) = value.as_array() {
        for tag in tags {
            if let (Some(name), Some(value)) =
                (string_field(tag, "name"), string_field(tag, "value"))
            {
                map.insert(name, Value::String(value));
            }
        }
    }
    map
}

fn message_field(message: &Value, wanted: &str) -> Option<String> {
    string_field(message, wanted).or_else(|| {
        let tags = object_field(message, "tags")?;
        let map = tags_map(tags);
        ci_map_get(&map, wanted)
            .and_then(Value::as_str)
            .map(str::to_owned)
    })
}

static WORKER: OnceLock<Mutex<Option<Worker>>> = OnceLock::new();
static ALLOCATIONS: OnceLock<Mutex<HashMap<usize, usize>>> = OnceLock::new();
static LAST_RESPONSE: OnceLock<Mutex<Option<usize>>> = OnceLock::new();

fn worker_cell() -> &'static Mutex<Option<Worker>> {
    WORKER.get_or_init(|| Mutex::new(None))
}
fn allocations() -> &'static Mutex<HashMap<usize, usize>> {
    ALLOCATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn last_response() -> &'static Mutex<Option<usize>> {
    LAST_RESPONSE.get_or_init(|| Mutex::new(None))
}

fn json_error(message: impl Into<String>) -> Value {
    let effect = Effect::error(message);
    serde_json::to_value(Envelope {
        ok: true,
        response: ProcessResponse {
            output: Output {
                data: serde_json::to_string(&effect.output).expect("error is serializable"),
            },
            messages: Vec::new(),
            spawns: Vec::new(),
            patches: Vec::new(),
        },
    })
    .expect("error envelope is serializable")
}

pub fn handle_json(message_json: &str, env_json: &str) -> String {
    let message: Value = match serde_json::from_str(message_json) {
        Ok(value) => value,
        Err(error) => return json_error(format!("Message JSON is invalid: {error}")).to_string(),
    };
    let env: Value = match serde_json::from_str(env_json) {
        Ok(value) => value,
        Err(error) => {
            return json_error(format!("Environment JSON is invalid: {error}")).to_string()
        }
    };
    let mut guard = match worker_cell().lock() {
        Ok(guard) => guard,
        Err(_) => return json_error("Worker state lock is poisoned").to_string(),
    };
    if guard.is_none() {
        match Worker::from_env(&env) {
            Ok(worker) => *guard = Some(worker),
            Err(error) => return json_error(error).to_string(),
        }
    } else if let Ok(config) = WorkerConfig::from_env(&env) {
        if guard.as_ref().is_some_and(|worker| worker.config != config) {
            return json_error("Immutable Process configuration changed").to_string();
        }
    }
    guard
        .as_mut()
        .expect("worker initialized")
        .handle_value(&message)
        .to_string()
}

fn allocate_bytes(mut bytes: Vec<u8>) -> *mut u8 {
    // CAPACITY, not length. `Vec::from_raw_parts` deallocates against the
    // capacity it is handed, so the registry has to carry the number the
    // allocation was actually made with. `malloc` is the case where the two
    // agree; a response buffer is the case where they do not, because
    // `String::into_bytes` keeps the string's grown capacity and the trailing
    // NUL `push` can reallocate again. Recording the length freed the previous
    // response against the wrong layout on the SECOND `handle` call, which the
    // allocator answers by aborting -- a `unreachable` trap on a module whose
    // first call looked perfect.
    let capacity = bytes.capacity();
    let pointer = bytes.as_mut_ptr();
    std::mem::forget(bytes);
    if let Ok(mut values) = allocations().lock() {
        values.insert(pointer as usize, capacity);
    }
    pointer
}

#[no_mangle]
pub extern "C" fn malloc(size: usize) -> *mut u8 {
    if size == 0 {
        return std::ptr::null_mut();
    }
    allocate_bytes(vec![0; size])
}

/// # Safety
///
/// `message_ptr` and `env_ptr` must each point to a readable NUL-terminated
/// UTF-8 JSON string allocated in this module's linear memory.
#[no_mangle]
pub unsafe extern "C" fn handle(message_ptr: *const c_char, env_ptr: *const c_char) -> *const u8 {
    // JSON-Iface keeps the returned pointer only until the next invocation and
    // does not call free on it. Reclaim it here so one response is the strict
    // upper bound on output-buffer retention.
    if let Ok(mut last) = last_response().lock() {
        if let Some(pointer) = last.take() {
            release_allocation(pointer as *mut u8);
        }
    }
    let output = if message_ptr.is_null() || env_ptr.is_null() {
        if !message_ptr.is_null() {
            release_allocation(message_ptr.cast_mut().cast());
        }
        if !env_ptr.is_null() {
            release_allocation(env_ptr.cast_mut().cast());
        }
        json_error("handle requires non-null message and environment pointers").to_string()
    } else {
        let message = CStr::from_ptr(message_ptr).to_string_lossy().into_owned();
        let env = CStr::from_ptr(env_ptr).to_string_lossy().into_owned();
        // FORMIX allocates both C strings through the module and does not free
        // them after handle. Native host tests may pass foreign pointers; the
        // allocation registry deliberately makes those releases no-ops.
        release_allocation(message_ptr.cast_mut().cast());
        release_allocation(env_ptr.cast_mut().cast());
        handle_json(&message, &env)
    };
    let mut bytes = output.into_bytes();
    bytes.push(0);
    let pointer = allocate_bytes(bytes);
    if let Ok(mut last) = last_response().lock() {
        *last = Some(pointer as usize);
    }
    pointer.cast_const()
}

/// # Safety
///
/// `pointer` must be null or a live pointer returned by this module's
/// `malloc`/`handle` that has not already been freed.
#[no_mangle]
pub unsafe extern "C" fn free(pointer: *mut u8) {
    if pointer.is_null() {
        return;
    }
    if let Ok(mut last) = last_response().lock() {
        if last
            .as_ref()
            .is_some_and(|value| *value == pointer as usize)
        {
            *last = None;
        }
    }
    release_allocation(pointer);
}

fn release_allocation(pointer: *mut u8) {
    let capacity = allocations()
        .lock()
        .ok()
        .and_then(|mut values| values.remove(&(pointer as usize)));
    if let Some(capacity) = capacity {
        // SAFETY: the registry only contains buffers allocated by allocate_bytes
        // and removes the entry before reconstructing it, preventing double free.
        // `u8` has no drop glue, so the reconstructed length is immaterial; the
        // capacity is what the deallocation layout is computed from.
        unsafe {
            drop(Vec::from_raw_parts(pointer, capacity, capacity));
        }
    }
}

#[cfg(test)]
mod tests;
