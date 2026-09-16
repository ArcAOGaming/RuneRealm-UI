/**
 * Swarm wallet identities, as the Admin tab shows them.
 *
 * The wallet list is not written down here any more: it comes from the event
 * stream (`backend/native/swarm/stream.mjs`), so a run of any size shows every
 * wallet it actually drove and nothing else. What stays is presentation — how
 * a personality from REDESIGN.md §4.5 is labelled and how wallets are ordered.
 * Private keys never appear in browser code; they stay in `.burners/`.
 */

export const SWARM_PROFILE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  grinder: 'Grinder',
  ranked: 'Ranked',
  hunter: 'Hunter',
  merchant: 'Merchant',
  caretaker: 'Caretaker',
  collector: 'Collector',
});

export const swarmProfileLabel = (profile: string | null | undefined) => (
  profile ? SWARM_PROFILE_LABELS[profile] ?? profile : '—'
);

/** `burner-7` sorts before `burner-10`; other names fall back to alphabetical. */
export function compareSwarmWallets(a: string, b: string): number {
  const na = /(\d+)$/.exec(a);
  const nb = /(\d+)$/.exec(b);
  if (na && nb && a.slice(0, na.index) === b.slice(0, nb.index)) return Number(na[1]) - Number(nb[1]);
  return a.localeCompare(b);
}
