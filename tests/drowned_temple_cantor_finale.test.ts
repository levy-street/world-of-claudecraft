// Laverock, the Drowned Temple's optional lore guide (src/sim/dungeon_guide,
// content/drowned_temple_cantor.ts): his invulnerability and invisibility to
// every fight system, and the finale (walk, farewell, song, the fallen rising)
// with the deed and its title.
// Driven through full Sim ticks in a real claimed Temple (the shared harness:
// tests/helpers/temple_guide_run.ts). Split by cost cluster so no one file
// carries more than the default declared-duration allowance.

import { describe, expect, it } from 'vitest';
import {
  CANTOR_DEED_ID,
  CANTOR_GUIDE,
  CANTOR_LAST_VERSE_CAST,
  CANTOR_SPAWN,
} from '../src/sim/content/drowned_temple_cantor';
import { answerDungeonGuide } from '../src/sim/dungeon_guide';
import { DT, type SimEvent } from '../src/sim/types';
import { bossOf, gather, linesFor, put, temple, tick } from './helpers/temple_guide_run';

describe('no fight ever touches him', () => {
  it('a boss fight beside him leaves him whole, unthreatened and unmoved', () => {
    const r = temple();
    gather(r);
    tick(r, 0.2);
    answerDungeonGuide(r.sim.ctx, r.guide.id, true, r.lead.id);
    const ysolei = bossOf(r, 'ysolei');
    ysolei.maxHp = 1e8;
    ysolei.hp = 1e8;
    for (const p of [r.lead, ...r.others]) put(r, p, -18, 206);
    put(r, r.guide, -16, 210);
    r.guide.guideRun?.trail.splice(0);
    r.sim.ctx.aggroMob(ysolei, r.lead, false);
    const before = { ...r.guide.pos };
    tick(r, 40, () => {
      for (const p of [r.lead, ...r.others]) p.hp = p.maxHp;
      if (r.sim.time % 10 < DT) r.sim.chat('/dev temple trigger undertow', r.lead.id);
    });
    expect(r.guide.hp).toBe(r.guide.maxHp);
    expect(r.guide.dead).toBe(false);
    expect(r.guide.pos).toEqual(before);
    expect(ysolei.threat.has(r.guide.id)).toBe(false);
    expect(
      r.events.some(
        (ev) => (ev.type === 'damage' || ev.type === 'heal') && ev.targetId === r.guide.id,
      ),
    ).toBe(false);
  }, 100_000);

  it('a player cannot attack him: he is never tabbed to and takes no hit', () => {
    const r = temple();
    gather(r);
    tick(r, 0.2);
    r.sim.targetEntity(r.guide.id, r.lead.id);
    r.sim.startAutoAttack(r.lead.id);
    tick(r, 4);
    expect(r.guide.hp).toBe(r.guide.maxHp);
    r.sim.targetEntity(null, r.lead.id);
    r.sim.tabTarget(r.lead.id);
    expect(r.lead.targetId === r.guide.id).toBe(false);
  });
});

describe('the finale', () => {
  it('Ysolei falls: he walks to the altar, says farewell, sings, and the fallen rise', () => {
    const r = temple({ clearTrash: false });
    gather(r);
    tick(r, 0.2);
    answerDungeonGuide(r.sim.ctx, r.guide.id, true, r.lead.id);
    tick(r, 1);
    // The run's trash and the first two bosses fall.
    for (const id of r.inst.mobIds) {
      const e = r.sim.ctx.entities.get(id);
      if (e && !e.dead && e.templateId !== 'ysolei') r.sim.ctx.handleDeath(e, r.lead);
    }
    for (const p of [r.lead, ...r.others]) put(r, p, 24, 206);
    put(r, r.guide, 30, 206);
    r.guide.guideRun?.trail.splice(0);
    tick(r, 2);
    const ysolei = bossOf(r, 'ysolei');
    r.sim.ctx.handleDeath(ysolei, r.lead);
    tick(r, 60, () => {
      for (const p of [r.lead, ...r.others]) p.hp = p.maxHp;
    });
    const heard = linesFor(r, r.lead.id);
    const farewell = heard.filter((id) => id.startsWith('F'));
    expect(farewell.slice(0, 3)).toEqual(['F01', 'F02', 'F03']);
    expect(['F04', 'F05']).toContain(farewell[3]);
    expect(farewell[4]).toBe('F06');
    expect(r.guide.guideState).toBe('singing');
    expect(r.guide.castingAbility).toBe(CANTOR_LAST_VERSE_CAST);
    expect(r.guide.channeling).toBe(true);
    const spot = CANTOR_GUIDE.finale.path[CANTOR_GUIDE.finale.path.length - 1];
    expect(Math.hypot(r.guide.pos.x - r.ox - spot.x, r.guide.pos.z - r.oz - spot.z)).toBeLessThan(
      0.5,
    );
    const finale = r.events.filter(
      (ev): ev is Extract<SimEvent, { type: 'dungeonGuideFinale' }> =>
        ev.type === 'dungeonGuideFinale' && ev.pid === r.lead.id,
    );
    expect(finale).toHaveLength(1);
    // Every fallen pilgrim, novice, guard, siren and the Choirmother rise.
    const fallen = r.inst.mobIds
      .map((id) => r.sim.ctx.entities.get(id))
      .filter((e) => e?.dead && CANTOR_GUIDE.finale.dissolveMobIds.includes(e.templateId));
    expect(finale[0].spots.length).toBe(fallen.length * 3);
    expect(fallen.length).toBeGreaterThan(20);
    // The song loops while the claim lives.
    tick(r, CANTOR_GUIDE.finale.castSeconds + 2);
    expect(r.guide.castingAbility).toBe(CANTOR_LAST_VERSE_CAST);
    // The deed and its title went to everyone in the claim.
    for (const p of [r.lead, ...r.others]) {
      expect(r.sim.meta(p.id)?.deedsEarned.has(CANTOR_DEED_ID)).toBe(true);
    }
    r.sim.setActiveTitle(CANTOR_DEED_ID, r.lead.id);
    expect(r.sim.meta(r.lead.id)?.activeTitle).toBe(CANTOR_DEED_ID);
  }, 100_000);

  it('the deed reaches a member who entered this run but is running back from the graveyard', () => {
    const r = temple();
    gather(r);
    tick(r, 0.2);
    answerDungeonGuide(r.sim.ctx, r.guide.id, true, r.lead.id);
    for (const p of [r.lead, ...r.others]) put(r, p, 24, 206);
    // One member stands far outside the claim (a spirit on its way back).
    const away = r.others[0];
    away.pos = { x: 0, y: 0, z: 0 };
    away.prevPos = { ...away.pos };
    r.sim.ctx.handleDeath(bossOf(r, 'ysolei'), r.lead);
    tick(r, 1);
    expect(r.inst.enteredBy.has(away.id)).toBe(true);
    expect(r.sim.meta(away.id)?.deedsEarned.has(CANTOR_DEED_ID)).toBe(true);
    // A stranger who never entered this run gets nothing.
    const stranger = r.sim.addPlayer('mage', 'Passerby');
    expect(r.sim.meta(stranger)?.deedsEarned.has(CANTOR_DEED_ID)).toBe(false);
  }, 100_000);

  it('no deed and no finale when the group went alone', () => {
    const r = temple();
    gather(r);
    tick(r, 0.2);
    answerDungeonGuide(r.sim.ctx, r.guide.id, false, r.lead.id);
    for (const p of [r.lead, ...r.others]) put(r, p, 24, 206);
    r.sim.ctx.handleDeath(bossOf(r, 'ysolei'), r.lead);
    tick(r, 30);
    expect(r.sim.meta(r.lead.id)?.deedsEarned.has(CANTOR_DEED_ID)).toBe(false);
    expect(r.guide.guideState).not.toBe('singing');
    expect(r.guide.pos.z - r.oz).toBeCloseTo(CANTOR_SPAWN.z, 1);
  });
});
