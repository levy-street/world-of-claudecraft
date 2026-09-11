// Deepball at the Deepglass: the class-agnostic sport records, the bar kit, the
// one shared kit resolver, and the Tidesow's own mob template
// (docs/prd/deepglass.md).
//
// These lived in sim/content/vale_cup.ts alongside the boarball kit until
// upstream v0.40 demolished the Sowfield and retired the Vale Cup. Nothing about
// deepball was ever boarball's, it only borrowed the module, so the four moves
// and the ball template moved HERE, next to the match driver that reads them.
//
// AbilityDef.class has no runtime consumer (casting gates purely on membership
// in meta.known), so these are class-agnostic by construction; the 'warrior' tag
// is a type requirement only. All of them are school 'physical' so they resolve
// on the cast tick (no projectile landing delay) and skip spell-resist rolls,
// and they cost 0 so every class can fly the same bar.

import type { KnownAbility } from '../content/classes';
import type { AbilityDef, MobTemplate } from '../types';

// ---------------------------------------------------------------------------
// The Tidesow: a bell-pattern INERT mob entity (the tolling_bell precedent) so
// it replicates over the normal entity wire with zero custom net code. The
// spawn site flips it non-hostile; moveSpeed 0 / aggroRadius 0 / ccImmune keep
// the mob AI a no-op. Velocity lives in the match state (deepglass/match.ts),
// never on the entity.
// ---------------------------------------------------------------------------
export const DEEPGLASS_BALL_TEMPLATE_ID = 'deepglass_ball';

export const DEEPGLASS_BALL_MOB: MobTemplate = {
  id: DEEPGLASS_BALL_TEMPLATE_ID,
  name: 'Tidesow',
  minLevel: 1,
  maxLevel: 1,
  family: 'beast',
  hpBase: 1,
  hpPerLevel: 0,
  dmgBase: 0,
  dmgPerLevel: 0,
  attackSpeed: 999,
  armorPerLevel: 0,
  moveSpeed: 0,
  aggroRadius: 0,
  loot: [],
  // The draw scale the renderer divides DG_BALL_RADIUS by (deepglass_ball.ts).
  scale: 1.54,
  color: 0xf4f4f4,
  ccImmune: true,
  xpMult: 0,
};

// ---------------------------------------------------------------------------
// The four moves. Every one aims from the caster's own thrust vector, you
// shoot where you are flying, so none of them needs a ground reticle. All four
// route through ONE effect arm ({ type: 'deepball' }) into the match driver,
// and silently no-op unless the caster is in a live bout.
// ---------------------------------------------------------------------------
export const DEEPBALL_ABILITIES: Record<string, AbilityDef> = {
  dg_shot: {
    id: 'dg_shot',
    name: 'Shot',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 1.1,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    // Base pace only. The strike ADDS a slice of the striker's own speed
    // (DG_SPEED_INTO_SHOT), and the ball's 34 yd/s cap is what makes that matter:
    // at the old base of 30 a standing tap and a full-pace strike were both
    // pinned to the cap and the run into the ball bought nothing. At 26 a
    // stationary shot is a shot and a shot on the run is a rocket.
    effects: [{ type: 'deepball', move: 'shot', power: 26 }],
    description:
      'Strike the Tidesow along your line of flight, where you look is where it goes. ' +
      'Hit it fast for a volley, and carry your own pace into it.',
  },
  dg_pass: {
    id: 'dg_pass',
    name: 'Pass',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 0.9,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'deepball', move: 'pass', power: 20 }],
    description: 'Feed the most advanced teammate, leading their run in three axes.',
  },
  dg_check: {
    id: 'dg_check',
    name: 'Check',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 7,
    // Auto-targeted: the sim rams the CLOSEST opponent (match.ts nearestEnemy,
    // gated by DG_CHECK_RANGE), so no click-target is required, selecting a
    // body by hand in a three-axis scrum was a lottery, not a skill.
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'deepball', move: 'check' }],
    description:
      'Ram the nearest opponent at speed to knock them off the ball. Slow, and nothing happens.',
  },
  // ONE button for both powerups: which one fires is whichever orb you went and
  // fetched off the map, so the decision lives out in the bell rather than on
  // the hotbar. The old permanent Overburn is gone with it, free infinite
  // boost on a 16s cooldown made the boost economy (pads, and only pads) a
  // formality.
  dg_power: {
    id: 'dg_power',
    name: 'Spend Powerup',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 1,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'deepball', move: 'power' }],
    description:
      "Spend the powerup you are carrying: the Tidewarden's Lance fires a Zap Shot that demolishes whoever you are aiming at (they respawn at their own goal three seconds later), and Overburn floods the burners for ten.",
  },
};

/** The deepball kit, in bar order. Shot lands on key 1, the bout remaps the
 *  class Attack slot to it. */
export const DEEPBALL_KIT: readonly string[] = ['dg_shot', 'dg_pass', 'dg_check', 'dg_power'];

/** The ONE shared deepball kit resolver: flat rank-1 entries with NO talent
 *  modifiers, so a player's damage talents can never scale a sport move and
 *  every class flies the identical bar. */
export function resolveDeepballKit(): KnownAbility[] {
  return DEEPBALL_KIT.map((id) => {
    const def = DEEPBALL_ABILITIES[id];
    return {
      def,
      rank: 1,
      cost: def.cost,
      castTime: def.castTime,
      cooldown: def.cooldown,
      effects: def.effects,
      threatFlat: 0,
      threatMult: 1,
    };
  });
}
