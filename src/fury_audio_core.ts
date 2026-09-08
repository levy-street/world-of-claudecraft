/** Shared cue identity and per-event ownership, without renderer/audio imports. */
export const FURY_AUDIO = {
  raging_gale: {
    release: 'melee_warrior_twinstrike_release',
    impacts: ['impact_warrior_twinstrike_first', 'impact_warrior_twinstrike_second'],
    times: [0.15, 0.34],
  },
  red_harvest: {
    release: 'melee_warrior_red_harvest_release',
    impacts: [
      'impact_warrior_red_harvest_first',
      'impact_warrior_red_harvest_second',
      'impact_warrior_red_harvest_finish',
    ],
    times: [0.15, 0.32, 0.49],
  },
} as const;
export type FuryAudioId = keyof typeof FURY_AUDIO;
export function isFuryAudioId(id: string | undefined): id is FuryAudioId {
  return id === 'raging_gale' || id === 'red_harvest';
}
export function furyAudioSample(id: string | undefined, key: string | undefined): boolean {
  if (!isFuryAudioId(id) || !key) return false;
  const cue = FURY_AUDIO[id];
  return cue.release === key || (cue.impacts as readonly string[]).includes(key);
}
// The renderer sees each event immediately before the HUD/Studio sound adapter.
// Claim only after a separate presentation-clock queue has retained the sound.
const claims = new WeakSet<object>();
export function claimFuryAudio(event: object): void {
  claims.add(event);
}
export function clearFuryAudioClaim(event: object): void {
  claims.delete(event);
}
export function furyAudioClaimed(event: object): boolean {
  return claims.has(event);
}
