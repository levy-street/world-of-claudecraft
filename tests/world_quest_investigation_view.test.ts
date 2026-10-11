import { describe, expect, it } from 'vitest';
import {
  INVESTIGATION_CLUES,
  INVESTIGATION_NPC_IDS,
  INVESTIGATION_NPCS,
  INVESTIGATION_QUEST_ID,
  INVESTIGATION_VARIANTS,
} from '../src/sim/content/world_quest_investigation';
import type { WorldQuestProgress } from '../src/sim/types';
import { worldQuestPuzzleVariantForCycle } from '../src/sim/world_quest_rotation';
import {
  investigationDialogue,
  investigationInstructionLines,
  investigationSignature,
} from '../src/ui/world_quest_investigation_view';

function fixture(cycle = 'wq3_0') {
  const progress = {
    questId: INVESTIGATION_QUEST_ID,
    state: 'active' as const,
    count: 0,
    investigation: { heard: 0, clues: 0, cleared: 0, mobId: undefined as number | undefined },
  } satisfies WorldQuestProgress;
  return {
    progress,
    world: { worldQuestCycle: cycle, worldQuestLog: new Map([[INVESTIGATION_QUEST_ID, progress]]) },
  };
}
describe('investigation dialogue projection', () => {
  it('keeps the sergeant from hearing accusations until every guard and both records are examined', () => {
    const { world, progress } = fixture();
    const captain = INVESTIGATION_NPC_IDS[0];
    expect(investigationDialogue(world, captain)?.accuse).toBe(false);
    expect(investigationDialogue(world, captain)?.suspects).toEqual([]);
    progress.investigation.heard = 15;
    progress.investigation.clues = 1;
    expect(investigationDialogue(world, captain)?.accuse).toBe(false);
    progress.investigation.clues = 3;
    const ready = investigationDialogue(world, captain);
    expect(ready?.accuse).toBe(true);
    expect(ready?.hint).toBe('Which of my guards is wearing a borrowed face?');
    expect(ready?.suspects).toEqual(
      INVESTIGATION_NPCS.slice(1).map((npc, index) => ({
        npcId: INVESTIGATION_NPC_IDS[index + 1],
        templateId: npc.id,
      })),
    );
    // Guards only tell their story; the accusation is never made to them.
    expect(investigationDialogue(world, INVESTIGATION_NPC_IDS[1])).toMatchObject({
      accuse: false,
      suspects: [],
      hint: expect.stringContaining('Sergeant Alric'),
    });
    progress.investigation.cleared = 1;
    const afterMiss = investigationDialogue(world, captain);
    expect(afterMiss?.hint).toContain('try again');
    expect(afterMiss?.suspects.map((s) => s.npcId)).toEqual(INVESTIGATION_NPC_IDS.slice(2));
    expect(investigationDialogue(world, INVESTIGATION_NPC_IDS[1])?.hint).toContain(
      'already accounted',
    );
    expect(investigationDialogue(world, INVESTIGATION_NPC_IDS[2])?.accuse).toBe(false);
  });
  it('resolves clues and all statements from the same cycle variant', () => {
    const covered = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const { world } = fixture(`wq3_${i}`);
      const variant = worldQuestPuzzleVariantForCycle(
        world.worldQuestCycle,
        INVESTIGATION_VARIANTS.length,
      );
      covered.add(variant);
      INVESTIGATION_CLUES.forEach((clue, index) => {
        expect(investigationDialogue(world, clue.entityId)?.text).toBe(
          INVESTIGATION_VARIANTS[variant].clues[index],
        );
      });
      INVESTIGATION_NPC_IDS.slice(1).forEach((id, index) => {
        expect(investigationDialogue(world, id)?.text).toBe(
          INVESTIGATION_VARIANTS[variant].statements[index],
        );
      });
    }
    expect(covered.size).toBe(INVESTIGATION_VARIANTS.length);
  });
  it('tracks counts, confrontation and ordinary combat, with snapshot and rotation invalidation', () => {
    const { world, progress } = fixture();
    const initial = investigationSignature(world);
    expect(investigationInstructionLines(progress)).toEqual([
      'Guards questioned: 0/4',
      'Records examined: 0/2',
    ]);
    progress.investigation.heard = 15;
    progress.investigation.clues = 3;
    expect(investigationSignature(world)).not.toBe(initial);
    expect(investigationInstructionLines(progress)[0]).toContain('Sergeant Alric');
    progress.investigation.mobId = 100;
    expect(investigationDialogue(world, INVESTIGATION_NPC_IDS[1])?.finished).toBe(true);
    expect(investigationInstructionLines(progress)).toEqual(['Defeat the revealed infiltrator.']);
    const revealed = investigationSignature(world);
    world.worldQuestCycle = 'wq3_20';
    expect(investigationSignature(world)).not.toBe(revealed);
    expect(investigationDialogue(world, 123)).toBeNull();
  });
});
