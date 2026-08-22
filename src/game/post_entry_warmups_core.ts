export type PostEntryWarmupErrorSource = 'far-vista';

export interface CharacterStreamKickDependencies {
  startCharacterPreloads: () => number;
  onCharacterPreloadsStarted: (count: number) => void;
}

export interface PostEntryWarmupDependencies {
  settleFarVista: () => Promise<boolean>;
  onFarVistaSettled: (ready: boolean) => void;
  startBackgroundPreloads: () => number;
  onBackgroundPreloadsStarted: (count: number) => void;
  onWarmupError: (source: PostEntryWarmupErrorSource, error: unknown) => void;
}

/**
 * Starts the deferred character-body stream. Wired to the first painted world
 * frame, ahead of the GPU settle cover and the curtain fade: on the tight-memory
 * profile these fetches are the ACTIONABLE creature bodies (no view, nameplate,
 * or click target until a GLB arrives), and the entry allocation spike they were
 * deferred past has cleared by first paint.
 */
export function kickCharacterPreloadStream(deps: CharacterStreamKickDependencies): void {
  deps.onCharacterPreloadsStarted(deps.startCharacterPreloads());
}

/** Starts the remaining optional work once the revealed world is interactive. */
export function runPostEntryWarmups(deps: PostEntryWarmupDependencies): void {
  try {
    void deps
      .settleFarVista()
      .then(deps.onFarVistaSettled)
      .catch((error: unknown) => deps.onWarmupError('far-vista', error));
  } catch (error) {
    deps.onWarmupError('far-vista', error);
  }

  deps.onBackgroundPreloadsStarted(deps.startBackgroundPreloads());
}
