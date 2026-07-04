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
.wz-modal { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  width: min(760px, 94vw); max-height: 92vh; overflow: auto; padding: 18px 20px; }
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
    this.overlay = el('div', {
      class: 'wz-overlay',
      onclick: (e) => {
        if (e.target === this.overlay) this.close();
      },
    });
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
    this.overlay.classList.remove('open');
    this.polling = false;
    this.state = null;
  }

  openNew(preset = {}) {
    this.state = {
      mode: preset.jobId ? 'regenerate' : 'new',
      lane: preset.lane ?? 'creature',
      name: preset.name ?? '',
      prompt: preset.prompt ?? '',
      jobId: preset.jobId ?? null,
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
    this.modal.innerHTML = '';
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
    const nameIn = el('input', {
      type: 'text',
      placeholder: 'snake_case name, e.g. bog_lurker',
      value: s.name,
    });
    const promptIn = el(
      'textarea',
      { placeholder: 'chibi swamp lurker, hunched, dripping moss, glowing eyes' },
      s.prompt,
    );
    if (s.mode === 'regenerate') {
      laneSel.disabled = true;
      nameIn.disabled = true;
    }
    this.modal.append(
      el('div', { class: 'wz-field' }, el('label', {}, 'Type'), laneSel),
      el('div', { class: 'wz-field' }, el('label', {}, 'Name'), nameIn),
      el('div', { class: 'wz-field' }, el('label', {}, 'Description (text prompt)'), promptIn),
      el(
        'div',
        { class: 'wz-note' },
        'Kaykit chibi style is added automatically. Generating a model spends Tripo credits.',
      ),
      el(
        'div',
        { class: 'wz-actions' },
        el('button', { class: 'wz-btn ghost', onclick: () => this.close() }, 'Cancel'),
        el(
          'button',
          {
            class: 'wz-btn primary',
            onclick: () => {
              s.lane = laneSel.value;
              s.name = nameIn.value.trim();
              s.prompt = promptIn.value.trim();
              if (!s.name || !s.prompt) {
                alert('Name and description are required.');
                return;
              }
              this.startModel(false);
            },
          },
          'Generate model',
        ),
      ),
    );
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
      regenerate,
      jobExists: s.mode === 'regenerate' || !!s.jobId,
    });
    if (r.error) return this.renderError(r.error, () => this.renderPrompt());
    s.jobId = r.jobId;
    this.pollUntilIdle(() => this.renderModelReview());
  }

  renderModelReview() {
    const s = this.state;
    const models = (this._status.previews || []).filter((p) => p.group === 'model');
    this.modal.innerHTML = '';
    this.modal.append(
      el('h2', {}, 'Review the model'),
      el(
        'div',
        { class: 'wz-sub' },
        'Keep this model, or regenerate for another candidate. Nothing is saved yet.',
      ),
      this.stepsBar('model'),
      this.previewRow(models, 'No preview rendered; check the log.'),
      this.logBox(),
      el(
        'div',
        { class: 'wz-actions' },
        el('button', { class: 'wz-btn ghost', onclick: () => this.close() }, 'Cancel'),
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
      regenerateAnimations: regen,
    });
    if (r.error) return this.renderError(r.error, () => this.renderModelReview());
    this.pollUntilIdle(() => this.renderFinalReview());
  }

  renderFinalReview() {
    const s = this.state;
    const finals = (this._status.previews || []).filter((p) => p.group === 'final');
    const val = this._status.validation;
    this.modal.innerHTML = '';
    this.modal.append(
      el('h2', {}, s.lane === 'creature' ? 'Review the animations' : 'Review the finished asset'),
      el(
        'div',
        { class: 'wz-sub' },
        'Each frame is one animation pose. Approve to save into the game, or regenerate.',
      ),
      this.stepsBar('finish'),
      this.previewRow(finals, 'No final previews yet.'),
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
        el('button', { class: 'wz-btn ghost', onclick: () => this.close() }, 'Cancel'),
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
    this.modal.innerHTML = '';
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
    this.modal.innerHTML = '';
    this.modal.append(
      el('h2', {}, 'Working...'),
      el('div', { class: 'wz-sub' }, msg),
      this.stepsBar(step),
      this.logBox(),
    );
  }
  renderError(msg, back) {
    this.modal.innerHTML = '';
    this.modal.append(
      el('h2', {}, 'Something went wrong'),
      el('div', { class: 'wz-note' }, String(msg)),
      this.logBox(),
      el(
        'div',
        { class: 'wz-actions' },
        el('button', { class: 'wz-btn ghost', onclick: () => this.close() }, 'Close'),
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
