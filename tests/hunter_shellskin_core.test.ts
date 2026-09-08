import { describe, expect, it } from 'vitest';
import { shellskinAura, shellskinReveal } from '../src/render/hunter_shellskin_core';
import { Sim } from '../src/sim/sim';

describe('Shellskin follows canonical defensive state', () => {
  it.each([false, true])(
    'reads the real mitigation and retained lifetime (Shell and Fang: %s)',
    (talent) => {
      const sim = new Sim({ seed: 2934, playerClass: 'hunter', autoEquip: true });
      sim.setPlayerLevel(20);
      sim.applyTalents({
        spec: 'marksmanship',
        rows: talent ? { 17: 'hun_r17_shell_and_fang' } : {},
      });
      sim.castAbility('shellskin');
      const aura = shellskinAura(sim.player.auras);
      expect(aura?.value).toBe(talent ? 0.4 : 0.6);
      expect(aura?.duration).toBe(8);
      expect(aura).toBe(sim.player.auras.find((a) => a.id === 'shellskin'));
      expect(shellskinAura(sim.player.auras, true)).toBeNull();
    },
  );
  it('ends immediately when Receding Shell removes the actual aura', () => {
    const sim = new Sim({ seed: 2921, playerClass: 'hunter', autoEquip: true });
    sim.setPlayerLevel(20);
    sim.applyTalents({ spec: 'survival', rows: { 8: 'hun_r8_receding_shell' } });
    sim.castAbility('shellskin');
    const aura = shellskinAura(sim.player.auras);
    expect(aura).not.toBeNull();
    if (!aura) throw new Error('Missing canonical Shellskin');
    aura.remaining = 6;
    sim.castAbility('shellskin');
    expect(shellskinAura(sim.player.auras)).toBeNull();
  });
  it('does not borrow another character defense or replay a reveal on late sighting', () => {
    const aura = { id: 'shellskin', kind: 'shield_wall', value: 0.6, duration: 8, remaining: 8 };
    expect(shellskinReveal(aura)).toBeLessThan(0.2);
    expect(shellskinReveal({ ...aura, remaining: 7.7 })).toBe(1);
    expect(shellskinAura([{ ...aura, remaining: 0 }])).toBeNull();
    expect(shellskinAura([{ ...aura, id: 'shield_wall' }])).toBeNull();
    expect(shellskinAura([{ ...aura, kind: 'slow' }])).toBeNull();
  });
});
