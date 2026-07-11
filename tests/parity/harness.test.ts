// Direct unit tests for the harness primitives — the samplers, canonicalization,
// and the rng draw-order log — independent of the golden gate.

import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/sim/rng';
import { Sim } from '../../src/sim/sim';
import { recordTrace } from './record';
import { SCENARIOS } from './scenarios';
import {
  canonical,
  digest,
  ENTITY_EXCLUDE,
  META_EXCLUDE,
  round6,
  sampleEntity,
  samplePlayerMeta,
} from './trace';

describe('round6 / non-finite handling', () => {
  it('quantizes floats to 1e-6 and passes ints through', () => {
    expect(round6(1 / 3)).toBe(0.333333);
    expect(round6(5)).toBe(5);
    expect(round6(-2.0000004)).toBe(-2); // below the quantum
  });
  it('maps non-finite numbers to JSON-safe sentinels', () => {
    expect(round6(Infinity)).toBe('Infinity');
    expect(round6(-Infinity)).toBe('-Infinity');
    expect(round6(NaN)).toBe('NaN');
  });
});

describe('canonical', () => {
  it('sorts Map entries by key and Set elements deterministically', () => {
    const m = new Map<string, number>([
      ['b', 2],
      ['a', 1],
    ]);
    expect(canonical(m)).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
    expect(canonical(new Set(['z', 'a', 'm']))).toEqual(['a', 'm', 'z']);
  });
  it('sorts numeric Map keys numerically (not lexically)', () => {
    const m = new Map<number, number>([
      [10, 1],
      [2, 1],
    ]);
    expect(canonical(m)).toEqual([
      [2, 1],
      [10, 1],
    ]);
  });
  it('omits inert default keys but keeps array length', () => {
    expect(canonical({ a: 0, b: false, c: null, d: '', e: 1 })).toEqual({ e: 1 });
    expect(canonical([{ a: 0 }, { b: 1 }])).toEqual([{}, { b: 1 }]);
  });
  it('serializes Infinity as a sentinel, never null', () => {
    expect(canonical({ t: Infinity })).toEqual({ t: 'Infinity' });
  });
});

describe('samplePlayerMeta', () => {
  function freshMeta() {
    const sim = new Sim({ seed: 5, playerClass: 'warrior', autoEquip: true });
    return sim.players.get(sim.playerId)!;
  }

  it('captures deterministic character-sheet fields when they hold values', () => {
    // counters/xp/copper are inert (zero) on a fresh character and so are
    // correctly omitted; give them values to prove they are sampled when set.
    const meta = freshMeta();
    meta.copper = 500;
    meta.xp = 42;
    meta.counters.kills = 3;
    const sample = samplePlayerMeta(meta) as Record<string, unknown>;
    for (const key of ['cls', 'equipment', 'copper', 'xp', 'counters']) {
      expect(Object.keys(sample)).toContain(key);
    }
  });

  it('excludes every session / presentation / derived field', () => {
    const sample = samplePlayerMeta(freshMeta()) as Record<string, unknown>;
    for (const excluded of META_EXCLUDE) {
      expect(Object.keys(sample)).not.toContain(excluded);
    }
  });

  it('changes its digest when a sampled field changes', () => {
    const meta = freshMeta();
    const before = digest(samplePlayerMeta(meta));
    meta.copper += 100;
    const after = digest(samplePlayerMeta(meta));
    expect(after).not.toBe(before);
  });

  it('is a value snapshot, not a live reference', () => {
    const meta = freshMeta();
    const snapshot = samplePlayerMeta(meta);
    const frozen = digest(snapshot);
    meta.copper += 999; // mutate the live meta after sampling
    expect(digest(snapshot)).toBe(frozen); // snapshot is unaffected
  });
});

describe('sampleEntity', () => {
  it('captures gameplay fields and excludes presentation', () => {
    const sim = new Sim({ seed: 7, playerClass: 'mage', autoEquip: true });
    const sample = sampleEntity(sim.player) as Record<string, unknown>;
    expect(Object.keys(sample)).toContain('hp');
    expect(Object.keys(sample)).toContain('pos');
    for (const excluded of ENTITY_EXCLUDE) {
      expect(Object.keys(sample)).not.toContain(excluded);
    }
  });

  it('is a value snapshot, not a live reference', () => {
    const sim = new Sim({ seed: 7, playerClass: 'mage', autoEquip: true });
    const snapshot = sampleEntity(sim.player);
    const frozen = digest(snapshot);
    sim.player.hp -= 50;
    expect(digest(snapshot)).toBe(frozen);
  });
});

describe('exclude lists are pinned and real (anti-loosening guard)', () => {
  // Pinning the sorted membership means a field cannot be quietly ADDED to an
  // exclude list to drop it from the golden and mask drift: doing so reddens this
  // test, forcing a deliberate, reviewable change (the brief's "no loosening the
  // gate" rule). Update these snapshots only when intentionally re-categorizing.
  it('ENTITY_EXCLUDE membership is exactly the pinned set', () => {
    expect([...ENTITY_EXCLUDE].sort()).toEqual([
      'color',
      'equippedInstances',
      'equippedItems',
      'guild',
      'holderBalance',
      'holderTier',
      'mainhandItemId',
      'name',
      'netInterval',
      'netUpdatedAt',
      'overheadEmoteId',
      'overheadEmoteSeq',
      'overheadEmoteUntil',
      'potionCdRemaining',
      'prevFacing',
      'prevPos',
      'scale',
      'skin',
      'skinCatalog',
      'stealthed',
      'vx',
      'vy',
      'vz',
    ]);
  });

  it('META_EXCLUDE membership is exactly the pinned set', () => {
    expect([...META_EXCLUDE].sort()).toEqual([
      'away',
      'bankBonusSources',
      'characterId',
      'fiestaMods',
      'fiestaSpecial',
      'joinedAt',
      'known',
      'lastActiveTick',
      'lastWhisperFrom',
      'marketQuery',
      'moveInput',
      'name',
      'pendingSkinCatalog',
      'pendingSkinItemId',
      'pendingSkinRank',
      'skin',
      'skinCatalog',
      'talentMods',
      'wireRev',
    ]);
  });

  it('every always-present excluded name is a real field (catches silent renames)', () => {
    const sim = new Sim({ seed: 9, playerClass: 'warrior', autoEquip: true });
    const entity = sim.player as unknown as Record<string, unknown>;
    const meta = sim.players.get(sim.playerId)! as unknown as Record<string, unknown>;
    // Optional fields that are legitimately absent on a fresh entity/meta.
    const optionalEntity = new Set(['netUpdatedAt', 'netInterval', 'holderTier', 'holderBalance']);
    const optionalMeta = new Set(['characterId', 'lastWhisperFrom']);
    for (const k of ENTITY_EXCLUDE) {
      if (!optionalEntity.has(k)) expect(k in entity, `Entity.${k} missing (renamed?)`).toBe(true);
    }
    for (const k of META_EXCLUDE) {
      if (!optionalMeta.has(k)) expect(k in meta, `PlayerMeta.${k} missing (renamed?)`).toBe(true);
    }
  });
});

describe('rng draw-order observer (src/sim/rng.ts)', () => {
  it('is default-off: an unobserved Rng matches one whose observer was set then cleared', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    b.setObserver(() => {
      /* no-op observer */
    });
    b.setObserver(null);
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next());
  });

  it('reports every draw in order and stops when cleared', () => {
    const rng = new Rng(999);
    const seen: number[] = [];
    rng.setObserver((v) => seen.push(v));
    const drawn = [
      rng.next(),
      rng.range(0, 10),
      rng.int(1, 6),
      rng.chance(0.5) ? 1 : 0,
      rng.pick([1, 2, 3]),
    ];
    expect(seen.length).toBe(5); // one observer call per draw (range/int/chance/pick each draw once)
    expect(seen[0]).toBe(drawn[0]);
    rng.setObserver(null);
    rng.next();
    expect(seen.length).toBe(5); // cleared: no further capture
  });
});

describe('draw-order digest in the trace', () => {
  it('is deterministic for the same scenario', () => {
    const scenario = SCENARIOS[0];
    const a = recordTrace(scenario);
    const b = recordTrace(scenario);
    expect(a.draws).toBe(b.draws);
    expect(a.drawDigest).toBe(b.drawDigest);
    expect(a.draws).toBeGreaterThan(0);
  });

  it('differs across scenarios with different draw sequences', () => {
    const warrior = recordTrace(SCENARIOS.find((s) => s.name === 'solo_warrior')!);
    const mage = recordTrace(SCENARIOS.find((s) => s.name === 'solo_mage')!);
    expect(warrior.drawDigest).not.toBe(mage.drawDigest);
  });
});
