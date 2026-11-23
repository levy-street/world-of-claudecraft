// Bear Trap snapshots its total at placement, then rounds the damage of each
// bleed tick when it springs. Share that rounding with the resolved tooltip so
// the displayed total is exactly what all ticks pay, including Ranged AP.
export function hunterTrapBleedAmounts(bleed: {
  total: number;
  duration: number;
  interval: number;
}): { perTick: number; total: number; ticks: number } {
  const ticks = Math.max(1, Math.round(bleed.duration / bleed.interval));
  const perTick = Math.max(1, Math.round(bleed.total / ticks));
  return { perTick, total: perTick * ticks, ticks };
}
