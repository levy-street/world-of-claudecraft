// Tests for the pure unitFrameCurrentMaxText formatter (hud_frames.ts), which
// the player / target / target-of-target unit frames in hud.ts use for their
// "current / max" hp and resource text, replacing the raw template-literal
// interpolation those five sites used to bypass formatNumber with (unlike
// party frames, which already routed through it via partyFrameHealthText).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unitFrameCurrentMaxText } from '../src/ui/hud_frames';

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

  it("imports unitFrameCurrentMaxText from './hud_frames'", () => {
    expect(src).toContain("import { unitFrameCurrentMaxText } from './hud_frames';");
  });

  // Player hp/resource, target hp/resource, target-of-target hp: the five
  // "current / max" sites the player/target/target-of-target unit frames paint.
  it('calls unitFrameCurrentMaxText at all five player/target/target-of-target sites', () => {
    const calls = src.match(/unitFrameCurrentMaxText\(/g) ?? [];
    expect(calls.length).toBe(5);
  });

  it('never rebuilds a unit-frame "current / max" string via raw template interpolation', () => {
    expect(src).not.toMatch(/\$\{[\w.()]*\.hp\}\s*\/\s*\$\{[\w.()]*\.maxHp\}/);
    expect(src).not.toMatch(/\$\{[\w.()]*resource[\w.()]*\}\s*\/\s*\$\{[\w.()]*maxResource\}/i);
  });
});
