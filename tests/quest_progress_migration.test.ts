import { describe, expect, it } from 'vitest';

import { QUESTS } from '../src/sim/data';
import { migrateRestoredQuestProgress } from '../src/sim/quests/quest_progress_migration';
import { Sim } from '../src/sim/sim';
import type { QuestDef, QuestProgress } from '../src/sim/types';

// The zones 1 to 3 dedupe pass reworked nine quests under their original ids,
// so an in-flight save's index-keyed counts point at the wrong work. Worse than
// cosmetic: the credit paths skip an at-cap objective BEFORE their ready check,
// so a carried 9-of-14 against a new count-of-1 can never flip ready and the
// quest strands. QuestDef.rev names the objective revision; restore resets a
// run stamped under an older one, exactly once.
describe('quest progress migration (QuestDef.rev)', () => {
  const def = (rev?: number): QuestDef =>
    ({
      id: 'q_test',
      name: 'Test',
      objectives: [{ type: 'kill', targetMobId: 'm', count: 1, label: 'x' }],
      ...(rev === undefined ? {} : { rev }),
    }) as unknown as QuestDef;
  const saved = (over: Partial<QuestProgress> = {}): QuestProgress => ({
    questId: 'q_test',
    counts: [9],
    state: 'active',
    ...over,
  });

  it('resets counts and stamps the rev when the def rev moved', () => {
    const out = migrateRestoredQuestProgress(def(1), saved());
    expect(out.counts).toEqual([0]);
    expect(out.rev).toBe(1);
    expect(out.state).toBe('active');
  });

  it('demotes a stale ready run to active and drops per-run scratch', () => {
    const out = migrateRestoredQuestProgress(
      def(1),
      saved({ state: 'ready', burnedObjects: [{ key: 'murloc_hut@0,0', at: 5 }] }),
    );
    expect(out.state).toBe('active');
    expect(out.burnedObjects).toBeUndefined();
  });

  it('passes a same-rev run through untouched', () => {
    const progress = saved({ counts: [1], rev: 1 });
    expect(migrateRestoredQuestProgress(def(1), progress)).toBe(progress);
  });

  it('never resets under a def with no rev (the default)', () => {
    const progress = saved({ counts: [7] });
    expect(migrateRestoredQuestProgress(def(), progress)).toBe(progress);
  });

  it('preserves the profession selection across a reset', () => {
    const out = migrateRestoredQuestProgress(def(2), saved({ selection: 'mining', rev: 1 }));
    expect(out.selection).toBe('mining');
    expect(out.rev).toBe(2);
  });

  it('all nine reworked quests carry rev 1', () => {
    const reworked = [
      'q_bones',
      'q_deepfen_purge',
      'q_broodmother',
      'q_no_rest',
      'q_ogre_bounty',
      'q_cult_orders',
      'q_necromancers',
      'q_revenant_vanguard',
      'q_voice_below',
    ];
    for (const id of reworked) expect(QUESTS[id]?.rev, id).toBe(1);
  });

  it('re-syncs collect counts from the restored inventory after a reset', () => {
    // Four of the nine reworked quests have collect objectives, and collect
    // counts are derived state only onInventoryChangedForQuests re-credits: a
    // migrated character already holding the items must be ready at login, not
    // stuck at 0 of N until an unrelated inventory change.
    const sim = new Sim({ seed: 7, playerClass: 'warrior', playerName: 'Col', autoEquip: false });
    sim.addItem('restless_skull', 8);
    // Pre-rework shape: q_bones was a kill quest at 3 of 8, no rev stamp.
    sim.questLog.set('q_bones', { questId: 'q_bones', counts: [3], state: 'active' });
    const state = sim.serializeCharacter(sim.playerId)!;
    const reloaded = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = reloaded.addPlayer('warrior', 'Col', { state });
    const q = reloaded.serializeCharacter(pid)!.questLog.find((x) => x.questId === 'q_bones');
    expect(q?.counts).toEqual([8]);
    expect(q?.state).toBe('ready');
  });

  it('a pre-rework in-flight save resets once on restore, then keeps new progress', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', playerName: 'Mig', autoEquip: false });
    // A pre-rework save: 9 of the old 14 Drowned Dead, no rev stamp. Under the
    // reworked count-of-1 objective this would read complete but never flip
    // ready (the credit path skips an at-cap objective).
    sim.questLog.set('q_no_rest', { questId: 'q_no_rest', counts: [9], state: 'active' });
    const state = sim.serializeCharacter(sim.playerId)!;
    const reloaded = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid = reloaded.addPlayer('warrior', 'Mig', { state });
    const restored = reloaded.serializeCharacter(pid)!;
    const q = restored.questLog.find((x) => x.questId === 'q_no_rest');
    expect(q?.counts).toEqual([0]);
    expect(q?.rev).toBe(1);
    // Post-rework progress survives the next reload untouched (one-time reset).
    const again = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid2 = again.addPlayer('warrior', 'Mig', { state: restored });
    const meta = (
      again as unknown as { players: Map<number, { questLog: Map<string, QuestProgress> }> }
    ).players.get(pid2)!;
    const qp = meta.questLog.get('q_no_rest')!;
    qp.counts[0] = 1;
    const after = again.serializeCharacter(pid2)!;
    const third = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const pid3 = third.addPlayer('warrior', 'Mig', { state: after });
    const q3 = third.serializeCharacter(pid3)!.questLog.find((x) => x.questId === 'q_no_rest');
    expect(q3?.counts).toEqual([1]);
  });
});
