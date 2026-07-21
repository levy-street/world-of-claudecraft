// Browser-side entry for the EPIC chrome previewer. Uses a real PBR metal
// material so the skins read as mirror chrome: metalness=1 + low roughness with
// a procedural studio environment map (PMREM) for reflections. The chrome lives
// in the MATERIAL, tinted by the clean albedo (which also carries panel detail +
// baked ★ sparkles). An emissive map keeps the visor eyes glowing.
// IMPORTANT: NO bloom / postprocessing — all shine stays ON the model surface,
// within the silhouette (the earlier bloom spilled outside; that was rejected).
// Exposes window.renderEpic(glbB64, albedoB64, emisB64) -> png data URL.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const SIZE = 1920;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(SIZE, SIZE);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
document.body.appendChild(renderer.domElement);

function b64ToArrayBuffer(b64) {
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}
function loadImage(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}
function tex(img, srgb) {
  const t = new THREE.Texture(img);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.flipY = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t;
}

// procedural studio environment (equirect): bright softboxes over a sky->ground
// gradient -> clean chrome streaks + a dark lower hemisphere for contrast.
function makeEnv() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.0, '#aebccd'); g.addColorStop(0.42, '#f2f6fb');
  g.addColorStop(0.5, '#dde4ec'); g.addColorStop(0.6, '#5c6573'); g.addColorStop(1.0, '#10141a');
  x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
  const box = (cx, cy, rx, ry, a) => {
    x.save(); x.translate(cx, cy); x.scale(rx, ry);
    const rg = x.createRadialGradient(0, 0, 0, 0, 0, 1);
    rg.addColorStop(0, `rgba(255,255,255,${a})`); rg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = rg; x.beginPath(); x.arc(0, 0, 1, 0, Math.PI * 2); x.fill(); x.restore();
  };
  box(250, 150, 210, 90, 0.9); box(770, 165, 175, 78, 0.8);
  box(512, 86, 140, 56, 0.6); box(120, 235, 110, 56, 0.5);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true; return t;
}

let inited = false, material = null, scene = null, cam = null;

function init(glbB64) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(b64ToArrayBuffer(glbB64), '', (gltf) => {
      try {
        scene = new THREE.Scene();
        const pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader();
        scene.environment = pmrem.fromEquirectangular(makeEnv()).texture;

        const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 4, 3); scene.add(key);
        const rim = new THREE.DirectionalLight(0xbfd4ff, 1.8); rim.position.set(-2.5, 2, -4); scene.add(rim);
        scene.add(new THREE.AmbientLight(0xffffff, 0.18));

        const obj = gltf.scene;
        obj.rotation.set(0, Math.PI * 0.16, 0);
        obj.traverse((o) => { if (o.isMesh && o.material) material = o.material; });
        const root = new THREE.Group(); root.add(obj); scene.add(root);

        const bb = new THREE.Box3().setFromObject(obj);
        obj.position.sub(bb.getCenter(new THREE.Vector3()));
        const r = bb.getBoundingSphere(new THREE.Sphere()).radius || 1;
        const fov = 30;
        cam = new THREE.PerspectiveCamera(fov, 1, 0.01, 100);
        const dist = (r / Math.sin((fov * Math.PI) / 360)) * 0.95;
        cam.position.set(dist * 0.26, dist * 0.10, dist);
        cam.lookAt(0, r * 0.06, 0);

        renderer.setClearColor(0x14171d, 1);
        inited = true; resolve();
      } catch (e) { reject(e); }
    }, reject);
  });
}

window.renderEpic = async (glbB64, albedoB64, emisB64) => {
  if (!inited) await init(glbB64);
  const [aImg, eImg] = await Promise.all([
    loadImage('data:image/png;base64,' + albedoB64),
    loadImage('data:image/png;base64,' + emisB64),
  ]);
  if (material.map) material.map.dispose();
  if (material.emissiveMap) material.emissiveMap.dispose();
  material.map = tex(aImg, true);
  material.metalness = 1.0;       // full chrome — the look the user locked on
  material.roughness = 0.2;       // sharp mirror-ish reflections
  material.envMapIntensity = 1.15;
  material.emissiveMap = tex(eImg, true);
  material.emissive = new THREE.Color(0xffffff);
  material.emissiveIntensity = 1.5;
  material.needsUpdate = true;
  renderer.render(scene, cam);    // NO composer / bloom
  return renderer.domElement.toDataURL('image/png');
};

window.__ready = true;
