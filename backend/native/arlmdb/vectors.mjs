/** Known-answer vectors for the published offset index.
 *
 * GOLDEN and the first two MISSES are lifted verbatim from HyperBEAM's own
 * eunit tests in `hb_store_arlmdb.erl` (commit c0d8146). They are the reason
 * this reader can claim correctness rather than plausibility: the numbers were
 * produced by a different implementation, in a different language, against the
 * same bytes on the weave.
 *
 * The Rune Realm entries are ours. They prove the traversal works on data this
 * project actually owns, and — for the ones that miss — they are the evidence
 * for where the published snapshot ends.
 */

/** The live index: 8,560,638,056 rows over 171 GB, mapping ANS-104 data item
 * IDs to weave byte ranges. */
export const OFFSET_INDEX = '7vg2832WFsisEcBr1oBQ8ldc4EGOkjQdwW46hDvJsOs';

/** Rows the index holds, with the exact answer HyperBEAM's tests assert. */
export const GOLDEN = Object.freeze([
  {
    id: 'AAAAhyV8_NwududSxuraAj7DLWiZHDTqVKWrZglpNok',
    start: 381852134215637n,
    length: 3947n,
    source: 'hb_store_arlmdb.erl read_indexed_offset_test',
  },
  {
    id: '1QAAJqd60JFNvY3lBfIS5CFPjXteQSHMTp8cuvBJuHA',
    start: 381680833668862n,
    length: 1356n,
    source: 'hb_store_arlmdb.erl read_indexed_offset_test',
  },
]);

/** Keys that must be PROVEN misses, not errors and not guesses.
 *
 * The first is an L1 transaction: the index holds bundled data items alone, so
 * its row does not exist and the reader must say so after reading the leaf
 * where it would sit. The second is a mined LMDB file in an older container
 * format — the store refuses it at open rather than treating it as a miss. */
export const MISSES = Object.freeze([
  'b159UDeD87YEFujWBMM8bISZ8DL8Wm1jLa-Bs_LQGAw',
]);

/** A container that is NOT in this format. Opening it must fail loudly with
 * `invalid-main-flags`, never silently serve nothing. */
export const OLD_CONTAINER = 'b159UDeD87YEFujWBMM8bISZ8DL8Wm1jLa-Bs_LQGAw';

/** Rune Realm's own data items, and what the index says about each.
 *
 * `indexed: true` entries predate the snapshot and resolve. `indexed: false`
 * entries are newer than it and do not — see README, "What it cannot do yet".
 * Offsets are deliberately not asserted here: these are ours, we did not get
 * them from a second implementation, so the test only asserts presence. */
export const RUNE_REALM = Object.freeze([
  { id: 'j7NcraZUL6GZlgdPEoph12Q5rk_dydvQDecLNxYi8rI', label: 'legacynet PremPass process', indexed: true },
  { id: '3ZN5im7LNLjr8cMTXO2buhTPOfw6zz00CZqNyMWeJvs', label: 'legacynet MultiBattle process', indexed: true },
  { id: 'GhNl98tr7ZQxIJHx4YcVdGh7WkT9dD7X4kmQOipvePQ', label: 'legacynet Alter process', indexed: true },
  { id: '4J_Pc2jHxf3T0ja0oX0lNo129j8JTFYKuEtKXJgDBPk', label: 'live game process (2026-08)', indexed: false },
  { id: 'GeMni2e9upBJyDPKzPpVkT3mRuW0La1j28LBPpVXUhs', label: 'site manifest (2026-08-30)', indexed: false },
]);
