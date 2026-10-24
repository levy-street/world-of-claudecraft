// Laverock, the Drowned Temple's optional lore guide (src/sim/dungeon_guide,
// content/drowned_temple_cantor.ts): the speech queue's rules: what the group
// meets, each line once, priority, spacing, heroic lines, the boss-fight
// silence and the wipe cry.
// Driven through full Sim ticks in a real claimed Temple (the shared harness:
// tests/helpers/temple_guide_run.ts). Split by cost cluster so no one file
// carries more than the default declared-duration allowance.

import { describe, expect, it } from 'vitest';
import { CANTOR_GUIDE } from '../src/sim/content/drowned_temple_cantor';
import { answerDungeonGuide, freshGuideRun } from '../src/sim/dungeon_guide';
import { pickLine } from '../src/sim/dungeon_guide/speech';
import { DT, type SimEvent } from '../src/sim/types';
import { bossOf, gather, linesFor, put, temple, tick, walkRoute } from './helpers/temple_guide_run';

describe('the speech queue', () => {
  it('names what the group meets on the way, each line once', () => {
    const r = temple({ clearTrash: false });
    gather(r);
    tick(r, 0.2);
    answerDungeonGuide(r.sim.ctx, r.guide.id, true, r.lead.id);
    walkRoute(r, 260, () => {
      for (const p of [r.lead, ...r.others]) p.hp = p.maxHp;
    });
    tick(r, 30, () => {
      for (const p of [r.lead, ...r.others]) p.hp = p.maxHp;
    });
    const heard = linesFor(r, r.lead.id);
    expect(new Set(heard).size).toBe(heard.length);
    expect(heard).toContain('A01');
    expect(heard.some((id) => id === 'C01' || id === 'C02')).toBe(true);
  }, 100_000);

  it('picks the most urgent waiting line, and drops the stale and the too-late ones', () => {
    const run = freshGuideRun(CANTOR_GUIDE, 5);
    run.queue.push(
      { id: 'C01', at: 0 },
      { id: 'A04', at: 1 },
      { id: 'B07', at: 2 },
      { id: 'C03', at: 3 },
    );
    const notStarted = () => false;
    expect(pickLine(CANTOR_GUIDE, run, 4, false, notStarted)?.id).toBe('B07');
    // Too late: the Colossus is already in its fight, so B07 is dropped.
    expect(pickLine(CANTOR_GUIDE, run, 4, false, (id) => id === 'tideglass_colossus')?.id).toBe(
      'A04',
    );
    expect(run.done.has('B07')).toBe(true);
    // Stale: 20 s later the creature and area lines have passed.
    expect(pickLine(CANTOR_GUIDE, run, 30, false, notStarted)).toBeNull();
    expect(run.queue).toEqual([]);
  });

  it('waits at least the spacing between two lines', () => {
    const r = temple();
    gather(r);
    tick(r, 0.2);
    answerDungeonGuide(r.sim.ctx, r.guide.id, true, r.lead.id);
    const at: number[] = [];
    for (let i = 0; i < 20 * 20; i++) {
      const evs = r.sim.tick();
      if (evs.some((ev) => ev.type === 'dungeonGuideLine' && ev.pid === r.lead.id)) {
        at.push(r.sim.time);
      }
    }
    expect(at.length).toBeGreaterThanOrEqual(2); // the thanks, then a memory
    for (let i = 1; i < at.length; i++) {
      expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(CANTOR_GUIDE.speech.spacing - DT);
    }
  });

  it('keeps the heroic lines for heroic claims', () => {
    const normal = temple({ clearTrash: false });
    gather(normal);
    tick(normal, 0.2);
    answerDungeonGuide(normal.sim.ctx, normal.guide.id, true, normal.lead.id);
    tick(normal, 20);
    expect(linesFor(normal, normal.lead.id)).not.toContain('E08');
    const heroic = temple({ difficulty: 'heroic', clearTrash: false });
    gather(heroic);
    tick(heroic, 0.2);
    answerDungeonGuide(heroic.sim.ctx, heroic.guide.id, true, heroic.lead.id);
    tick(heroic, 20);
    const heard = linesFor(heroic, heroic.lead.id);
    expect(heard).toContain('E08');
    // It follows the thanks, ahead of the memory it shares a queue with.
    expect(heard.indexOf('E08')).toBeLessThan(
      heard.findIndex((id) => id === 'E09' || id === 'E10'),
    );
  }, 100_000);

  it('falls silent in a boss fight except for the lines meant for it', () => {
    const r = temple();
    gather(r);
    tick(r, 0.2);
    answerDungeonGuide(r.sim.ctx, r.guide.id, true, r.lead.id);
    tick(r, 1);
    const colossus = bossOf(r, 'tideglass_colossus');
    colossus.maxHp = 1e8;
    colossus.hp = 1e8;
    // The whole group stands on the Prism Terrace with him.
    for (const p of [r.lead, ...r.others]) put(r, p, 82, 202);
    put(r, r.guide, 78, 196);
    r.guide.guideRun?.trail.splice(0);
    r.sim.ctx.aggroMob(colossus, r.lead, false);
    const n0 = r.events.length;
    tick(r, 30, () => {
      for (const p of [r.lead, ...r.others]) p.hp = p.maxHp;
      r.sim.chat('/dev temple trigger reflections', r.lead.id);
    });
    const during = r.events
      .slice(n0)
      .filter((ev) => ev.type === 'dungeonGuideLine' && ev.pid === r.lead.id)
      .map((ev) => (ev as Extract<SimEvent, { type: 'dungeonGuideLine' }>).lineId);
    // The memory line queued at the entrance waits; only C10 speaks.
    expect(during).toEqual(['C10']);
  }, 100_000);

  it('cries out once when the whole group lies dead', () => {
    const r = temple();
    gather(r);
    tick(r, 0.2);
    answerDungeonGuide(r.sim.ctx, r.guide.id, true, r.lead.id);
    tick(r, 14);
    for (const p of [r.lead, ...r.others]) {
      p.hp = 0;
      p.dead = true;
    }
    tick(r, 8);
    for (const p of [r.lead, ...r.others]) {
      p.dead = false;
      p.hp = p.maxHp;
    }
    tick(r, 1);
    for (const p of [r.lead, ...r.others]) {
      p.hp = 0;
      p.dead = true;
    }
    tick(r, 8);
    expect(linesFor(r, r.lead.id).filter((id) => id === 'O01')).toHaveLength(1);
  });
});
