// Regression for the "completed quests are offered again" report.
// Uses a current Eastbrook quest; the original player-named ledger example was retired.
//
// Two independent guards:
//  1. The completion engine latches a turned-in quest to 'done' and keeps it
//     done across a serialize/deserialize round-trip (proves the engine is sound).
//  2. No two quests share an identical giver + objective signature. The actual
//     bug was content, not logic: a retired side chain re-issued the same kill
//     task from the same NPC as a main-story quest, so a finished quest was
//     indistinguishable from a brand-new one to the player.
import { describe, expect, it } from 'vitest';
import { QUESTS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';

const QID = 'q_wolves';

function driveToTurnIn(sim: Sim): void {
  const quest = QUESTS[QID];
  const meta = (sim as any).primary;
  meta.questLog.set(QID, {
    questId: QID,
    state: 'ready',
    counts: quest.objectives.map((o) => o.count),
  });
  const npc = [...sim.entities.values()].find(
    (e) => e.kind === 'npc' && e.templateId === quest.turnInNpcId,
  )!;
  sim.player.pos = { ...npc.pos };
  sim.turnInQuest(QID);
}

describe('completed quest does not repeat', () => {
  it('is "done" immediately after turn-in', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', playerName: 'W' });
    sim.setPlayerLevel(5);
    driveToTurnIn(sim);
    expect(sim.questState(QID)).toBe('done');
  });

  it('stays "done" across a serialize/deserialize round-trip', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', playerName: 'W' });
    sim.setPlayerLevel(5);
    driveToTurnIn(sim);
    const state = sim.serializeCharacter(sim.playerId)!;

    const sim2 = new Sim({ seed: 1, noPlayer: true } as any);
    const pid = sim2.addPlayer('warrior', 'W', { state });
    expect(sim2.questState(QID, pid)).toBe('done');
  });
});

describe('no quest duplicates another (same giver + identical objectives)', () => {
  it('every quest has a unique giver+objective signature', () => {
    const sig = (id: string): string => {
      const q = QUESTS[id];
      const obj = q.objectives
        .map((o) => {
          let target: string;
          switch (o.type) {
            case 'kill':
              target = `kill ${o.targetMobId}`;
              break;
            case 'collect':
              target = `collect ${o.itemId}`;
              break;
            case 'interact':
              target = `interact ${o.targetNpcId ?? o.targetObjectItemId}`;
              break;
            case 'craft':
              target = `craft ${o.recipeId}`;
              break;
            case 'gather':
              target = `gather ${o.nodeType ?? o.itemId}`;
              break;
          }
          return `${target} x${o.count}`;
        })
        .join(' + ');
      return `${q.giverNpcId} :: ${obj}`;
    };
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const id of Object.keys(QUESTS)) {
      const s = sig(id);
      const prev = seen.get(s);
      if (prev) collisions.push(`${prev} <-> ${id}  (${s})`);
      else seen.set(s, id);
    }
    expect(collisions).toEqual([]);
  });
});
