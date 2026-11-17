// The Guardian of the Breath singles a player out to move: the Rush's red
// arrow over them for the whole raid, the alarm in their ear alone (the
// owner's run of 2026-11-17). A sky strike's mark (BREATH_AURAS.skyMark) and
// Drawn Lightning by their auras; Storm Lance and Leaping Bolt by the bar's
// target.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BREATH_BAR_ALARM,
  BREATH_MARK_ALARM,
  BREATH_SFX_KEYS,
  barAlarmDue,
} from '../src/game/smith_heart_breath_audio_core';
import { RUSH_MARK_ALARM } from '../src/game/smith_heart_council_audio_core';
import {
  BREATH_ARROW_AURAS,
  breathArrowMark,
  breathTargetedBar,
} from '../src/render/smith_heart_fx/breath_arrow_core';
import {
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_OBJECTS,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart';
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

  it('raises the arrow on a sky mark and on Drawn Lightning, never on another aura', () => {
    expect(BREATH_ARROW_AURAS).toEqual([BREATH_AURAS.skyMark, BREATH_AURAS.drawn]);
    const with_ = (id: string) =>
      ({ auras: [{ id, remaining: 1, duration: 2 }] }) as unknown as Pick<Entity, 'auras'>;
    expect(breathArrowMark(with_(BREATH_AURAS.skyMark))).not.toBeNull();
    expect(breathArrowMark(with_(BREATH_AURAS.drawn))).not.toBeNull();
    expect(breathArrowMark(with_(BREATH_AURAS.anchor))).toBeNull();
  });

  it('raises it over the target of Storm Lance and Leaping Bolt', () => {
    expect(breathTargetedBar({ castingAbility: BREATH_CASTS.lance })).toBe(BREATH_CASTS.lance);
    expect(breathTargetedBar({ castingAbility: BREATH_CASTS.fork })).toBe(BREATH_CASTS.fork);
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

  it('the fight draws both arrow sets every frame', () => {
    const src = readFileSync('src/render/smith_heart_fx/breath_fight_fx.ts', 'utf8');
    expect(src).toContain('this.auraArrows.update(');
    expect(src).toContain('this.barArrows.update(');
    expect(src).toContain('this.barArrows.see(g.castTargetId)');
  });
});
