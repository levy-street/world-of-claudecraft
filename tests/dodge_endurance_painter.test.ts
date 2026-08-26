import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DODGE_ENDURANCE_RECHARGE_SECONDS,
  DODGE_ENDURANCE_REGEN_PER_SECOND,
} from '../src/sim/player_dodge';
import type { Entity } from '../src/sim/types';
import { DodgeEndurancePainter, dodgeEnduranceView } from '../src/ui/dodge_endurance_painter';
import type { PainterHostWriters } from '../src/ui/painter_host';

function endurancePainterFixture(): {
  painter: DodgeEndurancePainter;
  calls: string[];
} {
  const calls: string[] = [];
  const writers: PainterHostWriters = {
    setText: () => {},
    setDisplay: () => {},
    setTransform: (_el, value) => calls.push(`transform:${value}`),
    setWidth: () => {},
    setStyleProp: () => {},
    toggleClass: (_el, cls, on) => calls.push(`class:${cls}:${on}`),
    setAttr: (_el, name, value) => calls.push(`attr:${name}:${value}`),
  };
  return {
    painter: new DodgeEndurancePainter(
      writers,
      {} as HTMLElement,
      {} as HTMLElement,
      {} as HTMLElement,
    ),
    calls,
  };
}

describe('dodge endurance painter', () => {
  it('exposes two independently filling dodge charges', () => {
    expect(dodgeEnduranceView(0)).toMatchObject({
      firstFraction: 0,
      secondFraction: 0,
      readyCharges: 0,
      nextChargeSeconds: DODGE_ENDURANCE_RECHARGE_SECONDS,
    });
    expect(dodgeEnduranceView(25)).toMatchObject({
      firstFraction: 0.5,
      secondFraction: 0,
      readyCharges: 0,
      nextChargeSeconds: 25 / DODGE_ENDURANCE_REGEN_PER_SECOND,
    });
    expect(dodgeEnduranceView(75)).toMatchObject({
      firstFraction: 1,
      secondFraction: 0.5,
      readyCharges: 1,
      nextChargeSeconds: 25 / DODGE_ENDURANCE_REGEN_PER_SECOND,
    });
    expect(dodgeEnduranceView(100)).toMatchObject({
      firstFraction: 1,
      secondFraction: 1,
      readyCharges: 2,
      nextChargeSeconds: 0,
    });
  });

  it.each(['index.html', 'play.html'])('mounts the two-charge meter in %s', (shell) => {
    const html = readFileSync(shell, 'utf8');
    expect(html.match(/id="dodge-endurance"/g)).toHaveLength(1);
    expect(html).toContain('id="dodge-endurance-first"');
    expect(html).toContain('id="dodge-endurance-second"');
    expect(html).toContain('data-charges="2"');
  });

  it('pulses the pip that was consumed by each consecutive dodge', () => {
    const { painter, calls } = endurancePainterFixture();
    painter.paint({ endurance: 100 } as Entity);
    calls.length = 0;

    painter.paint({ endurance: 50 } as Entity);
    expect(calls).toContain('attr:data-spent-slot:2');
    expect(calls).toContain('class:spent-a:true');

    calls.length = 0;
    painter.paint({ endurance: 0 } as Entity);
    expect(calls).toContain('attr:data-spent-slot:1');
    expect(calls).toContain('class:spent-b:true');
  });
});
