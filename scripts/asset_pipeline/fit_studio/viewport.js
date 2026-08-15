// The 3D stage: renderer, camera, orbit, lighting rig with presets, the
// neutral PMREM environment (metals need one to read as metal), ground plate,
// grid, view presets, double-click re-targeting, turntable, screenshot.
// Everything visual that is not the character or a fitted piece lives here.

import { loadPrefs, savePrefs } from '/fit_studio/ui.js';
import { OrbitControls, RoomEnvironment, THREE } from '/three.bundle.js';

export const HEAD = new THREE.Vector3(0, 1.72, 0);
const DEFAULT_CAM = { pos: [0.7, 2.02, 1.45], target: [0, 1.72, 0] };

const container = document.getElementById('viewport');

export const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: false });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 60);
camera.position.set(...DEFAULT_CAM.pos);

export const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.copy(HEAD);
orbit.enableDamping = true;
orbit.dampingFactor = 0.12;
orbit.maxDistance = 12;
orbit.minDistance = 0.15;

// ---------------------------------------------------------------------------
// Environment + lights
// ---------------------------------------------------------------------------
const pmrem = new THREE.PMREMGenerator(renderer);
const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();
scene.environment = envTexture;

const hemi = new THREE.HemisphereLight(0xcfd8e8, 0x3a3630, 0.55);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 1.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.2;
key.shadow.camera.far = 10;
key.shadow.camera.left = key.shadow.camera.bottom = -1.6;
key.shadow.camera.right = key.shadow.camera.top = 1.6;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.015;
key.target.position.set(0, 1.1, 0);
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0xaebbd0, 0.45);
fill.position.set(-1.8, 1.4, -1.2);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xdfe8ff, 0.7);
rim.position.set(-0.6, 2.4, -2.2);
scene.add(rim);

/** Key light aimed by azimuth/elevation around the character. */
function aimKey(azimuthDeg, elevationDeg) {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  const r = 3.2;
  key.position.set(
    Math.sin(az) * Math.cos(el) * r,
    1.1 + Math.sin(el) * r,
    Math.cos(az) * Math.cos(el) * r,
  );
}

export const LIGHT_PRESETS = {
  studio: {
    env: 0.9,
    hemi: 0.5,
    key: 1.5,
    fill: 0.45,
    rim: 0.7,
    az: 38,
    el: 34,
    exposure: 1.12,
    tone: 'aces',
  },
  game: {
    env: 0.0,
    hemi: 1.15,
    key: 1.6,
    fill: 0.5,
    rim: 0.0,
    az: 42,
    el: 38,
    exposure: 1.0,
    tone: 'none',
  },
  soft: {
    env: 1.15,
    hemi: 0.9,
    key: 0.55,
    fill: 0.35,
    rim: 0.25,
    az: 20,
    el: 40,
    exposure: 1.05,
    tone: 'aces',
  },
  rim: {
    env: 0.3,
    hemi: 0.28,
    key: 1.25,
    fill: 0.12,
    rim: 1.7,
    az: 55,
    el: 26,
    exposure: 1.1,
    tone: 'aces',
  },
};

export const lighting = { preset: 'studio', ...LIGHT_PRESETS.studio };

export function applyLighting(patch = {}, { markCustom = true } = {}) {
  Object.assign(lighting, patch);
  if (markCustom && !('preset' in patch)) lighting.preset = 'custom';
  if ('environmentIntensity' in scene) {
    scene.environment = envTexture;
    scene.environmentIntensity = lighting.env;
  } else {
    // Older three: no per-scene intensity, all or nothing.
    scene.environment = lighting.env > 0.05 ? envTexture : null;
  }
  hemi.intensity = lighting.hemi;
  key.intensity = lighting.key;
  fill.intensity = lighting.fill;
  rim.intensity = lighting.rim;
  aimKey(lighting.az, lighting.el);
  renderer.toneMapping =
    lighting.tone === 'aces' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
  renderer.toneMappingExposure = lighting.exposure;
  savePrefs({ lighting: { ...lighting } });
  emit('lighting');
}

export function applyLightPreset(name) {
  applyLighting({ preset: name, ...LIGHT_PRESETS[name] }, { markCustom: false });
}

// ---------------------------------------------------------------------------
// Ground + grid
// ---------------------------------------------------------------------------
function groundTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(148,158,178,0.30)');
  grad.addColorStop(0.55, 'rgba(120,130,150,0.12)');
  grad.addColorStop(1, 'rgba(120,130,150,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const groundDisc = new THREE.Mesh(
  new THREE.CircleGeometry(2.2, 64).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ map: groundTexture(), transparent: true, depthWrite: false }),
);
groundDisc.renderOrder = -2;
const groundShadow = new THREE.Mesh(
  new THREE.CircleGeometry(2.2, 64).rotateX(-Math.PI / 2),
  new THREE.ShadowMaterial({ opacity: 0.34 }),
);
groundShadow.receiveShadow = true;
groundShadow.position.y = 0.001;
scene.add(groundDisc, groundShadow);

const grid = new THREE.GridHelper(4, 40, 0x39445a, 0x232a38);
grid.material.transparent = true;
grid.material.opacity = 0.5;
grid.position.y = 0.002;
grid.visible = false;
scene.add(grid);

// ---------------------------------------------------------------------------
// Toggles: grid / wireframe / turntable / background
// ---------------------------------------------------------------------------
export const view = { grid: false, wireframe: false, turntable: false, background: 'dark' };

export function setGrid(on) {
  view.grid = on;
  grid.visible = on;
  savePrefs({ grid: on });
  emit('view');
}

export function setWireframe(on) {
  view.wireframe = on;
  scene.traverse((o) => {
    if ((!o.isMesh && !o.isSkinnedMesh) || o.userData.noFocus) return;
    if (o === groundDisc || o === groundShadow) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m && 'wireframe' in m) m.wireframe = on;
    }
  });
  emit('view');
}

export function setTurntable(on) {
  view.turntable = on;
  orbit.autoRotate = on;
  orbit.autoRotateSpeed = 1.6;
  emit('view');
}

const BG_FILL = { dark: '#0e1116', flat: '#14171d', light: '#b9bec9', chroma: '#12a04a' };
export function setBackground(name) {
  view.background = name;
  container.className = name === 'dark' ? '' : `bg-${name}`;
  savePrefs({ background: name });
  emit('view');
}

// ---------------------------------------------------------------------------
// Views / framing / focus
// ---------------------------------------------------------------------------
const VIEW_DIRS = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 1, 0.0001],
  iso: [0.55, 0.45, 0.72],
};

export function setView(name) {
  const dir = VIEW_DIRS[name];
  if (!dir) return;
  const d = camera.position.distanceTo(orbit.target) || 1.6;
  const v = new THREE.Vector3(...dir).normalize().multiplyScalar(d);
  camera.position.copy(orbit.target).add(v);
  camera.updateProjectionMatrix();
  emit('view');
}

export function frame(target = HEAD, distance = 1.75) {
  glideTo(target, distance);
}

// Smooth retarget: glide orbit.target (and pull the camera along) over ~220ms.
let glide = null;
export function glideTo(point, distance = null) {
  const from = orbit.target.clone();
  const camFrom = camera.position.clone();
  let camTo = null;
  if (distance !== null) {
    const dir = camera.position.clone().sub(orbit.target).normalize();
    camTo = point.clone().add(dir.multiplyScalar(distance));
  } else {
    camTo = camFrom.clone().add(point.clone().sub(from));
  }
  glide = { from, to: point.clone(), camFrom, camTo, t: 0 };
}

renderer.domElement.addEventListener('dblclick', (e) => {
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1,
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const meshes = [];
  scene.traverse((o) => {
    if (
      (o.isMesh || o.isSkinnedMesh) &&
      o.visible &&
      !o.userData.noFocus &&
      o !== groundDisc &&
      o !== groundShadow
    )
      meshes.push(o);
  });
  const hits = ray.intersectObjects(meshes, false);
  if (hits.length) glideTo(hits[0].point);
});

// ---------------------------------------------------------------------------
// Screenshot
// ---------------------------------------------------------------------------
export function screenshot(name = 'fit-studio') {
  renderer.render(scene, camera);
  const src = renderer.domElement;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const g = out.getContext('2d');
  g.fillStyle = BG_FILL[view.background] ?? '#0e1116';
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(src, 0, 0);
  out.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }, 'image/png');
}

// ---------------------------------------------------------------------------
// Loop + resize + fps
// ---------------------------------------------------------------------------
const tickers = new Set();
export function onTick(fn) {
  tickers.add(fn);
  return () => tickers.delete(fn);
}

export const stats = { fps: 0 };
let frames = 0;
let fpsAt = performance.now();

const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, clock.getDelta());
  if (glide) {
    glide.t = Math.min(1, glide.t + dt / 0.22);
    const k = glide.t * glide.t * (3 - 2 * glide.t);
    orbit.target.lerpVectors(glide.from, glide.to, k);
    camera.position.lerpVectors(glide.camFrom, glide.camTo, k);
    if (glide.t >= 1) glide = null;
  }
  orbit.update();
  for (const fn of tickers) fn(dt);
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - fpsAt > 500) {
    stats.fps = Math.round((frames * 1000) / (now - fpsAt));
    frames = 0;
    fpsAt = now;
  }
}

export function renderOnce() {
  renderer.render(scene, camera);
}

function resize() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(container);

// ---------------------------------------------------------------------------
// Change events + persistence
// ---------------------------------------------------------------------------
const listeners = new Set();
function emit(what) {
  for (const fn of listeners) fn(what);
}
export function onViewportChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let camTimer = 0;
orbit.addEventListener('change', () => {
  clearTimeout(camTimer);
  camTimer = setTimeout(() => {
    savePrefs({ camera: { pos: camera.position.toArray(), target: orbit.target.toArray() } });
  }, 600);
});

export function resetCamera() {
  camera.position.set(...DEFAULT_CAM.pos);
  orbit.target.set(...DEFAULT_CAM.target);
}

export function initViewport() {
  const prefs = loadPrefs();
  if (prefs.camera?.pos?.length === 3) {
    camera.position.set(...prefs.camera.pos);
    orbit.target.set(...prefs.camera.target);
  }
  if (prefs.lighting) applyLighting({ ...prefs.lighting }, { markCustom: false });
  else applyLightPreset('studio');
  if (prefs.background) setBackground(prefs.background);
  if (prefs.grid) setGrid(true);
  resize();
  tick();
}
