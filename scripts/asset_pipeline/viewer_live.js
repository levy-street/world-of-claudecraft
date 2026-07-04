// Live 3D viewer module for the asset library. Served (with three.bundle.js and
// /repo/*) by `pipeline.mjs library --serve`. Renders the REAL GLB for the
// selected asset with orbit controls (drag to rotate, scroll to zoom), a ground
// plane + grid for context, a per-animation clip selector with playback, and
// live skin-atlas application for skin assets. A "vs player" toggle drops the
// knight in beside the asset at true in-game heights; for weapons a "held by"
// selector attaches the weapon to any character model (class bodies + generated
// skin models) through the game's exact variant-grip math and animates it.
//
// Exposes window.LiveViewer.{open(asset, ui), close()} for the page's grid
// script to drive on detail open/close.
import { GLTFLoader, MeshoptDecoder, OrbitControls, THREE } from '/three.bundle.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader();
const KNIGHT = 'public/models/chars/players/knight.glb';

// Mirror of VARIANT_GRIPS in src/render/characters/assets.ts (lift along the
// hand bone + max world height, scale only ever reduced).
const FAMILY_GRIPS = {
  sword: { lift: 0.04, maxHeight: 2.0 },
  dagger: { lift: 0.04, maxHeight: 1.4 },
  axe: { lift: 0.04, maxHeight: 1.5 },
  staff: { lift: 0.18, maxHeight: 2.4 },
  wand: { lift: 0.04, maxHeight: 1.2 },
  polearm: { lift: 0.18, maxHeight: 2.5 },
};

function loadGlb(url) {
  return new Promise((res, rej) => loader.load(url, res, undefined, rej));
}
function loadTex(url) {
  return new Promise((res, rej) => texLoader.load(url, res, undefined, rej));
}

// Applied weapons live under category 'weapons'; freshly generated ones are
// job assets on the weapon lane. Both must equip identically.
function isWeaponAsset(asset) {
  return asset.category === 'weapons' || asset.job?.lane === 'weapon';
}

function displayHeight(asset) {
  if (asset.kind === 'skin') return 2.6;
  if (isWeaponAsset(asset))
    return asset.family === 'staff' ? 2.3 : asset.family === 'dagger' ? 1.3 : 2.0;
  if (asset.category === 'props') {
    const b = asset.inspect?.bounds;
    return b ? Math.max(0.5, b.max[1] - b.min[1]) : 2;
  }
  return 2.6;
}

function makeLights(scene) {
  const key = new THREE.DirectionalLight(0xfff0dc, 2.3);
  key.position.set(4, 6, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9fb6e0, 0.9);
  fill.position.set(-5, 2, -2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1.1);
  rim.position.set(0, 3, -6);
  scene.add(rim);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
}

function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

function normalize(obj, targetH) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const h = box.max.y - box.min.y || 1;
  obj.scale.setScalar(targetH / h);
  obj.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(obj);
  const c = b2.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= b2.min.y;
  obj.updateMatrixWorld(true);
}

function applyAtlas(obj, tex) {
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
}

function findHandslot(rig) {
  let bone = null;
  rig.traverse((o) => {
    const n = o.name.replace(/[[\].:/]/g, '');
    if (n === 'handslotr') bone = o;
  });
  return bone;
}

// Attach a weapon scene to a rig's handslot.r with the game's variant grip.
function attachWeapon(rig, weaponScene, family) {
  const slot = findHandslot(rig);
  if (!slot) return false;
  const grip = FAMILY_GRIPS[family] ?? FAMILY_GRIPS.sword;
  const box = new THREE.Box3().setFromObject(weaponScene);
  const h = box.max.y - box.min.y;
  const s = h > 1e-3 ? Math.min(1, grip.maxHeight / h) : 1;
  weaponScene.position.set(0, grip.lift, 0);
  weaponScene.quaternion.set(0, 1, 0, 0);
  weaponScene.scale.setScalar(s);
  slot.add(weaponScene);
  return true;
}

let session = null;

function teardown() {
  if (!session) return;
  cancelAnimationFrame(session.raf);
  session.controls.dispose();
  for (const root of session.roots) {
    session.scene.remove(root);
    disposeObject(root);
  }
  session.renderer.dispose();
  window.removeEventListener('resize', session.onResize);
  session = null;
}

window.LiveViewer = {
  close: teardown,

  async open(asset, ui) {
    teardown();
    const { canvas, clipSelect, statusEl, contextToggle, heldBySelect, charOptions } = ui;
    const setStatus = (t) => {
      if (statusEl) statusEl.textContent = t;
    };
    setStatus('loading model...');

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    makeLights(scene);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(6, 48),
      new THREE.MeshStandardMaterial({ color: 0x262b34, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const grid = new THREE.GridHelper(12, 24, 0x3a414c, 0x2b313a);
    scene.add(grid);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 500);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    session = {
      renderer,
      scene,
      camera,
      controls,
      roots: [ground, grid],
      mixers: [],
      raf: 0,
      onResize: null,
    };

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      renderer.setSize(Math.max(2, r.width), Math.max(2, r.height), false);
      camera.aspect = Math.max(2, r.width) / Math.max(2, r.height);
      camera.updateProjectionMatrix();
    };
    session.onResize = resize;
    window.addEventListener('resize', resize);
    resize();

    // Clip playback drives whichever root is "active" (the asset itself, or the
    // holding character in held-by mode).
    let active = null; // { mixer, clips }
    const playClip = (name) => {
      if (!active?.mixer) return;
      active.mixer.stopAllAction();
      const clip = active.clips.find((c) => c.name === name) ?? active.clips[0];
      if (clip) active.mixer.clipAction(clip).reset().play();
    };
    const setClipOptions = (clips, preferred) => {
      if (!clipSelect) return;
      clipSelect.innerHTML = clips.length
        ? clips
            .map((c) => `<option value="${c.name}">${c.name} (${c.duration.toFixed(2)}s)</option>`)
            .join('')
        : '<option>no animations</option>';
      clipSelect.disabled = clips.length === 0;
      clipSelect.onchange = () => playClip(clipSelect.value);
      const start =
        clips.find((c) => (preferred ? preferred.test(c.name) : false)) ??
        clips.find((c) => /^idle$/i.test(c.name)) ??
        clips.find((c) => /idle/i.test(c.name)) ??
        clips.find((c) => /walk/i.test(c.name)) ??
        clips[0];
      if (start) {
        playClip(start.name);
        clipSelect.value = start.name;
      }
    };
    const frameOn = (targets, pad) => {
      const box = new THREE.Box3();
      for (const t of targets) box.expandByObject(t);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const r = sphere.radius || 1;
      const dist = (r / Math.sin((35 * Math.PI) / 360)) * (pad ?? 1.25);
      controls.target.copy(sphere.center);
      camera.position.set(
        sphere.center.x + dist * 0.35,
        sphere.center.y + r * 0.3,
        sphere.center.z + dist,
      );
      camera.near = r / 100;
      camera.far = r * 100;
      camera.updateProjectionMatrix();
      controls.update();
    };

    try {
      const targetH = displayHeight(asset);
      const gltf = await loadGlb(`/repo/${asset.repoGlb}`);
      const obj = gltf.scene;
      if (asset.repoAtlas) {
        try {
          applyAtlas(obj, await loadTex(`/repo/${asset.repoAtlas}`));
        } catch {
          setStatus('(atlas failed to load; showing base model)');
        }
      }
      normalize(obj, targetH);
      scene.add(obj);
      session.roots.push(obj);
      const clips = gltf.animations ?? [];
      if (clips.length) {
        const mixer = new THREE.AnimationMixer(obj);
        session.mixers.push(mixer);
        active = { mixer, clips };
      } else {
        active = { mixer: null, clips: [] };
      }
      setClipOptions(clips);
      frameOn([obj]);
      setStatus(
        clips.length
          ? `${clips.length} animations - drag to rotate, scroll to zoom`
          : 'static model - drag to rotate',
      );

      // Optional scale context: the knight beside the asset.
      let knightRoot = null;
      const addContext = async () => {
        if (knightRoot || asset.repoGlb.endsWith('knight.glb')) return;
        const kg = await loadGlb(`/repo/${KNIGHT}`);
        knightRoot = kg.scene;
        normalize(knightRoot, 2.6);
        knightRoot.position.x = -1.6;
        obj.position.x = 1.6;
        const km = new THREE.AnimationMixer(knightRoot);
        const kidle = (kg.animations ?? []).find((c) => /^idle$/i.test(c.name));
        if (kidle) km.clipAction(kidle).play();
        session.mixers.push(km);
        scene.add(knightRoot);
        session.roots.push(knightRoot);
        frameOn([obj, knightRoot], 1.15);
      };
      const removeContext = () => {
        if (!knightRoot) return;
        scene.remove(knightRoot);
        disposeObject(knightRoot);
        session.roots = session.roots.filter((r) => r !== knightRoot);
        session.mixers = session.mixers.slice(0, 1);
        knightRoot = null;
        obj.position.x = 0;
        frameOn([obj]);
      };
      if (contextToggle) {
        contextToggle.checked = false;
        contextToggle.onchange = () => (contextToggle.checked ? addContext() : removeContext());
      }

      // "Held by": weapons attach to any character model through the game's
      // variant-grip math, animated with that character's clips.
      let holder = null; // { root, mixer }
      const clearHolder = () => {
        if (!holder) return;
        scene.remove(holder.root);
        disposeObject(holder.root);
        session.roots = session.roots.filter((r) => r !== holder.root);
        session.mixers = session.mixers.filter((m) => m !== holder.mixer);
        holder = null;
      };
      const setHeldBy = async (repoGlb) => {
        clearHolder();
        if (!repoGlb) {
          obj.visible = true;
          active = session.mixers.length
            ? { mixer: session.mixers[0], clips }
            : { mixer: null, clips: [] };
          setClipOptions(clips);
          frameOn([obj]);
          setStatus('static model - drag to rotate');
          return;
        }
        setStatus('loading character...');
        const cg = await loadGlb(`/repo/${repoGlb}`);
        const root = cg.scene;
        normalize(root, 2.6);
        const wg = await loadGlb(`/repo/${asset.repoGlb}`);
        const attached = attachWeapon(root, wg.scene, asset.family);
        obj.visible = false;
        scene.add(root);
        session.roots.push(root);
        const mixer = new THREE.AnimationMixer(root);
        session.mixers.push(mixer);
        holder = { root, mixer };
        active = { mixer, clips: cg.animations ?? [] };
        setClipOptions(active.clips, /attack|chop|slash/i);
        frameOn([root]);
        setStatus(
          attached
            ? `held via handslot.r - ${active.clips.length} animations`
            : 'character has NO handslot.r bone (weapon not attached)',
        );
      };
      if (heldBySelect) {
        const isWeapon = isWeaponAsset(asset);
        heldBySelect.parentElement.style.display = isWeapon ? '' : 'none';
        if (isWeapon) {
          const opts = ['<option value="">weapon only</option>'].concat(
            (charOptions ?? []).map((c) => `<option value="${c.repoGlb}">${c.label}</option>`),
          );
          heldBySelect.innerHTML = opts.join('');
          heldBySelect.onchange = () => setHeldBy(heldBySelect.value || null);
          // Weapons open EQUIPPED by default: the knight holding it, playing
          // its attack clip, so grip and scale are reviewable at a glance.
          const knight = (charOptions ?? []).find((c) => c.label === 'knight');
          if (knight) {
            heldBySelect.value = knight.repoGlb;
            await setHeldBy(knight.repoGlb);
          }
        }
      }
    } catch (err) {
      setStatus(`failed to load: ${String(err.message ?? err).slice(0, 120)}`);
      return;
    }

    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      for (const m of session.mixers) m.update(dt);
      controls.update();
      renderer.render(scene, camera);
      session.raf = requestAnimationFrame(tick);
    };
    tick();
  },
};
