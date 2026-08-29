// @vitest-environment jsdom
// The spin wheel's geometry and markup, now that they are reachable.
//
// Bank Storage phase 17 moved them out of src/ui/daily_rewards_window.ts (the
// extraction that file's ratchet row named), and nothing had ever tested either:
// the landing angle was a private method reachable only by driving a real spin,
// and the button's disabled rule was a template expression inside a private
// markup builder. Both are decisions, so both get arms.
import { describe, expect, it } from 'vitest';
import {
  SPIN_WHEEL_VALUES,
  spinLandingAngle,
  spinOverlayHtml,
  spinSectionHtml,
} from '../src/ui/daily_rewards_spin_view';
import type { DailyRewardsView } from '../src/ui/daily_rewards_view';
import { t } from '../src/ui/i18n';
import type { DailyRewardStatus } from '../src/world_api';

type Ready = Extract<DailyRewardsView, { kind: 'ready' }>;

function ready(over: { locked?: boolean; claimed?: boolean; points?: number | null } = {}): Ready {
  const status = {
    spin: { claimed: over.claimed ?? false, points: over.points ?? null },
  } as unknown as DailyRewardStatus;
  return { kind: 'ready', status, locked: over.locked ?? false } as unknown as Ready;
}

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

describe('spinLandingAngle', () => {
  it('aims at the CENTRE of the segment holding the award, not at its edge', () => {
    const segment = 360 / SPIN_WHEEL_VALUES.length;
    for (const [index, value] of SPIN_WHEEL_VALUES.entries()) {
      expect(spinLandingAngle(value), `award ${value}`).toBeCloseTo(
        -(index * segment + segment / 2),
        10,
      );
    }
  });

  it('an award that is NOT on the wheel lands on the first segment rather than past the end', () => {
    // indexOf answers -1 and the clamp is what turns that into segment 0. Without
    // it the wheel aims at +segment/2, which is a positive angle: the wheel spins
    // the wrong way and stops between two labels.
    // The expectation is derived from SPIN_WHEEL_VALUES, NOT from a call to the
    // function under test: `toBe(spinLandingAngle(SPIN_WHEEL_VALUES[0]))` is a
    // self-comparison that survives replacing the whole body with a constant.
    const first = -(360 / SPIN_WHEEL_VALUES.length) / 2;
    expect(spinLandingAngle(SPIN_WHEEL_VALUES[0]), 'segment 0 is the clamp target').toBeCloseTo(
      first,
      10,
    );
    for (const off of [7, 0, -5, 1000, Number.NaN]) {
      expect(spinLandingAngle(off), `award ${off}`).toBeCloseTo(first, 10);
    }
  });

  it('every landing angle is a NEGATIVE rotation, so the wheel always turns one way', () => {
    for (const value of SPIN_WHEEL_VALUES) expect(spinLandingAngle(value)).toBeLessThan(0);
  });
});

describe('spinSectionHtml: when the button may be pressed', () => {
  it('is enabled only when the reward is neither locked nor already claimed', () => {
    const cases: [{ locked?: boolean; claimed?: boolean }, boolean][] = [
      [{}, true],
      [{ locked: true }, false],
      [{ claimed: true }, false],
      [{ locked: true, claimed: true }, false],
    ];
    for (const [over, enabled] of cases) {
      const button = mount(spinSectionHtml(ready(over))).querySelector<HTMLButtonElement>(
        '[data-spin]',
      );
      expect(button, JSON.stringify(over)).not.toBeNull();
      expect(button?.disabled, JSON.stringify(over)).toBe(!enabled);
    }
  });

  it('shows the awarded points once claimed, and a question mark before', () => {
    expect(mount(spinSectionHtml(ready())).querySelector('.dr-wheel')?.textContent).toBe('?');
    expect(
      mount(spinSectionHtml(ready({ claimed: true, points: 75 }))).querySelector('.dr-wheel')
        ?.textContent,
    ).toBe('+75');
    // A claimed spin with no recorded points reads as zero rather than as blank.
    expect(
      mount(spinSectionHtml(ready({ claimed: true, points: null }))).querySelector('.dr-wheel')
        ?.textContent,
    ).toBe('+0');
  });
});

describe('spinOverlayHtml: the modal stage', () => {
  it('is a labelled modal dialog carrying one label per wheel segment', () => {
    const host = mount(spinOverlayHtml(75));
    const stage = host.querySelector('.dr-spin-stage');
    expect(stage?.getAttribute('role')).toBe('dialog');
    expect(stage?.getAttribute('aria-modal')).toBe('true');
    // The RESOLVED sentence, not `not.toBe('')`: getAttribute answers null for a
    // missing attribute and null !== '', so the loose form passes over an
    // aria-modal dialog with no accessible name at all, and over a re-pointed key.
    expect(stage?.getAttribute('aria-label')).toBe(t('hudChrome.dailyRewards.spinDialogTitle'));
    // BOTH halves: toBe(t(key)) pins the wiring but would go green over an EMPTIED
    // catalog row, which ships an aria-modal dialog with no accessible name.
    expect(stage?.getAttribute('aria-label')).not.toBe('');
    expect(host.querySelectorAll('.dr-spin-wheel-big span').length).toBe(SPIN_WHEEL_VALUES.length);
  });

  it('pre-aims the big wheel at the award, so the CSS animation lands on it', () => {
    // 150 is the SEVENTH of eight segments, so the centre is 6 * 45 + 22.5 and the
    // rotation is its negative. Interpolating spinLandingAngle(150) here instead
    // would move both sides of the comparison together and pin only the wiring.
    const wheel = mount(spinOverlayHtml(150)).querySelector<HTMLElement>('.dr-spin-wheel-big');
    expect(SPIN_WHEEL_VALUES.indexOf(150), 'the literal below assumes this index').toBe(6);
    expect(wheel?.getAttribute('style')).toContain('--land-angle:-292.5deg');
  });

  it('carries exactly one focusable control, the close button, and hides the decoration', () => {
    const host = mount(spinOverlayHtml(50));
    expect(host.querySelectorAll('button').length).toBe(1);
    expect(host.querySelector('[data-spin-close]')?.getAttribute('aria-label')).toBe(
      t('hudChrome.dailyRewards.spinClose'),
    );
    expect(host.querySelector('[data-spin-close]')?.getAttribute('aria-label')).not.toBe('');
    for (const decorative of ['.dr-spin-pointer', '.dr-spin-wheel-big']) {
      expect(host.querySelector(decorative)?.getAttribute('aria-hidden'), decorative).toBe('true');
    }
  });
});
