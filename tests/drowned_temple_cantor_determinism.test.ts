// Laverock, the Drowned Temple's optional lore guide (src/sim/dungeon_guide,
// content/drowned_temple_cantor.ts): determinism (never the shared rng, the
// same lines on one seed) and a fresh guide on every claim.
// Driven through full Sim ticks in a real claimed Temple (the shared harness:
// tests/helpers/temple_guide_run.ts). Split by cost cluster so no one file
// carries more than the default declared-duration allowance.

import { describe, expect, it } from 'vitest';
import { CANTOR_NPC_ID } from '../src/sim/content/drowned_temple_cantor';
import { answerDungeonGuide } from '../src/sim/dungeon_guide';
import { claimedInstanceAt, freeInstance } from '../src/sim/instances/dungeons';
import { gather, linesFor, temple, tick, walkRoute } from './helpers/temple_guide_run';

describe('determinism', () => {
  it('the guide never draws from the shared rng, whatever he does', () => {
    const drive = (keepGuide: boolean): number[] => {
      const r = temple({ clearTrash: false, seed: 41 });
      if (!keepGuide) {
        r.inst.npcIds.splice(r.inst.npcIds.indexOf(r.guide.id), 1);
        r.sim.ctx.dropEntity(r.guide.id);
      }
      gather(r);
      tick(r, 0.2);
      if (keepGuide) answerDungeonGuide(r.sim.ctx, r.guide.id, true, r.lead.id);
      walkRoute(r, 500);
      tick(r, 10);
      return [r.sim.ctx.rng.next(), r.sim.ctx.rng.next(), r.lead.pos.x, r.lead.hp];
    };
    expect(drive(true)).toEqual(drive(false));
  }, 100_000);

  it('two runs on one seed hear the same lines in the same order', () => {
    const play = (): string[] => {
      const r = temple({ seed: 77 });
      gather(r);
      tick(r, 0.2);
      answerDungeonGuide(r.sim.ctx, r.guide.id, true, r.others[0].id);
      walkRoute(r, 900);
      tick(r, 20);
      return linesFor(r, r.lead.id);
    };
    expect(play()).toEqual(play());
  }, 100_000);

  it('a fresh claim gets a fresh guide with no memory', () => {
    const r = temple();
    gather(r);
    tick(r, 0.2);
    answerDungeonGuide(r.sim.ctx, r.guide.id, true, r.lead.id);
    tick(r, 2);
    const oldId = r.guide.id;
    // The run ends: the claim is freed (its guide goes with it) and claimed anew.
    freeInstance(r.sim.ctx, r.inst);
    expect(r.sim.ctx.entities.has(oldId)).toBe(false);
    r.sim.chat('/dev temple enter normal', r.lead.id);
    const inst = claimedInstanceAt(r.sim.ctx, r.lead.pos);
    const fresh = inst?.npcIds
      .map((id) => r.sim.ctx.entities.get(id))
      .find((e) => e?.templateId === CANTOR_NPC_ID);
    expect(fresh).toBeDefined();
    expect(fresh?.id).not.toBe(oldId);
    expect(fresh?.guideRun).toBeUndefined();
    tick(r, 0.2);
    expect(fresh?.guideState).toBe('open');
    expect(fresh?.guideRun?.done.size).toBe(0);
  });
});
