import { describe, expect, it } from 'vitest';
import { QUESTS } from '../src/sim/data';
import { onMobKilledForQuests } from '../src/sim/quests/quest_credit';
import { Sim } from '../src/sim/sim';
import type { Entity, QuestProgress } from '../src/sim/types';

// Migration hazard (Professions 2.0 Phase 14): the load path copied every non-done
// questLog entry verbatim, without checking the id against QUESTS. Once
// q_archetype_acceptance / q_prof_make_amends were retired, a production save that
// was mid-either-quest loaded fine, then the next quest-touching tick op
// (inventory credit, kill credit, NPC interact) dereferenced
// QUESTS[qp.questId].objectives on an undefined quest and TypeErrored inside the
// server tick. The fix prunes unknown active ids at load; questsDone (membership
// only, never dereferenced) is preserved so history is intact.

const RETIRED = 'q_archetype_acceptance'; // a real, now-deleted Phase 14 id
const SYNTHETIC = 'q_removed_synthetic'; // never a real id; outlives any future re-add
const KNOWN = 'q_wolves'; // a real kill quest (kill 8 forest_wolf)

function makeSim(seed = 8080): Sim {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: true });
}

/** A save whose questLog carries two unknown ACTIVE entries (a retired quest id
 *  and a synthetic one) alongside one legitimate active entry with progress, plus
 *  the retired id in done history (which must survive untouched). */
function migrantSave(sim: Sim) {
  const saved = sim.serializeCharacter(sim.playerId);
  if (!saved) throw new Error('serialize failed');
  const questLog: QuestProgress[] = [
    { questId: KNOWN, counts: [3], state: 'active' },
    { questId: RETIRED, counts: [1], state: 'active', selection: 'weaponcrafting+armorcrafting' },
    { questId: SYNTHETIC, counts: [0], state: 'active' },
  ];
  saved.questLog = questLog;
  saved.questsDone = [RETIRED];
  return saved;
}

describe('quest-log load normalization (retired/unknown quest ids)', () => {
  it('the sentinel ids are genuinely absent from QUESTS, the known one present', () => {
    expect(QUESTS[RETIRED]).toBeUndefined();
    expect(QUESTS[SYNTHETIC]).toBeUndefined();
    expect(QUESTS[KNOWN]).toBeDefined();
  });

  it('prunes unknown active quest ids at load, keeping known entries and done history intact', () => {
    const saved = migrantSave(makeSim());
    const reloaded = makeSim(8081);
    const pid = reloaded.addPlayer('warrior', 'Migrant', { state: saved });
    const meta = reloaded.players.get(pid);
    if (!meta) throw new Error('load failed');

    expect(meta.questLog.has(SYNTHETIC)).toBe(false);
    expect(meta.questLog.has(RETIRED)).toBe(false);
    // The known active entry survives with its progress + selection intact.
    expect(meta.questLog.get(KNOWN)).toMatchObject({
      questId: KNOWN,
      counts: [3],
      state: 'active',
    });
    // questsDone is membership-only (never dereferenced), so history is preserved.
    expect(meta.questsDone.has(RETIRED)).toBe(true);
  });

  it('the three quest-touching tick paths run without throwing after load', () => {
    const saved = migrantSave(makeSim());
    const reloaded = makeSim(8082);
    const pid = reloaded.addPlayer('warrior', 'Migrant', { state: saved });
    const meta = reloaded.players.get(pid);
    if (!meta) throw new Error('load failed');

    // 1) inventory-change credit path (onInventoryChangedForQuests via addItem).
    expect(() => reloaded.addItem('linen_scrap', 1, pid)).not.toThrow();

    // 2) kill-credit path (onMobKilledForQuests, the quest_credit.test idiom, driven
    // against the loaded meta and the sim's live tick ctx).
    const wolf = { templateId: 'forest_wolf' } as unknown as Entity;
    // biome-ignore lint/suspicious/noExplicitAny: reach the private tick ctx the server uses.
    const ctx = (reloaded as any).ctx;
    expect(() => onMobKilledForQuests(ctx, wolf, meta)).not.toThrow();

    // 3) NPC-interact path (interactNpcForQuests via talkToNpc); the entity map key
    // is the npc id talkToNpc resolves.
    const smith = [...reloaded.entities.entries()].find(
      ([, e]) => e.templateId === 'smith_haldren',
    );
    if (!smith) throw new Error('smith_haldren missing');
    expect(() => reloaded.talkToNpc(smith[0], pid)).not.toThrow();
  });

  it('a save/load round-trip after pruning stays stable', () => {
    const saved = migrantSave(makeSim());
    const once = makeSim(8083);
    const pid1 = once.addPlayer('warrior', 'Migrant', { state: saved });
    const resaved = once.serializeCharacter(pid1);
    // The re-serialized questLog carries only the known active entry.
    expect(resaved?.questLog.map((q) => q.questId)).toEqual([KNOWN]);

    const twice = makeSim(8084);
    const pid2 = twice.addPlayer('warrior', 'Migrant2', { state: resaved ?? undefined });
    const meta2 = twice.players.get(pid2);
    expect(meta2?.questLog.has(KNOWN)).toBe(true);
    expect(meta2?.questLog.has(SYNTHETIC)).toBe(false);
  });
});
