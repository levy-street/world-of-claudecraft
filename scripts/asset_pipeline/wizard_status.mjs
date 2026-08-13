// Pure status decisions shared by the asset wizard's browser UI and backend.
// A stopped child is not necessarily successful: the durable job ledger is the
// source of truth, and a failed step must return the operator to an error screen
// rather than exposing review actions for artifacts that do not exist.

export function failedWizardStep(steps) {
  let failure = null;
  for (const [step, state] of Object.entries(steps ?? {})) {
    const status = typeof state === 'string' ? state : state?.status;
    if (status !== 'failed') continue;
    failure = {
      step,
      error: typeof state === 'object' && state?.error ? String(state.error) : null,
    };
  }
  return failure;
}

export function wizardFailureMessage(status) {
  if (!status || status.running) return null;
  const failure = status.failure ?? failedWizardStep(status.steps);
  if (!failure) return null;
  const label = String(failure.step || 'generation');
  return failure.error
    ? `The ${label} step failed: ${failure.error}`
    : `The ${label} step failed. Check the log below.`;
}

export function wizardProcessFailure(run) {
  if (!run || run.exitCode === 0) return null;
  const step = run.phase || 'pipeline';
  return {
    step,
    error: run.error
      ? String(run.error)
      : `The pipeline process exited with code ${String(run.exitCode)}.`,
  };
}

export function wizardResumeState(status) {
  if (!status?.exists || !status.jobId || !status.kind || !status.name) return null;
  const saved = status.wizard ?? {};
  return {
    mode: 'resume',
    lane: status.kind,
    name: status.name,
    prompt: saved.prompt ?? '',
    jobId: status.jobId,
    options: {
      model: 'lowpoly',
      image: '',
      rigType: '',
      height: '',
      family: '',
      rotateY: '',
      faceLimit: '',
      ...(saved.options ?? {}),
    },
    texturePrompt: '',
    textureQuality: 'detailed',
    phase: 'model',
  };
}
