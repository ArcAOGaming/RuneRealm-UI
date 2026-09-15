export declare const ICON_W: number;
export declare const ICON_H: number;
export declare function moveIcon(
  name: string,
): { asset: string; sw: number; sh: number } | null;
export declare function allMovePlates(): string[];
export declare function allMoveSourceCrops(): Array<{
  file: string; sx: number; sy: number; sw: number; sh: number;
}>;
