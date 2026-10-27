// The Guardian of the Breath's player text: every raid warning and every line
// the guardian and Captain Thessaly speak resolves through its catalog key to
// the very English the sim sends, the fight's marks' tooltips from the live
// tuning (the wind's speed off the aura itself), every bar and damage name
// re-localized, the hazards on the debuff bar, and Thessaly's own name.

import { describe, expect, it } from 'vitest';
import { isDebuffDisplayAura } from '../src/sim/aura_classify';
import {
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_DIFFICULTY,
  BREATH_NAMES,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart/breath_ids';
import { BREATH_LINES, breathLineKey } from '../src/sim/encounters/smith_heart/breath_voice';
import type { SimEvent } from '../src/sim/types';
import { WIND_DRIFT_AURA, WIND_PULL_AURA } from '../src/sim/wind_drift';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { breathFight } from './helpers/breath_fight';

type Chat = Extract<SimEvent, { type: 'chat' }>;

describe('Guardian of the Breath: what the raid reads', () => {
  it('every warning and every line resolves its key to the English the sim sent', () => {
    const f = breathFight(6);
    const events: SimEvent[] = [];
    f.dev('/dev heart breath pull');
    events.push(...f.tick(20 * 12));
    for (const cmd of ['circle', 'inhale', 'heroic', 'tornado']) {
      f.dev(`/dev heart breath ${cmd}`);
      events.push(...f.tick(20 * 8));
    }
    f.dev('/dev heart breath phase2');
    events.push(...f.tick(20 * 16));
    for (const cmd of ['chain', 'eye', 'conductor', 'gust']) {
      f.dev(`/dev heart breath ${cmd}`);
      events.push(...f.tick(20 * 8));
    }
    const mine = events.filter((e): e is Chat => e.type === 'chat' && e.pid === f.pids[0]);
    const warns = mine.filter((c) => c.channel === 'raidWarning');
    const keys = new Set(warns.map((w) => w.textKey));
    for (const k of ['circle', 'inhale', 'gust', 'gales', 'storm', 'fork', 'cradle', 'drawn'])
      expect(keys, k).toContain(`hudChrome.breathGuardian.warn.${k}`);
    for (const w of warns) {
      expect(w.textKey?.startsWith('hudChrome.breathGuardian.warn.')).toBe(true);
      expect(t(w.textKey as never, w.textValues)).toBe(w.text);
    }
    const yells = mine.filter((c) => c.channel === 'yell');
    expect(yells.length).toBeGreaterThan(5);
    for (const y of yells) expect(t(y.textKey as never)).toBe(y.text);
  });

  it("every line in BREATH_LINES is its catalog row's English", () => {
    for (const [speaker, lines] of Object.entries(BREATH_LINES))
      for (const [moment, text] of Object.entries(lines))
        expect(t(breathLineKey(speaker as never, moment as never) as never)).toBe(text);
  });
});

describe('Guardian of the Breath: tooltips and names', () => {
  const say = (d: ReturnType<typeof auraEffectDescriptor>) => {
    const text = t(d?.key as never, d?.nums as never);
    expect(text).not.toMatch(/\{\w+\}/);
    return text;
  };

  it('each mark says its rule with the live numbers', () => {
    const wind = auraEffectDescriptor({
      id: WIND_DRIFT_AURA,
      kind: 'internal_cd',
      value: 1,
      value2: BREATH_DIFFICULTY.heroic.windSpeed,
    });
    expect(wind?.key).toBe('hudChrome.auraEffect.breathGuardian.wind');
    expect(say(wind)).toContain(`${BREATH_DIFFICULTY.heroic.windSpeed} yd a second`);
    expect(say(wind)).toContain(`${T.pinMin} to ${T.pinMax}`);
    const draw = auraEffectDescriptor({
      id: WIND_PULL_AURA,
      kind: 'internal_cd',
      value: 0,
      value3: T.pullSpeed,
    });
    expect(say(draw)).toContain(`${T.gustThrow} yd outward`);
    const anchor = auraEffectDescriptor({ id: BREATH_AURAS.anchor, kind: 'internal_cd', value: 0 });
    expect(say(anchor)).toContain('Damage still lands');
    const drawn = auraEffectDescriptor({ id: BREATH_AURAS.drawn, kind: 'internal_cd', value: 0 });
    expect(say(drawn)).toContain(`every ${T.drawnStrikeEvery} sec`);
    const cradled = auraEffectDescriptor({ id: BREATH_AURAS.cradled, kind: 'stun', value: 0 });
    const text = say(cradled);
    expect(text).toContain(String(T.cradleTotal));
    expect(text).toContain(`fewer than ${BREATH_DIFFICULTY.normal.cradleSoakers}`);
    const swell = auraEffectDescriptor({
      id: BREATH_AURAS.swell,
      kind: 'internal_cd',
      value: 0,
      stacks: 7,
    });
    expect(say(swell)).toContain('7 so far');
    for (const id of [BREATH_AURAS.pinned, BREATH_AURAS.spent, BREATH_AURAS.stormForm])
      say(auraEffectDescriptor({ id, kind: 'internal_cd', value: 0 }));
  });

  it('the hazards sit on the debuff bar, the anchor among the buffs', () => {
    for (const id of [
      WIND_DRIFT_AURA,
      WIND_PULL_AURA,
      BREATH_AURAS.pinned,
      BREATH_AURAS.drawn,
      BREATH_AURAS.spent,
    ])
      expect(isDebuffDisplayAura('internal_cd', 0, id), id).toBe(true);
    expect(isDebuffDisplayAura('internal_cd', 0, BREATH_AURAS.anchor)).toBe(false);
  });

  it('every bar, damage and aura name has its localized form, and Thessaly hers', () => {
    for (const id of Object.values(BREATH_CASTS))
      expect(t(`abilityUi.cast.${id}` as never), id).not.toContain('abilityUi');
    // The damage and aura names (the storm's bar and the circle's object
    // name are the cast table's and no aura's).
    for (const [k, name] of Object.entries(BREATH_NAMES)) {
      if (k === 'storm' || k === 'calm') continue;
      expect(localizeSimAuraName(name), name).toBe(name);
    }
    expect(t('entities.npcs.heart_captain_thessaly.name' as never)).toBe('Captain Thessaly');
    expect(t('entities.npcs.heart_captain_thessaly.title' as never)).toBe('Highwatch Captain');
  });
});
