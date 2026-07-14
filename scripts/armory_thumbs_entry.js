// Browser entry for scripts/armory_thumbs.mjs (esbuild IIFE, injected into a
// blank harness page served over the committed public/ dir). Renders one Season
// 1 Armory weapon skin per call: the real GLB with its real rarity VFX rig
// (src/render/weapon_vfx.ts, the exact module the game renderer uses) over a
// rarity-themed painted backdrop, through an ACES + UnrealBloom composer, and
// hands back a PNG data URL. The rarity ramp is deliberate: Guildmark reads as
// quiet workshop steel, Emberwrought as banked forge-light, Hoarfrost as
// glacial night, and Fallen Star as a torn piece of cosmos.
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createWeaponVfx, TIERS, WEAPON_VFX } from '../src/render/weapon_vfx.ts';
import { WEAPON_SKINS } from '../src/sim/content/weapon_skins.ts';

const SIZE = 640; // supersampled; the driver downscales to the shipped 512
const SETTLE_FRAMES = 96; // ~1.6s so motes/aurora/drift populate their loops

const canvas = document.createElement('canvas');
canvas.width = SIZE;
canvas.height = SIZE;
document.body.appendChild(canvas);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

function loadGlb(url) {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

// ── Rarity backdrops (painted 2d canvas -> scene.background texture) ────────
function paintBackdrop(rarity) {
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const g = c.getContext('2d');
  const lin = g.createLinearGradient(0, 0, 0, SIZE);
  if (rarity === 'uncommon') {
    lin.addColorStop(0, '#232a22');
    lin.addColorStop(0.55, '#161c17');
    lin.addColorStop(1, '#0c100c');
  } else if (rarity === 'rare') {
    lin.addColorStop(0, '#180f0c');
    lin.addColorStop(0.55, '#1f120b');
    lin.addColorStop(1, '#2b130a');
  } else if (rarity === 'epic') {
    lin.addColorStop(0, '#0a1220');
    lin.addColorStop(0.55, '#0c1a2c');
    lin.addColorStop(1, '#071018');
  } else {
    lin.addColorStop(0, '#05040f');
    lin.addColorStop(0.55, '#0b0618');
    lin.addColorStop(1, '#020208');
  }
  g.fillStyle = lin;
  g.fillRect(0, 0, SIZE, SIZE);

  const glow = (x, y, r, color, alpha) => {
    const rad = g.createRadialGradient(x, y, 0, x, y, r);
    rad.addColorStop(0, color);
    rad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = alpha;
    g.fillStyle = rad;
    g.fillRect(0, 0, SIZE, SIZE);
    g.globalAlpha = 1;
  };
  // Deterministic speck scatter (no Math.random: reruns stay stable).
  const specks = (count, color, seed, maxR) => {
    let h = seed;
    const next = () => {
      h = (h * 48271) % 2147483647;
      return h / 2147483647;
    };
    g.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const x = next() * SIZE;
      const y = next() * SIZE * 0.9;
      const r = 0.4 + next() * maxR;
      g.globalAlpha = 0.25 + next() * 0.6;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  };

  if (rarity === 'uncommon') {
    glow(SIZE * 0.5, SIZE * 0.34, SIZE * 0.46, 'rgba(140,150,110,0.55)', 0.5);
    glow(SIZE * 0.5, SIZE * 1.05, SIZE * 0.5, 'rgba(70,60,35,0.6)', 0.5);
  } else if (rarity === 'rare') {
    glow(SIZE * 0.5, SIZE * 0.85, SIZE * 0.62, 'rgba(255,110,30,0.7)', 0.65);
    glow(SIZE * 0.5, SIZE * 0.3, SIZE * 0.42, 'rgba(255,170,80,0.35)', 0.5);
    specks(60, '#ffb066', 7, 1.3);
  } else if (rarity === 'epic') {
    glow(SIZE * 0.5, SIZE * 0.3, SIZE * 0.5, 'rgba(90,200,255,0.5)', 0.6);
    glow(SIZE * 0.5, SIZE * 0.95, SIZE * 0.6, 'rgba(40,120,200,0.5)', 0.55);
    specks(90, '#bfeaff', 11, 1.1);
  } else {
    // Legendary: a gold star-core in violet cosmos with aurora sweeps + starfield.
    glow(SIZE * 0.5, SIZE * 0.36, SIZE * 0.52, 'rgba(255,190,90,0.75)', 0.8);
    glow(SIZE * 0.24, SIZE * 0.7, SIZE * 0.5, 'rgba(140,70,220,0.5)', 0.6);
    glow(SIZE * 0.78, SIZE * 0.62, SIZE * 0.46, 'rgba(70,120,255,0.4)', 0.55);
    g.globalAlpha = 0.24;
    for (let band = 0; band < 3; band++) {
      const grad = g.createLinearGradient(0, 0, SIZE, SIZE);
      grad.addColorStop(0, 'rgba(255,215,120,0)');
      grad.addColorStop(0.5, band === 1 ? 'rgba(180,120,255,0.8)' : 'rgba(255,205,110,0.8)');
      grad.addColorStop(1, 'rgba(120,200,255,0)');
      g.strokeStyle = grad;
      g.lineWidth = 26 - band * 7;
      g.beginPath();
      g.moveTo(-40, SIZE * (0.86 - band * 0.1));
      g.bezierCurveTo(
        SIZE * 0.3,
        SIZE * (0.52 - band * 0.1),
        SIZE * 0.7,
        SIZE * (1.02 - band * 0.12),
        SIZE + 40,
        SIZE * (0.5 - band * 0.06),
      );
      g.stroke();
    }
    g.globalAlpha = 1;
    specks(170, '#fff4d8', 13, 1.5);
    specks(50, '#c9a1ff', 29, 1.2);
  }
  // Vignette keeps the weapon silhouette the hero.
  const vig = g.createRadialGradient(
    SIZE / 2,
    SIZE / 2,
    SIZE * 0.36,
    SIZE / 2,
    SIZE / 2,
    SIZE * 0.72,
  );
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vig;
  g.fillRect(0, 0, SIZE, SIZE);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Lights: hero key + cool fill + rim, re-tinted a touch per rarity.
const RARITY_KEYLIGHT = {
  uncommon: 0xfff2dc,
  rare: 0xffd9b0,
  epic: 0xdfefff,
  legendary: 0xffe8c0,
};

window.armorySkinIds = Object.keys(WEAPON_SKINS);

window.renderArmoryThumb = async (skinId) => {
  const skin = WEAPON_SKINS[skinId];
  if (!skin) throw new Error(`unknown skin ${skinId}`);
  const spec = WEAPON_VFX[skin.model] ?? null;
  const tier = spec ? TIERS[spec.tier] : null;

  const scene = new THREE.Scene();
  scene.background = paintBackdrop(skin.rarity);

  // No-VFX tiers have no emissive to carry them, so the studio rig steps up.
  const plain = !spec;
  const key = new THREE.DirectionalLight(
    RARITY_KEYLIGHT[skin.rarity] ?? 0xffffff,
    plain ? 4.2 : 3.0,
  );
  key.position.set(2.4, 3.6, 2.8);
  const fill = new THREE.DirectionalLight(0xbcd2ff, plain ? 1.5 : 1.0);
  fill.position.set(-3, 1.6, -1.2);
  const rim = new THREE.DirectionalLight(0xffffff, plain ? 1.7 : 1.2);
  rim.position.set(-1.2, 2.6, -3.4);
  const ambient = new THREE.AmbientLight(0xffffff, plain ? 1.0 : 0.55);
  scene.add(key, fill, rim, ambient);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 60);
  const composer = new EffectComposer(renderer);
  composer.setSize(SIZE, SIZE);
  composer.addPass(new RenderPass(scene, camera));
  // Cap the still-frame bloom below the live-inspector values so a bright core
  // (Hoarfrost ice) keeps its blade silhouette in a single frame.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(SIZE, SIZE),
    Math.min(tier?.bloom?.strength ?? 0.32, 0.55),
    tier?.bloom?.radius ?? 0.45,
    Math.max(tier?.bloom?.threshold ?? 0.86, 0.55),
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const gltf = await loadGlb(`/models/weapons/${skin.model}.glb`);
  const model = gltf.scene;
  const stage = new THREE.Group();
  scene.add(stage);
  // Center on the visual middle, then a hero three-quarter tilt.
  const bounds = new THREE.Box3().setFromObject(model);
  const center = bounds.getCenter(new THREE.Vector3());
  const dims = bounds.getSize(new THREE.Vector3());
  model.position.sub(center);
  stage.add(model);
  stage.rotation.set(0.12, -0.65, -0.28);

  let vfx = null;
  if (spec) {
    vfx = createWeaponVfx(model, spec, { grounded: false });
    vfx.setBackdropVisible(false);
    vfx.setPixelScale(SIZE);
  }

  const maxDim = Math.max(dims.x, dims.y, dims.z);
  const dist = Math.max(1.2, maxDim * 1.62);
  camera.position.set(dist * 0.18, dist * 0.12, dist);
  camera.lookAt(0, 0, 0);

  for (let i = 0; i < SETTLE_FRAMES; i++) {
    vfx?.update(1 / 60);
    stage.rotation.y += 0.0008; // barely perceptible drift keeps trails alive
  }
  composer.render();
  const url = canvas.toDataURL('image/png');

  vfx?.dispose();
  composer.dispose();
  scene.background?.dispose?.();
  return url;
};

window.__ready = true;
