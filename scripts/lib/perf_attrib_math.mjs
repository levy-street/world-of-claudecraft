function positiveFps(name, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite FPS value`);
  }
  return value;
}

export function frameTimeMs(fps) {
  return 1000 / positiveFps('fps', fps);
}

export function attributionMetrics(controlFps, sampleFps) {
  const control = positiveFps('controlFps', controlFps);
  const sample = positiveFps('sampleFps', sampleFps);
  return {
    fps: sample,
    deltaFps: sample - control,
    gpuMsSaved: 1000 / control - 1000 / sample,
  };
}

function fixedSigned(value, digits) {
  const rounded = value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

export function formatAttributionTable(controlFps, samples) {
  positiveFps('controlFps', controlFps);
  const rows = [
    { knob: 'control', ...attributionMetrics(controlFps, controlFps) },
    ...samples.map((sample) => ({
      knob: sample.knob,
      ...attributionMetrics(controlFps, sample.fps),
    })),
  ];
  const knobWidth = Math.max('knob'.length, ...rows.map((row) => row.knob.length));
  const header = `${'knob'.padEnd(knobWidth)}  ${'fps'.padStart(8)}  ${'delta fps'.padStart(10)}  ${'GPU ms/frame saved'.padStart(18)}`;
  const body = rows.map(
    (row) =>
      `${row.knob.padEnd(knobWidth)}  ${row.fps.toFixed(1).padStart(8)}  ${fixedSigned(row.deltaFps, 1).padStart(10)}  ${fixedSigned(row.gpuMsSaved, 3).padStart(18)}`,
  );
  return [header, ...body].join('\n');
}
