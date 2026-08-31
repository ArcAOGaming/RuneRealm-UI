use super::*;
use std::ffi::{CStr, CString};

const GAME: &str = "GAMEggggggggggggggggggggggggggggggggggggggg";
const WORKER_IMAGE: &str = "IMAGEiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii";
const OWNER: &str = "OWNERoooooooooooooooooooooooooooooooooooooo";
const SCHEDULER: &str = "SCHEDssssssssssssssssssssssssssssssssssssss";
const PLAYER: &str = "PLAYERppppppppppppppppppppppppppppppppppppp";
const ATTACKER: &str = "EVILxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

fn env() -> Value {
    json!({
        "Process": {
            "Owner": OWNER,
            "scheduler-location": SCHEDULER,
            "Image": WORKER_IMAGE,
            "Tags": [
                {"name":"battle-protocol","value":PROTOCOL},
                {"name":"battle-runtime","value":"rust-wasm@1"},
                {"name":"battle-abi","value":ABI},
                {"name":"battle-clock-mode","value":"trusted-game-clock-v1"},
                {"name":"battle-enabled","value":"true"},
                {"name":"battle-game-process","value":GAME},
                {"name":"battle-worker-id","value":"worker-01"},
                {"name":"battle-worker-capacity","value":"2"},
                {"name":"battle-worker-retained","value":"2"},
                {"name":"battle-worker-pending","value":"2"},
                {"name":"battle-worker-ticket-ttl","value":"600000"},
                {"name":"battle-worker-outcomes","value":"20"},
                {"name":"battle-worker-confirmations","value":"20"}
            ]
        }
    })
}

fn player_monster() -> Monster {
    Monster {
        name: "FireFox".into(),
        image: Some("image".into()),
        sprite: Some("sprite".into()),
        faction: Some("Inferno Blades".into()),
        element_type: "fire".into(),
        level: 3,
        attack: 5,
        defense: 3,
        speed: 4,
        health: 5,
        moves: BTreeMap::from([
            ("Firenado".into(), battle::StoredMove { count: 2 }),
            ("Inferno".into(), battle::StoredMove { count: 1 }),
            ("Heal".into(), battle::StoredMove { count: 2 }),
            ("Quick Jab".into(), battle::StoredMove { count: 3 }),
        ]),
    }
}

fn open_payload(index: usize, issued_at: i64) -> OpenPayload {
    OpenPayload {
        protocol: PROTOCOL.into(),
        battle_id: format!("battle-{index}"),
        ticket: format!("ticket-{index}"),
        reservation_id: format!("reservation-{index}"),
        assignment_id: format!("assignment-{index}"),
        player_id: PLAYER.into(),
        issued_at,
        expires_at: issued_at + 600_000,
        monster: player_monster(),
        difficulty: 1.0,
        opponent_faction: Some("Aqua Guardians".into()),
        reward_plan: json!({"win":{"exp":3},"loss":{"exp":1}}),
    }
}

fn tags(values: &[(&str, String)]) -> Value {
    Value::Array(
        values
            .iter()
            .map(|(name, value)| json!({"name":name,"value":value}))
            .collect(),
    )
}

fn game_message(action: &str, timestamp: i64) -> Value {
    json!({
        "Owner": SCHEDULER, "From": GAME,
        "Tags": tags(&[
            ("Action", action.into()),
            ("Authority-Timestamp", timestamp.to_string()),
        ])
    })
}

fn open_message(payload: &OpenPayload) -> Value {
    let mut message = game_message("Battle.Open", payload.issued_at);
    message.as_object_mut().unwrap().insert(
        "Data".into(),
        Value::String(serde_json::to_string(payload).unwrap()),
    );
    message
}

fn signed_message(action: &str, owner: &str, values: &[(&str, String)]) -> Value {
    let mut all = vec![("Action", action.into())];
    all.extend_from_slice(values);
    json!({"Owner":owner,"From":owner,"Tags":tags(&all)})
}

fn output(envelope: &Value) -> Value {
    serde_json::from_str(envelope["response"]["Output"]["data"].as_str().unwrap()).unwrap()
}

fn action(message: &Value) -> Option<&str> {
    message["Tags"]
        .as_array()?
        .iter()
        .find(|tag| tag["name"] == "Action")?["value"]
        .as_str()
}

fn tag<'a>(message: &'a Value, wanted: &str) -> Option<&'a str> {
    message["Tags"].as_array()?.iter().find(|tag| {
        tag["name"]
            .as_str()
            .is_some_and(|name| name.eq_ignore_ascii_case(wanted))
    })?["value"]
        .as_str()
}

/// The outbox proper: `Messages` carries the state patch as a trailing
/// PATCH-tagged entry (see `ProcessResponse`), and `dev_patch` lifts that entry
/// out before anything is pushed. Every assertion about what the worker SENDS
/// means this list.
fn response_messages(envelope: &Value) -> Vec<&Value> {
    envelope["response"]["Messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|message| tag(message, "method") != Some("PATCH"))
        .collect()
}

/// The trailing PATCH entry `dev_patch` consumes from `results/outbox`.
fn outbox_patch(envelope: &Value) -> &Value {
    let messages = envelope["response"]["Messages"].as_array().unwrap();
    let patch = messages.last().expect("every reply publishes a patch");
    assert_eq!(
        tag(patch, "method"),
        Some("PATCH"),
        "the patch must be the LAST outbox entry, so real messages keep keys 1..N"
    );
    patch
}

fn authority_tags(action: &str, timestamp: i64, values: &[(&str, String)]) -> Value {
    let mut message = game_message(action, timestamp);
    let existing = message["Tags"].as_array_mut().unwrap();
    existing.extend(
        values
            .iter()
            .map(|(name, value)| json!({"name":name,"value":value})),
    );
    message
}

#[test]
fn config_is_strict_and_status_binds_image_abi_and_clock() {
    let config = WorkerConfig::from_env(&env()).unwrap();
    assert_eq!(config.game_process, GAME);
    assert_eq!(config.owner, OWNER);
    assert_eq!(config.scheduler, SCHEDULER);
    assert_eq!(config.image_id, WORKER_IMAGE);
    let mut worker = Worker::from_env(&env()).unwrap();
    let status =
        output(&worker.handle_value(&json!({"Tags":[{"name":"Action","value":"Fleet.Status"}]})));
    assert_eq!(status["protocol"], PROTOCOL);
    assert_eq!(status["runtime"], "rust-wasm@1");
    assert_eq!(status["abi"], ABI);
    assert_eq!(status["imageId"], WORKER_IMAGE);
    assert_eq!(status["clockMode"], "trusted-game-clock-v1");
    assert_eq!(status["lifecycle"], "ready");
    assert_eq!(status["availableSlots"], 2);
}

/// The Process message exactly as `dev_json_iface:message_to_json_struct/2`
/// builds it on a live node: nine fixed top-level keys, and every other field
/// of the process -- `scheduler-location` and `image` among them -- flattened
/// into `Tags` in HTTP header case. `env()` above is the hand-written shape and
/// passes either way; this is the one that caught the worker reading
/// `Process.scheduler-location` as a field and answering
/// `{"error":"Process scheduler is required"}` on hyperbeam.tylerw.ai.
fn node_shaped_env() -> Value {
    json!({
        "Process": {
            "Id": "PROCESSppppppppppppppppppppppppppppppppppp",
            "Anchor": "",
            "Owner": OWNER,
            "From": OWNER,
            "Target": "",
            "Data": Value::Null,
            "Signature": "",
            "PublicKey": "",
            "Tags": [
                {"name":"Scheduler-Location","value":SCHEDULER},
                {"name":"Scheduler","value":SCHEDULER},
                {"name":"Image","value":WORKER_IMAGE},
                {"name":"Execution-Device","value":"stack@1.0"},
                {"name":"Battle-Protocol","value":PROTOCOL},
                {"name":"Battle-Runtime","value":"rust-wasm@1"},
                {"name":"Battle-Abi","value":ABI},
                {"name":"Battle-Clock-Mode","value":"trusted-game-clock-v1"},
                {"name":"Battle-Enabled","value":"true"},
                {"name":"Battle-Game-Process","value":GAME},
                {"name":"Battle-Worker-Id","value":"worker-01"},
                {"name":"Battle-Worker-Capacity","value":"2"},
                {"name":"Battle-Worker-Retained","value":"2"},
                {"name":"Battle-Worker-Pending","value":"2"},
                {"name":"Battle-Worker-Ticket-Ttl","value":"600000"},
                {"name":"Battle-Worker-Outcomes","value":"20"},
                {"name":"Battle-Worker-Confirmations","value":"20"}
            ]
        }
    })
}

#[test]
fn config_reads_scheduler_and_image_from_json_iface_tags() {
    let config = WorkerConfig::from_env(&node_shaped_env()).unwrap();
    assert_eq!(config.owner, OWNER);
    assert_eq!(config.scheduler, SCHEDULER);
    assert_eq!(config.image_id, WORKER_IMAGE);
    let mut worker = Worker::from_env(&node_shaped_env()).unwrap();
    let reply = worker.handle_value(&json!({"Tags":[{"name":"Action","value":"Fleet.Status"}]}));
    let status = output(&reply);
    assert_eq!(status["imageId"], WORKER_IMAGE);
    assert_eq!(status["lifecycle"], "ready");
    // A publish `dev_patch` can actually consume: a PATCH entry in the outbox,
    // which `json_to_message` turns into a numbered map. The `patches` list it
    // also emits is folded with `maps:fold/3` and crashes the process.
    let patch = outbox_patch(&reply);
    assert!(tag(patch, "fleetstatus").is_some());
    assert!(response_messages(&reply).is_empty(), "a status read sends nothing");
}

#[test]
fn process_auth_requires_scheduler_owner_game_from_and_clock() {
    let mut worker = Worker::from_env(&env()).unwrap();
    let payload = open_payload(1, 1_000);
    let mut forged = open_message(&payload);
    forged["Owner"] = Value::String(ATTACKER.into());
    assert!(output(&worker.handle_value(&forged))["error"]
        .as_str()
        .unwrap()
        .contains("scheduler-attested"));
    let mut wrong_from = open_message(&payload);
    wrong_from["From"] = Value::String(ATTACKER.into());
    assert!(output(&worker.handle_value(&wrong_from))["error"]
        .as_str()
        .unwrap()
        .contains("scheduler-attested"));
    let mut no_clock = open_message(&payload);
    no_clock["Tags"]
        .as_array_mut()
        .unwrap()
        .retain(|tag| tag["name"] != "Authority-Timestamp");
    assert!(output(&worker.handle_value(&no_clock))["error"]
        .as_str()
        .unwrap()
        .contains("Authority-Timestamp"));
    let mut wrong_clock = open_message(&payload);
    tag_set(&mut wrong_clock, "Authority-Timestamp", "999");
    assert!(output(&worker.handle_value(&wrong_clock))["error"]
        .as_str()
        .unwrap()
        .contains("must equal issuedAt"));
    assert!(worker.battles.is_empty());
}

fn tag_set(message: &mut Value, wanted: &str, value: &str) {
    let tag = message["Tags"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|tag| {
            tag["name"]
                .as_str()
                .is_some_and(|name| name.eq_ignore_ascii_case(wanted))
        })
        .unwrap();
    tag["value"] = Value::String(value.into());
}

#[test]
fn open_attack_settle_and_confirmation_chain_are_idempotent() {
    let mut worker = Worker::from_env(&env()).unwrap();
    let payload = open_payload(1, 10_000);
    let opened = worker.handle_value(&open_message(&payload));
    assert_eq!(
        action(response_messages(&opened)[0]),
        Some("Battle.Fleet.Opened")
    );
    assert_eq!(output(&opened)["id"], "battle-1");
    assert_eq!(worker.status().active, 1);

    let duplicate = worker.handle_value(&open_message(&payload));
    assert_eq!(output(&duplicate)["duplicate"], true);
    assert_eq!(
        response_messages(&duplicate)[0]["Data"],
        response_messages(&opened)[0]["Data"]
    );

    let mut terminal_message = None;
    let mut terminal = None;
    for index in 0..battle::ROUND_CAP {
        if worker.battles["battle-1"].battle.status == "ended" {
            break;
        }
        let record = &worker.battles["battle-1"];
        let move_name = record
            .battle
            .challenger
            .moves
            .iter()
            .find(|(_, value)| value.count > 0)
            .map_or("struggle", |(name, _)| name.as_str())
            .to_owned();
        let attack = signed_message(
            "Battle.Attack",
            PLAYER,
            &[
                ("BattleId", "battle-1".into()),
                ("Ticket", "ticket-1".into()),
                ("ActionId", format!("attack-{index}")),
                ("Round", record.battle.round.to_string()),
                ("Move", move_name),
            ],
        );
        let result = worker.handle_value(&attack);
        if output(&result)["status"] == "ended" {
            terminal_message = Some(attack);
            terminal = Some(result);
        } else {
            assert!(response_messages(&result).is_empty());
        }
    }
    let terminal = terminal.expect("battle reaches bounded terminal state");
    assert_eq!(
        action(response_messages(&terminal)[0]),
        Some("Battle.Fleet.Settle")
    );
    let settlement_id = tag(response_messages(&terminal)[0], "Reference")
        .unwrap()
        .to_owned();
    let settlement_retry = signed_message(
        "Fleet.Settlement.Retry",
        OWNER,
        &[("SettlementId", settlement_id.clone())],
    );
    let retried_terminal = worker.handle_value(&settlement_retry);
    assert_eq!(
        response_messages(&retried_terminal)[0]["Data"],
        response_messages(&terminal)[0]["Data"]
    );
    let clock_before_replay = worker.high_water_timestamp;
    let mut replay = terminal_message.unwrap();
    replay["Timestamp"] = json!(i64::MAX);
    let replayed = worker.handle_value(&replay);
    assert_eq!(output(&replayed)["duplicate"], true);
    assert!(response_messages(&replayed).is_empty());
    assert_eq!(
        worker.high_water_timestamp, clock_before_replay,
        "player input cannot advance trusted clock"
    );

    let ack = authority_tags(
        "Fleet.Settlement.Ack",
        20_000,
        &[("SettlementId", settlement_id.clone())],
    );
    let acked = worker.handle_value(&ack);
    assert_eq!(output(&acked)["acknowledged"], true);
    assert_eq!(output(&acked)["duplicate"], false);
    assert_eq!(
        action(response_messages(&acked)[0]),
        Some("Battle.Fleet.FinalAcked")
    );
    let confirmation_data = response_messages(&acked)[0]["Data"].clone();
    let confirmation_id = tag(response_messages(&acked)[0], "Reference")
        .unwrap()
        .to_owned();
    let confirmation_retry = signed_message(
        "Fleet.FinalAcked.Retry",
        OWNER,
        &[("ConfirmationId", confirmation_id.clone())],
    );
    let retried_confirmation = worker.handle_value(&confirmation_retry);
    assert_eq!(
        response_messages(&retried_confirmation)[0]["Data"],
        confirmation_data
    );
    let acked_again = worker.handle_value(&ack);
    assert_eq!(output(&acked_again)["duplicate"], true);
    assert_eq!(
        response_messages(&acked_again)[0]["Data"],
        confirmation_data
    );

    let release = authority_tags(
        "Fleet.FinalAcked.Release",
        21_000,
        &[("ConfirmationId", confirmation_id.clone())],
    );
    let released = worker.handle_value(&release);
    assert_eq!(output(&released)["released"], true);
    assert_eq!(output(&released)["duplicate"], false);
    let released_again = worker.handle_value(&release);
    assert_eq!(output(&released_again)["duplicate"], true);
    assert_eq!(worker.status().pending_confirmations, 0);
    assert_eq!(worker.status().available_slots, 2);

    let after_window = authority_tags(
        "Fleet.FinalAcked.Release",
        700_001,
        &[("ConfirmationId", confirmation_id)],
    );
    assert_eq!(
        output(&worker.handle_value(&after_window))["error"],
        "Final acknowledgement confirmation not found"
    );
    assert_eq!(worker.status().retained_confirmations, 0);
}

#[test]
fn drain_rejection_retry_ack_and_release_are_stable() {
    let mut worker = Worker::from_env(&env()).unwrap();
    let drain = signed_message("Fleet.Drain", OWNER, &[("Drain", "true".into())]);
    assert_eq!(output(&worker.handle_value(&drain))["draining"], true);
    let payload = open_payload(2, 5_000);
    let rejected = worker.handle_value(&open_message(&payload));
    assert_eq!(output(&rejected)["error"], "Worker is draining");
    assert_eq!(
        action(response_messages(&rejected)[0]),
        Some("Battle.Fleet.OpenRejected")
    );
    let rejection_id = tag(response_messages(&rejected)[0], "Reference")
        .unwrap()
        .to_owned();
    let retry = signed_message(
        "Fleet.OpenRejected.Retry",
        OWNER,
        &[("RejectionId", rejection_id.clone())],
    );
    let retried = worker.handle_value(&retry);
    assert_eq!(
        response_messages(&retried)[0]["Data"],
        response_messages(&rejected)[0]["Data"]
    );
    let ack = authority_tags(
        "Fleet.OpenRejected.Ack",
        6_000,
        &[("RejectionId", rejection_id)],
    );
    let acked = worker.handle_value(&ack);
    assert_eq!(
        action(response_messages(&acked)[0]),
        Some("Battle.Fleet.FinalAcked")
    );
    assert_eq!(
        tag(response_messages(&acked)[0], "kind"),
        Some("rejection")
    );
    let confirmation_id = tag(response_messages(&acked)[0], "Reference")
        .unwrap()
        .to_owned();
    let release = authority_tags(
        "Fleet.FinalAcked.Release",
        7_000,
        &[("ConfirmationId", confirmation_id)],
    );
    assert_eq!(output(&worker.handle_value(&release))["released"], true);
    assert_eq!(worker.status().pending_deliveries, 0);
}

#[test]
fn cancel_and_expire_release_capacity_with_stable_receipts() {
    let mut worker = Worker::from_env(&env()).unwrap();
    let first = open_payload(3, 100_000);
    worker.handle_value(&open_message(&first));
    let cancel = authority_tags(
        "Battle.Cancel",
        110_000,
        &[
            ("BattleId", first.battle_id.clone()),
            ("ReservationId", first.reservation_id.clone()),
            ("Ticket", first.ticket.clone()),
            ("CancelId", "cancel-3".into()),
            ("Reason", "player-left".into()),
        ],
    );
    let cancelled = worker.handle_value(&cancel);
    assert_eq!(
        action(response_messages(&cancelled)[0]),
        Some("Battle.Fleet.Cancelled")
    );
    assert!(serde_json::from_str::<Value>(
        response_messages(&cancelled)[0]["Data"].as_str().unwrap()
    )
    .unwrap()["openedId"]
        .is_string());
    let replay = worker.handle_value(&cancel);
    assert_eq!(output(&replay)["duplicate"], true);
    assert_eq!(
        response_messages(&replay)[0]["Data"],
        response_messages(&cancelled)[0]["Data"]
    );
    assert_eq!(worker.status().available_slots, 2);
    let cancellation_retry = signed_message(
        "Fleet.Cancellation.Retry",
        OWNER,
        &[("CancelId", "cancel-3".into())],
    );
    assert_eq!(
        response_messages(&worker.handle_value(&cancellation_retry))[0]["Data"],
        response_messages(&cancelled)[0]["Data"],
    );
    let cancellation_ack = authority_tags(
        "Fleet.Cancellation.Ack",
        111_000,
        &[("CancelId", "cancel-3".into())],
    );
    let cancellation_acked = worker.handle_value(&cancellation_ack);
    assert_eq!(
        action(response_messages(&cancellation_acked)[0]),
        Some("Battle.Fleet.FinalAcked")
    );
    assert_eq!(
        tag(response_messages(&cancellation_acked)[0], "kind"),
        Some("cancellation")
    );
    let confirmation_id = tag(response_messages(&cancellation_acked)[0], "Reference")
        .unwrap()
        .to_owned();
    let after_ack_cancel = worker.handle_value(&cancel);
    assert_eq!(output(&after_ack_cancel)["duplicate"], true);
    assert!(response_messages(&after_ack_cancel).is_empty());
    let cancellation_release = authority_tags(
        "Fleet.FinalAcked.Release",
        112_000,
        &[("ConfirmationId", confirmation_id)],
    );
    assert_eq!(
        output(&worker.handle_value(&cancellation_release))["released"],
        true
    );

    let second = open_payload(4, 200_000);
    worker.handle_value(&open_message(&second));
    let early_expire = authority_tags(
        "Battle.Expire",
        200_001,
        &[
            ("BattleId", second.battle_id.clone()),
            ("ReservationId", second.reservation_id.clone()),
            ("Ticket", second.ticket.clone()),
            ("CancelId", "expire-4".into()),
        ],
    );
    assert_eq!(
        output(&worker.handle_value(&early_expire))["error"],
        "Battle reservation has not expired"
    );
    let expire = authority_tags(
        "Battle.Expire",
        800_001,
        &[
            ("BattleId", second.battle_id),
            ("ReservationId", second.reservation_id),
            ("Ticket", second.ticket),
            ("CancelId", "expire-4".into()),
        ],
    );
    let expired = worker.handle_value(&expire);
    assert_eq!(
        action(response_messages(&expired)[0]),
        Some("Battle.Fleet.Cancelled")
    );
    assert_eq!(worker.status().active, 0);
}

#[test]
fn pre_open_cancel_recovery_never_publishes_opened() {
    let mut worker = Worker::from_env(&env()).unwrap();
    let payload = open_payload(5, 300_000);
    let mut message = open_message(&payload);
    message["Tags"].as_array_mut().unwrap().extend([
        json!({"name":"cancel-id","value":"cancel-before-open"}),
        json!({"name":"cancel-reason","value":"player-left"}),
    ]);
    let cancelled = worker.handle_value(&message);
    assert_eq!(output(&cancelled)["preOpen"], true);
    assert_eq!(
        action(response_messages(&cancelled)[0]),
        Some("Battle.Fleet.Cancelled")
    );
    let data: Value =
        serde_json::from_str(response_messages(&cancelled)[0]["Data"].as_str().unwrap()).unwrap();
    assert!(data.get("openedId").is_none());
    let duplicate = worker.handle_value(&message);
    assert_eq!(output(&duplicate)["duplicate"], true);
    assert_eq!(
        response_messages(&duplicate)[0]["Data"],
        response_messages(&cancelled)[0]["Data"]
    );
}

#[test]
fn patches_use_json_iface_tag_maps_only() {
    let mut worker = Worker::from_env(&env()).unwrap();
    let response = worker.handle_value(&open_message(&open_payload(6, 400_000)));
    assert_eq!(response["ok"], true);
    assert!(response.get("Output").is_none());
    let patches = response["response"]["patches"].as_array().unwrap();
    assert_eq!(patches.len(), 1);
    assert_eq!(
        patches[0].as_object().unwrap().keys().collect::<Vec<_>>(),
        vec!["Tags"]
    );
    let patch_tags = patches[0]["Tags"].as_array().unwrap();
    assert!(patch_tags
        .iter()
        .any(|tag| tag["name"] == "method" && tag["value"] == "PATCH"));
    assert!(patch_tags.iter().any(|tag| tag["name"] == "fleetstatus"));
    assert!(patch_tags
        .iter()
        .any(|tag| tag["name"] == "battle-battle-6"));
}

#[test]
fn c_string_abi_returns_nested_envelope_and_pointer_only_free() {
    let message =
        CString::new(json!({"Tags":[{"name":"Action","value":"Fleet.Status"}]}).to_string())
            .unwrap();
    let environment = CString::new(env().to_string()).unwrap();
    let first_pointer = unsafe { handle(message.as_ptr(), environment.as_ptr()) };
    assert!(!first_pointer.is_null());
    let text = unsafe { CStr::from_ptr(first_pointer.cast()) }
        .to_str()
        .unwrap();
    let value: Value = serde_json::from_str(text).unwrap();
    assert_eq!(value["ok"], true);
    assert_eq!(output(&value)["abi"], ABI);
    let message_bytes = message.as_bytes_with_nul();
    let env_bytes = environment.as_bytes_with_nul();
    let owned_message = malloc(message_bytes.len());
    let owned_env = malloc(env_bytes.len());
    unsafe {
        std::ptr::copy_nonoverlapping(message_bytes.as_ptr(), owned_message, message_bytes.len());
        std::ptr::copy_nonoverlapping(env_bytes.as_ptr(), owned_env, env_bytes.len());
    }
    assert!(allocations()
        .lock()
        .unwrap()
        .contains_key(&(owned_message as usize)));
    let second_pointer = unsafe { handle(owned_message.cast(), owned_env.cast()) };
    assert!(!second_pointer.is_null());
    assert!(
        !allocations()
            .lock()
            .unwrap()
            .contains_key(&(first_pointer as usize)),
        "next handle must reclaim JSON-Iface's prior unfreed result"
    );
    assert!(
        !allocations()
            .lock()
            .unwrap()
            .contains_key(&(owned_message as usize)),
        "handle must consume JSON-Iface's malloc'd message input"
    );
    assert!(
        !allocations()
            .lock()
            .unwrap()
            .contains_key(&(owned_env as usize)),
        "handle must consume JSON-Iface's malloc'd environment input"
    );
    unsafe {
        free(second_pointer.cast_mut());
    }
}
