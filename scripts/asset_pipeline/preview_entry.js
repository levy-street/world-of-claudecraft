// Browser-side entry for the asset-pipeline preview renderer. Bundled by
// esbuild into a self-contained IIFE and injected into a blank page by
// lib/preview.mjs. Parses GLB bytes directly (no fetch) so it runs offline
// under headless swiftshader.
//
//   window.renderViews(b64, {views, size}) -> [{name, dataUrl}]
//     4 yaw turntable views plus a hero three-quarter; for rigged models one
//     mid-pose frame per animation clip (catches T-pose/broken-rig failures).
//   window.renderIcon(b64) -> jpeg data URL (HUD bag-icon style, hero pose)
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

function makeLights() {
  const g = new THREE.Group();
  const key = new THREE.DirectionalLight(0xfff0dc, 2.4);
  key.position.set(2.5, 4, 3);
  g.add(key);
  const fill = new THREE.DirectionalLight(0x9fb6e0, 1.0);
  fill.position.set(-3, 1, -1.5);
  g.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1.2);
  rim.position.set(0, 2, -4);
  g.add(rim);
  g.add(new THREE.AmbientLight(0xffffff, 0.55));
  return g;
}

function b64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

function parseGlb(b64) {
  return new Promise((resolve, reject) => {
    loader.parse(b64ToArrayBuffer(b64), '', resolve, reject);
  });
}

function frame(scene, obj, yaw, size) {
  obj.rotation.set(0, yaw, 0);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = sphere.radius || 1;
  const fov = 32;
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.01, 1000);
  const dist = (r / Math.sin((fov * Math.PI) / 360)) * 1.12;
  cam.position.set(center.x, center.y + dist * 0.1, center.z + dist);
  cam.lookAt(center);
  renderer.setSize(size, size);
  renderer.setClearColor(0x1a1e26, 1);
  renderer.render(scene, cam);
  return renderer.domElement.toDataURL('image/png');
}

function dispose(obj, scene) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    }
  });
  scene.clear();
}

const ALL_YAWS = [
  ['front', 0],
  ['right', Math.PI / 2],
  ['back', Math.PI],
  ['left', -Math.PI / 2],
  ['hero', -Math.PI / 5],
];

// opts.views: subset of view names to render (default all five).
// opts.clips: render one mid-pose frame per animation clip (default true).
window.renderViews = async (b64, opts = {}) => {
  const size = opts.size ?? 512;
  const wanted = opts.views ?? ALL_YAWS.map(([n]) => n);
  const withClips = opts.clips ?? true;
  const gltf = await parseGlb(b64);
  const scene = new THREE.Scene();
  scene.add(makeLights());
  const obj = gltf.scene;
  scene.add(obj);

  const shots = [];
  for (const [name, yaw] of ALL_YAWS) {
    if (wanted.includes(name)) shots.push({ name, dataUrl: frame(scene, obj, yaw, size) });
  }

  const clips = withClips ? (gltf.animations ?? []) : [];
  if (clips.length) {
    const mixer = new THREE.AnimationMixer(obj);
    for (const clip of clips) {
      const action = mixer.clipAction(clip);
      action.reset().play();
      mixer.setTime(Math.max(0.001, clip.duration * 0.4));
      obj.updateMatrixWorld(true);
      shots.push({
        name: `clip_${clip.name.replace(/[^a-zA-Z0-9_]+/g, '_')}`,
        dataUrl: frame(scene, obj, -Math.PI / 5, size),
      });
      action.stop();
      mixer.uncacheClip(clip);
    }
  }

  dispose(obj, scene);
  return shots;
};

// Render a character GLB with an ALTERNATE body atlas applied, the way the
// game's CharacterVisual.setSkin swaps SKINS textures: same UVs, flipY=false
// (glTF convention), sRGB, applied to every material that has a base texture.
window.renderSkin = async (charB64, atlasB64, opts = {}) => {
  const size = opts.size ?? 512;
  const gltf = await parseGlb(charB64);
  const scene = new THREE.Scene();
  scene.add(makeLights());
  const obj = gltf.scene;
  scene.add(obj);

  const img = new Image();
  await new Promise((resolveImg, rejectImg) => {
    img.onload = resolveImg;
    img.onerror = rejectImg;
    img.src = `data:image/png;base64,${atlasB64}`;
  });
  const tex = new THREE.Texture(img);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  obj.traverse((o) => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m.map) {
        m.map = tex;
        m.needsUpdate = true;
      }
    }
  });

  const idle = (gltf.animations ?? []).find((c) => /idle/i.test(c.name));
  if (idle) {
    const mixer = new THREE.AnimationMixer(obj);
    mixer.clipAction(idle).reset().play();
    mixer.setTime(Math.max(0.001, idle.duration * 0.3));
  }
  obj.updateMatrixWorld(true);

  const dataUrl = frame(scene, obj, -Math.PI / 5, size);
  tex.dispose();
  dispose(obj, scene);
  return dataUrl;
};

window.renderIcon = async (b64) => {
  const gltf = await parseGlb(b64);
  const scene = new THREE.Scene();
  scene.add(makeLights());
  const obj = gltf.scene;
  obj.rotation.set(0.18, -0.5, -0.42); // diagonal hero pose, matches shipped icons
  scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  obj.position.sub(center);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const r = sphere.radius || 1;
  const fov = 32;
  const cam = new THREE.PerspectiveCamera(fov, 1, 0.01, 100);
  const dist = (r / Math.sin((fov * Math.PI) / 360)) * 1.06;
  cam.position.set(dist * 0.18, dist * 0.12, dist);
  cam.lookAt(0, 0, 0);
  renderer.setSize(256, 256);
  renderer.setClearColor(0x14171d, 1);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/jpeg', 0.86);
  dispose(obj, scene);
  return url;
};

// Pose-matched handslot calibration: pose the REFERENCE rig and the GENERATED
// rig at the same Idle frame, then solve the local rotation the generated slot
// needs so its WORLD orientation equals the reference slot's. Matching at the
// bind pose is NOT enough (verified: each rig's idle rotates the hand
// differently from its own bind, leaving a ~90-degree pitch error at runtime;
// the game plays clips, never the bind pose).
window.computeSlotCalibration = async (refB64, genB64, opts = {}) => {
  const at = opts.at ?? 0.3;
  const clipName = opts.clip ?? 'Idle';
  const load = async (b64) => {
    const gltf = await parseGlb(b64);
    const rig = gltf.scene;
    const clips = gltf.animations ?? [];
    const clip = clips.find((c) => c.name === clipName) ?? clips[0];
    if (clip) {
      const mixer = new THREE.AnimationMixer(rig);
      mixer.clipAction(clip).reset().play();
      mixer.setTime(Math.max(0.001, clip.duration * at));
    }
    rig.updateMatrixWorld(true);
    return rig;
  };
  const ref = await load(refB64);
  const gen = await load(genB64);
  const slotOf = (rig, side) => {
    let slot = null;
    rig.traverse((o) => {
      if (o.name.replace(/[[\].:/]/g, '') === `handslot${side}`) slot = o;
    });
    return slot;
  };
  const out = {};
  for (const side of ['r', 'l']) {
    const refSlot = slotOf(ref, side);
    const genSlot = slotOf(gen, side);
    if (!refSlot || !genSlot?.parent) continue;
    const refWorld = refSlot.getWorldQuaternion(new THREE.Quaternion());
    const handWorld = genSlot.parent.getWorldQuaternion(new THREE.Quaternion());
    const before = genSlot.getWorldQuaternion(new THREE.Quaternion()).angleTo(refWorld);
    const local = handWorld.clone().invert().multiply(refWorld);
    out[side] = {
      quat: [local.x, local.y, local.z, local.w],
      errorBeforeDeg: Math.round((before * 180) / Math.PI),
    };
  }
  dispose(ref, new THREE.Scene());
  dispose(gen, new THREE.Scene());
  return out;
};

// In-hand composite: attach a variant weapon to a character rig exactly the way
// the game does (src/render/characters/assets.ts applyVariantGrip: attach at the
// handslot.r bone origin, lift along the bone, 180-degree flip for the right
// hand, scale only ever clamped down). Proves grip alignment without a dev server.
window.renderHeld = async (charB64, weaponB64, opts = {}) => {
  const size = opts.size ?? 512;
  const lift = opts.lift ?? 0.04;
  const maxHeight = opts.maxHeight ?? 2.0;
  const charGltf = await parseGlb(charB64);
  const weaponGltf = await parseGlb(weaponB64);
  const scene = new THREE.Scene();
  scene.add(makeLights());
  const rig = charGltf.scene;
  scene.add(rig);

  let bone = null;
  rig.traverse((o) => {
    const n = o.name.replace(/[[\].:/]/g, '');
    if (n === 'handslotr') bone = o;
  });
  if (!bone) throw new Error('character rig has no handslot.r bone');

  const payload = weaponGltf.scene;
  const box = new THREE.Box3().setFromObject(payload);
  const h = box.max.y - box.min.y;
  const scale = h > 1e-3 ? Math.min(1, maxHeight / h) : 1;
  payload.position.set(0, lift, 0);
  payload.quaternion.set(0, 1, 0, 0);
  payload.scale.setScalar(scale);
  bone.add(payload);

  const clips = charGltf.animations ?? [];
  const mixer = clips.length ? new THREE.AnimationMixer(rig) : null;
  const poseWith = (clip, at) => {
    if (!mixer || !clip) return;
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.reset().play();
    mixer.setTime(Math.max(0.001, clip.duration * at));
    rig.updateMatrixWorld(true);
  };
  const idle = clips.find((c) => /idle/i.test(c.name));
  poseWith(idle, 0.3);

  const shots = [];
  for (const [name, yaw] of [
    ['held_hero', -Math.PI / 5],
    ['held_right', Math.PI / 2],
  ]) {
    shots.push({ name, dataUrl: frame(scene, rig, yaw, size) });
  }
  // Mid-swing pose: proves the weapon rides the hand through the game's attack
  // animation, not just the idle stance.
  if (opts.attack ?? true) {
    const attack = clips.find((c) => /attack|slash|chop/i.test(c.name));
    if (attack) {
      poseWith(attack, 0.45);
      shots.push({ name: 'held_attack', dataUrl: frame(scene, rig, -Math.PI / 5, size) });
    }
  }
  dispose(rig, scene);
  return shots;
};

// Scale/context comparison: normalize each model to its in-game VisualDef height
// and stand them in a row on a common ground plane, so sizing is directly
// comparable against a reference (the player model). Each entry:
// { b64, height, label }. Returns one PNG data URL.
window.renderScaleCompare = async (entries, opts = {}) => {
  const size = opts.size ?? 640;
  const scene = new THREE.Scene();
  scene.add(makeLights());
  // Ground plane for a shared floor line.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const gap = 2.2;
  let x = -((entries.length - 1) * gap) / 2;
  let maxH = 0;
  const placed = [];
  for (const e of entries) {
    const gltf = await parseGlb(e.b64);
    const obj = gltf.scene;
    // Normalize to target height, feet on the ground.
    const box0 = new THREE.Box3().setFromObject(obj);
    const rawH = box0.max.y - box0.min.y || 1;
    const s = (e.height ?? 2.6) / rawH;
    obj.scale.setScalar(s);
    obj.updateMatrixWorld(true);
    const box1 = new THREE.Box3().setFromObject(obj);
    obj.position.x = x;
    obj.position.y = -box1.min.y;
    obj.rotation.y = -Math.PI / 8;
    // Idle pose if rigged.
    const idle = (gltf.animations ?? []).find((c) => /idle|flying_idle|spider_idle/i.test(c.name));
    if (idle) {
      const mixer = new THREE.AnimationMixer(obj);
      mixer.clipAction(idle).reset().play();
      mixer.setTime(Math.max(0.001, idle.duration * 0.3));
    }
    obj.updateMatrixWorld(true);
    scene.add(obj);
    placed.push({ obj, x });
    maxH = Math.max(maxH, e.height ?? 2.6);
    x += gap;
  }

  const cam = new THREE.PerspectiveCamera(35, 1, 0.01, 200);
  const span = entries.length * gap;
  const dist = Math.max(span, maxH) * 1.4 + 3;
  cam.position.set(0, maxH * 0.55, dist);
  cam.lookAt(0, maxH * 0.45, 0);
  renderer.setSize(size, size);
  renderer.setClearColor(0x14171d, 1);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  for (const p of placed) dispose(p.obj, scene);
  return url;
};

window.__ready = true;
