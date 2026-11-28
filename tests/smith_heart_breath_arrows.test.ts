// The Guardian of the Breath singles a player out to move: the Rush's red
// arrow over them for the whole raid, the alarm in their ear alone (the
// owner's run of 2026-11-17). Jose's playtest of 2026-11-18 trimmed the arrow
// to the marks that choose ONE player for a role of their own (Drawn
// Lightning, the Knotted Gale's portal marks and carrier, Leaping Bolt's
// target): never a sky strike or Storm Lance, whose floor telegraph says it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BREATH_BAR_ALARM,
  BREATH_KNOT_ALARM,
  BREATH_MARK_ALARM,
  BREATH_SFX_KEYS,
  barAlarmDue,
  knotAlarmDue,
} from '../src/game/smith_heart_breath_audio_core';
import { RUSH_MARK_ALARM } from '../src/game/smith_heart_council_audio_core';
import {
  BREATH_ARROW_AURAS,
  BREATH_ARROWS,
  breathArrowMark,
  breathTargetedBar,
  LADEN_ARROW_LIFT,
} from '../src/render/smith_heart_fx/breath_arrow_core';
import {
  KNOT_BEAM,
  KNOT_CARRY_Y,
  knotLook,
} from '../src/render/smith_heart_fx/breath_heart_fx_core';
import {
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_CUES,
  BREATH_OBJECTS,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
import { ISLE_AURAS, ISLE_CASTS } from '../src/sim/encounters/smith_heart/breath_isle_ids';
import type { Entity } from '../src/sim/types';
import { breathFight } from './helpers/breath_fight';

const horn = Object.values(RUSH_MARK_ALARM)[0];

describe("the Breath's marks: the arrow and the alarm", () => {
  it('a sky strike marks each player it falls under for its warning', () => {
    const f = breathFight(4, 23);
    f.dev('/dev heart breath pull');
    f.tick(2);
    const st = f.state();
    if (!st) throw new Error('no fight');
    st.wind.phase = 'calm';
    st.wind.remaining = 999;
    st.inhaleTimer = 999;
    st.skyTimer = 0.05;
    f.tick(2);
    const marked = f.players.filter((p) => p.auras.some((a) => a.id === BREATH_AURAS.skyMark));
    expect(marked.length).toBe(T.skyMarks);
    for (const p of marked) {
      const a = p.auras.find((x) => x.id === BREATH_AURAS.skyMark);
      expect(a?.duration).toBeCloseTo(T.skyWarn, 5);
      // A strike lies under each.
      expect(
        f
          .objects(BREATH_OBJECTS.strikePrefix)
          .some((s) => Math.hypot(s.pos.x - p.pos.x, s.pos.z - p.pos.z) < 0.5),
      ).toBe(true);
    }
    // The mark lasts the warning, then it is gone.
    f.tick(Math.round(T.skyWarn / 0.05) + 2);
    expect(f.players.some((p) => p.auras.some((a) => a.id === BREATH_AURAS.skyMark))).toBe(false);
  });

  it('raises the arrow on Drawn Lightning, never on a sky mark or another aura', () => {
    expect(BREATH_ARROW_AURAS).toEqual([
      BREATH_AURAS.drawn,
      BREATH_AURAS.portalA,
      BREATH_AURAS.portalB,
      BREATH_AURAS.portalC,
      BREATH_AURAS.portalD,
      BREATH_AURAS.laden,
    ]);
    const with_ = (id: string) =>
      ({ auras: [{ id, remaining: 1, duration: 2 }] }) as unknown as Pick<Entity, 'auras'>;
    expect(breathArrowMark(with_(BREATH_AURAS.drawn))).not.toBeNull();
    // A sky strike's ring on the floor is its telegraph: no arrow (Jose, 2026-11-18).
    expect(breathArrowMark(with_(BREATH_AURAS.skyMark))).toBeNull();
    expect(breathArrowMark(with_(BREATH_AURAS.anchor))).toBeNull();
    // Nor any mark of the isles (their lane, storm and strikes are all on the floor).
    for (const id of Object.values(ISLE_AURAS)) expect(breathArrowMark(with_(id)), id).toBeNull();
  });

  it("raises it over the Knotted Gale's portal-marked players and its carrier, over the ball", () => {
    const with_ = (id: string) =>
      ({ auras: [{ id, remaining: 3, duration: 5 }] }) as unknown as Pick<Entity, 'auras'>;
    for (const id of [
      BREATH_AURAS.portalA,
      BREATH_AURAS.portalB,
      BREATH_AURAS.portalC,
      BREATH_AURAS.portalD,
    ]) {
      const m = breathArrowMark(with_(id));
      expect(m, id).not.toBeNull();
      expect(m?.lift ?? 0).toBe(0);
    }
    const carrier = breathArrowMark(with_(BREATH_AURAS.laden));
    expect(carrier?.remaining).toBe(3);
    expect(carrier?.lift).toBe(LADEN_ARROW_LIFT);
    // Over the ball riding over their head, not through it.
    expect(LADEN_ARROW_LIFT).toBeGreaterThan(KNOT_CARRY_Y - 2);
    expect(BREATH_ARROWS).toBeGreaterThanOrEqual(8);
  });

  it("raises it over Leaping Bolt's target, never over a frontal's (Storm Lance)", () => {
    expect(breathTargetedBar({ castingAbility: BREATH_CASTS.fork })).toBe(BREATH_CASTS.fork);
    // The frontal line is drawn on the floor: no arrow (Jose, 2026-11-18).
    expect(breathTargetedBar({ castingAbility: BREATH_CASTS.lance })).toBeNull();
    expect(breathTargetedBar({ castingAbility: BREATH_CASTS.blow })).toBeNull();
    expect(breathTargetedBar({ castingAbility: BREATH_CASTS.thunder })).toBeNull();
    for (const id of Object.values(ISLE_CASTS))
      expect(breathTargetedBar({ castingAbility: id }), id).toBeNull();
    expect(breathTargetedBar({ castingAbility: BREATH_CASTS.inhale })).toBeNull();
    expect(breathTargetedBar({ castingAbility: null })).toBeNull();
  });

  it("sounds the Rush's horn for the marked player alone", () => {
    expect(BREATH_MARK_ALARM[BREATH_AURAS.skyMark]).toEqual(horn);
    expect(BREATH_MARK_ALARM[BREATH_AURAS.drawn]).toEqual(horn);
    expect(BREATH_BAR_ALARM).toEqual(horn);
    expect(BREATH_SFX_KEYS).toContain(horn.key);
    // A bar aimed at me alarms me; one aimed at another, or no bar of the list, never.
    expect(barAlarmDue(BREATH_CASTS.lance, 7, 7)).toBe(true);
    expect(barAlarmDue(BREATH_CASTS.lance, 8, 7)).toBe(false);
    expect(barAlarmDue(BREATH_CASTS.inhale, 7, 7)).toBe(false);
    expect(barAlarmDue(BREATH_CASTS.fork, 7, null)).toBe(false);
  });

  it('a falling Knotted Gale sounds a gong for everyone in the fight', () => {
    expect(BREATH_SFX_KEYS).toContain(BREATH_KNOT_ALARM.key);
    expect(BREATH_KNOT_ALARM.key).not.toBe(horn.key);
    expect(knotAlarmDue(BREATH_CUES.knotLand, true)).toBe(true);
    expect(knotAlarmDue(BREATH_CUES.knotLand, false)).toBe(false);
    expect(knotAlarmDue(BREATH_CUES.knotTake, true)).toBe(false);
    const src = readFileSync('src/game/smith_heart_breath_audio.ts', 'utf8');
    // In the listener's own ear (the local player's position), at full.
    expect(src).toMatch(/knotAlarmDue\(ev\.ability, this\.inFight\)/);
    expect(src).toContain('me.pos.x, me.pos.y + 1.6, me.pos.z');
  });

  it("the Knotted Gale's fuse drains round its ring, and a column of light marks it loose", () => {
    const fresh = knotLook(15, 15);
    const half = knotLook(7.5, 15);
    const end = knotLook(0, 15);
    expect(fresh.arc).toBe(1);
    expect(half.arc).toBeCloseTo(0.5, 6);
    expect(end.arc).toBe(0);
    // The dial holds its size: the fuse reads in its arc alone.
    expect(half.ringR).toBe(fresh.ringR);
    expect(KNOT_BEAM.height).toBeGreaterThan(30);
    const src = readFileSync('src/render/smith_heart_fx/breath_heart_fx.ts', 'utf8');
    expect(src).toContain('k.arc.value = look.arc;');
    expect(src).toContain('k.beam.visible = !held;');
  });

  it('the fight draws both arrow sets every frame', () => {
    const src = readFileSync('src/render/smith_heart_fx/breath_fight_fx.ts', 'utf8');
    expect(src).toContain('this.auraArrows.update(');
    expect(src).toContain('this.barArrows.update(');
    expect(src).toContain('this.barArrows.see(g.castTargetId)');
  });
});
