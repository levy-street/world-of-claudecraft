// mage_moon_face: the canvas paints for the mage's moon, the self-lit moon a
// mage raised opposite the sun (twin_moons_core). Its face is a warm white-gold
// disc that makes its own light (no phase, no shadow side), carved with the
// mage's sigil: an outer ring of rune notches, a staff through a small ring, a
// crown chevron above and a cupped arc below, with a dot either side. The sigil
// is an original placeholder mark until the mage's own symbol is decided.
//
// Paint-only and deterministic (no randomness at all), called once at boot by
// celestial_sprites, which owns the canvases, textures and sprites. The disc
// radius matches the natural moon's painted disc (118 of a 256 texture), so the
// two sprites share one size convention and the halo profile reuses
// moonHaloAlpha unchanged.

const TEX = 256;
const C = TEX / 2;
const R = 118;

/** Paint the mage's moon face (the disc plus its sigil) into a 256x256 canvas. */
export function paintMageMoonFace(ctx: CanvasRenderingContext2D, lowGfx = false): void {
  ctx.clearRect(0, 0, TEX, TEX);
  // Self-lit: brightest at the centre and warming toward the rim, the reverse of
  // a sunlit ball's limb darkening, so it reads as a lamp and not a second moon.
  const face = ctx.createRadialGradient(C, C, 0, C, C, R + 4);
  face.addColorStop(0, 'rgba(255, 253, 244, 1)');
  face.addColorStop(0.6, lowGfx ? 'rgba(255, 246, 214, 1)' : 'rgba(255, 241, 204, 1)');
  face.addColorStop(0.93, lowGfx ? 'rgba(250, 224, 160, 1)' : 'rgba(244, 213, 142, 1)');
  face.addColorStop(0.985, 'rgba(236, 196, 120, 0.85)');
  face.addColorStop(1, 'rgba(236, 196, 120, 0)');
  ctx.fillStyle = face;
  ctx.fillRect(0, 0, TEX, TEX);
  paintSigil(ctx);
}

/** The mage's sigil, centred on the face, in a warm amber carved into the gold. */
function paintSigil(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.translate(C, C);
  ctx.strokeStyle = 'rgba(128, 80, 18, 0.95)';
  ctx.fillStyle = 'rgba(128, 80, 18, 0.95)';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // outer ring with twelve rune notches: long ticks, short slashes and dots in turn
  ctx.lineWidth = R * 0.055;
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.84, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 12; i++) {
    ctx.save();
    ctx.rotate((i / 12) * Math.PI * 2);
    ctx.beginPath();
    if (i % 3 === 0) {
      ctx.moveTo(0, -R * 0.84);
      ctx.lineTo(0, -R * 0.7);
      ctx.stroke();
    } else if (i % 3 === 1) {
      ctx.moveTo(-R * 0.04, -R * 0.78);
      ctx.lineTo(R * 0.04, -R * 0.74);
      ctx.stroke();
    } else {
      ctx.arc(0, -R * 0.765, R * 0.04, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.lineWidth = R * 0.095;
  // the staff
  ctx.beginPath();
  ctx.moveTo(0, -R * 0.6);
  ctx.lineTo(0, R * 0.6);
  ctx.stroke();
  // the core ring
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.2, 0, Math.PI * 2);
  ctx.stroke();
  // the crown chevron
  ctx.beginPath();
  ctx.moveTo(-R * 0.42, -R * 0.22);
  ctx.lineTo(0, -R * 0.58);
  ctx.lineTo(R * 0.42, -R * 0.22);
  ctx.stroke();
  // the cupped arc
  ctx.beginPath();
  ctx.arc(0, R * 0.05, R * 0.46, Math.PI * 0.12, Math.PI * 0.88);
  ctx.stroke();
  // a dot either side
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(sx * R * 0.5, -R * 0.02, R * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Paint the mage's moon halo: the same hollow profile as the natural moon's
 * (alphaAt is celestial_sprites' moonHaloAlpha), in a warm gold rather than the
 * natural moon's cool blue.
 */
export function paintMageMoonGlow(
  ctx: CanvasRenderingContext2D,
  alphaAt: (t: number) => number,
  stops: number,
): void {
  const g = ctx.createRadialGradient(C, C, 0, C, C, C);
  for (let i = 0; i <= stops; i++) {
    const t = i / stops;
    g.addColorStop(t, `rgba(255, 228, 168, ${alphaAt(t).toFixed(4)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TEX, TEX);
}
