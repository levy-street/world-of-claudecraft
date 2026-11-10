// The "encounter in progress" lock (instances/encounter_lock.ts, opted in per
// dungeon by content/encounter_lock.ts): while a boss of a Smith's Heart claim
// is in its fight, nobody from outside enters it, living or released spirit
// (the Ignivar door's rule). A spirit is not set down inside and not revived;
// it waits outside, told why (throttled: the walk-in trigger fires at 20 Hz),
// until the fight ends (a wipe's reset or the kill), when the death checkpoints
// (tests/smith_heart_checkpoints.test.ts) apply as before, or until someone
// raises its body. Bodies already inside, trash fights and five-man dungeons
// keep today's rules; a lockout's refusal outranks this one.

import { beforeEach, describe, expect, it } from 'vitest';
import { handleDeath } from '../src/sim/combat/damage';
import { offerResurrection, respondToResurrection } from '../src/sim/combat/resurrection_offer';
import { ENCOUNTER_LOCK_BOSSES } from '../src/sim/content/encounter_lock';
import {
  SMITH_HEART_COUNCIL,
  SMITH_HEART_DUNGEON,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_GUARDIANS,
  SMITH_HEART_PACKS,
} from '../src/sim/content/smith_heart';
import { SMITH_HEART_CHECKPOINTS } from '../src/sim/content/smith_heart_checkpoints';
import { BUILTIN_WORLD, DUNGEONS, instanceOrigin } from '../src/sim/data';
import { spendHeatIntro } from '../src/sim/encounters/smith_heart';
import { clearDungeonGateStateForTest } from '../src/sim/instances/dungeon_gate_state';
import { enterDungeon, heroicLockoutId } from '../src/sim/instances/dungeons';
import {
  ENCOUNTER_IN_PROGRESS_TEXT,
  ENCOUNTER_LOCK_NOTICE_SECONDS,
  encounterInProgress,
} from '../src/sim/instances/encounter_lock';
import { type InstanceSlot, Sim } from '../src/sim/sim';
import { revivePlayerAt } from '../src/sim/spirit';
import type { Entity, SimEvent, WorldContent } from '../src/sim/types';
import { localizeSimText } from '../src/ui/sim_i18n';

const WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

beforeEach(() => clearDungeonGateStateForTest());

function setup(dungeonId = SMITH_HEART_DUNGEON) {
  const sim = new Sim({
    seed: 23,
    playerClass: 'warrior',
    noPlayer: true,
    world: WORLD,
    devCommands: true,
  });
  const pid = sim.addPlayer('warrior', 'Doorwalker');
  expect(enterDungeon(sim.ctx, dungeonId, pid)).toBe(true);
  const inst = sim.ctx.instances.find(
    (i) => i.dungeonId === dungeonId && i.partyKey !== null,
  ) as InstanceSlot;
  sim.tick();
  return { sim, pid, inst, player: sim.entities.get(pid) as Entity };
}

/** The claim's placed bodies of `templateId`, by spawn ordinal. */
function placed(sim: Sim, inst: InstanceSlot, pred: (i: number) => boolean): Entity[] {
  const out: Entity[] = [];
  DUNGEONS[inst.dungeonId].spawns.forEach((_, i) => {
    const e = sim.entities.get(inst.mobIds[i]);
    if (e && pred(i)) out.push(e);
  });
  return out;
}

function boss(sim: Sim, inst: InstanceSlot, templateId: string): Entity {
  const mob = placed(sim, inst, (i) => DUNGEONS[inst.dungeonId].spawns[i].mobId === templateId)[0];
  if (!mob) throw new Error(`Missing ${templateId}`);
  return mob;
}

/** Hold a body in its fight (pulled, chasing a target). */
function engage(mob: Entity) {
  mob.inCombat = true;
  mob.aiState = 'attack';
}

/** The fight's reset after a wipe (the coordinators' own reset). */
function reset(mob: Entity) {
  mob.inCombat = false;
  mob.aiState = 'idle';
}

function slay(sim: Sim, pid: number, mob: Entity) {
  if (!mob.dead) handleDeath(sim.ctx, mob, sim.entities.get(pid) ?? null);
}

/** Die where you stand (inside the claim) and release. */
function die(sim: Sim, pid: number) {
  const player = sim.entities.get(pid) as Entity;
  player.dead = true;
  sim.releaseSpirit(pid);
  expect(player.ghost).toBe(true);
}

function inClaim(sim: Sim, inst: InstanceSlot, e: Entity): boolean {
  return sim.ctx.instanceClaimIdAt(e.pos) === inst.exitId;
}

/** Walk out of the claim, alive. */
function stepOutside(sim: Sim, player: Entity) {
  player.pos = sim.ctx.groundPos(0, 0);
  player.prevPos = { ...player.pos };
  sim.ctx.rebucket(player);
}

function local(inst: InstanceSlot, e: Entity) {
  const o = instanceOrigin(DUNGEONS[inst.dungeonId].index, inst.slot);
  return { x: e.pos.x - o.x, z: e.pos.z - o.z };
}

function notices(events: SimEvent[]): number {
  return events.filter(
    (e) => e.type === 'error' && (e as { text: string }).text === ENCOUNTER_IN_PROGRESS_TEXT,
  ).length;
}

describe('the opt-in table', () => {
  it("opts the Smith's Heart in with every boss of its fights, and nothing else", () => {
    expect(Object.keys(ENCOUNTER_LOCK_BOSSES)).toEqual([SMITH_HEART_DUNGEON]);
    expect([...ENCOUNTER_LOCK_BOSSES[SMITH_HEART_DUNGEON]].sort()).toEqual(
      [
        ...SMITH_HEART_COUNCIL,
        SMITH_HEART_GUARDIANS.breath,
        SMITH_HEART_GUARDIANS.quench,
        SMITH_HEART_GUARDIANS.heat,
        SMITH_HEART_FINAL_BOSS,
      ].sort(),
    );
    // Every listed boss is a body the raid really places.
    const placedIds = new Set(DUNGEONS[SMITH_HEART_DUNGEON].spawns.map((s) => s.mobId));
    for (const id of ENCOUNTER_LOCK_BOSSES[SMITH_HEART_DUNGEON])
      expect(placedIds.has(id)).toBe(true);
  });

  it('registers the refusal with the client matcher', () => {
    expect(ENCOUNTER_IN_PROGRESS_TEXT).toBe(
      'An encounter is in progress. You cannot enter until it ends.',
    );
    expect(localizeSimText(ENCOUNTER_IN_PROGRESS_TEXT)).not.toBeNull();
  });
});

describe("the Smith's Heart: encounter in progress", () => {
  it.each([
    ...SMITH_HEART_COUNCIL,
    SMITH_HEART_GUARDIANS.breath,
    SMITH_HEART_GUARDIANS.quench,
    SMITH_HEART_GUARDIANS.heat,
    SMITH_HEART_FINAL_BOSS,
  ])('a spirit is held at the door while %s fights', (templateId) => {
    const { sim, pid, inst, player } = setup();
    die(sim, pid);
    const outside = { ...player.pos };
    const mob = boss(sim, inst, templateId);
    engage(mob);
    expect(encounterInProgress(sim.ctx, inst)).toBe(true);
    sim.drainEvents();
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(false);
    expect(player.dead).toBe(true);
    expect(player.ghost).toBe(true);
    expect(player.pos).toEqual(outside);
    expect(inClaim(sim, inst, player)).toBe(false);
    expect(notices(sim.drainEvents())).toBe(1);
  });

  it('tells the spirit once per window, however long it stands in the portal', () => {
    const { sim, pid, inst, player } = setup();
    die(sim, pid);
    const mob = boss(sim, inst, SMITH_HEART_GUARDIANS.breath);
    sim.drainEvents();
    const windowTicks = Math.round(ENCOUNTER_LOCK_NOTICE_SECONDS * 20);
    let seen = 0;
    // Inside one window: exactly one notice, however many tries.
    for (let i = 0; i < windowTicks - 10; i++) {
      engage(mob);
      expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(false);
      seen += notices(sim.drainEvents());
      sim.tick();
      seen += notices(sim.drainEvents());
    }
    expect(seen).toBe(1);
    // Past the window: one more.
    for (let i = 0; i < 20; i++) {
      engage(mob);
      expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(false);
      seen += notices(sim.drainEvents());
      sim.tick();
      seen += notices(sim.drainEvents());
    }
    expect(seen).toBe(2);
    expect(player.ghost).toBe(true);
  });

  it('a real pull holds the door every tick while the boss swings at a living raider', () => {
    const sim = new Sim({
      seed: 23,
      playerClass: 'warrior',
      noPlayer: true,
      world: WORLD,
      devCommands: true,
    });
    const pid = sim.addPlayer('warrior', 'Doorwalker');
    const tankId = sim.addPlayer('warrior', 'Stonewall');
    // A party walked in through the door together: one claim.
    sim.partyInvite(tankId, pid);
    sim.partyAccept(tankId);
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(true);
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, tankId)).toBe(true);
    const inst = sim.ctx.instances.find(
      (i) => i.dungeonId === SMITH_HEART_DUNGEON && i.partyKey !== null,
    ) as InstanceSlot;
    sim.tick();
    const player = sim.entities.get(pid) as Entity;
    const tank = sim.entities.get(tankId) as Entity;
    expect(inClaim(sim, inst, tank)).toBe(true);
    // Clear the way (the vein's packs hold its mouth shut), as a raid would.
    const packs: readonly string[] = Object.values(SMITH_HEART_PACKS).flat();
    for (const mob of placed(sim, inst, (i) =>
      packs.includes(DUNGEONS[SMITH_HEART_DUNGEON].spawns[i].packId ?? ''),
    ))
      slay(sim, pid, mob);
    sim.tick();
    const mob = boss(sim, inst, SMITH_HEART_GUARDIANS.heat);
    tank.pos = sim.ctx.groundPos(mob.pos.x + 2, mob.pos.z);
    tank.prevPos = { ...tank.pos };
    sim.ctx.rebucket(tank);
    // Since its entrance (heat_intro.ts) the guardian waits as cold coal,
    // held by the encounter, and a pull is undone until its scene has
    // played: spend it the way the dev pull does, so the fight is the
    // ordinary one this test reads the door through.
    spendHeatIntro(sim.ctx, mob);
    expect(sim.ctx.aggroMob(mob, tank, false)).toBe(true);
    // A raid-level tank: a level-1 body dies to one critical swing, and which
    // swing crits follows the claim's ids (the test reads the door).
    sim.setPlayerLevel(20, tankId);
    die(sim, pid);
    for (let i = 0; i < 100; i++) {
      tank.hp = tank.maxHp;
      sim.tick();
      expect(encounterInProgress(sim.ctx, inst), `tick ${i}`).toBe(true);
      expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(false);
    }
    expect(player.ghost).toBe(true);
    expect(inClaim(sim, inst, player)).toBe(false);
  });

  it('a dev bypass is held like anyone else', () => {
    const { sim, pid, inst, player } = setup();
    die(sim, pid);
    engage(boss(sim, inst, SMITH_HEART_FINAL_BOSS));
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid, true)).toBe(false);
    expect(player.ghost).toBe(true);
  });

  it('a preflight never spends the notice', () => {
    const { sim, pid, inst } = setup();
    die(sim, pid);
    engage(boss(sim, inst, SMITH_HEART_GUARDIANS.heat));
    sim.drainEvents();
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid, false, { preflightOnly: true })).toBe(
      false,
    );
    expect(notices(sim.drainEvents())).toBe(0);
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(false);
    expect(notices(sim.drainEvents())).toBe(1);
  });

  it('lets the spirit in once the wipe resets the fight (the entrance before any kill)', () => {
    const { sim, pid, inst, player } = setup();
    die(sim, pid);
    const mob = boss(sim, inst, SMITH_HEART_COUNCIL[1]);
    engage(mob);
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(false);
    reset(mob);
    expect(encounterInProgress(sim.ctx, inst)).toBe(false);
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(true);
    expect(player.dead).toBe(false);
    expect(player.ghost).toBe(false);
    const at = local(inst, player);
    expect(at.x).toBeCloseTo(DUNGEONS[SMITH_HEART_DUNGEON].entry.x, 6);
    expect(at.z).toBeCloseTo(DUNGEONS[SMITH_HEART_DUNGEON].entry.z, 6);
  });

  it('a boss walking home after a wipe no longer holds the door', () => {
    const { sim, pid, inst, player } = setup();
    die(sim, pid);
    const mob = boss(sim, inst, SMITH_HEART_GUARDIANS.quench);
    mob.inCombat = false;
    mob.aiState = 'evade';
    expect(encounterInProgress(sim.ctx, inst)).toBe(false);
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(true);
    expect(player.ghost).toBe(false);
  });

  it('lets the spirit in after the kill, and the checkpoints apply (the Quarry)', () => {
    const { sim, pid, inst, player } = setup();
    const hammerPacks: readonly string[] = SMITH_HEART_PACKS.hammer;
    for (const mob of placed(sim, inst, (i) =>
      hammerPacks.includes(DUNGEONS[SMITH_HEART_DUNGEON].spawns[i].packId ?? ''),
    ))
      slay(sim, pid, mob);
    const council = SMITH_HEART_COUNCIL.map((id) => boss(sim, inst, id));
    for (const mob of council) engage(mob);
    die(sim, pid);
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(false);
    // One down, the other still fighting: still held.
    expect(council.length).toBe(2);
    slay(sim, pid, council[0]);
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(false);
    slay(sim, pid, council[1]);
    sim.tick();
    expect(encounterInProgress(sim.ctx, inst)).toBe(false);
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(true);
    expect(player.ghost).toBe(false);
    const at = local(inst, player);
    expect(at.x).toBeCloseTo(SMITH_HEART_CHECKPOINTS.hammer.pos.x, 6);
    expect(at.z).toBeCloseTo(SMITH_HEART_CHECKPOINTS.hammer.pos.z, 6);
  });

  it('a trash fight never holds the door (the entrance, as today)', () => {
    const { sim, pid, inst, player } = setup();
    const trash = placed(
      sim,
      inst,
      (i) => DUNGEONS[SMITH_HEART_DUNGEON].spawns[i].packId === SMITH_HEART_PACKS.hammer[0],
    );
    expect(trash.length).toBeGreaterThan(0);
    die(sim, pid);
    for (const mob of trash) engage(mob);
    expect(encounterInProgress(sim.ctx, inst)).toBe(false);
    sim.drainEvents();
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(true);
    expect(notices(sim.drainEvents())).toBe(0);
    expect(player.ghost).toBe(false);
    const at = local(inst, player);
    expect(at.x).toBeCloseTo(DUNGEONS[SMITH_HEART_DUNGEON].entry.x, 6);
    expect(at.z).toBeCloseTo(DUNGEONS[SMITH_HEART_DUNGEON].entry.z, 6);
  });

  it('a living player from outside is held during the fight, then walks in after the wipe', () => {
    const { sim, pid, inst, player } = setup();
    const mob = boss(sim, inst, SMITH_HEART_FINAL_BOSS);
    engage(mob);
    stepOutside(sim, player);
    sim.drainEvents();
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(false);
    expect(notices(sim.drainEvents())).toBe(1);
    expect(inClaim(sim, inst, player)).toBe(false);
    reset(mob);
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(true);
    expect(inClaim(sim, inst, player)).toBe(true);
  });

  it('a living player from outside walks in after the kill', () => {
    const { sim, pid, inst, player } = setup();
    const mob = boss(sim, inst, SMITH_HEART_GUARDIANS.quench);
    engage(mob);
    stepOutside(sim, player);
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(false);
    slay(sim, pid, mob);
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(true);
    expect(inClaim(sim, inst, player)).toBe(true);
  });

  it("the Spirit Healer's revive outside does not get round it, and its first refusal speaks", () => {
    const { sim, pid, inst, player } = setup();
    die(sim, pid);
    engage(boss(sim, inst, SMITH_HEART_GUARDIANS.breath));
    sim.drainEvents();
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(false);
    expect(notices(sim.drainEvents())).toBe(1);
    // Revived outside inside the same notice window: a new life speaks afresh.
    revivePlayerAt(sim.ctx, pid, { ...player.pos });
    expect(player.dead).toBe(false);
    expect(player.encounterLockNoticeAt).toBeUndefined();
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(false);
    expect(notices(sim.drainEvents())).toBe(1);
    expect(inClaim(sim, inst, player)).toBe(false);
  });

  it('a new death inside the window speaks afresh too', () => {
    const { sim, pid, inst, player } = setup();
    const mob = boss(sim, inst, SMITH_HEART_GUARDIANS.heat);
    engage(mob);
    stepOutside(sim, player);
    sim.drainEvents();
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(false);
    expect(notices(sim.drainEvents())).toBe(1);
    die(sim, pid);
    expect(player.encounterLockNoticeAt).toBeUndefined();
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(false);
    expect(notices(sim.drainEvents())).toBe(1);
  });

  it('a lockout refusal outranks it', () => {
    const { sim, pid, inst, player } = setup();
    inst.difficulty = 'heroic';
    sim.players
      .get(pid)
      ?.raidLockouts.set(heroicLockoutId(SMITH_HEART_DUNGEON), Number.MAX_SAFE_INTEGER);
    engage(boss(sim, inst, SMITH_HEART_GUARDIANS.heat));
    stepOutside(sim, player);
    sim.drainEvents();
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(false);
    const events = sim.drainEvents();
    expect(notices(events)).toBe(0);
    expect(JSON.stringify(events)).toContain(
      `You are locked to Heroic ${DUNGEONS[SMITH_HEART_DUNGEON].name}.`,
    );
  });

  it('bodies already inside are untouched by the fight', () => {
    const { sim, pid, inst, player } = setup();
    engage(boss(sim, inst, SMITH_HEART_FINAL_BOSS));
    sim.drainEvents();
    // The lock never moves or tells a body inside, and a door call from inside
    // (moving within the claim) is not refused.
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(true);
    expect(notices(sim.drainEvents())).toBe(0);
    expect(inClaim(sim, inst, player)).toBe(true);
  });

  it('a party member raises the body during the fight, and the raised body is not barred', () => {
    const { sim, pid, inst, player } = setup();
    const corpseAt = { ...player.pos };
    die(sim, pid);
    engage(boss(sim, inst, SMITH_HEART_GUARDIANS.breath));
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(false);
    const healerId = sim.addPlayer('priest', 'Mender');
    const healer = sim.entities.get(healerId) as Entity;
    healer.pos = { ...corpseAt };
    healer.prevPos = { ...corpseAt };
    sim.ctx.rebucket(healer);
    expect(offerResurrection(sim.ctx, healer, player, 0.5, 30)).toBe(true);
    respondToResurrection(sim.ctx, true, pid);
    expect(player.dead).toBe(false);
    expect(player.ghost).toBe(false);
    expect(inClaim(sim, inst, player)).toBe(true);
    // Through the door path while the fight still runs: the raised body is
    // inside, so the lock lets it be.
    sim.drainEvents();
    expect(encounterInProgress(sim.ctx, inst)).toBe(true);
    expect(enterDungeon(sim.ctx, SMITH_HEART_DUNGEON, pid)).toBe(true);
    expect(notices(sim.drainEvents())).toBe(0);
    expect(inClaim(sim, inst, player)).toBe(true);
  });
});

describe('dungeons without the opt-in', () => {
  it('a five-man boss fight leaves the door as it was (the spirit rises at the entrance)', () => {
    const { sim, pid, inst, player } = setup('hollow_crypt');
    die(sim, pid);
    engage(boss(sim, inst, 'sexton_marrow'));
    expect(encounterInProgress(sim.ctx, inst)).toBe(false);
    sim.drainEvents();
    expect(enterDungeon(sim.ctx, 'hollow_crypt', pid)).toBe(true);
    expect(notices(sim.drainEvents())).toBe(0);
    expect(player.ghost).toBe(false);
    const at = local(inst, player);
    expect(at.x).toBeCloseTo(DUNGEONS.hollow_crypt.entry.x, 6);
    expect(at.z).toBeCloseTo(DUNGEONS.hollow_crypt.entry.z, 6);
  });
});
