// The canvas art of the shapeshift form adornments (form_adornment_core.ts):
// Moonwing's wing and crescent, Gloamveil's veil and eye glow. Painted once
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

/** The gloom veil: a near-opaque dark oval that feathers out at its rim. The
 *  colour comes from the material, this is alpha only. */
export function veilTexture(): THREE.Texture {
  const s = 128;
  return paintedTexture(s, s, (ctx) => {
    const c = s / 2;
    const veil = ctx.createRadialGradient(c, c, 0, c, c, c);
    veil.addColorStop(0, 'rgba(255,255,255,0.97)');
    veil.addColorStop(0.62, 'rgba(255,255,255,0.93)');
    veil.addColorStop(0.86, 'rgba(255,255,255,0.45)');
    veil.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, s, s);
  });
}

/** A burning eye: a hot white core inside a soft glow. */
export function eyeGlowTexture(): THREE.Texture {
  const s = 64;
  return paintedTexture(s, s, (ctx) => {
    const c = s / 2;
    const glow = ctx.createRadialGradient(c, c, 0, c, c, c);
    glow.addColorStop(0, 'rgba(255,255,255,1)');
    glow.addColorStop(0.22, 'rgba(255,255,255,0.95)');
    glow.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, s, s);
  });
}
