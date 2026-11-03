// The Mute All Sound toggle (Ctrl+M by default, keybinds.ts `muteAudio`).
// Session-only on purpose: it silences every channel (sound effects, ambience,
// music, voices) without touching the saved volume sliders, so a reload or a
// second press always brings the player's own mix back.

let muted = false;

export function isAudioMuted(): boolean {
  return muted;
}

/** Flips the mute and returns the new state. */
export function toggleAudioMuted(): boolean {
  muted = !muted;
  return muted;
}

/** The volume a channel should play at: its saved value, or 0 while muted. */
export function audibleVolume(saved: number): number {
  return muted ? 0 : saved;
}
