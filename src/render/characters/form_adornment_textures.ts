// The canvas art of the shapeshift form adornments (form_adornment_core.ts):
// Moonwing's wing and crescent. Painted once
// per session by the adornment kits that own them (never per rig), in white or
// in alpha only, so the kit's material colour does the tinting and one texture
// serves every rig.
//
// Where no document exists (the Node test host) each texture is a 1x1 white
// DataTexture instead: it still carries `map` into the program key, so a
// headless stand-in links the same program the browser draw does (the
// coach_trail_materials.ts idiom).
import * as THREE from 'three';

function paintedTexture(
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D) => void,
): THREE.Texture {
  if (typeof document === 'undefined') {
    const data = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    data.needsUpdate = true;
    return data;
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) paint(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Where each flight feather ends along the wing's trailing edge, as uv
 *  fractions of the canvas (x right, y down), tip of the wing first. */
const WING_FEATHER_TIPS: readonly (readonly [number, number])[] = [
  [0.97, 0.1],
  [0.95, 0.3],
  [0.87, 0.48],
  [0.75, 0.63],
  [0.6, 0.75],
  [0.44, 0.84],
  [0.27, 0.91],
];

/** A whole right wing, root at the bottom-left corner (uv 0.06, 0.06) and the
 *  wing sweeping up and out: an arched leading edge, a scalloped trailing edge
 *  of feather tips, feather lines fanning from the root and a glowing rim. The
 *  left wing mirrors the same texture. */
export function wingTexture(): THREE.Texture {
  const s = 256;
  return paintedTexture(s, s, (ctx) => {
    const root: readonly [number, number] = [0.06 * s, 0.94 * s];
    const tips = WING_FEATHER_TIPS.map(([x, y]) => [x * s, y * s] as const);
    const outline = (): void => {
      ctx.beginPath();
      ctx.moveTo(root[0], root[1]);
      ctx.bezierCurveTo(0.1 * s, 0.4 * s, 0.45 * s, 0.06 * s, tips[0][0], tips[0][1]);
      for (let i = 1; i < tips.length; i++) {
        // Each scallop bows in toward the root, so every tip reads as a feather.
        const [ax, ay] = tips[i - 1];
        const [bx, by] = tips[i];
        const cx = (ax + bx) / 2 + (root[0] - (ax + bx) / 2) * 0.14;
        const cy = (ay + by) / 2 + (root[1] - (ay + by) / 2) * 0.14;
        ctx.quadraticCurveTo(cx, cy, bx, by);
      }
      ctx.quadraticCurveTo(0.14 * s, 0.97 * s, root[0], root[1]);
      ctx.closePath();
    };
    const body = ctx.createRadialGradient(root[0], root[1], 0, root[0], root[1], s * 1.05);
    body.addColorStop(0, 'rgba(255,255,255,0.2)');
    body.addColorStop(0.55, 'rgba(255,255,255,0.42)');
    body.addColorStop(1, 'rgba(255,255,255,0.7)');
    outline();
    ctx.fillStyle = body;
    ctx.fill();
    ctx.save();
    outline();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    for (const [tx, ty] of tips) {
      ctx.beginPath();
      ctx.moveTo(root[0] + 0.04 * s, root[1] - 0.04 * s);
      ctx.lineTo(tx - (tx - root[0]) * 0.06, ty - (ty - root[1]) * 0.06);
      ctx.stroke();
    }
    ctx.restore();
    ctx.shadowColor = 'rgba(255,255,255,1)';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    outline();
    ctx.stroke();
  });
}

/** A waxing crescent with a soft halo around it. */
export function crescentTexture(): THREE.Texture {
  const s = 128;
  return paintedTexture(s, s, (ctx) => {
    const c = s / 2;
    const glow = ctx.createRadialGradient(c, c, s * 0.18, c, c, c);
    glow.addColorStop(0, 'rgba(255,255,255,0.28)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, s, s);
    // The crescent is its own layer: a disc with an offset disc cut out.
    const moon = document.createElement('canvas');
    moon.width = s;
    moon.height = s;
    const m = moon.getContext('2d');
    if (!m) return;
    m.fillStyle = '#ffffff';
    m.beginPath();
    m.arc(c, c, s * 0.34, 0, Math.PI * 2);
    m.fill();
    m.globalCompositeOperation = 'destination-out';
    m.beginPath();
    m.arc(c + s * 0.15, c - s * 0.06, s * 0.3, 0, Math.PI * 2);
    m.fill();
    ctx.shadowColor = 'rgba(255,255,255,1)';
    ctx.shadowBlur = 10;
    ctx.drawImage(moon, 0, 0);
  });
}

/** Mulberry32: the crown's scatter is the same on every client. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Painted edge of the crown textures, and the ring's radius on it. */
const CROWN_SIZE = 256;
const CROWN_RING_RADIUS = CROWN_SIZE * 0.32;

function softDot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.32, 'rgba(255,255,255,1)');
  glow.addColorStop(0.5, 'rgba(255,255,255,0.3)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

/** A point on or near the crown's ring, thinning out to either side of it. */
function nearRing(random: () => number, spread: number): [number, number] {
  const angle = random() * Math.PI * 2;
  const radius = CROWN_RING_RADIUS + (random() + random() - 1) * spread;
  return [CROWN_SIZE / 2 + Math.cos(angle) * radius, CROWN_SIZE / 2 + Math.sin(angle) * radius];
}

/** Sporemender's crown: the ring's plain white map (the ring itself is geometry). */
export function sporeHaloRingTexture(): THREE.Texture {
  return paintedTexture(4, 4, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 4, 4);
  });
}

/** Sporemender's crown: glowing spores in three sizes, heaviest on the ring. */
export function sporeHaloScatterTexture(): THREE.Texture {
  return paintedTexture(CROWN_SIZE, CROWN_SIZE, (ctx) => {
    const random = seededRandom(0x5b0fe);
    const sizes = [
      { count: 44, spread: 42, radius: 5 },
      { count: 14, spread: 32, radius: 9 },
      { count: 5, spread: 12, radius: 14 },
    ];
    for (const { count, spread, radius } of sizes) {
      for (let i = 0; i < count; i++) softDot(ctx, ...nearRing(random, spread), radius);
    }
  });
}

/** Sporemender's crown: a few small four-point stars among the spores. */
export function sporeHaloStarsTexture(): THREE.Texture {
  return paintedTexture(CROWN_SIZE, CROWN_SIZE, (ctx) => {
    const random = seededRandom(0x57a125);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 9; i++) {
      const [x, y] = nearRing(random, 40);
      const size = 8 + random() * 5;
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const angle = (k * Math.PI) / 4;
        const reach = k % 2 ? size * 0.14 : size;
        ctx.lineTo(x + Math.sin(angle) * reach, y - Math.cos(angle) * reach);
      }
      ctx.closePath();
      ctx.fill();
    }
  });
}
