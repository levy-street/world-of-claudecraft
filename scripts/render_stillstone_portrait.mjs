// Bakes the Stillstone's target portrait (public/ui/portraits/heart_breath_stillstone.webp).
//
// The Stillstone (heart_breath_stillstone, the Guardian of the Breath's Islands of
// the Wind) is a bodyless usable body: the crystal a player sees is drawn by the
// fight's own painter (src/render/smith_heart_fx/breath_stillstone_fx.ts), never
// by the creature manifest, so scripts/render_finder_portraits.mjs would bake the
// hidden stand-in rig instead. This draws the real crystal: the same lathe
// geometry, hanging shards, cage of wind and halo, through the shipped shaders
// (CRYSTAL_FRAG, ISLE_RIBBON_FRAG), colours (PHASE_COLORS) and awake look
// (stoneLook), over the elemental mob-portrait backdrop, then encodes it the way
// the finder portraits are encoded. target_portrait_view.ts serves it through
// STATIC_MOB_PORTRAIT_URLS, outside the deterministic mob-render ledger.
//
// Local only: a 127.0.0.1 server and a headless Chrome/Edge on the default GPU
// backend. Run from the repo root: node scripts/render_stillstone_portrait.mjs
import { writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { BROWSER_PATH } from './browser_path.mjs';
import { mobPortraitBackgroundSvg } from './lib/mob_portrait_background.mjs';

const root = process.cwd();
const OUT = path.join(root, 'public', 'ui', 'portraits', 'heart_breath_stillstone.webp');
const RENDER_PX = 512;
const OUT_PX = 128;
// The awake stone (its isle's adds dead, nobody channelling yet), turned a
// little off its facets, the camera a touch above its waist.
const LOOK = { state: 'awake', t: 0.45, channel: 0, spin: 0.3, ringSpin: 0.6 };
const CAMERA = { fov: 30, y: 1.8, dist: 15.5, lookY: 0.1 };

const ENTRY = `
import * as THREE from 'three';
import { ribbonGeometry } from './src/render/smith_heart_fx/breath_ride_fx';
import { PHASE_COLORS as PC, STILLSTONE, stoneLook } from './src/render/smith_heart_fx/breath_isle_phase_core';
import { CRYSTAL_FRAG, PHASE_SHELL_VERT } from './src/render/smith_heart_fx/breath_isle_phase_glsl';
import { ISLE_RIBBON_FRAG, ISLE_UV_VERT } from './src/render/smith_heart_fx/breath_isles_glsl';
import { radialGlowTexture } from './src/render/textures';

// breath_stillstone_fx.ts crystalGeometry, verbatim (module-private there).
function crystalGeometry() {
  const H = STILLSTONE.height;
  const W = STILLSTONE.width;
  const pts = [
    new THREE.Vector2(0, -H * 0.5),
    new THREE.Vector2(W * 0.72, -H * 0.18),
    new THREE.Vector2(W, H * 0.05),
    new THREE.Vector2(W * 0.8, H * 0.25),
    new THREE.Vector2(0, H * 0.5),
  ];
  const lathe = new THREE.LatheGeometry(pts, 6);
  const flat = lathe.toNonIndexed();
  lathe.dispose();
  flat.computeVertexNormals();
  return flat;
}

window.renderStone = async (o) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = o.size;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const img = new Image();
  img.src = o.bg;
  await img.decode();
  const bg = new THREE.Texture(img);
  bg.colorSpace = THREE.SRGBColorSpace;
  bg.needsUpdate = true;
  scene.background = bg;
  const uTime = { value: o.look.t };
  const L = stoneLook(o.look.state, o.look.t, o.look.channel);
  const group = new THREE.Group();
  scene.add(group);
  const crystalMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime,
      uColor: { value: new THREE.Color(PC.stone) },
      uGold: { value: new THREE.Color(PC.stilled) },
      uCore: { value: new THREE.Color(PC.stoneCore) },
      uGlow: { value: L.glow },
      uGoldK: { value: L.gold },
      uPulse: { value: L.pulse },
    },
    vertexShader: PHASE_SHELL_VERT,
    fragmentShader: CRYSTAL_FRAG,
  });
  const crystal = new THREE.Mesh(crystalGeometry(), crystalMat);
  crystal.rotation.y = o.look.spin;
  group.add(crystal);
  const shardGeo = new THREE.OctahedronGeometry(0.4, 0);
  shardGeo.computeVertexNormals();
  for (let k = 0; k < 3; k++) {
    const s = new THREE.Mesh(shardGeo, crystalMat);
    const a = (k / 3) * Math.PI * 2;
    s.position.set(Math.sin(a) * 2.1, -0.6 + k * 0.5, Math.cos(a) * 2.1);
    s.scale.set(0.7, 1.4, 0.7);
    crystal.add(s);
  }
  const ringMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime,
      uColor: { value: new THREE.Color(PC.ward) },
      uCore: { value: new THREE.Color(0xffffff) },
      uGlow: { value: L.cage * 1.1 },
      uFlow: { value: L.cageSpin },
      uDash: { value: 5 },
      uFade: { value: 0 },
    },
    vertexShader: ISLE_UV_VERT,
    fragmentShader: ISLE_RIBBON_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  for (let k = 0; k < STILLSTONE.rings && L.cage > 0.02; k++) {
    const pts = [];
    const turns = 1.4 + 0.35 * k;
    for (let i = 0; i <= 72; i++) {
      const f = i / 72;
      const a = f * Math.PI * 2 * turns + (k * Math.PI * 2) / STILLSTONE.rings;
      const r = 1.15 + 1.05 * Math.sin(f * Math.PI) + 0.12 * k;
      pts.push({ x: Math.sin(a) * r, y: (f - 0.5) * (STILLSTONE.height + 1.6), z: Math.cos(a) * r });
    }
    const ring = new THREE.Mesh(ribbonGeometry(pts, 0.16, true), ringMat);
    ring.rotation.y = o.look.ringSpin * (k % 2 === 0 ? 1 : -0.7);
    group.add(ring);
  }
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: radialGlowTexture(),
      color: new THREE.Color(PC.stone).lerp(new THREE.Color(PC.stilled), L.gold),
      transparent: true,
      opacity: 0.12 + 0.3 * L.glow,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  halo.scale.setScalar(7 + 3 * L.pulse);
  group.add(halo);
  const cam = new THREE.PerspectiveCamera(o.camera.fov, 1, 0.1, 100);
  cam.position.set(0, o.camera.y, o.camera.dist);
  cam.lookAt(0, o.camera.lookY, 0);
  renderer.render(scene, cam);
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const glRenderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const url = canvas.toDataURL('image/png');
  renderer.dispose();
  return { url, glRenderer };
};
window.__ready = true;
`;

const built = await esbuild.build({
  stdin: { contents: ENTRY, resolveDir: root, sourcefile: 'stillstone-portrait.js', loader: 'js' },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  absWorkingDir: root,
  write: false,
  logLevel: 'error',
});
const bundleJs = built.outputFiles[0].text;
const server = http.createServer((req, res) => {
  if (req.url === '/bundle.js') {
    res.setHeader('content-type', 'text/javascript');
    res.end(bundleJs);
    return;
  }
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><html><body><script src="/bundle.js"></script></body></html>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const backdrop = await sharp(Buffer.from(mobPortraitBackgroundSvg('elemental', RENDER_PX)))
  .png()
  .toBuffer();
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: 'new',
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox'],
});
let pageErrors = 0;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => {
    pageErrors++;
    console.error('PAGEERR', e.message);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  const { url, glRenderer } = await page.evaluate((o) => window.renderStone(o), {
    size: RENDER_PX,
    bg: `data:image/png;base64,${backdrop.toString('base64')}`,
    look: LOOK,
    camera: CAMERA,
  });
  if (pageErrors > 0) throw new Error('the render page raised errors');
  const webp = await sharp(Buffer.from(url.split(',')[1], 'base64'))
    .resize(OUT_PX, OUT_PX)
    .webp({ quality: 88, alphaQuality: 100, effort: 6 })
    .toBuffer();
  writeFileSync(OUT, webp);
  console.log(`wrote ${path.relative(root, OUT)} (${webp.length} bytes, ${glRenderer})`);
} finally {
  await browser.close();
  server.close();
}
