import { describe, expect, it } from 'vitest';
import { parseConfig } from '../farmbot/config';

const VALID = {
  serverUrl: 'wss://example.test/ws',
  characterName: 'Farmhand',
  zoneId: 'eastbrook_vale',
};

describe('farmbot parseConfig', () => {
  it('parses a minimal config and fills defaults', () => {
    const cfg = parseConfig(VALID);
    expect(cfg.serverUrl).toBe('wss://example.test/ws');
    expect(cfg.characterName).toBe('Farmhand');
    expect(cfg.zoneId).toBe('eastbrook_vale');
    expect(cfg.nodeTypes).toEqual(['ore', 'wood', 'herb']);
    expect(cfg.maxNodeTier).toBe(99);
    expect(cfg.fishing).toEqual({ enabled: false, spots: [] });
    expect(cfg.combat).toEqual({
      abilitySlots: [],
      rotationMode: 'slots',
      grind: false,
      flee: 'never',
      fleeAboveLevelDelta: 3,
      maxPullSize: 2,
    });
    expect(cfg.bags).toEqual({
      fullPolicy: 'sell-junk',
      sellAllowlist: [],
      mailItems: 'all',
      marketSell: false,
    });
    expect(cfg.maxRuntimeMinutes).toBe(0);
    // phase-1 schema defaults
    expect(cfg.mode).toBe('gather-fish');
    expect(cfg.zones).toEqual([]);
    expect(cfg.nodePriority).toEqual(['ore', 'wood', 'herb']); // nodeTypes order
    expect(cfg.nodeBlacklist).toEqual([]);
    expect(cfg.nodeWhitelist).toEqual([]);
    expect(cfg.death).toEqual({ waitUntilFull: true, maxDeaths: 0, avoidDeathSpotMinutes: 30 });
    expect(cfg.safety).toEqual({
      whisperAction: 'alarm',
      playerPause: { enabled: false, radiusYd: 40, seconds: 20 },
      schedule: { sessionMinutes: 0, breakMinutes: 20, breakAction: 'idle' },
    });
    expect(cfg.safety.webhookUrl).toBeUndefined();
    expect(cfg.bags.mailTo).toBeUndefined();
    expect(cfg.gearUpgrades).toBe(false);
    expect(cfg.mount).toEqual({ enabled: false, buyTraining: false });
  });

  it('parses a fully specified config', () => {
    const cfg = parseConfig({
      ...VALID,
      nodeTypes: ['herb', 'ore'],
      maxNodeTier: 2,
      fishing: { enabled: true, spot: { x: 10, z: -20 }, castsPerSpot: 5 },
      combat: {
        abilitySlots: [0, 1, 2],
        eatItemId: 'item_bread',
        drinkItemId: 'item_water',
        eatBelowHpPct: 50,
        drinkBelowManaPct: 30,
      },
      bags: { fullPolicy: 'stop' },
      maxRuntimeMinutes: 120,
    });
    expect(cfg.nodeTypes).toEqual(['herb', 'ore']);
    expect(cfg.maxNodeTier).toBe(2);
    expect(cfg.fishing).toEqual({
      enabled: true,
      spot: { x: 10, z: -20 },
      spots: [{ x: 10, z: -20 }],
      castsPerSpot: 5,
    });
    expect(cfg.mode).toBe('gather-fish'); // derived from legacy fishing.enabled
    expect(cfg.combat).toEqual({
      abilitySlots: [0, 1, 2],
      rotationMode: 'slots',
      grind: false,
      flee: 'never',
      fleeAboveLevelDelta: 3,
      maxPullSize: 2,
      eatItemId: 'item_bread',
      drinkItemId: 'item_water',
      eatBelowHpPct: 50,
      drinkBelowManaPct: 30,
    });
    expect(cfg.bags).toEqual({
      fullPolicy: 'stop',
      sellAllowlist: [],
      mailItems: 'all',
      marketSell: false,
    });
    expect(cfg.maxRuntimeMinutes).toBe(120);
  });

  it('parses the economy fields (gearUpgrades, bags.marketSell, mount)', () => {
    const cfg = parseConfig({
      ...VALID,
      gearUpgrades: true,
      bags: { marketSell: true },
      mount: { enabled: true, buyTraining: true },
    });
    expect(cfg.gearUpgrades).toBe(true);
    expect(cfg.bags.marketSell).toBe(true);
    expect(cfg.mount).toEqual({ enabled: true, buyTraining: true });
    expect(() => parseConfig({ ...VALID, gearUpgrades: 'yes' })).toThrow(/gearUpgrades/);
    expect(() => parseConfig({ ...VALID, bags: { marketSell: 1 } })).toThrow(/bags\.marketSell/);
    expect(() => parseConfig({ ...VALID, mount: { enabled: 'on' } })).toThrow(/mount\.enabled/);
    expect(() => parseConfig({ ...VALID, mount: { buyTraining: 1 } })).toThrow(
      /mount\.buyTraining/,
    );
    expect(() => parseConfig({ ...VALID, mount: { speed: 2 } })).toThrow(/mount/);
  });

  it('accepts the outnumbered/both flee values and a custom maxPullSize', () => {
    expect(parseConfig({ ...VALID, combat: { flee: 'outnumbered' } }).combat.flee).toBe(
      'outnumbered',
    );
    expect(parseConfig({ ...VALID, combat: { flee: 'both' } }).combat.flee).toBe('both');
    expect(parseConfig({ ...VALID, combat: { maxPullSize: 1 } }).combat.maxPullSize).toBe(1);
    expect(parseConfig({ ...VALID, combat: { maxPullSize: 4 } }).combat.maxPullSize).toBe(4);
  });

  it('parses every phase-1 field when fully specified', () => {
    const cfg = parseConfig({
      ...VALID,
      mode: 'fish',
      zones: ['eastbrook_vale', 'mirefen_marsh'],
      nodePriority: ['wood', 'ore'],
      nodeBlacklist: ['ore_eastbrook_1'],
      nodeWhitelist: ['herb_eastbrook_1', 'herb_eastbrook_2'],
      fishing: {
        spots: [
          { x: 1, z: 2 },
          { x: 3, z: 4 },
        ],
        castsPerSpot: 3,
      },
      combat: { rotationMode: 'auto', grind: true, flee: 'outleveled', fleeAboveLevelDelta: 5 },
      bags: { sellAllowlist: ['tattered_pelt'], mailTo: 'Bankalt', mailItems: ['copper_ore'] },
      death: { waitUntilFull: false, maxDeaths: 3, avoidDeathSpotMinutes: 45 },
      safety: {
        whisperAction: 'logout',
        playerPause: { enabled: true, radiusYd: 60, seconds: 30 },
        schedule: { sessionMinutes: 90, breakMinutes: 15, breakAction: 'logout' },
        webhookUrl: 'https://example.test/hook',
      },
    });
    expect(cfg.mode).toBe('fish');
    expect(cfg.fishing.enabled).toBe(true); // derived from mode
    expect(cfg.zones).toEqual(['eastbrook_vale', 'mirefen_marsh']);
    expect(cfg.nodePriority).toEqual(['wood', 'ore']);
    expect(cfg.nodeBlacklist).toEqual(['ore_eastbrook_1']);
    expect(cfg.nodeWhitelist).toEqual(['herb_eastbrook_1', 'herb_eastbrook_2']);
    expect(cfg.fishing.spots).toEqual([
      { x: 1, z: 2 },
      { x: 3, z: 4 },
    ]);
    expect(cfg.fishing.spot).toEqual({ x: 1, z: 2 }); // mirrored from spots[0]
    expect(cfg.combat.rotationMode).toBe('auto');
    expect(cfg.combat.grind).toBe(true);
    expect(cfg.combat.flee).toBe('outleveled');
    expect(cfg.combat.fleeAboveLevelDelta).toBe(5);
    expect(cfg.bags.sellAllowlist).toEqual(['tattered_pelt']);
    expect(cfg.bags.mailTo).toBe('Bankalt');
    expect(cfg.bags.mailItems).toEqual(['copper_ore']);
    expect(cfg.death).toEqual({ waitUntilFull: false, maxDeaths: 3, avoidDeathSpotMinutes: 45 });
    expect(cfg.safety).toEqual({
      whisperAction: 'logout',
      playerPause: { enabled: true, radiusYd: 60, seconds: 30 },
      schedule: { sessionMinutes: 90, breakMinutes: 15, breakAction: 'logout' },
      webhookUrl: 'https://example.test/hook',
    });
  });

  it('reconciles the legacy fishing.enabled alias with mode in both directions', () => {
    // legacy enabled=true, no mode: gather-fish
    expect(parseConfig({ ...VALID, fishing: { enabled: true } }).mode).toBe('gather-fish');
    // legacy enabled=false (explicit), no mode: gather
    const legacyOff = parseConfig({ ...VALID, fishing: { enabled: false } });
    expect(legacyOff.mode).toBe('gather');
    expect(legacyOff.fishing.enabled).toBe(false);
    // mode written: it supersedes the flag entirely
    const modeWins = parseConfig({ ...VALID, mode: 'gather', fishing: { enabled: true } });
    expect(modeWins.mode).toBe('gather');
    expect(modeWins.fishing.enabled).toBe(false);
    // fish-only mode
    const fishOnly = parseConfig({ ...VALID, mode: 'fish' });
    expect(fishOnly.fishing.enabled).toBe(true);
  });

  it('parses levelGrind defaults and accepts mode level', () => {
    const cfg = parseConfig({ ...VALID, mode: 'level' });
    expect(cfg.mode).toBe('level');
    expect(cfg.levelGrind).toEqual({
      targetLevel: 20,
      restBelowPct: 50,
      lootRule: 'money-blues',
      zoneUp: true,
    });
    // Auto-equip defaults ON while leveling; explicit false still wins.
    expect(cfg.gearUpgrades).toBe(true);
    expect(parseConfig({ ...VALID, mode: 'level', gearUpgrades: false }).gearUpgrades).toBe(false);
  });

  it('parses a fully specified levelGrind and rejects bad values', () => {
    const cfg = parseConfig({
      ...VALID,
      levelGrind: { targetLevel: 14, restBelowPct: 40, lootRule: 'all', zoneUp: false },
    });
    expect(cfg.levelGrind).toEqual({
      targetLevel: 14,
      restBelowPct: 40,
      lootRule: 'all',
      zoneUp: false,
    });
    expect(() => parseConfig({ ...VALID, levelGrind: { targetLevel: 0 } })).toThrow(
      /levelGrind\.targetLevel/,
    );
    expect(() => parseConfig({ ...VALID, levelGrind: { restBelowPct: 0 } })).toThrow(
      /levelGrind\.restBelowPct/,
    );
    expect(() => parseConfig({ ...VALID, levelGrind: { lootRule: 'blues' } })).toThrow(
      /levelGrind\.lootRule/,
    );
    expect(() => parseConfig({ ...VALID, levelGrind: { zoneUp: 'yes' } })).toThrow(
      /levelGrind\.zoneUp/,
    );
    expect(() => parseConfig({ ...VALID, levelGrind: { camp: 'wolves' } })).toThrow(
      /levelGrind: unknown key 'camp'/,
    );
  });

  it('parses goldFarm defaults and accepts mode gold', () => {
    const cfg = parseConfig({ ...VALID, mode: 'gold' });
    expect(cfg.mode).toBe('gold');
    expect(cfg.goldFarm).toEqual({
      dungeons: ['hollow_crypt', 'sunken_bastion'],
      restBelowPct: 50,
      pullAbility: 'exorcism',
      keepQualities: ['rare', 'epic', 'legendary'],
    });
  });

  it('parses a fully specified goldFarm and rejects bad values', () => {
    const cfg = parseConfig({
      ...VALID,
      mode: 'gold',
      goldFarm: {
        dungeons: ['hollow_crypt'],
        restBelowPct: 40,
        pullAbility: 'holy_light',
        keepQualities: ['epic'],
      },
    });
    expect(cfg.goldFarm).toEqual({
      dungeons: ['hollow_crypt'],
      restBelowPct: 40,
      pullAbility: 'holy_light',
      keepQualities: ['epic'],
    });
    expect(() => parseConfig({ ...VALID, goldFarm: { dungeons: [] } })).toThrow(
      /goldFarm\.dungeons/,
    );
    expect(() => parseConfig({ ...VALID, goldFarm: { dungeons: 'crypt' } })).toThrow(
      /goldFarm\.dungeons/,
    );
    expect(() => parseConfig({ ...VALID, goldFarm: { restBelowPct: 0 } })).toThrow(
      /goldFarm\.restBelowPct/,
    );
    expect(() => parseConfig({ ...VALID, goldFarm: { pullAbility: '' } })).toThrow(
      /goldFarm\.pullAbility/,
    );
    expect(() => parseConfig({ ...VALID, goldFarm: { keepQualities: ['common'] } })).toThrow(
      /goldFarm\.keepQualities/,
    );
    expect(() => parseConfig({ ...VALID, goldFarm: { keepQualities: [] } })).toThrow(
      /goldFarm\.keepQualities/,
    );
    expect(() => parseConfig({ ...VALID, goldFarm: { boss: true } })).toThrow(
      /goldFarm: unknown key 'boss'/,
    );
  });

  it('rejects invalid phase-1 fields', () => {
    expect(() => parseConfig({ ...VALID, mode: 'mine' })).toThrow(/mode/);
    expect(() => parseConfig({ ...VALID, zones: 'eastbrook_vale' })).toThrow(/zones/);
    expect(() => parseConfig({ ...VALID, zones: [''] })).toThrow(/zones/);
    expect(() => parseConfig({ ...VALID, nodePriority: ['fish'] })).toThrow(/nodePriority/);
    expect(() => parseConfig({ ...VALID, nodePriority: [] })).toThrow(/nodePriority/);
    expect(() => parseConfig({ ...VALID, nodeBlacklist: [1] })).toThrow(/nodeBlacklist/);
    expect(() => parseConfig({ ...VALID, nodeWhitelist: 'ore_eastbrook_1' })).toThrow(
      /nodeWhitelist/,
    );
    expect(() => parseConfig({ ...VALID, fishing: { spots: [{ x: 1 }] } })).toThrow(
      /fishing\.spots\[0\]/,
    );
    expect(() => parseConfig({ ...VALID, fishing: { spots: 'here' } })).toThrow(/fishing\.spots/);
    expect(() => parseConfig({ ...VALID, combat: { rotationMode: 'random' } })).toThrow(
      /combat\.rotationMode/,
    );
    expect(() => parseConfig({ ...VALID, combat: { grind: 'yes' } })).toThrow(/combat\.grind/);
    expect(() => parseConfig({ ...VALID, combat: { flee: 'always' } })).toThrow(/combat\.flee/);
    expect(() => parseConfig({ ...VALID, combat: { fleeAboveLevelDelta: -1 } })).toThrow(
      /combat\.fleeAboveLevelDelta/,
    );
    expect(() => parseConfig({ ...VALID, combat: { maxPullSize: 0 } })).toThrow(
      /combat\.maxPullSize/,
    );
    expect(() => parseConfig({ ...VALID, combat: { maxPullSize: 1.5 } })).toThrow(
      /combat\.maxPullSize/,
    );
    expect(() => parseConfig({ ...VALID, combat: { maxPullSize: '2' } })).toThrow(
      /combat\.maxPullSize/,
    );
    expect(() => parseConfig({ ...VALID, bags: { sellAllowlist: [1] } })).toThrow(
      /bags\.sellAllowlist/,
    );
    expect(() => parseConfig({ ...VALID, bags: { mailTo: '' } })).toThrow(/bags\.mailTo/);
    expect(() => parseConfig({ ...VALID, bags: { mailItems: 'some' } })).toThrow(/bags\.mailItems/);
    expect(() => parseConfig({ ...VALID, death: { waitUntilFull: 1 } })).toThrow(
      /death\.waitUntilFull/,
    );
    expect(() => parseConfig({ ...VALID, death: { maxDeaths: -1 } })).toThrow(/death\.maxDeaths/);
    expect(() => parseConfig({ ...VALID, death: { avoidDeathSpotMinutes: '30' } })).toThrow(
      /death\.avoidDeathSpotMinutes/,
    );
    expect(() => parseConfig({ ...VALID, safety: { whisperAction: 'panic' } })).toThrow(
      /safety\.whisperAction/,
    );
    expect(() => parseConfig({ ...VALID, safety: { webhookUrl: 4 } })).toThrow(
      /safety\.webhookUrl/,
    );
    expect(() => parseConfig({ ...VALID, safety: { playerPause: { radiusYd: 0 } } })).toThrow(
      /safety\.playerPause\.radiusYd/,
    );
    expect(() => parseConfig({ ...VALID, safety: { playerPause: { seconds: -2 } } })).toThrow(
      /safety\.playerPause\.seconds/,
    );
    expect(() => parseConfig({ ...VALID, safety: { schedule: { sessionMinutes: -1 } } })).toThrow(
      /safety\.schedule\.sessionMinutes/,
    );
    expect(() => parseConfig({ ...VALID, safety: { schedule: { breakAction: 'afk' } } })).toThrow(
      /safety\.schedule\.breakAction/,
    );
    expect(() => parseConfig({ ...VALID, death: [] })).toThrow(/death: must be an object/);
    expect(() => parseConfig({ ...VALID, safety: 3 })).toThrow(/safety: must be an object/);
  });

  it('rejects unknown keys in the new nested objects', () => {
    expect(() => parseConfig({ ...VALID, death: { waitUntilFull: true, spirits: 1 } })).toThrow(
      /death: unknown key 'spirits'/,
    );
    expect(() => parseConfig({ ...VALID, safety: { panic: true } })).toThrow(
      /safety: unknown key 'panic'/,
    );
    expect(() => parseConfig({ ...VALID, safety: { playerPause: { range: 9 } } })).toThrow(
      /safety\.playerPause: unknown key 'range'/,
    );
    expect(() => parseConfig({ ...VALID, safety: { schedule: { nap: 5 } } })).toThrow(
      /safety\.schedule: unknown key 'nap'/,
    );
    expect(() => parseConfig({ ...VALID, bags: { mailItems: 'all', junk: [] } })).toThrow(
      /bags: unknown key 'junk'/,
    );
    expect(() => parseConfig({ ...VALID, combat: { potion: 'x' } })).toThrow(
      /combat: unknown key 'potion'/,
    );
  });

  it('rejects a non-object top level', () => {
    expect(() => parseConfig(null)).toThrow(/top level must be a JSON object/);
    expect(() => parseConfig([])).toThrow(/top level must be a JSON object/);
    expect(() => parseConfig('cfg')).toThrow(/top level must be a JSON object/);
  });

  it('rejects missing or empty required strings', () => {
    expect(() => parseConfig({ characterName: 'A', zoneId: 'z' })).toThrow(/serverUrl/);
    expect(() => parseConfig({ ...VALID, characterName: '' })).toThrow(/characterName/);
    expect(() => parseConfig({ ...VALID, zoneId: 7 })).toThrow(/zoneId/);
  });

  it('rejects invalid nodeTypes', () => {
    expect(() => parseConfig({ ...VALID, nodeTypes: 'herb' })).toThrow(/nodeTypes/);
    expect(() => parseConfig({ ...VALID, nodeTypes: [] })).toThrow(/nodeTypes/);
    expect(() => parseConfig({ ...VALID, nodeTypes: ['herb', 'fish'] })).toThrow(/nodeTypes/);
    expect(() => parseConfig({ ...VALID, nodeTypes: [1] })).toThrow(/nodeTypes/);
  });

  it('rejects invalid maxNodeTier', () => {
    expect(() => parseConfig({ ...VALID, maxNodeTier: 0 })).toThrow(/maxNodeTier/);
    expect(() => parseConfig({ ...VALID, maxNodeTier: 1.5 })).toThrow(/maxNodeTier/);
    expect(() => parseConfig({ ...VALID, maxNodeTier: '2' })).toThrow(/maxNodeTier/);
  });

  it('rejects invalid fishing settings', () => {
    expect(() => parseConfig({ ...VALID, fishing: true })).toThrow(/fishing/);
    expect(() => parseConfig({ ...VALID, fishing: { enabled: 'yes' } })).toThrow(
      /fishing\.enabled/,
    );
    expect(() => parseConfig({ ...VALID, fishing: { enabled: true, spot: { x: 1 } } })).toThrow(
      /fishing\.spot/,
    );
    expect(() => parseConfig({ ...VALID, fishing: { enabled: true, castsPerSpot: 0 } })).toThrow(
      /fishing\.castsPerSpot/,
    );
  });

  it('rejects invalid combat settings', () => {
    expect(() => parseConfig({ ...VALID, combat: [] })).toThrow(/combat/);
    expect(() => parseConfig({ ...VALID, combat: { abilitySlots: [-1] } })).toThrow(
      /combat\.abilitySlots/,
    );
    expect(() => parseConfig({ ...VALID, combat: { abilitySlots: [0.5] } })).toThrow(
      /combat\.abilitySlots/,
    );
    expect(() => parseConfig({ ...VALID, combat: { eatItemId: '' } })).toThrow(/combat\.eatItemId/);
    expect(() => parseConfig({ ...VALID, combat: { drinkItemId: 3 } })).toThrow(
      /combat\.drinkItemId/,
    );
    expect(() => parseConfig({ ...VALID, combat: { eatBelowHpPct: 0 } })).toThrow(
      /combat\.eatBelowHpPct/,
    );
    expect(() => parseConfig({ ...VALID, combat: { drinkBelowManaPct: 101 } })).toThrow(
      /combat\.drinkBelowManaPct/,
    );
  });

  it('rejects invalid bags policy', () => {
    expect(() => parseConfig({ ...VALID, bags: 'stop' })).toThrow(/bags/);
    expect(() => parseConfig({ ...VALID, bags: { fullPolicy: 'mail' } })).toThrow(
      /bags\.fullPolicy/,
    );
  });

  it('rejects invalid maxRuntimeMinutes', () => {
    expect(() => parseConfig({ ...VALID, maxRuntimeMinutes: -1 })).toThrow(/maxRuntimeMinutes/);
    expect(() => parseConfig({ ...VALID, maxRuntimeMinutes: '60' })).toThrow(/maxRuntimeMinutes/);
  });

  it('rejects unknown keys', () => {
    expect(() => parseConfig({ ...VALID, serverURL: 'x' })).toThrow(/unknown key 'serverURL'/);
    expect(() => parseConfig({ ...VALID, bags: { fullPolicy: 'stop', extra: 1 } })).toThrow(
      /bags: unknown key 'extra'/,
    );
  });

  it('never accepts credentials from the config file', () => {
    expect(() => parseConfig({ ...VALID, password: 'hunter2' })).toThrow(/unknown key 'password'/);
  });

  it('lists every problem in one error', () => {
    let message = '';
    try {
      parseConfig({ zoneId: 'z', maxNodeTier: 0, bags: { fullPolicy: 'nope' } });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/serverUrl/);
    expect(message).toMatch(/characterName/);
    expect(message).toMatch(/maxNodeTier/);
    expect(message).toMatch(/bags\.fullPolicy/);
  });
});
