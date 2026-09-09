// The instance combat hold (src/sim/instances/instance_combat_hold.ts): inside a
// claimed instance slot (a dungeon, or one raid room) a mob never sheds an
// attacker by distance. Its hate table is slot-scoped, the soft leash never
// fires, and a mob that cannot reach its target holds in place immune and
// aggro'd instead of evading home. Regression: a kited chain pull in the
// Wildheart Basin shed its adds through the 70 yd dungeon leash and the
// unreachable stall, and the pull was being farmed.
import { describe, expect, it } from 'vitest';
import { collectEngagedPids } from '../src/sim/combat/engaged_combat';
import {
  BUILTIN_WORLD,
  DUNGEON_LIST,
  DUNGEONS,
  dungeonAt,
  INSTANCE_SLOT_COUNT,
  instanceOrigin,
  instanceSlotForZ,
  MOBS,
} from '../src/sim/data';
import {
  IGNIVAR_APPROACH_GUARDIAN_IDS,
  IGNIVAR_CRUCIBLE_WARDEN_ID,
  IGNIVAR_EMBER_SENTINEL_ID,
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_LIFT_ROOM_ID,
  IGNIVAR_RAID_ARENA_ID,
} from '../src/sim/ignivar_raid_ids';
import {
  claimedInstanceAt,
  enterDungeon,
  instanceClaimHolds,
  instanceOriginOf,
} from '../src/sim/instances/dungeons';
import {
  attackerLeftInstance,
  claimedSlotOf,
  holdsAggroInInstance,
  isPinnedInPlace,
  PIN_PHASE_SECONDS,
  pinInPlace,
  releasePin,
} from '../src/sim/instances/instance_combat_hold';
import { onChaseStalled } from '../src/sim/mob/combat_profile';
import { respawnMob } from '../src/sim/mob/lifecycle';
import { resetEvadingMob } from '../src/sim/mob/locomotion';
import { type InstanceSlot, Sim } from '../src/sim/sim';
import { THREAT_DROP_RANGE } from '../src/sim/threat';
import { DUNGEON_LEASH_DISTANCE, dist2d, type Entity, type WorldContent } from '../src/sim/types';
import { expectDefined } from './helpers/defined';

const TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

const LINGER_TICKS = 20 * 5;

function makeSim(seed = 91, devCommands = false): Sim {
  return new Sim({ seed, playerClass: 'warrior', noPlayer: true, world: TEST_WORLD, devCommands });
}

interface Claimed {
  sim: Sim;
  instance: InstanceSlot;
  pid: number;
  player: Entity;
  mobs: Entity[];
}

function claim(dungeonId: string, sim = makeSim()): Claimed {
  const pid = sim.addPlayer('warrior', 'Alpha');
  sim.setPlayerLevel(30, pid);
  expect(enterDungeon(sim.ctx, dungeonId, pid)).toBe(true);
  const instance = sim.instances.find((c) => c.dungeonId === dungeonId && c.partyKey !== null);
  if (!instance) throw new Error(`${dungeonId} instance was not claimed`);
  const player = expectDefined(sim.entities.get(pid));
  // An immortal puller: the point is where the mobs go, not whether he survives.
  player.devGod = true;
  const mobs = instance.mobIds
    .map((id) => sim.entities.get(id))
    .filter((e): e is Entity => !!e && e.kind === 'mob' && !e.dead);
  return { sim, instance, pid, player, mobs };
}

function place(sim: Sim, e: Entity, x: number, z: number): void {
  e.pos = sim.ctx.groundPos(x, z);
  e.prevPos = { ...e.pos };
  sim.ctx.rebucket(e);
}

function hit(sim: Sim, source: Entity, target: Entity, amount: number): void {
  sim.dealDamage(source, target, amount, false, 'physical', null, 'hit', true);
}

// A spot inside the slot's claim footprint (|dz| < 250 of the origin) that is
// `distance` yards from `from` along z, whichever side has the room.
function insideSlotAwayFrom(
  inst: InstanceSlot,
  from: Entity,
  distance: number,
): { x: number; z: number } {
  const origin = instanceOriginOf(inst);
  const north = from.pos.z + distance;
  const z = Math.abs(north - origin.z) < 240 ? north : from.pos.z - distance;
  return { x: from.pos.x, z };
}

// Walk the Ignivar chain to the forge approach via the dev arm and hand back one
// living trash mob of the given template with an immortal level-30 raider.
function approachTrash(templateId: string): { sim: Sim; player: Entity; mob: Entity } {
  const sim = makeSim(91, true);
  const pid = sim.addPlayer('warrior', 'Raider');
  sim.setPlayerLevel(30, pid);
  for (const roomId of [IGNIVAR_LIFT_ROOM_ID, IGNIVAR_FORGE_APPROACH_ID]) {
    if (!enterDungeon(sim.ctx, roomId, pid, true)) throw new Error(`${roomId} entry failed`);
  }
  const approach = expectDefined(
    sim.instances.find((c) => c.dungeonId === IGNIVAR_FORGE_APPROACH_ID && c.partyKey !== null),
  );
  const player = expectDefined(sim.entities.get(pid));
  player.devGod = true;
  const mob = expectDefined(
    approach.mobIds
      .map((id) => sim.entities.get(id))
      .find((m): m is Entity => !!m && !m.dead && m.templateId === templateId),
  );
  return { sim, player, mob };
}

function engage(sim: Sim, player: Entity, mob: Entity): void {
  mob.maxHp = 50_000;
  mob.hp = 50_000;
  place(sim, player, mob.pos.x + 2, mob.pos.z);
  hit(sim, player, mob, 100);
  sim.tick();
  expect(mob.aggroTargetId).toBe(player.id);
  expect(mob.inCombat).toBe(true);
}

describe('instance combat hold: hate tables are slot-scoped, never distance-scoped', () => {
  it('keeps an attacker who runs past the leash and the reach inside the slot', () => {
    const { sim, instance, player, mobs } = claim('wildheart_basin');
    const mob = expectDefined(mobs.find((m) => !MOBS[m.templateId]?.boss));
    engage(sim, player, mob);
    const far = insideSlotAwayFrom(instance, mob, THREAT_DROP_RANGE + 40);
    place(sim, player, far.x, far.z);
    expect(claimedSlotOf(sim.ctx, player)).toBe(claimedSlotOf(sim.ctx, mob));

    for (let i = 0; i < 20 * 12; i++) sim.tick();
    expect(mob.aiState).not.toBe('evade');
    expect(mob.threat.has(player.id)).toBe(true);
    expect(mob.aggroTargetId).toBe(player.id);
    expect(player.inCombat).toBe(true);
    // It followed well past the old dungeon leash instead of going home.
    expect(dist2d(mob.pos, mob.spawnPos)).toBeGreaterThan(DUNGEON_LEASH_DISTANCE);
  });

  it('drops the attacker on the tick they are outside the slot, then goes home', () => {
    const { sim, instance, player, mobs } = claim('wildheart_basin');
    const mob = expectDefined(mobs.find((m) => !MOBS[m.templateId]?.boss));
    engage(sim, player, mob);
    const origin = instanceOriginOf(instance);
    // Just past the footprint's x half-width: still 500 yd from any other slot.
    place(sim, player, origin.x + 130, mob.pos.z);
    expect(claimedSlotOf(sim.ctx, player)).toBeNull();
    sim.tick();
    expect(mob.threat.has(player.id)).toBe(false);
    for (let i = 0; i < 20 * 5 && mob.aiState !== 'evade' && mob.inCombat; i++) sim.tick();
    expect(mob.threat.size).toBe(0);
    player.combatTimer = 99;
    for (let i = 0; i < LINGER_TICKS + 1; i++) sim.tick();
    expect(player.inCombat).toBe(false);
  });

  it('holds a party member anywhere in the room for an instance boss, and nobody outside it', () => {
    const { sim, instance, pid, player, mobs } = claim('hollow_crypt');
    const boss = expectDefined(mobs.find((m) => MOBS[m.templateId]?.boss));
    const passivePid = sim.addPlayer('priest', 'Passive');
    sim.setPlayerLevel(30, passivePid);
    sim.partyInvite(passivePid, pid);
    sim.partyAccept(passivePid);
    const passive = expectDefined(sim.entities.get(passivePid));
    engage(sim, player, boss);

    const farInside = insideSlotAwayFrom(instance, boss, THREAT_DROP_RANGE + 60);
    place(sim, passive, farInside.x, farInside.z);
    sim.tick();
    expect(passive.inCombat).toBe(true);

    const origin = instanceOriginOf(instance);
    place(sim, passive, origin.x + 130, boss.pos.z);
    passive.combatTimer = 99;
    sim.tick();
    expect(passive.inCombat).toBe(false);
  });

  it('a raider who crosses to another room is dropped by the room they left', () => {
    const sim = makeSim(91, true);
    const pid = sim.addPlayer('warrior', 'Raider');
    sim.setPlayerLevel(30, pid);
    for (const roomId of [IGNIVAR_LIFT_ROOM_ID, IGNIVAR_FORGE_APPROACH_ID]) {
      if (!enterDungeon(sim.ctx, roomId, pid, true)) throw new Error(`${roomId} entry failed`);
    }
    const approach = expectDefined(
      sim.instances.find((c) => c.dungeonId === IGNIVAR_FORGE_APPROACH_ID && c.partyKey !== null),
    );
    const player = expectDefined(sim.entities.get(pid));
    player.devGod = true;
    const guardian = expectDefined(
      approach.mobIds
        .map((id) => sim.entities.get(id))
        .find(
          (m): m is Entity =>
            !!m &&
            !m.dead &&
            (IGNIVAR_APPROACH_GUARDIAN_IDS as readonly string[]).includes(m.templateId),
        ),
    );
    engage(sim, player, guardian);
    expect(guardian.threat.has(pid)).toBe(true);

    expect(enterDungeon(sim.ctx, IGNIVAR_RAID_ARENA_ID, pid, true)).toBe(true);
    expect(attackerLeftInstance(expectDefined(claimedSlotOf(sim.ctx, guardian)), player)).toBe(
      true,
    );
    sim.tick();
    expect(guardian.threat.has(pid)).toBe(false);
    expect(guardian.aggroTargetId).not.toBe(pid);
    player.combatTimer = 99;
    for (let i = 0; i < LINGER_TICKS + 1; i++) sim.tick();
    expect(player.inCombat).toBe(false);
  });
});

describe('instance combat hold: an out-of-reach mob holds in place instead of resetting', () => {
  it('a tethered Ignivar warden dragged past its tether keeps chasing instead of resetting', () => {
    // The approach trash carries hardLeashRadius 18; inside the slot the tether
    // never sends it home, so a kiter cannot reset a pack by dragging it.
    const { sim, player, mob: warden } = approachTrash(IGNIVAR_CRUCIBLE_WARDEN_ID);
    const tether = expectDefined(MOBS[warden.templateId]?.hardLeashRadius);
    engage(sim, player, warden);
    place(sim, player, warden.spawnPos.x, warden.spawnPos.z + tether + 30);
    expect(claimedSlotOf(sim.ctx, player)).toBe(claimedSlotOf(sim.ctx, warden));
    for (let i = 0; i < 20 * 15 && dist2d(warden.pos, player.pos) > 12; i++) sim.tick();
    expect(warden.aiState).not.toBe('evade');
    expect(dist2d(warden.pos, warden.spawnPos)).toBeGreaterThan(tether);
    expect(warden.threat.has(player.id)).toBe(true);
    expect(warden.aggroTargetId).toBe(player.id);
    expect(isPinnedInPlace(warden)).toBe(false);
  });

  it('a pinned sentinel fires no Cinder Lance and takes no damage until released', () => {
    const { sim, player, mob: sentinel } = approachTrash(IGNIVAR_EMBER_SENTINEL_ID);
    engage(sim, player, sentinel);
    player.devGod = false;
    player.hp = player.maxHp;
    // Out of the sentinel's reach but well inside its lance range.
    place(sim, player, sentinel.pos.x + 15, sentinel.pos.z);
    pinInPlace(sentinel);
    const hp = player.hp;
    for (let i = 0; i < 20 * 8; i++) {
      // Re-pin each tick the way a live geometry stall would keep it pinned,
      // without moving anyone: the clock must not reach the phase grace here.
      if (!isPinnedInPlace(sentinel)) pinInPlace(sentinel);
      sim.tick();
      expect(player.hp, `tick ${i}`).toBe(hp);
      expect(sentinel.castingAbility, `tick ${i}`).toBeNull();
    }
    expect(sentinel.threat.has(player.id)).toBe(true);
    // (Open ground released the artificial pin inside the last tick, as it
    // should; re-pin to probe the immunity itself.)
    pinInPlace(sentinel);
    const mobHp = sentinel.hp;
    hit(sim, player, sentinel, 400);
    expect(sentinel.hp).toBe(mobHp);
    releasePin(sentinel);
    hit(sim, player, sentinel, 400);
    expect(sentinel.hp).toBe(mobHp - 400);
  });

  it('a pinned mob phases toward its target once the grace runs out, then fights', () => {
    const { sim, player, mobs } = claim('wildheart_basin');
    const mob = expectDefined(mobs.find((m) => !MOBS[m.templateId]?.boss));
    const reach = MOBS[mob.templateId]?.petSpell?.range ?? 6;
    engage(sim, player, mob);
    place(sim, player, mob.pos.x, mob.pos.z + reach + 40);
    pinInPlace(mob);
    mob.evadeInPlace = PIN_PHASE_SECONDS;
    const start = dist2d(mob.pos, player.pos);
    sim.tick();
    // Still pinned while it phases (every tick is a step toward the target), but
    // no longer immune: a mob making progress can be hit on its way in.
    expect(dist2d(mob.pos, player.pos)).toBeLessThan(start);
    expect(isPinnedInPlace(mob)).toBe(true);
    const hpPhasing = mob.hp;
    hit(sim, player, mob, 300);
    expect(mob.hp).toBe(hpPhasing - 300);
    // It arrives in reach and drops the pin.
    for (let i = 0; i < 20 * 15 && isPinnedInPlace(mob); i++) sim.tick();
    expect(isPinnedInPlace(mob)).toBe(false);
    expect(dist2d(mob.pos, player.pos)).toBeLessThanOrEqual(reach + 1);
    expect(mob.threat.has(player.id)).toBe(true);
  });

  it('is immune only while stuck: the grace runs out and the immunity with it', () => {
    const { sim, player, mobs } = claim('wildheart_basin');
    const mob = expectDefined(mobs.find((m) => !MOBS[m.templateId]?.boss));
    engage(sim, player, mob);
    pinInPlace(mob);
    const hp = mob.hp;
    hit(sim, player, mob, 300);
    expect(mob.hp).toBe(hp);
    mob.evadeInPlace = PIN_PHASE_SECONDS;
    hit(sim, player, mob, 300);
    expect(mob.hp).toBe(hp - 300);
    releasePin(mob);
    expect(mob.evadeInPlace).toBeUndefined();
    expect('evadeInPlace' in mob).toBe(true);
  });

  it('every pull reset releases the pin', () => {
    const { sim, player, mobs } = claim('wildheart_basin');
    const mob = expectDefined(mobs.find((m) => !MOBS[m.templateId]?.boss));
    engage(sim, player, mob);

    pinInPlace(mob);
    onChaseStalled(mob, false); // the open-world evade home
    expect(isPinnedInPlace(mob)).toBe(false);

    pinInPlace(mob);
    mob.aiState = 'evade';
    mob.pos = { ...mob.spawnPos };
    resetEvadingMob(sim.ctx, mob);
    expect(isPinnedInPlace(mob)).toBe(false);

    pinInPlace(mob);
    respawnMob(sim.ctx, mob);
    expect(isPinnedInPlace(mob)).toBe(false);

    // Losing the target (the attacker left the slot) drops the pin on the next
    // engaged tick, so nothing ever resumes a fight in the immune stance.
    engage(sim, player, mob);
    pinInPlace(mob);
    mob.aggroTargetId = null;
    sim.tick();
    expect(isPinnedInPlace(mob)).toBe(false);
  });

  it('the stall verdict pins inside an instance and evades home outside it', () => {
    const { sim, player, mobs } = claim('wildheart_basin');
    const mob = expectDefined(mobs.find((m) => !MOBS[m.templateId]?.boss));
    engage(sim, player, mob);
    onChaseStalled(mob, holdsAggroInInstance(sim.ctx, mob));
    expect(isPinnedInPlace(mob)).toBe(true);
    expect(mob.aiState).not.toBe('evade');
    expect(mob.threat.has(player.id)).toBe(true);

    releasePin(mob);
    onChaseStalled(mob, false);
    expect(mob.aiState).toBe('evade');
    expect(mob.threat.size).toBe(0);
    expect(isPinnedInPlace(mob)).toBe(false);
  });

  it('a pinned mob still holds its attacker in combat and stays killable once released', () => {
    const { sim, player, mobs } = claim('wildheart_basin');
    const mob = expectDefined(mobs.find((m) => !MOBS[m.templateId]?.boss));
    engage(sim, player, mob);
    pinInPlace(mob);
    const out = new Set<number>();
    collectEngagedPids(sim.ctx, out);
    expect(out.has(player.id)).toBe(true);
    const hp = mob.hp;
    hit(sim, player, mob, 300);
    expect(mob.hp).toBe(hp);
    releasePin(mob);
    hit(sim, player, mob, 300);
    expect(mob.hp).toBe(hp - 300);
  });

  it('is an open-world no-op: outside any slot the reach and the evade rules stand', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Roamer');
    const player = expectDefined(sim.entities.get(pid));
    expect(holdsAggroInInstance(sim.ctx, player)).toBe(false);
    expect(claimedSlotOf(sim.ctx, player)).toBeNull();
  });
});

describe('instance combat hold: content sanity', () => {
  it('addresses every slot record directly: x band, z band, and pool order agree', () => {
    // claimedInstanceAt reads ctx.instances[position * INSTANCE_SLOT_COUNT + slot]
    // and fails CLOSED on any disagreement, which would silently switch the hold
    // off. Pin the three agreements it rests on for every dungeon and slot: the
    // Sim builds the pool in DUNGEON_LIST order with INSTANCE_SLOT_COUNT records
    // per dungeon, dungeonAt names the dungeon from its origin x (contiguous and
    // overflow bands alike), and instanceSlotForZ inverts instanceOrigin's z term.
    const sim = makeSim();
    expect(sim.instances.length).toBe(DUNGEON_LIST.length * INSTANCE_SLOT_COUNT);
    DUNGEON_LIST.forEach((dungeon, position) => {
      for (let slot = 0; slot < INSTANCE_SLOT_COUNT; slot++) {
        const origin = instanceOrigin(dungeon.index, slot);
        const tag = `${dungeon.id} slot ${slot}`;
        expect(dungeonAt(origin.x)?.id, tag).toBe(dungeon.id);
        expect(instanceSlotForZ(origin.z), tag).toBe(slot);
        const record = sim.instances[position * INSTANCE_SLOT_COUNT + slot];
        expect(record?.dungeonId, tag).toBe(dungeon.id);
        expect(record?.slot, tag).toBe(slot);
      }
    });
  });

  it('resolves a claimed slot from a spawn inside it and nothing from an unclaimed one', () => {
    const { sim, instance, mobs } = claim('wildheart_basin');
    const mob = expectDefined(mobs[0]);
    expect(claimedInstanceAt(sim.ctx, mob.pos)).toBe(instance);
    // The same dungeon's next slot is unclaimed: its origin resolves to nothing.
    const nextSlot = (instance.slot + 1) % INSTANCE_SLOT_COUNT;
    const origin = instanceOrigin(expectDefined(DUNGEONS.wildheart_basin).index, nextSlot);
    expect(claimedInstanceAt(sim.ctx, { x: origin.x, y: 0, z: origin.z })).toBeNull();
  });

  it('every dungeon and raid room keeps its spawns inside the claim footprint the hold reads', () => {
    // A spawn outside the footprint would read as "left the slot" and shed the
    // pull at that dungeon's own far end.
    const sim = makeSim();
    for (const dungeon of Object.values(DUNGEONS)) {
      const probe = { dungeonId: dungeon.id, slot: 0 } as InstanceSlot;
      const origin = instanceOriginOf(probe);
      for (const spawn of dungeon.spawns) {
        const pos = { x: origin.x + spawn.x, y: 0, z: origin.z + spawn.z };
        expect(instanceClaimHolds(probe, pos), `${dungeon.id} ${spawn.mobId}`).toBe(true);
      }
      expect(sim.instances.length).toBeGreaterThan(0);
    }
  });
});
