--- Offline state-machine tests for TEST-HyperDB.

local json = require("json")
local assertions = 0

local function check(condition, message)
  assertions = assertions + 1
  if not condition then error("FAIL: " .. message) end
end

local function decoded(base)
  return json.decode(base.results.output.data)
end

local function signed(writer, action, fields, data)
  local msg = {
    Action = action,
    Data = data or "",
    commitments = {
      sig = { committer = writer, type = "rsa-pss-sha512" },
    },
  }
  for key, value in pairs(fields or {}) do msg[key] = value end
  return { body = msg, timestamp = 1700000000000 }
end

local function run(base, writer, action, fields, data)
  return compute(base, signed(writer, action, fields, data), {})
end

function hyperdbtest()
  local alice = "ALICEaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  local bob = "BOBbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  local base = compute({}, { body = { Action = "Db.Stats" } }, {})
  local stats = decoded(base)
  check(stats.ok == true and stats.state.rows == 0, "fresh stats")
  check(type(base.hyperdb) == "string", "constant-size public summary")

  base = compute(base, { body = {
    Action = "Db.Batch", TxId = "unsigned-1", Data = "P\talpha\tone",
  } }, {})
  check(decoded(base).ok == false, "unsigned batch refused")
  check(HyperDBState.revision == 0, "unsigned batch did not mutate")

  base = run(base, alice, "Db.Batch", { TxId = "tx-1" },
    "P\talpha\tone\nP\tbeta\ttwo\nI\tcounter\t10")
  local first = decoded(base)
  check(first.ok == true and first.applied == 3, "three operations applied")
  check(first.txid == "tx-1", "receipt is correlated by transaction id")
  check(first.conflicts == 0 and first.operations == 3, "batch accounting")
  check(first.revision == 3 and first.rows == 3, "revision and row count")
  check(type(HyperDBState.rows.alpha) == "string", "row stored as one string")

  base = run(base, alice, "Db.Batch", { TxId = "tx-1" },
    "P\talpha\tthis-must-not-apply")
  local duplicate = decoded(base)
  check(duplicate.duplicate == true, "duplicate transaction recognized")
  check(HyperDBState.revision == 3, "duplicate transaction did not mutate")

  base = run(base, alice, "Db.Get", { Key = "alpha" })
  local alpha = decoded(base)
  check(alpha.found == true and alpha.value == "one", "get returns value")
  check(alpha.version == 1 and alpha.writer == alice, "get returns version and writer")

  base = run(base, bob, "Db.Batch", { TxId = "tx-2" }, "C\talpha\t1\tupdated")
  local cas = decoded(base)
  check(cas.applied == 1 and cas.conflicts == 0, "compare-and-set succeeds")
  check(cas.revision == 4, "successful compare-and-set advances revision")

  base = run(base, alice, "Db.Batch", { TxId = "tx-3" }, "C\talpha\t1\tstale")
  local stale = decoded(base)
  check(stale.applied == 0 and stale.conflicts == 1, "stale compare-and-set conflicts")
  check(stale.revision == 4, "conflict does not advance revision")

  base = run(base, bob, "Db.Batch", { TxId = "tx-4" }, "I\tcounter\t5")
  check(decoded(base).applied == 1, "increment applies")
  base = run(base, bob, "Db.Get", { Key = "counter" })
  check(decoded(base).value == "15", "increment is atomic and exact")

  local beforeInvalid = HyperDBState.revision
  base = run(base, alice, "Db.Batch", { TxId = "tx-invalid" },
    "P\tguard\tone\nNOPE\tbroken\trow")
  check(decoded(base).ok == false, "malformed batch refused")
  check(HyperDBState.revision == beforeInvalid, "malformed batch is atomic")
  base = run(base, alice, "Db.Get", { Key = "guard" })
  check(decoded(base).found == false, "validated first line was not partly applied")

  base = run(base, alice, "Db.Batch", { TxId = "tx-5" }, "D\tcounter\t1")
  check(decoded(base).conflicts == 1, "stale delete conflicts")
  base = run(base, alice, "Db.Batch", { TxId = "tx-6" }, "D\tcounter\t*")
  check(decoded(base).applied == 1, "unconditional delete applies")
  base = run(base, alice, "Db.Get", { Key = "counter" })
  check(decoded(base).found == false, "delete removed the row")

  local bulk = {}
  for i = 1, 1000 do
    bulk[i] = "P\tbulk/" .. string.format("%04d", i) .. "\tv" .. string.format("%04d", i)
  end
  base = run(base, bob, "Db.Batch", { TxId = "tx-bulk" }, table.concat(bulk, "\n"))
  local loaded = decoded(base)
  check(loaded.applied == 1000, "one message applies one thousand updates")
  check(loaded.rows == 1002, "bulk row count")

  base = run(base, bob, "Db.Get", { Key = "bulk/1000" })
  local last = decoded(base)
  check(last.value == "v1000" and last.writer == bob, "last bulk row is readable")

  for i = 1, 4100 do
    base = run(base, alice, "Db.Batch", { TxId = "ring/" .. string.format("%04d", i) },
      "P\tring/key\t" .. string.format("%d", i))
  end
  local seenCount = 0
  for _ in pairs(HyperDBState.seen) do seenCount = seenCount + 1 end
  check(seenCount == 4096, "idempotency receipts stay bounded")
  check(HyperDBState.seen["ring/0001"] == nil, "old idempotency receipt is evicted")
  check(HyperDBState.seen["ring/4100"] ~= nil, "new idempotency receipt is retained")

  return string.format("TEST-HyperDB: %d assertions passed; rows=%d revision=%d writes=%d",
    assertions, HyperDBState.rowCount, HyperDBState.revision, HyperDBState.writes)
end
