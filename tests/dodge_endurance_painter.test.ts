import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DODGE_ENDURANCE_RECHARGE_SECONDS,
  DODGE_ENDURANCE_REGEN_PER_SECOND,
} from '../src/sim/player_dodge';
import { dodgeEnduranceView } from '../src/ui/dodge_endurance_painter';

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
});
