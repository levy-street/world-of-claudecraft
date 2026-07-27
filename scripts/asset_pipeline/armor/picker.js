// The Armory: v03 armor forge picker.
// Loads manifest.json (v2: the nine forge-ingested bodies plus forged sets),
// renders the character in three.js, and equips armor by swapping to the
// pre-forged armored GLB for that exact body. Armor never rebinds across
// skeletons at runtime: every armored model was fitted, skinned, and
// gate-verified offline by forge.mjs, so what you see is what ships.
import { GLTFLoader, MeshoptDecoder, OrbitControls, THREE } from './three.bundle.js';

const manifest = await (await fetch('./manifest.json')).json();

// --- three.js stage ---------------------------------------------------------
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0c0a08, 9, 22);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 100);

const hemi = new THREE.HemisphereLight(0xfff2dc, 0x2a2018, 1.1);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffe9c4, 2.2);
key.position.set(2.4, 3.4, 2.6);
scene.add(key);
const rim = new THREE.DirectionalLight(0x9db8ff, 0.9);
rim.position.set(-2.6, 2.2, -2.4);
scene.add(rim);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(2.6, 64),
  new THREE.MeshStandardMaterial({ color: 0x1c1610, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
const ring = new THREE.Mesh(
  new THREE.RingGeometry(2.45, 2.6, 64),
  new THREE.MeshBasicMaterial({ color: 0xc9a35c, transparent: true, opacity: 0.28 }),
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.002;
scene.add(ring);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.2;
controls.maxDistance = 9;
controls.maxPolarAngle = Math.PI * 0.55;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

// --- state ------------------------------------------------------------------
const statusEl = document.getElementById('status');
const loadingEl = document.getElementById('loading');
const rosterEl = document.getElementById('roster');
const piecesEl = document.getElementById('pieces');
const setrowEl = document.getElementById('setrow');
const animSel = document.getElementById('anim');

const gltfCache = new Map(); // url -> Promise<GLTF>
const prefs = {}; // char -> { set, slots, hair, beard, anim }
let current = null; // { char, root, gltf, mixer, action }
const clock = new THREE.Clock();

function pref(char) {
  if (!prefs[char]) {
    const def = manifest.chars[char];
    prefs[char] = {
      set: 'none',
      slots: {},
      hair: def.cosmetics.hairs[0] ?? 'none',
      beard: false,
      anim: 'Idle',
    };
  }
  return prefs[char];
}

function loadGltf(url) {
  if (!gltfCache.has(url)) {
    gltfCache.set(
      url,
      new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject)),
    );
  }
  return gltfCache.get(url);
}

function modelUrl(char) {
  const p = pref(char);
  if (p.set !== 'none') {
    const path = manifest.sets[p.set]?.armored?.[char];
    if (path) return path;
  }
  return manifest.chars[char].glb;
}

function slotOn(p, slot) {
  return p.slots[slot] !== false;
}

function helmOn(char) {
  const p = pref(char);
  return (
    p.set !== 'none' && (manifest.sets[p.set]?.slots ?? []).includes('Helm') && slotOn(p, 'Helm')
  );
}

// The classic MMO rule: a worn piece REPLACES the body part beneath it (the
// suit is authored with full coverage, so no undershirt may peek through).
// Exceptions: a HAT helm (manifest set helmMode 'hat') rides on top of the
// hair, so the head, hair, and beard all stay visible beneath it; an
// arms-OVERLAY set (wrap sleeves with no hand geometry) keeps the body arms
// visible so the body's own hands poke out of the cuffs.
const BODY_BY_SLOT = {
  Helm: ['Head', 'Head_Brow'],
  Shoulders: ['Shoulders'],
  Torso: ['Torso'],
  Arms: ['Arms'],
  Legs: ['Legs', 'Pants'],
};

/** Apply armor slot + cosmetic visibility to the current model by mesh name. */
function applyVisibility() {
  if (!current) return;
  const char = current.char;
  const def = manifest.chars[char];
  const p = pref(char);
  const helm = helmOn(char);
  const hat = helm && ['hat', 'mask'].includes(manifest.sets[p.set]?.helmMode);
  const setSlots = p.set !== 'none' ? (manifest.sets[p.set]?.slots ?? []) : [];
  const hiddenBody = new Set();
  for (const slot of setSlots) {
    if (!slotOn(p, slot)) continue;
    if (slot === 'Helm' && hat) continue;
    if (slot === 'Arms' && manifest.sets[p.set]?.armsOverlay) continue;
    for (const seg of BODY_BY_SLOT[slot] ?? []) hiddenBody.add(seg);
  }
  current.root.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const name = o.name;
    if (name.startsWith('Armor_')) {
      const slot = name.slice('Armor_'.length).replace(/_\d+$/, '');
      o.visible = p.set !== 'none' && slotOn(p, slot);
    } else if (hiddenBody.has(name)) {
      o.visible = false;
    } else if (def.cosmetics.hairs.includes(name)) {
      o.visible = (!helm || hat) && p.hair === name;
    } else if (name === 'Head_Beard') {
      o.visible = (!helm || hat) && p.beard;
    } else if (name === 'Head_Female_Head' || /^Head_Female_Hair/.test(name)) {
      o.visible = false;
    } else {
      o.visible = true;
    }
  });
}

function frameCamera(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const h = Math.max(size.y, 0.5);
  controls.target.set(center.x, center.y * 0.95, center.z);
  camera.position.set(center.x + h * 1.15, center.y + h * 0.42, center.z + h * 2.05);
  camera.near = h / 50;
  camera.far = h * 60;
  camera.updateProjectionMatrix();
  controls.update();
}

async function showCharacter(char, { reframe = true } = {}) {
  loadingEl.classList.remove('hidden');
  const gltf = await loadGltf(modelUrl(char));
  if (current?.root) scene.remove(current.root);
  const root = gltf.scene;
  scene.add(root);
  current = { char, root, gltf, mixer: new THREE.AnimationMixer(root), action: null };
  applyVisibility();
  buildAnimList(gltf, pref(char).anim);
  playClip(animSel.value);
  buildLedger(char);
  if (reframe) frameCamera(root);
  const def = manifest.chars[char];
  const p = pref(char);
  const setLabel = p.set === 'none' ? 'bare' : manifest.sets[p.set].label;
  statusEl.innerHTML = `<b>${def.label}</b> &middot; ${setLabel} &middot; drag to orbit, scroll to zoom`;
  loadingEl.classList.add('hidden');
}

function buildAnimList(gltf, preferred) {
  animSel.innerHTML = '';
  const names = gltf.animations.map((c) => c.name);
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name.replace(/_/g, ' ');
    animSel.appendChild(opt);
  }
  animSel.value = names.includes(preferred)
    ? preferred
    : names.includes('Idle')
      ? 'Idle'
      : names[0];
}

function playClip(name) {
  if (!current) return;
  const clip = current.gltf.animations.find((c) => c.name === name);
  if (!clip) return;
  const action = current.mixer.clipAction(clip);
  if (current.action && current.action !== action) current.action.fadeOut(0.18);
  action.reset().fadeIn(0.18).play();
  current.action = action;
  pref(current.char).anim = name;
}

animSel.addEventListener('change', () => playClip(animSel.value));

// --- ledger -----------------------------------------------------------------
function chipColor(key, i = 0) {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `linear-gradient(135deg, hsl(${h}, 42%, 52%) 0%, hsl(${(h + 40) % 360}, 48%, 24%) 100%)`;
}

function mkChip({ className = '', title, selected, onClick, background }) {
  const chip = document.createElement('button');
  chip.className = `chip ${className}`.trim();
  chip.title = title;
  chip.setAttribute('aria-label', title);
  if (background) chip.style.background = background;
  if (selected) chip.classList.add('selected');
  chip.addEventListener('click', onClick);
  return chip;
}

function mkRow(label, tag) {
  const row = document.createElement('div');
  row.className = 'piece-row';
  const name = document.createElement('div');
  name.className = 'piece-name';
  name.innerHTML = `<span>${label}</span><span class="variant-tag">${tag ?? ''}</span>`;
  row.appendChild(name);
  const chips = document.createElement('div');
  chips.className = 'chips';
  row.appendChild(chips);
  return { row, chips, tagEl: name.querySelector('.variant-tag') };
}

async function reequip() {
  await showCharacter(current.char, { reframe: false });
}

function buildLedger(char) {
  const def = manifest.chars[char];
  const p = pref(char);
  piecesEl.innerHTML = '';
  setrowEl.innerHTML = '<span class="setlabel">Forged set</span>';

  // Set chips: bare + every forged set that has an artifact for this body.
  setrowEl.appendChild(
    mkChip({
      className: 'none',
      title: 'Bare (no set)',
      selected: p.set === 'none',
      onClick: async () => {
        p.set = 'none';
        await reequip();
      },
    }),
  );
  for (const [key, set] of Object.entries(manifest.sets ?? {})) {
    if (!set.armored?.[char]) continue;
    setrowEl.appendChild(
      mkChip({
        title: `${set.label}${set.verified?.[char] ? '' : ' (UNVERIFIED)'}`,
        selected: p.set === key,
        background: chipColor(key),
        onClick: async () => {
          p.set = key;
          await reequip();
        },
      }),
    );
  }

  // Per-slot toggles for the active set.
  if (p.set !== 'none') {
    const set = manifest.sets[p.set];
    const head = document.createElement('div');
    head.className = 'piece-row';
    head.innerHTML =
      `<div class="piece-name"><span style="color: var(--gold)">${set.label.toUpperCase()}</span>` +
      `<span class="variant-tag">${set.verified?.[char] ? 'gate verified' : 'UNVERIFIED'}</span></div>`;
    piecesEl.appendChild(head);
    const order = Object.keys(manifest.setSlots ?? {});
    const slots = [...(set.slots ?? [])].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    for (const slot of slots) {
      const on = slotOn(p, slot);
      const { row, chips, tagEl } = mkRow(
        manifest.setSlots?.[slot] ?? slot,
        on ? 'worn' : 'hidden',
      );
      row.dataset.piece = slot;
      const wear = mkChip({
        title: `Wear ${slot}`,
        selected: on,
        background: chipColor(p.set),
        onClick: () => {
          p.slots[slot] = true;
          applyVisibility();
          wear.classList.add('selected');
          hide.classList.remove('selected');
          tagEl.textContent = 'worn';
        },
      });
      wear.dataset.variant = 'on';
      const hide = mkChip({
        className: 'none',
        title: `Hide ${slot}`,
        selected: !on,
        onClick: () => {
          p.slots[slot] = false;
          applyVisibility();
          hide.classList.add('selected');
          wear.classList.remove('selected');
          tagEl.textContent = 'hidden';
        },
      });
      hide.dataset.variant = 'off';
      chips.appendChild(wear);
      chips.appendChild(hide);
      piecesEl.appendChild(row);
    }
  }

  // Head cosmetics: hair styles + beard, hidden under a worn helm (a hat
  // set keeps everything visible; the hat rides on top of the hair).
  if (def.cosmetics.hairs.length || def.cosmetics.beard) {
    const hatSet = p.set !== 'none' && manifest.sets[p.set]?.helmMode === 'hat';
    const head = document.createElement('div');
    head.className = 'piece-row';
    head.innerHTML =
      '<div class="piece-name"><span style="color: var(--gold)">HEAD</span>' +
      `<span class="variant-tag">${hatSet ? 'the hat rides on the hair' : 'hidden under a helm'}</span></div>`;
    piecesEl.appendChild(head);
  }
  if (def.cosmetics.hairs.length) {
    const label = (h) => h.replace(/^Head_(Male|Female)_/, '').replace(/_/g, ' ');
    const { row, chips, tagEl } = mkRow('Hair', p.hair === 'none' ? 'None' : label(p.hair));
    row.dataset.piece = 'Hair';
    const select = (hair, tag) => {
      p.hair = hair;
      applyVisibility();
      for (const c of chips.querySelectorAll('.chip')) {
        c.classList.toggle('selected', c.dataset.variant === hair);
      }
      tagEl.textContent = tag;
    };
    const none = mkChip({
      className: 'none',
      title: 'Bald',
      selected: p.hair === 'none',
      onClick: () => select('none', 'None'),
    });
    none.dataset.variant = 'none';
    chips.appendChild(none);
    def.cosmetics.hairs.forEach((hair, i) => {
      const chip = mkChip({
        title: label(hair),
        selected: p.hair === hair,
        background: chipColor(hair, i),
        onClick: () => select(hair, label(hair)),
      });
      chip.dataset.variant = hair;
      chips.appendChild(chip);
    });
    piecesEl.appendChild(row);
  }
  if (def.cosmetics.beard) {
    const { row, chips, tagEl } = mkRow('Beard', p.beard ? 'worn' : 'none');
    row.dataset.piece = 'Beard';
    const beardChip = mkChip({
      title: 'Toggle beard',
      selected: p.beard,
      background: chipColor('beard'),
      onClick: () => {
        p.beard = !p.beard;
        applyVisibility();
        beardChip.classList.toggle('selected', p.beard);
        tagEl.textContent = p.beard ? 'worn' : 'none';
      },
    });
    beardChip.dataset.variant = 'beard';
    chips.appendChild(beardChip);
    piecesEl.appendChild(row);
  }

  // Downloads: the artifacts are plain GLB files served from the workspace.
  const dl = document.createElement('div');
  dl.className = 'piece-row';
  dl.innerHTML =
    '<div class="piece-name"><span style="color: var(--gold)">DOWNLOAD</span>' +
    '<span class="variant-tag">GLB artifacts</span></div>';
  const mkLink = (href, text) => {
    const a = document.createElement('a');
    a.className = 'dl';
    a.href = href;
    a.download = '';
    a.textContent = text;
    return a;
  };
  dl.appendChild(mkLink(def.glb, `${def.label} body`));
  if (p.set !== 'none') {
    const set = manifest.sets[p.set];
    dl.appendChild(mkLink(set.armored[char], `${def.label} in ${set.label}`));
    if (set.sets?.[char]) dl.appendChild(mkLink(set.sets[char], `${set.label} set only`));
  }
  piecesEl.appendChild(dl);
}

// --- roster -----------------------------------------------------------------
for (const [char, def] of Object.entries(manifest.chars)) {
  const tile = document.createElement('button');
  tile.className = 'char-tile';
  tile.dataset.char = char;
  tile.innerHTML = `${def.label}<small>${def.clips.length} clips</small>`;
  tile.addEventListener('click', async () => {
    for (const t of rosterEl.querySelectorAll('.char-tile')) t.classList.remove('active');
    tile.classList.add('active');
    await showCharacter(char);
  });
  rosterEl.appendChild(tile);
}

// Debug hooks for headless verification: dump mesh visibility, force one.
window.__pickerDebug = () => {
  const out = [];
  current?.root?.traverse((o) => {
    if (o.isMesh) out.push(`${o.name}:${o.visible ? 'visible' : 'hidden'}`);
  });
  return out.join(' | ');
};
window.__pickerCam = (px, py, pz, tx, ty, tz) => {
  camera.position.set(px, py, pz);
  controls.target.set(tx, ty, tz);
  controls.update();
  return 'ok';
};
window.__pickerSet = (name, visible) => {
  let hit = 0;
  current?.root?.traverse((o) => {
    if (o.isMesh && o.name === name) {
      o.visible = visible;
      hit += 1;
    }
  });
  return hit;
};
window.__pickerPlayExclusive = (clipName) => {
  if (!current) return 'no model';
  const clip = current.gltf.animations.find((c) => c.name === clipName);
  if (!clip) return `no clip ${clipName}`;
  current.mixer.stopAllAction();
  current.action = current.mixer.clipAction(clip);
  current.action.reset().play();
  return `playing ${clipName} exclusively, duration=${clip.duration}`;
};
window.__pickerReadJoint = (jointName) => {
  const hits = [];
  current?.root?.traverse((o) => {
    if (o.name === jointName) {
      const p = new THREE.Vector3();
      o.getWorldPosition(p);
      hits.push(p.toArray().map((v) => Math.round(v * 1e3) / 1e3));
    }
  });
  return JSON.stringify(hits);
};
window.__pickerActionDiag = (clipName, jointName) => {
  if (!current) return 'no model';
  const clip = current.gltf.animations.find((c) => c.name === clipName);
  if (!clip) return `no clip ${clipName}`;
  const action = current.mixer.clipAction(clip);
  const bindings = action._propertyBindings ?? [];
  const rows = [];
  for (const pm of bindings.slice(0, 60)) {
    const b = pm.binding ?? pm;
    const node = b.node;
    if (node?.name === jointName || rows.length < 2) {
      rows.push({
        track: b.path ?? b.parsedPath?.nodeName,
        node: node ? `${node.name}#${node.uuid.slice(0, 6)}` : 'UNBOUND',
      });
    }
  }
  let sceneBone = null;
  current.root.traverse((o) => {
    if (o.name === jointName && !sceneBone) sceneBone = `${o.name}#${o.uuid.slice(0, 6)}`;
  });
  return JSON.stringify({
    weight: action.getEffectiveWeight(),
    time: Math.round(action.time * 100) / 100,
    enabled: action.enabled,
    running: action.isRunning(),
    sceneBone,
    sample: rows,
  });
};
window.__pickerJointProbe = (clipName, jointName, t = 0) => {
  if (!current) return null;
  const clip = current.gltf.animations.find((c) => c.name === clipName);
  if (!clip) return `no clip ${clipName}`;
  const action = current.mixer.clipAction(clip);
  current.action?.stop();
  action.reset().play();
  current.mixer.setTime(t);
  current.root.updateMatrixWorld(true);
  const hits = [];
  current.root.traverse((o) => {
    if (o.name === jointName) {
      const p = new THREE.Vector3();
      o.getWorldPosition(p);
      hits.push([o.type, ...p.toArray().map((v) => Math.round(v * 1e3) / 1e3)]);
    }
  });
  return JSON.stringify(hits);
};

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  current?.mixer?.update(dt);
  controls.update();
  renderer.render(scene, camera);
});

// Boot on the first character.
rosterEl.querySelector('.char-tile')?.click();
