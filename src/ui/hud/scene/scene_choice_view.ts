// Pure view core for the Last Bell dialogue-choice window. One prompt is live
// at a time (the sim cues one per story claim and always resolves it, by
// answer or by the response-window default). The LEADER answers; everyone
// else watches, so the model distinguishes clickable options from the
// waiting-for-leader presentation. DOM-free and i18n-free (keys only); time
// is fed in as seconds. The returned model is a state-owned reused container.

export interface SceneChoiceOption {
  id: string;
  key: string;
}

export interface SceneChoicePrompt {
  choiceId: string;
  promptKey: string;
  options: SceneChoiceOption[];
  windowSeconds: number;
  defaultOptionId: string;
  leaderPid: number;
  /** Interpolation values for the prompt key (the fare price). */
  values?: Record<string, string | number>;
}

export interface SceneChoiceModel {
  visible: boolean;
  choiceId: string | null;
  promptKey: string | null;
  /** Interpolation values for the prompt key, or null when it has none. */
  values: Record<string, string | number> | null;
  options: readonly SceneChoiceOption[];
  /** True when the local player is the one whose answer counts. */
  isLeader: boolean;
  leaderPid: number;
  /** Whole seconds left in the response window, or null when unbounded. */
  remainingSeconds: number | null;
}

export interface SceneChoiceState {
  prompt: SceneChoicePrompt | null;
  deadlineAt: number | null;
  readonly model: SceneChoiceModel;
}

const NO_OPTIONS: readonly SceneChoiceOption[] = [];

export function createSceneChoiceState(): SceneChoiceState {
  return {
    prompt: null,
    deadlineAt: null,
    model: {
      visible: false,
      choiceId: null,
      promptKey: null,
      values: null,
      options: NO_OPTIONS,
      isLeader: false,
      leaderPid: -1,
      remainingSeconds: null,
    },
  };
}

/** Open a prompt (sceneChoice event). A newer prompt replaces a stale one. */
export function choicePromptOpen(
  s: SceneChoiceState,
  prompt: SceneChoicePrompt,
  nowSec: number,
): void {
  s.prompt = prompt;
  s.deadlineAt = prompt.windowSeconds > 0 ? nowSec + prompt.windowSeconds : null;
}

export function choicePromptSync(
  s: SceneChoiceState,
  prompt: SceneChoicePrompt | null,
  remainingSeconds: number | null,
  nowSec: number,
): void {
  s.prompt = prompt;
  s.deadlineAt =
    prompt !== null && remainingSeconds !== null ? nowSec + Math.max(0, remainingSeconds) : null;
}

/** Resolve (sceneChoiceResult event). True when the live prompt closed. */
export function choiceResolve(s: SceneChoiceState, choiceId: string): boolean {
  if (s.prompt === null || s.prompt.choiceId !== choiceId) return false;
  s.prompt = null;
  s.deadlineAt = null;
  return true;
}

/** Resolve the per-frame render model (mutates and returns the reused container). */
export function sceneChoiceView(
  s: SceneChoiceState,
  nowSec: number,
  playerId: number,
): SceneChoiceModel {
  const m = s.model;
  const prompt = s.prompt;
  m.visible = prompt !== null;
  m.choiceId = prompt?.choiceId ?? null;
  m.promptKey = prompt?.promptKey ?? null;
  m.values = prompt?.values ?? null;
  m.options = prompt?.options ?? NO_OPTIONS;
  m.isLeader = prompt !== null && prompt.leaderPid === playerId;
  m.leaderPid = prompt?.leaderPid ?? -1;
  m.remainingSeconds =
    prompt !== null && s.deadlineAt !== null ? Math.max(0, Math.ceil(s.deadlineAt - nowSec)) : null;
  return m;
}
