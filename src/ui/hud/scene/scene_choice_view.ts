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
}

export interface SceneChoiceModel {
  visible: boolean;
  choiceId: string | null;
  promptKey: string | null;
  options: readonly SceneChoiceOption[];
  /** True when the local player is the one whose answer counts. */
  isLeader: boolean;
  leaderPid: number;
  /** Whole seconds left in the response window, or null when unbounded. */
  remainingSeconds: number | null;
}

export interface SceneChoiceState {
  prompt: SceneChoicePrompt | null;
  openedAt: number;
  readonly model: SceneChoiceModel;
}

const NO_OPTIONS: readonly SceneChoiceOption[] = [];

export function createSceneChoiceState(): SceneChoiceState {
  return {
    prompt: null,
    openedAt: 0,
    model: {
      visible: false,
      choiceId: null,
      promptKey: null,
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
  s.openedAt = nowSec;
}

/** Resolve (sceneChoiceResult event). True when the live prompt closed. */
export function choiceResolve(s: SceneChoiceState, choiceId: string): boolean {
  if (s.prompt === null || s.prompt.choiceId !== choiceId) return false;
  s.prompt = null;
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
  m.options = prompt?.options ?? NO_OPTIONS;
  m.isLeader = prompt !== null && prompt.leaderPid === playerId;
  m.leaderPid = prompt?.leaderPid ?? -1;
  m.remainingSeconds =
    prompt !== null && prompt.windowSeconds > 0
      ? Math.max(0, Math.ceil(s.openedAt + prompt.windowSeconds - nowSec))
      : null;
  return m;
}
