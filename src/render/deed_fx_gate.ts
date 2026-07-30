// The one gate between a deedUnlocked event and its celebratory firework VFX.
// Graphics settings may shed only COSMETIC richness (the fairness rule): the
// festival-gold burst is cosmetic, so a reduced-motion player skips it, and a
// retro back-credit (the on-join catch-up) draws nothing because the HUD folds
// those into a single summary line. The unlock banner and gold log line are
// NOT gated here: they carry the earned moment regardless of settings.
export function shouldPlayDeedFirework(ev: { retro?: boolean }, reducedMotion: boolean): boolean {
  return !ev.retro && !reducedMotion;
}
