// Game-config override layer (src/sim/game_config.ts): validation, apply/reset
// round-trips over the live content tables, rate multipliers, and the XP hook.
import { afterEach, describe, expect, it } from 'vitest';
import { CAMPS, ITEMS, MOBS, NPCS, QUESTS } from '../src/sim/data';
import {
  activeGameConfig,
  applyGameConfig,
  CALENDAR_TUNING,
  DEFAULT_CALENDAR,
  DEFAULT_RATES,
  gameConfigDefaults,
  TUNING,
  tunedXpAmount,
  validateGameConfig,
} from '../src/sim/game_config';
import { Sim } from '../src/sim/sim';
import { XP_TABLE, xpForLevel, xpToReachLevel } from '../src/sim/types';

// Any mob with loot that carries copper, for the gold/loot rate assertions.
function mobWithCopperLoot(): string {
  for (const [id, def] of Object.entries(MOBS)) {
    if (def.loot.some((entry) => (entry.copper ?? 0) > 0)) return id;
  }
  throw new Error('no mob with copper loot in content');
}

const anyMobId = Object.keys(MOBS)[0];
const anyQuestId = Object.keys(QUESTS)[0];
const anyItemId = Object.keys(ITEMS)[0];
const vendorNpcId = Object.entries(NPCS).find(([, def]) => def.vendorItems?.length)?.[0] ?? '';

afterEach(() => {
  // Restore vanilla for every other test file sharing this worker.
  applyGameConfig({});
});

describe('validateGameConfig', () => {
  it('accepts a well-formed document unchanged', () => {
    const { config, errors } = validateGameConfig({
      rates: { xpRate: 2, respawnSeconds: 60, worldSeed: 12345 },
      mobs: { [anyMobId]: { hpBase: 50, elite: true } },
      quests: { [anyQuestId]: { xpReward: 999 } },
      items: { [anyItemId]: { sellValue: 123 } },
    });
    expect(errors).toEqual([]);
    expect(config.rates).toEqual({ xpRate: 2, respawnSeconds: 60, worldSeed: 12345 });
    expect(config.mobs?.[anyMobId]).toEqual({ hpBase: 50, elite: true });
    expect(config.quests?.[anyQuestId]).toEqual({ xpReward: 999 });
    expect(config.items?.[anyItemId]).toEqual({ sellValue: 123 });
  });

  it('drops unknown sections, ids, fields, and out-of-range values with errors', () => {
    const { config, errors } = validateGameConfig({
      nonsense: true,
      rates: { xpRate: -5, bogus: 1 },
      mobs: {
        [anyMobId]: { hpBase: -10, notAField: 3 },
        no_such_mob: { hpBase: 10 },
      },
      items: { no_such_item: { sellValue: 5 } },
    });
    expect(config).toEqual({});
    expect(errors).toContain('config: unknown section nonsense');
    expect(errors).toContain('rates: invalid xpRate');
    expect(errors).toContain(`mobs.${anyMobId}: invalid hpBase`);
    expect(errors).toContain('mobs: unknown mob no_such_mob');
    expect(errors).toContain('items: unknown item no_such_item');
  });

  it('rejects a merged minLevel > maxLevel', () => {
    const def = MOBS[anyMobId];
    const { config, errors } = validateGameConfig({
      mobs: { [anyMobId]: { minLevel: Math.min(60, def.maxLevel + 5) } },
    });
    expect(config.mobs).toBeUndefined();
    expect(errors).toContain(`mobs.${anyMobId}: minLevel > maxLevel`);
  });

  it('rejects inherited Object.prototype names posing as content ids', () => {
    const { config, errors } = validateGameConfig({
      mobs: { constructor: { hpBase: 50 }, toString: { dmgBase: 9 } },
      items: { hasOwnProperty: { sellValue: 1 } },
      quests: { valueOf: { xpReward: 1 } },
      npcs: { constructor: { pos: { x: 0, z: 0 } } },
    });
    expect(config).toEqual({});
    expect(errors).toContain('mobs: unknown mob constructor');
    expect(errors).toContain('mobs: unknown mob toString');
    expect(errors).toContain('items: unknown item hasOwnProperty');
    expect(errors).toContain('quests: unknown quest valueOf');
    expect(errors).toContain('npcs: unknown npc constructor');
    const loot = validateGameConfig({
      mobs: { [anyMobId]: { loot: [{ itemId: 'constructor', chance: 0.5 }] } },
    });
    expect(loot.config.mobs).toBeUndefined();
  });

  it('rejects loot entries with unknown items or bad chances', () => {
    const bad = validateGameConfig({
      mobs: { [anyMobId]: { loot: [{ itemId: 'nope', chance: 0.5 }] } },
    });
    expect(bad.config.mobs).toBeUndefined();
    expect(bad.errors.some((e) => e.includes('unknown loot itemId'))).toBe(true);
    const badChance = validateGameConfig({
      mobs: { [anyMobId]: { loot: [{ itemId: anyItemId, chance: 2 }] } },
    });
    expect(badChance.config.mobs).toBeUndefined();
  });

  it('anchors camp overrides to the expected mobId', () => {
    const ok = validateGameConfig({
      camps: { '0': { mobId: CAMPS[0].mobId, count: 3 } },
    });
    expect(ok.errors).toEqual([]);
    expect(ok.config.camps?.['0']).toEqual({ mobId: CAMPS[0].mobId, count: 3 });
    const drift = validateGameConfig({
      camps: { '0': { mobId: 'someone_else', count: 3 } },
    });
    expect(drift.config.camps).toBeUndefined();
    expect(drift.errors.some((e) => e.startsWith('camps.0: expected mob'))).toBe(true);
  });

  it('accepts calendar caps and drops invalid ones with errors', () => {
    const ok = validateGameConfig({ calendar: { eventLimit: 10, titleMax: 64 } });
    expect(ok.errors).toEqual([]);
    expect(ok.config.calendar).toEqual({ eventLimit: 10, titleMax: 64 });

    const bad = validateGameConfig({
      calendar: { eventLimit: 0, noteMax: 2.5, horizonDays: 99999, nonsense: 1 },
    });
    expect(bad.config.calendar).toBeUndefined();
    expect(bad.errors).toEqual([
      'calendar: invalid eventLimit',
      'calendar: invalid noteMax',
      'calendar: invalid horizonDays',
    ]);
  });

  it('validates the xpTable shape', () => {
    const short = validateGameConfig({ xpTable: [100, 200] });
    expect(short.config.xpTable).toBeUndefined();
    const table = XP_TABLE.map((v) => v * 2);
    const ok = validateGameConfig({ xpTable: table });
    expect(ok.config.xpTable).toEqual(table);
  });
});

describe('applyGameConfig', () => {
  it('applying {} keeps every table at its shipped values', () => {
    const before = {
      mob: JSON.parse(JSON.stringify(MOBS[anyMobId])),
      quest: JSON.parse(JSON.stringify(QUESTS[anyQuestId])),
      camp: JSON.parse(JSON.stringify(CAMPS[0])),
      xp: [...XP_TABLE],
      tuning: { ...TUNING },
    };
    applyGameConfig({});
    expect(JSON.parse(JSON.stringify(MOBS[anyMobId]))).toEqual(before.mob);
    expect(JSON.parse(JSON.stringify(QUESTS[anyQuestId]))).toEqual(before.quest);
    expect(JSON.parse(JSON.stringify(CAMPS[0]))).toEqual(before.camp);
    expect([...XP_TABLE]).toEqual(before.xp);
    expect({ ...TUNING }).toEqual(before.tuning);
  });

  it('applies per-entity absolute values and resets them on the next apply', () => {
    const defaultHp = MOBS[anyMobId].hpBase;
    applyGameConfig({ mobs: { [anyMobId]: { hpBase: defaultHp + 100, elite: true } } });
    expect(MOBS[anyMobId].hpBase).toBe(defaultHp + 100);
    expect(MOBS[anyMobId].elite).toBe(true);
    applyGameConfig({});
    expect(MOBS[anyMobId].hpBase).toBe(defaultHp);
    const shippedElite = gameConfigDefaults().mobs.get(anyMobId)?.flags.elite;
    expect(MOBS[anyMobId].elite).toBe(shippedElite);
  });

  it('global mob rates scale hp/dmg/loot and per-mob overrides stay absolute on top', () => {
    const goldMob = mobWithCopperLoot();
    const shipped = gameConfigDefaults();
    const shippedMob = shipped.mobs.get(goldMob);
    if (!shippedMob) throw new Error('missing snapshot');
    applyGameConfig({
      rates: { mobHpRate: 2, mobDmgRate: 0.5, goldDropRate: 3, lootChanceRate: 10 },
      mobs: { [goldMob]: { hpBase: 7 } },
    });
    expect(MOBS[goldMob].hpBase).toBe(7); // absolute override wins over the 2x rate
    expect(MOBS[goldMob].hpPerLevel).toBeCloseTo((shippedMob.numeric.hpPerLevel ?? 0) * 2);
    expect(MOBS[goldMob].dmgBase).toBeCloseTo((shippedMob.numeric.dmgBase ?? 0) * 0.5);
    const shippedCopper = shippedMob.loot.find((entry) => (entry.copper ?? 0) > 0);
    const liveCopper = MOBS[goldMob].loot.find((entry) => (entry.copper ?? 0) > 0);
    expect(liveCopper?.copper).toBe(Math.round((shippedCopper?.copper ?? 0) * 3));
    for (const entry of MOBS[goldMob].loot) expect(entry.chance).toBeLessThanOrEqual(1);
    applyGameConfig({});
    expect(MOBS[goldMob].hpBase).toBe(shippedMob.numeric.hpBase);
    expect(JSON.parse(JSON.stringify(MOBS[goldMob].loot))).toEqual(
      JSON.parse(JSON.stringify(shippedMob.loot)),
    );
  });

  it('quest objective counts apply and reset', () => {
    const questId = Object.keys(QUESTS).find((id) => QUESTS[id].objectives.length > 0);
    if (!questId) throw new Error('no quest with objectives');
    const counts = QUESTS[questId].objectives.map(() => 7);
    applyGameConfig({ quests: { [questId]: { objectiveCounts: counts } } });
    expect(QUESTS[questId].objectives.every((o) => o.count === 7)).toBe(true);
    applyGameConfig({});
    expect(QUESTS[questId].objectives.map((o) => o.count)).toEqual(
      gameConfigDefaults().quests.get(questId)?.objectiveCounts,
    );
  });

  it('camp overrides apply and reset', () => {
    applyGameConfig({ camps: { '0': { mobId: CAMPS[0].mobId, count: 0, radius: 33 } } });
    expect(CAMPS[0].count).toBe(0);
    expect(CAMPS[0].radius).toBe(33);
    applyGameConfig({});
    expect(CAMPS[0].count).toBe(gameConfigDefaults().camps[0].count);
    expect(CAMPS[0].radius).toBe(gameConfigDefaults().camps[0].radius);
  });

  it('npc vendor stock and position apply and reset', () => {
    if (!vendorNpcId) throw new Error('no vendor npc in content');
    const shipped = gameConfigDefaults().npcs.get(vendorNpcId);
    applyGameConfig({
      npcs: { [vendorNpcId]: { vendorItems: [anyItemId], pos: { x: 1, z: 2 } } },
    });
    expect(NPCS[vendorNpcId].vendorItems).toEqual([anyItemId]);
    expect(NPCS[vendorNpcId].pos).toEqual({ x: 1, z: 2 });
    applyGameConfig({});
    expect(NPCS[vendorNpcId].vendorItems).toEqual(shipped?.vendorItems);
    expect(NPCS[vendorNpcId].pos).toEqual(shipped?.pos);
  });

  it('xpTable overrides refresh xpForLevel and the post-cap table', () => {
    const doubled = gameConfigDefaults().xpTable.map((v) => v * 2);
    applyGameConfig({ xpTable: doubled });
    expect(xpForLevel(1)).toBe(doubled[0]);
    expect(xpToReachLevel(3)).toBe(doubled[0] + doubled[1]);
    applyGameConfig({});
    const shipped = gameConfigDefaults().xpTable;
    expect(xpForLevel(1)).toBe(shipped[0]);
    expect(xpToReachLevel(3)).toBe(shipped[0] + shipped[1]);
  });

  it('calendar overrides land on CALENDAR_TUNING and reset on the next apply', () => {
    expect(CALENDAR_TUNING).toEqual(DEFAULT_CALENDAR);
    applyGameConfig({ calendar: { eventLimit: 3, keepPastDays: 0 } });
    expect(CALENDAR_TUNING).toEqual({ ...DEFAULT_CALENDAR, eventLimit: 3, keepPastDays: 0 });
    applyGameConfig({});
    expect(CALENDAR_TUNING).toEqual(DEFAULT_CALENDAR);
  });

  it('tracks the active config for restart-pending comparison', () => {
    const config = { rates: { xpRate: 2 } };
    applyGameConfig(config);
    expect(activeGameConfig()).toBe(config);
    applyGameConfig({});
    expect(activeGameConfig()).toEqual({});
  });
});

describe('TUNING hooks', () => {
  it('tunedXpAmount is identity at the default rate and scales otherwise', () => {
    expect(TUNING).toEqual({ ...DEFAULT_RATES });
    expect(tunedXpAmount(123)).toBe(123);
    applyGameConfig({ rates: { xpRate: 2.5 } });
    expect(tunedXpAmount(100)).toBe(250);
    expect(tunedXpAmount(3)).toBe(Math.round(3 * 2.5));
    applyGameConfig({});
    expect(tunedXpAmount(123)).toBe(123);
  });

  it('grantXp respects the xpRate override end to end', () => {
    applyGameConfig({ rates: { xpRate: 2 } });
    const sim = new Sim({ seed: 1, playerClass: 'warrior' });
    const before = sim.xp;
    sim.grantXp(100);
    expect(sim.xp - before).toBe(200);
  });

  it('a same-seed world is identical with an empty override document', () => {
    const a = new Sim({ seed: 42, playerClass: 'warrior' });
    applyGameConfig({});
    const b = new Sim({ seed: 42, playerClass: 'warrior' });
    const positions = (sim: Sim) =>
      [...sim.entities.values()]
        .filter((e) => e.kind === 'mob')
        .map((e) => `${e.templateId}:${e.pos.x.toFixed(4)},${e.pos.z.toFixed(4)},L${e.level}`);
    expect(positions(b)).toEqual(positions(a));
  });
});
