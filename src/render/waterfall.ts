// Procedural waterfall for the map editor (asset id 'water/waterfall', path
// 'procedural://waterfall'): a gently curved falling-water sheet + a foam pool
// disc + rising mist sprites, all driven by one shared time uniform the
// renderer advances with the water. The palette reuses the water surface's
// deep/shallow colors so a fall reads as the same body of water it feeds.
//
// Self-contained: its noise canvas uses a LOCAL PRNG (never the shared
// texture-LCG, whose draw order is a look-stability contract), and the sheet
// authors its own source-unit size like the grass patch (norm 1 in the
// placed-assets pipeline; the placement scale/scaleY stretch it).

import * as THREE from 'three';

// Matches water.ts DEEP_COLOR / SHALLOW_COLOR.
const DEEP = new THREE.Color(0x0d3a52);
const SHALLOW = new THREE.Color(0x2d8077);
const FOAM = new THREE.Color(0xeaf6f4);

// Source-unit dimensions (yards at scale 1).
const SHEET_HEIGHT = 5;
const SHEET_WIDTH = 2.6;
const SHEET_CURVE = 0.55; // how far the middle bows outward
const POOL_RADIUS = 1.9;

/** Shared clock for every waterfall material; the renderer advances it. */
const timeUniform = { value: 0 };

export function advanceWaterfallTime(time: number): void {
  timeUniform.value = time;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seamless-ish grayscale flow noise (streaks + blobs), local PRNG only.
let noiseTex: THREE.CanvasTexture | null = null;
function flowNoiseTexture(): THREE.CanvasTexture {
  if (noiseTex) return noiseTex;
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const rng = mulberry32(0xfa11);
  ctx.fillStyle = '#606060';
  ctx.fillRect(0, 0, s, s);
  // Vertical streaks (the falling-water threads), drawn wrapped so the map
  // tiles vertically without a seam.
  for (let i = 0; i < 90; i++) {
    const x = rng() * s;
    const y = rng() * s;
    const len = 40 + rng() * 120;
    const w = 1 + rng() * 3;
    const v = 90 + Math.floor(rng() * 140);
    ctx.fillStyle = `rgba(${v},${v},${v},${0.25 + rng() * 0.3})`;
    ctx.fillRect(x, y, w, len);
    ctx.fillRect(x, y - s, w, len);
    ctx.fillRect(x - s, y, w, len);
  }
  // Soft blobs for foam clumps.
  for (let i = 0; i < 60; i++) {
    const x = rng() * s;
    const y = rng() * s;
    const r = 4 + rng() * 18;
    const v = 120 + Math.floor(rng() * 135);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${v},${v},${v},0.45)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  noiseTex = new THREE.CanvasTexture(c);
  noiseTex.wrapS = THREE.RepeatWrapping;
  noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.colorSpace = THREE.NoColorSpace;
  return noiseTex;
}

// One shared sheet material: scrolling flow noise turns into threads of water
// and foam; alpha fades at the side edges and the lip.
let sheetMat: THREE.ShaderMaterial | null = null;
function sheetMaterial(): THREE.ShaderMaterial {
  if (sheetMat) return sheetMat;
  sheetMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: timeUniform,
      uNoise: { value: flowNoiseTexture() },
      uDeep: { value: DEEP },
      uShallow: { value: SHALLOW },
      uFoam: { value: FOAM },
    },
    vertexShader: `
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        vUv = uv;
        vec3 p = position;
        // Subtle traveling ripple down the sheet so the silhouette wobbles.
        p += normal * sin(uv.y * 14.0 - uTime * 5.0 + uv.x * 6.0) * 0.05 * (1.0 - uv.y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform sampler2D uNoise;
      uniform vec3 uDeep, uShallow, uFoam;
      void main() {
        // Two flow layers scrolling DOWN at different speeds (uv.y 1 = lip).
        float n1 = texture2D(uNoise, vec2(vUv.x * 1.6, vUv.y * 2.2 + uTime * 0.9)).r;
        float n2 = texture2D(uNoise, vec2(vUv.x * 3.1 + 0.37, vUv.y * 3.6 + uTime * 1.5)).r;
        float flow = n1 * 0.65 + n2 * 0.55;
        // Water body: shallow at the lip, deep toward the base, foam threads on top.
        vec3 col = mix(uShallow, uDeep, (1.0 - vUv.y) * 0.55);
        float foam = smoothstep(0.62, 0.95, flow);
        // The base churns white where the sheet meets the pool.
        foam = max(foam, smoothstep(0.22, 0.02, vUv.y) * 0.9);
        col = mix(col, uFoam, foam);
        // A touch of sparkle over the bloom threshold on the brightest threads.
        col += uFoam * smoothstep(0.9, 1.0, flow) * 0.6;
        // Side edges and the lip feather out.
        float edge = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);
        float alpha = (0.62 + foam * 0.35) * edge * smoothstep(1.0, 0.94, vUv.y);
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  return sheetMat;
}

// Foam pool at the base: an animated disc of expanding ripples.
let poolMat: THREE.ShaderMaterial | null = null;
function poolMaterial(): THREE.ShaderMaterial {
  if (poolMat) return poolMat;
  poolMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: timeUniform,
      uNoise: { value: flowNoiseTexture() },
      uFoam: { value: FOAM },
      uShallow: { value: SHALLOW },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime;
      uniform sampler2D uNoise;
      uniform vec3 uFoam, uShallow;
      void main() {
        vec2 d = vUv - 0.5;
        float r = length(d) * 2.0;
        // Rings drifting outward + churn noise.
        float rings = sin(r * 16.0 - uTime * 3.4) * 0.5 + 0.5;
        float churn = texture2D(uNoise, vUv * 2.0 + vec2(uTime * 0.07, uTime * 0.11)).r;
        float foam = smoothstep(0.35, 0.9, rings * 0.45 + churn * 0.75) ;
        // Solid froth at the center (under the sheet), fading to the rim.
        foam = max(foam, smoothstep(0.45, 0.0, r));
        vec3 col = mix(uShallow, uFoam, foam);
        float alpha = (0.28 + foam * 0.6) * smoothstep(1.0, 0.72, r);
        gl_FragColor = vec4(col, alpha);
      }`,
  });
  return poolMat;
}

// Soft mist puff sprite (local canvas, shared).
let mistTex: THREE.CanvasTexture | null = null;
function mistTexture(): THREE.CanvasTexture {
  if (mistTex) return mistTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 36, 0, 32, 36, 30);
  g.addColorStop(0, 'rgba(240,250,250,0.5)');
  g.addColorStop(1, 'rgba(240,250,250,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  mistTex = new THREE.CanvasTexture(c);
  mistTex.colorSpace = THREE.SRGBColorSpace;
  return mistTex;
}

/**
 * Build one waterfall model (fresh group per placement; materials, textures
 * and geometries are shared). Base sits at local y 0, the sheet rises to
 * SHEET_HEIGHT; the placed-assets pipeline seats y 0 on the terrain and the
 * placement's scale/scaleY stretch it to the cliff.
 */
export function buildWaterfallModel(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'waterfall';
  // Curved sheet: an open cylinder segment, bowed toward +z.
  const sheet = new THREE.Mesh(sharedSheetGeometry(), sheetMaterial());
  sheet.position.y = SHEET_HEIGHT / 2;
  g.add(sheet);
  const pool = new THREE.Mesh(sharedPoolGeometry(), poolMaterial());
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.1;
  g.add(pool);
  // Two mist puffs that slowly rise and re-seed (cosmetic, self-driven).
  for (let i = 0; i < 2; i++) {
    const mat = new THREE.SpriteMaterial({
      map: mistTexture(),
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    const sp = new THREE.Sprite(mat);
    const phase = i * 2.6;
    sp.scale.setScalar(1.6);
    sp.position.set(i === 0 ? -0.5 : 0.55, 0.7, 0.35);
    sp.onBeforeRender = () => {
      const t = timeUniform.value + phase;
      const cycle = (t * 0.35) % 1;
      sp.position.y = 0.5 + cycle * 1.6;
      sp.material.opacity = 0.38 * (1 - cycle);
      const sc = 1.2 + cycle * 1.4;
      sp.scale.set(sc, sc * 0.8, 1);
    };
    g.add(sp);
  }
  return g;
}

let sheetGeo: THREE.CylinderGeometry | null = null;
function sharedSheetGeometry(): THREE.CylinderGeometry {
  if (!sheetGeo) {
    // Radius chosen so the arc spans SHEET_WIDTH; theta centered on +z.
    const radius = SHEET_CURVE + SHEET_WIDTH * 0.45;
    const theta = SHEET_WIDTH / radius;
    sheetGeo = new THREE.CylinderGeometry(
      radius,
      radius * 0.92,
      SHEET_HEIGHT,
      18,
      12,
      true,
      Math.PI / 2 - theta / 2,
      theta,
    );
  }
  return sheetGeo;
}

let poolGeo: THREE.CircleGeometry | null = null;
function sharedPoolGeometry(): THREE.CircleGeometry {
  if (!poolGeo) poolGeo = new THREE.CircleGeometry(POOL_RADIUS, 28);
  return poolGeo;
}
