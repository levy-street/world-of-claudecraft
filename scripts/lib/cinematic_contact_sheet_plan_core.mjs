const TIME_PRECISION = 3;

export function formatContactSheetSeconds(seconds) {
  return Number(seconds.toFixed(TIME_PRECISION)).toString();
}

function roundSeconds(seconds) {
  return Number(seconds.toFixed(TIME_PRECISION));
}

function frameFileName(index, targetTime) {
  const time = formatContactSheetSeconds(targetTime).replace('.', '_');
  return `frame_${String(index).padStart(4, '0')}_target_${time}s.png`;
}

function subjectForShot(shot) {
  if (typeof shot?.subjectRef === 'string' && shot.subjectRef.length > 0) {
    return shot.subjectRef;
  }
  if (shot?.kind === 'attach') return shot.target ?? null;
  if (shot?.kind === 'focus') return shot.actorId ?? null;
  if (shot?.kind === 'dolly' && shot.lookAt?.kind === 'subject') {
    return shot.lookAt.actorId ?? null;
  }
  return null;
}

function activeIntent(ops, cameraOp, targetTime) {
  const subjects = [];
  const seenSubjects = new Set();
  const addSubject = (subject) => {
    if (typeof subject !== 'string' || subject.length === 0 || seenSubjects.has(subject)) return;
    seenSubjects.add(subject);
    subjects.push(subject);
  };

  addSubject(subjectForShot(cameraOp?.shot));

  const textKeys = [];
  for (const op of ops) {
    if (op.at > targetTime) break;
    if (op.kind === 'line') {
      const duration = Number.isFinite(op.dur) ? op.dur : 4;
      if (duration > 0 && targetTime < op.at + duration) {
        if (typeof op.key === 'string' && op.key.length > 0) textKeys.push(op.key);
        addSubject(op.speakerActorId);
      }
    }
    if (op.kind === 'prop') {
      const duration = Number.isFinite(op.dur) ? op.dur : 0;
      if (duration > 0 && targetTime < op.at + duration) addSubject(op.target);
    }
  }

  return {
    expectedSubjects: subjects,
    expectedTextKeys: [...new Set(textKeys)],
  };
}

function sortedOps(ops) {
  return ops
    .map((op, index) => ({ ...op, sourceIndex: index }))
    .sort((left, right) => left.at - right.at || left.sourceIndex - right.sourceIndex);
}

export function contactSheetIntentAt(timeline, time) {
  const ops = sortedOps(timeline);
  let camera = null;
  for (const op of ops) {
    if (op.at > time) break;
    if (op.kind === 'camera') camera = op.shot?.kind === 'release' ? null : op;
  }
  return activeIntent(ops, camera, time);
}

function cameraWindows(ops, duration) {
  const cameras = ops.filter((op) => op.kind === 'camera');
  const windows = [];
  for (let index = 0; index < cameras.length; index++) {
    const camera = cameras[index];
    if (camera.shot?.kind === 'release') continue;
    const nextCamera = cameras[index + 1];
    const windowStart = Math.max(0, camera.at);
    const windowEnd = Math.min(duration, nextCamera?.at ?? duration);
    if (windowEnd <= windowStart) continue;
    windows.push({ camera, windowStart, windowEnd });
  }
  return windows;
}

export function planContactSheet(input) {
  if (!input || typeof input.sceneId !== 'string' || input.sceneId.length === 0) {
    throw new Error('Contact sheet planning requires a scene id.');
  }
  if (!Number.isFinite(input.duration) || input.duration <= 0) {
    throw new Error(`Scene ${input.sceneId} requires a positive finite duration.`);
  }
  if (!Array.isArray(input.ops)) {
    throw new Error(`Scene ${input.sceneId} requires an authored ops timeline.`);
  }

  const ops = sortedOps(input.ops);
  const authoredWindows = cameraWindows(ops, input.duration);
  const windows =
    authoredWindows.length > 0
      ? authoredWindows
      : [{ camera: null, windowStart: 0, windowEnd: input.duration }];

  const stills = windows.map((window, index) => {
    const targetTime = roundSeconds((window.windowStart + window.windowEnd) / 2);
    const intent = contactSheetIntentAt(ops, targetTime);
    const reason = window.camera
      ? `camera cut at ${formatContactSheetSeconds(window.windowStart)}s`
      : 'scene midpoint';
    return {
      index,
      file: frameFileName(index, targetTime),
      targetTime,
      windowStart: roundSeconds(window.windowStart),
      windowEnd: roundSeconds(window.windowEnd),
      reasons: [reason],
      ...intent,
    };
  });

  return {
    sceneId: input.sceneId,
    seed: input.seed,
    duration: roundSeconds(input.duration),
    stills,
  };
}
