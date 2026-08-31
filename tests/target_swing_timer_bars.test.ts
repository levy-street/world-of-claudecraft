// @vitest-environment happy-dom
// Tests the TargetSwingTimerBars binding (src/ui/target_swing_timer_bars.ts):
// resolves the target and target-of-target bars' DOM refs once, drives both
// independent clocks per update() call, and resolves the target-of-target
// entity itself (independent of the unrelated showTargetOfTarget mini-frame
// toggle). The pure fill/ready math is already covered by
// tests/swing_timer.test.ts; this only proves the binding wires the two real
// elements to the two independent cores and resolves tot correctly.

import { beforeEach, describe, expect, it } from 'vitest';
import type { PainterHostWriters } from '../src/ui/painter_host';
import { TargetSwingTimerBars } from '../src/ui/target_swing_timer_bars';

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
    <div id="swingbar-target" aria-hidden="true"><div class="fill"></div><div class="label"></div></div>
    <div id="swingbar-tot" aria-hidden="true"><div class="fill"></div><div class="label"></div></div>
  `;
}

// targetId/aggroTargetId are part of TargetSwingSourceInput (needed for
// targetOfTargetId resolution); null here means "no target of its own",
// so these three tests never surface a tot bar.
const ATTACKING = {
  id: 1,
  dead: false,
  kind: 'mob',
  autoAttack: true,
  swingTimer: 1,
  targetId: null,
  aggroTargetId: null,
};

beforeEach(() => {
  mountBars();
});

function entitiesOf(
  map: Record<
    number,
    { id?: number; dead: boolean; kind: string; autoAttack: boolean; swingTimer: number }
  >,
) {
  return { get: (id: number) => map[id] };
}

describe('TargetSwingTimerBars: visibility follows the enabled flag', () => {
  it('hides both bars when disabled, even against a live auto-attacking target', () => {
    const { calls, writers } = recordingWriters();
    const bars = new TargetSwingTimerBars(writers);

    bars.update(ATTACKING, entitiesOf({}), false);

    const displayCalls = calls.filter((c) => c.m === 'setDisplay');
    expect(displayCalls).toEqual([
      { m: 'setDisplay', args: [document.querySelector('#swingbar-target'), 'none'] },
      { m: 'setDisplay', args: [document.querySelector('#swingbar-tot'), 'none'] },
    ]);
  });

  it('shows the target bar when enabled and the target is auto-attacking', () => {
    const { calls, writers } = recordingWriters();
    const bars = new TargetSwingTimerBars(writers);

    bars.update(ATTACKING, entitiesOf({}), true);

    const displayCalls = calls.filter((c) => c.m === 'setDisplay');
    expect(displayCalls[0]).toEqual({
      m: 'setDisplay',
      args: [document.querySelector('#swingbar-target'), 'block'],
    });
  });

  it('hides the target bar when there is no target, even enabled', () => {
    const { calls, writers } = recordingWriters();
    const bars = new TargetSwingTimerBars(writers);

    bars.update(null, entitiesOf({}), true);

    const displayCalls = calls.filter((c) => c.m === 'setDisplay');
    expect(displayCalls[0]).toEqual({
      m: 'setDisplay',
      args: [document.querySelector('#swingbar-target'), 'none'],
    });
  });

  // Distinct from the first test above: ATTACKING's aggroTargetId is null, so
  // that test cannot tell whether the enabled gate actually reaches the tot
  // resolution, only the target one (totId resolves to null either way). This
  // one gives the target a REAL, live target-of-target so a dropped `enabled`
  // check on the tot side would surface the tot bar even while disabled.
  it('hides the tot bar when disabled, even against a live target-of-target of its own', () => {
    const { calls, writers } = recordingWriters();
    const bars = new TargetSwingTimerBars(writers);
    const target = {
      id: 1,
      dead: false,
      kind: 'mob',
      autoAttack: true,
      swingTimer: 1,
      targetId: null,
      aggroTargetId: 55,
    };
    const totEntity = { dead: false, kind: 'player', autoAttack: true, swingTimer: 0.5 };

    bars.update(target as any, entitiesOf({ 55: totEntity }), false);

    const displayCalls = calls.filter((c) => c.m === 'setDisplay');
    expect(displayCalls).toEqual([
      { m: 'setDisplay', args: [document.querySelector('#swingbar-target'), 'none'] },
      { m: 'setDisplay', args: [document.querySelector('#swingbar-tot'), 'none'] },
    ]);
  });
});

describe('TargetSwingTimerBars: resolves the target-of-target entity itself', () => {
  it('shows the tot bar when the target has a live, auto-attacking target of its own', () => {
    const { calls, writers } = recordingWriters();
    const bars = new TargetSwingTimerBars(writers);
    const target = {
      id: 1,
      dead: false,
      kind: 'mob',
      autoAttack: true,
      swingTimer: 1,
      targetId: null,
      aggroTargetId: 55,
    };
    const totEntity = { dead: false, kind: 'player', autoAttack: true, swingTimer: 0.5 };

    bars.update(target as any, entitiesOf({ 55: totEntity }), true);

    const displayCalls = calls.filter((c) => c.m === 'setDisplay');
    expect(displayCalls).toEqual([
      { m: 'setDisplay', args: [document.querySelector('#swingbar-target'), 'block'] },
      { m: 'setDisplay', args: [document.querySelector('#swingbar-tot'), 'block'] },
    ]);
  });

  it('hides the tot bar when the target-of-target id resolves to an unknown entity (out of interest range)', () => {
    const { calls, writers } = recordingWriters();
    const bars = new TargetSwingTimerBars(writers);
    const target = {
      id: 1,
      dead: false,
      kind: 'mob',
      autoAttack: true,
      swingTimer: 1,
      targetId: null,
      aggroTargetId: 999,
    };

    bars.update(target as any, entitiesOf({}), true);

    const displayCalls = calls.filter((c) => c.m === 'setDisplay');
    expect(displayCalls[1]).toEqual({
      m: 'setDisplay',
      args: [document.querySelector('#swingbar-tot'), 'none'],
    });
  });

  it('the target and tot clocks stay independent across frames', () => {
    const { calls, writers } = recordingWriters();
    const bars = new TargetSwingTimerBars(writers);
    const target = {
      id: 1,
      dead: false,
      kind: 'mob',
      autoAttack: true,
      swingTimer: 2.5,
      targetId: null,
      aggroTargetId: 55,
    };
    const totEntity = { dead: false, kind: 'player', autoAttack: true, swingTimer: 1.2 };
    bars.update(target as any, entitiesOf({ 55: totEntity }), true);

    const target2 = { ...target, swingTimer: 2.4 };
    const totEntity2 = { ...totEntity, swingTimer: 1.1 };
    bars.update(target2 as any, entitiesOf({ 55: totEntity2 }), true);

    const widths = calls.filter((c) => c.m === 'setWidth').map((c) => c.args[1]);
    // Frame 1: both frac 0. Frame 2: target frac = 1 - 2.4/2.5 = 0.04 -> "4.0%";
    // tot frac = 1 - 1.1/1.2 = 0.0833... -> "8.3%". Each tracks its own period.
    expect(widths).toEqual(['0.0%', '0.0%', '4.0%', '8.3%']);
  });

  it('resets the target clock when the selected target id changes', () => {
    const { calls, writers } = recordingWriters();
    const bars = new TargetSwingTimerBars(writers);
    const first = {
      id: 1,
      dead: false,
      kind: 'mob',
      autoAttack: true,
      swingTimer: 2.5,
      targetId: null,
      aggroTargetId: null,
    };
    bars.update(first, entitiesOf({}), true);
    bars.update({ ...first, swingTimer: 2.4 }, entitiesOf({}), true);
    bars.update({ ...first, id: 2, swingTimer: 2.3 }, entitiesOf({}), true);

    const widths = calls.filter((c) => c.m === 'setWidth').map((c) => c.args[1]);
    expect(widths).toEqual(['0.0%', '4.0%', '0.0%']);
  });

  it('resets the tot clock when the target-of-target id changes', () => {
    const { calls, writers } = recordingWriters();
    const bars = new TargetSwingTimerBars(writers);
    const target = {
      id: 1,
      dead: false,
      kind: 'mob',
      autoAttack: false,
      swingTimer: 0,
      targetId: null,
      aggroTargetId: 55,
    };
    const firstTot = { id: 55, dead: false, kind: 'player', autoAttack: true, swingTimer: 1.2 };
    const secondTot = { id: 77, dead: false, kind: 'player', autoAttack: true, swingTimer: 1.0 };
    bars.update(target as any, entitiesOf({ 55: firstTot }), true);
    bars.update(target as any, entitiesOf({ 55: { ...firstTot, swingTimer: 1.1 } }), true);
    bars.update({ ...target, aggroTargetId: 77 } as any, entitiesOf({ 77: secondTot }), true);

    const widths = calls.filter((c) => c.m === 'setWidth').map((c) => c.args[1]);
    expect(widths).toEqual(['0.0%', '8.3%', '0.0%']);
  });
});
