// The live bloom pass, registered by post.ts when it builds a composer chain,
// so the palette lab can retune strength and threshold per look without a
// renderer field (PreparedBloomPass reads both every render). A rebuilt chain
// registers its new pass; a chain without bloom registers null.

export interface PaletteBloomTarget {
  strength: number;
  threshold: number;
}

let live: PaletteBloomTarget | null = null;

export function setPaletteBloomPass(pass: PaletteBloomTarget | null): void {
  live = pass;
}

export function livePaletteBloomPass(): PaletteBloomTarget | null {
  return live;
}
