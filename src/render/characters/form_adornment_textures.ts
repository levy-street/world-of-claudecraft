// The canvas art of the shapeshift form adornments (form_adornment_core.ts):
// Moonwing's crescent. Painted once
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
