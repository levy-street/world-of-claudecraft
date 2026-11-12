// The Smith's Heart's five boss entrances (the Hammer Council's "The quarry
// wakes", the Breath's "Calm before the storm", the Quench's "Under the ice",
// the Heat's cold hearth, the Masterless Strength's arrival) share one
// performance budget per graphics tier, read off the STATIC preset (the
// resolved `data-fx-level` tier, never the FPS governor; see
// docs/design/graphics-settings-fairness.md).
//
// Evidence (scripts/smith_heart_entrance_perf.mjs, a headless d3d11 probe:
// smoke evidence, its numbers live in its reports, not here): every program
// links under the painters' gated attach, no scene adds a light or a shadow
// caster, and the extra draw calls are few; the cost left to shed is read as
// fill (the particles and the broad translucent layers), an inference the
// GPU timer's runs support but a weak GPU has not confirmed.
// So a tier owns three knobs:
//  - `share`: the share of every authored particle rate and of the flying
//    stone, rubble, shards and pebbles (whole plans thinned every k-th, so
//    a shape stays whole);
//  - `secondary`: the cosmetic doubles over a beat that already reads on its
//    own (the second cloud disc over the Breath's eye and the funnel's
//    ragged outer layer; the heat haze round the Heat's body, never its
//    embers' glow, which is the fire itself; the Council's room crystals
//    flaring with the note's wave; the arrival's sky crown and beam
//    sheath); every one is named in
//    `ENTRANCE_SECONDARY_LAYERS` so a test proves the low tier never draws it;
//  - `particleCeiling`: the most particles one scene's pools can hold at once
//    (the pools are rings, so this is a hard cap however long a beat emits).
// Never tiered (every tier, pinned): every beat, every silhouette (the
// bodies, the slabs, the shell of the funnel, the column, the beam), the big
// flash and impact moments, and everything a player acts on (the boss, its
// cast bar, the floor warnings: none of them is an entrance layer). No tier
// adds a light or a shadow caster.
//
// Pure and Three-free (RENDER_PURE_CORES): tests/smith_heart_entrance_budget.test.ts.

/** The five entrances. */
export const SMITH_HEART_ENTRANCES = ['council', 'breath', 'quench', 'heat', 'final'] as const;
export type SmithHeartEntrance = (typeof SMITH_HEART_ENTRANCES)[number];

/** The resolved effect tier (`resolveUiEffectsProfile(...).tier`). */
export type EntranceEffectsTier = 'low' | 'medium' | 'high' | 'ultra';

/** The low tier's share of every particle rate and flying-stone plan. */
export const SMITH_HEART_ENTRANCE_LOW_SHARE = 0.4;

export interface EntranceBudget {
  /** The full authored richness (every tier but low). */
  readonly detail: boolean;
  /** Share of the particle rates and stone plans (1 on a detail tier). */
  readonly share: number;
  /** The cosmetic doubles (`ENTRANCE_SECONDARY_LAYERS`) are drawn. */
  readonly secondary: boolean;
  /** Most particles a scene's pools hold at once (the pools' summed rings). */
  readonly particleCeiling: number;
  /** Lights a scene adds (none, on every tier). */
  readonly addedLights: 0;
  /** Shadow casters a scene adds (none, on every tier). */
  readonly shadowCasters: 0;
}

/** The engine pools' authored rings (smoke, glow, soulfire, pyre) and the
 *  slack each keeps over its share: a copy of `ENGINE_POOL_RINGS` /
 *  `ENGINE_POOL_SLACK` (../trash_engine_fx/engine_particles.ts, a Three
 *  module this core cannot import), held equal by the budget test. A
 *  capacity pin (slots), not a measure of live particles or overdraw. */
const POOL_RINGS = [1200, 1200, 700, 600] as const;
const POOL_SLACK = 64;

/** The particles a scene's pools hold at once at `share`. */
export function entranceParticleCeiling(share: number): number {
  let n = 0;
  for (const ring of POOL_RINGS) n += Math.round(ring * share) + POOL_SLACK;
  return n;
}

const FULL: EntranceBudget = Object.freeze({
  detail: true,
  share: 1,
  secondary: true,
  particleCeiling: entranceParticleCeiling(1),
  addedLights: 0,
  shadowCasters: 0,
});

const LOW: EntranceBudget = Object.freeze({
  detail: false,
  share: SMITH_HEART_ENTRANCE_LOW_SHARE,
  secondary: false,
  particleCeiling: entranceParticleCeiling(SMITH_HEART_ENTRANCE_LOW_SHARE),
  addedLights: 0,
  shadowCasters: 0,
});

/** One entrance's budget at a resolved effect tier. Every entrance shares
 *  the table today; the entrance is the key so one can be retuned alone.
 *  `final` also sets the final fight's particle share (FinalFx owns both the
 *  arrival and the fight's pools): retune it knowing the fight thins too. */
export function entranceBudget(
  _entrance: SmithHeartEntrance,
  tier: EntranceEffectsTier,
): EntranceBudget {
  return tier === 'low' ? LOW : FULL;
}

/** The meshes (by name) the low tier never draws: each a cosmetic double
 *  over a beat that reads on its own without it. */
export const ENTRANCE_SECONDARY_LAYERS: Readonly<Record<SmithHeartEntrance, readonly string[]>> =
  Object.freeze({
    council: ['smithHeartCouncilEntranceFlares'],
    breath: ['smithHeartBreathEntranceEyeHigh', 'smithHeartBreathEntranceFunnelOuter'],
    quench: [],
    heat: ['smithHeartHeatEntranceHaze'],
    final: ['smithHeartArrivalCrown', 'smithHeartArrivalSheath'],
  });

/** The final boss's death (final_death_core.ts, painted with its arrival's
 *  budget): the cosmetic doubles the low tier never draws, the column's
 *  soft sheath and the comets' coloured halos (the white heads, their
 *  sparks, the grooves, the well and every beat stay on every tier). */
export const DEATH_SECONDARY_LAYERS = Object.freeze([
  'smithHeartDeathSheath',
  'smithHeartDeathCometHalo',
] as const);
