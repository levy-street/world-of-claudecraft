// Buffs persist through a logout (src/sim/aura_persist.ts). They used to be
// session-only: serializeCharacter wrote no auras key, so food, elixirs,
// flasks, and every class buff a group had cast vanished on relog. The leaf
// saves each allowlisted buff as its remaining seconds and the reload resumes
// from exactly that remaining (timers freeze while offline, the classic rule),
// re-anchoring self-cast buffs to the new entity id and bringing a buff someone
// else cast back unattributed, which any same-id application then replaces.

import { describe, expect, it } from 'vitest';
import {
  auraSaveFragment,
  buildPersistedAuraAllowlist,
  isPersistableAura,
  MAX_PERSISTED_AURA_SECONDS,
  MAX_PERSISTED_AURAS,
  restorePersistedAuras,
  type SavedAura,
  serializePersistedAuras,
} from '../src/sim/aura_persist';
import { auraReplacementConflicts, RESTORED_AURA_SOURCE_ID } from '../src/sim/combat/aura_stacking';
import { paladinDevotionConflicts } from '../src/sim/combat/paladin_support';
import { ARENA_X, BG_X, ITEMS, YUMI_BAND_X_MIN } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { Aura, Entity } from '../src/sim/types';
import { WELL_FED_AURA_ID } from '../src/sim/wellfed';
import { EMPTY_TEST_WORLD } from './sim_shared';

function world(cls: 'warrior' | 'priest' = 'warrior', seed = 42) {
  const sim = new Sim({ seed, playerClass: cls, autoEquip: false, world: EMPTY_TEST_WORLD });
  const pid = sim.playerId;
  sim.tick();
  return { sim, pid, p: sim.entities.get(pid) as Entity };
}

function reload(state: ReturnType<Sim['serializeCharacter']>, cls: 'warrior' | 'priest') {
  const sim = new Sim({ seed: 7, playerClass: cls, noPlayer: true, world: EMPTY_TEST_WORLD });
  const pid = sim.addPlayer(cls, 'Restored', { state: state! });
  return { sim, pid, p: sim.entities.get(pid) as Entity };
}

function aura(over: Partial<Aura> & Pick<Aura, 'id' | 'kind'>): Aura {
  return {
    name: over.id,
    remaining: 300,
    duration: 1800,
    value: 5,
    sourceId: 1,
    school: 'holy',
    ...over,
  };
}

const byId = (p: Entity, id: string): Aura[] => p.auras.filter((a) => a.id === id);

describe('aura_persist: the content-derived allowlist', () => {
  const allow = buildPersistedAuraAllowlist();

  it('lists the consumable buffs and the class maintenance buffs', () => {
    expect([...(allow.get(WELL_FED_AURA_ID) ?? [])].sort()).toEqual([
      'buff_ap',
      'buff_int',
      'buff_sta',
    ]);
    expect(allow.get('elixir_buff_sta')?.has('buff_sta')).toBe(true);
    expect(allow.get('elixir_buff_ap')?.has('buff_ap')).toBe(true);
    expect(allow.get('elixir_buff_int')?.has('buff_int')).toBe(true);
    expect(allow.get('power_word_fortitude')?.has('buff_sta_pct')).toBe(true);
    expect(allow.get('arcane_intellect')?.has('buff_int_pct')).toBe(true);
    expect(allow.get('mark_of_the_wild')?.has('buff_stats_pct')).toBe(true);
    expect(allow.get('battle_shout')?.has('buff_ap_pct')).toBe(true);
    expect(allow.get('blessing_of_might')?.has('buff_ap_pct')).toBe(true);
    expect(allow.get('thorns')?.has('thorns')).toBe(true);
    expect(allow.get('frost_armor')?.has('buff_armor')).toBe(true);
    expect(allow.get('trueshot_aura_ap')?.has('buff_ap_pct')).toBe(true);
  });

  it('never lists toggles, debuffs, movement buffs, or short combat cooldowns', () => {
    for (const id of [
      'battle_stance',
      'defensive_stance',
      'bear_form',
      'cat_form',
      'moonkin_form',
      'stealth',
      'prowl',
      'ghost_wolf',
      'shadowform',
      // A buffTarget that mints a DEBUFF kind: the kind check must reject it.
      'mortal_strike',
      // buff_speed is not a persisted kind.
      'aspect_of_the_cheetah',
      // 15 seconds: a cooldown, not a maintenance buff.
      'power_infusion',
      // A five-minute group burst whose haste half is not persistable: keeping
      // the AP half alone would split the buff.
      'aspect_of_the_wild_ap',
    ]) {
      expect(allow.has(id), id).toBe(false);
    }
    expect(allow.has('resurrection_sickness')).toBe(false);
    expect(allow.has('unstuck_sickness')).toBe(false);
  });

  it('every shipped consumable buff persists (none drops through the kind filter)', () => {
    let checked = 0;
    for (const item of Object.values(ITEMS)) {
      const wellFed = 'wellFed' in item ? item.wellFed : undefined;
      if (wellFed) {
        expect(allow.get(WELL_FED_AURA_ID)?.has(wellFed.kind), item.id).toBe(true);
        checked++;
      }
      if (item.elixir) {
        expect(allow.get(`elixir_${item.elixir.kind}`)?.has(item.elixir.kind), item.id).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });
});

describe('aura_persist: the pure save and restore pair', () => {
  it('keeps only allowlisted, timed, helpful buffs', () => {
    const wearer = 10;
    const auras = [
      aura({ id: 'power_word_fortitude', kind: 'buff_sta_pct' }),
      aura({ id: 'battle_stance', kind: 'battle_stance' }),
      aura({ id: 'power_word_fortitude', kind: 'buff_sta_pct', value: -5 }),
      aura({ id: 'arcane_intellect', kind: 'buff_int_pct', permanent: true }),
      aura({ id: 'mark_of_the_wild', kind: 'buff_stats_pct', encounterOwned: true }),
      aura({ id: 'arcane_intellect', kind: 'buff_spellpower' }),
      aura({ id: 'mark_of_the_wild', kind: 'buff_stats_pct', remaining: 0 }),
    ];
    expect(auras.map(isPersistableAura)).toEqual([true, false, false, false, false, false, false]);
    const saved = serializePersistedAuras(auras, wearer)!;
    expect(saved.map((s) => s.id)).toEqual(['power_word_fortitude']);
  });

  it('returns undefined with nothing to keep (zero-default omission)', () => {
    expect(serializePersistedAuras([], 1)).toBeUndefined();
    expect(
      serializePersistedAuras([aura({ id: 'battle_stance', kind: 'battle_stance' })], 1),
    ).toBeUndefined();
  });

  it('round-trips remaining time and re-anchors the caster', () => {
    const oldId = 10;
    const newId = 77;
    const saved = serializePersistedAuras(
      [
        aura({
          id: WELL_FED_AURA_ID,
          kind: 'buff_sta',
          value: 2,
          sourceId: oldId,
          remaining: 412.3,
        }),
        aura({ id: 'power_word_fortitude', kind: 'buff_sta_pct', sourceId: 55, remaining: 900 }),
        aura({
          id: 'elixir_buff_sta',
          kind: 'buff_sta',
          value: 13,
          sourceId: oldId,
          flask: true,
          undispellable: true,
        }),
      ],
      oldId,
    )!;
    expect(saved.map((s) => s.self === true)).toEqual([true, false, true]);
    const restored = restorePersistedAuras(saved, newId);
    expect(restored.map((a) => a.remaining)).toEqual([412.3, 900, 300]);
    expect(restored.map((a) => a.sourceId)).toEqual([newId, RESTORED_AURA_SOURCE_ID, newId]);
    expect(restored[2].flask).toBe(true);
    expect(restored[2].undispellable).toBe(true);
    expect(restored[0].flask).toBeUndefined();
  });

  it('caps the list, clamps times, and drops records it cannot trust', () => {
    const many = Array.from({ length: MAX_PERSISTED_AURAS + 5 }, () =>
      aura({ id: 'power_word_fortitude', kind: 'buff_sta_pct' }),
    );
    expect(serializePersistedAuras(many, 1)).toHaveLength(MAX_PERSISTED_AURAS);

    const base: SavedAura = {
      id: 'power_word_fortitude',
      name: 'Litany of Resolve',
      kind: 'buff_sta_pct',
      remaining: 600,
      duration: 1800,
      value: 5,
      school: 'holy',
    };
    const restored = restorePersistedAuras(
      [
        base,
        { ...base, id: 'arcane_intellect', kind: 'buff_int_pct', remaining: 5000, duration: 99999 },
        { ...base, id: 'retired_buff' },
        { ...base, kind: 'buff_spellpower' },
        { ...base, remaining: Number.NaN },
        { ...base, value: -5 },
        { ...base, school: 'chaos' as SavedAura['school'] },
        null,
        'junk',
      ],
      3,
    );
    expect(restored).toHaveLength(2);
    expect(restored[1].duration).toBe(MAX_PERSISTED_AURA_SECONDS);
    expect(restored[1].remaining).toBe(5000);
    expect(restorePersistedAuras(undefined, 3)).toEqual([]);
    // A repeated id from one source keeps the later copy, in its place.
    const dupes = restorePersistedAuras(
      [
        { ...base, remaining: 100 },
        { ...base, id: 'arcane_intellect', kind: 'buff_int_pct' },
        { ...base, remaining: 200 },
      ],
      3,
    );
    expect(dupes.map((a) => [a.id, a.remaining])).toEqual([
      ['arcane_intellect', 600],
      ['power_word_fortitude', 200],
    ]);
    expect(restorePersistedAuras({ not: 'an array' }, 3)).toEqual([]);
  });

  it('writes no buffs inside an instanced match or a Fiesta bout', () => {
    const auras = [aura({ id: 'power_word_fortitude', kind: 'buff_sta_pct' })];
    const at = (x: number) => ({ auras, id: 1, pos: { x, y: 0, z: 0 } });
    expect(auraSaveFragment(at(0), false).auras).toHaveLength(1);
    expect(auraSaveFragment(at(0), true).auras).toBeUndefined();
    expect(auraSaveFragment(at(ARENA_X), false).auras).toBeUndefined();
    expect(auraSaveFragment(at(BG_X), false).auras).toBeUndefined();
    expect(auraSaveFragment(at(YUMI_BAND_X_MIN + 1), false).auras).toBeUndefined();
    // The sickness fields are written either way.
    expect(auraSaveFragment(at(ARENA_X), false)).toEqual({
      resSickness: null,
      unstuckSickness: null,
    });
  });
});

describe('aura_persist: caster-bound paladin devotions', () => {
  it('persists a devotion only when the wearer is its own paladin', () => {
    const wearer = 10;
    const own = aura({ id: 'radiant_devotion', kind: 'buff_spellpower', sourceId: wearer });
    const foreign = aura({ id: 'dawn_devotion', kind: 'buff_ap', sourceId: 55 });
    const saved = serializePersistedAuras([own, foreign], wearer)!;
    expect(saved.map((a) => [a.id, a.self])).toEqual([['radiant_devotion', true]]);
    // A save that carries a foreign devotion anyway is refused on load.
    const { self: _self, ...asForeign } = saved[0];
    expect(restorePersistedAuras([asForeign], 77)).toEqual([]);
  });

  it("a restored own devotion is still swapped out by that paladin's next choice", () => {
    const saved = serializePersistedAuras(
      [aura({ id: 'radiant_devotion', kind: 'buff_spellpower', sourceId: 10 })],
      10,
    );
    const restored = restorePersistedAuras(saved, 77);
    expect(paladinDevotionConflicts(restored, 77, 'dawn_devotion')).toEqual([0]);
  });
});

describe('aura_persist: an unattributed restored copy never stacks', () => {
  it('any same-id application replaces it, whoever casts', () => {
    const restored = aura({ id: 'thorns', kind: 'thorns', sourceId: RESTORED_AURA_SOURCE_ID });
    const other = aura({ id: 'thorns', kind: 'thorns', sourceId: 99 });
    expect(auraReplacementConflicts([restored], { ...other, sourceId: 42 })).toEqual([0]);
    // A live copy from another caster still coexists, exactly as before.
    expect(auraReplacementConflicts([other], { ...other, sourceId: 42 })).toEqual([]);
  });
});

describe('aura_persist: the live Sim round trip', () => {
  it('a quaffed flask survives the relog with its markers and remaining time', () => {
    const { sim, pid, p } = world();
    sim.addItem('ironhusk_flask', 1, pid);
    sim.useItem('ironhusk_flask', pid);
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    const live = byId(p, 'elixir_buff_sta')[0];
    expect(live?.flask).toBe(true);

    const state = sim.serializeCharacter(pid);
    const r = reload(state, 'warrior');
    const back = byId(r.p, 'elixir_buff_sta');
    expect(back).toHaveLength(1);
    expect(back[0].flask).toBe(true);
    expect(back[0].undispellable).toBe(true);
    expect(back[0].remaining).toBeCloseTo(live.remaining, 2);
    expect(back[0].sourceId).toBe(r.pid);
  });

  it('a class buff survives the relog and its stats fold before hp restores', () => {
    const { sim, pid, p } = world('priest');
    const unbuffedMax = p.maxHp;
    sim.castAbility('power_word_fortitude', pid);
    for (let i = 0; i < 20 * 2; i++) sim.tick();
    expect(byId(p, 'power_word_fortitude')).toHaveLength(1);
    expect(p.maxHp).toBeGreaterThan(unbuffedMax);
    p.hp = p.maxHp;

    const state = sim.serializeCharacter(pid)!;
    expect(state.auras?.map((a) => a.id)).toEqual(['power_word_fortitude']);
    const r = reload(state, 'priest');
    expect(byId(r.p, 'power_word_fortitude')).toHaveLength(1);
    expect(r.p.maxHp).toBe(p.maxHp);
    // Restored before the stat pass, so a full-health save is not clamped to
    // the unbuffed pool.
    expect(r.p.hp).toBe(p.maxHp);
  });

  it('a buff another player cast comes back unattributed and a recast replaces it', () => {
    const { sim, pid, p } = world();
    const fort = {
      id: 'power_word_fortitude',
      name: 'Litany of Resolve',
      kind: 'buff_sta_pct' as const,
      remaining: 1500,
      duration: 1800,
      value: 5,
      sourceId: 4242,
      school: 'holy' as const,
    };
    // biome-ignore lint/suspicious/noExplicitAny: reach the private aura funnel
    (sim as any).applyAura(p, { ...fort });
    const r = reload(sim.serializeCharacter(pid), 'warrior');
    expect(byId(r.p, fort.id).map((a) => a.sourceId)).toEqual([RESTORED_AURA_SOURCE_ID]);
    const restoredMax = r.p.maxHp;
    // biome-ignore lint/suspicious/noExplicitAny: reach the private aura funnel
    (r.sim as any).applyAura(r.p, { ...fort, remaining: 1800, sourceId: 999 });
    expect(byId(r.p, fort.id).map((a) => a.sourceId)).toEqual([999]);
    expect(r.p.maxHp).toBe(restoredMax);
  });

  it('keeps the persisted buffs in their pre-save order after the class stance', () => {
    const { sim, pid, p } = world();
    const buff = (id: string, kind: Aura['kind'], sourceId: number): Aura =>
      aura({ id, kind, sourceId, remaining: 900, school: 'nature' });
    for (const a of [
      buff('arcane_intellect', 'buff_int_pct', 4242),
      buff(WELL_FED_AURA_ID, 'buff_sta', pid),
      buff('power_word_fortitude', 'buff_sta_pct', 4243),
      buff('elixir_buff_ap', 'buff_ap', pid),
    ]) {
      // biome-ignore lint/suspicious/noExplicitAny: reach the private aura funnel
      (sim as any).applyAura(p, a);
    }
    const persisted = p.auras.filter(isPersistableAura).map((a) => a.id);
    const r = reload(sim.serializeCharacter(pid), 'warrior');
    expect(r.p.auras.map((a) => a.id)).toEqual(['battle_stance', ...persisted]);
  });

  it('a stance is not persisted (the class grants it fresh on load)', () => {
    const { sim, pid, p } = world();
    expect(byId(p, 'battle_stance')).toHaveLength(1);
    const state = sim.serializeCharacter(pid)!;
    expect(state.auras).toBeUndefined();
  });
});
