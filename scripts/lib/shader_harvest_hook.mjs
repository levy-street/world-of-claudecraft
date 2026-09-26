// The page side of the shader harvest (scripts/shader_harvest.mjs): an init
// script installed before any page script, so it sees every program of EVERY
// GL context the page mints (the world renderer, the preview and portrait
// contexts, the post chain, PMREM, the water simulation, the bakes), with no
// change to the game's source. It keeps the exact text the page handed the
// driver and makes no GL call of its own, so the session links exactly what it
// would have linked without it.
//
// The function below is serialized by puppeteer (evaluateOnNewDocument), so it
// must stay self-contained: no imports, no closure over module scope.

export function installShaderHarvestHook() {
  if (window.__shaderHarvest) return;
  const contexts = [];
  const contextOf = new WeakMap();
  const shaderInfo = new WeakMap();
  const programInfo = new WeakMap();
  // text key -> record; `fresh` holds the records no drain has shipped yet.
  const seen = new Map();
  const seenPairs = new Set();
  let fresh = [];
  const state = {
    step: 'boot',
    links: 0,
    lastLinkAt: 0,
    // Asset requests in flight: a step is not settled while a model or a
    // texture is still on the wire, whatever the link clock says.
    inflight: 0,
    contexts,
    /** Whether a link with exactly these two texts went through the hook. */
    hasPair(vertex, fragment) {
      return seenPairs.has(`${vertex}\u0000${fragment}`);
    },
    drain() {
      const out = fresh;
      fresh = [];
      return {
        programs: out,
        links: state.links,
        contexts: contexts.map((c) => ({ ...c, extensions: [...c.extensions] })),
        // A record ships its texts once; what keeps moving afterwards (link
        // count, the steps and contexts that met it again) rides every drain.
        meta: [...seen.values()].map((r) => ({
          key: r.key,
          links: r.links,
          steps: r.steps,
          contexts: r.contexts,
        })),
      };
    },
  };
  window.__shaderHarvest = state;

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (...fetchArgs) {
      state.inflight += 1;
      const done = () => {
        state.inflight -= 1;
      };
      const pending = nativeFetch.apply(this, fetchArgs);
      pending.then(done, done);
      return pending;
    };
  }

  const describeContext = (gl) => {
    let entry = contextOf.get(gl);
    if (entry) return entry;
    const canvas = gl.canvas;
    const isElement =
      typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement;
    entry = {
      id: contexts.length,
      webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
      canvas: isElement
        ? `canvas#${canvas.id || ''}.${String(canvas.className || '').replace(/\s+/g, '.')}`
        : 'offscreen',
      createdAtStep: state.step,
      attributes: null,
      extensions: [],
    };
    try {
      entry.attributes = gl.getContextAttributes();
    } catch {
      // a lost context reports nothing
    }
    contexts.push(entry);
    contextOf.set(gl, entry);
    return entry;
  };

  const wrap = (proto) => {
    if (!proto) return;
    const {
      createShader,
      shaderSource,
      attachShader,
      bindAttribLocation,
      linkProgram,
      getExtension,
    } = proto;
    proto.getExtension = function (name) {
      const ext = getExtension.call(this, name);
      if (ext) {
        const entry = describeContext(this);
        if (!entry.extensions.includes(name)) entry.extensions.push(name);
      }
      return ext;
    };
    proto.createShader = function (type) {
      const shader = createShader.call(this, type);
      if (shader) shaderInfo.set(shader, { type, source: '' });
      return shader;
    };
    proto.shaderSource = function (shader, source) {
      const info = shaderInfo.get(shader);
      if (info) info.source = String(source);
      return shaderSource.call(this, shader, source);
    };
    proto.attachShader = function (program, shader) {
      let info = programInfo.get(program);
      if (!info) {
        info = { shaders: [], index0: '' };
        programInfo.set(program, info);
      }
      info.shaders.push(shader);
      return attachShader.call(this, program, shader);
    };
    proto.bindAttribLocation = function (program, index, name) {
      if (index === 0) {
        let info = programInfo.get(program);
        if (!info) {
          info = { shaders: [], index0: '' };
          programInfo.set(program, info);
        }
        info.index0 = String(name);
      }
      return bindAttribLocation.call(this, program, index, name);
    };
    proto.linkProgram = function (program) {
      try {
        const info = programInfo.get(program);
        let vertex = '';
        let fragment = '';
        for (const shader of info?.shaders ?? []) {
          const s = shaderInfo.get(shader);
          if (!s) continue;
          if (s.type === this.VERTEX_SHADER) vertex = s.source;
          else if (s.type === this.FRAGMENT_SHADER) fragment = s.source;
        }
        const index0 = info?.index0 ?? '';
        const key = `${vertex}\u0000${fragment}\u0000${index0}`;
        const ctx = describeContext(this);
        seenPairs.add(`${vertex}\u0000${fragment}`);
        state.links += 1;
        state.lastLinkAt = performance.now();
        let record = seen.get(key);
        if (!record) {
          record = {
            key: seen.size,
            vertex,
            fragment,
            index0,
            firstStep: state.step,
            firstContext: ctx.id,
            steps: [state.step],
            contexts: [ctx.id],
            links: 0,
          };
          seen.set(key, record);
          fresh.push(record);
        }
        record.links += 1;
        if (!record.steps.includes(state.step)) record.steps.push(state.step);
        if (!record.contexts.includes(ctx.id)) record.contexts.push(ctx.id);
      } catch {
        // the harvest never breaks the page's own link
      }
      return linkProgram.call(this, program);
    };
  };
  wrap(typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext.prototype : null);
  wrap(typeof WebGLRenderingContext !== 'undefined' ? WebGLRenderingContext.prototype : null);
}
