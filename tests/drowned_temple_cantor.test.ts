// Laverock, the Drowned Temple's optional lore guide (src/sim/dungeon_guide,
// content/drowned_temple_cantor.ts): the guide record, the offer and its answer
// from any member, the change of mind until Selthe's fight, and the trail
// follow over the floating walkways and the catch-up.
// Driven through full Sim ticks in a real claimed Temple (the shared harness:
// tests/helpers/temple_guide_run.ts). Split by cost cluster so no one file
// carries more than the default declared-duration allowance.

import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import {
  CANTOR_DEED_ID,
  CANTOR_GUIDE,
  CANTOR_NPC_ID,
  CANTOR_SPAWN,
} from '../src/sim/content/drowned_temple_cantor';
import { DROWNED_TEMPLE_VOID_HEIGHT } from '../src/sim/content/drowned_temple_layout';
import { DUNGEON_GUIDES, dungeonGuideForNpc } from '../src/sim/content/dungeon_guides';
import { DUNGEONS, MOBS, NPCS } from '../src/sim/data';
import { answerDungeonGuide, freshGuideRun } from '../src/sim/dungeon_guide';
import { catchUpPoint, recordTrail, stepAlongTrail } from '../src/sim/dungeon_guide/follow';
import { DT } from '../src/sim/types';
import { bossOf, gather, linesFor, put, temple, tick, walkRoute } from './helpers/temple_guide_run';

describe('the guide record', () => {
  it('is registered, dynamic, and every trigger names real content', () => {
    expect(DUNGEON_GUIDES[CANTOR_GUIDE.id]).toBe(CANTOR_GUIDE);
    expect(dungeonGuideForNpc(CANTOR_NPC_ID)).toBe(CANTOR_GUIDE);
    expect(NPCS[CANTOR_NPC_ID]?.dynamic).toBe(true);
    expect(NPCS[CANTOR_NPC_ID]?.name).toBe('Laverock');
    expect(NPCS[CANTOR_NPC_ID]?.title).toBe('Last Cantor of the Pale Choir');
    const gates = new Set((DUNGEONS.drowned_temple.gates ?? []).map((g) => g.id));
    const ids = new Set(CANTOR_GUIDE.lines.map((l) => l.id));
    expect(ids.size).toBe(CANTOR_GUIDE.lines.length);
    for (const line of CANTOR_GUIDE.lines) {
      const t = line.trigger;
      if (t.kind === 'sight' || t.kind === 'mobAlive') {
        for (const m of t.mobIds) expect(MOBS[m], `${line.id} ${m}`).toBeDefined();
      }
      if (t.kind === 'gateOpen') expect(gates.has(t.gateId), line.id).toBe(true);
      if (t.kind === 'bossNear') expect(MOBS[t.bossId], line.id).toBeDefined();
      if (t.kind === 'bossDead') for (const b of t.bossIds) expect(MOBS[b], line.id).toBeDefined();
      if (t.kind === 'follows') for (const f of t.lines) expect(ids.has(f), line.id).toBe(true);
      if (line.beforeBoss) expect(MOBS[line.beforeBoss], line.id).toBeDefined();
      expect(line.text, line.id).not.toMatch(/[\u2013\u2014]/);
    }
    for (const id of CANTOR_GUIDE.finale.dissolveMobIds) expect(MOBS[id], id).toBeDefined();
    expect(DEEDS[CANTOR_DEED_ID]?.trigger).toEqual({ kind: 'manual' });
    expect(DEEDS[CANTOR_DEED_ID]?.reward).toEqual({ kind: 'title', text: 'Witness of the Choir' });
    // Every line in the design doc, the dialog's six keys aside.
    expect(CANTOR_GUIDE.lines.length).toBe(47);
  });

  it('draws each variant group from the private stream, never the shared one', () => {
    const a = freshGuideRun(CANTOR_GUIDE, 1234);
    const b = freshGuideRun(CANTOR_GUIDE, 1234);
    expect(a.chosen).toEqual(b.chosen);
    const groups = new Set(CANTOR_GUIDE.lines.flatMap((l) => (l.variant ? [l.variant] : [])));
    expect(Object.keys(a.chosen).sort()).toEqual([...groups].sort());
    // Across seeds both halves of a pair turn up.
    const seen = new Set<string>();
    for (let s = 1; s < 40; s++) seen.add(freshGuideRun(CANTOR_GUIDE, s).chosen.accept);
    expect(seen).toEqual(new Set(['E05', 'E06']));
  });
});

describe('the offer', () => {
  it('spawns on the landing each claim, as an npc no fight system counts', () => {
    const r = temple();
    expect(r.inst.mobIds).not.toContain(r.guide.id);
    expect(r.inst.npcIds).toContain(r.guide.id);
    expect(r.guide.kind).toBe('npc');
    expect(r.guide.hostile).toBe(false);
    expect(r.guide.pos.x - r.ox).toBeCloseTo(CANTOR_SPAWN.x, 1);
    expect(r.guide.pos.z - r.oz).toBeCloseTo(CANTOR_SPAWN.z, 1);
    tick(r, 0.2);
    expect(r.guide.guideState).toBe('open');
  });

  it('any member (not only the leader) answers for the whole group', () => {
    const r = temple();
    gather(r);
    tick(r, 0.2);
    answerDungeonGuide(r.sim.ctx, r.guide.id, true, r.others[1].id);
    expect(r.guide.guideState).toBe('joined');
    tick(r, 0.2);
    // Every player in the claim hears the thanks.
    for (const p of [r.lead, ...r.others]) {
      const heard = linesFor(r, p.id);
      expect(heard.length).toBe(1);
      expect(['E05', 'E06']).toContain(heard[0]);
    }
  });

  it('a group that goes alone may change its mind until Selthe fights', () => {
    const r = temple();
    gather(r);
    tick(r, 0.2);
    answerDungeonGuide(r.sim.ctx, r.guide.id, false, r.lead.id);
    expect(r.guide.guideState).toBe('declined');
    answerDungeonGuide(r.sim.ctx, r.guide.id, false, r.others[0].id);
    tick(r, 1);
    expect(linesFor(r, r.lead.id)).toEqual(['E07']); // once
    answerDungeonGuide(r.sim.ctx, r.guide.id, true, r.others[0].id);
    expect(r.guide.guideState).toBe('joined');
  });

  it('closes for good when Selthe is pulled, and a closed offer refuses an answer', () => {
    const r = temple();
    gather(r);
    tick(r, 0.2);
    answerDungeonGuide(r.sim.ctx, r.guide.id, false, r.lead.id);
    const selthe = bossOf(r, 'choirmother_selthe');
    put(r, r.others[0], 0, 4);
    r.sim.ctx.aggroMob(selthe, r.others[0], false);
    tick(r, 0.5);
    expect(r.guide.guideState).toBe('closed');
    answerDungeonGuide(r.sim.ctx, r.guide.id, true, r.lead.id);
    expect(r.guide.guideState).toBe('closed');
  });

  it('refuses a member out of reach, a dead one, and anyone outside the claim', () => {
    const r = temple();
    gather(r);
    tick(r, 0.2);
    put(r, r.others[0], CANTOR_SPAWN.x, CANTOR_SPAWN.z + 20);
    answerDungeonGuide(r.sim.ctx, r.guide.id, true, r.others[0].id);
    expect(r.guide.guideState).toBe('open');
    r.others[1].dead = true;
    answerDungeonGuide(r.sim.ctx, r.guide.id, true, r.others[1].id);
    expect(r.guide.guideState).toBe('open');
    const stranger = r.sim.addPlayer('mage', 'Outsider');
    answerDungeonGuide(r.sim.ctx, r.guide.id, true, stranger);
    expect(r.guide.guideState).toBe('open');
    // Not a guide at all: a gate object.
    answerDungeonGuide(r.sim.ctx, r.inst.objectIds[0], true, r.lead.id);
    expect(r.guide.guideState).toBe('open');
  });
});

describe('the follow', () => {
  it('walks the group trail down the steps and causeway, never over the void', () => {
    const r = temple();
    gather(r);
    tick(r, 0.2);
    answerDungeonGuide(r.sim.ctx, r.guide.id, true, r.lead.id);
    let maxBehind = 0;
    walkRoute(r, Number.POSITIVE_INFINITY, () => {
      const g = r.guide.pos;
      expect(g.y).toBeGreaterThan(DROWNED_TEMPLE_VOID_HEIGHT + 10);
      // He stands where a walkway is (the floor under him is not the void).
      expect(r.sim.ctx.groundPos(g.x, g.z).y).toBeGreaterThan(DROWNED_TEMPLE_VOID_HEIGHT + 10);
      const rear = r.others[r.others.length - 1];
      maxBehind = Math.max(maxBehind, Math.hypot(g.x - rear.pos.x, g.z - rear.pos.z));
    });
    tick(r, 6);
    const rear = r.others[r.others.length - 1];
    const d = Math.hypot(r.guide.pos.x - rear.pos.x, r.guide.pos.z - rear.pos.z);
    expect(d).toBeGreaterThan(3);
    expect(d).toBeLessThan(7);
    expect(maxBehind).toBeLessThan(40); // he kept up without a single snap
    expect(linesFor(r, r.lead.id)).not.toContain('O02');
  }, 100_000);

  it('stands still while any member fights', () => {
    const r = temple({ clearTrash: false });
    gather(r);
    tick(r, 0.2);
    answerDungeonGuide(r.sim.ctx, r.guide.id, true, r.lead.id);
    put(r, r.lead, CANTOR_SPAWN.x - 2, CANTOR_SPAWN.z + 20);
    r.lead.inCombat = true;
    const before = { ...r.guide.pos };
    tick(r, 2, () => {
      r.lead.inCombat = true;
    });
    expect(r.guide.pos).toEqual(before);
  });

  it('catches up on his own when left far behind, and says so once', () => {
    const r = temple();
    gather(r);
    tick(r, 0.2);
    answerDungeonGuide(r.sim.ctx, r.guide.id, true, r.lead.id);
    tick(r, 7);
    walkRoute(r, 60);
    // Strand him back on the landing while the group runs down the steps.
    put(r, r.guide, CANTOR_SPAWN.x, CANTOR_SPAWN.z);
    walkRoute(r, 400);
    tick(r, 8);
    expect(linesFor(r, r.lead.id)).toContain('O02');
    const rear = r.others[r.others.length - 1];
    expect(Math.hypot(r.guide.pos.x - rear.pos.x, r.guide.pos.z - rear.pos.z)).toBeLessThan(12);
    // A second stranding never repeats the line.
    put(r, r.guide, CANTOR_SPAWN.x, CANTOR_SPAWN.z);
    tick(r, 8);
    expect(linesFor(r, r.lead.id).filter((id) => id === 'O02')).toHaveLength(1);
  }, 100_000);

  it('the catch-up point never walks back across a jump in the trail', () => {
    const before = [
      { x: 0, y: 0, z: 0 },
      { x: 1.5, y: 0, z: 0 },
    ];
    // Just past a jump: no trail yet on the near side, so no snap at all.
    const fresh = [...before, { x: 50, y: 0, z: 0 }, { x: 51.5, y: 0, z: 0 }];
    expect(catchUpPoint(fresh, { x: 52, y: 0, z: 0 }, 6)).toBeNull();
    // Once the member has walked on, he lands on the near side, six yards back.
    const walked = [...before];
    for (let x = 40; x <= 52; x += 1.5) walked.push({ x, y: 0, z: 0 });
    const snap = catchUpPoint(walked, { x: 52, y: 0, z: 0 }, 6);
    expect(snap?.at.x).toBeGreaterThanOrEqual(40);
    expect(52 - (snap?.at.x ?? 0)).toBeGreaterThanOrEqual(6);
    expect(snap?.rest.every((c) => c.x > (snap?.at.x ?? 0))).toBe(true);
  });

  it('holds a gap behind the member and hurries when far behind', () => {
    const run = freshGuideRun(CANTOR_GUIDE, 9);
    for (let z = 0; z <= 30; z += 1) recordTrail(run, { x: 0, y: 2, z });
    const step = stepAlongTrail(
      run,
      { x: 0, y: 2, z: 0 },
      0,
      { x: 0, y: 2, z: 30 },
      CANTOR_GUIDE.follow,
      DT,
    );
    expect(step.pos.z).toBeCloseTo(CANTOR_GUIDE.follow.runSpeed * DT, 5);
    const near = freshGuideRun(CANTOR_GUIDE, 9);
    recordTrail(near, { x: 0, y: 2, z: 3 });
    const still = stepAlongTrail(
      near,
      { x: 0, y: 2, z: 0 },
      0,
      { x: 0, y: 2, z: 4 },
      CANTOR_GUIDE.follow,
      DT,
    );
    expect(still.moved).toBe(false);
  });
});
