// Versioned, non-destructive SFX edit graph plus deterministic ffmpeg planning.
// All values are normalized here before they can reach a child-process argument.

export const PROJECT_VERSION = 3;

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const bool = (value, fallback = false) => (typeof value === 'boolean' ? value : fallback);

const round = (value, places = 4) => Number(Number(value).toFixed(places));

export function defaultProject({ loop = false } = {}) {
  return {
    version: PROJECT_VERSION,
    sourceId: null,
    segments: [],
    sliceCrossfadeMs: 5,
    reverse: false,
    delayMs: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    syncOffsetMs: 0,
    loop: {
      enabled: loop,
      start: 0,
      end: null,
      crossfadeMs: 20,
    },
    eq: {
      highpassHz: 20,
      lowGainDb: 0,
      lowFreqHz: 120,
      midGainDb: 0,
      midFreqHz: 1000,
      midQ: 1,
      mid2GainDb: 0,
      mid2FreqHz: 3000,
      mid2Q: 1,
      mid3GainDb: 0,
      mid3FreqHz: 6000,
      mid3Q: 1,
      highGainDb: 0,
      highFreqHz: 8000,
      lowpassHz: 20000,
    },
    compressor: {
      enabled: false,
      thresholdDb: -18,
      ratio: 3,
      attackMs: 10,
      releaseMs: 120,
      knee: 2.8,
      makeupDb: 0,
      mix: 1,
    },
    normalize: {
      enabled: false,
      targetLufs: loop ? -20 : -16,
      truePeakDb: -1,
      loudnessRange: 7,
    },
    limiter: {
      enabled: true,
      ceilingDb: -1,
      releaseMs: 50,
    },
    output: {
      channels: 'auto',
      bitrateKbps: 192,
    },
  };
}

function normalizeLoop(raw, { catalogLoop, duration }) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const max = duration > 0 ? duration : 300;
  let start = round(clamp(value.start, 0, max, 0), 6);
  let end = round(clamp(value.end, 0, max, max), 6);
  const minimum = Math.min(0.01, max);
  if (end - start < minimum) {
    start = 0;
    end = round(max, 6);
  }
  const processedDuration = end - start;
  const maxCrossfadeMs = Math.min(500, Math.max(0, ((processedDuration - 0.002) / 2) * 1000));
  return {
    enabled: !!catalogLoop,
    start,
    end,
    crossfadeMs: round(clamp(value.crossfadeMs, 0, maxCrossfadeMs, 20), 2),
  };
}

function normalizeSegments(raw, duration) {
  if (!Array.isArray(raw)) return [];
  const max = duration > 0 ? duration : 300;
  const out = raw
    .slice(0, 64)
    .map((segment) => ({
      start: round(clamp(segment?.start, 0, max, 0), 6),
      end: round(clamp(segment?.end, 0, max, max), 6),
    }))
    .filter((segment) => segment.end - segment.start >= 0.001)
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < out.length; i++) {
    if (out[i].start < out[i - 1].end) {
      throw new Error('segments must not overlap');
    }
  }
  return out;
}

export function normalizeProject(raw = {}, { loop = false, duration = 0 } = {}) {
  const base = defaultProject({ loop });
  const eq = raw.eq ?? {};
  const compressor = raw.compressor ?? {};
  const normalize = raw.normalize ?? {};
  const limiter = raw.limiter ?? {};
  const output = raw.output ?? {};
  const channels = ['auto', 'mono', 'stereo'].includes(output.channels)
    ? output.channels
    : base.output.channels;
  const highpassHz = clamp(eq.highpassHz, 10, 10000, base.eq.highpassHz);
  const lowpassHz = Math.max(highpassHz + 10, clamp(eq.lowpassHz, 100, 24000, base.eq.lowpassHz));
  const sourceId =
    typeof raw.sourceId === 'string' && /^[a-f0-9]{12,64}\.[a-z0-9]{2,5}$/.test(raw.sourceId)
      ? raw.sourceId
      : null;
  const loopSettings = normalizeLoop(raw.loop, { catalogLoop: loop, duration });
  return {
    version: PROJECT_VERSION,
    sourceId,
    segments: normalizeSegments(raw.segments, duration),
    sliceCrossfadeMs: round(clamp(raw.sliceCrossfadeMs, 0, 50, base.sliceCrossfadeMs), 2),
    reverse: bool(raw.reverse),
    delayMs: loopSettings.enabled ? 0 : round(clamp(raw.delayMs, 0, 5000, 0), 2),
    fadeInMs: loopSettings.enabled ? 0 : round(clamp(raw.fadeInMs, 0, 10000, 0), 2),
    fadeOutMs: loopSettings.enabled ? 0 : round(clamp(raw.fadeOutMs, 0, 10000, 0), 2),
    syncOffsetMs: round(clamp(raw.syncOffsetMs, -5000, 5000, 0), 2),
    loop: loopSettings,
    eq: {
      highpassHz: round(highpassHz, 2),
      lowGainDb: round(clamp(eq.lowGainDb, -24, 24, 0), 2),
      lowFreqHz: round(clamp(eq.lowFreqHz, 20, 1000, base.eq.lowFreqHz), 2),
      midGainDb: round(clamp(eq.midGainDb, -24, 24, 0), 2),
      midFreqHz: round(clamp(eq.midFreqHz, 100, 12000, base.eq.midFreqHz), 2),
      midQ: round(clamp(eq.midQ, 0.1, 18, base.eq.midQ), 3),
      mid2GainDb: round(clamp(eq.mid2GainDb, -24, 24, 0), 2),
      mid2FreqHz: round(clamp(eq.mid2FreqHz, 100, 16000, base.eq.mid2FreqHz), 2),
      mid2Q: round(clamp(eq.mid2Q, 0.1, 18, base.eq.mid2Q), 3),
      mid3GainDb: round(clamp(eq.mid3GainDb, -24, 24, 0), 2),
      mid3FreqHz: round(clamp(eq.mid3FreqHz, 200, 20000, base.eq.mid3FreqHz), 2),
      mid3Q: round(clamp(eq.mid3Q, 0.1, 18, base.eq.mid3Q), 3),
      highGainDb: round(clamp(eq.highGainDb, -24, 24, 0), 2),
      highFreqHz: round(clamp(eq.highFreqHz, 1000, 20000, base.eq.highFreqHz), 2),
      lowpassHz: round(lowpassHz, 2),
    },
    compressor: {
      enabled: bool(compressor.enabled),
      thresholdDb: round(clamp(compressor.thresholdDb, -60, 0, base.compressor.thresholdDb), 2),
      ratio: round(clamp(compressor.ratio, 1, 20, base.compressor.ratio), 2),
      attackMs: round(clamp(compressor.attackMs, 0.01, 2000, base.compressor.attackMs), 2),
      releaseMs: round(clamp(compressor.releaseMs, 1, 9000, base.compressor.releaseMs), 2),
      knee: round(clamp(compressor.knee, 1, 8, base.compressor.knee), 3),
      makeupDb: round(clamp(compressor.makeupDb, 0, 24, 0), 2),
      mix: round(clamp(compressor.mix, 0, 1, 1), 3),
    },
    normalize: {
      enabled: bool(normalize.enabled),
      targetLufs: round(clamp(normalize.targetLufs, -36, -5, base.normalize.targetLufs), 2),
      truePeakDb: round(clamp(normalize.truePeakDb, -9, 0, base.normalize.truePeakDb), 2),
      loudnessRange: round(clamp(normalize.loudnessRange, 1, 20, base.normalize.loudnessRange), 2),
    },
    limiter: {
      enabled: bool(limiter.enabled, true),
      ceilingDb: round(clamp(limiter.ceilingDb, -9, -0.1, base.limiter.ceilingDb), 2),
      releaseMs: round(clamp(limiter.releaseMs, 1, 8000, base.limiter.releaseMs), 2),
    },
    output: {
      channels,
      bitrateKbps: 192,
    },
  };
}

export function dbToLinear(db) {
  return 10 ** (Number(db) / 20);
}

export function effectiveTruePeakDb(project) {
  if (!project.normalize.enabled) return project.limiter.enabled ? project.limiter.ceilingDb : -0.1;
  return Math.min(
    project.normalize.truePeakDb,
    project.limiter.enabled ? project.limiter.ceilingDb : -0.1,
  );
}

function effectiveSegments(project, duration) {
  if (project.loop.enabled) return [{ start: project.loop.start, end: project.loop.end }];
  if (project.segments.length) return project.segments;
  return duration > 0 ? [{ start: 0, end: duration }] : [];
}

function outputChannelCount(project, spatial, sourceChannels = 2) {
  if (project.output.channels === 'mono') return 1;
  if (project.output.channels === 'stereo') return 2;
  if (spatial) return 1;
  return sourceChannels === 1 ? 1 : 2;
}

function validMeasurement(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ranges = {
    measuredI: [-99, 0],
    measuredLra: [0, 99],
    measuredTp: [-99, 99],
    measuredThresh: [-99, 0],
    offset: [-99, 99],
  };
  const out = {};
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const value = Number(raw[key]);
    if (!Number.isFinite(value) || value < min || value > max) return null;
    out[key] = round(value, 6);
  }
  return out;
}

function loudnormFilter(settings, { measurement, printJson = true } = {}) {
  const parts = [
    `I=${settings.targetLufs}`,
    `TP=${settings.truePeakDb}`,
    `LRA=${settings.loudnessRange}`,
  ];
  if (measurement !== undefined) {
    const values = validMeasurement(measurement);
    if (!values) throw new Error('loudness measurement is incomplete or outside FFmpeg bounds');
    parts.push(
      `measured_I=${values.measuredI}`,
      `measured_TP=${values.measuredTp}`,
      `measured_LRA=${values.measuredLra}`,
      `measured_thresh=${values.measuredThresh}`,
      `offset=${values.offset}`,
      'linear=true',
    );
  }
  if (printJson) parts.push('print_format=json');
  return `loudnorm=${parts.join(':')}`;
}

export function buildFfmpegGraph(
  projectInput,
  {
    duration = 0,
    sourceChannels = 2,
    loop = false,
    spatial = !loop,
    measureLoudness = false,
    loudnessMeasurement,
    codecGainDb = 0,
  } = {},
) {
  const project = normalizeProject(projectInput, { duration, loop });
  const segments = effectiveSegments(project, duration);
  const statements = [];
  let current = '[0:a]';
  let selectedDuration = duration;

  if (segments.length) {
    selectedDuration = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      statements.push(
        `[0:a]atrim=start=${segment.start}:end=${segment.end},asetpts=PTS-STARTPTS[s${i}]`,
      );
    }
    if (segments.length === 1) current = '[s0]';
    else if (project.sliceCrossfadeMs > 0) {
      const shortest = Math.min(...segments.map((segment) => segment.end - segment.start));
      const crossfade = round(Math.min(project.sliceCrossfadeMs / 1000, shortest / 2), 6);
      let joined = '[s0]';
      for (let index = 1; index < segments.length; index++) {
        const label = index === segments.length - 1 ? '[cut]' : `[cut${index}]`;
        statements.push(`${joined}[s${index}]acrossfade=d=${crossfade}:c1=tri:c2=tri${label}`);
        joined = label;
      }
      current = '[cut]';
      selectedDuration -= crossfade * (segments.length - 1);
    } else {
      statements.push(
        `${segments.map((_, index) => `[s${index}]`).join('')}concat=n=${segments.length}:v=0:a=1[cut]`,
      );
      current = '[cut]';
    }
  }

  const filters = [];
  if (project.reverse) filters.push('areverse');
  if (project.eq.highpassHz > 20) filters.push(`highpass=f=${project.eq.highpassHz}`);
  if (project.eq.lowGainDb !== 0) {
    filters.push(`bass=f=${project.eq.lowFreqHz}:g=${project.eq.lowGainDb}`);
  }
  if (project.eq.midGainDb !== 0) {
    filters.push(
      `equalizer=f=${project.eq.midFreqHz}:t=q:w=${project.eq.midQ}:g=${project.eq.midGainDb}`,
    );
  }
  if (project.eq.mid2GainDb !== 0) {
    filters.push(
      `equalizer=f=${project.eq.mid2FreqHz}:t=q:w=${project.eq.mid2Q}:g=${project.eq.mid2GainDb}`,
    );
  }
  if (project.eq.mid3GainDb !== 0) {
    filters.push(
      `equalizer=f=${project.eq.mid3FreqHz}:t=q:w=${project.eq.mid3Q}:g=${project.eq.mid3GainDb}`,
    );
  }
  if (project.eq.highGainDb !== 0) {
    filters.push(`treble=f=${project.eq.highFreqHz}:g=${project.eq.highGainDb}`);
  }
  if (project.eq.lowpassHz < 20000) filters.push(`lowpass=f=${project.eq.lowpassHz}`);
  if (project.compressor.enabled) {
    filters.push(
      [
        `acompressor=threshold=${round(dbToLinear(project.compressor.thresholdDb), 8)}`,
        `ratio=${project.compressor.ratio}`,
        `attack=${project.compressor.attackMs}`,
        `release=${project.compressor.releaseMs}`,
        `knee=${project.compressor.knee}`,
        `makeup=${round(dbToLinear(project.compressor.makeupDb), 8)}`,
        `mix=${project.compressor.mix}`,
      ].join(':'),
    );
  }
  if (project.delayMs > 0) filters.push(`adelay=${project.delayMs}:all=1`);

  const processedDuration = selectedDuration > 0 ? selectedDuration : 0;
  const unloopedOutputDuration = processedDuration + project.delayMs / 1000;
  if (project.fadeInMs > 0) {
    filters.push(
      `afade=t=in:st=${round(project.delayMs / 1000, 6)}:d=${round(project.fadeInMs / 1000, 6)}:curve=qsin`,
    );
  }
  if (project.fadeOutMs > 0 && unloopedOutputDuration > 0) {
    const fadeDuration = Math.min(project.fadeOutMs / 1000, processedDuration);
    const start = Math.max(project.delayMs / 1000, unloopedOutputDuration - fadeDuration);
    filters.push(`afade=t=out:st=${round(start, 6)}:d=${round(fadeDuration, 6)}:curve=qsin`);
  }

  const limiter = `alimiter=limit=${round(dbToLinear(project.limiter.ceilingDb), 8)}:release=${project.limiter.releaseMs}:level=false:latency=true`;
  const outputSamples = Math.max(1, Math.round(unloopedOutputDuration * 48000));
  const channelLayout =
    outputChannelCount(project, spatial, sourceChannels) === 1 ? 'mono' : 'stereo';
  const normalizedCodecGain = round(clamp(codecGainDb, -6, 6, 0), 4);
  const masteringFilters = (
    sampleCount,
    { layoutHandled = false, limiterHandled = false } = {},
  ) => {
    const result = [];
    if (project.normalize.enabled) {
      if (!layoutHandled) {
        result.push(`aformat=channel_layouts=${channelLayout}`, 'aresample=48000');
      }
      if (project.limiter.enabled && !limiterHandled) result.push(limiter);
      result.push(`apad=whole_len=${Math.max(19200, sampleCount)}`);
      result.push(
        loudnormFilter(
          { ...project.normalize, truePeakDb: effectiveTruePeakDb(project) },
          {
            measurement: measureLoudness ? undefined : loudnessMeasurement,
          },
        ),
      );
      if (!measureLoudness) {
        if (normalizedCodecGain !== 0) result.push(`volume=${normalizedCodecGain}dB`);
        result.push('aresample=48000', `atrim=end_sample=${sampleCount}`, 'asetpts=PTS-STARTPTS');
      }
    } else if (!measureLoudness) {
      if (project.limiter.enabled && !limiterHandled) result.push(limiter);
      if (normalizedCodecGain !== 0) result.push(`volume=${normalizedCodecGain}dB`);
      if (!layoutHandled) result.push('aresample=48000');
    }
    return result;
  };
  if (!project.loop.enabled) {
    filters.push(...masteringFilters(outputSamples));
    statements.push(`${current}${filters.join(',')}[out]`);
    return {
      graph: statements.join(';'),
      outputLabel: '[out]',
      outputDuration: round(unloopedOutputDuration, 6),
      project,
    };
  }

  filters.push(`aformat=channel_layouts=${channelLayout}`, 'aresample=48000');
  if (project.limiter.enabled) filters.push(limiter);
  statements.push(`${current}${filters.join(',')}[loopbase]`);
  const requestedCrossfade = project.loop.crossfadeMs / 1000;
  const maxCrossfade = Math.max(0, (processedDuration - 0.002) / 2);
  const crossfade = round(Math.min(requestedCrossfade, maxCrossfade), 6);
  let loopCurrent = '[loopbase]';
  let outputDuration = processedDuration;
  if (crossfade >= 0.001) {
    const tailStart = round(processedDuration - crossfade, 6);
    statements.push('[loopbase]asplit=3[loopheadsrc][loopmidsrc][looptailsrc]');
    statements.push(`[loopheadsrc]atrim=start=0:end=${crossfade},asetpts=PTS-STARTPTS[loophead]`);
    statements.push(
      `[loopmidsrc]atrim=start=${crossfade}:end=${tailStart},asetpts=PTS-STARTPTS[loopmid]`,
    );
    statements.push(
      `[looptailsrc]atrim=start=${tailStart}:end=${round(processedDuration, 6)},asetpts=PTS-STARTPTS[looptail]`,
    );
    statements.push(`[looptail][loophead]acrossfade=d=${crossfade}:c1=qsin:c2=qsin[loopseam]`);
    statements.push('[loopseam][loopmid]concat=n=2:v=0:a=1[loopjoined]');
    loopCurrent = '[loopjoined]';
    outputDuration -= crossfade;
  }
  const loopSamples = Math.max(1, Math.round(outputDuration * 48000));
  const finalFilters = masteringFilters(loopSamples, {
    layoutHandled: true,
    limiterHandled: project.limiter.enabled,
  });
  statements.push(`${loopCurrent}${finalFilters.length ? finalFilters.join(',') : 'anull'}[out]`);
  return {
    graph: statements.join(';'),
    outputLabel: '[out]',
    outputDuration: round(outputDuration, 6),
    project,
  };
}

export function buildFfmpegArgs({
  input,
  output,
  project,
  duration,
  sampleRate,
  sourceChannels = 2,
  loop = false,
  spatial = !loop,
  loudnessMeasurement,
  codecGainDb = 0,
}) {
  const plan = buildFfmpegGraph(project, {
    duration,
    sampleRate,
    sourceChannels,
    loop,
    spatial,
    loudnessMeasurement,
    codecGainDb,
  });
  const channels = outputChannelCount(plan.project, spatial, sourceChannels);
  return {
    ...plan,
    args: [
      '-hide_banner',
      '-loglevel',
      plan.project.normalize.enabled ? 'info' : 'error',
      '-nostdin',
      '-y',
      '-i',
      input,
      '-filter_complex',
      plan.graph,
      '-map',
      plan.outputLabel,
      '-vn',
      '-map_metadata',
      '-1',
      '-ar',
      '48000',
      '-ac',
      String(channels),
      '-codec:a',
      'libmp3lame',
      '-b:a',
      `${plan.project.output.bitrateKbps}k`,
      '-id3v2_version',
      '3',
      output,
    ],
  };
}

/** Render the non-destructive authoring graph to a lossless intermediate.
 *  The shared production conform step owns the one and only MP3 encode. */
export function buildAuthoringPcmArgs({
  input,
  output,
  project,
  duration,
  sampleRate,
  sourceChannels = 2,
  loop = false,
  spatial = !loop,
  loudnessMeasurement,
}) {
  const plan = buildFfmpegGraph(project, {
    duration,
    sampleRate,
    sourceChannels,
    loop,
    spatial,
    loudnessMeasurement,
  });
  const channels = outputChannelCount(plan.project, spatial, sourceChannels);
  return {
    ...plan,
    args: [
      '-hide_banner',
      '-loglevel',
      plan.project.normalize.enabled ? 'info' : 'error',
      '-nostdin',
      '-y',
      '-i',
      input,
      '-filter_complex',
      plan.graph,
      '-map',
      plan.outputLabel,
      '-vn',
      '-map_metadata',
      '-1',
      '-ar',
      '48000',
      '-ac',
      String(channels),
      '-codec:a',
      'pcm_s24le',
      '-f',
      'wav',
      output,
    ],
  };
}

export function buildLoudnessMeasureArgs({
  input,
  project,
  duration,
  sampleRate,
  sourceChannels = 2,
  loop = false,
  spatial = !loop,
}) {
  const plan = buildFfmpegGraph(project, {
    duration,
    sampleRate,
    sourceChannels,
    loop,
    spatial,
    measureLoudness: true,
  });
  if (!plan.project.normalize.enabled)
    throw new Error('loudness measurement requires normalization');
  return {
    ...plan,
    args: [
      '-hide_banner',
      '-nostdin',
      '-nostats',
      '-i',
      input,
      '-filter_complex',
      plan.graph,
      '-map',
      plan.outputLabel,
      '-f',
      'null',
      '-',
    ],
  };
}
