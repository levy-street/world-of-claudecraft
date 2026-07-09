// The Vale Cup: data-as-code for the boarball minigame (docs/prd/vale-cup.md).
// Banner nations, the class-agnostic sport ability records, the role kits, and
// the ONE shared kit resolver both hosts use (the offline Sim swaps meta.known
// with it; the online ClientWorld rebuilds its derived known list with the
// same function, so the action bar is identical everywhere).
//
// AbilityDef.class has no runtime consumer (casting gates purely on membership
// in meta.known), so sport abilities are class-agnostic by construction; the
// 'warrior' tag below is a type requirement only. All sport moves are school
// 'physical' so they resolve on the cast tick (no projectile landing delay)
// and skip spell-resist rolls, and they cost 0 so every class can use them.
import type { AbilityDef, MobTemplate, SportRole, VcNationId } from '../types';
import type { KnownAbility } from './classes';

// ---------------------------------------------------------------------------
// The eight banner nations. Names/blurbs are localized client-side from the id
// (vcup.nation.<id> keys); colors feed the procedural flags and team tints.
// ---------------------------------------------------------------------------
export interface VcNationDef {
  id: VcNationId;
  primary: number; // flag field color
  secondary: number; // flag accent color
  emblem: 'wheat' | 'heron' | 'peak' | 'swords' | 'bell' | 'fist' | 'crescent' | 'pick';
}

export const VC_NATIONS: readonly VcNationDef[] = [
  { id: 'vale', primary: 0x3f7d34, secondary: 0xd9b23a, emblem: 'wheat' },
  { id: 'mirefen', primary: 0x33707a, secondary: 0x9aa6a4, emblem: 'heron' },
  { id: 'thornpeak', primary: 0x5d84c4, secondary: 0xe9f0f8, emblem: 'peak' },
  { id: 'coliseum', primary: 0xa32c2c, secondary: 0x27221f, emblem: 'swords' },
  { id: 'choir', primary: 0x9fc4d8, secondary: 0xcfd8e2, emblem: 'bell' },
  { id: 'ogre', primary: 0xc06a2a, secondary: 0x5c4530, emblem: 'fist' },
  { id: 'moon', primary: 0x6d5a9c, secondary: 0xc9c2dd, emblem: 'crescent' },
  { id: 'copperdig', primary: 0xa66a3a, secondary: 0x66422a, emblem: 'pick' },
] as const;

export const VC_NATION_IDS = VC_NATIONS.map((n) => n.id);

export function vcNation(id: string): VcNationDef | null {
  return VC_NATIONS.find((n) => n.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// The ball: a bell-pattern INERT mob entity (tolling_bell precedent) so it
// replicates over the normal entity wire with zero custom net code. The spawn
// site flips it non-hostile; moveSpeed 0 / aggroRadius 0 / ccImmune keep the
// mob AI a no-op (plus the explicit early-bail in mob/locomotion.ts). Velocity
// lives in the match state (social/vale_cup.ts), never on the entity.
// ---------------------------------------------------------------------------
export const VALE_CUP_BALL_TEMPLATE_ID = 'vale_cup_ball';

export const VALE_CUP_BALL_MOB: MobTemplate = {
  id: VALE_CUP_BALL_TEMPLATE_ID,
  name: 'Boarball',
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
  scale: 1.54, // a real soccer ball (30% smaller than the old chest-high ball)
  color: 0xf4f4f4,
  ccImmune: true,
  xpMult: 0,
};

// ---------------------------------------------------------------------------
// Sport abilities. Ground-aimed kicks use targetMode 'position' (the castAt
// primitive), so the existing aim reticle works unchanged. The ballKick /
// sportDash / sportShove effects are consumed by the vale_cup sim module and
// effect_dispatch arms; stun and selfBuff reuse proven handlers (PvP
// diminishing returns apply to the tumble automatically).
// ---------------------------------------------------------------------------
export const SPORT_ABILITIES: Record<string, AbilityDef> = {
  sport_kick: {
    id: 'sport_kick',
    name: 'Kick',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 1.2,
    range: 18,
    school: 'physical',
    requiresTarget: false,
    targetMode: 'position',
    offGcd: true,
    effects: [{ type: 'ballKick', power: 16, loft: 3 }],
    description: 'Knock the ball along the ground toward the aim point.',
  },
  sport_boot: {
    id: 'sport_boot',
    name: 'Big Boot',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 6,
    range: 30,
    school: 'physical',
    requiresTarget: false,
    targetMode: 'position',
    offGcd: true,
    effects: [{ type: 'ballKick', power: 24, loft: 7 }],
    description: 'A long lofted boot toward the aim point. The crowd loves it.',
  },
  sport_hoof: {
    id: 'sport_hoof',
    name: 'Hoof It',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 8,
    range: 30,
    school: 'physical',
    requiresTarget: false,
    targetMode: 'position',
    offGcd: true,
    effects: [{ type: 'ballKick', power: 26, loft: 4 }],
    description: 'Hammer the ball low and hard up the field.',
  },
  sport_punt: {
    id: 'sport_punt',
    name: 'Long Punt',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 10,
    range: 34,
    school: 'physical',
    requiresTarget: false,
    targetMode: 'position',
    offGcd: true,
    effects: [{ type: 'ballKick', power: 26, loft: 9 }],
    description: "A keeper's punt, high and far.",
  },
  sport_shoot: {
    id: 'sport_shoot',
    name: 'Shoot',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 1.4,
    range: 34,
    school: 'physical',
    requiresTarget: false,
    targetMode: 'position',
    offGcd: true,
    // Hold to charge: the client encodes the held power as the aim distance, and
    // both the ground speed (power) and the loft scale with it, so a max-power
    // shot balloons OVER the crossbar. power is the full-charge speed (the ball
    // cap), loft the full-charge lift. Handler auto-aims at the enemy goal.
    effects: [{ type: 'ballShoot', power: 28, loft: 11 }],
    description: 'Hold to build power, release to shoot at goal. Too much power sails over.',
  },
  sport_pass: {
    id: 'sport_pass',
    name: 'Pass',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 1,
    range: 42,
    school: 'physical',
    requiresTarget: false,
    targetMode: 'position',
    offGcd: true,
    // power is the pass CAP: the handler auto-paces to reach the receiver and
    // leads their run, so a short give-and-go rolls soft and a long ball firm.
    effects: [{ type: 'ballPass', power: 26, loft: 0 }],
    description: 'Roll a firm pass to your targeted teammate, leading their run.',
  },
  sport_feint: {
    id: 'sport_feint',
    name: 'Feint',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 8,
    range: 10,
    school: 'physical',
    requiresTarget: false,
    targetMode: 'position',
    offGcd: true,
    effects: [{ type: 'sportDash', distance: 5 }],
    description: 'A quick sidestep burst toward the aim point.',
  },
  sport_dive: {
    id: 'sport_dive',
    name: 'Dive',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 8,
    range: 12,
    school: 'physical',
    requiresTarget: false,
    targetMode: 'position',
    offGcd: true,
    effects: [{ type: 'sportDash', distance: 8, catchBall: true }],
    description: 'Fling yourself toward the aim point. A crossing ball sticks to you.',
  },
  sport_shoulder: {
    id: 'sport_shoulder',
    name: 'Shoulder',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 10,
    range: 0,
    school: 'physical',
    requiresTarget: true,
    offGcd: true,
    effects: [
      { type: 'stun', duration: 1.2 },
      { type: 'sportShove', distance: 4 },
    ],
    description: 'A fair harvest-truce shoulder. Sends them tumbling off the ball.',
  },
  sport_second_wind: {
    id: 'sport_second_wind',
    // Display name deliberately NOT 'Second Wind': that exact string is on the
    // verbatim-WoW denylist (tests/ip_scrub.test.ts). The id predates the
    // rename and is not player-visible.
    name: 'Fresh Legs',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 12,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    effects: [{ type: 'selfBuff', kind: 'buff_speed', value: 1.5, duration: 4 }],
    description: 'Find your legs: move 50% faster for 4 sec.',
  },
};

// ---------------------------------------------------------------------------
// Role kits (bar order matters: Kick first, sprint last).
// ---------------------------------------------------------------------------
// The soccer kit: Shoot (hold to charge), Pass (to your selected teammate), and
// Boost (Fresh Legs). Keepers add a Dive. Bar order matters: Shoot is first so it
// lands on key 1 (the class Attack slot, which the pitch remaps to Shoot).
export const SPORT_KITS: Record<SportRole, readonly string[]> = {
  allrounder: ['sport_shoot', 'sport_pass', 'sport_second_wind'],
  striker: ['sport_shoot', 'sport_pass', 'sport_second_wind'],
  sweeper: ['sport_shoot', 'sport_pass', 'sport_second_wind'],
  keeper: ['sport_shoot', 'sport_pass', 'sport_dive', 'sport_second_wind'],
};

export const SPORT_ROLES: readonly SportRole[] = ['allrounder', 'striker', 'sweeper', 'keeper'];

/** The ONE shared sport-kit resolver (Sim swap + ClientWorld derived rebuild).
 *  Flat rank-1 entries with NO talent modifiers: a player's damage talents must
 *  never scale sport moves, and every class gets the identical kit. */
export function resolveSportKit(role: SportRole): KnownAbility[] {
  return SPORT_KITS[role].map((id) => {
    const def = SPORT_ABILITIES[id];
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
