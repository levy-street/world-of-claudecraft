// Pure decision logic for whether the procedural soundtrack mix should be
// audible, and at what level. Extracted from MusicDirector (music.ts) so the
// five-flag policy (enabled, menuPaused, bossActive, sowfieldActive, vol) is
// unit-testable without any AudioContext or other WebAudio wiring.

export interface MusicMixState {
  enabled: boolean;
  menuPaused: boolean;
  // A running cinematic's 'silence' directive (SceneDirector): a hard cut
  // that owns the whole mix until 'resume', without touching the toggle.
  sceneSilenced: boolean;
  bossActive: boolean;
  sowfieldActive: boolean;
  vol: number;
}

// master gain target given the mix state and a base stream level. The
// dedicated boss/Sowfield file tracks own the mix while active, and the
// toggle, menu fade, scene silence, and volume slider each duck the
// procedural score to 0.
export function musicMixMasterTarget(state: MusicMixState, streamLevel: number): number {
  if (
    !state.enabled ||
    state.menuPaused ||
    state.sceneSilenced ||
    state.bossActive ||
    state.sowfieldActive
  ) {
    return 0;
  }
  return streamLevel * state.vol;
}

// Streams are audible only when nothing has the master ducked to zero: the
// toggle, the menu fade, the scene-silence directive, the volume slider, and
// the dedicated boss and Sowfield file tracks (which own the mix while
// active). While inaudible, streams pause instead of decoding silence.
export function isMusicMixAudible(state: MusicMixState): boolean {
  return (
    state.enabled &&
    !state.menuPaused &&
    !state.sceneSilenced &&
    state.vol > 0 &&
    !state.bossActive &&
    !state.sowfieldActive
  );
}
