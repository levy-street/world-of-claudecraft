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
import {
  GLTFLoader,
  MeshoptDecoder,
  OrbitControls,
  THREE,
  TransformControls,
} from '/three.bundle.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader();
const KNIGHT = 'public/models/chars/players/knight.glb';

// Mirror of VARIANT_GRIPS in src/render/characters/assets.ts (lift along the
// hand bone + max world height, scale only ever reduced).
const FAMILY_GRIPS = {
  sword: { lift: 0.04, maxHeight: 2.0 },
  dagger: { lift: 0.04, maxHeight: 1.4 },
  axe: { lift: 0.04, maxHeight: 1.5 },
  hammer: { lift: 0.04, maxHeight: 1.5 },
  mace: { lift: 0.04, maxHeight: 1.5 },
  staff: { lift: 0.18, maxHeight: 2.4 },
  wand: { lift: 0.04, maxHeight: 1.2 },
  polearm: { lift: 0.18, maxHeight: 2.5 },
  book: { lift: 0.04, maxHeight: 1.2 },
  crossbow: { lift: 0.04, maxHeight: 1.6 },
  bow: { lift: 0.04, maxHeight: 2.0 },
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

const DEG2RAD = Math.PI / 180;
const IDENTITY_GRIP = { mx: 0, my: 0, mz: 0, rx: 0, ry: 0, rz: 0, scale: 1 };

// Mirror of variantGripTransform in src/render/characters/weapon_grip.ts: the
// family grip (Y lift + shrink-only clamp + right-hand 180-degree flip) with an
// optional per-weapon fine-tune layered on top (move, rot in DEGREES, scale
// multiplier). `clampScale` is measured ONCE from the native model so live slider
// changes never feed back into the bounding box. This runs on handslot.r only.
function applyGrip(weaponScene, grip, clampScale, s) {
  weaponScene.position.set(s.mx, grip.lift + s.my, s.mz);
  weaponScene.quaternion.set(0, 1, 0, 0);
  weaponScene.quaternion.multiply(
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(s.rx * DEG2RAD, s.ry * DEG2RAD, s.rz * DEG2RAD),
    ),
  );
  weaponScene.scale.setScalar(clampScale * s.scale);
}

// Attach a weapon scene to a rig's handslot.r with the game's variant grip plus
// the given fine-tune state. Returns { grip, clampScale } for later re-application
// (live tuning), or null when the rig has no handslot.r bone.
function attachWeapon(rig, weaponScene, family, state) {
  const slot = findHandslot(rig);
  if (!slot) return null;
  const grip = FAMILY_GRIPS[family] ?? FAMILY_GRIPS.sword;
  const box = new THREE.Box3().setFromObject(weaponScene);
  const h = box.max.y - box.min.y;
  const clampScale = h > 1e-3 ? Math.min(1, grip.maxHeight / h) : 1;
  applyGrip(weaponScene, grip, clampScale, state);
  slot.add(weaponScene);
  return { grip, clampScale };
}

// Slider state <-> the WEAPON_GRIP_OVERRIDE shape the engine registry stores.
function overrideToState(o) {
  return {
    mx: o?.pos?.[0] ?? 0,
    my: o?.pos?.[1] ?? 0,
    mz: o?.pos?.[2] ?? 0,
    rx: o?.rot?.[0] ?? 0,
    ry: o?.rot?.[1] ?? 0,
    rz: o?.rot?.[2] ?? 0,
    scale: o?.scale ?? 1,
  };
}
function stateToOverride(s) {
  const r = (n) => Number(Number(n).toFixed(4));
  const o = {};
  if (s.mx || s.my || s.mz) o.pos = [r(s.mx), r(s.my), r(s.mz)];
  if (s.rx || s.ry || s.rz) o.rot = [r(s.rx), r(s.ry), r(s.rz)];
  if (Number(s.scale) !== 1) o.scale = r(s.scale);
  return o;
}

let session = null;

function teardown() {
  if (!session) return;
  cancelAnimationFrame(session.raf);
  session.gizmo?.dispose();
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
    const {
      canvas,
      clipSelect,
      statusEl,
      contextToggle,
      heldBySelect,
      charOptions,
      gripBar,
      gripInputs,
      gripSaveBtn,
      gripResetBtn,
      gripStatusEl,
      gizmoMoveBtn,
      gizmoRotBtn,
      updateBtn,
      exportBtn,
      exportStatusEl,
    } = ui;
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
      // Live grip fine-tune state, seeded from the weapon's saved override. Only
      // an APPLIED VARIANT weapon has a stable registry key the engine honors:
      // WEAPON_GRIP_OVERRIDES is consulted solely on the applyVariantGrip path
      // (VAR_* families). A generic KayKit weapon (1H_Sword/2H_Staff/...) attaches
      // via applyHandGrip and would ignore a saved override, so Save is disabled
      // for it; job/preview weapons tune live but have no key to save under.
      const gripState = overrideToState(asset.registration?.gripOverride);
      const isVariantWeapon = String(asset.registration?.gripFamily ?? '').startsWith('VAR_');
      // The key a grip override saves under: an applied variant weapon uses its
      // asset name; a Generated-tab weapon that has since been --applied carries
      // that same key on `weaponKey`, so its grip is saveable from that entry too.
      const weaponKey = asset.category === 'weapons' ? asset.name : (asset.weaponKey ?? null);
      const gripKey = isVariantWeapon && weaponKey ? weaponKey : null;
      let heldWeapon = null; // { scene, grip, clampScale }
      const syncGripInputs = () => {
        if (!gripInputs) return;
        for (const k of ['mx', 'my', 'mz', 'rx', 'ry', 'rz', 'scale']) {
          if (gripInputs[k]) gripInputs[k].value = gripState[k];
        }
      };
      const reapplyGrip = () => {
        if (heldWeapon)
          applyGrip(heldWeapon.scene, heldWeapon.grip, heldWeapon.clampScale, gripState);
      };
      if (gripInputs) {
        for (const [k, dflt] of [
          ['mx', 0],
          ['my', 0],
          ['mz', 0],
          ['rx', 0],
          ['ry', 0],
          ['rz', 0],
          ['scale', 1],
        ]) {
          const el = gripInputs[k];
          if (!el) continue;
          el.oninput = () => {
            const v = Number(el.value);
            gripState[k] = el.value === '' || !Number.isFinite(v) ? dflt : v;
            reapplyGrip();
          };
        }
      }
      if (gripResetBtn) {
        gripResetBtn.onclick = () => {
          Object.assign(gripState, IDENTITY_GRIP);
          syncGripInputs();
          reapplyGrip();
          if (gripStatusEl) gripStatusEl.textContent = 'reset (not saved)';
        };
      }
      if (gripSaveBtn) {
        gripSaveBtn.disabled = !gripKey;
        gripSaveBtn.title = gripKey
          ? 'write this grip to WEAPON_GRIP_OVERRIDES'
          : 'grip overrides apply to APPLIED variant weapons only (generate + --apply first)';
        gripSaveBtn.onclick = async () => {
          if (!gripKey) return;
          if (gripStatusEl) gripStatusEl.textContent = 'saving...';
          try {
            const resp = await fetch('/api/grip/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: gripKey, override: stateToOverride(gripState) }),
            });
            const data = await resp.json();
            if (resp.ok) {
              // Persist into the in-memory asset so closing + reopening the viewer
              // (without a page reload) re-seeds the sliders from what was just
              // saved, instead of reverting to the pre-save override.
              asset.registration = asset.registration || {};
              asset.registration.gripOverride = stateToOverride(gripState);
            }
            if (gripStatusEl) {
              gripStatusEl.textContent = resp.ok
                ? (data.actions?.[0] ?? 'saved')
                : `save failed: ${data.error ?? resp.status}`;
            }
          } catch (err) {
            if (gripStatusEl) {
              gripStatusEl.textContent = `save failed: ${String(err.message ?? err).slice(0, 80)}`;
            }
          }
        };
      }
      // --- Transform gizmo -------------------------------------------------
      // Drag the weapon anchor directly (3 move axes + 3 rotate axes), kept in
      // sync with the numeric GRIP FIT fields: it edits the SAME override state
      // applyGrip() consumes, so dragging and typing are interchangeable. Only
      // meaningful once a weapon is held on a character (that's what the grip
      // tunes), so the buttons no-op until then.
      const BASE_FLIP = new THREE.Quaternion(0, 1, 0, 0);
      const _gq = new THREE.Quaternion();
      const _ge = new THREE.Euler();
      const round4 = (n) => Number(n.toFixed(4));
      const gizmo = new TransformControls(camera, renderer.domElement);
      gizmo.setSpace('local');
      gizmo.setSize(0.9);
      gizmo.enabled = false;
      gizmo.visible = false;
      scene.add(gizmo);
      session.gizmo = gizmo;
      let gizmoMode = null; // null | 'translate' | 'rotate'
      gizmo.addEventListener('dragging-changed', (e) => {
        controls.enabled = !e.value; // don't let orbit fight the drag
      });
      // Reverse applyGrip(): position minus the family lift, quaternion minus the
      // 180-degree base flip -> write straight back into gripState + the inputs.
      const syncGizmoToGrip = () => {
        if (!heldWeapon) return;
        const w = heldWeapon.scene;
        gripState.mx = round4(w.position.x);
        gripState.my = round4(w.position.y - heldWeapon.grip.lift);
        gripState.mz = round4(w.position.z);
        _gq.copy(BASE_FLIP).multiply(w.quaternion);
        _ge.setFromQuaternion(_gq, 'XYZ');
        gripState.rx = round4(_ge.x / DEG2RAD);
        gripState.ry = round4(_ge.y / DEG2RAD);
        gripState.rz = round4(_ge.z / DEG2RAD);
        syncGripInputs();
        if (gripStatusEl) gripStatusEl.textContent = 'moved (not saved)';
      };
      gizmo.addEventListener('objectChange', syncGizmoToGrip);
      const paintGizmoButtons = () => {
        if (gizmoMoveBtn)
          gizmoMoveBtn.style.outline = gizmoMode === 'translate' ? '2px solid #ffcf4a' : '';
        if (gizmoRotBtn)
          gizmoRotBtn.style.outline = gizmoMode === 'rotate' ? '2px solid #ffcf4a' : '';
      };
      const reattachGizmo = () => {
        if (gizmoMode && heldWeapon) {
          gizmo.attach(heldWeapon.scene);
          gizmo.setMode(gizmoMode);
          gizmo.enabled = true;
          gizmo.visible = true;
        } else {
          gizmo.detach();
          gizmo.enabled = false;
          gizmo.visible = false;
        }
      };
      const setGizmoMode = (mode) => {
        if (!heldWeapon) {
          setStatus('pick "held by" a character first, then drag the gizmo');
          return;
        }
        gizmoMode = gizmoMode === mode ? null : mode;
        reattachGizmo();
        paintGizmoButtons();
      };
      if (gizmoMoveBtn) gizmoMoveBtn.onclick = () => setGizmoMode('translate');
      if (gizmoRotBtn) gizmoRotBtn.onclick = () => setGizmoMode('rotate');

      const clearHolder = () => {
        if (!holder) return;
        scene.remove(holder.root);
        disposeObject(holder.root);
        session.roots = session.roots.filter((r) => r !== holder.root);
        session.mixers = session.mixers.filter(
          (m) => m !== holder.mixer && m !== holder.weaponMixer,
        );
        holder = null;
      };
      const setHeldBy = async (repoGlb) => {
        clearHolder();
        heldWeapon = null;
        if (gripBar) gripBar.classList.remove('on');
        reattachGizmo(); // nothing held -> detach + hide the gizmo
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
        const attached = attachWeapon(root, wg.scene, asset.family, gripState);
        if (attached) heldWeapon = { scene: wg.scene, ...attached };
        obj.visible = false;
        scene.add(root);
        session.roots.push(root);
        const mixer = new THREE.AnimationMixer(root);
        session.mixers.push(mixer);
        holder = { root, mixer };
        // Keep the weapon's OWN animation running while it's held (e.g. the
        // legendary sword's ring spin / shard bob). Static weapons ship no clips
        // so this is a no-op for them; a weapon that carries an idle clip now
        // plays it in-hand, composed on top of the character's clip and the grip
        // transform (which only touch the weapon root, not its animated child
        // nodes). Tracked on `holder` so clearHolder() disposes it on change.
        const heldClips = wg.animations ?? [];
        if (heldClips.length) {
          const weaponMixer = new THREE.AnimationMixer(wg.scene);
          const idle = heldClips.find((c) => /idle/i.test(c.name)) ?? heldClips[0];
          weaponMixer.clipAction(idle).reset().play();
          session.mixers.push(weaponMixer);
          holder.weaponMixer = weaponMixer;
        }
        active = { mixer, clips: cg.animations ?? [] };
        setClipOptions(active.clips); // default to idle (setClipOptions' built-in preference)
        frameOn([root]);
        if (attached && gripBar) {
          syncGripInputs();
          gripBar.classList.add('on');
        }
        reattachGizmo(); // re-point the gizmo at the newly attached weapon
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
          // Weapons open EQUIPPED by default: the knight holding it in an idle
          // pose, so the grip and scale are reviewable at a glance.
          const knight = (charOptions ?? []).find((c) => c.label === 'knight');
          if (knight) {
            heldBySelect.value = knight.repoGlb;
            await setHeldBy(knight.repoGlb);
          }
        }
      }

      // --- Model workflow: Update Model (step 5) + Compress & Export (step 6)
      const postAction = async (path, payload) => {
        const resp = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return resp.json();
      };
      const setExportStatus = (t) => {
        if (exportStatusEl) exportStatusEl.textContent = t;
      };
      const isModel = Boolean(asset.repoGlb && asset.repoGlb.endsWith('.glb'));
      if (updateBtn) {
        updateBtn.style.display = isModel ? '' : 'none';
        updateBtn.onclick = async () => {
          setExportStatus('choose a .glb in the file picker...');
          try {
            const r = await postAction('/api/model/update', { repoGlb: asset.repoGlb });
            if (r.ok) {
              setExportStatus(`updated from ${r.picked.split('/').pop()} - reloading`);
              window.LiveViewer.open(asset, ui); // reload with the swapped-in model
            } else {
              setExportStatus(
                r.error === 'canceled' ? 'update canceled' : `update failed: ${r.error}`,
              );
            }
          } catch (e) {
            setExportStatus(`update failed: ${String(e.message ?? e).slice(0, 80)}`);
          }
        };
      }
      if (exportBtn) {
        exportBtn.style.display = isModel ? '' : 'none';
        exportBtn.onclick = async () => {
          setExportStatus('compressing + exporting...');
          try {
            const r = await postAction('/api/model/export', {
              repoGlb: asset.repoGlb,
              name: asset.name,
            });
            setExportStatus(
              r.ok
                ? `exported ${(r.sizeAfter / 1024).toFixed(0)}K .glb${
                    r.usdzPath ? ' + .usdz (textured Mac preview)' : ''
                  } -> ${r.exportPath}`
                : `export failed: ${r.error}`,
            );
          } catch (e) {
            setExportStatus(`export failed: ${String(e.message ?? e).slice(0, 80)}`);
          }
        };
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
