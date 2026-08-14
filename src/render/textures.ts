import * as THREE from 'three';

// Procedurally generated canvas textures — no external assets.

function makeCanvas(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let seedState = 12345;
function rnd(): number {
  seedState = (seedState * 1103515245 + 12345) & 0x7fffffff;
  return seedState / 0x7fffffff;
}

// Mottled detail texture multiplied over terrain vertex colors.
export function groundDetailTexture(): THREE.CanvasTexture {
  return makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#b8b8b8';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 5000; i++) {
      const v = 150 + Math.floor(rnd() * 105);
      ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
      const x = rnd() * s,
        y = rnd() * s;
      const r = 1 + rnd() * 2.5;
      ctx.fillRect(x, y, r, r);
    }
    // blades
    for (let i = 0; i < 1400; i++) {
      const v = 120 + Math.floor(rnd() * 100);
      ctx.strokeStyle = `rgba(${v},${v},${v},0.30)`;
      const x = rnd() * s,
        y = rnd() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 3, y - 2 - rnd() * 4);
      ctx.stroke();
    }
  });
}

export function stoneTexture(): THREE.CanvasTexture {
  return makeCanvas(128, (ctx, s) => {
    ctx.fillStyle = '#8d8d85';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 28; i++) {
      const x = rnd() * s,
        y = rnd() * s,
        w = 14 + rnd() * 26,
        h = 10 + rnd() * 16;
      const v = 115 + Math.floor(rnd() * 50);
      ctx.fillStyle = `rgb(${v},${v},${v - 6})`;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(40,40,38,0.6)';
      ctx.strokeRect(x, y, w, h);
    }
  });
}

export function waterNormalish(): THREE.CanvasTexture {
  const tex = makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#7f7fff';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 300; i++) {
      const x = rnd() * s,
        y = rnd() * s,
        r = 6 + rnd() * 22;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${100 + rnd() * 80},${100 + rnd() * 80},255,0.25)`);
      g.addColorStop(1, 'rgba(127,127,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// Large-scale smooth value noise: breaks up terrain texture tiling at
// distance (sampled at ~80u period in the splat shader).
export function macroNoiseTexture(): THREE.CanvasTexture {
  const tex = makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 160; i++) {
      const x = rnd() * s,
        y = rnd() * s,
        r = 18 + rnd() * 46;
      const v = 40 + rnd() * 175;
      drawWrapped(ctx, s, (ox, oy) => {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, `rgba(${v},${v},${v},0.30)`);
        g.addColorStop(1, `rgba(${v},${v},${v},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// Vertical sky gradient for the dome
export function skyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, '#4f86c6');
  g.addColorStop(0.45, '#7eb2e4');
  g.addColorStop(0.62, '#aacdec');
  g.addColorStop(0.75, '#cfe4f2');
  g.addColorStop(1.0, '#dcecf4');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface FlowerKind {
  p: [number, number, number];
  c: [number, number, number];
}

const DEFAULT_FLOWER_KINDS: FlowerKind[] = [
  { p: [246, 246, 250], c: [244, 200, 70] }, // daisy
  { p: [238, 150, 190], c: [180, 90, 40] }, // cosmos pink
  { p: [245, 195, 60], c: [150, 90, 20] }, // buttercup
];

export function flowerTuftTexture(
  kinds: FlowerKind[] = DEFAULT_FLOWER_KINDS,
  balanced = false,
): THREE.Texture {
  // Ground-cover flowers on a card: green stems with leaf pairs topped by
  // layered petal heads (white daisies, pink cosmos, golden buttercups),
  // drawn realistically enough to read as flowers at tuft scale. Same
  // mip-bleed + DataTexture upload as the grass so distance never darkens.
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);

  // balanced mode cycles the kinds list so every colour is guaranteed a
  // head on the card (the random pick can starve rare entries); the random
  // draw still happens either way so unbalanced cards stay byte-identical
  const head = (x: number, y: number, rad: number, palOverride?: FlowerKind): void => {
    const petals = 6 + Math.floor(rnd() * 3);
    const pal = palOverride ?? kinds[Math.floor(rnd() * kinds.length) % kinds.length];
    if (palOverride) rnd();
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2 + rnd() * 0.25;
      const px = x + Math.cos(a) * rad * 0.62;
      const py = y + Math.sin(a) * rad * 0.62;
      const jr = 0.85 + rnd() * 0.3;
      const g = ctx.createRadialGradient(px, py, 0, px, py, rad * 0.62 * jr);
      g.addColorStop(0, `rgba(${pal.p[0]},${pal.p[1]},${pal.p[2]},0.98)`);
      g.addColorStop(
        1,
        `rgba(${Math.floor(pal.p[0] * 0.78)},${Math.floor(pal.p[1] * 0.72)},${Math.floor(
          pal.p[2] * 0.8,
        )},0.95)`,
      );
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(px, py, rad * 0.52 * jr, rad * 0.3 * jr, a, 0, Math.PI * 2);
      ctx.fill();
    }
    const cg = ctx.createRadialGradient(x, y, 0, x, y, rad * 0.34);
    cg.addColorStop(0, `rgba(${pal.c[0]},${pal.c[1]},${pal.c[2]},1)`);
    cg.addColorStop(
      1,
      `rgba(${Math.floor(pal.c[0] * 0.7)},${Math.floor(pal.c[1] * 0.7)},${Math.floor(pal.c[2] * 0.7)},1)`,
    );
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(x, y, rad * 0.3, 0, Math.PI * 2);
    ctx.fill();
  };

  const stems = 5 + Math.floor(rnd() * 2);
  let headIdx = 0;
  for (let i = 0; i < stems; i++) {
    const x = 16 + (i + rnd() * 0.7) * ((S - 32) / stems);
    const h = S * (0.4 + rnd() * 0.4);
    const sway = (rnd() - 0.5) * 22;
    const topX = x + sway;
    const topY = S - h;
    // stem
    const sg = ctx.createLinearGradient(x, S, topX, topY);
    sg.addColorStop(0, 'rgba(52,88,40,0.95)');
    sg.addColorStop(1, 'rgba(92,138,62,0.95)');
    ctx.strokeStyle = sg;
    ctx.lineWidth = 1.6 + rnd() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, S);
    ctx.quadraticCurveTo(x + sway * 0.3, S - h * 0.55, topX, topY);
    ctx.stroke();
    // leaf pair partway up
    const ly = S - h * (0.35 + rnd() * 0.2);
    const lx = x + sway * 0.25;
    ctx.fillStyle = 'rgba(74,118,52,0.92)';
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(lx + dir * 4.5, ly, 5.5, 2.1, dir * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // flower head or bud
    if (rnd() < 0.82) {
      head(topX, topY, 7 + rnd() * 4.5, balanced ? kinds[headIdx++ % kinds.length] : undefined);
    } else {
      ctx.fillStyle = 'rgba(150,190,90,0.95)';
      ctx.beginPath();
      ctx.ellipse(topX, topY, 2.4, 3.6, sway * 0.02, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let pass = 0; pass < 6; pass++) {
    const src = d.slice();
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i4 = (y * S + x) * 4;
        if (src[i4 + 3] !== 0) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
          const j4 = (ny * S + nx) * 4;
          if (src[j4 + 3] === 0 && src[j4] === 0 && src[j4 + 1] === 0 && src[j4 + 2] === 0) {
            continue;
          }
          r += src[j4];
          g += src[j4 + 1];
          b += src[j4 + 2];
          n++;
        }
        if (n > 0) {
          d[i4] = Math.round(r / n);
          d[i4 + 1] = Math.round(g / n);
          d[i4 + 2] = Math.round(b / n);
        }
      }
    }
  }
  const tex = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  tex.flipY = true;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function grassTuftTexture(blades = 18): THREE.Texture {
  // Tapered, curved blades on a 128px card (was 64px uniform strokes, which
  // read as dark spikes in-world). Each blade is a filled path, wide at the
  // root and sharp at the tip, with a root-to-tip lightening gradient, per
  // blade hue jitter, and a faint center rib on the broad ones. A short
  // under-layer fills the base so tufts sit into the ground.
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, S, S);

  const blade = (x: number, h: number, sway: number, w: number, light: number): void => {
    const tipX = x + sway;
    const tipY = S - h;
    const midX = x + sway * 0.35;
    const midY = S - h * 0.55;
    // olive base -> brighter yellow-green tip; light scales the whole blade
    const g0 = Math.floor((74 + rnd() * 18) * light);
    const g1 = Math.floor((138 + rnd() * 48) * light);
    const grad = ctx.createLinearGradient(x, S, tipX, tipY);
    grad.addColorStop(0, `rgba(${Math.floor(g0 * 0.62)},${g0},${Math.floor(g0 * 0.44)},0.95)`);
    grad.addColorStop(
      1,
      `rgba(${Math.floor(g1 * 0.62 + rnd() * 18)},${g1},${Math.floor(g1 * 0.4)},0.95)`,
    );
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x - w, S);
    ctx.quadraticCurveTo(midX - w * 0.55, midY, tipX, tipY);
    ctx.quadraticCurveTo(midX + w * 0.55, midY, x + w, S);
    ctx.closePath();
    ctx.fill();
    // center rib on the broad blades: a hint of structure when lit
    if (w > 2.4) {
      ctx.strokeStyle = `rgba(${Math.floor(g1 * 0.72)},${Math.floor(g1 * 1.08)},${Math.floor(
        g1 * 0.5,
      )},0.5)`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, S);
      ctx.quadraticCurveTo(midX, midY, tipX, tipY);
      ctx.stroke();
    }
  };

  // under-layer: short filler blades so the tuft base reads dense
  for (let i = 0; i < Math.floor(blades * 0.7); i++) {
    blade(
      10 + rnd() * (S - 20),
      S * (0.16 + rnd() * 0.16),
      (rnd() - 0.5) * 16,
      1.6 + rnd() * 1.6,
      0.85 + rnd() * 0.18,
    );
  }
  // main blades: tall, curved, individually shaded
  for (let i = 0; i < blades; i++) {
    blade(
      12 + rnd() * (S - 24),
      S * (0.42 + rnd() * 0.42),
      (rnd() - 0.5) * 34,
      2.0 + rnd() * 2.4,
      0.95 + rnd() * 0.32,
    );
  }

  // Mip-darkening fix: transparent canvas texels are black, so distance mips
  // average every blade toward black (the old "dark spikes" look). Bleed
  // blade color into the transparent texels (kept invisible by alphaTest),
  // then upload the raw RGBA via DataTexture so the canvas's premultiplied
  // backing store cannot zero those RGB values on upload.
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let pass = 0; pass < 6; pass++) {
    const src = d.slice();
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i4 = (y * S + x) * 4;
        if (src[i4 + 3] !== 0) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
          const j4 = (ny * S + nx) * 4;
          // a neighbor with color (opaque, or already bled in a prior pass)
          if (src[j4 + 3] === 0 && src[j4] === 0 && src[j4 + 1] === 0 && src[j4 + 2] === 0) {
            continue;
          }
          r += src[j4];
          g += src[j4 + 1];
          b += src[j4 + 2];
          n++;
        }
        if (n > 0) {
          d[i4] = Math.round(r / n);
          d[i4 + 1] = Math.round(g / n);
          d[i4 + 2] = Math.round(b / n);
        }
      }
    }
  }

  const tex = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  tex.flipY = true;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// PBR-ish map generators: height fields converted to tangent-space normal
// maps, all procedural canvas. Consumed by the Standard-material pipeline
// (terrain splat, props, water); harmless to the Lambert low path.
// ---------------------------------------------------------------------------

export interface SurfaceMaps {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
}

export interface GroundSplat {
  grass: SurfaceMaps;
  dirt: SurfaceMaps;
  rock: SurfaceMaps;
  sand: SurfaceMaps;
}

function makeRawCanvas(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  return c;
}

// Draws fn at the 9 wrap offsets so blobs crossing an edge tile seamlessly.
function drawWrapped(
  ctx: CanvasRenderingContext2D,
  size: number,
  fn: (ox: number, oy: number) => void,
): void {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) fn(ox, oy);
  }
}

// Sobel-ish height->tangent-space normal conversion with wrap sampling.
export function heightToNormal(
  heightCanvas: HTMLCanvasElement,
  strength = 2.0,
): THREE.CanvasTexture {
  const s = heightCanvas.width;
  const src = heightCanvas.getContext('2d')!.getImageData(0, 0, s, s).data;
  const out = document.createElement('canvas');
  out.width = out.height = s;
  const outCtx = out.getContext('2d')!;
  const img = outCtx.createImageData(s, s);
  const h = (x: number, y: number): number => src[(((y + s) % s) * s + ((x + s) % s)) * 4] / 255;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (h(x - 1, y) - h(x + 1, y)) * strength;
      const dy = (h(x, y - 1) - h(x, y + 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * s + x) * 4;
      img.data[i] = (dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  outCtx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Four tiling albedo+normal pairs for the terrain splat. Albedo is authored
// near mid-gray with a mild hue — terrain vertex color carries the biome tint.
export function groundSplatMaps(): GroundSplat {
  const grassMap = makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#7e8a64';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      const x = rnd() * s,
        y = rnd() * s,
        r = 4 + rnd() * 9;
      const v = 90 + rnd() * 105;
      drawWrapped(ctx, s, (ox, oy) => {
        ctx.fillStyle = `rgba(${v - 18},${v},${v - 40},0.30)`;
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy, r, r * 0.7, rnd() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    // blades
    for (let i = 0; i < 3200; i++) {
      const x = rnd() * s,
        y = rnd() * s;
      const v = 75 + rnd() * 125;
      ctx.strokeStyle = `rgba(${v - 25},${v},${v - 45},0.55)`;
      ctx.lineWidth = 1 + rnd() * 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 4, y - 3 - rnd() * 6);
      ctx.stroke();
    }
  });
  const grassHeight = makeRawCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#787878';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 700; i++) {
      const x = rnd() * s,
        y = rnd() * s,
        r = 4 + rnd() * 10;
      const v = 80 + rnd() * 110;
      drawWrapped(ctx, s, (ox, oy) => {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, `rgba(${v},${v},${v},0.5)`);
        g.addColorStop(1, `rgba(${v},${v},${v},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });

  const dirtMap = makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#8a7a60';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 800; i++) {
      const x = rnd() * s,
        y = rnd() * s,
        r = 1.5 + rnd() * 4;
      const v = 95 + rnd() * 85;
      drawWrapped(ctx, s, (ox, oy) => {
        ctx.fillStyle = `rgba(${v},${v - 12},${v - 32},0.5)`;
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy, r, r * 0.8, rnd() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    for (let i = 0; i < 40; i++) {
      // dry cracks
      let x = rnd() * s,
        y = rnd() * s;
      ctx.strokeStyle = 'rgba(50,40,28,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (rnd() - 0.5) * 26;
        y += (rnd() - 0.5) * 26;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  const dirtHeight = makeRawCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#6e6e6e';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 600; i++) {
      const x = rnd() * s,
        y = rnd() * s,
        r = 1.5 + rnd() * 4.5;
      const v = 110 + rnd() * 120;
      drawWrapped(ctx, s, (ox, oy) => {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, `rgba(${v},${v},${v},0.85)`);
        g.addColorStop(1, `rgba(${v},${v},${v},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });

  const rockMap = makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#83837c';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      // fractured plates
      const x = rnd() * s,
        y = rnd() * s,
        r = 10 + rnd() * 24;
      const v = 105 + rnd() * 55;
      drawWrapped(ctx, s, (ox, oy) => {
        ctx.fillStyle = `rgba(${v},${v},${v - 5},0.55)`;
        ctx.beginPath();
        const n = 5 + Math.floor(rnd() * 3);
        for (let k = 0; k <= n; k++) {
          const a = (k / n) * Math.PI * 2;
          const rr = r * (0.7 + rnd() * 0.5);
          const px = x + ox + Math.cos(a) * rr,
            py = y + oy + Math.sin(a) * rr;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.fill();
        ctx.strokeStyle = 'rgba(42,42,40,0.6)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }
    // finer secondary fracture pass: smaller, higher-contrast cracks layered
    // on top so the rock reads as striated stone rather than one flat tone.
    for (let i = 0; i < 140; i++) {
      const x = rnd() * s,
        y = rnd() * s,
        r = 3 + rnd() * 8;
      const v = 90 + rnd() * 70;
      drawWrapped(ctx, s, (ox, oy) => {
        ctx.fillStyle = `rgba(${v},${v},${v - 8},0.4)`;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  });
  const rockHeight = makeRawCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#505050';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * s,
        y = rnd() * s,
        r = 10 + rnd() * 24;
      const v = 120 + rnd() * 110;
      drawWrapped(ctx, s, (ox, oy) => {
        ctx.fillStyle = `rgba(${v},${v},${v},0.8)`;
        ctx.beginPath();
        const n = 5 + Math.floor(rnd() * 3);
        for (let k = 0; k <= n; k++) {
          const a = (k / n) * Math.PI * 2;
          const rr = r * (0.7 + rnd() * 0.5);
          const px = x + ox + Math.cos(a) * rr,
            py = y + oy + Math.sin(a) * rr;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.fill();
      });
    }
  });

  const sandMap = makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#b3a883';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y++) {
      // wind ripples: wavy horizontal bands
      const ph = Math.sin(y * 0.22) * 0.5 + Math.sin(y * 0.07 + 2) * 0.5;
      const v = Math.round(165 + ph * 22);
      ctx.fillStyle = `rgba(${v},${v - 12},${v - 42},0.35)`;
      ctx.fillRect(0, y, s, 1);
    }
    for (let i = 0; i < 500; i++) {
      const v = 140 + rnd() * 70;
      ctx.fillStyle = `rgba(${v},${v - 12},${v - 40},0.4)`;
      ctx.fillRect(rnd() * s, rnd() * s, 1.5, 1.5);
    }
  });
  const sandHeight = makeRawCanvas(256, (ctx, s) => {
    for (let y = 0; y < s; y++) {
      const ph = Math.sin(y * 0.22) * 0.5 + Math.sin(y * 0.07 + 2) * 0.5;
      const v = Math.round(128 + ph * 56);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(0, y, s, 1);
    }
  });

  return {
    grass: { map: grassMap, normalMap: heightToNormal(grassHeight, 1.6) },
    dirt: { map: dirtMap, normalMap: heightToNormal(dirtHeight, 2.0) },
    rock: { map: rockMap, normalMap: heightToNormal(rockHeight, 2.6) },
    sand: { map: sandMap, normalMap: heightToNormal(sandHeight, 1.4) },
  };
}

// Soft radial gradient disc — additive light-pool decals under dungeon
// torches (the point-light budget can't keep every pool lit at once).
export function radialGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.34)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Two differently-scaled blobby normal maps for the water shader (scrolled
// against each other). Real normal-encoded, replaces waterNormalish.
export function waterNormalMaps(): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const blobby = (count: number, rMin: number, rMax: number): HTMLCanvasElement =>
    makeRawCanvas(256, (ctx, s) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < count; i++) {
        const x = rnd() * s,
          y = rnd() * s,
          r = rMin + rnd() * (rMax - rMin);
        const v = 70 + rnd() * 140;
        drawWrapped(ctx, s, (ox, oy) => {
          const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
          g.addColorStop(0, `rgba(${v},${v},${v},0.55)`);
          g.addColorStop(1, `rgba(${v},${v},${v},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    });
  // 3.0/3.4: strong enough to break the mirror, soft enough that the lake
  // doesn't read as TV-static speckle (the shimmer term amplifies these)
  return [heightToNormal(blobby(220, 10, 34), 3.0), heightToNormal(blobby(420, 5, 16), 3.4)];
}

// Sparkle star for ground quest objects
export function sparkleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,250,180,0.95)');
  g.addColorStop(0.25, 'rgba(255,230,120,0.45)');
  g.addColorStop(1, 'rgba(255,220,100,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(255,255,220,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(32, 6);
  ctx.lineTo(32, 58);
  ctx.moveTo(6, 32);
  ctx.lineTo(58, 32);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
