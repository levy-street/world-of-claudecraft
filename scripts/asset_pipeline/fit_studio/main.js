// Boot + orchestration: builds the top bar, library, inspector tabs, status
// bar, viewport overlays and keyboard map, then wires the modules together.
// window.__fit keeps the scripted hooks e2e probes rely on.

import * as anchors from '/fit_studio/anchors.js';
import * as character from '/fit_studio/character.js';
import * as hairbrush from '/fit_studio/hairbrush.js';
import { history } from '/fit_studio/history.js';
import * as sculpt from '/fit_studio/sculpt.js';
import {
  btn,
  h,
  icon,
  loadPrefs,
  savePrefs,
  section,
  segmented,
  sliderRow,
  switchRow,
  toast,
} from '/fit_studio/ui.js';
import * as vp from '/fit_studio/viewport.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------
let saveBtn;
let publishBtn;
let undoBtn;
let redoBtn;
let spaceBtn;
let snapBtn;
let uniformBtn;
let modeSeg;

function buildTopbar() {
  const bar = $('topbar');
  modeSeg = segmented(
    [
      { value: 'translate', ic: 'move', tip: 'Move (G)' },
      { value: 'rotate', ic: 'rotate', tip: 'Rotate (R)' },
      { value: 'scale', ic: 'scale', tip: 'Scale (S)' },
    ],
    anchors.gizmoState.mode,
    (v) => anchors.setGizmoMode(v),
  );
  spaceBtn = btn({
    ic: 'world',
    tip: 'Gizmo space (X)',
    onClick: () => {
      anchors.setGizmoSpace(anchors.gizmoState.space === 'world' ? 'local' : 'world');
    },
  });
  snapBtn = btn({
    ic: 'magnet',
    tip: 'Snap 1cm / 5° / 5%',
    onClick: () => anchors.setGizmoSnap(!anchors.gizmoState.snap),
  });
  snapBtn.classList.add('icon');
  uniformBtn = btn({
    ic: 'frame',
    tip: 'Uniform scale',
    onClick: () => anchors.setUniformScale(!anchors.gizmoState.uniform),
  });
  uniformBtn.classList.add('icon');
  spaceBtn.classList.add('icon');

  undoBtn = btn({ ic: 'undo', tip: 'Undo (⌘Z)', onClick: () => doUndo() });
  redoBtn = btn({ ic: 'redo', tip: 'Redo (⇧⌘Z)', onClick: () => doRedo() });
  undoBtn.classList.add('icon');
  redoBtn.classList.add('icon');

  saveBtn = btn({
    ic: 'save',
    label: 'Save',
    kind: 'primary',
    tip: 'Save anchor (⌘S)',
    onClick: () => saveActive(),
  });
  publishBtn = btn({
    ic: 'world',
    label: 'Publish to Game',
    tip: 'Rebuild the hair from the saved anchors and ship the GLB into this build (~2 min)',
    onClick: () => startPublishToGame(),
  });

  bar.append(
    h('div', { class: 'brand' }, h('b', {}, 'Fit Studio'), h('span', {}, 'World of Claudecraft')),
    modeSeg.root,
    spaceBtn,
    snapBtn,
    uniformBtn,
    h('div', { class: 'divider' }),
    undoBtn,
    redoBtn,
    h('span', { class: 'sp' }),
    btn({ ic: 'camera', tip: 'Screenshot (P)', onClick: () => vp.screenshot(currentShotName()) }),
    btn({ ic: 'keyboard', tip: 'Shortcuts (?)', onClick: () => toggleCheat() }),
    h('div', { class: 'divider' }),
    publishBtn,
    saveBtn,
  );
  refreshTopbar();
}

// --- publish-to-game --------------------------------------------------------
// POST starts the server-side chain (headless hair rebuild from the saved
// anchors -> ktx swap -> copy into public/); the button then polls status
// until it lands. Saves are already on disk (⌘S writes anchors.json), so
// whatever is SAVED is what publishes, a live unsaved gizmo drag is not.
let publishPoll = null;

async function startPublishToGame() {
  try {
    const r = await fetch('/api/fit/publish-game', { method: 'POST' });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error ?? 'publish failed to start');
  } catch (err) {
    toast(String(err.message ?? err), 'error');
    return;
  }
  toast('Publishing to game, rebuilding hair (~2 min)…');
  publishBtn.disabled = true;
  publishBtn.classList.add('busy');
  clearInterval(publishPoll);
  publishPoll = setInterval(async () => {
    let s;
    try {
      s = await (await fetch('/api/fit/publish-status')).json();
    } catch {
      return; // transient, keep polling
    }
    if (s.running) return;
    clearInterval(publishPoll);
    publishPoll = null;
    publishBtn.disabled = false;
    publishBtn.classList.remove('busy');
    if (s.ok) {
      toast('Published, reload the game tab to see the new hair', 'ok');
    } else {
      const tail = (s.log ?? []).slice(-3).join(' · ');
      toast(`Publish failed: ${tail || 'see server log'}`, 'error');
    }
  }, 3000);
}

function currentShotName() {
  const c = anchors.current;
  return c.key ? `fit-${c.kind}-${c.key}` : 'fit-studio';
}

function refreshTopbar() {
  modeSeg.set(anchors.gizmoState.mode);
  spaceBtn.replaceChildren(icon(anchors.gizmoState.space === 'world' ? 'world' : 'cube'));
  spaceBtn.dataset.tip = `Gizmo space: ${anchors.gizmoState.space} (X)`;
  snapBtn.classList.toggle('on', anchors.gizmoState.snap);
  uniformBtn.classList.toggle('on', anchors.gizmoState.uniform);
  undoBtn.disabled = !history.canUndo();
  redoBtn.disabled = !history.canRedo();
  undoBtn.dataset.tip = history.canUndo() ? `Undo: ${history.peekUndo()} (⌘Z)` : 'Undo (⌘Z)';
  redoBtn.dataset.tip = history.canRedo() ? `Redo: ${history.peekRedo()} (⇧⌘Z)` : 'Redo (⇧⌘Z)';
  const c = anchors.current;
  const sculptMode = c.kind === 'sculpt';
  const dirty = sculptMode ? sculpt.sculptState.dirty : c.dirty;
  saveBtn.classList.toggle('dirty', !!dirty);
  saveBtn.replaceChildren(icon('save'), dirty ? 'Save •' : 'Save');
  saveBtn.disabled = !c.key;
}

async function saveActive() {
  if (anchors.current.kind === 'sculpt') await sculpt.saveSculptNow();
  else await anchors.saveCurrent();
}

async function doUndo() {
  const label = await history.undo();
  if (label) toast(`Undid ${label}`);
}
async function doRedo() {
  const label = await history.redo();
  if (label) toast(`Redid ${label}`);
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------
let searchText = '';
let libSecs = null;

function buildLibrary() {
  const box = $('lib-search');
  const input = h('input', { placeholder: 'Search styles…' });
  input.oninput = () => {
    searchText = input.value.trim().toLowerCase();
    renderLists();
  };
  input.onkeydown = (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      searchText = '';
      renderLists();
      input.blur();
    }
    e.stopPropagation();
  };
  box.append(icon('search', 13), input);

  libSecs = {
    hair: section('lib-hair', 'Hair sculpts', { open: true }),
    beard: section('lib-beard', 'Beards', { open: true }),
    band: section('lib-band', 'Hair bands', { open: true }),
    jewel: section('lib-jewel', 'Piercings', { open: true }),
    body: section('lib-body', 'Body', { open: true }),
  };
  $('lib-sections').append(
    libSecs.hair.root,
    libSecs.beard.root,
    libSecs.band.root,
    libSecs.jewel.root,
    libSecs.body.root,
  );
}

function libItem({ kind, key, label, ic, selected, dot, tail, onClick }) {
  const b = h('button', { class: `item${selected ? ' sel' : ''}`, onclick: onClick });
  b.append(h('span', { class: `dot${dot ? ` ${dot}` : ''}` }));
  if (ic) b.append(icon(ic, 13));
  b.append(label ?? key);
  if (tail) b.append(h('span', { class: 'tail' }, tail));
  return b;
}

function renderLists() {
  const c = anchors.current;
  const match = (k) => !searchText || k.includes(searchText);

  // Facial hair is staged in the same hair_src directory (it rides the same
  // fit machinery), so the split is by key prefix rather than by a second
  // source list. The prefix is the FILE's, not the designer's: it is stripped
  // for the label while `key` keeps it, so selection, anchoring and the GLB
  // fetch all still address `beard_<name>`.
  const isBeard = (k) => k.startsWith('beard_');
  const hairRow = (k) =>
    libItem({
      kind: 'hair',
      key: k,
      label: k.replace(/^beard_/, ''),
      selected: c.kind === 'hair' && c.key === k,
      dot: anchors.workingFor('hair', k) ? 'dirty' : anchors.anchorFor('hair', k) ? 'anchored' : '',
      tail: anchors.anchorFor('hair', k) ? icon('check', 12) : null,
      onClick: () => anchors.selectHair(k),
    });

  const allHair = anchors.state.hair.filter(match);
  const hairKeys = allHair.filter((k) => !isBeard(k));
  const beardKeys = allHair.filter(isBeard);
  libSecs.hair.setCount(`${hairKeys.length}`);
  libSecs.hair.body.replaceChildren(...hairKeys.map(hairRow));
  libSecs.beard.setCount(`${beardKeys.length}`);
  libSecs.beard.body.replaceChildren(...beardKeys.map(hairRow));

  // Bands are listed next to the style they tie, not by their own key alone:
  // "lowpony" on its own says nothing about which of the two ponytails it is
  // once you are three styles deep.
  const bandKeys = Object.keys(anchors.state.bands ?? {})
    .sort()
    .filter(match);
  libSecs.band.setCount(`${bandKeys.length}`);
  libSecs.band.body.replaceChildren(
    ...bandKeys.map((k) =>
      libItem({
        kind: 'band',
        key: k,
        selected: c.kind === 'band' && c.key === k,
        dot: anchors.workingFor('band', k)
          ? 'dirty'
          : anchors.anchorFor('band', k)
            ? 'anchored'
            : '',
        tail: anchors.anchorFor('band', k) ? icon('check', 12) : null,
        onClick: () => anchors.selectBand(k),
      }),
    ),
  );

  const jewelKeys = character.variantOptions().jewel.filter(match);
  libSecs.jewel.setCount(`${jewelKeys.length}`);
  libSecs.jewel.body.replaceChildren(
    ...jewelKeys.map((k) =>
      libItem({
        kind: 'jewel',
        key: k,
        selected: c.kind === 'jewel' && c.key === k,
        dot: anchors.workingFor('jewel', k)
          ? 'dirty'
          : anchors.anchorFor('jewel', k)
            ? 'anchored'
            : '',
        tail: anchors.anchorFor('jewel', k) ? icon('check', 12) : null,
        onClick: () => anchors.selectJewel(k),
      }),
    ),
  );

  const { rows } = sculpt.deltaSummary();
  libSecs.body.setCount(rows ? `${rows}` : '');
  libSecs.body.body.replaceChildren(
    libItem({
      kind: 'sculpt',
      key: 'body',
      label: 'Sculpt body',
      ic: 'brush',
      selected: c.kind === 'sculpt',
      dot: sculpt.sculptState.dirty ? 'dirty' : rows ? 'anchored' : '',
      onClick: () => {
        sculpt.enterSculpt();
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Inspector tabs
// ---------------------------------------------------------------------------
const pages = {};
let tabSeg = null;

function buildInspector() {
  const tabs = $('insp-tabs');
  const body = $('insp-body');
  for (const name of ['fit', 'character', 'scene']) {
    pages[name] = h('div', { class: 'insp-page' });
    body.append(pages[name]);
  }
  const mk = (name, label) => {
    const b = h('button', {}, label);
    b.onclick = () => setTab(name);
    tabs.append(b);
    return b;
  };
  tabSeg = {
    fit: mk('fit', 'Fit'),
    character: mk('character', 'Character'),
    scene: mk('scene', 'Scene'),
  };
  anchors.buildFitPanel(pages.fit);

  const charHost = h('div');
  const appHost = h('div');
  const morphHost = h('div');
  pages.character.append(
    charHost,
    h('div', { class: 'subhead' }, 'Appearance'),
    appHost,
    h('div', { class: 'subhead' }, 'Morphs'),
    morphHost,
  );
  character.buildCharacterPanel(charHost);
  character.buildAppearancePanel(appHost);
  character.buildMorphsPanel(morphHost);

  buildScenePage(pages.scene);
  setTab(loadPrefs().tab ?? 'fit');
}

function setTab(name) {
  for (const [n, page] of Object.entries(pages)) page.classList.toggle('on', n === name);
  for (const [n, b] of Object.entries(tabSeg)) b.classList.toggle('on', n === name);
  savePrefs({ tab: name });
}

function rebuildFitPage() {
  pages.fit.replaceChildren();
  if (anchors.current.kind === 'sculpt') sculpt.buildSculptPanel(pages.fit);
  else anchors.renderFitPanel();
}

// ---------------------------------------------------------------------------
// Scene tab
// ---------------------------------------------------------------------------
let lightSliders = null;
let presetSeg = null;

function buildScenePage(host) {
  const lSec = section('scene-light', 'Lighting', { open: true });
  presetSeg = segmented(
    [
      { value: 'studio', label: 'Studio' },
      { value: 'game', label: 'Game' },
      { value: 'soft', label: 'Soft' },
      { value: 'rim', label: 'Rim' },
    ],
    vp.lighting.preset,
    (v) => {
      vp.applyLightPreset(v);
      syncLightSliders();
    },
    { mini: true },
  );
  lSec.body.append(
    h(
      'div',
      { class: 'row' },
      h('label', {}, 'Preset'),
      h('span', { class: 'grow' }),
      presetSeg.root,
    ),
  );
  lightSliders = {
    key: sliderRow({
      label: 'Key light',
      min: 0,
      max: 3,
      step: 0.05,
      value: vp.lighting.key,
      onInput: (v) => vp.applyLighting({ key: v }),
    }),
    az: sliderRow({
      label: 'Key angle',
      min: -180,
      max: 180,
      step: 2,
      value: vp.lighting.az,
      digits: 0,
      onInput: (v) => vp.applyLighting({ az: v }),
    }),
    el: sliderRow({
      label: 'Key height',
      min: 0,
      max: 80,
      step: 1,
      value: vp.lighting.el,
      digits: 0,
      onInput: (v) => vp.applyLighting({ el: v }),
    }),
    env: sliderRow({
      label: 'Environment',
      min: 0,
      max: 2,
      step: 0.05,
      value: vp.lighting.env,
      onInput: (v) => vp.applyLighting({ env: v }),
    }),
    rim: sliderRow({
      label: 'Rim light',
      min: 0,
      max: 3,
      step: 0.05,
      value: vp.lighting.rim,
      onInput: (v) => vp.applyLighting({ rim: v }),
    }),
    exposure: sliderRow({
      label: 'Exposure',
      min: 0.4,
      max: 2,
      step: 0.02,
      value: vp.lighting.exposure,
      onInput: (v) => vp.applyLighting({ exposure: v }),
    }),
  };
  for (const s of Object.values(lightSliders)) lSec.body.append(s.root);
  host.append(lSec.root);

  const dSec = section('scene-display', 'Display', { open: true });
  const bgSeg = segmented(
    [
      { value: 'dark', label: 'Dark' },
      { value: 'flat', label: 'Flat' },
      { value: 'light', label: 'Light' },
      { value: 'chroma', label: 'Green' },
    ],
    vp.view.background,
    (v) => vp.setBackground(v),
    { mini: true },
  );
  dSec.body.append(
    h(
      'div',
      { class: 'row' },
      h('label', {}, 'Backdrop'),
      h('span', { class: 'grow' }),
      bgSeg.root,
    ),
  );
  dSec.body.append(
    switchRow({
      label: 'Ghost',
      value: anchors.ghostPrefs.visible,
      onChange: (v) => anchors.setGhostVisible(v),
    }).root,
  );
  dSec.body.append(
    sliderRow({
      label: 'Ghost opacity',
      min: 0.08,
      max: 0.85,
      step: 0.01,
      value: anchors.ghostPrefs.opacity,
      onInput: (v) => anchors.setGhostOpacity(v),
    }).root,
  );
  dSec.body.append(
    switchRow({
      label: 'X-ray body',
      value: character.xrayPrefs.on,
      onChange: (v) => {
        character.setXray(v);
        refreshOverlays();
      },
    }).root,
  );
  dSec.body.append(
    sliderRow({
      label: 'X-ray opacity',
      min: 0.05,
      max: 0.9,
      step: 0.01,
      value: character.xrayPrefs.opacity,
      onInput: (v) => character.setXrayOpacity(v),
    }).root,
  );
  dSec.body.append(
    switchRow({ label: 'Grid', value: vp.view.grid, onChange: (v) => vp.setGrid(v) }).root,
  );
  dSec.body.append(
    switchRow({ label: 'Wireframe', value: vp.view.wireframe, onChange: (v) => vp.setWireframe(v) })
      .root,
  );
  dSec.body.append(
    switchRow({ label: 'Turntable', value: vp.view.turntable, onChange: (v) => vp.setTurntable(v) })
      .root,
  );
  host.append(dSec.root);

  const cSec = section('scene-camera', 'Camera', { open: false });
  const views = h(
    'div',
    { class: 'actions' },
    ...['front', 'back', 'left', 'right', 'top', 'iso'].map((v, i) =>
      btn({
        label: v[0].toUpperCase() + v.slice(1),
        tip: `Key ${i + 1}`,
        onClick: () => vp.setView(v),
      }),
    ),
  );
  cSec.body.append(
    views,
    h(
      'div',
      { class: 'actions' },
      btn({ ic: 'frame', label: 'Frame head', tip: 'F', onClick: () => vp.frame() }),
      btn({ ic: 'reset', label: 'Reset camera', onClick: () => vp.resetCamera() }),
    ),
    h('div', { class: 'note' }, 'Double-click anything to orbit around that point.'),
  );
  host.append(cSec.root);
}

function syncLightSliders() {
  if (!lightSliders) return;
  for (const [k, s] of Object.entries(lightSliders)) s.set(vp.lighting[k]);
  presetSeg.set(vp.lighting.preset);
}

// ---------------------------------------------------------------------------
// Viewport overlays
// ---------------------------------------------------------------------------
let ghostToggle;
let xrayToggle;
let gridToggle;
let wireToggle;
let spinToggle;

function buildOverlays() {
  const vpEl = $('viewport');
  const views = h(
    'div',
    { class: 'vp-pill' },
    ...[
      ['front', 'Front'],
      ['back', 'Back'],
      ['left', 'L'],
      ['right', 'R'],
      ['top', 'Top'],
      ['iso', '¾'],
    ].map(([v, label], i) =>
      h('button', { 'data-tip': `${v} view (${i + 1})`, onclick: () => vp.setView(v) }, label),
    ),
  );
  ghostToggle = h(
    'button',
    {
      'data-tip': 'Ghost of current build',
      onclick: () => anchors.setGhostVisible(!anchors.ghostPrefs.visible),
    },
    icon('ghost', 14),
  );
  xrayToggle = h(
    'button',
    {
      'data-tip': 'X-ray body (V), sculpt through the head',
      onclick: () => {
        character.setXray(!character.xrayPrefs.on);
        refreshOverlays();
      },
    },
    icon('xray', 14),
  );
  gridToggle = h(
    'button',
    { 'data-tip': 'Grid', onclick: () => vp.setGrid(!vp.view.grid) },
    icon('grid', 14),
  );
  wireToggle = h(
    'button',
    { 'data-tip': 'Wireframe', onclick: () => vp.setWireframe(!vp.view.wireframe) },
    icon('wire', 14),
  );
  spinToggle = h(
    'button',
    { 'data-tip': 'Turntable (T)', onclick: () => vp.setTurntable(!vp.view.turntable) },
    icon('spin', 14),
  );
  const shot = h(
    'button',
    { 'data-tip': 'Screenshot (P)', onclick: () => vp.screenshot(currentShotName()) },
    icon('camera', 14),
  );
  const toggles = h(
    'div',
    { class: 'vp-pill' },
    ghostToggle,
    xrayToggle,
    gridToggle,
    wireToggle,
    spinToggle,
    shot,
  );
  vpEl.append(h('div', { class: 'vp-corner vp-tr' }, views, toggles));
  $('vp-hint').textContent = 'drag orbit · scroll zoom · double-click focus · ? shortcuts';
  refreshOverlays();
}

function refreshOverlays() {
  ghostToggle.classList.toggle('on', anchors.ghostPrefs.visible);
  xrayToggle.classList.toggle('on', character.xrayPrefs.on);
  gridToggle.classList.toggle('on', vp.view.grid);
  wireToggle.classList.toggle('on', vp.view.wireframe);
  spinToggle.classList.toggle('on', vp.view.turntable);
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------
let statusMsg;
let statusCells;

function buildStatusbar() {
  statusMsg = h('span', {}, 'Loading…');
  statusCells = {
    anchors: h('span', { class: 'cell' }),
    sculpt: h('span', { class: 'cell' }),
    glb: h('span', { class: 'cell' }),
    fps: h('span', { class: 'cell' }),
  };
  $('statusbar').append(
    statusMsg,
    h('span', { class: 'sp' }),
    statusCells.anchors,
    statusCells.sculpt,
    statusCells.glb,
    statusCells.fps,
  );
  setInterval(() => {
    statusCells.fps.textContent = `${vp.stats.fps} fps`;
  }, 700);
}

function refreshStatus() {
  const c = anchors.current;
  if (c.kind === 'sculpt') {
    statusMsg.textContent = 'Sculpting the body, drag to pull, ⌘Z undoes a stroke';
  } else if (c.key) {
    statusMsg.textContent = `Editing ${c.kind}/${c.key}${c.dirty ? ', unsaved changes' : ''}`;
  } else {
    statusMsg.textContent = 'Pick a style from the library';
  }
  const savedHair = Object.keys(anchors.state.anchors?.hair ?? {}).length;
  const savedJewel = Object.keys(anchors.state.anchors?.jewel ?? {}).length;
  const savedBand = Object.keys(anchors.state.anchors?.band ?? {}).length;
  const bandTotal = Object.keys(anchors.state.bands ?? {}).length;
  statusCells.anchors.replaceChildren(
    icon('hair', 12),
    `${savedHair}/${anchors.state.hair.length}`,
    icon('gem', 12),
    `${savedJewel}/${character.variantOptions().jewel.length}`,
    icon('ring', 12),
    `${savedBand}/${bandTotal}`,
  );
  const { rows } = sculpt.deltaSummary();
  statusCells.sculpt.replaceChildren(icon('body', 12), rows ? `${rows} deltas` : 'no sculpt');
  statusCells.glb.replaceChildren(
    icon('cube', 12),
    anchors.state.characterGlb?.startsWith('tmp/') ? 'raw export' : 'shipped GLB',
  );
}

// ---------------------------------------------------------------------------
// Cheat sheet
// ---------------------------------------------------------------------------
function buildCheat() {
  const key = (k, what) => h('div', { class: 'k' }, h('span', {}, what), h('kbd', {}, k));
  $('cheat').append(
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Shortcuts'),
      h(
        'div',
        { class: 'cols' },
        h(
          'div',
          {},
          h('h3', {}, 'Gizmo'),
          key('G', 'Move'),
          key('R', 'Rotate'),
          key('S', 'Scale'),
          key('X', 'World / local space'),
          key('⇧ drag', 'Fine scrub on fields'),
          h('h3', {}, 'Editing'),
          key('⌘Z / ⇧⌘Z', 'Undo / redo'),
          key('⌘S', 'Save anchor or sculpt'),
          key('← → ↑ ↓', 'Nudge X / Y'),
          key('⌥ ↑ ↓', 'Nudge Z'),
          key('⇧ + arrows', 'Fine nudge'),
          key('Esc', 'Deselect'),
        ),
        h(
          'div',
          {},
          h('h3', {}, 'Camera'),
          key('1 to 6', 'Front · Back · Left · Right · Top · ¾'),
          key('F', 'Frame the head'),
          key('T', 'Turntable'),
          key('Double-click', 'Orbit around that point'),
          h('h3', {}, 'Other'),
          key('B', 'Body sculpt mode'),
          key('P', 'Screenshot'),
          key('?', 'This sheet'),
        ),
      ),
      h(
        'div',
        { class: 'actions' },
        btn({ label: 'Close (Esc)', onClick: () => toggleCheat(false) }),
      ),
    ),
  );
  $('cheat').onclick = (e) => {
    if (e.target === $('cheat')) toggleCheat(false);
  };
}

function toggleCheat(force) {
  $('cheat').classList.toggle('on', force);
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------
function bindKeys() {
  window.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable)
      return;
    const k = e.key.toLowerCase();
    const meta = e.metaKey || e.ctrlKey;
    if (meta && k === 'z') {
      e.preventDefault();
      e.shiftKey ? doRedo() : doUndo();
      return;
    }
    if (meta && k === 's') {
      e.preventDefault();
      saveActive();
      return;
    }
    if (meta) return;
    if (k === 'g') anchors.setGizmoMode('translate');
    else if (k === 'r') anchors.setGizmoMode('rotate');
    else if (k === 's') anchors.setGizmoMode('scale');
    else if (k === 'x')
      anchors.setGizmoSpace(anchors.gizmoState.space === 'world' ? 'local' : 'world');
    else if (k === 'f') vp.frame();
    // 'x' is the gizmo's world/local space toggle, so the x-ray takes 'v' (view through).
    else if (k === 'v') {
      character.setXray(!character.xrayPrefs.on);
      refreshOverlays();
    } else if (k === 't') vp.setTurntable(!vp.view.turntable);
    else if (k === 'b') {
      if (anchors.current.kind === 'sculpt') {
        sculpt.exitSculpt();
        anchors.deselect();
      } else sculpt.enterSculpt();
    } else if (k === 'p') vp.screenshot(currentShotName());
    else if (k === '?') toggleCheat();
    else if (k === 'escape') {
      if ($('cheat').classList.contains('on')) toggleCheat(false);
      else {
        sculpt.exitSculpt();
        anchors.deselect();
      }
    } else if (['1', '2', '3', '4', '5', '6'].includes(k)) {
      vp.setView(['front', 'back', 'left', 'right', 'top', 'iso'][Number(k) - 1]);
    } else if (k.startsWith('arrow')) {
      if (!anchors.current.key || anchors.current.kind === 'sculpt') return;
      e.preventDefault();
      const fine = e.shiftKey;
      if (k === 'arrowleft') anchors.nudge(-1, 0, 0, fine);
      else if (k === 'arrowright') anchors.nudge(1, 0, 0, fine);
      else if (k === 'arrowup')
        e.altKey ? anchors.nudge(0, 0, -1, fine) : anchors.nudge(0, 1, 0, fine);
      else if (k === 'arrowdown')
        e.altKey ? anchors.nudge(0, 0, 1, fine) : anchors.nudge(0, -1, 0, fine);
    }
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  buildTopbar();
  buildLibrary();
  buildStatusbar();
  buildCheat();
  buildOverlays();
  vp.initViewport();

  const state = await (await fetch('/api/fit/state')).json();
  anchors.setState(state);
  if (!state.characterGlb) {
    statusMsg.textContent = 'No character GLB: run the modular rebuild first';
    toast('No character GLB found: run the modular rebuild', 'bad');
    return;
  }
  statusMsg.textContent = 'Loading character…';
  await character.loadCharacter(state.characterGlb);
  sculpt.applySavedSculpt(state.sculpt);
  buildInspector();
  renderLists();
  refreshStatus();

  // Wiring ---------------------------------------------------------------
  anchors.setBeforeSelectHook(() => sculpt.exitSculpt());
  anchors.setHairLoadedHook((style, meshes, saved) => hairbrush.onHairLoaded(style, meshes, saved));
  anchors.setHairPanelExtra((host) => hairbrush.buildPanel(host));
  anchors.setHairShapeSaver((style) => hairbrush.saveShape(style));
  // Brush mode survives hair→hair switches but must release the gizmo the
  // moment the selection is anything else.
  anchors.onAnchorsChange((what) => {
    if (what === 'selection' && anchors.current.kind !== 'hair' && hairbrush.hairBrush.active) {
      hairbrush.setActive(false);
    }
  });
  vp.onTick((dt) => {
    character.tickAnimation(dt);
    anchors.tickFollow();
    hairbrush.tickHairSway();
  });
  anchors.onAnchorsChange((what) => {
    if (what === 'selection') {
      rebuildFitPage();
      setTab('fit');
      renderLists();
    } else if (what === 'dirty') {
      renderLists();
    } else if (what === 'ghost') {
      refreshOverlays();
    } else if (what === 'gizmo') {
      refreshTopbar();
      return;
    }
    refreshStatus();
    refreshTopbar();
  });
  sculpt.onSculptChange((what) => {
    if (what === 'selection') {
      rebuildFitPage();
      setTab('fit');
    }
    renderLists();
    refreshStatus();
    refreshTopbar();
  });
  history.onChange(() => refreshTopbar());
  vp.onViewportChange((what) => {
    refreshOverlays();
    if (what === 'lighting') syncLightSliders();
  });
  character.onCharacterChange((what) => {
    if (what === 'char') renderLists();
  });
  bindKeys();
  refreshOverlays();
  refreshTopbar();

  const beardCount = state.hair.filter((k) => k.startsWith('beard_')).length;
  const hairCount = state.hair.length - beardCount;
  const jewelCount = character.variantOptions().jewel.length;
  const bandCount = Object.keys(state.bands ?? {}).length;
  const tally = `${hairCount} hair styles, ${beardCount} beards, ${bandCount} hair bands, ${jewelCount} piercing sets`;
  statusMsg.textContent = `Ready: ${tally}`;
  toast(`Loaded ${tally}`, 'good');
}

boot().catch((err) => {
  console.error(err);
  toast(`Boot failed: ${err.message ?? err}`, 'bad');
  if (statusMsg) statusMsg.textContent = `Boot failed: ${err.message ?? err}`;
});

// ---------------------------------------------------------------------------
// Scripted access for e2e checks (the wizard's window.LiveViewer pattern):
// lets a headless probe select a style, set an exact transform, save, and
// force a frame. Field names are stable, older probes rely on them.
// ---------------------------------------------------------------------------
window.__fit = {
  selectHair: (k) => anchors.selectHair(k),
  selectJewel: (k) => anchors.selectJewel(k),
  selectBand: (k) => anchors.selectBand(k),
  enterSculpt: () => sculpt.enterSculpt(),
  camera: vp.camera,
  orbit: vp.orbit,
  wrap: anchors.wrap,
  effectiveMatrix: () => anchors.effectiveMatrix().toArray(),
  setEffectiveMatrix: (m) => anchors.setEffectiveMatrixEdited(m),
  save: () => saveActive(),
  state: () => anchors.state,
  current: () => ({ ...anchors.current }),
  renderOnce: () => vp.renderOnce(),
  // new surface
  history,
  character,
  anchors,
  sculpt,
  hairbrush,
  viewport: vp,
};
