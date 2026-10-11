// The reworked Wildheart Basin as a live dungeon (docs/design/dungeon-rework/
// wildheart_basin.md sections 3 and 12): the record on the authored field, the
// gates and seals as live claim state (opening on the right deaths, sealing
// while a boss is engaged), the premature Zulgar pull that wakes the whole
// basin, the three placeholder bosses in their finished arenas, and the
// /dev wildheart jumps and triggers.

import { describe, expect, it } from 'vitest';
import {
  HEROIC_DUNGEON_TUNING,
  NORMAL_DUNGEON_TUNING,
} from '../src/sim/content/dungeon_difficulty';
import { WILDHEART_BASIN_BOSSES, WILDHEART_BASIN_GATES } from '../src/sim/content/wildheart';
import {
  BEAST_PITS,
  GORGEBLOOM_DAIS,
  SHRINE_TERRACE,
  WILDHEART_HEIGHTS,
} from '../src/sim/content/wildheart_basin_layout';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import {
  handleWildheartBasinDevChat,
  WILDHEART_DEV_AREAS,
} from '../src/sim/dev/wildheart_basin_dev';
import { WILDHEART_DEV_TRIGGERS, wildheartDevTrigger } from '../src/sim/encounters/wildheart_basin';
import { authoredFieldFor } from '../src/sim/instances/authored_field';
import { dungeonGateStateOf } from '../src/sim/instances/dungeon_gates';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { Sim } from '../src/sim/sim';
import { DT, type Entity } from '../src/sim/types';

const ID = 'wildheart_basin';

/** Run a `/dev wildheart` line straight through its handler (the chat token
 *  bucket would throttle a burst of test commands). */
function dev(sim: Sim, me: Entity, rest: string): void {
  handleWildheartBasinDevChat(sim.ctx, `/dev wildheart ${rest}`, me.id);
}

function enter(difficulty: 'normal' | 'heroic' = 'normal') {
  const sim = new Sim({ seed: 11, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const me = sim.player;
  sim.chat('/dev level 20', me.id);
  dev(sim, me, `enter ${difficulty}`);
  const inst = claimedInstanceAt(sim.ctx, me.pos);
  if (!inst) throw new Error('no wildheart claim');
  return { sim, me, inst };
}

function rosterOf(sim: Sim, inst: { mobIds: number[] }, templateId: string): Entity {
  for (const id of inst.mobIds) {
    const e = sim.ctx.entities.get(id);
    if (e?.templateId === templateId) return e;
  }
  throw new Error(`no ${templateId}`);
}

function gateState(
  sim: Sim,
  inst: { objectIds: number[]; slot: number },
  gateId: string,
): string | null {
  const gate = WILDHEART_BASIN_GATES.find((g) => g.id === gateId);
  if (!gate) throw new Error(gateId);
  const o = instanceOrigin(DUNGEONS[ID].index, inst.slot);
  for (const id of inst.objectIds) {
    const e = sim.ctx.entities.get(id);
    if (!e) continue;
    if (Math.abs(e.pos.x - o.x - gate.x) < 0.75 && Math.abs(e.pos.z - o.z - gate.z) < 0.75)
      return dungeonGateStateOf(e.templateId);
  }
  return null;
}

function tick(sim: Sim, seconds: number): void {
  for (let t = 0; t < seconds - DT * 0.5; t += DT) sim.tick();
}

describe('the reworked Wildheart Basin record', () => {
  it('keeps its id, door, index and interior key, now served by the authored field', () => {
    const d = DUNGEONS[ID];
    expect(d.name).toBe('The Wildheart Basin');
    expect(d.index).toBe(7);
    expect(d.doorPos).toEqual({ x: -232, z: 1112 });
    expect(d.interior).toBe('wildheart');
    expect(authoredFieldFor('wildheart')?.key).toBe('wildheart');
    expect(d.bossChainPull).toBe(true);
    expect(d.gates?.length).toBe(7);
    expect(new Set(d.gates?.map((g) => g.kind))).toEqual(
      new Set(['vine_bridge', 'thorn_wall', 'warded_arch', 'rite_ward']),
    );
  });

  it('lists three bosses in route order, Zulgar the only one flagged final', () => {
    expect([...WILDHEART_BASIN_BOSSES]).toEqual([
      'wildheart_beastmaster',
      'the_gorgebloom',
      'wildheart_high_priest',
    ]);
    expect(MOBS.wildheart_high_priest.boss).toBe(true);
    for (const id of [
      'wildheart_beastmaster',
      'fanglord_jaguar',
      'the_gorgebloom',
      'great_saurian',
    ])
      expect(MOBS[id].boss, id).toBeUndefined();
    // The Gorgebloom is rooted in place and turns to face its targets.
    expect(MOBS.the_gorgebloom.moveSpeed).toBe(0);
  });

  it('stands each placeholder boss in its finished arena, on its floor', () => {
    const at = (id: string) => DUNGEONS[ID].spawns.find((s) => s.mobId === id);
    const bm = at('wildheart_beastmaster');
    const jaguar = at('fanglord_jaguar');
    for (const s of [bm, jaguar]) {
      expect(Math.hypot((s?.x ?? 0) - BEAST_PITS.x, (s?.z ?? 0) - BEAST_PITS.z)).toBeLessThan(
        BEAST_PITS.r,
      );
    }
    expect(bm?.packId).toBe('beastmaster');
    expect(jaguar?.packId).toBe('beastmaster');
    const bloom = at('the_gorgebloom');
    expect([bloom?.x, bloom?.z]).toEqual([GORGEBLOOM_DAIS.x, GORGEBLOOM_DAIS.z]);
    const zulgar = at('wildheart_high_priest');
    expect(zulgar?.z).toBeGreaterThan(SHRINE_TERRACE.points[0][1]);
  });

  it('carries normal and heroic tuning rows pricing every new mob, Zulgar the finale', () => {
    const normal = NORMAL_DUNGEON_TUNING[ID];
    const heroic = HEROIC_DUNGEON_TUNING[ID];
    expect(heroic.finalBossId).toBe('wildheart_high_priest');
    for (const id of new Set(DUNGEONS[ID].spawns.map((s) => s.mobId)))
      expect(normal.damageMultiplierByMob[id], id).toBeGreaterThan(0);
    for (const id of ['great_saurian', 'the_gorgebloom', 'wildheart_high_priest'])
      expect(heroic.healthMultiplierByMob?.[id], id).toBeGreaterThan(0);
  });
});

describe('the gates and seals in a live claim', () => {
  it('claims every placement and one gate object per gate, all shut', () => {
    const { sim, inst } = enter();
    expect(inst.mobIds.length).toBe(DUNGEONS[ID].spawns.length);
    for (const g of WILDHEART_BASIN_GATES) expect(gateState(sim, inst, g.id), g.id).toBe('closed');
  });

  it('the vine bridges weave on the ford, the wings open, the causeway waits for both bosses', () => {
    const { sim, me, inst } = enter();
    for (const p of ['g1', 'g2', 'g3']) dev(sim, me, `kill ${p}`);
    tick(sim, 0.2);
    expect(gateState(sim, inst, 'vine_bridge_west')).toBe('closed');
    dev(sim, me, 'kill pa');
    tick(sim, 0.2);
    expect(gateState(sim, inst, 'vine_bridge_west')).toBe('open');
    expect(gateState(sim, inst, 'vine_bridge_east')).toBe('open');
    expect(gateState(sim, inst, 'beast_pits_thorns')).toBe('closed');
    for (const p of ['g4', 'g5', 'pb', 'g6', 'g7']) dev(sim, me, `kill ${p}`);
    tick(sim, 0.2);
    expect(gateState(sim, inst, 'beast_pits_thorns')).toBe('open');
    expect(gateState(sim, inst, 'weeping_falls_thorns')).toBe('open');
    expect(gateState(sim, inst, 'sunbone_causeway_thorns')).toBe('closed');
    dev(sim, me, 'kill beastmaster');
    tick(sim, 0.2);
    expect(gateState(sim, inst, 'sunbone_causeway_thorns')).toBe('closed');
    dev(sim, me, 'kill gorgebloom');
    tick(sim, 0.2);
    expect(gateState(sim, inst, 'sunbone_causeway_thorns')).toBe('open');
    expect(gateState(sim, inst, 'convergence_arch')).toBe('closed');
    for (const p of ['g8', 'g9', 'pc']) dev(sim, me, `kill ${p}`);
    tick(sim, 0.2);
    expect(gateState(sim, inst, 'convergence_arch')).toBe('open');
    for (const p of ['g10', 'g11', 'g12', 'g13']) dev(sim, me, `kill ${p}`);
    tick(sim, 0.2);
    expect(gateState(sim, inst, 'shrine_ward')).toBe('closed');
    dev(sim, me, 'kill pd');
    tick(sim, 0.2);
    expect(gateState(sim, inst, 'shrine_ward')).toBe('open');
  });

  it('the Beast Pits thorns seal behind the group while the Beastmaster is engaged', () => {
    const { sim, me, inst } = enter();
    for (const p of ['g1', 'g2', 'g3', 'pa', 'g4', 'g5', 'pb']) dev(sim, me, `kill ${p}`);
    tick(sim, 0.2);
    expect(gateState(sim, inst, 'beast_pits_thorns')).toBe('open');
    me.maxHp = 1e7;
    me.hp = 1e7;
    dev(sim, me, 'tp beastmaster');
    sim.ctx.aggroMob(rosterOf(sim, inst, 'wildheart_beastmaster'), me, false);
    tick(sim, 0.5);
    expect(gateState(sim, inst, 'beast_pits_thorns')).toBe('sealed');
    // Pulling the master pulls his jaguar (one pack).
    expect(rosterOf(sim, inst, 'fanglord_jaguar').aiState).not.toBe('idle');
  });

  it('the Shrine Ward seals while Zulgar is engaged', () => {
    const { sim, me, inst } = enter();
    me.maxHp = 1e7;
    me.hp = 1e7;
    dev(sim, me, 'kill trash');
    dev(sim, me, 'kill beastmaster');
    dev(sim, me, 'kill gorgebloom');
    tick(sim, 0.2);
    expect(gateState(sim, inst, 'shrine_ward')).toBe('open');
    dev(sim, me, 'tp zulgar');
    sim.ctx.aggroMob(rosterOf(sim, inst, 'wildheart_high_priest'), me, false);
    tick(sim, 0.5);
    expect(gateState(sim, inst, 'shrine_ward')).toBe('sealed');
  });
});

describe('bossChainPull: Zulgar wakes the whole basin', () => {
  it('pulling Zulgar early pulls every idle living mob of the claim', () => {
    const { sim, me, inst } = enter();
    me.maxHp = 1e7;
    me.hp = 1e7;
    dev(sim, me, 'gates');
    dev(sim, me, 'tp zulgar');
    const zulgar = rosterOf(sim, inst, 'wildheart_high_priest');
    const toad = rosterOf(sim, inst, 'spore_toad');
    expect(toad.aiState).toBe('idle');
    sim.ctx.aggroMob(zulgar, me, false);
    expect(toad.aiState).not.toBe('idle');
    expect(toad.aggroTargetId).toBe(me.id);
  });

  it('a wing boss pull never wakes the rest (only the final boss chains)', () => {
    const { sim, me, inst } = enter();
    me.maxHp = 1e7;
    me.hp = 1e7;
    dev(sim, me, 'gates');
    dev(sim, me, 'tp gorgebloom');
    sim.ctx.aggroMob(rosterOf(sim, inst, 'the_gorgebloom'), me, false);
    for (const id of inst.mobIds) {
      const e = sim.ctx.entities.get(id);
      if (!e || e.templateId !== 'vine_lasher') continue;
      expect(e.aiState).toBe('idle');
    }
  });
});

describe('/dev wildheart tp: a jump to every area and boss', () => {
  const { sim, me, inst } = enter();
  for (const [alias, templateId] of [
    ['saurian', 'great_saurian'],
    ['beastmaster', 'wildheart_beastmaster'],
    ['gorgebloom', 'the_gorgebloom'],
    ['zulgar', 'wildheart_high_priest'],
  ] as const) {
    it(`${alias} lands near ${templateId}, on its floor, out of its reach`, () => {
      dev(sim, me, `tp ${alias}`);
      const boss = rosterOf(sim, inst, templateId);
      const d = Math.hypot(me.pos.x - boss.pos.x, me.pos.z - boss.pos.z);
      expect(d).toBeLessThan(45);
      expect(d).toBeGreaterThan(15);
      expect(Math.abs(me.pos.y - boss.pos.y)).toBeLessThan(3);
    });
  }

  it('every named area lands on walkable ground inside the claim', () => {
    const o = instanceOrigin(DUNGEONS[ID].index, inst.slot);
    for (const [area, spot] of Object.entries(WILDHEART_DEV_AREAS)) {
      dev(sim, me, `tp ${area}`);
      expect(Math.hypot(me.pos.x - o.x - spot.x, me.pos.z - o.z - spot.z), area).toBeLessThan(1);
      expect(me.pos.y, area).toBeGreaterThan(-1);
      expect(claimedInstanceAt(sim.ctx, me.pos), area).toBe(inst);
    }
    // The landing is the vista: 40 yd up the caldera wall.
    dev(sim, me, 'tp landing');
    expect(me.pos.y).toBeCloseTo(sim.ctx.groundPos(o.x, o.z - 217).y, 3);
    expect(sim.ctx.groundPos(o.x, o.z - 217).y - sim.ctx.groundPos(o.x - 18, o.z - 109).y).toBe(
      WILDHEART_HEIGHTS.landing - WILDHEART_HEIGHTS.ford,
    );
  });

  it('/dev wildheart pack lands beside a pack on its own floor', () => {
    const o = instanceOrigin(DUNGEONS[ID].index, inst.slot);
    for (const pack of ['g1', 'g3', 'g7', 'g9', 'g13', 'pc']) {
      dev(sim, me, `pack ${pack}`);
      const spawn = DUNGEONS[ID].spawns.find((s) => s.packId === pack);
      if (!spawn) throw new Error(pack);
      expect(Math.hypot(me.pos.x - o.x - spawn.x, me.pos.z - o.z - spawn.z), pack).toBeLessThan(17);
      const floor = sim.ctx.groundPos(o.x + spawn.x, o.z + spawn.z).y;
      expect(Math.abs(me.pos.y - floor), pack).toBeLessThan(2);
    }
  });

  it('/dev wildheart reset claims a fresh run with every gate shut again', () => {
    dev(sim, me, 'kill all');
    tick(sim, 0.2);
    dev(sim, me, 'reset');
    const fresh = claimedInstanceAt(sim.ctx, me.pos);
    expect(fresh).not.toBeNull();
    if (!fresh) return;
    for (const id of fresh.mobIds) expect(sim.ctx.entities.get(id)?.dead, String(id)).toBe(false);
    for (const g of WILDHEART_BASIN_GATES) expect(gateState(sim, fresh, g.id), g.id).toBe('closed');
  });
});

describe('/dev wildheart spawn', () => {
  it('/dev wildheart spawn raises each creature pulled', () => {
    const { sim, me, inst } = enter();
    for (const kind of ['raptor', 'toad', 'lasher', 'binder', 'saurian', 'rider', 'jaguar']) {
      const before = inst.mobIds.length;
      dev(sim, me, `spawn ${kind}`);
      expect(inst.mobIds.length, kind).toBe(before + 1);
      const mob = sim.ctx.entities.get(inst.mobIds[inst.mobIds.length - 1]);
      expect(mob?.aggroTargetId, kind).toBe(me.id);
    }
  });
});

describe('/dev wildheart trigger: every Saurian mechanic fires on demand', () => {
  it('tail, stomp, howdah, enrage', () => {
    const { sim, me, inst } = enter();
    const s = rosterOf(sim, inst, 'great_saurian');
    me.maxHp = 1e7;
    me.hp = 1e7;
    me.pos = sim.ctx.groundPos(s.pos.x + 3, s.pos.z + 3);
    me.prevPos = { ...me.pos };
    s.maxHp = 1e6;
    s.hp = 1e6;
    sim.ctx.aggroMob(s, me, false);
    for (let i = 0; i < 2; i++) sim.tick();
    for (const what of ['tail', 'stomp', 'howdah', 'enrage']) {
      sim.drainEvents();
      dev(sim, me, `trigger ${what}`);
      const lines = sim
        .drainEvents()
        .filter((e) => e.type === 'log')
        .map((e) => (e as { text: string }).text);
      expect(
        lines.some((t) => t.startsWith('[dev] ')),
        what,
      ).toBe(true);
      expect(
        lines.some((t) => t.includes('Mechanics:') || t.includes('first.')),
        what,
      ).toBe(false);
      sim.tick();
    }
    // The rider lands on the HowdahBreak clip's beat.
    for (let i = 0; i < 40; i++) sim.tick();
    expect(
      inst.mobIds.some((id) => sim.ctx.entities.get(id)?.templateId === 'howdah_hexcaller'),
    ).toBe(true);
  });
});

describe('/dev wildheart trigger: every boss mechanic fires on demand', () => {
  const cases: [string, string[], [number, number]][] = [
    ['wildheart_beastmaster', ['quake', 'stalk', 'hunt', 'ward', 'heel'], [-86, 60]],
    ['the_gorgebloom', ['seeds', 'pods', 'pollinate', 'lash', 'gorge'], [90, 40]],
    ['wildheart_high_priest', ['pulse', 'spirit', 'prey', 'endhunt', 'ambush'], [0, 214]],
  ];
  for (const [templateId, triggers, [lx, lz]] of cases) {
    it(`${templateId}: ${triggers.join(', ')}`, () => {
      const { sim, me, inst } = enter('heroic');
      // A second player so a mark always has a non-tank to take.
      const otherId = sim.addPlayer('mage', 'Marked');
      sim.partyInvite(otherId, me.id);
      sim.partyAccept(otherId);
      const other = sim.ctx.entities.get(otherId) as Entity;
      const o = instanceOrigin(DUNGEONS[ID].index, inst.slot);
      const b = rosterOf(sim, inst, templateId);
      for (const p of [me, other]) {
        p.maxHp = 1e7;
        p.hp = 1e7;
      }
      me.pos = sim.ctx.groundPos(o.x + lx, o.z + lz);
      me.prevPos = { ...me.pos };
      other.pos = sim.ctx.groundPos(o.x + lx + 12, o.z + lz - 6);
      other.prevPos = { ...other.pos };
      b.maxHp = 1e6;
      b.hp = 1e6;
      sim.ctx.aggroMob(b, me, false);
      for (let i = 0; i < 2; i++) sim.tick();
      for (const what of triggers) {
        sim.drainEvents();
        dev(sim, me, `trigger ${what}`);
        const lines = sim
          .drainEvents()
          .filter((e) => e.type === 'log')
          .map((e) => (e as { text: string }).text);
        expect(
          lines.some((t) => t.startsWith('[dev] ')),
          what,
        ).toBe(true);
        expect(
          lines.some((t) => t.includes('Mechanics:') || t.includes('first.')),
          what,
        ).toBe(false);
        sim.tick();
      }
    });
  }

  it('the help line names every trigger', () => {
    const { sim, inst } = enter();
    const help = wildheartDevTrigger(sim.ctx, inst, 'help');
    for (const what of WILDHEART_DEV_TRIGGERS) expect(help).toContain(what);
  });
});
