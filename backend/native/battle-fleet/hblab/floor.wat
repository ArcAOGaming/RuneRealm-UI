;; The smallest module that satisfies the JSON-Iface C-string ABI.
;; It ignores its inputs and returns one constant envelope, so timing it on a
;; node measures the per-slot cost of the json-iface/wasm-64 stack itself:
;; instantiation, encoding the Process message in, decoding results out.
;; Whatever the real worker costs above this line is our code.
(module
  (memory (export "memory") 2)

  ;; Bump allocator over everything past the constant response. The host calls
  ;; malloc twice per slot (message, environment) and never frees, so the
  ;; pointer has to be rewound or the module walks off the end of its two pages
  ;; after a few dozen slots and the node reports
  ;; `{badmatch,{error,"Write request out of bounds"}}`. Rewinding at the END of
  ;; handle is safe and the reset must not happen at entry: the host reads the
  ;; returned pointer after handle returns, and the next slot's allocations
  ;; start above the constant, so the response is never overwritten.
  (global $next (mut i32) (i32.const 4096))

  (func (export "malloc") (param $size i32) (result i32)
    (local $at i32)
    (local.set $at (global.get $next))
    (global.set $next (i32.add (local.get $at) (local.get $size)))
    (local.get $at))

  (func (export "free") (param $ptr i32))

  (func (export "handle") (param $message i32) (param $env i32) (result i32)
    (global.set $next (i32.const 4096))
    (i32.const 16))

  (data (i32.const 16)
    "{\"ok\":true,\"response\":{\"Output\":{\"data\":\"{\\\"floor\\\":true}\"},\"Messages\":[],\"Spawns\":[],\"patches\":[]}}\00")
)
