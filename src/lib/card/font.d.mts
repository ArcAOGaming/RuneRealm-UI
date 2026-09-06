export declare const GLYPH_W: number;
export declare const GLYPH_H: number;
export declare const TRACKING: number;
export interface Face { glyphs: Record<string, number[]>; width: number; tracking: number }
export declare const FACES: { wide: Face; slim: Face };
/** A uniform scale, or separate axes with an optional stroke widening. */
export type Scale = number | { x: number; y?: number; bold?: number; track?: number };
export declare function measure(text: string, scale: Scale, face?: Face): number;
export declare function lineHeight(scale: Scale): number;
export declare function wrap(
  text: string, width: number, scale: Scale, maxLines: number, face?: Face,
): string[] | null;
export declare function glyphRects(
  text: string, x: number, y: number, scale: Scale, face?: Face,
): [number, number, number, number][];
