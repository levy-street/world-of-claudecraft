// The item-icon vignette: a soft radial glow over near-black, the shipped
// icon family's ground. Every shipped item icon is fully OPAQUE
// (docs/design/item-icon-art-style.md, machine-checked by
// tests/item_art_consistency.test.ts), so a rendered icon is composited over
// this rather than shipped on transparency. One definition, shared by every
// icon renderer, so the family cannot drift ground-by-ground.
export function itemIconGroundSvg(px) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"><defs><radialGradient id="g" cx="50%" cy="42%" r="62%"><stop offset="0%" stop-color="#3a3527"/><stop offset="55%" stop-color="#211d15"/><stop offset="100%" stop-color="#0d0b08"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
}
