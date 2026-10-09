import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

const payload = window.ASSET;
const bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const originalFetch = window.fetch.bind(window);
window.fetch = (input, options) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.endsWith('basis_transcoder.js'))
    return Promise.resolve(new Response(bytes(payload.basisJS), { status: 200 }));
  if (url.endsWith('basis_transcoder.wasm'))
    return Promise.resolve(new Response(bytes(payload.basisWasm), { status: 200 }));
  return originalFetch(input, options);
};
const renderer = new THREE.WebGLRenderer({ antialias: true });
let contextLost = false;
renderer.domElement.addEventListener('webglcontextlost', () => {
  contextLost = true;
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight - 90);
renderer.setClearColor(0x16232d);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xc4e8ff, 0x353023, 2.4));
for (const [pos, color, intensity] of [
  [[4, 8, 6], 0xffe1bd, 3],
  [[-4, 5, -3], 0x78bcff, 4],
]) {
  const l = new THREE.DirectionalLight(color, intensity);
  l.position.set(...pos);
  if (pos[0] > 0) {
    l.castShadow = true;
    l.shadow.mapSize.set(1024, 1024);
    Object.assign(l.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 0.1, far: 30 });
    l.shadow.normalBias = 0.025;
  }
  scene.add(l);
}
const camera = new THREE.PerspectiveCamera(40, innerWidth / (innerHeight - 90), 0.05, 100);
camera.position.set(7, 4.3, 10);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-0.3, 2, 0);
controls.update();
const ktx = new KTX2Loader()
  .setTranscoderPath('embedded/')
  .setWorkerLimit(1)
  .detectSupport(renderer);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx);
const model = await loader.parseAsync(bytes(payload.glb).buffer, '');
scene.add(model.scene);
const knight = await loader.parseAsync(bytes(payload.knight).buffer, '');
const kb = new THREE.Box3().setFromObject(knight.scene);
const scale = 2.6 / (kb.max.y - kb.min.y);
knight.scene.scale.setScalar(scale);
knight.scene.position.set(-2.4, -kb.min.y * scale, 0);
scene.add(knight.scene);
for (const root of [model.scene, knight.scene])
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x34434b, roughness: 0.9 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.018;
floor.receiveShadow = true;
scene.add(floor);
const mixer = new THREE.AnimationMixer(model.scene),
  select = document.querySelector('select'),
  slider = document.querySelector('input');
let active,
  playing = false,
  time = 0,
  last = performance.now();
for (const clip of model.animations) select.add(new Option(clip.name, clip.name));
function sample(name, t = 0) {
  if (contextLost || renderer.getContext().isContextLost()) throw new Error('WebGL context lost');
  mixer.stopAllAction();
  const clip = model.animations.find((c) => c.name === name);
  active = mixer.clipAction(clip);
  active.setLoop(THREE.LoopOnce, 1);
  active.clampWhenFinished = true;
  active.play();
  mixer.setTime(t);
  scene.updateMatrixWorld(true);
  renderer.render(scene, camera);
  slider.max = clip.duration;
  slider.value = t;
  return clip.duration;
}
select.value = 'Idle';
sample('Idle');
select.onchange = () => {
  time = 0;
  sample(select.value);
};
slider.oninput = () => {
  time = +slider.value;
  sample(select.value, time);
};
document.querySelector('button').onclick = () => {
  playing = !playing;
  document.querySelector('button').textContent = playing ? 'Pausar' : 'Reproducir';
  last = performance.now();
};
controls.addEventListener('change', () => renderer.render(scene, camera));
function tick(now) {
  requestAnimationFrame(tick);
  if (!playing) return;
  const dt = (now - last) / 1000;
  if (dt < 1 / 30) return;
  last = now;
  time += Math.min(dt, 0.1);
  if (time > +slider.max) time = 0;
  sample(select.value, time);
}
requestAnimationFrame(tick);
addEventListener('resize', () => {
  camera.aspect = innerWidth / (innerHeight - 90);
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight - 90);
  renderer.render(scene, camera);
});
let compressed = 0;
model.scene.traverse((o) => {
  if (o.isMesh && o.material.map?.isCompressedTexture) compressed++;
});
function pixelStats() {
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  if (contextLost || gl.isContextLost()) return { lost: true, colors: 0 };
  const w = gl.drawingBufferWidth,
    h = gl.drawingBufferHeight;
  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const colors = new Set();
  for (let i = 0; i < pixels.length; i += 4 * Math.max(1, Math.floor((w * h) / 12000))) {
    colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
  }
  return { lost: false, colors: colors.size, glError: gl.getError() };
}
window.assetReview = {
  ready: true,
  clips: model.animations.map((c) => ({ name: c.name, duration: c.duration })),
  compressedMaterials: compressed,
  sample,
  model,
  pixelStats,
};
document.querySelector('#status').textContent =
  'Arrastra para girar. Rueda para acercar. Visor pausado al abrir.';
