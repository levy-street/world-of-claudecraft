// The Undermount Descent: the three-wing raid under Thornpeak Heights (pass 6
// of docs/prd/furnace-lair-raid.md; finale: Volzharr, the Buried Furnace).
// Wing 1 is the Kiln-Keepers duo, wing 2 Odrenn the Temperer, wing 3 Volzharr;
// the Forge-Heart (Quenching) wing was cut in the pass-6 review.
// This module owns the wing-chain metadata and
// the pure seal predicate: each wing's door stays sealed until the prior wing's
// boss has been cleared (permanent raid progress, NOT the daily lockout, so a
// farm raid never re-clears wing 1 to reach wing 2). Per-wing encounter drivers
// land here later, following the encounters/nythraxis.ts pattern; for now this
// is the walking-skeleton backbone that the instance layer consults.
//
// The wing chain + seal predicate are pure (no rng, no Sim state, no DOM); the
// instance layer (src/sim/instances/dungeons.ts) consumes them. onUndermountBossDeath
// is the one ctx-dependent function (duo frenzy + wing-clear credit), mirroring
// encounters/nythraxis.ts grantNythraxisLockout.

import { NPCS } from '../data';
import { createNpc } from '../entity';
import type { SimContext } from '../sim_context';
import { type Aura, dist2d, type Entity, type SimEvent, YELL_RANGE } from '../types';

// Players within this many yards of the dead boss's spawn get the wing cleared.
// Matches NYTHRAXIS_ROOM_RADIUS: large enough to cover the interior, small enough
// not to bleed into an adjacent instance's origin.
export const UNDERMOUNT_ROOM_RADIUS = 260;

// Wing 2, Odrenn the Temperer: the section-1 design constants from the
// handoff (docs/prd/furnace-lair-raid-handoff.md), all (tuning), locked for
// PBE. Consumed by encounters/odrenn.ts and its tests.
export const ODRENN_MARK_BURN_RADIUS = 12; // mixed-mark burn range, steady never bursty
export const ODRENN_MARK_BURN_DPS = 12; // each of a mixed pair, per second
export const ODRENN_ARC_RADIUS = 8; // Cinder Arc chain jump range
export const ODRENN_ARC_CADENCE_S = 20;
export const ODRENN_ARC_BASE_DMG = 40; // first jump; grows per jump
export const ODRENN_ARC_GROWTH = 1.4; // damage multiplier per jump
export const ODRENN_LATTICE_MIN = 9; // taught spacing: 9 to 11 yd lattice
export const ODRENN_LATTICE_MAX = 11;
export const ODRENN_HYSTERESIS_YD = 2; // keep-your-mark band astride the centerline
export const ODRENN_ENRAGE_STACK_CADENCE_S = 45; // permanent stacking haste self-buff
export const ODRENN_ENRAGE_HASTE_PER_STACK = 0.06; // +6% attack speed per Tempering stack

// Wing 3, Volzharr: the section-1 constants from the handoff plus the ember
// march (all (tuning), locked for PBE). Consumed by encounters/volzharr.ts.
export const VENT_CADENCE_S = 25; // permanent Vent Fissure spawn cadence
export const VENT_BAIT_EVERY = 3; // every third vent opens under a random player
export const VENT_PULSE_DPS = 15; // fire per second inside a vent; vents never close
export const VENT_RADIUS = 4;
export const FORGEHEAT_RADIUS = 5; // within this of a vent edge (not in it) stacks Forgeheat
export const FORGEHEAT_STACK_CAP = 5;
export const FORGEHEAT_HASTE_PER_STACK = 0.04; // the offense arm
export const FORGEHEAT_FIRE_TAKEN_PER_STACK = 0.2; // the risk arm
export const FORGEHEAT_DURATION_S = 4; // decays seconds after leaving the vent edge
export const ERUPTION_CADENCE_S = 45;
export const ERUPTION_TELEGRAPH_S = 3.0;
export const ERUPTION_DMG_MIN = 350;
export const ERUPTION_DMG_MAX = 450;
export const EMBER_WAKE_CADENCE_S = 30; // one dormant Cinderling wakes
export const EMBER_SHAMBLE_SPEED = 3; // woken embers walk AT VOLZHARR, vent-immune
export const EMBER_CONSUME_RADIUS = 3; // reaching him feeds him
export const EMBERFEED_HASTE_PER_STACK = 0.03; // permanent, uncapped (the aging clock)

// Kiln Fury: the surviving keeper of a duo frenzies when its partner falls (the
// kill-together tension). The engine's packFrenzy only buffs SAME-templateId
// packmates, so this cross-keeper frenzy is bespoke to the encounter.
const KEEPER_FRENZY_AURA_ID = 'undermount_keeper_frenzy';
const KEEPER_FRENZY_HASTE = 0.5; // +50% attack speed while enraged (tuning)
const KEEPER_FRENZY_DURATION = 90; // effectively the rest of the fight (tuning)

const UNDERMOUNT_MAERIN_ID = 'runeseeker_maerin';
const UNDERMOUNT_MAERIN_ENTRY_OFFSET = 12; // fixed draw-free entry distance (tuning)
const UNDERMOUNT_MAERIN_LINE_DELAY = 2.6; // seconds between corpse yells (tuning)
const UNDERMOUNT_MAERIN_CHANNEL_SECONDS = 600; // persists as door-opening flavor (tuning)
const UNDERMOUNT_MAERIN_CHANNEL_ID = 'undermount_door_channel';

const UNDERMOUNT_MAERIN_LINES: Readonly<Record<string, readonly string[]>> = {
  undermount_wing1: [
    "This craftsmanship... a whole guild's work, for a cult of arsonists? Something down here is worth hiding behind all this.",
    'Beast provisions, wages, kennel feed... and the signature page torn out. Someone left in a hurry. North.',
    'They are not making anything. They are keeping something ASLEEP until they are ready.',
  ],
  undermount_wing2: [
    'These are not summoning wards. They are RESTRAINTS, and we have been CUTTING them. Every keeper we killed was a lock.',
    'There was never a factory. There was only ever him, and a very good disguise. Go.',
  ],
  undermount_wing3: [
    'Half-formed. We killed him before the forge could finish its work.',
    'The fire is receding north along the vein. This is not over.',
  ],
};

export interface UndermountWing {
  /** The DUNGEON_DEFS id for this wing's instance. */
  dungeonId: string;
  /** 1-based wing number, in descent order. */
  order: number;
  /** The bosses of this wing. The wing clears only when ALL of them are dead,
   *  so a duo (wing 1: Vosh + Saan) clears on the last keeper to die. */
  bossMobIds: readonly string[];
  /** The wing that must be cleared before this one's door opens; null for wing 1. */
  requires: string | null;
}

// Descent order. dungeonIds and bossMobIds are the stable content contract the
// DUNGEON_DEFS + MobTemplate records must match. Wing 1 is the Kiln-Keepers duo
// (Vosh + Saan); wings 2 and 3 are still single stub bosses pending their kits.
export const UNDERMOUNT_WINGS: readonly UndermountWing[] = [
  {
    dungeonId: 'undermount_wing1',
    order: 1,
    bossMobIds: ['vosh_the_glazier', 'saan_the_stoker'],
    requires: null,
  },
  {
    dungeonId: 'undermount_wing2',
    order: 2,
    bossMobIds: ['odrenn_the_temperer'],
    requires: 'undermount_wing1',
  },
  {
    dungeonId: 'undermount_wing3',
    order: 3,
    bossMobIds: ['volzharr_buried_furnace'],
    requires: 'undermount_wing2',
  },
] as const;

const WING_BY_DUNGEON = new Map(UNDERMOUNT_WINGS.map((w) => [w.dungeonId, w] as const));

/** The wing record for a dungeonId, or undefined if it is not an Undermount wing. */
export function undermountWing(dungeonId: string): UndermountWing | undefined {
  return WING_BY_DUNGEON.get(dungeonId);
}

/**
 * True when `dungeonId` is an Undermount wing whose prerequisite wing has not
 * been cleared. Non-Undermount dungeons and wing 1 (no prerequisite) are never
 * sealed. `cleared` is the set of wing dungeonIds whose boss the entering
 * raid/character has ever killed (permanent progress, not the daily lockout).
 */
export function undermountWingSealed(cleared: ReadonlySet<string>, dungeonId: string): boolean {
  const wing = WING_BY_DUNGEON.get(dungeonId);
  if (!wing || wing.requires === null) return false;
  return !cleared.has(wing.requires);
}

const WING_BY_BOSS = new Map(
  UNDERMOUNT_WINGS.flatMap((w) => w.bossMobIds.map((id) => [id, w] as const)),
);

/** The wing whose boss is `bossMobId`, or undefined if it is not an Undermount boss. */
export function undermountWingByBoss(bossMobId: string): UndermountWing | undefined {
  return WING_BY_BOSS.get(bossMobId);
}

// Whether every OTHER boss of `wing` is already down (dead or despawned) in the
// room around the just-slain `dying` boss. A live partner nearby means the
// encounter is not finished, so a duo does not clear on the first keeper's death.
function wingBossesAllDown(ctx: SimContext, wing: UndermountWing, dying: Entity): boolean {
  for (const id of wing.bossMobIds) {
    if (id === dying.templateId) continue;
    for (const ent of ctx.entities.values()) {
      if (
        ent.templateId === id &&
        !ent.dead &&
        dist2d(ent.pos, dying.spawnPos) <= UNDERMOUNT_ROOM_RADIUS
      ) {
        return false;
      }
    }
  }
  return true;
}

/** True when this boss death completes its Undermount wing. Single-boss wings
 *  complete immediately; the Kiln-Keepers complete only on the second death. */
export function undermountBossCompletesWing(ctx: SimContext, boss: Entity): boolean {
  const wing = WING_BY_BOSS.get(boss.templateId);
  return wing !== undefined && wingBossesAllDown(ctx, wing, boss);
}

// Frenzy the surviving keeper(s) of a duo when one of them dies: a stacking-free
// haste buff so killing the keepers far apart is a wipe. No-op for a single-boss
// wing or when no partner is still up in the room.
function frenzyUndermountPartners(ctx: SimContext, wing: UndermountWing, dying: Entity): void {
  if (wing.bossMobIds.length < 2) return;
  for (const ent of ctx.entities.values()) {
    if (ent.kind !== 'mob' || ent.dead || ent.id === dying.id) continue;
    if (!wing.bossMobIds.includes(ent.templateId)) continue;
    if (dist2d(ent.pos, dying.spawnPos) > UNDERMOUNT_ROOM_RADIUS) continue;
    if (ent.auras.some((a) => a.id === KEEPER_FRENZY_AURA_ID)) continue;
    const aura: Aura = {
      id: KEEPER_FRENZY_AURA_ID,
      name: 'Kiln Fury',
      kind: 'buff_haste',
      remaining: KEEPER_FRENZY_DURATION,
      duration: KEEPER_FRENZY_DURATION,
      value: KEEPER_FRENZY_HASTE,
      sourceId: ent.id,
      school: 'physical',
    };
    ent.auras.push(aura);
    ctx.emit({ type: 'aura', targetId: ent.id, name: 'Kiln Fury', gained: true });
  }
}

function findUndermountMaerin(ctx: SimContext, boss: Entity): Entity | null {
  for (const entity of ctx.entities.values()) {
    if (
      entity.templateId === UNDERMOUNT_MAERIN_ID &&
      !entity.dead &&
      dist2d(entity.spawnPos, boss.spawnPos) <= UNDERMOUNT_ROOM_RADIUS
    ) {
      return entity;
    }
  }
  return null;
}

function spawnUndermountMaerin(
  ctx: SimContext,
  boss: Entity,
  channelNextDoor: boolean,
): { maerin: Entity; spawned: boolean } | null {
  const existing = findUndermountMaerin(ctx, boss);
  if (existing) return { maerin: existing, spawned: false };
  const def = NPCS[UNDERMOUNT_MAERIN_ID];
  if (!def) return null;
  const entry = ctx.groundPos(boss.pos.x, boss.pos.z - UNDERMOUNT_MAERIN_ENTRY_OFFSET);
  const maerin = createNpc(ctx.nextId++, def, entry);
  maerin.level = boss.level;
  maerin.hostile = false;
  maerin.facing = 0;
  maerin.prevFacing = 0;
  maerin.spawnPos = { ...entry };
  ctx.addEntity(maerin);
  const instance = ctx.instances.find((claim) => claim.mobIds.includes(boss.id));
  instance?.mobIds.push(maerin.id);

  // One fixed, draw-free movement step gives the entry its walk-in direction
  // without adding a new tick system or changing shared rng order.
  ctx.moveToward(maerin, ctx.groundPos(boss.pos.x, boss.pos.z), maerin.moveSpeed);
  if (channelNextDoor) {
    maerin.castingAbility = UNDERMOUNT_MAERIN_CHANNEL_ID;
    maerin.castTotal = UNDERMOUNT_MAERIN_CHANNEL_SECONDS;
    maerin.castRemaining = UNDERMOUNT_MAERIN_CHANNEL_SECONDS;
    maerin.castTargetId = null;
    maerin.channeling = true;
    ctx.emit({
      type: 'spellfxAt',
      x: maerin.pos.x,
      z: maerin.pos.z,
      school: 'arcane',
      fx: 'nova',
    });
  }
  return { maerin, spawned: true };
}

function maerinYellEvent(maerin: Entity, text: string, pid: number): SimEvent {
  return {
    type: 'chat',
    fromPid: maerin.id,
    from: maerin.name,
    text,
    channel: 'yell',
    entityId: maerin.id,
    pid,
  };
}

function scheduleUndermountMaerinDialogue(
  ctx: SimContext,
  boss: Entity,
  maerin: Entity,
  lines: readonly string[],
): void {
  lines.forEach((text, index) => {
    for (const meta of ctx.players.values()) {
      const player = ctx.entities.get(meta.entityId);
      if (!player || dist2d(player.pos, boss.pos) > YELL_RANGE) continue;
      const event = maerinYellEvent(maerin, text, meta.entityId);
      if (index === 0) {
        ctx.emit(event);
      } else {
        ctx.delayedEvents.push({
          at: ctx.time + index * UNDERMOUNT_MAERIN_LINE_DELAY,
          event,
          guard: () => ctx.entities.get(maerin.id) === maerin && !maerin.dead,
        });
      }
    }
  });
}

function startUndermountMaerinBeat(ctx: SimContext, boss: Entity, wing: UndermountWing): void {
  const spawned = spawnUndermountMaerin(ctx, boss, wing.order < UNDERMOUNT_WINGS.length);
  if (!spawned?.spawned) return;
  scheduleUndermountMaerinDialogue(
    ctx,
    boss,
    spawned.maerin,
    UNDERMOUNT_MAERIN_LINES[wing.dungeonId] ?? [],
  );
}

/**
 * Undermount wing boss-death hook, fired for every wing-boss death:
 * 1. Frenzy any surviving duo partner (Kiln Fury), the kill-together tension.
 * 2. When the LAST boss of the wing is down, record the wing as cleared
 *    (permanent progress) on every player in the room, opening the sealed door
 *    to the next wing. Crediting is scoped by proximity to the boss's spawn,
 *    like grantNythraxisLockout.
 * No-ops for a non-wing-boss death; for a duo the clear waits for the last keeper.
 */
export function onUndermountBossDeath(ctx: SimContext, boss: Entity): void {
  const wing = WING_BY_BOSS.get(boss.templateId);
  if (!wing) return;
  frenzyUndermountPartners(ctx, wing, boss);
  if (!undermountBossCompletesWing(ctx, boss)) return;
  const instance = ctx.instances.find((claim) => claim.mobIds.includes(boss.id));
  const normalLockoutUntil =
    instance?.difficulty === 'normal' ? ctx.raidResetMs(ctx.lockoutNowMs()) : null;
  for (const meta of ctx.players.values()) {
    const p = ctx.entities.get(meta.entityId);
    if (p && dist2d(p.pos, boss.spawnPos) <= UNDERMOUNT_ROOM_RADIUS) {
      meta.undermountCleared.add(wing.dungeonId);
      if (normalLockoutUntil !== null) {
        meta.raidLockouts.set(wing.dungeonId, normalLockoutUntil);
      }
    }
  }
  startUndermountMaerinBeat(ctx, boss, wing);
}
