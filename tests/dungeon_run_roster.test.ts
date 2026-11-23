// The dungeon run reads its boss rows from a claim's roster BY SPAWN INDEX
// (dungeonPlacedBossDead in src/sim/instances/dungeon_gates.ts): the first
// `spawns.length` ids of InstanceSlot.mobIds are the placed bodies, in spawn
// order, and everything an encounter summons is appended behind them. Several
// encounters later splice their summoned bodies back out of that list by id
// (dropEncounterBody, resetKorzul). If one of them ever spliced a PLACED body,
// every later index would shift and the tracker would tick the wrong boss, or
// the gates would open on the wrong kill.
//
// So this drives every boss of the five group dungeons through a real pull
// (its health walked down so phase mechanics fire), a real reset (the player
// leaves and the boss evades home) and its death, and then, with the dev
// triggers a playtest uses, the three splice paths a plain pull does not reach
// (the Gorgebloom's sprouts, the Saurian's rider, Morthen's candle bodies). The
// placed prefix of the roster must hold the whole way, and each case proves the
// tail really was summoned into or spliced, so the pin is not vacuously true.
import { describe, expect, it } from 'vitest';
import { DUNGEONS } from '../src/sim/data';
import { dungeonRunPlan } from '../src/sim/instances/dungeon_run';
import { claimedInstanceAt, enterDungeon, leaveDungeon } from '../src/sim/instances/dungeons';
import { type InstanceSlot, Sim } from '../src/sim/sim';
import type { DungeonDifficulty, Entity } from '../src/sim/types';

const GROUP_DUNGEONS = [
  'hollow_crypt',
  'sunken_bastion',
  'drowned_temple',
  'gravewyrm_sanctum',
  'wildheart_basin',
] as const;

const TICKS_PER_SECOND = 20;

function makeSim(seed = 23): Sim {
  const sim = new Sim({ seed, playerClass: 'warrior', autoEquip: false, devCommands: true });
  sim.chat('/dev level 20', sim.player.id);
  sim.chat('/dev god', sim.player.id);
  return sim;
}

function claim(sim: Sim): InstanceSlot {
  const inst = claimedInstanceAt(sim.ctx, sim.player.pos);
  if (!inst) throw new Error('the player stands in no claim');
  return inst;
}

interface Watch {
  /** The placed prefix as the claim was built. */
  readonly placed: readonly number[];
  /** The longest the summoned tail was seen, and whether it ever shrank. */
  maxTail: number;
  shrank: boolean;
  lastTail: number;
}

/** Start watching a fresh claim, after proving the premise: the roster opens
 *  with the placed bodies, one per spawn, in spawn order. */
function watchOf(sim: Sim, inst: InstanceSlot): Watch {
  const spawns = DUNGEONS[inst.dungeonId].spawns;
  const placed = inst.mobIds.slice(0, spawns.length);
  expect(placed).toHaveLength(spawns.length);
  spawns.forEach((spawn, i) => {
    expect(sim.ctx.entities.get(placed[i])?.templateId, `spawn ${i}`).toBe(spawn.mobId);
  });
  return { placed, maxTail: 0, shrank: false, lastTail: inst.mobIds.length - spawns.length };
}

/** The placed body of one template, read the way the run reads it: by index. */
function placedBody(sim: Sim, inst: InstanceSlot, mobId: string): Entity {
  const index = DUNGEONS[inst.dungeonId].spawns.findIndex((spawn) => spawn.mobId === mobId);
  const body = sim.ctx.entities.get(inst.mobIds[index]);
  if (!body || body.templateId !== mobId) throw new Error(`${mobId} is not at its spawn index`);
  return body;
}

/** Assert the placed prefix is untouched, and note what the tail is doing. */
function check(inst: InstanceSlot, watch: Watch, when: string): void {
  const spawns = DUNGEONS[inst.dungeonId].spawns;
  expect(inst.mobIds.slice(0, spawns.length), when).toEqual(watch.placed);
  const tail = inst.mobIds.length - spawns.length;
  if (tail < watch.lastTail) watch.shrank = true;
  if (tail > watch.maxTail) watch.maxTail = tail;
  watch.lastTail = tail;
}

function run(
  sim: Sim,
  inst: InstanceSlot,
  watch: Watch,
  seconds: number,
  when: string,
  each?: (second: number) => void,
): void {
  for (let second = 0; second < seconds; second++) {
    each?.(second);
    for (let i = 0; i < TICKS_PER_SECOND; i++) sim.tick();
    check(inst, watch, `${when}, second ${second + 1}`);
  }
}

/** Stand the player beside a mob and pull it. */
function pull(sim: Sim, mob: Entity): void {
  sim.player.pos.x = mob.pos.x + 3;
  sim.player.pos.y = mob.pos.y;
  sim.player.pos.z = mob.pos.z;
  sim.ctx.aggroMob(mob, sim.player, false);
}

/** Walk a boss's health down so health-gated phases fire during a pull. */
function wound(boss: Entity, second: number): void {
  if (boss.dead) return;
  const fraction = second === 3 ? 0.7 : second === 6 ? 0.45 : second === 9 ? 0.2 : 0;
  if (fraction > 0) boss.hp = Math.min(boss.hp, Math.ceil(boss.maxHp * fraction));
}

/** Every boss of one dungeon: pull, reset, kill, in route order. */
function everyBoss(dungeonId: string, difficulty: DungeonDifficulty): Watch {
  const sim = makeSim();
  sim.setDungeonDifficulty(difficulty, sim.player.id);
  expect(enterDungeon(sim.ctx, dungeonId, sim.player.id, true)).toBe(true);
  const inst = claim(sim);
  const spawns = DUNGEONS[dungeonId].spawns;
  const watch = watchOf(sim, inst);
  const plan = dungeonRunPlan(dungeonId, difficulty);
  if (!plan) throw new Error(`${dungeonId} has no run plan`);
  const rows = () => sim.dungeonRun?.bosses.map((boss) => boss.defeated);

  plan.forEach((row, rowIndex) => {
    const boss = placedBody(sim, inst, row.mobId);
    expect(boss.dead, `${row.mobId} alive before its pull`).toBe(false);

    // A real pull, its health walked down through the phase thresholds.
    pull(sim, boss);
    run(sim, inst, watch, 12, `${row.mobId} pull`, (second) => wound(boss, second));

    // A real reset: the player leaves, the boss evades home, the encounter
    // tears its summoned bodies down.
    expect(leaveDungeon(sim.ctx, sim.player.id), 'leave').toBe(true);
    run(sim, inst, watch, 3, `${row.mobId} reset`);
    expect(enterDungeon(sim.ctx, dungeonId, sim.player.id, true)).toBe(true);
    // The same claim, or the test proved nothing about its roster.
    expect(claim(sim), 're-entered the same claim').toBe(inst);
    expect(placedBody(sim, inst, row.mobId), `${row.mobId} is the same body`).toBe(boss);
    expect(rows()?.[rowIndex], `${row.mobId} row open before the kill`).toBe(false);

    if (row.finaleId) {
      // Morthen cannot be slain before his entrance; the playtest shortcut
      // lands and slays him, and the encounter then summons the finale.
      sim.chat('/dev crypt wyrm', sim.player.id);
      const finale = () =>
        inst.mobIds
          .slice(spawns.length)
          .map((id) => sim.ctx.entities.get(id))
          .find((e): e is Entity => e?.templateId === row.finaleId);
      for (let i = 0; i < 5 * TICKS_PER_SECOND && !finale(); i++) sim.tick();
      check(inst, watch, `${row.finaleId} summoned`);
      const body = finale();
      if (!body) throw new Error(`${row.finaleId} was never summoned`);
      expect(rows()?.[rowIndex], `${row.mobId} row open until the finale dies`).toBe(false);
      sim.ctx.handleDeath(body, sim.player);
    } else {
      // A boss of several bodies (the Mere Hydra) is down only when every one
      // of them is: the row stays open until the last falls.
      row.bodyIds.forEach((bodyId, n) => {
        expect(rows()?.[rowIndex], `${row.mobId} row open before body ${n + 1}`).toBe(false);
        sim.ctx.handleDeath(placedBody(sim, inst, bodyId), sim.player);
      });
    }
    // The tracker's read, which is what the stable prefix protects: this
    // boss, and only the bosses killed so far, read defeated.
    expect(rows(), `rows after ${row.mobId}`).toEqual(plan.map((_unused, i) => i <= rowIndex));
    check(inst, watch, `${row.mobId} on its death`);
    run(sim, inst, watch, 2, `${row.mobId} after its death`);
  });
  return watch;
}

/** The dungeons whose encounters splice the roster on a plain reset or kill:
 *  the Turnkey's cage and Ossick's anchor, Korgath's shackles and Velkhar's
 *  walkers all leave it by id. The other three splice only on the mechanics
 *  staged in the second block. */
const SPLICES_ON_A_PLAIN_PULL: ReadonlySet<string> = new Set([
  'sunken_bastion',
  'gravewyrm_sanctum',
]);

describe('claim roster: every boss pulled, reset and killed', () => {
  it.each(GROUP_DUNGEONS)(
    '%s: no pull, reset or boss death moves a placed body',
    (dungeonId) => {
      const watch = everyBoss(dungeonId, 'normal');
      // Not vacuous: every one of these dungeons summons into the tail, and
      // two of them splice it again without any staging.
      expect(watch.maxTail, 'an encounter summoned into the tail').toBeGreaterThan(0);
      if (SPLICES_ON_A_PLAIN_PULL.has(dungeonId)) {
        expect(watch.shrank, 'a summoned body was spliced back out').toBe(true);
      }
    },
    180_000,
  );
});

describe.each(['normal', 'heroic'] as const)(
  'claim roster on %s: the splices a plain pull does not reach',
  (difficulty: DungeonDifficulty) => {
    function staged(dungeonId: string) {
      const sim = makeSim();
      sim.setDungeonDifficulty(difficulty, sim.player.id);
      expect(enterDungeon(sim.ctx, dungeonId, sim.player.id, true)).toBe(true);
      const inst = claim(sim);
      const watch = watchOf(sim, inst);
      const spawns = DUNGEONS[dungeonId].spawns;
      /** How many bodies of one template sit in the summoned tail. */
      const tailCount = (templateId: string) =>
        inst.mobIds
          .slice(spawns.length)
          .filter((id) => sim.ctx.entities.get(id)?.templateId === templateId).length;
      const dev = (command: string) => sim.chat(command, sim.player.id);
      const placedAs = (templateId: string) => spawns.some((s) => s.mobId === templateId);
      return { sim, inst, watch, tailCount, dev, placedAs };
    }

    it('the Thorn Sprouts of the Gorgebloom wither out of the roster with the pull', () => {
      const r = staged('wildheart_basin');
      // The premise: no Thorn Sprout is a placed body.
      expect(r.placedAs('thorn_sprout')).toBe(false);
      pull(r.sim, placedBody(r.sim, r.inst, 'the_gorgebloom'));
      run(r.sim, r.inst, r.watch, 2, 'gorgebloom pull');
      // Seeds burrow, and the pods they grow into burst as sprouts.
      r.dev('/dev wildheart trigger seeds');
      run(r.sim, r.inst, r.watch, 12, 'seeds');
      r.dev('/dev wildheart trigger pods');
      run(r.sim, r.inst, r.watch, 6, 'pods');
      expect(r.tailCount('thorn_sprout'), 'sprouts rose').toBeGreaterThan(0);
      expect(leaveDungeon(r.sim.ctx, r.sim.player.id)).toBe(true);
      run(r.sim, r.inst, r.watch, 8, 'gorgebloom reset');
      expect(r.tailCount('thorn_sprout'), 'sprouts withered out of the roster').toBe(0);
      expect(r.watch.shrank).toBe(true);
    }, 120_000);

    it('the idle rider of the Saurian climbs out of the roster after the pull', () => {
      const r = staged('wildheart_basin');
      // The rider is howdah_hexcaller; the placed trash is wildheart_hexcaller.
      expect(r.placedAs('howdah_hexcaller')).toBe(false);
      expect(r.placedAs('wildheart_hexcaller')).toBe(true);
      pull(r.sim, placedBody(r.sim, r.inst, 'great_saurian'));
      run(r.sim, r.inst, r.watch, 2, 'saurian pull');
      r.dev('/dev wildheart trigger howdah');
      run(r.sim, r.inst, r.watch, 6, 'howdah');
      expect(r.tailCount('howdah_hexcaller'), 'the rider dismounted').toBe(1);
      expect(leaveDungeon(r.sim.ctx, r.sim.player.id)).toBe(true);
      run(r.sim, r.inst, r.watch, 10, 'saurian reset');
      expect(r.tailCount('howdah_hexcaller'), 'the rider left the roster').toBe(0);
      expect(r.watch.shrank).toBe(true);
    }, 120_000);

    it('the candle bodies of Morthen leave the roster one by one, and all at a reset', () => {
      const r = staged('hollow_crypt');
      expect(r.placedAs('crypt_remembrance_candle')).toBe(false);
      r.dev('/dev crypt pull morthen');
      run(r.sim, r.inst, r.watch, 3, 'morthen pull');
      r.dev('/dev crypt trigger rite');
      run(r.sim, r.inst, r.watch, 2, 'rite');
      const candles = r.tailCount('crypt_remembrance_candle');
      expect(candles, 'the Rite stood its candle bodies up').toBeGreaterThan(1);
      // Relighting a candle splices its body out from the MIDDLE of the tail.
      r.dev('/dev crypt trigger candle');
      run(r.sim, r.inst, r.watch, 1, 'first candle relit');
      expect(r.tailCount('crypt_remembrance_candle')).toBe(candles - 1);
      expect(leaveDungeon(r.sim.ctx, r.sim.player.id)).toBe(true);
      run(r.sim, r.inst, r.watch, 6, 'morthen reset');
      expect(r.tailCount('crypt_remembrance_candle'), 'the reset cleared the rest').toBe(0);
      expect(r.watch.shrank).toBe(true);
    }, 120_000);
  },
);
