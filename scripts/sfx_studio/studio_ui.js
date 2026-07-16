const token = document.querySelector('meta[name="studio-token"]').content;
const $ = (id) => document.getElementById(id);
const clone = (value) => structuredClone(value);
const db = (linear) => (linear > 0 ? 20 * Math.log10(linear) : -Infinity);

function playbackAuthoring(value) {
  return value
    ? {
        categoryBaselineDb: value.categoryBaselineDb,
        keyTrimDb: value.keyTrimDb,
        playbackRate: value.playbackRate,
      }
    : null;
}

const state = {
  catalog: null,
  filtered: [],
  selected: null,
  project: null,
  playback: null,
  playbackProfileHash: null,
  playbackWorkspaceHash: null,
  audioWorkspaceHash: null,
  playbackProfileDirty: false,
  projectResponse: null,
  buffer: null,
  waveformEnvelope: null,
  waveformCache: null,
  exactBuffer: null,
  exactWaveformEnvelope: null,
  exactUrl: null,
  exactResult: null,
  audition: 'source',
  audioContext: null,
  playing: null,
  playhead: 0,
  selection: null,
  zoom: 1,
  viewStart: 0,
  dragging: false,
  history: [],
  historyIndex: -1,
  dirty: false,
  autosaveTimer: null,
  saveTail: Promise.resolve(),
  loadSequence: 0,
  projectRevision: 0,
  playbackRevision: 0,
  uploading: false,
};

async function api(path, options = {}) {
  const method = options.method ?? 'GET';
  const headers = new Headers(options.headers ?? {});
  headers.set('X-Woc-Sfx-Studio', token);
  let body = options.body;
  if (body && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }
  const response = await fetch(path, { method, headers, body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `${method} ${path} failed (${response.status})`);
  return data;
}

function setStatus(message, kind = '') {
  $('status').textContent = message;
  $('status').style.color = kind === 'error' ? 'var(--red)' : kind === 'ok' ? 'var(--green)' : '';
}

function setUploadBusy(value) {
  state.uploading = value;
  for (const id of [
    'upload',
    'save',
    'reset-draft',
    'render',
    'publish-playback',
    'publish',
    'export-all',
  ]) {
    $(id).disabled = value;
  }
  renderCatalog();
  syncControls();
  updateHistoryButtons();
  updateTimelineLabels();
}

function setDirty(value) {
  state.dirty = value;
  $('dirty').textContent = value ? 'unsaved' : 'clean';
  $('dirty').className = `badge ${value ? 'warn' : 'good'}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  return `${Math.round(bytes / 1024)} KiB`;
}

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const millis = Math.floor((safe - Math.floor(safe)) * 1000);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function formatLevel(value, suffix) {
  return Number.isFinite(value) ? `${Number(value).toFixed(1)} ${suffix}` : `-inf ${suffix}`;
}

function getPath(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}

function setPath(object, path, value) {
  const parts = path.split('.');
  let target = object;
  for (const part of parts.slice(0, -1)) target = target[part];
  target[parts.at(-1)] = value;
}

function outputText(path, value) {
  if (path === 'loop.crossfadeMs') return `D = ${Math.round(value)} ms`;
  if (path.endsWith('truePeakDb') || path.endsWith('ceilingDb'))
    return `${Number(value).toFixed(1)} dBTP`;
  if (path.endsWith('targetLufs')) return `${Number(value).toFixed(1)} LUFS`;
  if (path.endsWith('Db') || path.endsWith('gainDb')) return `${Number(value).toFixed(1)} dB`;
  if (path.endsWith('Ms')) return `${Math.round(value)} ms`;
  if (path.endsWith('Hz')) return `${Math.round(value)} Hz`;
  if (path === 'playbackRate') return `${Number(value).toFixed(2)}x`;
  if (path === 'compressor.ratio') return `${Number(value).toFixed(1)}:1`;
  if (path === 'compressor.mix') return `${Math.round(Number(value) * 100)}%`;
  if (path.endsWith('Q')) return Number(value).toFixed(2);
  return String(value);
}

function syncControls() {
  if (!state.project) return;
  for (const control of document.querySelectorAll('[data-path]')) {
    const value = getPath(state.project, control.dataset.path);
    if (control.type === 'checkbox') control.checked = !!value;
    else control.value = value;
  }
  for (const output of document.querySelectorAll('[data-out]')) {
    const value = getPath(state.project, output.dataset.out);
    output.value = outputText(output.dataset.out, value);
    output.textContent = output.value;
  }
  if (state.playback) {
    for (const control of document.querySelectorAll('[data-playback-path]')) {
      const value = getPath(state.playback, control.dataset.playbackPath);
      control.value = value;
    }
    for (const output of document.querySelectorAll('[data-playback-out]')) {
      const value = getPath(state.playback, output.dataset.playbackOut);
      output.value = outputText(output.dataset.playbackOut, value);
      output.textContent = output.value;
    }
  }
  const loopEnabled = !!state.project.loop?.enabled;
  const catalogLoop = !!state.selected?.loop;
  for (const path of ['delayMs', 'fadeInMs', 'fadeOutMs']) {
    const control = document.querySelector(`[data-path="${path}"]`);
    if (control) control.disabled = loopEnabled;
  }
  const loopToggle = document.querySelector('[data-path="loop.enabled"]');
  if (loopToggle) loopToggle.disabled = true;
  const loopCrossfade = document.querySelector('[data-path="loop.crossfadeMs"]');
  if (loopCrossfade) loopCrossfade.disabled = !catalogLoop;
  if (state.uploading) {
    for (const control of document.querySelectorAll('[data-path]')) control.disabled = true;
    for (const control of document.querySelectorAll('[data-playback-path]')) {
      control.disabled = true;
    }
  }
  const resolved = document.querySelector('[data-playback-path="resolvedGainDb"]');
  if (resolved) resolved.disabled = true;
  const categoryBaseline = document.querySelector('[data-playback-path="categoryBaselineDb"]');
  if (categoryBaseline) {
    categoryBaseline.min = String(state.playback?.categoryBaselineMinDb ?? -60);
    categoryBaseline.max = String(state.playback?.categoryBaselineMaxDb ?? 0);
    categoryBaseline.disabled = state.uploading;
    categoryBaseline.title = state.playback
      ? `Shared by every ${state.playback.category} cue. Safe range with current key trims: ${state.playback.categoryBaselineMinDb.toFixed(1)} to ${state.playback.categoryBaselineMaxDb.toFixed(1)} dB.`
      : '';
  }
  const keyTrim = document.querySelector('[data-playback-path="keyTrimDb"]');
  if (keyTrim) {
    const baseline = Number(state.playback?.categoryBaselineDb ?? 0);
    keyTrim.min = String(Math.max(-60, -60 - baseline));
    keyTrim.max = String(Math.min(24, -baseline));
    keyTrim.disabled = state.uploading;
  }
  for (const control of document.querySelectorAll('[data-playback-path]')) {
    if (
      control.dataset.playbackPath !== 'resolvedGainDb' &&
      control !== keyTrim &&
      control !== categoryBaseline
    ) {
      control.disabled = state.uploading;
    }
  }
  $('publish-playback').disabled = state.uploading || !state.playbackProfileDirty;
  $('publish-playback').textContent = state.playbackProfileDirty
    ? 'Apply playback mix'
    : 'Playback mix applied';
  $('clear-loop').disabled = state.uploading || !catalogLoop || !loopEnabled;
  drawEqCurve();
  drawWaveform();
}

function pushHistory() {
  if (!state.project) return;
  const snapshot = { project: clone(state.project), playback: playbackAuthoring(state.playback) };
  const current = state.history[state.historyIndex];
  if (current && JSON.stringify(current) === JSON.stringify(snapshot)) return;
  state.history.splice(state.historyIndex + 1);
  state.history.push(snapshot);
  if (state.history.length > 100) state.history.shift();
  state.historyIndex = state.history.length - 1;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('undo').disabled = state.uploading || state.historyIndex <= 0;
  $('redo').disabled =
    state.uploading || state.historyIndex < 0 || state.historyIndex >= state.history.length - 1;
}

function restoreHistory(index) {
  if (state.uploading) return;
  if (index < 0 || index >= state.history.length) return;
  stopPlayback();
  const previousProject = JSON.stringify(state.project);
  const previousPlayback = JSON.stringify(state.playback);
  state.historyIndex = index;
  state.project = clone(state.history[index].project);
  state.playback = { ...state.playback, ...clone(state.history[index].playback) };
  refreshResolvedPlayback();
  if (JSON.stringify(state.playback) !== previousPlayback) {
    state.playbackProfileDirty = true;
    state.playbackRevision++;
  }
  if (JSON.stringify(state.project) !== previousProject) {
    state.exactBuffer = null;
    state.exactWaveformEnvelope = null;
    state.exactUrl = null;
    state.exactResult = null;
    state.audition = 'live';
    state.projectRevision++;
  }
  setDirty(true);
  syncControls();
  updateAuditionButton();
  renderSelectedMetadata();
  updateHistoryButtons();
  scheduleAutosave();
}

function scheduleAutosave() {
  clearTimeout(state.autosaveTimer);
  state.autosaveTimer = setTimeout(() => void saveDraft(true), 900);
}

function projectChanged({ commit = false } = {}) {
  stopPlayback(false);
  state.exactBuffer = null;
  state.exactWaveformEnvelope = null;
  state.exactUrl = null;
  state.exactResult = null;
  state.projectRevision++;
  if (state.audition === 'rendered') {
    state.audition = 'live';
    setStatus(liveAuditionStatus());
  }
  setDirty(true);
  syncControls();
  updateAuditionButton();
  renderSelectedMetadata();
  if (commit) pushHistory();
  scheduleAutosave();
}

function refreshResolvedPlayback() {
  if (!state.playback) return;
  let trim = Math.min(24, Math.max(-60, Number(state.playback.keyTrimDb)));
  const otherMin = Number(state.playback.categoryOtherBaselineMinDb ?? -60);
  const otherMax = Number(state.playback.categoryOtherBaselineMaxDb ?? 0);
  let safeMin = Math.max(otherMin, -60 - trim);
  let safeMax = Math.min(otherMax, -trim);
  const baseline = Math.min(safeMax, Math.max(safeMin, Number(state.playback.categoryBaselineDb)));
  state.playback.categoryBaselineDb = baseline;
  trim = Math.min(Math.min(24, -baseline), Math.max(Math.max(-60, -60 - baseline), trim));
  state.playback.keyTrimDb = trim;
  safeMin = Math.max(otherMin, -60 - trim);
  safeMax = Math.min(otherMax, -trim);
  state.playback.categoryBaselineMinDb = safeMin;
  state.playback.categoryBaselineMaxDb = safeMax;
  state.playback.resolvedGainDb = Number(
    (Number(state.playback.categoryBaselineDb) + Number(state.playback.keyTrimDb)).toFixed(3),
  );
  state.playback.gain = Number((10 ** (state.playback.resolvedGainDb / 20)).toFixed(6));
}

function playbackChanged({ commit = false } = {}) {
  if (!state.playback) return;
  stopPlayback(false);
  refreshResolvedPlayback();
  state.playbackRevision++;
  state.playbackProfileDirty = true;
  setDirty(true);
  state.waveformCache = null;
  syncControls();
  renderSelectedMetadata();
  if (commit) pushHistory();
  scheduleAutosave();
}

function authoredPlaybackRate() {
  return Math.max(0.25, Math.min(4, Number(state.playback?.playbackRate) || 1));
}

function currentDuration() {
  return state.buffer?.duration ?? 0;
}

function displayBuffer() {
  return state.audition === 'rendered' && state.exactBuffer ? state.exactBuffer : state.buffer;
}

function displayEnvelope() {
  return state.audition === 'rendered' && state.exactWaveformEnvelope
    ? state.exactWaveformEnvelope
    : state.waveformEnvelope;
}

function displayDuration() {
  return displayBuffer()?.duration ?? 0;
}

function segmentTimeline() {
  const duration = currentDuration();
  const speed = authoredPlaybackRate();
  const delay = Math.max(0, Number(state.project?.delayMs) || 0) / 1000 / speed;
  const segments = state.project?.segments?.length
    ? state.project.segments
    : [{ start: 0, end: duration }];
  let sourceCrossfade = 0;
  if (segments.length > 1 && state.project?.sliceCrossfadeMs > 0) {
    const shortest = Math.min(...segments.map((segment) => segment.end - segment.start));
    sourceCrossfade = Math.min(state.project.sliceCrossfadeMs / 1000, shortest / 2);
  }
  const outputCrossfade = sourceCrossfade / speed;
  let cursor = delay;
  const entries = segments.map((segment, index) => {
    if (index > 0) cursor -= outputCrossfade;
    const outputStart = cursor;
    const outputLength = (segment.end - segment.start) / speed;
    cursor += outputLength;
    return {
      ...segment,
      outputStart,
      outputEnd: cursor,
      outputLength,
      fadeIn: index > 0 ? outputCrossfade : 0,
      fadeOut: index < segments.length - 1 ? outputCrossfade : 0,
    };
  });
  return { entries, speed, delay, outputCrossfade, duration: Math.max(delay, cursor) };
}

function effectiveLoopPlan() {
  const loop = state.project?.loop;
  const duration = currentDuration();
  if (!loop?.enabled || duration <= 0) return null;
  const speed = authoredPlaybackRate();
  const start = Math.min(duration, Math.max(0, Number(loop.start) || 0));
  const end = Math.min(duration, Math.max(start, Number(loop.end) || duration));
  const sourceDuration = end - start;
  if (sourceDuration < 0.001) return null;
  const processedDuration = sourceDuration / speed;
  const requestedCrossfade = Math.max(0, Number(loop.crossfadeMs) || 0) / 1000;
  const maxCrossfade = Math.max(0, (sourceDuration - 0.002) / 2);
  const bakedCrossfade = Math.round(Math.min(requestedCrossfade, maxCrossfade) * 1e6) / 1e6;
  const crossfade = bakedCrossfade >= 0.001 ? bakedCrossfade / speed : 0;
  return {
    start,
    end,
    speed,
    sourceDuration,
    processedDuration,
    crossfade,
    sourceCrossfade: bakedCrossfade >= 0.001 ? bakedCrossfade : 0,
    outputDuration: Math.max(0, processedDuration - crossfade),
  };
}

function projectDuration() {
  if (!state.project) return currentDuration();
  const loopPlan = effectiveLoopPlan();
  if (loopPlan) return loopPlan.outputDuration;
  return segmentTimeline().duration;
}

function outputToSourceTime(outputTime) {
  const output = Math.max(0, Number(outputTime) || 0);
  const loop = effectiveLoopPlan();
  if (loop) {
    if (loop.crossfade > 0 && output < loop.crossfade) {
      const sourceOffset = output * loop.speed;
      return output < loop.crossfade / 2
        ? loop.end - loop.sourceCrossfade + sourceOffset
        : loop.start + sourceOffset;
    }
    return Math.min(
      loop.end - loop.sourceCrossfade,
      loop.start + loop.sourceCrossfade + Math.max(0, output - loop.crossfade) * loop.speed,
    );
  }
  const timeline = segmentTimeline();
  if (output <= timeline.delay) return timeline.entries[0]?.start ?? 0;
  const active = timeline.entries.filter(
    (entry) => output >= entry.outputStart && output <= entry.outputEnd,
  );
  const incoming = active.at(-1);
  const entry =
    active.length > 1 && incoming && output < incoming.outputStart + incoming.fadeIn / 2
      ? active[0]
      : (incoming ?? timeline.entries.at(-1));
  if (!entry) return 0;
  return Math.min(
    entry.end,
    entry.start + Math.max(0, output - entry.outputStart) * timeline.speed,
  );
}

function sourceToOutputTime(sourceTime) {
  const source = Math.max(0, Number(sourceTime) || 0);
  const loop = effectiveLoopPlan();
  if (loop) {
    if (source >= loop.end - loop.sourceCrossfade && source <= loop.end) {
      return (source - (loop.end - loop.sourceCrossfade)) / loop.speed;
    }
    if (source >= loop.start && source <= loop.start + loop.sourceCrossfade) {
      return (source - loop.start) / loop.speed;
    }
    if (source >= loop.start + loop.sourceCrossfade && source <= loop.end) {
      return loop.crossfade + (source - loop.start - loop.sourceCrossfade) / loop.speed;
    }
    return source < loop.start ? 0 : loop.outputDuration;
  }
  const timeline = segmentTimeline();
  const entry =
    timeline.entries.find((candidate) => source >= candidate.start && source <= candidate.end) ??
    timeline.entries.reduce((best, candidate) => {
      if (!best) return candidate;
      const distance = Math.min(
        Math.abs(source - candidate.start),
        Math.abs(source - candidate.end),
      );
      const bestDistance = Math.min(Math.abs(source - best.start), Math.abs(source - best.end));
      return distance < bestDistance ? candidate : best;
    }, null);
  if (!entry) return 0;
  const clamped = Math.min(entry.end, Math.max(entry.start, source));
  return entry.outputStart + (clamped - entry.start) / timeline.speed;
}

function waveformPlayheadTime() {
  if (state.audition === 'rendered') return state.playhead * authoredPlaybackRate();
  if (state.audition === 'source') return state.playhead;
  return outputToSourceTime(state.playhead);
}

function renderCatalog() {
  if (!state.catalog) return;
  const summary = state.catalog.summary;
  $('summary').textContent =
    `${summary.clips} sampled cues, ${summary.tracks} published tracks, ${summary.loops} loops, ${summary.routed} routed, ${summary.modified} modified cues, ${formatBytes(summary.bytes)}`;
  const query = $('search').value.trim().toLowerCase();
  const category = $('category').value;
  const routing = $('routing').value;
  state.filtered = state.catalog.clips.filter((clip) => {
    if (category !== 'all' && clip.category !== category) return false;
    if (query && !`${clip.key} ${clip.prompt}`.toLowerCase().includes(query)) return false;
    if (routing === 'routed' && !clip.integration.routed) return false;
    if (routing === 'unrouted' && clip.integration.routed) return false;
    if (routing === 'modified' && !clip.modified) return false;
    if (routing === 'clipping' && !(clip.analysis.levels?.truePeakDb > -1)) return false;
    return true;
  });
  const list = $('cue-list');
  list.replaceChildren();
  for (const clip of state.filtered) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cue';
    button.role = 'option';
    button.ariaSelected = String(clip.key === state.selected?.key);
    button.disabled = state.uploading;
    button.addEventListener('click', () => void selectClip(clip.key));

    const key = document.createElement('span');
    key.className = 'cue-key';
    key.textContent = clip.key;
    const level = document.createElement('span');
    level.className = `cue-level ${clip.analysis.levels?.truePeakDb > -1 ? 'hot' : ''}`;
    level.textContent = Number.isFinite(clip.analysis.levels?.integratedLufs)
      ? `${clip.analysis.levels.integratedLufs.toFixed(1)} LUFS`
      : 'not analyzed';
    const meta = document.createElement('span');
    meta.className = 'cue-meta';
    const trackLabel = clip.tracks?.length > 1 ? `  ${clip.tracks.length} takes` : '';
    meta.textContent = `${clip.category}  ${clip.analysis.info?.duration?.toFixed(2) ?? '?'}s  ${clip.loop ? 'loop' : 'one-shot'}${trackLabel}`;
    const flags = document.createElement('span');
    flags.className = 'cue-flags';
    const routeFlag = document.createElement('span');
    routeFlag.className = `flag ${clip.integration.routed ? '' : 'warn'}`;
    routeFlag.title = clip.integration.routed ? 'routed in game' : clip.integration.note;
    flags.append(routeFlag);
    if (clip.modified) {
      const modified = document.createElement('span');
      modified.className = 'flag mod';
      modified.title = 'modified audio recipe or playback profile';
      flags.append(modified);
    }
    button.append(key, level, meta, flags);
    list.append(button);
  }
}

async function decodeUrl(url) {
  const context = await ensureAudioContext();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`audio fetch failed (${response.status})`);
  return context.decodeAudioData(await response.arrayBuffer());
}

async function ensureAudioContext() {
  if (!state.audioContext) state.audioContext = new AudioContext();
  await state.audioContext.resume();
  return state.audioContext;
}

async function selectClip(key) {
  if (state.uploading) return;
  const sequence = ++state.loadSequence;
  clearTimeout(state.autosaveTimer);
  if (state.dirty) {
    const saved = await saveDraft(true);
    if (sequence !== state.loadSequence) return;
    if (!saved || state.dirty) {
      setStatus('Current edits could not be saved yet. The cue was not changed.', 'error');
      return;
    }
  }
  stopPlayback();
  setStatus(`Loading ${key}...`);
  const clip = state.catalog.clips.find((item) => item.key === key);
  if (!clip) return;
  state.selected = clip;
  state.playback = null;
  state.exactBuffer = null;
  state.exactWaveformEnvelope = null;
  state.exactUrl = null;
  state.exactResult = null;
  state.audition = 'source';
  state.selection = null;
  state.playhead = 0;
  state.viewStart = 0;
  renderCatalog();
  try {
    const response = await api(`/api/project?key=${encodeURIComponent(key)}`);
    const buffer = await decodeUrl(response.source.url);
    if (sequence !== state.loadSequence) return;
    state.projectResponse = response;
    state.project = response.project;
    state.playback = response.playback;
    state.playbackProfileHash = response.playbackProfileHash;
    state.playbackWorkspaceHash = response.playbackWorkspaceHash;
    state.audioWorkspaceHash = response.audioWorkspaceHash;
    state.playbackProfileDirty = !!response.playbackProfileDirty;
    state.projectRevision = 0;
    state.playbackRevision = 0;
    state.buffer = buffer;
    state.waveformEnvelope = buildWaveformEnvelope(buffer);
    state.waveformCache = null;
    state.history = [
      { project: clone(response.project), playback: playbackAuthoring(response.playback) },
    ];
    state.historyIndex = 0;
    $('loop-playback').checked = !!response.project.loop?.enabled;
    setDirty(false);
    syncControls();
    updateHistoryButtons();
    updateAuditionButton();
    renderSelectedMetadata();
    openContext();
    setStatus(`${key} ready`, 'ok');
  } catch (error) {
    setStatus(String(error.message ?? error), 'error');
  }
}

function addDetail(dl, label, value) {
  const dt = document.createElement('dt');
  const dd = document.createElement('dd');
  dt.textContent = label;
  dd.textContent = value;
  dl.append(dt, dd);
}

function renderSelectedMetadata() {
  const clip = state.selected;
  const response = state.projectResponse;
  if (!clip || !response) return;
  $('cue-title').textContent = clip.key;
  $('cue-path').textContent = `public/audio/sfx/${clip.key}.mp3`;
  $('prompt').textContent = clip.prompt;
  $('association').textContent = clip.integration.note
    ? `${clip.integration.route}. ${clip.integration.note}`
    : clip.integration.route;
  const badge = $('route-badge');
  badge.textContent = clip.integration.routed ? 'routed' : 'unrouted';
  badge.className = `badge ${clip.integration.routed ? 'good' : 'warn'}`;
  const exact = state.audition === 'rendered' ? state.exactResult : null;
  const info = exact?.info ?? response.source.info ?? clip.analysis.info;
  const levels = exact?.loudness ?? response.source.loudness ?? clip.analysis.levels;
  const dl = $('inspection');
  dl.replaceChildren();
  addDetail(dl, 'audition asset', exact ? 'exact rendered master' : 'working source');
  addDetail(dl, 'format', `${info.codec}, ${info.channels} ch, ${info.sampleRate} Hz`);
  addDetail(dl, 'duration', `${Number(info.duration).toFixed(3)} s`);
  addDetail(dl, 'size', formatBytes(info.bytes));
  addDetail(dl, 'loudness', formatLevel(levels.integratedLufs, 'LUFS'));
  addDetail(dl, 'true peak', formatLevel(levels.truePeakDb, 'dBTP'));
  addDetail(dl, 'runtime', `${clip.preload} preload, ${clip.spatial ? 'spatial' : 'global'}`);
  addDetail(
    dl,
    'published tracks',
    (clip.tracks ?? []).map((track) => track.id).join(', ') || 'main',
  );
  if (state.playback) {
    addDetail(
      dl,
      'game gain',
      `${state.playback.categoryBaselineDb.toFixed(1)} dB ${state.playback.category} baseline + ${state.playback.keyTrimDb.toFixed(1)} dB key = ${state.playback.resolvedGainDb.toFixed(1)} dB`,
    );
    addDetail(dl, 'game speed', `${state.playback.playbackRate.toFixed(2)}x, pitch coupled`);
  }
  addDetail(dl, 'published hash', response.publishedHash.slice(0, 16));
  renderVersions();
}

function renderVersions() {
  const container = $('versions');
  container.replaceChildren();
  const versions = state.projectResponse?.versions ?? [];
  if (!versions.length) {
    container.textContent = 'No previous published versions in this workspace.';
    return;
  }
  for (const version of versions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = state.uploading;
    button.textContent = `${version.hash.slice(0, 8)}  ${formatBytes(version.bytes)}`;
    button.title = 'Restore this published version';
    button.addEventListener('click', () => void restore(version.hash));
    container.append(button);
  }
}

function showUiContext(association) {
  window.LiveViewer?.close();
  const canvas = $('context-canvas');
  const empty = $('context-empty');
  canvas.style.display = 'none';
  empty.style.display = 'grid';
  empty.replaceChildren();
  const mock = document.createElement('div');
  mock.className = 'ui-context-mock';
  const chrome = document.createElement('div');
  chrome.className = 'ui-context-chrome';
  chrome.textContent = 'LIVE UI EVENT CONTEXT';
  const panel = document.createElement('div');
  panel.className = 'ui-context-panel';
  const screen = document.createElement('strong');
  screen.textContent = association.screen;
  const event = document.createElement('span');
  event.textContent = state.selected.key.slice('ui_'.length).replaceAll('_', ' ');
  const pulse = document.createElement('i');
  pulse.setAttribute('aria-hidden', 'true');
  panel.append(screen, event, pulse);
  const caption = document.createElement('p');
  caption.textContent = association.label;
  mock.append(chrome, panel, caption);
  empty.append(mock);
  $('context-clip').parentElement.style.display = 'none';
  $('context-label').textContent = association.label;
  $('context-status').textContent = 'non-positional interface context';
}

function openContext() {
  const association = state.selected?.associations?.[0];
  const canvas = $('context-canvas');
  const empty = $('context-empty');
  if (association?.kind === 'ui') {
    showUiContext(association);
    return;
  }
  canvas.style.display = '';
  empty.replaceChildren('No visual context');
  $('context-clip').parentElement.style.display = '';
  if (!association || !window.LiveViewer) {
    window.LiveViewer?.close();
    empty.style.display = 'grid';
    return;
  }
  empty.style.display = 'none';
  $('context-label').textContent = association.label;
  window.LiveViewer.open(
    {
      kind: 'model',
      category: association.kind === 'environment' ? 'props' : 'sfx context',
      name: state.selected.key,
      repoGlb: association.model,
      registration: {},
    },
    {
      canvas: $('context-canvas'),
      clipSelect: $('context-clip'),
      statusEl: $('context-status'),
      preferredClip: association.clip,
      stage: association.stage,
    },
  );
}

function getView() {
  const duration = displayDuration();
  const visible = duration / Math.max(1, state.zoom);
  const start = Math.min(Math.max(0, state.viewStart), Math.max(0, duration - visible));
  return { start, end: Math.min(duration, start + visible), duration: visible };
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(2, devicePixelRatio || 1);
  const width = Math.max(2, Math.round(rect.width * ratio));
  const height = Math.max(2, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, ratio };
}

function buildWaveformEnvelope(buffer) {
  const blockSize = 64;
  const channels = [];
  for (let channel = 0; channel < Math.min(2, buffer.numberOfChannels); channel++) {
    const samples = buffer.getChannelData(channel);
    const base = new Float32Array(Math.ceil(samples.length / blockSize));
    for (let index = 0; index < samples.length; index++) {
      const bin = Math.floor(index / blockSize);
      base[bin] = Math.max(base[bin], Math.abs(samples[index]));
    }
    const levels = [base];
    while (levels.at(-1).length > 1) {
      const previous = levels.at(-1);
      const next = new Float32Array(Math.ceil(previous.length / 2));
      for (let index = 0; index < previous.length; index += 2) {
        next[index / 2] = Math.max(previous[index], previous[index + 1] ?? 0);
      }
      levels.push(next);
    }
    channels.push(levels);
  }
  return { blockSize, channels };
}

function envelopePeak(channel, start, end) {
  const envelope = displayEnvelope();
  const buffer = displayBuffer();
  if (!envelope || !buffer) return 0;
  const samples = Math.max(1, (end - start) * buffer.sampleRate);
  const levelIndex = Math.max(
    0,
    Math.min(
      envelope.channels[channel].length - 1,
      Math.floor(Math.log2(samples / envelope.blockSize)),
    ),
  );
  const level = envelope.channels[channel][levelIndex];
  const blockSamples = envelope.blockSize * 2 ** levelIndex;
  const from = Math.max(0, Math.floor((start * buffer.sampleRate) / blockSamples));
  const to = Math.min(
    level.length,
    Math.max(from + 1, Math.ceil((end * buffer.sampleRate) / blockSamples)),
  );
  let peak = 0;
  for (let index = from; index < to; index++) peak = Math.max(peak, level[index]);
  return peak;
}

function waveformBase(width, height, view) {
  const key = `${state.loadSequence}:${state.audition}:${state.exactUrl ?? ''}:${width}:${height}:${view.start.toFixed(6)}:${view.duration.toFixed(6)}`;
  if (state.waveformCache?.key === key) return state.waveformCache.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#0b1017';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#24313d';
  context.lineWidth = 1;
  for (let index = 0; index <= 10; index++) {
    const x = (index / 10) * width;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  const channels = Math.min(2, displayBuffer().numberOfChannels);
  const laneHeight = height / channels;
  for (let channel = 0; channel < channels; channel++) {
    const mid = laneHeight * (channel + 0.5);
    context.strokeStyle = channel === 0 ? '#42c2b3' : '#63a8e8';
    context.beginPath();
    for (let x = 0; x < width; x++) {
      const start = view.start + (x / width) * view.duration;
      const end = view.start + ((x + 1) / width) * view.duration;
      const y = envelopePeak(channel, start, end) * laneHeight * 0.43;
      context.moveTo(x, mid - y);
      context.lineTo(x, mid + y);
    }
    context.stroke();
    context.strokeStyle = '#344351';
    context.beginPath();
    context.moveTo(0, mid);
    context.lineTo(width, mid);
    context.stroke();
  }
  state.waveformCache = { key, canvas };
  return canvas;
}

function drawWaveform() {
  const canvas = $('waveform');
  const context = canvas.getContext('2d');
  const { width, height } = resizeCanvas(canvas);
  context.clearRect(0, 0, width, height);
  if (!state.buffer) return;
  const view = getView();
  context.drawImage(waveformBase(width, height, view), 0, 0);

  const timeToX = (time) => ((time - view.start) / view.duration) * width;
  const exactTimeline = state.audition === 'rendered' && !!state.exactBuffer;
  const segments =
    exactTimeline || state.project?.loop?.enabled ? [] : (state.project?.segments ?? []);
  if (segments.length) {
    context.fillStyle = 'rgba(229, 166, 78, 0.14)';
    for (const segment of segments) {
      const left = timeToX(segment.start);
      const right = timeToX(segment.end);
      context.fillRect(left, 0, right - left, height);
    }
  }
  if (!exactTimeline && state.project?.loop?.enabled) {
    const plan = effectiveLoopPlan();
    const loop = state.project.loop;
    const left = timeToX(plan?.start ?? loop.start);
    const right = timeToX(plan?.end ?? loop.end);
    const fadeWidth = plan ? Math.max(0, timeToX(plan.start + plan.sourceCrossfade) - left) : 0;
    context.fillStyle = 'rgba(66, 194, 179, 0.13)';
    context.fillRect(left, 0, right - left, height);
    context.fillStyle = 'rgba(214, 182, 95, 0.2)';
    context.fillRect(left, 0, fadeWidth, height);
    context.fillRect(Math.max(left, right - fadeWidth), 0, fadeWidth, height);
    context.strokeStyle = '#42c2b3';
    context.lineWidth = 2;
    for (const x of [left, right]) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
  }
  if (!exactTimeline && state.selection) {
    context.fillStyle = 'rgba(99, 168, 232, 0.22)';
    const left = timeToX(Math.min(state.selection.start, state.selection.end));
    const right = timeToX(Math.max(state.selection.start, state.selection.end));
    context.fillRect(left, 0, right - left, height);
  }
  const playX = timeToX(waveformPlayheadTime());
  if (playX >= 0 && playX <= width) {
    context.strokeStyle = '#f3d77d';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(playX, 0);
    context.lineTo(playX, height);
    context.stroke();
  }
  updateTimelineLabels();
}

function updateTimelineLabels() {
  const exactTimeline = state.audition === 'rendered' && !!state.exactBuffer;
  const duration =
    state.audition === 'rendered'
      ? displayDuration() / authoredPlaybackRate()
      : state.audition === 'live'
        ? projectDuration()
        : currentDuration();
  $('timecode').textContent = `${formatTime(state.playhead)} / ${formatTime(duration)}`;
  $('timeline-mode').textContent =
    state.audition === 'rendered'
      ? 'C exact master with runtime playback'
      : state.audition === 'live'
        ? 'source edit timeline, B playhead mapped'
        : 'source edit timeline';
  if (exactTimeline) {
    $('selection-label').textContent = 'Exact output is read-only. Cycle to A or B to edit source.';
  } else if (state.selection) {
    const start = Math.min(state.selection.start, state.selection.end);
    const end = Math.max(state.selection.start, state.selection.end);
    $('selection-label').textContent =
      `${formatTime(start)} to ${formatTime(end)}  (${(end - start).toFixed(3)} s)`;
  } else {
    $('selection-label').textContent = 'Drag waveform to select a region';
  }
  const loop = state.project?.loop;
  const plan = effectiveLoopPlan();
  $('loop-region-label').textContent = loop?.enabled
    ? `Loop ${formatTime(plan?.start ?? loop.start)} to ${formatTime(plan?.end ?? loop.end)}, ${Math.round(Number(loop.crossfadeMs) || 0)} ms master seam, ${Math.round((plan?.crossfade ?? 0) * 1000)} ms in game`
    : 'Loop off';
  const hasSelection = !!selectedRange();
  const catalogLoop = !!state.selected?.loop;
  $('set-loop').disabled = state.uploading || exactTimeline || !hasSelection || !catalogLoop;
  $('keep-selection').disabled = state.uploading || exactTimeline || !hasSelection || catalogLoop;
  $('remove-selection').disabled = state.uploading || exactTimeline || !hasSelection || catalogLoop;
  $('clear-slices').disabled = state.uploading || exactTimeline || catalogLoop;
  $('snap-zero').disabled = state.uploading || exactTimeline || !hasSelection;
}

function canvasTime(event) {
  const rect = $('waveform').getBoundingClientRect();
  const view = getView();
  const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  return view.start + fraction * view.duration;
}

function nearestZero(time) {
  if (!state.buffer) return time;
  const data = state.buffer.getChannelData(0);
  const center = Math.round(time * state.buffer.sampleRate);
  const radius = Math.round(state.buffer.sampleRate * 0.015);
  let best = Math.min(data.length - 1, Math.max(0, center));
  let value = Math.abs(data[best]);
  for (
    let index = Math.max(1, center - radius);
    index < Math.min(data.length - 1, center + radius);
    index++
  ) {
    const score = Math.abs(data[index]) + Math.abs(data[index - 1]) * 0.25;
    if (score < value) {
      value = score;
      best = index;
    }
  }
  return best / state.buffer.sampleRate;
}

function selectedRange() {
  if (!state.selection) return null;
  const start = Math.min(state.selection.start, state.selection.end);
  const end = Math.max(state.selection.start, state.selection.end);
  return end - start >= 0.001 ? { start, end } : null;
}

function buildGraph(context, { processed, applyPlayback }) {
  const input = context.createGain();
  let node = input;
  if (processed) {
    for (const [type, frequency, gain, q] of [
      ['highpass', state.project.eq.highpassHz, 0, Math.SQRT1_2],
      ['lowshelf', state.project.eq.lowFreqHz, state.project.eq.lowGainDb, Math.SQRT1_2],
      ['peaking', state.project.eq.midFreqHz, state.project.eq.midGainDb, state.project.eq.midQ],
      ['peaking', state.project.eq.mid2FreqHz, state.project.eq.mid2GainDb, state.project.eq.mid2Q],
      ['peaking', state.project.eq.mid3FreqHz, state.project.eq.mid3GainDb, state.project.eq.mid3Q],
      ['highshelf', state.project.eq.highFreqHz, state.project.eq.highGainDb, Math.SQRT1_2],
      ['lowpass', state.project.eq.lowpassHz, 0, Math.SQRT1_2],
    ]) {
      const filter = context.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.gain.value = gain;
      filter.Q.value = q;
      node.connect(filter);
      node = filter;
    }
    if (state.project.compressor.enabled) {
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = state.project.compressor.thresholdDb;
      compressor.ratio.value = state.project.compressor.ratio;
      compressor.attack.value = state.project.compressor.attackMs / 1000;
      compressor.release.value = state.project.compressor.releaseMs / 1000;
      compressor.knee.value = Math.min(40, state.project.compressor.knee * 5);
      node.connect(compressor);
      node = compressor;
    }
  }
  const gain = context.createGain();
  const playbackGain = Number(state.playback?.gain);
  gain.gain.value = applyPlayback && Number.isFinite(playbackGain) ? playbackGain : 1;
  node.connect(gain);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  gain.connect(analyser);
  analyser.connect(context.destination);
  return { input, gain, analyser };
}

function scheduleSegments(context, graph, buffer, processed, startOutput) {
  const timeline = processed
    ? segmentTimeline()
    : {
        entries: [
          {
            start: 0,
            end: buffer.duration,
            outputStart: 0,
            outputEnd: buffer.duration,
            outputLength: buffer.duration,
            fadeIn: 0,
            fadeOut: 0,
          },
        ],
        speed: 1,
        duration: buffer.duration,
      };
  const sources = [];
  const now = context.currentTime + 0.025;
  for (const entry of timeline.entries) {
    if (entry.outputEnd <= startOutput) continue;
    const skipOutput = Math.max(0, startOutput - entry.outputStart);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = timeline.speed;
    const sourceOffset = entry.start + skipOutput * timeline.speed;
    const sourceDuration = Math.max(0, entry.end - sourceOffset);
    const startAt = now + Math.max(0, entry.outputStart - startOutput);
    if (entry.fadeIn > 0 || entry.fadeOut > 0) {
      const gain = context.createGain();
      const localStart = skipOutput;
      const fadeOutStart = entry.outputLength - entry.fadeOut;
      const gainAtStart = Math.min(
        entry.fadeIn > 0 ? Math.min(1, localStart / entry.fadeIn) : 1,
        entry.fadeOut > 0 && localStart > fadeOutStart
          ? Math.max(0, (entry.outputLength - localStart) / entry.fadeOut)
          : 1,
      );
      gain.gain.setValueAtTime(gainAtStart, startAt);
      if (entry.fadeIn > 0 && localStart < entry.fadeIn) {
        gain.gain.linearRampToValueAtTime(1, startAt + entry.fadeIn - localStart);
      }
      if (entry.fadeOut > 0 && localStart < fadeOutStart) {
        gain.gain.setValueAtTime(1, startAt + fadeOutStart - localStart);
      }
      if (entry.fadeOut > 0 && localStart < entry.outputLength) {
        gain.gain.linearRampToValueAtTime(0, startAt + entry.outputLength - localStart);
      }
      source.connect(gain).connect(graph.input);
    } else {
      source.connect(graph.input);
    }
    source.start(startAt, sourceOffset, sourceDuration);
    sources.push(source);
  }
  return { sources, startAt: now, totalDuration: timeline.duration };
}

function equalPowerCurve(direction, startFraction) {
  const curve = new Float32Array(128);
  for (let index = 0; index < curve.length; index++) {
    const position = startFraction + (index / (curve.length - 1)) * (1 - startFraction);
    curve[index] =
      direction === 'in' ? Math.sin((position * Math.PI) / 2) : Math.cos((position * Math.PI) / 2);
  }
  return curve;
}

function scheduleLoopPart({
  context,
  graph,
  buffer,
  sources,
  startAt,
  startOutput,
  outputStart,
  outputDuration,
  sourceStart,
  speed,
  fade,
}) {
  const outputEnd = outputStart + outputDuration;
  if (outputDuration <= 0 || outputEnd <= startOutput) return;
  const skipped = Math.max(0, startOutput - outputStart);
  const remaining = outputDuration - skipped;
  if (remaining <= 0) return;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = speed;
  const offset = sourceStart + skipped * speed;
  const duration = Math.min(remaining * speed, Math.max(0, buffer.duration - offset));
  if (duration <= 0) return;
  if (fade) {
    const gain = context.createGain();
    const curveStart = outputDuration > 0 ? skipped / outputDuration : 0;
    const when = startAt + Math.max(0, outputStart - startOutput);
    gain.gain.setValueCurveAtTime(equalPowerCurve(fade, curveStart), when, remaining);
    source.connect(gain).connect(graph.input);
  } else {
    source.connect(graph.input);
  }
  source.start(startAt + Math.max(0, outputStart - startOutput), offset, duration);
  sources.push(source);
}

function scheduleLoop(context, graph, buffer, startOutput, startAt = context.currentTime + 0.025) {
  const plan = effectiveLoopPlan();
  if (!plan) return scheduleSegments(context, graph, buffer, true, startOutput);
  const sources = [];
  if (plan.crossfade === 0) {
    scheduleLoopPart({
      context,
      graph,
      buffer,
      sources,
      startAt,
      startOutput,
      outputStart: 0,
      outputDuration: plan.processedDuration,
      sourceStart: plan.start,
      speed: plan.speed,
    });
  } else {
    scheduleLoopPart({
      context,
      graph,
      buffer,
      sources,
      startAt,
      startOutput,
      outputStart: 0,
      outputDuration: plan.crossfade,
      sourceStart: plan.end - plan.sourceCrossfade,
      speed: plan.speed,
      fade: 'out',
    });
    scheduleLoopPart({
      context,
      graph,
      buffer,
      sources,
      startAt,
      startOutput,
      outputStart: 0,
      outputDuration: plan.crossfade,
      sourceStart: plan.start,
      speed: plan.speed,
      fade: 'in',
    });
    scheduleLoopPart({
      context,
      graph,
      buffer,
      sources,
      startAt,
      startOutput,
      outputStart: plan.crossfade,
      outputDuration: plan.processedDuration - plan.crossfade * 2,
      sourceStart: plan.start + plan.sourceCrossfade,
      speed: plan.speed,
    });
  }
  return { sources, startAt, totalDuration: plan.outputDuration };
}

async function play() {
  if (!state.buffer || !state.project) return;
  stopPlayback(false);
  const context = await ensureAudioContext();
  const processed = state.audition === 'live';
  const exact = state.audition === 'rendered' && state.exactBuffer;
  const buffer = exact ? state.exactBuffer : state.buffer;
  const graph = buildGraph(context, { processed, applyPlayback: processed || !!exact });
  const rate = processed || exact ? authoredPlaybackRate() : 1;
  const startOutput = Math.min(
    state.playhead,
    exact ? buffer.duration / rate : processed ? projectDuration() : buffer.duration,
  );
  let schedule;
  if (exact || !processed) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.loop = $('loop-playback').checked;
    source.connect(graph.input);
    const startAt = context.currentTime + 0.025;
    source.start(startAt, startOutput * rate);
    schedule = {
      sources: [source],
      startAt,
      totalDuration: buffer.duration / rate,
      looping: source.loop,
    };
  } else if (processed && state.project.loop?.enabled) {
    schedule = scheduleLoop(context, graph, buffer, startOutput);
    if ($('loop-playback').checked) {
      schedule.looping = true;
      schedule.loopScheduler = {
        context,
        graph,
        buffer,
        nextCycleAt: schedule.startAt + schedule.totalDuration - startOutput,
      };
    }
  } else {
    schedule = scheduleSegments(context, graph, buffer, processed, startOutput);
  }
  state.playing = {
    ...schedule,
    analyser: graph.analyser,
    startOutput,
    mode: state.audition,
    samples: new Float32Array(graph.analyser.fftSize),
  };
  for (const source of schedule.sources) trackPlayingSource(state.playing, source);
  tickPlayback();
}

function trackPlayingSource(playing, source) {
  source.onended = () => {
    if (state.playing !== playing) return;
    const index = playing.sources.indexOf(source);
    if (index >= 0) playing.sources.splice(index, 1);
  };
}

function stopPlayback(reset = true) {
  if (state.playing) {
    for (const source of state.playing.sources) {
      try {
        source.stop();
      } catch {
        // Source already ended.
      }
    }
    cancelAnimationFrame(state.playing.raf);
    state.playing = null;
  }
  if (reset) state.playhead = 0;
  window.LiveViewer?.seek(Math.max(0, state.project?.syncOffsetMs / 1000 || 0));
  drawWaveform();
  drawMeter(-Infinity, -Infinity);
}

function tickPlayback() {
  const playing = state.playing;
  if (!playing || !state.audioContext) return;
  const scheduler = playing.loopScheduler;
  if (scheduler) {
    for (
      let cycle = 0;
      cycle < 64 && scheduler.nextCycleAt < state.audioContext.currentTime + 0.15;
      cycle++
    ) {
      const next = scheduleLoop(
        scheduler.context,
        scheduler.graph,
        scheduler.buffer,
        0,
        scheduler.nextCycleAt,
      );
      for (const source of next.sources) {
        playing.sources.push(source);
        trackPlayingSource(playing, source);
      }
      scheduler.nextCycleAt += next.totalDuration;
    }
  }
  const elapsed = Math.max(0, state.audioContext.currentTime - playing.startAt);
  const end = playing.totalDuration;
  state.playhead = playing.looping
    ? (playing.startOutput + elapsed) % end
    : playing.startOutput + elapsed;
  if (state.playhead >= end) {
    const shouldLoop = $('loop-playback').checked;
    stopPlayback();
    if (shouldLoop) void play();
    return;
  }
  playing.analyser.getFloatTimeDomainData(playing.samples);
  let peak = 0;
  let sum = 0;
  for (const value of playing.samples) {
    peak = Math.max(peak, Math.abs(value));
    sum += value * value;
  }
  const rms = Math.sqrt(sum / playing.samples.length);
  drawMeter(db(peak), db(rms));
  const sync = (state.project?.syncOffsetMs ?? 0) / 1000;
  window.LiveViewer?.seek(Math.max(0, state.playhead + sync));
  drawWaveform();
  playing.raf = requestAnimationFrame(tickPlayback);
}

function drawMeter(peakDb, rmsDb) {
  const canvas = $('meter');
  const context = canvas.getContext('2d');
  const { width, height } = resizeCanvas(canvas);
  context.clearRect(0, 0, width, height);
  const gradient = context.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, '#2b9b75');
  gradient.addColorStop(0.72, '#d2af43');
  gradient.addColorStop(0.92, '#e7685f');
  const fraction = Number.isFinite(peakDb) ? Math.max(0, Math.min(1, (peakDb + 60) / 60)) : 0;
  context.fillStyle = gradient;
  context.fillRect(0, 0, width * fraction, height);
  $('meter-readout').textContent =
    `peak ${Number.isFinite(peakDb) ? peakDb.toFixed(1) : '-inf'} dBFS, rms ${Number.isFinite(rmsDb) ? rmsDb.toFixed(1) : '-inf'} dBFS`;
}

function updateAuditionButton() {
  const labels = {
    source: 'A: source',
    live: 'B: live + playback mix',
    rendered: 'C: exact + playback mix',
  };
  $('ab').textContent = labels[state.audition];
  $('ab').title =
    state.audition === 'live'
      ? 'Fast Web Audio approximation. C is authoritative for offline-only DSP and encoding.'
      : '';
}

function liveAuditionStatus() {
  const plan = effectiveLoopPlan();
  const seam = plan
    ? plan.crossfade > 0
      ? ` Rotated tail/head seam uses D = ${Math.round(plan.crossfade * 1000)} ms equal-power crossfade before the middle.`
      : ' The loop region has no seam crossfade.'
    : '';
  return `B is an approximate Web Audio preview followed by ${state.playback?.resolvedGainDb.toFixed(1) ?? '0.0'} dB and ${authoredPlaybackRate().toFixed(2)}x runtime playback.${seam} Render C for authoritative reverse, loudness, limiting, and codec output.`;
}

function cycleAudition() {
  stopPlayback();
  const modes = state.exactBuffer ? ['source', 'live', 'rendered'] : ['source', 'live'];
  const index = modes.indexOf(state.audition);
  state.audition = modes[(index + 1) % modes.length];
  state.viewStart = 0;
  state.waveformCache = null;
  updateAuditionButton();
  renderSelectedMetadata();
  drawWaveform();
  setStatus(
    state.audition === 'rendered'
      ? 'Exact server render selected'
      : state.audition === 'live'
        ? liveAuditionStatus()
        : 'Immutable source selected',
  );
}

function drawEqCurve() {
  const canvas = $('eq-curve');
  const context = canvas.getContext('2d');
  const { width, height } = resizeCanvas(canvas);
  context.clearRect(0, 0, width, height);
  context.strokeStyle = '#26333f';
  context.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = (i / 4) * height;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  if (!state.project) return;
  const eq = state.project.eq;
  const xFor = (frequency) => (Math.log10(frequency / 20) / Math.log10(20000 / 20)) * width;
  context.strokeStyle = '#42c2b3';
  context.lineWidth = 2;
  context.beginPath();
  for (let x = 0; x < width; x++) {
    const frequency = 20 * 10 ** ((x / width) * Math.log10(1000));
    const shelfLow = eq.lowGainDb / (1 + (frequency / eq.lowFreqHz) ** 4);
    const shelfHigh = eq.highGainDb / (1 + (eq.highFreqHz / frequency) ** 4);
    const bell = (center, q, gainDb) => {
      const octaves = Math.log2(frequency / center);
      return gainDb * Math.exp(-(octaves * octaves) * q);
    };
    const mids =
      bell(eq.midFreqHz, eq.midQ, eq.midGainDb) +
      bell(eq.mid2FreqHz, eq.mid2Q, eq.mid2GainDb) +
      bell(eq.mid3FreqHz, eq.mid3Q, eq.mid3GainDb);
    let gain = shelfLow + shelfHigh + mids;
    if (frequency < eq.highpassHz) gain -= Math.min(30, 12 * Math.log2(eq.highpassHz / frequency));
    if (frequency > eq.lowpassHz) gain -= Math.min(30, 12 * Math.log2(frequency / eq.lowpassHz));
    const y = height / 2 - (gain / 30) * (height / 2);
    if (x === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.fillStyle = '#768595';
  context.font = `${Math.max(9, height * 0.12)}px ui-monospace`;
  for (const frequency of [20, 100, 1000, 10000, 20000]) {
    context.fillText(
      frequency >= 1000 ? `${frequency / 1000}k` : String(frequency),
      xFor(frequency) + 3,
      height - 5,
    );
  }
}

function saveDraft(silent = false) {
  if (state.uploading) return Promise.resolve(false);
  if (!state.selected || !state.project) return Promise.resolve(true);
  const key = state.selected.key;
  const project = clone(state.project);
  const playback = playbackAuthoring(state.playback);
  const snapshot = JSON.stringify({ project, playback });
  const action = async () => {
    try {
      const result = await api('/api/project', {
        method: 'POST',
        body: {
          key,
          project,
          playback,
          expectedPlaybackWorkspaceHash: state.playbackWorkspaceHash,
          expectedAudioWorkspaceHash: state.audioWorkspaceHash,
        },
      });
      if (state.selected?.key === key) {
        state.playbackProfileHash = result.playbackProfileHash;
        state.playbackWorkspaceHash = result.playbackWorkspaceHash;
        state.audioWorkspaceHash = result.audioWorkspaceHash;
      }
      const currentPlayback = playbackAuthoring(state.playback);
      if (
        state.selected?.key === key &&
        JSON.stringify({ project: state.project, playback: currentPlayback }) === snapshot
      ) {
        state.project = result.project;
        state.playback = result.playback;
        state.playbackProfileHash = result.playbackProfileHash;
        state.playbackProfileDirty = !!result.playbackProfileDirty;
        setDirty(false);
        syncControls();
      }
      if (!silent && state.selected?.key === key) {
        setStatus('Draft saved in tmp/sfx_studio', 'ok');
      }
      return true;
    } catch (error) {
      if (state.selected?.key === key) setStatus(String(error.message ?? error), 'error');
      return false;
    }
  };
  const pending = state.saveTail.catch(() => {}).then(action);
  state.saveTail = pending;
  return pending;
}

async function resetAudioDraft() {
  if (!state.selected) return;
  const key = state.selected.key;
  if (
    !window.confirm(
      `Discard unpublished audio edits for ${key} and return to its current published master? Runtime gain and speed edits are kept.`,
    )
  ) {
    return;
  }
  const sequence = state.loadSequence;
  clearTimeout(state.autosaveTimer);
  await state.saveTail.catch(() => {});
  if (sequence !== state.loadSequence || state.selected?.key !== key) return;
  stopPlayback();
  setUploadBusy(true);
  setStatus(`Resetting ${key} to its published audio master...`);
  try {
    await api('/api/reset-project', {
      method: 'POST',
      body: { key, expectedAudioWorkspaceHash: state.audioWorkspaceHash },
    });
    if (sequence !== state.loadSequence || state.selected?.key !== key) return;
    await reloadCatalog(key);
    setStatus(`Reset unpublished audio edits for ${key}. Runtime mix edits were kept.`, 'ok');
  } catch (error) {
    if (sequence === state.loadSequence && state.selected?.key === key) {
      setStatus(String(error.message ?? error), 'error');
    }
  } finally {
    if (state.uploading) setUploadBusy(false);
  }
}

async function renderExact() {
  if (!state.selected || !state.project) return;
  const key = state.selected.key;
  const sequence = state.loadSequence;
  clearTimeout(state.autosaveTimer);
  const saved = await saveDraft(true);
  await state.saveTail.catch(() => {});
  if (!saved || sequence !== state.loadSequence || state.selected?.key !== key || !state.project) {
    return;
  }
  const revision = state.projectRevision;
  const playbackRevision = state.playbackRevision;
  const project = clone(state.project);
  const snapshot = JSON.stringify(project);
  stopPlayback();
  setStatus('Rendering exact FFmpeg preview...');
  $('render').disabled = true;
  try {
    const result = await api('/api/render', {
      method: 'POST',
      body: { key, project, expectedAudioWorkspaceHash: state.audioWorkspaceHash },
    });
    const exactBuffer = await decodeUrl(result.url);
    if (sequence !== state.loadSequence || state.selected?.key !== key) return;
    if (revision !== state.projectRevision || JSON.stringify(state.project) !== snapshot) {
      await saveDraft(true);
      setStatus('Exact render finished for an older edit. Render again for the current project.');
      return;
    }
    state.project = result.project;
    state.audioWorkspaceHash = result.audioWorkspaceHash;
    state.exactUrl = result.url;
    state.exactBuffer = exactBuffer;
    state.exactWaveformEnvelope = buildWaveformEnvelope(exactBuffer);
    state.waveformCache = null;
    state.exactResult = result;
    state.audition = 'rendered';
    setDirty(playbackRevision !== state.playbackRevision);
    syncControls();
    updateAuditionButton();
    renderSelectedMetadata();
    const masteringMode =
      result.mastering?.mode === 'production-conform'
        ? `${result.mastering.conform?.normBranch ?? 'fixed'} production conform`
        : result.mastering?.mode === 'linear'
          ? 'linear two-pass'
          : result.mastering?.mode === 'direct'
            ? 'direct master'
            : 'verified master';
    const seam = result.loopContinuity
      ? `, seam ${result.loopContinuity.maxDelta.toFixed(4)} / ${result.loopContinuity.maxRatio.toFixed(1)}x verified`
      : '';
    setStatus(
      `Exact preview: ${formatLevel(result.loudness.integratedLufs, 'LUFS')}, ${formatLevel(result.loudness.truePeakDb, 'dBTP')} (${masteringMode}${seam})`,
      'ok',
    );
  } catch (error) {
    if (sequence === state.loadSequence && state.selected?.key === key) {
      setStatus(String(error.message ?? error), 'error');
    }
  } finally {
    $('render').disabled = false;
  }
}

async function publish() {
  if (!state.selected || !state.project) return;
  const key = state.selected.key;
  const confirmed = window.confirm(
    `Publish audio for ${key}? This transactionally replaces only the mastered game MP3 and its audio recipe. Playback gain and speed remain in their separate maps.`,
  );
  if (!confirmed) return;
  const sequence = state.loadSequence;
  clearTimeout(state.autosaveTimer);
  const saved = await saveDraft(true);
  await state.saveTail.catch(() => {});
  if (!saved || sequence !== state.loadSequence || state.selected?.key !== key || !state.project) {
    return;
  }
  const revision = state.projectRevision;
  const project = clone(state.project);
  const snapshot = JSON.stringify(project);
  const expectedHash = state.projectResponse.publishedHash;
  stopPlayback();
  setStatus('Mastering and publishing to the game...');
  $('publish').disabled = true;
  try {
    const result = await api('/api/publish', {
      method: 'POST',
      body: {
        key,
        project,
        expectedHash,
        expectedAudioWorkspaceHash: state.audioWorkspaceHash,
      },
    });
    const current =
      sequence === state.loadSequence &&
      state.selected?.key === key &&
      revision === state.projectRevision &&
      JSON.stringify(state.project) === snapshot;
    if (current) {
      setStatus(
        `Published ${key}: ${formatLevel(result.loudness.integratedLufs, 'LUFS')}, ${formatLevel(result.loudness.truePeakDb, 'dBTP')}`,
        'ok',
      );
      await reloadCatalog(key);
    } else {
      if (sequence === state.loadSequence && state.selected?.key === key) {
        await saveDraft(true);
        setStatus(`Published an earlier ${key} edit. Current unsaved edits were preserved.`);
      }
      state.catalog = await api('/api/catalog');
      renderCatalog();
    }
  } catch (error) {
    if (sequence === state.loadSequence && state.selected?.key === key) {
      setStatus(String(error.message ?? error), 'error');
    }
  } finally {
    $('publish').disabled = false;
  }
}

async function publishPlayback() {
  if (!state.selected || !state.playback || !state.playbackProfileDirty) return;
  const key = state.selected.key;
  const sequence = state.loadSequence;
  clearTimeout(state.autosaveTimer);
  const saved = await saveDraft(true);
  await state.saveTail.catch(() => {});
  if (!saved || sequence !== state.loadSequence || state.selected?.key !== key) return;
  const expectedPlaybackProfileHash = state.playbackProfileHash;
  const expectedPlaybackWorkspaceHash = state.playbackWorkspaceHash;
  const revision = state.playbackRevision;
  const playbackSnapshot = JSON.stringify(playbackAuthoring(state.playback));
  setStatus('Applying runtime gain and speed maps without touching audio...');
  setUploadBusy(true);
  try {
    const result = await api('/api/playback', {
      method: 'POST',
      body: { key, expectedPlaybackProfileHash, expectedPlaybackWorkspaceHash },
    });
    if (sequence !== state.loadSequence || state.selected?.key !== key) return;
    if (!result.audioUnchanged || result.audioHashBefore !== result.audioHashAfter) {
      throw new Error('playback publish did not preserve the audio file');
    }
    state.playbackProfileHash = result.playbackProfileHash;
    state.playbackWorkspaceHash = result.playbackWorkspaceHash;
    const currentPlaybackSnapshot = JSON.stringify(playbackAuthoring(state.playback));
    const current =
      revision === state.playbackRevision && playbackSnapshot === currentPlaybackSnapshot;
    if (!current) {
      await saveDraft(true);
      state.catalog = await api('/api/catalog');
      state.selected = state.catalog.clips.find((clip) => clip.key === key) ?? state.selected;
      renderCatalog();
      syncControls();
      renderSelectedMetadata();
      setStatus('Applied an earlier playback mix. Current edits were preserved for review.');
      return;
    }
    state.playback = result.playback;
    state.playbackWorkspaceHash = result.playbackWorkspaceHash;
    state.playbackProfileDirty = !!result.playbackProfileDirty;
    state.catalog = await api('/api/catalog');
    state.selected = state.catalog.clips.find((clip) => clip.key === key) ?? state.selected;
    renderCatalog();
    if (revision !== state.playbackRevision) {
      await saveDraft(true);
      syncControls();
      renderSelectedMetadata();
      setStatus('Applied an earlier playback mix. Current edits were preserved for review.');
      return;
    }
    syncControls();
    renderSelectedMetadata();
    setStatus(
      `Applied ${state.playback.resolvedGainDb.toFixed(1)} dB and ${state.playback.playbackRate.toFixed(2)}x at runtime. Audio SHA-256 stayed ${result.audioHashAfter.slice(0, 12)}.`,
      'ok',
    );
  } catch (error) {
    if (sequence === state.loadSequence && state.selected?.key === key) {
      setStatus(String(error.message ?? error), 'error');
    }
  } finally {
    if (state.uploading) setUploadBusy(false);
  }
}

function downloadFilename(response) {
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename="([a-z0-9_-]+\.zip)"/i);
  return match?.[1] ?? 'world-of-claudecraft-sfx.zip';
}

async function exportAll() {
  if (!state.selected || !state.project) return;
  const sequence = state.loadSequence;
  clearTimeout(state.autosaveTimer);
  const saved = await saveDraft(true);
  await state.saveTail.catch(() => {});
  if (!saved || sequence !== state.loadSequence || !state.selected) return;
  if (state.playbackProfileDirty) {
    setStatus(
      'Export blocked: the playback mix has saved changes that are not applied. Click Apply playback mix, then export again.',
      'error',
    );
    return;
  }
  const confirmed = window.confirm(
    'Export every published SFX master and the applied runtime mix? Local uploads, previews, version history, music, voice lines, and unpublished audio drafts are excluded.',
  );
  if (!confirmed) return;

  stopPlayback();
  setUploadBusy(true);
  $('export-all').textContent = 'Exporting...';
  setStatus('Building deterministic production SFX bundle...');
  try {
    const response = await fetch('/api/export', {
      method: 'POST',
      headers: {
        'X-Woc-Sfx-Studio': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedPlaybackProfileHash: state.playbackProfileHash,
        expectedPlaybackWorkspaceHash: state.playbackWorkspaceHash,
      }),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error ?? `production export failed (${response.status})`);
    }
    const blob = await response.blob();
    const filename = downloadFilename(response);
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);

    const keys = Number(response.headers.get('x-woc-sfx-keys'));
    const tracks = Number(response.headers.get('x-woc-sfx-tracks'));
    const audioBytes = Number(response.headers.get('x-woc-sfx-audio-bytes'));
    setStatus(
      `Downloaded ${filename}: ${keys} keys, ${tracks} tracks, ${formatBytes(audioBytes)} of published audio. Run the included installer against the production static root.`,
      'ok',
    );
  } catch (error) {
    setStatus(String(error.message ?? error), 'error');
  } finally {
    $('export-all').textContent = 'Export all';
    if (state.uploading) setUploadBusy(false);
  }
}

async function restore(hash) {
  if (!state.selected) return;
  const key = state.selected.key;
  if (!window.confirm(`Restore published version ${hash.slice(0, 12)}?`)) return;
  const sequence = state.loadSequence;
  const expectedHash = state.projectResponse?.publishedHash;
  clearTimeout(state.autosaveTimer);
  const saved = await saveDraft(true);
  await state.saveTail.catch(() => {});
  if (!saved || sequence !== state.loadSequence || state.selected?.key !== key) return;
  try {
    await api('/api/restore', {
      method: 'POST',
      body: { key, hash, expectedHash, expectedAudioWorkspaceHash: state.audioWorkspaceHash },
    });
    if (sequence === state.loadSequence && state.selected?.key === key) {
      await reloadCatalog(key);
      setStatus('Published version restored', 'ok');
    } else {
      state.catalog = await api('/api/catalog');
      renderCatalog();
    }
  } catch (error) {
    if (sequence === state.loadSequence && state.selected?.key === key) {
      setStatus(String(error.message ?? error), 'error');
    }
  }
}

async function reloadCatalog(selectKey = null) {
  state.catalog = await api('/api/catalog');
  renderCatalog();
  if (selectKey) await selectClip(selectKey);
}

async function upload(file) {
  if (!state.selected || !file) return;
  const key = state.selected.key;
  const sequence = state.loadSequence;
  clearTimeout(state.autosaveTimer);
  const saved = await saveDraft(true);
  await state.saveTail.catch(() => {});
  if (!saved || sequence !== state.loadSequence || state.selected?.key !== key) return;
  setUploadBusy(true);
  stopPlayback();
  setStatus(`Uploading and validating ${file.name}...`);
  try {
    const result = await api(`/api/upload?key=${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': file.name,
        'X-Woc-Sfx-Audio-Workspace': state.audioWorkspaceHash,
      },
      body: file,
    });
    if (sequence === state.loadSequence && state.selected?.key === key) {
      state.project = result.project;
      state.audioWorkspaceHash = result.audioWorkspaceHash;
      state.projectRevision++;
      setDirty(false);
      setUploadBusy(false);
      setStatus(
        `Uploaded ${file.name}: ${result.info.duration.toFixed(3)}s, ${result.info.channels} channels`,
        'ok',
      );
      await selectClip(key);
    } else {
      state.catalog = await api('/api/catalog');
      renderCatalog();
    }
  } catch (error) {
    if (sequence === state.loadSequence && state.selected?.key === key) {
      setStatus(String(error.message ?? error), 'error');
    }
  } finally {
    if (state.uploading) setUploadBusy(false);
    $('file').value = '';
  }
}

function keepSelection() {
  const range = selectedRange();
  if (!range || !state.project) return;
  if (state.selected?.loop) {
    setStatus('Runtime loop cues use a loop region instead of slice segments.', 'error');
    return;
  }
  state.project.segments = [range];
  projectChanged({ commit: true });
}

function removeSelection() {
  const range = selectedRange();
  if (!range || !state.project || !state.buffer) return;
  if (state.selected?.loop) {
    setStatus('Runtime loop cues use a loop region instead of slice segments.', 'error');
    return;
  }
  const base = state.project.segments.length
    ? state.project.segments
    : [{ start: 0, end: state.buffer.duration }];
  const segments = [];
  for (const segment of base) {
    if (range.end <= segment.start || range.start >= segment.end) {
      segments.push(segment);
      continue;
    }
    if (range.start > segment.start + 0.001) {
      segments.push({ start: segment.start, end: Math.min(range.start, segment.end) });
    }
    if (range.end < segment.end - 0.001) {
      segments.push({ start: Math.max(range.end, segment.start), end: segment.end });
    }
  }
  if (segments.length === 0) {
    setStatus('A cue cannot be empty. Keep a region or upload another source.', 'error');
    return;
  }
  state.project.segments = segments;
  projectChanged({ commit: true });
}

function setLoopFromSelection() {
  const range = selectedRange();
  if (!range || !state.project) return;
  if (!state.selected?.loop) {
    setStatus('This cue is a runtime one-shot and cannot publish as a loop.', 'error');
    return;
  }
  state.project.segments = [];
  state.project.delayMs = 0;
  state.project.fadeInMs = 0;
  state.project.fadeOutMs = 0;
  state.project.loop = {
    enabled: true,
    start: range.start,
    end: range.end,
    crossfadeMs: state.project.loop?.crossfadeMs ?? 20,
  };
  $('loop-playback').checked = true;
  projectChanged({ commit: true });
}

function disableLoop() {
  if (!state.project?.loop) return;
  if (!state.selected?.loop) return;
  state.project.loop.enabled = true;
  state.project.loop.start = 0;
  state.project.loop.end = currentDuration();
  projectChanged({ commit: true });
}

function snapSelection() {
  const range = selectedRange();
  if (!range) return;
  state.selection = { start: nearestZero(range.start), end: nearestZero(range.end) };
  drawWaveform();
}

function wireControls() {
  for (const control of document.querySelectorAll('[data-path]')) {
    control.addEventListener('input', () => {
      if (!state.project || state.uploading) return;
      const path = control.dataset.path;
      const current = getPath(state.project, path);
      const value =
        control.type === 'checkbox'
          ? control.checked
          : typeof current === 'number'
            ? Number(control.value)
            : control.value;
      setPath(state.project, path, value);
      if (path === 'loop.enabled' && value) {
        state.project.segments = [];
        state.project.delayMs = 0;
        state.project.fadeInMs = 0;
        state.project.fadeOutMs = 0;
        state.project.loop.start = Math.max(0, Number(state.project.loop.start) || 0);
        state.project.loop.end = Math.min(
          currentDuration(),
          Number(state.project.loop.end) || currentDuration(),
        );
        $('loop-playback').checked = true;
      }
      projectChanged();
    });
    control.addEventListener('change', () => pushHistory());
  }

  for (const control of document.querySelectorAll('[data-playback-path]')) {
    if (control.dataset.playbackPath === 'resolvedGainDb') continue;
    control.addEventListener('input', () => {
      if (!state.playback || state.uploading) return;
      setPath(state.playback, control.dataset.playbackPath, Number(control.value));
      playbackChanged();
    });
    control.addEventListener('change', () => pushHistory());
  }

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      for (const item of document.querySelectorAll('.tab'))
        item.classList.toggle('active', item === tab);
      for (const panel of document.querySelectorAll('.tab-panel')) {
        panel.classList.toggle('active', panel.dataset.panel === tab.dataset.tab);
      }
      drawEqCurve();
    });
  }

  const waveform = $('waveform');
  waveform.addEventListener('pointerdown', (event) => {
    if (state.audition === 'rendered' && state.exactBuffer) {
      state.playhead = canvasTime(event) / authoredPlaybackRate();
      state.selection = null;
      drawWaveform();
      return;
    }
    state.dragging = true;
    waveform.setPointerCapture(event.pointerId);
    const time = canvasTime(event);
    state.selection = { start: time, end: time };
    drawWaveform();
  });
  waveform.addEventListener('pointermove', (event) => {
    if (!state.dragging || !state.selection) return;
    state.selection.end = canvasTime(event);
    drawWaveform();
  });
  waveform.addEventListener('pointerup', (event) => {
    if (!state.dragging) return;
    state.dragging = false;
    waveform.releasePointerCapture(event.pointerId);
    const range = selectedRange();
    if (!range) {
      const sourceTime = canvasTime(event);
      state.playhead = state.audition === 'live' ? sourceToOutputTime(sourceTime) : sourceTime;
      state.selection = null;
    }
    drawWaveform();
  });
  waveform.addEventListener('wheel', (event) => {
    if (!displayBuffer() || state.zoom <= 1) return;
    event.preventDefault();
    const view = getView();
    state.viewStart += (event.deltaY / 500) * view.duration;
    drawWaveform();
  });

  $('zoom').addEventListener('input', () => {
    state.zoom = Number($('zoom').value);
    const duration = displayDuration();
    const visible = duration / state.zoom;
    state.viewStart = Math.max(
      0,
      Math.min(duration - visible, waveformPlayheadTime() - visible / 2),
    );
    drawWaveform();
  });
  $('search').addEventListener('input', renderCatalog);
  $('category').addEventListener('change', renderCatalog);
  $('routing').addEventListener('change', renderCatalog);
  $('play').addEventListener('click', () => void play());
  $('stop').addEventListener('click', () => stopPlayback());
  $('loop-playback').addEventListener('change', () => stopPlayback(false));
  $('ab').addEventListener('click', cycleAudition);
  $('undo').addEventListener('click', () => restoreHistory(state.historyIndex - 1));
  $('redo').addEventListener('click', () => restoreHistory(state.historyIndex + 1));
  $('save').addEventListener('click', () => void saveDraft());
  $('reset-draft').addEventListener('click', () => void resetAudioDraft());
  $('render').addEventListener('click', () => void renderExact());
  $('publish-playback').addEventListener('click', () => void publishPlayback());
  $('publish').addEventListener('click', () => void publish());
  $('export-all').addEventListener('click', () => void exportAll());
  $('upload').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', () => void upload($('file').files?.[0]));
  $('keep-selection').addEventListener('click', keepSelection);
  $('remove-selection').addEventListener('click', removeSelection);
  $('set-loop').addEventListener('click', setLoopFromSelection);
  $('clear-loop').addEventListener('click', disableLoop);
  $('clear-slices').addEventListener('click', () => {
    if (!state.project) return;
    if (state.selected?.loop) return;
    state.project.segments = [];
    projectChanged({ commit: true });
  });
  $('snap-zero').addEventListener('click', snapSelection);

  window.addEventListener('resize', () => {
    drawWaveform();
    drawEqCurve();
    drawMeter(-Infinity, -Infinity);
  });
  document.addEventListener('keydown', (event) => {
    const editable = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if (event.code === 'Space' && !editable) {
      event.preventDefault();
      if (state.playing) stopPlayback(false);
      else void play();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      restoreHistory(state.historyIndex + (event.shiftKey ? 1 : -1));
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void saveDraft();
    }
  });
}

async function init() {
  wireControls();
  updateHistoryButtons();
  drawMeter(-Infinity, -Infinity);
  try {
    state.catalog = await api('/api/catalog');
    $('toolchain').textContent = state.catalog.toolchain.ready
      ? state.catalog.toolchain.ffmpeg
      : `FFmpeg unavailable: ${state.catalog.toolchain.error}`;
    const categories = [...new Set(state.catalog.clips.map((clip) => clip.category))].sort();
    for (const category of categories) {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      $('category').append(option);
    }
    renderCatalog();
    if (state.catalog.clips[0]) await selectClip(state.catalog.clips[0].key);
  } catch (error) {
    setStatus(String(error.message ?? error), 'error');
  }
}

void init();
