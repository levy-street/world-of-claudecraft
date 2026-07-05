// Web wizard for the live asset library (library --serve). Adds an in-browser,
// step-by-step asset creator: type a prompt -> generate a 3D model (review it,
// keep it or regenerate for another candidate) -> generate animations / finish
// (review) -> save into the game. Existing generatable assets get a Regenerate
// button that re-enters the same flow, so a human decides when it looks right
// before saving. Talks only to the /api/wizard/* endpoints (serveLibrary); the
// actual Tripo work runs server-side in the pipeline CLI.
//
// Self-contained: injects its own button + modal + styles, and exposes
// window.WizardUI.onDetail(asset) so the grid can add the per-asset Regenerate
// button. No build step, no framework (matches viewer_live.js).

const LANES = [
  { id: 'creature', label: 'Creature / mob', animated: true },
  { id: 'weapon', label: 'Weapon', animated: false },
  { id: 'prop', label: 'Prop', animated: false },
];

function laneOf(asset) {
  if (asset?.job?.lane) return asset.job.lane;
  if (asset?.category === 'creatures' || asset?.kind === 'creature') return 'creature';
  if (asset?.category === 'weapons') return 'weapon';
  if (asset?.category === 'props') return 'prop';
  return null;
}

// Mirror the server's safeName + jobIdFor (lib/wizard.mjs) so the client can look
// up whether a deterministic job id already exists before generating. An imperfect
// match just misses the lookup and falls through to a normal generate (safe).
function safeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

// --- tiny DOM helpers --------------------------------------------------------
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const kid of kids)
    if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
}
async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- styles ------------------------------------------------------------------
const STYLE = `
.wz-fab { position: fixed; right: 22px; bottom: 22px; z-index: 40; background: var(--gold);
  color: #14171d; border: none; border-radius: 24px; padding: 11px 18px; font-size: 14px;
  font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,0.4); }
.wz-fab:hover { filter: brightness(1.08); }
.wz-overlay { position: fixed; inset: 0; z-index: 50; background: rgba(6,8,12,0.72);
  display: none; align-items: center; justify-content: center; }
.wz-overlay.open { display: flex; }
.wz-modal { position: relative; background: var(--panel); border: 1px solid var(--line);
  border-radius: 12px; width: min(760px, 94vw); max-height: 92vh; overflow: auto; padding: 18px 20px; }
.wz-x { position: absolute; top: 10px; right: 12px; width: 28px; height: 28px; padding: 0;
  display: flex; align-items: center; justify-content: center; background: var(--panel2);
  color: var(--dim); border: 1px solid var(--line); border-radius: 6px; font-size: 20px;
  line-height: 1; cursor: pointer; z-index: 2; }
.wz-x:hover { color: var(--text); border-color: var(--gold); }
.wz-modal h2 { color: var(--gold); font-size: 16px; margin-bottom: 3px; }
.wz-modal .wz-sub { color: var(--dim); font-size: 12px; margin-bottom: 14px; }
.wz-steps { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.wz-step { font-size: 11px; color: var(--dim); border: 1px solid var(--line); border-radius: 12px; padding: 3px 9px; }
.wz-step.on { color: var(--gold); border-color: var(--gold); }
.wz-step.done { color: var(--green); border-color: var(--green); }
.wz-field { margin-bottom: 12px; }
.wz-field label { display: block; font-size: 12px; color: var(--dim); margin-bottom: 4px; }
.wz-field input, .wz-field textarea, .wz-field select { width: 100%; background: var(--bg);
  border: 1px solid var(--line); color: var(--text); border-radius: 6px; padding: 8px 10px; font: inherit; }
.wz-field textarea { min-height: 66px; resize: vertical; }
.wz-previews { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0; }
.wz-previews img { width: 150px; height: 150px; object-fit: contain; background: #10131a;
  border: 1px solid var(--line); border-radius: 6px; }
.wz-viewer { position: relative; width: 100%; height: 340px; margin: 10px 0; background: #10131a;
  border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.wz-viewer canvas { width: 100%; height: 100%; display: block; }
.wz-viewer .wz-vstatus { position: absolute; left: 8px; bottom: 8px; font-size: 11px;
  color: var(--dim); background: rgba(6,8,12,0.62); padding: 2px 7px; border-radius: 4px;
  pointer-events: none; }
.wz-viewer select { position: absolute; right: 8px; top: 8px; max-width: 58%;
  background: var(--bg); border: 1px solid var(--line); color: var(--text);
  border-radius: 6px; padding: 5px 8px; font: inherit; font-size: 12px; }
.wz-actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
.wz-btn { border: 1px solid var(--line); background: var(--panel2); color: var(--text);
  border-radius: 7px; padding: 9px 16px; font: inherit; font-size: 13px; cursor: pointer; }
.wz-btn:hover { border-color: var(--gold); }
.wz-btn.primary { background: var(--gold); color: #14171d; border-color: var(--gold); font-weight: 600; }
.wz-btn.ghost { background: transparent; }
.wz-btn:disabled { opacity: 0.5; cursor: default; }
.wz-progress { color: var(--dim); font-size: 12px; margin: 10px 0; white-space: pre-wrap;
  max-height: 140px; overflow: auto; background: var(--bg); border: 1px solid var(--line);
  border-radius: 6px; padding: 8px 10px; font-family: ui-monospace, monospace; }
.wz-note { color: var(--amber); font-size: 12px; margin: 8px 0; }
.wz-detail-regen { margin-top: 10px; }
`;

// --- wizard controller -------------------------------------------------------
class Wizard {
  constructor() {
    document.head.append(el('style', { html: STYLE }));
    // Deliberately NO close-on-backdrop-click: a stray click outside must not drop
    // the operator out of an in-flight generation. Closing is the corner X or a
    // Cancel button, both guarded by requestClose().
    this.overlay = el('div', { class: 'wz-overlay' });
    this.modal = el('div', { class: 'wz-modal' });
    this.overlay.append(this.modal);
    document.body.append(this.overlay);
    document.body.append(
      el('button', { class: 'wz-fab', onclick: () => this.openNew() }, '+ Create asset'),
    );
    this.state = null;
    this.polling = false;
  }

  open() {
    this.overlay.classList.add('open');
  }
  close() {
    this.closeViewer();
    this.overlay.classList.remove('open');
    this.polling = false;
    this.state = null;
  }

  // Guarded close: warn before leaving once a generation is underway. The job is
  // saved to disk and resumable from the asset detail, but an accidental close
  // should not silently drop the operator out of an in-flight review.
  requestClose() {
    const s = this.state;
    const started = s && (s.jobId || ['model', 'finish', 'save'].includes(s.phase));
    if (started && s.phase !== 'done') {
      const msg = this.polling
        ? 'A generation step is still running. Close the wizard anyway? The job is saved and you can resume it from the asset detail.'
        : 'Close the wizard? The job is saved and you can resume it from the asset detail.';
      if (!window.confirm(msg)) return;
    }
    this.close();
  }

  // Clear the modal and re-add the persistent corner close (X); every screen
  // rebuilds modal.innerHTML, so the X is re-appended here rather than once.
  resetModal() {
    this.modal.innerHTML = '';
    this.modal.append(
      el(
        'button',
        {
          class: 'wz-x',
          title: 'Close',
          'aria-label': 'Close',
          onclick: () => this.requestClose(),
        },
        '×',
      ),
    );
  }

  openNew(preset = {}) {
    this.state = {
      mode: preset.jobId ? 'regenerate' : 'new',
      lane: preset.lane ?? 'creature',
      name: preset.name ?? '',
      prompt: preset.prompt ?? '',
      jobId: preset.jobId ?? null,
      // The API generation options the form exposes (lane-aware). Empty string /
      // 'auto' means "let the pipeline decide" (rig auto-detect, family from name).
      options: {
        model: 'lowpoly',
        image: '',
        rigType: '',
        height: '',
        family: '',
        rotateY: '',
        ...(preset.options || {}),
      },
      phase: 'prompt',
    };
    this.open();
    this.renderPrompt();
  }

  stepsBar(active) {
    const steps = [
      'Prompt',
      'Model',
      this.state.lane === 'creature' ? 'Animations' : 'Finish',
      'Save',
    ];
    const order = ['prompt', 'model', 'finish', 'save'];
    const ai = order.indexOf(active);
    return el(
      'div',
      { class: 'wz-steps' },
      ...steps.map((s, i) =>
        el('div', { class: 'wz-step' + (i === ai ? ' on' : i < ai ? ' done' : '') }, s),
      ),
    );
  }

  renderPrompt() {
    const s = this.state;
    this.closeViewer();
    this.resetModal();
    this.modal.append(
      el('h2', {}, s.mode === 'regenerate' ? 'Regenerate asset' : 'Create a new asset'),
      el(
        'div',
        { class: 'wz-sub' },
        'Generate a 3D model from a text description, review each step, keep what you like, and save it into the game.',
      ),
      this.stepsBar('prompt'),
    );
    const laneSel = el(
      'select',
      {},
      ...LANES.map((l) =>
        el('option', { value: l.id, ...(l.id === s.lane ? { selected: '' } : {}) }, l.label),
      ),
    );
    // Re-render when the lane changes so the lane-aware option fields update; the
    // typed name/prompt are already mirrored into state via their oninput below.
    laneSel.onchange = () => {
      s.lane = laneSel.value;
      this.renderPrompt();
    };
    const nameIn = el('input', {
      type: 'text',
      placeholder: 'snake_case name, e.g. bog_lurker',
      value: s.name,
    });
    nameIn.oninput = () => {
      s.name = nameIn.value;
    };
    const promptIn = el(
      'textarea',
      { placeholder: 'chibi swamp lurker, hunched, dripping moss, glowing eyes' },
      s.prompt,
    );
    promptIn.oninput = () => {
      s.prompt = promptIn.value;
    };
    if (s.mode === 'regenerate') {
      laneSel.disabled = true;
      nameIn.disabled = true;
    }
    this.modal.append(
      el('div', { class: 'wz-field' }, el('label', {}, 'Type'), laneSel),
      el('div', { class: 'wz-field' }, el('label', {}, 'Name'), nameIn),
      el('div', { class: 'wz-field' }, el('label', {}, 'Description (text prompt)'), promptIn),
      ...this.optionFields(s),
      el(
        'div',
        { class: 'wz-note' },
        'Kaykit chibi style is added automatically. Generating a model spends Tripo credits.',
      ),
      el(
        'div',
        { class: 'wz-actions' },
        el('button', { class: 'wz-btn ghost', onclick: () => this.requestClose() }, 'Cancel'),
        el(
          'button',
          {
            class: 'wz-btn primary',
            onclick: () => {
              s.lane = laneSel.value;
              s.name = nameIn.value.trim();
              s.prompt = promptIn.value.trim();
              if (!s.name) {
                alert('Name is required.');
                return;
              }
              if (!s.prompt && !s.options.image) {
                alert('A description or a reference image is required.');
                return;
              }
              this.submitPrompt();
            },
          },
          'Generate model',
        ),
      ),
    );
  }

  // Decide whether the prompt-screen "Generate model" starts fresh or resumes.
  // The job id is deterministic per name, so a name that was already built would
  // otherwise silently resume and show the STALE model. Regenerate-from-detail is
  // always fresh; a new-create collision asks the operator (a fresh model spends
  // credits) rather than surprising them.
  async submitPrompt() {
    const s = this.state;
    if (s.mode === 'regenerate') return this.startModel(true);
    const jobId = `${s.lane}_${safeName(s.name)}`;
    let existing = null;
    try {
      existing = await api('/api/wizard/status?job=' + encodeURIComponent(jobId));
    } catch {}
    if (existing?.exists && existing.steps?.generate === 'done') {
      const fresh = window.confirm(
        'A model already exists for this name.\n\n' +
          'OK = generate a NEW model (spends Tripo credits).\n' +
          'Cancel = review the existing model.',
      );
      return this.startModel(fresh);
    }
    return this.startModel(false);
  }

  async startModel(regenerate) {
    const s = this.state;
    s.phase = 'model';
    this.renderWorking(
      'model',
      regenerate
        ? 'Generating another model candidate...'
        : 'Generating the 3D model from your description...',
    );
    const r = await api('/api/wizard/model', {
      lane: s.lane,
      name: s.name,
      prompt: s.prompt,
      options: s.options,
      regenerate,
    });
    if (r.error) return this.renderError(r.error, () => this.renderPrompt());
    s.jobId = r.jobId;
    this.pollUntilIdle(() => this.renderModelReview());
  }

  renderModelReview() {
    const s = this.state;
    const models = (this._status.previews || []).filter((p) => p.group === 'model');
    this.closeViewer();
    this.resetModal();
    this.modal.append(
      el('h2', {}, 'Review the model'),
      el(
        'div',
        { class: 'wz-sub' },
        'Drag to rotate, scroll to zoom. Keep this model, or regenerate for another candidate. Nothing is saved yet.',
      ),
      this.stepsBar('model'),
      this.reviewPreview(this._status.modelGlb, models, 'No model rendered; check the log.'),
      this.logBox(),
      el(
        'div',
        { class: 'wz-actions' },
        el('button', { class: 'wz-btn ghost', onclick: () => this.requestClose() }, 'Cancel'),
        el('button', { class: 'wz-btn', onclick: () => this.startModel(true) }, 'Regenerate model'),
        el(
          'button',
          { class: 'wz-btn primary', onclick: () => this.startFinish(false) },
          s.lane === 'creature' ? 'Keep, add animations' : 'Keep, finish',
        ),
      ),
    );
  }

  async startFinish(regen) {
    const s = this.state;
    s.phase = 'finish';
    this.renderWorking(
      'finish',
      s.lane === 'creature'
        ? regen
          ? 'Re-rigging and re-generating the animations...'
          : 'Rigging and generating the animations...'
        : 'Finishing the model (normalize, icon, previews)...',
    );
    const r = await api('/api/wizard/finish', {
      lane: s.lane,
      jobId: s.jobId,
      options: s.options,
      regenerateAnimations: regen,
    });
    if (r.error) return this.renderError(r.error, () => this.renderModelReview());
    this.pollUntilIdle(() => this.renderFinalReview());
  }

  renderFinalReview() {
    const s = this.state;
    const finals = (this._status.previews || []).filter((p) => p.group === 'final');
    const val = this._status.validation;
    this.closeViewer();
    this.resetModal();
    this.modal.append(
      el('h2', {}, s.lane === 'creature' ? 'Review the animations' : 'Review the finished asset'),
      el(
        'div',
        { class: 'wz-sub' },
        s.lane === 'creature'
          ? 'Pick a clip from the dropdown to watch it play. Approve to save into the game, or regenerate.'
          : 'Drag to rotate, scroll to zoom. Approve to save into the game, or regenerate.',
      ),
      this.stepsBar('finish'),
      this.reviewPreview(this._status.finalGlb, finals, 'No finished asset yet.'),
      val && !val.ok
        ? el(
            'div',
            { class: 'wz-note' },
            'Validation warnings: ' + (val.errors || val.warnings || []).join('; '),
          )
        : null,
      this.logBox(),
      el(
        'div',
        { class: 'wz-actions' },
        el('button', { class: 'wz-btn ghost', onclick: () => this.requestClose() }, 'Cancel'),
        s.lane === 'creature'
          ? el(
              'button',
              { class: 'wz-btn', onclick: () => this.startFinish(true) },
              'Regenerate animations',
            )
          : el(
              'button',
              { class: 'wz-btn', onclick: () => this.startModel(true) },
              'Regenerate model',
            ),
        el(
          'button',
          { class: 'wz-btn primary', onclick: () => this.startApply() },
          'Approve and save',
        ),
      ),
    );
  }

  async startApply() {
    const s = this.state;
    s.phase = 'save';
    this.renderWorking(
      'save',
      'Saving the asset into the game (copying the model, wiring credits)...',
    );
    const r = await api('/api/wizard/apply', { lane: s.lane, jobId: s.jobId });
    if (r.error) return this.renderError(r.error, () => this.renderFinalReview());
    this.pollUntilIdle(() => this.renderDone());
  }

  renderDone() {
    if (this.state) this.state.phase = 'done';
    this.closeViewer();
    this.resetModal();
    this.modal.append(
      el('h2', {}, 'Saved'),
      el(
        'div',
        { class: 'wz-sub' },
        'The model was copied into public/models/ and CREDITS.md updated. For creatures, wire the printed VisualDef/MOB_KEYS snippet (in the log) into src/render/characters/manifest.ts.',
      ),
      this.stepsBar('save'),
      this.logBox(true),
      el(
        'div',
        { class: 'wz-actions' },
        el(
          'button',
          {
            class: 'wz-btn primary',
            onclick: () => {
              this.close();
              location.reload();
            },
          },
          'Done (reload library)',
        ),
      ),
    );
  }

  // --- shared render bits ----
  renderWorking(step, msg) {
    this.closeViewer();
    this.resetModal();
    this.modal.append(
      el('h2', {}, 'Working...'),
      el('div', { class: 'wz-sub' }, msg),
      this.stepsBar(step),
      this.logBox(),
    );
  }
  renderError(msg, back) {
    this.closeViewer();
    this.resetModal();
    this.modal.append(
      el('h2', {}, 'Something went wrong'),
      el('div', { class: 'wz-note' }, String(msg)),
      this.logBox(),
      el(
        'div',
        { class: 'wz-actions' },
        el('button', { class: 'wz-btn ghost', onclick: () => this.requestClose() }, 'Close'),
        back ? el('button', { class: 'wz-btn', onclick: back }, 'Back') : null,
      ),
    );
  }
  previewRow(list, empty) {
    if (!list.length) return el('div', { class: 'wz-sub' }, empty);
    return el(
      'div',
      { class: 'wz-previews' },
      ...list
        .slice(0, 10)
        .map((p) =>
          el('img', { src: p.url + '?t=' + Math.floor(p.mtime), alt: p.name, title: p.name }),
        ),
    );
  }

  laneCategory() {
    const l = this.state?.lane;
    return l === 'creature' ? 'creatures' : l === 'weapon' ? 'weapons' : 'props';
  }

  // Prefer the LIVE in-browser viewer (real GLB, orbit + clip playback) over the
  // server-rendered PNG strip: the wizard runs in a real browser, so it needs no
  // headless Chrome. Falls back to the PNG row only if a GLB is not available yet.
  liveViewer(repoGlb) {
    const canvas = el('canvas', {});
    const clipSelect = el('select', { title: 'animation clip' });
    const statusEl = el('div', { class: 'wz-vstatus' }, 'loading model...');
    const wrap = el('div', { class: 'wz-viewer' }, canvas, clipSelect, statusEl);
    const asset = { repoGlb, kind: 'model', category: this.laneCategory() };
    // Mount after the node is laid out so the viewer sizes to the canvas rect.
    requestAnimationFrame(() => {
      if (window.LiveViewer) window.LiveViewer.open(asset, { canvas, clipSelect, statusEl });
      else statusEl.textContent = 'live viewer unavailable';
    });
    return wrap;
  }

  reviewPreview(glb, pngs, empty) {
    if (glb) return this.liveViewer(glb);
    if (pngs.length) return this.previewRow(pngs, empty);
    return el('div', { class: 'wz-sub' }, empty);
  }

  // Tear down any mounted live viewer before replacing modal content, so the
  // WebGL context and its animation loop do not leak across screens.
  closeViewer() {
    if (window.LiveViewer) window.LiveViewer.close();
  }

  // Lane-aware API generation options. Each input writes straight into
  // state.options, so values survive a lane-change re-render and are read back on
  // submit and on every regenerate without a separate collection pass. The server
  // (lib/wizard.mjs genArgs) allowlists/clamps everything before it becomes a CLI arg.
  optionFields(s) {
    const o = s.options;
    const field = (label, input) => el('div', { class: 'wz-field' }, el('label', {}, label), input);
    const sel = (key, opts) => {
      const n = el(
        'select',
        {},
        ...opts.map(([v, t]) =>
          el('option', { value: v, ...(o[key] === v ? { selected: '' } : {}) }, t),
        ),
      );
      n.onchange = () => {
        o[key] = n.value;
      };
      return n;
    };
    const txt = (key, placeholder, type = 'text') => {
      const n = el('input', { type, placeholder, value: o[key] ?? '' });
      n.oninput = () => {
        o[key] = n.value.trim();
      };
      return n;
    };
    const fields = [
      field(
        'Model quality',
        sel('model', [
          ['lowpoly', 'Low-poly (game, default)'],
          ['hifi', 'High fidelity (H-series, more credits)'],
        ]),
      ),
    ];
    if (s.lane === 'creature') {
      fields.push(
        field(
          'Rig type',
          sel('rigType', [
            ['', 'Auto-detect'],
            ['biped', 'Biped (humanoid, full clip set)'],
            ['quadruped', 'Quadruped (4 legs)'],
            ['hexapod', 'Hexapod (6 legs)'],
            ['octopod', 'Octopod (8 legs)'],
            ['serpentine', 'Serpentine (snake)'],
            ['aquatic', 'Aquatic (fish)'],
          ]),
        ),
        field('Height (world units)', txt('height', 'e.g. 2.0', 'number')),
      );
    } else if (s.lane === 'weapon') {
      fields.push(
        field(
          'Weapon family',
          sel('family', [
            ['', 'Auto (from name)'],
            ['sword', 'Sword'],
            ['dagger', 'Dagger'],
            ['axe', 'Axe / hammer'],
            ['staff', 'Staff'],
            ['wand', 'Wand'],
            ['polearm', 'Polearm (spear / halberd / scythe)'],
          ]),
        ),
      );
    } else if (s.lane === 'prop') {
      fields.push(
        field('Height (world units)', txt('height', 'e.g. 2.4', 'number')),
        field('Rotate Y (degrees)', txt('rotateY', 'e.g. 90', 'number')),
      );
    }
    fields.push(
      field(
        'Reference image (optional)',
        txt('image', 'URL or Tripo task id (task_...); overrides text for geometry'),
      ),
    );
    return fields;
  }
  logBox(open) {
    const box = el(
      'div',
      { class: 'wz-progress' },
      (this._status?.log || '').trim() || 'starting...',
    );
    this._logBox = box;
    return box;
  }

  // Poll status until no child is running, refreshing the log box live, then run cb.
  async pollUntilIdle(cb) {
    this.polling = true;
    const jobId = this.state.jobId;
    for (;;) {
      if (!this.polling) return;
      const st = await api('/api/wizard/status?job=' + encodeURIComponent(jobId));
      this._status = st;
      if (this._logBox) this._logBox.textContent = (st.log || '').trim() || 'working...';
      if (!st.running) break;
      await sleep(1500);
    }
    if (this.polling) cb();
  }

  // Per-asset Regenerate button, injected into the open detail inspector.
  onDetail(asset) {
    const lane = laneOf(asset);
    const inspector = document.getElementById('inspector');
    if (!inspector || !lane) return;
    if (inspector.querySelector('.wz-detail-regen')) return;
    const priorPrompt = asset.job?.prompt || asset.prompt || '';
    inspector.prepend(
      el(
        'div',
        { class: 'wz-detail-regen' },
        el(
          'button',
          {
            class: 'wz-btn',
            onclick: () => {
              document.getElementById('overlay')?.classList.remove('open');
              this.openNew({
                lane,
                name: asset.name,
                prompt: priorPrompt,
                jobId: asset.job?.id || asset.name,
              });
            },
          },
          'Regenerate this asset',
        ),
      ),
    );
  }
}

const wizard = new Wizard();
window.WizardUI = wizard;
