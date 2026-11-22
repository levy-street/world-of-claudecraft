export interface PaladinSunVerdictAuraSource {
  id: string;
  kind: string;
  value: number;
  sourceId: number;
}

export const SUN_VERDICT_LANCE_CAPACITY = 6;
export const SUN_VERDICT_LANCE_DURATION = 1.1;
export const SUN_VERDICT_LANCE_LANDING = 0.3;

/** How deep the sword's point is driven into the ground, yards. */
export const SUN_VERDICT_LANCE_EMBED = 1.4;

/** Cosmetic descent only; the real sentence is resolved by the simulation.
 * The point falls from high above and drives into the ground. */
export function sunVerdictLanceTip(age: number, reducedMotion: boolean): number {
  const t = Math.min(1, Math.max(0, age / SUN_VERDICT_LANCE_LANDING));
  return -SUN_VERDICT_LANCE_EMBED + (reducedMotion ? 0 : 12 * (1 - t) ** 2);
}

export function sunVerdictLanceAlpha(age: number): number {
  if (age < 0 || age >= SUN_VERDICT_LANCE_DURATION) return 0;
  return Math.min(1, (age + 0.01) / 0.065) * Math.min(1, (SUN_VERDICT_LANCE_DURATION - age) / 0.4);
}

/** The falling lance is the brand itself, fully charged and tip down. */
export const SUN_VERDICT_LANCE_LENGTH = 12;
/** Sentence footprint for a single target; area sentences pass their radius. */
export const SUN_VERDICT_LANCE_RADIUS = 1.8;
export const SUN_VERDICT_LANCE_SPARKS = 14;
export const SUN_VERDICT_LANCE_SHARDS = 12;
/** The planted lance holds this long after landing, then shatters. */
export const SUN_VERDICT_LANCE_HOLD = 0.4;
/** Lance, comet streak, target reticle, light pillar, flare, ground seal,
 * then sparks and shards. */
export const SUN_VERDICT_LANCE_VERTICES =
  (6 + SUN_VERDICT_LANCE_SPARKS + SUN_VERDICT_LANCE_SHARDS) * 6;

export interface SunVerdictShard {
  /** Offset from the lance foot, in yards. */
  x: number;
  y: number;
  z: number;
  /** Spin angle and half size. */
  spin: number;
  size: number;
  alpha: number;
}
/** Shards of the lance flung out when it shatters, spread along its length. */
export function sampleSunVerdictShard(
  index: number,
  sinceShatter: number,
  reducedMotion: boolean,
  length: number,
  out: SunVerdictShard,
): void {
  const angle = index * 2.399963 + 0.3;
  const along = (((index * 7) % 12) / 12) * 0.8 + 0.1;
  const t = Math.max(0, sinceShatter);
  const speed = reducedMotion ? 0.15 : 1;
  const outward = (2.4 + (index % 3) * 1.1) * speed;
  const fall = reducedMotion ? 0 : 6;
  out.x = Math.cos(angle) * outward * t;
  out.z = Math.sin(angle) * outward * t;
  out.y = along * length + (1.5 + (index % 4) * 0.6) * speed * t - 0.5 * fall * t * t;
  out.spin = index * 1.3 + (reducedMotion ? 0 : t * (6 + (index % 5)));
  out.size = 0.1 + (index % 3) * 0.05;
  const life = 0.3 + (index % 3) * 0.05;
  out.alpha = sinceShatter < 0 || t >= life ? 0 : (1 - t / life) ** 1.1;
}

export interface SunVerdictSpark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  alpha: number;
}
/** Deterministic sparks thrown up and out from the landing point. */
export function sampleSunVerdictSpark(
  index: number,
  sinceLanding: number,
  reducedMotion: boolean,
  out: SunVerdictSpark,
): void {
  const angle = index * 2.399963;
  const speed = reducedMotion ? 0.2 : 1;
  const life = 0.3 + (index % 4) * 0.05;
  const t = Math.max(0, sinceLanding);
  const outward = (1.6 + (index % 3) * 0.9) * speed;
  out.vx = Math.cos(angle) * outward;
  out.vz = Math.sin(angle) * outward;
  out.vy = (2.6 + (index % 5) * 0.8) * speed;
  const fall = reducedMotion ? 0 : 9;
  out.x = out.vx * t;
  out.z = out.vz * t;
  out.y = out.vy * t - 0.5 * fall * t * t;
  out.vy -= fall * t;
  out.alpha = sinceLanding < 0 || t >= life ? 0 : (1 - t / life) ** 1.2;
}

export interface PaladinSunVerdictVisualSource {
  dead: boolean;
  auras: ReadonlyArray<PaladinSunVerdictAuraSource>;
}

export interface PaladinSunVerdictVisualPlan {
  active: boolean;
  charges: number;
  imminent: boolean;
}

export function selectPaladinSunVerdictAura(
  selected: PaladinSunVerdictAuraSource | null,
  candidate: PaladinSunVerdictAuraSource,
  viewerId: number,
): PaladinSunVerdictAuraSource | null {
  if (candidate.id !== 'sun_gods_verdict' || candidate.kind !== 'sun_verdict') return selected;
  if (candidate.sourceId === viewerId) return candidate;
  if (selected?.sourceId === viewerId) return selected;
  return !selected || candidate.value > selected.value ? candidate : selected;
}

export function paladinSunVerdictVisualPlanForAuraInto(
  dead: boolean,
  selected: PaladinSunVerdictAuraSource | null,
  out: PaladinSunVerdictVisualPlan,
): PaladinSunVerdictVisualPlan {
  if (dead || !selected) {
    out.active = false;
    out.charges = 0;
    out.imminent = false;
    return out;
  }

  const charges = Math.max(0, Math.min(3, Math.floor(selected.value)));
  out.active = true;
  out.charges = charges;
  out.imminent = charges >= 2;
  return out;
}

export function paladinSunVerdictVisualPlanInto(
  entity: PaladinSunVerdictVisualSource,
  viewerId: number,
  out: PaladinSunVerdictVisualPlan,
): PaladinSunVerdictVisualPlan {
  let selected: PaladinSunVerdictAuraSource | null = null;
  for (const aura of entity.auras) {
    selected = selectPaladinSunVerdictAura(selected, aura, viewerId);
  }
  return paladinSunVerdictVisualPlanForAuraInto(entity.dead, selected, out);
}
