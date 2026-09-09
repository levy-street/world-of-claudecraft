// Tests for the pure unitFrameCurrentMaxText formatter (hud_frames.ts), which
// the player / target / target-of-target unit frames in hud.ts use for their
// "current / max" hp and resource text, replacing the raw template-literal
// interpolation those five sites used to bypass formatNumber with (unlike
// party frames, which already routed through it via partyFrameHealthText).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SETTING_RANGES } from '../src/game/settings';
import {
  HEALTH_TEXT_MODE_MAX,
  healthTextForMode,
  healthTextMode,
  unitFrameCurrentMaxText,
  unitFrameHealthText,
} from '../src/ui/hud_frames';
import { unitFrameView } from '../src/ui/unit_frame';

describe('unitFrameCurrentMaxText', () => {
  it('formats a current/max pair, matching the historical hand-built "current / max"', () => {
    expect(unitFrameCurrentMaxText(523, 600)).toBe('523 / 600');
  });

  it('keeps four-digit values ungrouped (no thousands separator, useGrouping:false)', () => {
    expect(unitFrameCurrentMaxText(1234, 5678)).toBe('1234 / 5678');
  });

  it('handles zero current health/resource', () => {
    expect(unitFrameCurrentMaxText(0, 600)).toBe('0 / 600');
  });

  it('handles current equal to max (full health/resource)', () => {
    expect(unitFrameCurrentMaxText(600, 600)).toBe('600 / 600');
  });
});

// The configurable health-text modes the player / target / target-of-target
// frames now share with the party frames (the playerFrameHealthText and
// targetFrameHealthText settings). Mode 3 must stay byte-identical to the
// always-on "current / max" the frames printed before the setting existed, so
// a player who never touches the option sees no change.
describe('unitFrameHealthText', () => {
  it('prints nothing in mode 0 (None)', () => {
    expect(unitFrameHealthText(523, 600, 0)).toBe('');
  });

  it('prints a whole-number percent in mode 1 (Percent)', () => {
    expect(unitFrameHealthText(523, 600, 1)).toBe('87%');
    expect(unitFrameHealthText(600, 600, 1)).toBe('100%');
  });

  it('prints only the current value in mode 2 (Current)', () => {
    expect(unitFrameHealthText(523, 600, 2)).toBe('523');
  });

  it('mode 3 (Current / Max) matches unitFrameCurrentMaxText exactly', () => {
    expect(unitFrameHealthText(523, 600, 3)).toBe(unitFrameCurrentMaxText(523, 600));
    expect(unitFrameHealthText(1234, 5678, 3)).toBe('1234 / 5678');
  });

  it('appends the percent in parentheses in mode 4 (Current / Max (Percent))', () => {
    expect(unitFrameHealthText(523, 600, 4)).toBe('523 / 600 (87%)');
    expect(unitFrameHealthText(0, 600, 4)).toBe('0 / 600 (0%)');
    expect(unitFrameHealthText(600, 600, 4)).toBe('600 / 600 (100%)');
  });

  it('clamps negative health to zero and a zero maximum to one', () => {
    expect(unitFrameHealthText(-5, 0, 4)).toBe('0 / 1 (0%)');
  });
});

describe('health text mode ceiling', () => {
  it('matches the max of every Health Text setting range', () => {
    expect(SETTING_RANGES.playerFrameHealthText.max).toBe(HEALTH_TEXT_MODE_MAX);
    expect(SETTING_RANGES.targetFrameHealthText.max).toBe(HEALTH_TEXT_MODE_MAX);
    expect(SETTING_RANGES.partyFrameHealthText.max).toBe(HEALTH_TEXT_MODE_MAX);
  });
});

describe('unit frame absorb suffix composition', () => {
  const descriptor = (hpText: string, showAbsorbText: boolean) => ({
    present: true,
    hpFrac: 0.5,
    hpText,
    showAbsorbText,
    resourceKind: 'mana' as const,
    resFrac: 1,
    resText: '',
    levelText: '60',
    name: 'Aerwynn',
    portraitKey: 'player',
    absorb: {
      hp: 300,
      maxHp: 600,
      auras: [
        {
          id: 'power_word_shield',
          name: 'Power Word: Shield',
          kind: 'absorb' as const,
          remaining: 30,
          duration: 30,
          value: 60,
          sourceId: 1,
          school: 'holy' as const,
        },
      ],
    },
    dead: false,
    outOfRange: false,
  });

  it('appends the shield total after the mode 4 text', () => {
    const v = unitFrameView(descriptor(unitFrameHealthText(300, 600, 4), true));
    expect(v.hpText).toBe('300 / 600 (50%) (60)');
  });

  it('prints nothing at all in mode 0, shield included', () => {
    const v = unitFrameView(descriptor(unitFrameHealthText(300, 600, 0), false));
    expect(v.hpText).toBe('');
  });
});

describe('healthTextMode', () => {
  it('rounds and clamps a raw setting value into the 0..4 mode table', () => {
    expect(healthTextMode(0, 3)).toBe(0);
    expect(healthTextMode(3.4, 1)).toBe(3);
    expect(healthTextMode(9, 1)).toBe(4);
    expect(healthTextMode(-2, 1)).toBe(0);
  });

  it('falls back when the settings store is not attached yet', () => {
    expect(healthTextMode(undefined, 3)).toBe(3);
    expect(healthTextMode(Number.NaN, 1)).toBe(1);
  });
});

describe('healthTextForMode', () => {
  const format = (value: number, percent?: boolean) =>
    percent ? `percent:${value}` : `number:${value}`;

  it('routes every mode through the injected formatter (the party painter contract)', () => {
    expect(healthTextForMode(75, 100, 0, format)).toBe('');
    expect(healthTextForMode(75, 100, 1, format)).toBe('percent:0.75');
    expect(healthTextForMode(75, 100, 2, format)).toBe('number:75');
    expect(healthTextForMode(75, 100, 3, format)).toBe('number:75 / number:100');
    expect(healthTextForMode(75, 100, 4, format)).toBe('number:75 / number:100 (percent:0.75)');
  });
});

// The bug-repro half: pin that hud.ts's player / target / target-of-target hp
// and resource sites actually CALL the shared formatter rather than rebuilding
// "current / max" via raw template-literal interpolation (the defect this fix
// closes). A source scan, not a behavioral diff, because a raw `${hp} / ${maxHp}`
// and unitFrameCurrentMaxText's useGrouping:false output are byte-identical for
// English, so only the source itself proves the five sites route through
// formatNumber; this failed before the fix (no import, five raw templates) and
// passes after it.
describe('hud.ts unit-frame text sites route through unitFrameCurrentMaxText', () => {
  const src = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');

  it("imports the formatters from './hud_frames'", () => {
    expect(src).toContain(
      "import { healthTextMode, unitFrameCurrentMaxText, unitFrameHealthText } from './hud_frames';",
    );
  });

  // Player resource + target resource keep the always-on "current / max"; the
  // three hp sites (player, target, target-of-target) route through the
  // mode-aware formatter so the Health Text settings apply.
  it('calls unitFrameCurrentMaxText at the two resource sites', () => {
    const calls = src.match(/unitFrameCurrentMaxText\(/g) ?? [];
    expect(calls.length).toBe(2);
  });

  it('calls unitFrameHealthText at the three player/target/target-of-target hp sites', () => {
    const calls = src.match(/unitFrameHealthText\(/g) ?? [];
    expect(calls.length).toBe(3);
  });

  it('reads the player mode from playerFrameHealthText and the target modes from targetFrameHealthText', () => {
    expect(src.match(/get\('playerFrameHealthText'\)/g)?.length).toBe(1);
    expect(src.match(/get\('targetFrameHealthText'\)/g)?.length).toBe(2);
  });

  it('never rebuilds a unit-frame "current / max" string via raw template interpolation', () => {
    expect(src).not.toMatch(/\$\{[\w.()]*\.hp\}\s*\/\s*\$\{[\w.()]*\.maxHp\}/);
    expect(src).not.toMatch(/\$\{[\w.()]*resource[\w.()]*\}\s*\/\s*\$\{[\w.()]*maxResource\}/i);
  });
});
