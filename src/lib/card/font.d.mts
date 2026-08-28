export declare const GLYPH_W: number;
export declare const GLYPH_H: number;
export declare const TRACKING: number;
export declare function measure(text: string, scale: number): number;
export declare function lineHeight(scale: number): number;
export declare function wrap(text: string, width: number, scale: number, maxLines: number): string[] | null;
export declare function glyphRects(
  text: string, x: number, y: number, scale: number,
): [number, number, number, number][];
