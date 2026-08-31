// @vitest-environment happy-dom
// Tests the SwingTimerBars binding (src/ui/swing_timer_bars.ts): resolves the
// two bars' DOM refs once from real elements, then drives both independent
// clocks per update() call. The pure fill/ready math is already covered by
// tests/swing_timer.test.ts; this only proves the binding wires the two real
// elements to the two independent cores and never cross-wires them.

import { beforeEach, describe, expect, it } from 'vitest';
import type { PainterHostWriters } from '../src/ui/painter_host';
import { SwingTimerBars } from '../src/ui/swing_timer_bars';

type Call = { m: keyof PainterHostWriters; args: unknown[] };

function recordingWriters(): { calls: Call[]; writers: PainterHostWriters } {
  const calls: Call[] = [];
  const rec =
    <K extends keyof PainterHostWriters>(m: K) =>
    (...args: unknown[]) => {
      calls.push({ m, args });
    };
  return {
    calls,
    writers: {
      setText: rec('setText'),
      setDisplay: rec('setDisplay'),
      setTransform: rec('setTransform'),
      setWidth: rec('setWidth'),
      setStyleProp: rec('setStyleProp'),
      toggleClass: rec('toggleClass'),
      setAttr: rec('setAttr'),
    } as PainterHostWriters,
  };
}

function mountBars(): void {
  document.body.innerHTML = `
    <div id="swingbar" aria-hidden="true"><div class="fill"></div><div class="label"></div></div>
    <div id="swingbar-offhand" aria-hidden="true"><div class="fill"></div><div class="label"></div></div>
  `;
}

const LIVE_TARGET = { dead: false, kind: 'mob' };

beforeEach(() => {
  mountBars();
});

describe('SwingTimerBars: resolves each bar element once, from the real DOM', () => {
  it('never queries the wrong bar (fill/label writes land on their own element)', () => {
    const { calls, writers } = recordingWriters();
    const bars = new SwingTimerBars(writers);
    const swingbar = document.querySelector('#swingbar') as HTMLElement;
    const offhandBar = document.querySelector('#swingbar-offhand') as HTMLElement;

    bars.update(
      {
        autoAttack: true,
        swingTimer: 1,
        weapon: { speed: 2 },
        offhandSwingTimer: 0.5,
        offhandWeapon: { speed: 1.6 },
      },
      LIVE_TARGET,
    );

    const displayCalls = calls.filter((c) => c.m === 'setDisplay');
    expect(displayCalls).toEqual([
      { m: 'setDisplay', args: [swingbar, 'block'] },
      { m: 'setDisplay', args: [offhandBar, 'block'] },
    ]);
  });
});

describe('SwingTimerBars: the main-hand and off-hand clocks stay independent across frames', () => {
  it('main-hand ready does not force the off-hand bar ready, and vice versa', () => {
    const { calls, writers } = recordingWriters();
    const bars = new SwingTimerBars(writers);

    // Main-hand at 0 (ready); off-hand still mid-swing.
    bars.update(
      {
        autoAttack: true,
        swingTimer: 0,
        weapon: { speed: 2 },
        offhandSwingTimer: 1,
        offhandWeapon: { speed: 1.6 },
      },
      LIVE_TARGET,
    );

    const toggles = calls.filter((c) => c.m === 'toggleClass');
    // Exactly one 'ready' toggle true (main-hand) and one false (off-hand).
    expect(toggles.filter((c) => c.args[2] === true)).toHaveLength(1);
    expect(toggles.filter((c) => c.args[2] === false)).toHaveLength(1);
  });

  it('the off-hand bar hides when the player stops dual-wielding, main-hand stays visible', () => {
    const { calls, writers } = recordingWriters();
    const bars = new SwingTimerBars(writers);

    bars.update(
      {
        autoAttack: true,
        swingTimer: 1,
        weapon: { speed: 2 },
        offhandSwingTimer: 1,
        offhandWeapon: null,
      },
      LIVE_TARGET,
    );

    const displayCalls = calls.filter((c) => c.m === 'setDisplay');
    expect(displayCalls).toEqual([
      { m: 'setDisplay', args: [document.querySelector('#swingbar'), 'block'] },
      { m: 'setDisplay', args: [document.querySelector('#swingbar-offhand'), 'none'] },
    ]);
  });

  it('each clock recovers its OWN period from its OWN weapon speed on first show', () => {
    const { calls, writers } = recordingWriters();
    const bars = new SwingTimerBars(writers);

    // Frame 1: main-hand speed 2.5, off-hand speed 1.2 (both fresh, frac 0).
    bars.update(
      {
        autoAttack: true,
        swingTimer: 2.5,
        weapon: { speed: 2.5 },
        offhandSwingTimer: 1.2,
        offhandWeapon: { speed: 1.2 },
      },
      LIVE_TARGET,
    );
    // Frame 2: both timers tick down by 0.1s. Each bar's fill must track its
    // OWN recovered period, not the other bar's.
    bars.update(
      {
        autoAttack: true,
        swingTimer: 2.4,
        weapon: { speed: 2.5 },
        offhandSwingTimer: 1.1,
        offhandWeapon: { speed: 1.2 },
      },
      LIVE_TARGET,
    );

    const widths = calls.filter((c) => c.m === 'setWidth').map((c) => c.args[1]);
    // Frame 1: both frac 0 -> "0.0%" twice. Frame 2: main-hand frac =
    // 1 - 2.4/2.5 = 0.04 -> "4.0%"; off-hand frac = 1 - 1.1/1.2 = 0.0833... ->
    // "8.3%". Different periods, different fills, each correct for its own
    // weapon speed.
    expect(widths).toEqual(['0.0%', '0.0%', '4.0%', '8.3%']);
  });
});
