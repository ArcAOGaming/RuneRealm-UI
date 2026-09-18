/**
 * One colour per process group, used for its card, its chart series and the
 * wallet activity it serves, so the same hue means the same thing everywhere
 * on the page.
 *
 * Categorical slots, dark steps by default because the app is dark; light steps
 * when a light theme is stamped. Both sets pass the palette validator (adjacent
 * CVD ΔE ≥ 8.4, contrast ≥ 3:1 on `--surface`).
 */
import { GROUPS, OTHER_GROUP, activityOf, type ActivityDef } from './model';

export const PALETTE_CSS = `
.swarm-monitor {
  --sw-1: 57 135 229; --sw-2: 217 89 38; --sw-3: 25 158 112; --sw-4: 201 133 0;
  --sw-5: 213 81 129; --sw-6: 0 131 0; --sw-7: 144 133 233; --sw-8: 230 103 103;
}
:root[data-theme="light"] .swarm-monitor {
  --sw-1: 42 120 214; --sw-2: 235 104 52; --sw-3: 27 175 122; --sw-4: 237 161 0;
  --sw-5: 232 123 164; --sw-6: 0 131 0; --sw-7: 74 58 167; --sw-8: 227 73 72;
}
`;

export const swColor = (slot: number) => `rgb(var(--sw-${slot}))`;

/** A group's colour; admin has none of its own. */
export const groupColor = (id: string) => {
  const group = GROUPS.find((entry) => entry.id === id) ?? (id === OTHER_GROUP.id ? OTHER_GROUP : null);
  return group && group.slot > 0 ? swColor(group.slot) : 'rgb(var(--muted))';
};

/** Activities that drive a group wear its colour; idle ones stay neutral and quiet. */
const NEUTRAL: Record<string, string> = {
  home: 'rgb(var(--muted) / 0.6)',
  waiting: 'rgb(var(--edge))',
  unreported: 'rgb(var(--raised))',
};

export const activityColor = (activity: ActivityDef) => (
  activity.group ? groupColor(activity.group) : NEUTRAL[activity.id] ?? 'rgb(var(--edge))'
);

const NEUTRAL_VAR: Record<string, string> = { home: '--muted', waiting: '--edge', unreported: '--edge' };

/** An activity's colour at `alpha`, for a tile's wash and border. */
export function activityTint(activity: ActivityDef, alpha: number) {
  const group = activity.group ? GROUPS.find((entry) => entry.id === activity.group) : null;
  const variable = group && group.slot > 0 ? `--sw-${group.slot}` : NEUTRAL_VAR[activity.id] ?? '--edge';
  return `rgb(var(${variable}) / ${alpha})`;
}

export const stateColor = (state: string | null | undefined) => activityColor(activityOf(state));
