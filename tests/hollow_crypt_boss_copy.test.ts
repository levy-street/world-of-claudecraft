// The Hollow Crypt wing bosses' player copy states the live mechanic
// (docs/design/tooltip-writing.md): every number in the dungeon finder's
// mechanic lines is the encounter tuning combat reads, so a retune that forgets
// the copy reds here. Also pins the finder listing itself (normal and heroic).

import { describe, expect, it } from 'vitest';
import { FINDER_ACTIVITIES } from '../src/sim/content/dungeon_finder';
import {
  ILVANE_TUNING,
  KNELL_TUNING,
  KNELLWYRM_ID,
  LADY_TUNING,
  MARROW_TUNING,
  MORTHEN_ID,
  MORTHEN_TUNING,
  RITE_CANDLE_SPOTS,
} from '../src/sim/encounters/hollow_crypt';
import { cryptHeroicAmount } from '../src/ui/crypt_aura_effect';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';

const mech = hudChromeStrings.finder.mech as Record<string, string>;
const n = (v: number) => String(v);
const pct = (v: number) => `${Math.round(v * 100)} percent`;

describe('Hollow Crypt wing bosses: the finder listing', () => {
  it('lists each core on normal and adds the heroic line on heroic', () => {
    const normal = FINDER_ACTIVITIES.find((a) => a.id === 'hollow_crypt_normal');
    const heroic = FINDER_ACTIVITIES.find((a) => a.id === 'hollow_crypt_heroic');
    if (!normal || !heroic) throw new Error('no crypt activities');
    const by = (list: typeof normal.encounters, id: string) =>
      list.find((e) => e.mobId === id)?.mechanics ?? [];
    expect(by(normal.encounters, 'sexton_marrow')).toEqual([
      'crypt_shovelful',
      'crypt_measured_for_the_grave',
      'crypt_burial_toll',
    ]);
    expect(by(heroic.encounters, 'sexton_marrow')).toContain('crypt_marrow_heroic');
    expect(by(normal.encounters, 'rimeweb')).not.toContain('crypt_lady_heroic');
    expect(by(heroic.encounters, 'rimeweb')).toContain('crypt_lady_heroic');
    expect(by(heroic.encounters, 'cantor_ilvane')).toContain('crypt_ilvane_heroic');
    // Morthen: his three acts on both tiers, the heroic line (with the
    // Knellwyrm's Burning Knell) on heroic only.
    const morthen = [
      'crypt_morthen_shadow_pulse',
      'crypt_gravecall',
      'crypt_rite_of_the_unquiet',
      'crypt_reap_the_unquiet',
    ];
    expect(by(normal.encounters, 'morthen')).toEqual(morthen);
    expect(by(heroic.encounters, 'morthen')).toEqual([...morthen, 'crypt_morthen_heroic']);
    expect(normal.encounters.find((e) => e.mobId === 'morthen')?.final).toBe(true);
    expect(heroic.encounters.find((e) => e.mobId === 'morthen')?.final).toBe(true);
    // The generic pulse label stays in the catalog for any other listing.
    expect(mech.shadow_pulse).toBeTruthy();
    for (const a of [normal, heroic])
      for (const e of a.encounters) for (const m of e.mechanics) expect(mech[m], m).toBeTruthy();
  });
});

describe('Hollow Crypt wing bosses: the finder lines state the tuning', () => {
  it('Sexton Marrow', () => {
    const T = MARROW_TUNING;
    expect(mech.crypt_shovelful).toContain(`every ${n(T.shovelEvery)} seconds`);
    expect(mech.crypt_shovelful).toContain(`${n(T.shovelRange)} yard cone`);
    expect(mech.crypt_shovelful).toContain(
      `${pct(1 - T.shovelSlow)} slower movement for ${n(T.shovelSlowSeconds)} seconds`,
    );
    expect(T.shovelMult).toBe(1.5);
    expect(mech.crypt_measured_for_the_grave).toContain(`every ${n(T.measureEvery)} seconds`);
    expect(mech.crypt_measured_for_the_grave).toContain(`${n(T.markSeconds)} seconds later`);
    expect(mech.crypt_measured_for_the_grave).toContain(
      `${n(T.graveOpenMin)} to ${n(T.graveOpenMax)} damage within ${n(T.graveRadius)} yards`,
    );
    expect(mech.crypt_measured_for_the_grave).toContain(
      `${n(T.graveDirtPerSecond)} damage a second and ${pct(1 - T.graveSlow)} slower`,
    );
    expect(mech.crypt_burial_toll).toContain(
      `at ${pct(T.tollAt[0]).replace(' percent', '')} and ${pct(T.tollAt[1])} health`,
    );
    expect(mech.crypt_burial_toll).toContain(`rings for ${n(T.tollRing)} seconds`);
    expect(mech.crypt_burial_toll).toContain(`${n(T.tollMin)} to ${n(T.tollMax)} shadow damage`);
    expect(mech.crypt_marrow_heroic).toContain(`every ${n(T.blowEvery)} seconds`);
    expect(mech.crypt_marrow_heroic).toContain(
      `${pct(T.blowVulnPerStack)} more damage for ${n(T.blowSeconds)} seconds, up to ${n(T.blowMaxStacks)} stacks`,
    );
    expect(mech.crypt_marrow_heroic).toContain(`swings ${pct(T.graveVigorHaste - 1)} faster`);
    expect(mech.crypt_marrow_heroic).toContain(`stays ${n(T.unquietLinger)} seconds in a grave`);
  });

  it('the Lady of the Bonechill', () => {
    const T = LADY_TUNING;
    expect(mech.crypt_brides_lament).toContain(
      `every ${n(T.lamentEvery)} seconds a ${n(T.lamentCast)} second wail`,
    );
    expect(mech.crypt_brides_lament).toContain(
      `${n(T.lamentMin)} to ${n(T.lamentMax)} frost damage`,
    );
    expect(T.lingerPerStack).toBe(0.5);
    expect(mech.crypt_brides_lament).toContain('half again for every Lingering Lament stack');
    expect(T.lanternCap).toBe(2);
    expect(mech.crypt_brides_lament).toContain(`dark for ${n(T.lanternDark)} seconds`);
    expect(mech.crypt_frozen_embrace).toContain(`every ${n(T.embraceEvery)} seconds`);
    expect(mech.crypt_frozen_embrace).toContain(`rises ${n(T.embraceHeight)} yards`);
    expect(mech.crypt_frozen_embrace).toContain(`${n(T.embracePerSecond)} frost damage a second`);
    expect(mech.crypt_frozen_embrace).toContain(
      `deal ${pct(T.embraceBreakShare)} of her health within ${n(T.embraceHold)} seconds`,
    );
    expect(mech.crypt_frozen_embrace).toContain(`${n(T.dropMin)} to ${n(T.dropMax)} damage`);
    expect(mech.crypt_rime_path).toContain(`for ${n(T.rimeSeconds)} seconds`);
    expect(T.freezeAt).toBe(0.5);
    expect(mech.crypt_lady_heroic).toContain(
      `after ${n(T.lanternLitHeroic)} seconds and stays dark for ${n(T.lanternGutter)}`,
    );
    expect(T.embraceVictimsHeroic).toBe(2);
  });

  it('Cantor Ilvane', () => {
    const T = ILVANE_TUNING;
    expect(mech.crypt_dirge_of_the_hollow).toContain(
      `every ${n(T.dirgeEvery)} seconds a ${n(T.dirgeCast)} second song`,
    );
    expect(mech.crypt_dirge_of_the_hollow).toContain(
      `${n(T.dirgeMin)} to ${n(T.dirgeMax)} shadow damage`,
    );
    expect(mech.crypt_dirge_of_the_hollow).toContain(`${n(T.dirgeSilence)} second silence`);
    expect(mech.crypt_dirge_of_the_hollow).toContain(`within ${n(T.dirgeRadius)} yards`);
    expect(mech.crypt_harmony).toContain(`${pct(T.harmonyPer)} less damage`);
    expect(mech.crypt_bone_organ).toContain(`every ${n(T.organEvery)} seconds`);
    expect(mech.crypt_bone_organ).toContain(`${n(T.noteMin)} to ${n(T.noteMax)} damage`);
    expect(T.organWaveAt).toHaveLength(2);
    expect(mech.crypt_crescendo).toContain(`below ${pct(T.crescendoAt)} health`);
    expect(mech.crypt_crescendo).toContain(
      `takes ${n(T.dirgeCastCrescendo)} seconds and comes every ${n(T.dirgeEveryCrescendo)} seconds`,
    );
    expect(T.organWaveAtCrescendo).toHaveLength(3);
    expect(mech.crypt_ilvane_heroic).toContain(`lies dead for ${n(T.encoreSeconds)} seconds`);
    expect(T.unbrokenEvery).toBe(3);
  });
});

describe('Morthen the Gravecaller: the finder lines state the tuning', () => {
  const T = MORTHEN_TUNING;
  const K = KNELL_TUNING;
  const big = (v: number) => v.toLocaleString('en-US');

  it('Shadow Pulse', () => {
    const line = mech.crypt_morthen_shadow_pulse;
    expect(line).toContain(`every ${n(T.pulseEvery)} seconds a ${n(T.pulseCast)} second cast`);
    expect(line).toContain(`${n(T.pulseMin)} to ${n(T.pulseMax)} shadow damage on normal`);
    expect(line).toContain(`within ${n(T.pulseRadius)} yards`);
    expect(line).toContain(`every ${n(T.pulseEveryLastRites)} seconds in his Last Rites`);
  });

  it('Gravecall', () => {
    const line = mech.crypt_gravecall;
    expect(line).toContain(`every ${n(T.soulEvery)} seconds a Bound Soul`);
    expect(line).toContain(
      `${pct(T.gorgedPct)} more damage for each soul up to ${n(T.gorgedMaxStacks)} stacks`,
    );
    expect(line).toContain(`heals ${pct(T.gorgedHeal)} of his health`);
    expect(line).toContain(
      `${n(T.soulInterceptMin)} to ${n(T.soulInterceptMax)} shadow damage on normal`,
    );
  });

  it('the Rite of the Unquiet', () => {
    const line = mech.crypt_rite_of_the_unquiet;
    expect(line).toContain(`at ${pct(T.riteAt)} health`);
    expect(line).toContain(
      `deals ${n(T.chillBase)} shadow damage a second to everyone, rising by ${n(T.chillStep)} every ${n(T.chillEvery)} seconds`,
    );
    expect(line).toContain(`${n(T.riteBones)} Restless Bones`);
    expect(line).toContain(`Relight the ${n(RITE_CANDLE_SPOTS.length)} Remembrance Candles`);
    expect(line).toContain(
      `a ${n(T.relightChannel)} second channel that drains ${pct(T.relightDrainPct)} of the lighter's maximum health every second`,
    );
    expect(line).toContain(
      `stunned for ${n(T.brokenSeconds)} seconds and takes ${pct(T.brokenVuln)} more damage`,
    );
  });

  it('Reap the Unquiet', () => {
    const line = mech.crypt_reap_the_unquiet;
    expect(line).toContain(`below ${pct(T.lastRitesAt)} health`);
    expect(line).toContain(`every ${n(T.reapEvery)} seconds`);
    expect(line).toContain(`after a ${n(T.reapCast)} second cast`);
    expect(line).toContain(`${n(T.reapMin)} to ${n(T.reapMax)} shadow damage on normal`);
    expect(line).toContain(
      `a ${n(T.reapArcDeg)} degree arc ${n(T.reapRange)} yards in front of him`,
    );
    expect(line).toContain(`every ${n(T.pulseEveryLastRites)} seconds`);
  });

  it('the heroic line states the heroic amounts (Morthen at his factor, the wyrm at its own)', () => {
    const line = mech.crypt_morthen_heroic;
    const h = (v: number) => n(cryptHeroicAmount(MORTHEN_ID, v));
    expect(line).toContain(
      `${h(T.wrongCandleMin)} to ${h(T.wrongCandleMax)} shadow damage to the lighter`,
    );
    expect(line).toContain(`drains ${pct(T.relightDrainPctHeroic)} a second`);
    expect(line).toContain(
      `every ${n(T.graspEvery)} seconds ${n(T.graspTargets)} players get a ${n(T.graspRadius)} yard ring`,
    );
    expect(line).toContain(`${n(T.graspFuse)} seconds later`);
    expect(line).toContain(
      `a ${n(T.graspRootSeconds)} second root and ${h(T.graspMin)} to ${h(T.graspMax)} shadow damage`,
    );
    expect(line).toContain(`half of the ring for ${n(K.markSeconds)} seconds`);
    expect(line).toContain(
      `${big(cryptHeroicAmount(KNELLWYRM_ID, K.fireMin))} to ${big(cryptHeroicAmount(KNELLWYRM_ID, K.fireMax))} fire damage`,
    );
    expect(line).toContain(`${n(K.breaths)} halves each flight`);
  });
});
