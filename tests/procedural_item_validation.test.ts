import { describe, expect, it } from 'vitest';
import { PROCEDURAL_LEGENDARY_POWERS } from '../src/sim/content/procedural_legendary_powers';
import {
  deriveProceduralItemSeed,
  formatProceduralItemUid,
  generateProceduralItem,
} from '../src/sim/loot/procedural';
import type { ItemDropContext } from '../src/sim/procedural_item';
import {
  duplicateProceduralItemUids,
  sanitizeItemInstancePayload,
  sanitizeProceduralItemInstance,
} from '../src/sim/procedural_item_validation';

const DROP_CONTEXT: ItemDropContext = {
  source: 'dungeon',
  sourceEntityId: 22,
  sourceSpawnSequence: 5,
  lootSlotIndex: 1,
  sourceTemplateId: 'validation_boss',
  sourceTags: ['boss'],
};

function validPayload() {
  const seed = deriveProceduralItemSeed(99, DROP_CONTEXT);
  return generateProceduralItem({
    seed,
    uid: formatProceduralItemUid('validation', 1),
    context: DROP_CONTEXT,
    basePoolId: 'initial_all',
    rarityTableId: 'initial_dungeon_boss',
    sourceItemLevel: 20,
    forcedBaseId: 'gravecaller_ring',
    forcedRarity: 'rare',
  }).instance;
}

function validLegendaryPayload(baseId = 'gravecaller_ring') {
  const seed = deriveProceduralItemSeed(199, DROP_CONTEXT);
  return generateProceduralItem({
    seed,
    uid: formatProceduralItemUid('validation-legendary', baseId.length),
    context: DROP_CONTEXT,
    basePoolId: 'initial_all',
    rarityTableId: 'initial_dungeon_boss',
    sourceItemLevel: 20,
    forcedBaseId: baseId,
    forcedRarity: 'legendary',
  }).instance;
}

function mutatedFixture(index: number): unknown {
  const payload = structuredClone(validPayload()) as unknown as {
    procedural: Record<string, unknown> & {
      affixes: Array<Record<string, unknown>>;
      generatedName: Record<string, unknown>;
      dropContext: Record<string, unknown>;
    };
  };
  const item = payload.procedural;
  const affix = item.affixes[0];
  const mutation = index % 16;
  if (mutation === 0) item.version = 999;
  else if (mutation === 1) item.uid = `bad uid ${index}`;
  else if (mutation === 2) item.baseId = 'unknown_base';
  else if (mutation === 3) item.itemLevel = Number.NaN;
  else if (mutation === 4) item.rarity = 'mythic';
  else if (mutation === 5) item.seed = Number.POSITIVE_INFINITY;
  else if (mutation === 6) item.affixes = [...item.affixes, ...item.affixes, ...item.affixes];
  else if (mutation === 7) item.affixes[1] = { ...structuredClone(affix), affixId: affix.affixId };
  else if (mutation === 8) affix.affixId = `unknown_${index}`;
  else if (mutation === 9) affix.family = `tampered_${index}`;
  else if (mutation === 10) affix.values = { unknownStat: 1 };
  else if (mutation === 11) affix.ranges = { int: { min: 999, max: -999 } };
  else if (mutation === 12) item.generatedName = { baseId: 'wrong_base' };
  else if (mutation === 13) item.dropContext.sourceEntityId = -1;
  else if (mutation === 14)
    item.dropContext.sourceTags = Array.from({ length: 32 }, (_, i) => `tag_${i}`);
  else item.legendaryPowerId = `inactive_${index}`;
  return payload;
}

describe('procedural item validation', () => {
  it('accepts and reconstructs a valid generated payload', () => {
    const payload = validPayload();
    const result = sanitizeItemInstancePayload(payload, 'gravecaller_ring');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(payload);
    expect(result.value).not.toBe(payload);
    expect(result.value.procedural).not.toBe(payload.procedural);
  });

  it('rejects a procedural base that disagrees with its container item id', () => {
    const result = sanitizeItemInstancePayload(validPayload(), 'iron_broadsword');
    expect(result).toEqual({
      ok: false,
      error: 'procedural base does not match container item id',
    });
  });

  it('rejects 2,048 deterministic hostile payload mutations', () => {
    let rejected = 0;
    for (let index = 0; index < 2048; index++) {
      const result = sanitizeItemInstancePayload(mutatedFixture(index), 'gravecaller_ring');
      if (!result.ok) rejected++;
    }
    expect(rejected).toBe(2048);
  });

  it('accepts a generated legendary and rejects malformed power identity and revision', () => {
    const valid = validLegendaryPayload();
    expect(sanitizeItemInstancePayload(valid, 'gravecaller_ring').ok).toBe(true);

    const unknown = structuredClone(valid);
    unknown.procedural.legendaryPowerId = 'unknown_power';
    expect(sanitizeItemInstancePayload(unknown, 'gravecaller_ring')).toEqual({
      ok: false,
      error: 'unknown legendary power',
    });

    const revision = structuredClone(valid);
    revision.procedural.powerRevision = 2;
    expect(sanitizeItemInstancePayload(revision, 'gravecaller_ring')).toEqual({
      ok: false,
      error: 'unsupported legendary power revision',
    });
  });

  it('rejects incompatible bases, mismatched names, and non-exact roll-key sets', () => {
    const incompatible = validLegendaryPayload('iron_broadsword');
    incompatible.procedural.legendaryPowerId = 'crown_last_pyre';
    incompatible.procedural.powerRevision = 1;
    incompatible.procedural.legendaryRolls = { potencyPct: 14 };
    incompatible.procedural.generatedName = {
      baseId: 'iron_broadsword',
      legendaryNameId: 'crown_last_pyre',
    };
    expect(sanitizeItemInstancePayload(incompatible, 'iron_broadsword')).toEqual({
      ok: false,
      error: 'legendary power is incompatible with base',
    });

    const wrongName = validLegendaryPayload();
    wrongName.procedural.generatedName.legendaryNameId = 'wrong_name';
    expect(sanitizeItemInstancePayload(wrongName, 'gravecaller_ring')).toEqual({
      ok: false,
      error: 'legendary generated name does not match power',
    });

    const missing = validLegendaryPayload();
    missing.procedural.legendaryRolls = {};
    expect(sanitizeItemInstancePayload(missing, 'gravecaller_ring')).toEqual({
      ok: false,
      error: 'legendary roll keys do not match power',
    });

    const extra = validLegendaryPayload();
    extra.procedural.legendaryRolls = { ...extra.procedural.legendaryRolls, injected: 1 };
    expect(sanitizeItemInstancePayload(extra, 'gravecaller_ring')).toEqual({
      ok: false,
      error: 'legendary roll keys do not match power',
    });
  });

  it('rejects non-finite, out-of-range, and non-quantized legendary rolls', () => {
    const durationPower = PROCEDURAL_LEGENDARY_POWERS.hushwood_longbow;
    const baseId = 'mirefen_hunting_bow';
    const fixture = validLegendaryPayload(baseId);
    fixture.procedural.legendaryPowerId = durationPower.id;
    fixture.procedural.powerRevision = durationPower.revision;
    fixture.procedural.generatedName.legendaryNameId = durationPower.id;

    const nonFinite = structuredClone(fixture);
    nonFinite.procedural.legendaryRolls = { durationMs: Number.NaN };
    expect(sanitizeItemInstancePayload(nonFinite, baseId)).toEqual({
      ok: false,
      error: 'invalid legendary roll durationMs',
    });

    const outOfRange = structuredClone(fixture);
    outOfRange.procedural.legendaryRolls = { durationMs: 1300 };
    expect(sanitizeItemInstancePayload(outOfRange, baseId)).toEqual({
      ok: false,
      error: 'invalid legendary roll durationMs',
    });

    const nonQuantized = structuredClone(fixture);
    nonQuantized.procedural.legendaryRolls = { durationMs: 850 };
    expect(sanitizeItemInstancePayload(nonQuantized, baseId)).toEqual({
      ok: false,
      error: 'legendary roll durationMs is not quantized',
    });
  });

  it('rejects every legendary-only field on non-legendary payloads', () => {
    const mutations: Array<(payload: ReturnType<typeof validPayload>) => void> = [
      (payload) => {
        payload.procedural.legendaryPowerId = 'crown_last_pyre';
      },
      (payload) => {
        payload.procedural.powerRevision = 1;
      },
      (payload) => {
        payload.procedural.legendaryRolls = { potencyPct: 14 };
      },
      (payload) => {
        payload.procedural.generatedName.legendaryNameId = 'crown_last_pyre';
      },
    ];
    for (const mutate of mutations) {
      const payload = validPayload();
      mutate(payload);
      expect(sanitizeItemInstancePayload(payload, 'gravecaller_ring')).toEqual({
        ok: false,
        error: 'non-legendary item carries legendary power fields',
      });
    }
  });

  it('preserves bounded legacy stat aliases and blocks malformed injection', () => {
    expect(
      sanitizeItemInstancePayload({
        rolled: { stats: { spellPower: 5, atk: 3 } },
      }),
    ).toEqual({
      ok: true,
      value: { rolled: { stats: { spellPower: 5, atk: 3 } } },
    });
    expect(
      sanitizeItemInstancePayload({
        rolled: { stats: { int: Number.POSITIVE_INFINITY } },
      }),
    ).toEqual({ ok: false, error: 'invalid legacy rolled stats' });
    expect(
      sanitizeItemInstancePayload({
        rolled: { stats: { attackPower: 999999 } },
      }),
    ).toEqual({ ok: false, error: 'invalid legacy rolled stats' });
    expect(
      sanitizeItemInstancePayload({
        rolled: { stats: { '__proto__.polluted': 1 } },
      }),
    ).toEqual({ ok: false, error: 'invalid legacy rolled stats' });
  });

  it('strips unknown payload keys while retaining allowlisted legacy fields', () => {
    const result = sanitizeItemInstancePayload({
      signer: 'Ayla',
      charges: { bell: 2 },
      rolled: { quality: 'rare', stats: { int: 2 }, masterwork: true },
      enchant: 'greater_intellect',
      boundTo: 7,
      bindOnTrade: true,
      unknown: { dangerous: true },
    });
    expect(result).toEqual({
      ok: true,
      value: {
        signer: 'Ayla',
        charges: { bell: 2 },
        rolled: { quality: 'rare', stats: { int: 2 }, masterwork: true },
        enchant: 'greater_intellect',
        boundTo: 7,
        bindOnTrade: true,
      },
    });
  });

  it('detects duplicate UIDs across bags, bank, buyback, and equipment', () => {
    const first = validPayload();
    const second = structuredClone(first);
    second.procedural.uid = formatProceduralItemUid('validation', 2);
    expect(
      duplicateProceduralItemUids({
        inventory: [{ itemId: 'gravecaller_ring', count: 1, instance: first }],
        bank: [{ itemId: 'gravecaller_ring', count: 1, instance: second }],
        buyback: [{ itemId: 'gravecaller_ring', count: 1, instance: first }],
        equipmentInstance: { ring1: second },
      }),
    ).toEqual(['pi1:validation:1', 'pi1:validation:2']);
  });

  it('accepts a validated procedural instance directly', () => {
    const payload = validPayload();
    const result = sanitizeProceduralItemInstance(payload.procedural, 'gravecaller_ring');
    expect(result.ok).toBe(true);
  });
});
