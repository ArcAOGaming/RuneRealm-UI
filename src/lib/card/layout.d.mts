import type { ItemId, Monster } from '../types';

export type CardOp =
  | { op: 'image'; asset: string; dx?: number; dy?: number; sx?: number; sy?: number; sw?: number; sh?: number }
  | { op: 'rects'; rects: [number, number, number, number][]; color: [number, number, number, number] };

export interface CardOptions {
  /** Widen the card to 1065 and add the side panel: moves, status, satchel. */
  extended?: boolean;
  /** The player's satchel. Only the extended card shows it. */
  inventory?: Partial<Record<ItemId, number>>;
  /**
   * `Tuning.moveUses` — the multiplier the engine applies to every move's
   * stored `count` when a fight starts. Defaults to the engine's own 3.
   */
  moveUses?: number;
}

export interface CardPlanResult {
  width: number;
  height: number;
  ops: CardOp[];
}

export declare const CARD_W: number;
export declare const CARD_H: number;
export declare const PANEL_W: number;

export declare function cardSize(opts?: CardOptions): { width: number; height: number };
export declare function orderedMoves(monster: Partial<Monster>): { name: string; type: string }[];
export declare function cardPlan(monster: Partial<Monster>, opts?: CardOptions): CardPlanResult;
export declare function assetsFor(ops: CardOp[]): string[];
