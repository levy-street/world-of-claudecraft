import { describe, expect, it } from 'vitest';
import { parseConfig } from '../farmbot/config';
import {
  assembleConfig,
  buildZoneMeta,
  deriveZones,
  FbstatFilter,
  formatCopper,
  parseFbstatLine,
  RingLog,
} from '../farmbot/launcher_core';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import { ZONES } from '../src/sim/data';

const FORM = {
  serverUrl: 'https://worldofclaudecraft.com',
  characterName: 'Farmhand',
  zoneId: 'eastbrook_vale',
  nodeTypes: ['herb', 'ore', 'wood'],
  maxNodeTier: 99,
  fishingEnabled: false,
  fishingSpotX: null,
  fishingSpotZ: null,
  castsPerSpot: null,
  abilitySlots: [0, 1],
  eatItemId: '',
  drinkItemId: '',
  eatBelowHpPct: null,
  drinkBelowManaPct: null,
  fullPolicy: 'sell-junk',
  maxRuntimeMinutes: 0,
  mode: '',
  goldDungeons: '',
  goldRestBelowPct: null,
  targetLevel: null,
  lootRule: '',
  zoneUp: true,
  gearUpgrades: false,
  marketSell: false,
  mountEnabled: false,
  mountBuyTraining: false,
};

describe('farmbot launcher RingLog', () => {
  it('splits pushes into lines and paginates with absolute indices', () => {
    const log = new RingLog();
    log.push('one\ntwo\nth');
    log.push('ree\nfour\n');
    const page1 = log.since(0);
    expect(page1).toEqual({ lines: ['one', 'two', 'three', 'four'], next: 4 });
    expect(log.since(2)).toEqual({ lines: ['three', 'four'], next: 4 });
    expect(log.since(4)).toEqual({ lines: [], next: 4 });
    // an unterminated tail stays buffered until end()
    log.push('tail');
    expect(log.since(4).lines).toEqual([]);
    log.end();
    expect(log.since(4)).toEqual({ lines: ['tail'], next: 5 });
  });

  it('drops the oldest lines past the cap and keeps indices honest', () => {
    const log = new RingLog(3);
    for (let i = 0; i < 10; i++) log.push(`line${i}\n`);
    // every push ends with a newline, so all 10 lines are committed; cap 3
    const page = log.since(0);
    expect(page).toEqual({ lines: ['line7', 'line8', 'line9'], next: 10 });
    expect(log.since(8)).toEqual({ lines: ['line8', 'line9'], next: 10 });
    // a reader ahead of the write head gets nothing and the current head
    expect(log.since(99)).toEqual({ lines: [], next: 10 });
  });
});

describe('farmbot launcher deriveZones', () => {
  it('returns unique zone ids in first-seen order', () => {
    expect(deriveZones([{ zoneId: 'b' }, { zoneId: 'a' }, { zoneId: 'b' }])).toEqual(['b', 'a']);
  });
  it('covers eastbrook_vale from the shipped node table', () => {
    const zones = deriveZones(GATHER_NODES);
    expect(zones[0]).toBe('eastbrook_vale');
    expect(new Set(zones).size).toBe(zones.length);
  });
});

describe('farmbot launcher assembleConfig', () => {
  it('produces a document parseConfig accepts, with no credential fields', () => {
    const cfg = parseConfig(assembleConfig(FORM));
    expect(cfg.characterName).toBe('Farmhand');
    expect(cfg.fishing.enabled).toBe(false);
    expect(cfg.fishing.spot).toBeUndefined();
    expect(cfg.combat).toEqual({
      abilitySlots: [0, 1],
      rotationMode: 'slots',
      grind: false,
      flee: 'never',
      fleeAboveLevelDelta: 3,
      maxPullSize: 2,
    });
    const keys = Object.keys(assembleConfig(FORM));
    expect(keys).not.toContain('username');
    expect(keys).not.toContain('password');
  });

  it('includes fishing and recovery options only when filled in', () => {
    const cfg = parseConfig(
      assembleConfig({
        ...FORM,
        fishingEnabled: true,
        fishingSpotX: -72.4,
        fishingSpotZ: 65.3,
        castsPerSpot: 3,
        eatItemId: 'baked_bread',
        eatBelowHpPct: 50,
      }),
    );
    expect(cfg.fishing).toEqual({
      enabled: true,
      spot: { x: -72.4, z: 65.3 },
      spots: [{ x: -72.4, z: 65.3 }],
      castsPerSpot: 3,
    });
    expect(cfg.combat.eatItemId).toBe('baked_bread');
    expect(cfg.combat.eatBelowHpPct).toBe(50);
    expect(cfg.combat.drinkItemId).toBeUndefined();
    expect(cfg.combat.drinkBelowManaPct).toBeUndefined();
  });

  it('omits the spot when only one coordinate is set', () => {
    const cfg = parseConfig(assembleConfig({ ...FORM, fishingEnabled: true, fishingSpotX: 10 }));
    expect(cfg.fishing.spot).toBeUndefined();
  });

  it('lets parseConfig reject a bad form (unknown node type)', () => {
    expect(() => parseConfig(assembleConfig({ ...FORM, nodeTypes: ['fish'] }))).toThrow(
      /nodeTypes/,
    );
  });

  it('wires level mode and the economy toggles into the document', () => {
    const cfg = parseConfig(
      assembleConfig({
        ...FORM,
        mode: 'level',
        targetLevel: 20,
        lootRule: 'money-blues',
        zoneUp: true,
        gearUpgrades: true,
        marketSell: true,
        mountEnabled: true,
        mountBuyTraining: true,
      }),
    );
    expect(cfg.mode).toBe('level');
    expect(cfg.levelGrind).toEqual({
      targetLevel: 20,
      restBelowPct: 50,
      lootRule: 'money-blues',
      zoneUp: true,
    });
    expect(cfg.gearUpgrades).toBe(true);
    expect(cfg.bags.marketSell).toBe(true);
    expect(cfg.mount).toEqual({ enabled: true, buyTraining: true });
  });

  it('keeps the economy keys out of the document when the toggles are off', () => {
    const out = assembleConfig({ ...FORM, mode: 'level', zoneUp: false });
    expect(out.gearUpgrades).toBeUndefined();
    expect((out.bags as Record<string, unknown>).marketSell).toBeUndefined();
    expect(out.mount).toBeUndefined();
    // zoneUp is a real checkbox state, so it travels even when false
    expect((out.levelGrind as Record<string, unknown>).zoneUp).toBe(false);
    expect((out.levelGrind as Record<string, unknown>).targetLevel).toBeUndefined();
    expect((out.levelGrind as Record<string, unknown>).lootRule).toBeUndefined();
  });
});

describe('farmbot launcher FBSTAT parsing', () => {
  const STAT = {
    pos: { x: 1, z: 2 },
    zoneId: 'eastbrook_vale',
    mode: 'TRAVEL',
    hp: 30,
    maxHp: 30,
    resource: 100,
    maxResource: 100,
    bagsUsed: 3,
    bagCapacity: 20,
    stats: { harvests: 4, catches: 1, kills: 2, deaths: 0, copperGained: 12345 },
    inventory: [{ itemId: 'copper_ore', count: 5 }],
  };

  it('parses a well-formed line and ignores everything else', () => {
    expect(parseFbstatLine(`FBSTAT ${JSON.stringify(STAT)}`)).toEqual(STAT);
    expect(parseFbstatLine('just a log line')).toBeNull();
    expect(parseFbstatLine('FBSTAT {not json')).toBeNull();
    expect(parseFbstatLine('FBSTAT {"pos":{"x":1}}')).toBeNull(); // missing zoneId/mode
    expect(parseFbstatLine('FBSTAT {}')).toBeNull();
  });

  it('keeps copperGained on the stats payload for the live panel', () => {
    const parsed = parseFbstatLine(`FBSTAT ${JSON.stringify(STAT)}`);
    expect(parsed?.stats.copperGained).toBe(12345);
  });

  it('skims FBSTAT lines out of the child stream, latest wins', () => {
    const filter = new FbstatFilter();
    const first = filter.push(`log one\nFBSTAT ${JSON.stringify(STAT)}\nlog two\n`);
    expect(first).toEqual(['log one', 'log two']);
    expect(filter.latest).toEqual(STAT);
    const second = filter.push(`FBSTAT ${JSON.stringify({ ...STAT, mode: 'COMBAT', hp: 12 })}`);
    expect(second).toEqual([]); // unterminated but parsed is fine? no: unterminated stays buffered
    expect(filter.latest).toEqual(STAT); // still the completed line
    const third = filter.push('\nlog three\n');
    expect(third).toEqual(['log three']);
    expect(filter.latest?.mode).toBe('COMBAT');
    expect(filter.latest?.hp).toBe(12);
  });
});

describe('farmbot launcher formatCopper', () => {
  it('formats classic gold / silver / copper', () => {
    expect(formatCopper(0)).toBe('0c');
    expect(formatCopper(42)).toBe('42c');
    expect(formatCopper(305)).toBe('3s 5c');
    expect(formatCopper(12_345)).toBe('1g 23s 45c');
    expect(formatCopper(-10)).toBe('0c');
  });
});

describe('farmbot launcher zone meta', () => {
  it('builds the map payload from the real zone and node tables', () => {
    const meta = buildZoneMeta(ZONES, GATHER_NODES);
    expect(meta.length).toBe(ZONES.length);
    const eastbrook = meta.find((z) => z.id === 'eastbrook_vale');
    expect(eastbrook).toBeDefined();
    expect(eastbrook?.rect).toEqual({ zMin: -180, zMax: 180, xMin: -180, xMax: 180 });
    expect(eastbrook?.lakes.length).toBeGreaterThan(0);
    expect(eastbrook?.nodes.length).toBe(18);
    expect(eastbrook?.nodes[0]).toMatchObject({ type: 'ore' });
    // a column zone carries its explicit x range
    const drakelands = meta.find((z) => z.id === 'drakelands');
    expect(drakelands?.rect.xMin).toBe(180);
    expect(drakelands?.rect.xMax).toBe(540);
  });
});

describe('farmbot launcher gold mode config', () => {
  it('passes mode and goldFarm fields through assembly', () => {
    const cfg = parseConfig(
      assembleConfig({
        ...FORM,
        mode: 'gold',
        goldDungeons: 'hollow_crypt, sunken_bastion',
        goldRestBelowPct: 45,
      }),
    );
    expect(cfg.mode).toBe('gold');
    expect(cfg.goldFarm.dungeons).toEqual(['hollow_crypt', 'sunken_bastion']);
    expect(cfg.goldFarm.restBelowPct).toBe(45);
    expect(cfg.goldFarm.pullAbility).toBe('exorcism'); // schema default fills the rest
  });

  it('omits goldFarm for non-gold modes', () => {
    const doc = assembleConfig({ ...FORM, mode: 'gather-fish' });
    expect('goldFarm' in doc).toBe(false);
  });
});
