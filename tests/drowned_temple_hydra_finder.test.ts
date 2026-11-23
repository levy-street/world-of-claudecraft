// The Mere Hydra's Dungeon Finder lines state the live mechanic
// (docs/design/tooltip-writing.md): every number in them is the encounter
// tuning combat reads (encounters/drowned_temple/ids.ts HYDRA_TUNING and
// HYDRA_COMBO_TUNING), so a retune that forgets the copy reds here.

import { describe, expect, it } from 'vitest';
import { finderActivity } from '../src/sim/content/dungeon_finder';
import {
  HYDRA_COMBO_ORDER,
  HYDRA_COMBO_TUNING,
  HYDRA_ELEMENTS,
  HYDRA_TUNING,
  tsunamiSide,
} from '../src/sim/encounters/drowned_temple';
import { type TranslationKey, t } from '../src/ui/i18n';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';

const mech = hudChromeStrings.finder.mech as Record<string, string>;
const T = HYDRA_TUNING;
const C = HYDRA_COMBO_TUNING;
const n = (v: number) => String(v);
const pct = (v: number) => `${Math.round(v * 100)} percent`;

describe('the Mere Hydra: the finder lines state the tuning', () => {
  it('every Hydra line is authored, resolved, and listed on both difficulties', () => {
    for (const id of ['drowned_temple_normal', 'drowned_temple_heroic']) {
      const hydra = finderActivity(id)?.encounters.find(
        (e) => e.mobId === 'mere_hydra_head_center',
      );
      expect(hydra?.mechanics.length, id).toBe(4);
      for (const key of hydra?.mechanics ?? []) {
        expect(mech[key], key).toBeTruthy();
        // The window resolves the key through t(): the regenerated English
        // table must carry the same words the catalogue authors.
        expect(t(`hudChrome.finder.mech.${key}` as TranslationKey), key).toBe(mech[key]);
      }
    }
  });

  it('Three Elements', () => {
    const line = mech.hydra_three_elements;
    // Left ice, centre venom, right water (HYDRA_ELEMENTS, left to right).
    expect(HYDRA_ELEMENTS).toEqual(['frost', 'venom', 'tide']);
    expect(line.indexOf('left head')).toBeGreaterThan(0);
    expect(line.indexOf('left head')).toBeLessThan(line.indexOf('centre head'));
    expect(line.indexOf('centre head')).toBeLessThan(line.indexOf('right head'));
    expect(line).toContain(`${n(T.breathRange)} yard cone of frost`);
    // The chill's aura value is the speed left (player_motion.ts takes the
    // lowest 'slow' value as a multiplier), so 0.3 is 70 percent slower.
    expect(T.chillSlow).toBe(0.3);
    expect(line).toContain(`slows you by ${pct(1 - T.chillSlow)} for ${n(T.chillSeconds)} seconds`);
    expect(line).toContain(`under up to ${n(T.spitCount)} players`);
    expect(line).toContain(`bursts after ${n(T.spitWarn)} seconds`);
    expect(line).toContain(`burns for ${n(T.venomSeconds)} seconds`);
    expect(line).toContain(`${n(T.torrentLength)} yard lane`);
    expect(line).toContain(`throws you back ${n(T.torrentKnockback)} yards`);
  });

  it('Tsunami', () => {
    const line = mech.hydra_tsunami;
    // The Tsunami clock is wound to tsunamiEvery as a wave starts and stands
    // still while the wave (and the heroic backwash) is in flight
    // (mere_hydra.ts tickMereHydra), so the gap is counted from the wave's end.
    expect(line).toContain(`comes ${n(T.tsunamiFirst)} seconds into the fight`);
    expect(line).toContain(`${n(T.tsunamiEvery)} seconds after the last has passed`);
    expect(line).not.toMatch(/every \d+ seconds/);
    expect(line).toContain(`sink for ${n(T.tsunamiCast)} seconds`);
    expect(line).toContain(`${pct(T.submergedReduction)} less damage`);
    expect(line).toContain(`${n(T.tsunamiMin)} to ${n(T.tsunamiMax)} frost damage on normal`);
    expect(line).toContain(`${n(T.tsunamiKnockback)} yard shove`);
    expect(line).toContain(`${n(T.backwashAfter)} seconds later`);
    // "the other half the next time": the side alternates wave by wave.
    expect(tsunamiSide(0)).not.toBe(tsunamiSide(1));
    expect(tsunamiSide(0)).toBe(tsunamiSide(2));
  });

  it('Combined Breath', () => {
    const line = mech.hydra_combined_breath;
    // A lone surviving head carrying both elements casts the combo alone
    // (hydra_combo.ts comboHeads), so the line never says "two heads".
    expect(line).toContain('the heads fuse two of their attacks');
    // "always in the same order", and the line names them in that order.
    expect(HYDRA_COMBO_ORDER).toEqual(['frostlock', 'current', 'rime']);
    expect(line.indexOf('Frostlocked Torrent')).toBeGreaterThan(0);
    expect(line.indexOf('Frostlocked Torrent')).toBeLessThan(line.indexOf('Venom Current'));
    expect(line.indexOf('Venom Current')).toBeLessThan(line.indexOf('Toxic Rime'));
    expect(line).toContain(`for ${n(C.freezeSeconds)} seconds`);
    expect(line).toContain(`burst after ${n(C.rimeSeconds)} seconds`);
    // "Once between Tsunamis on normal, twice on heroic".
    expect(C.comboAt).toHaveLength(1);
    expect(C.comboAtHeroic).toHaveLength(2);
    expect(line).toContain('Once between Tsunamis on normal, twice on heroic');
  });

  it('Regrowth', () => {
    const line = mech.hydra_regrowth;
    expect(line).toContain(`grows back after ${n(T.regrowAfter)} seconds`);
    expect(T.regrowShare).toBe(0.5);
    expect(line).toContain('at half health');
    expect(line).toContain(`${pct(T.enragePerHead)} more damage`);
  });
});
