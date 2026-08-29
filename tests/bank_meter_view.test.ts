// @vitest-environment jsdom
// The capacity meter's copy, driven directly (Bank Storage phase 18).
//
// It is extracted precisely so it CAN be driven directly: inside the window
// each of these two decisions was reachable only by building the whole footer,
// which is the reason the pure-core recipe in src/ui/CLAUDE.md asks for a test
// that imports the core rather than the painter. The registration sweep in
// tests/architecture.test.ts proves the module is LISTED and host-agnostic; it
// proves nothing about whether anything ever runs it.
//
// The branch worth arming in both functions is `showMaterials`. It is the gate
// that decides whether a player is told their bank has TWO budgets, which is the
// only place the two-pool rule is written down for them, and getting it wrong in
// the quiet direction (always the simple line) is invisible to every geometry
// arm in the phase.

import { describe, expect, it } from 'vitest';
import { bankMeterAriaLabel, bankMeterTooltipHtml } from '../src/ui/bank_meter_view';
import type { BankMeterModel } from '../src/ui/bank_view';

function meter(over: Partial<BankMeterModel> = {}): BankMeterModel {
  return {
    used: 23,
    total: 32,
    general: { used: 21, capacity: 24, fraction: 21 / 24, over: false },
    materials: { used: 2, capacity: 8, fraction: 2 / 8, over: false },
    showMaterials: true,
    nearFull: true,
    over: false,
    ...over,
  };
}

describe('bankMeterAriaLabel', () => {
  it('speaks BOTH budgets when the materials pool has something to say', () => {
    const label = bankMeterAriaLabel(meter());
    // PHRASES, not digits. A bare toContain over each number is positional-blind:
    // swapping the general and materials terms leaves every digit present, so the
    // readout can say "General: 2 of 24. Materials: 21 of 8" and pass. Each pool's
    // numbers are asserted joined to their own label, which is the only form that
    // can tell the two apart.
    expect(label).toMatch(/General items: 21 of 24/);
    expect(label).toMatch(/Materials: 2 of 8/);
    // ...and the summed pair is still there beside them.
    expect(label).toMatch(/23 of 32/);
  });

  it('keeps the simple line for a bank with no socketed satchel', () => {
    const label = bankMeterAriaLabel(meter({ showMaterials: false }));
    expect(label).toMatch(/23 of 32/);
    // ...and does NOT invent a materials budget that does not exist. The
    // capacities differ from the summed pair, so this is a real discriminator
    // rather than a substring that happens to be absent.
    expect(label).not.toContain('21');
  });

  it('is a different sentence in each arm, so the gate is doing something', () => {
    expect(bankMeterAriaLabel(meter())).not.toBe(
      bankMeterAriaLabel(meter({ showMaterials: false })),
    );
  });
});

describe('bankMeterTooltipHtml', () => {
  it('adds the materials line AND the note that explains the two budgets', () => {
    const html = bankMeterTooltipHtml(meter());
    expect(html.match(/class="tt-sub"/g)?.length).toBe(2);
    expect(html).toContain('bank-meter-note');
    // Counting the lines says nothing about what is IN them: feeding the
    // materials line the general pool's values keeps both lines, the note, and
    // the count, and tells the player their satchel holds 21 of 8. Pin each
    // pool's numbers to its own label.
    expect(html).toMatch(/General: 21 of 24/);
    expect(html).toMatch(/Materials: 2 of 8/);
  });

  it('drops both when there is no materials pool, leaving the general line alone', () => {
    const html = bankMeterTooltipHtml(meter({ showMaterials: false }));
    expect(html.match(/class="tt-sub"/g)?.length).toBe(1);
    expect(html).not.toContain('bank-meter-note');
  });

  it('builds one well-formed tt-sub block per line', () => {
    // TITLED FOR WHAT IT HOLDS. An earlier title claimed this armed the esc()
    // calls; it cannot. Every interpolated value here is a formatted number and
    // the copy is catalog English, so deleting esc() outright leaves this green.
    // What it does hold is the concatenation's shape, which is what breaks when
    // a line is added or a wrapper is dropped.
    const html = bankMeterTooltipHtml(meter());
    expect(html.startsWith('<div class="tt-sub">')).toBe(true);
    expect(html.endsWith('</div>')).toBe(true);
    expect(html.match(/<div/g)?.length).toBe(html.match(/<\/div>/g)?.length);
  });
});
