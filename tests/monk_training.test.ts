import { describe, expect, it } from 'vitest';
import { BLOSSOM_TRAINING_MAT_ITEM, MONK_TRAINEE_IDS } from '../src/sim/content/blossom_temple';
import { NPCS } from '../src/sim/data';
import {
  advanceMonkDrill,
  MONK_DRILL_GAP_SECONDS,
  MONK_DRILL_STAGGER_SECONDS,
  MONK_DRILL_STEP_SECONDS,
  monkDrillStep,
} from '../src/sim/monk_training';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

const fakeTrainee = (): Entity =>
  ({ dead: false, overheadEmoteId: null, overheadEmoteUntil: 0, overheadEmoteSeq: 0 }) as Entity;

describe('Blossom Temple monk drill', () => {
  it('loops kata three times, then a bow', () => {
    expect([0, 1, 2, 3, 4, 7].map(monkDrillStep)).toEqual([
      'kata',
      'kata',
      'kata',
      'bow',
      'kata',
      'bow',
    ]);
  });

  it('staggers the first step by trainee index, then waits out each step plus the gap', () => {
    const e = fakeTrainee();
    expect(advanceMonkDrill(e, MONK_DRILL_STAGGER_SECONDS * 2 - 0.01, 2)).toBe(false);
    expect(advanceMonkDrill(e, MONK_DRILL_STAGGER_SECONDS * 2, 2)).toBe(true);
    expect(e.overheadEmoteId).toBe('kata');
    const t0 = MONK_DRILL_STAGGER_SECONDS * 2;
    const next = t0 + MONK_DRILL_STEP_SECONDS + MONK_DRILL_GAP_SECONDS;
    expect(advanceMonkDrill(e, next - 0.01, 2)).toBe(false);
    expect(advanceMonkDrill(e, next, 2)).toBe(true);
    expect(e.overheadEmoteSeq).toBe(2);
  });

  it('every trainee is a real NPC and the live sim drives their emotes', () => {
    for (const id of MONK_TRAINEE_IDS) expect(NPCS[id]).toBeDefined();
    const sim = new Sim({ seed: 11, playerClass: 'rogue', autoEquip: false });
    for (let i = 0; i < 20 * 6; i++) sim.tick();
    const trainees = [...sim.entities.values()].filter(
      (e) => e.kind === 'npc' && (MONK_TRAINEE_IDS as readonly string[]).includes(e.templateId),
    );
    expect(trainees).toHaveLength(MONK_TRAINEE_IDS.length);
    for (const t of trainees) expect(t.overheadEmoteSeq).toBeGreaterThan(0);
  });

  it('the training mat is a spawned interact object', () => {
    const sim = new Sim({ seed: 11, playerClass: 'rogue', autoEquip: false });
    const mats = [...sim.entities.values()].filter(
      (e) => e.kind === 'object' && e.objectItemId === BLOSSOM_TRAINING_MAT_ITEM,
    );
    expect(mats).toHaveLength(1);
  });
});
