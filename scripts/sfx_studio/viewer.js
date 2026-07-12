// Small 3D animation-context viewer used only by the local SFX Studio.
import { GLTFLoader, MeshoptDecoder, OrbitControls, THREE } from '/three.bundle.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
let session = null;

function disposeObject(root) {
  root.traverse((object) => {
    object.geometry?.dispose();
    if (!object.material) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      material.map?.dispose();
      material.dispose();
    }
  });
}

function close() {
  const current = session;
  session = null;
  if (!current) return;
  cancelAnimationFrame(current.raf);
  window.removeEventListener('resize', current.resize);
  current.mixer?.stopAllAction();
  current.controls.dispose();
  for (const root of current.roots) disposeObject(root);
  current.renderer.dispose();
}

function loadGlb(url) {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

function normalize(root, targetHeight = 2.6) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const height = bounds.max.y - bounds.min.y || 1;
  root.scale.setScalar(targetHeight / height);
  root.updateMatrixWorld(true);
  const normalized = new THREE.Box3().setFromObject(root);
  const center = normalized.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -normalized.min.y, -center.z);
  root.updateMatrixWorld(true);
}

function frame(camera, controls, root) {
  const bounds = new THREE.Box3().setFromObject(root);
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(0.6, sphere.radius);
  controls.target.copy(sphere.center);
  camera.position.set(
    sphere.center.x + radius * 1.45,
    sphere.center.y + radius * 0.75,
    sphere.center.z + radius * 2.4,
  );
  camera.near = Math.max(0.01, radius / 100);
  camera.far = Math.max(100, radius * 30);
  camera.updateProjectionMatrix();
  controls.update();
}

function setClipOptions(current, select, preferred) {
  select.replaceChildren();
  for (const clip of current.clips) {
    const option = document.createElement('option');
    option.value = clip.name;
    option.textContent = `${clip.name} (${clip.duration.toFixed(2)}s)`;
    select.append(option);
  }
  if (!current.clips.length) {
    const option = document.createElement('option');
    option.textContent = 'no animations';
    select.append(option);
  }
  select.disabled = current.clips.length === 0;
  const preferredPattern = preferred ? new RegExp(preferred, 'i') : null;
  const initial =
    current.clips.find((clip) => preferredPattern?.test(clip.name)) ?? current.clips[0];
  const play = (clip) => {
    current.mixer?.stopAllAction();
    current.selectedClip = clip ?? null;
    if (clip && current.mixer) current.mixer.clipAction(clip).reset().play();
  };
  select.onchange = () => play(current.clips.find((clip) => clip.name === select.value));
  if (initial) {
    select.value = initial.name;
    play(initial);
  }
}

async function open(asset, ui) {
  close();
  const renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const stageColors = {
    vale: 0x223629,
    grass: 0x223629,
    marsh: 0x28322e,
    water: 0x1b3140,
    peaks: 0x30343d,
    snow: 0x3b414c,
    rain: 0x222a34,
    fire: 0x3b261d,
    forge: 0x352720,
    dungeon: 0x202127,
    combat: 0x342423,
    magic: 0x25243b,
    creature: 0x2d2924,
  };
  scene.background = new THREE.Color(stageColors[ui.stage] ?? 0x10131a);
  scene.add(new THREE.HemisphereLight(0xdde9ff, 0x182018, 1.7));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.4);
  key.position.set(4, 6, 5);
  scene.add(key);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(6, 48),
    new THREE.MeshStandardMaterial({ color: 0x1b2228, roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const grid = new THREE.GridHelper(12, 24, 0x3a414c, 0x2b313a);
  scene.add(grid);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 500);
  const controls = new OrbitControls(camera, ui.canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  const current = {
    renderer,
    scene,
    camera,
    controls,
    roots: [ground, grid],
    mixer: null,
    clips: [],
    selectedClip: null,
    manualTransport: false,
    raf: 0,
    resize: null,
  };
  session = current;
  current.resize = () => {
    const rect = ui.canvas.getBoundingClientRect();
    const width = Math.max(2, Math.round(rect.width));
    const height = Math.max(2, Math.round(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', current.resize);
  current.resize();
  ui.statusEl.textContent = 'loading animation context...';

  try {
    const gltf = await loadGlb(`/repo/${asset.repoGlb}`);
    if (session !== current) {
      disposeObject(gltf.scene);
      return;
    }
    normalize(gltf.scene);
    scene.add(gltf.scene);
    current.roots.push(gltf.scene);
    current.clips = gltf.animations ?? [];
    current.mixer = current.clips.length ? new THREE.AnimationMixer(gltf.scene) : null;
    setClipOptions(current, ui.clipSelect, ui.preferredClip);
    frame(camera, controls, gltf.scene);
    ui.statusEl.textContent = current.clips.length
      ? `${current.clips.length} animations - drag to rotate, scroll to zoom`
      : 'static model - drag to rotate, scroll to zoom';
  } catch (error) {
    if (session === current) {
      ui.statusEl.textContent = `failed to load: ${String(error?.message ?? error).slice(0, 120)}`;
    }
  }

  let last = performance.now();
  const tick = (now) => {
    if (session !== current) return;
    const elapsed = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (!current.manualTransport) current.mixer?.update(elapsed);
    controls.update();
    renderer.render(scene, camera);
    current.raf = requestAnimationFrame(tick);
  };
  current.raf = requestAnimationFrame(tick);
}

window.LiveViewer = {
  close,
  open,
  seek(seconds) {
    if (!session?.mixer) return;
    session.manualTransport = true;
    session.mixer.setTime(Math.max(0, Number(seconds) || 0));
  },
  resume() {
    if (session) session.manualTransport = false;
  },
  transportInfo() {
    if (!session) return null;
    return {
      clips: session.clips.map((clip) => ({ name: clip.name, duration: clip.duration })),
      selected: session.selectedClip?.name ?? null,
      duration: session.selectedClip?.duration ?? 0,
    };
  },
};
