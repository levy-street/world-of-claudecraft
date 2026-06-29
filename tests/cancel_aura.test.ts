import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Aura } from '../src/sim/types';

const makeSim = (cls: 'warrior' | 'mage' = 'warrior', seed = 42) =>
  new Sim({ seed, playerClass: cls, autoEquip: true });

function buff(over: Partial<Aura> = {}): Aura {
  return {
    id: 'might',
    name: 'Battle Might',
    kind: 'buff_ap',
    remaining: 30,
    duration: 30,
    value: 50,
    sourceId: 0,
    school: 'physical',
    ...over,
  };
}

describe('Sim.cancelAura', () => {
  it('removes the player own helpful buff and emits a fade event', () => {
    const sim = makeSim();
    const p = sim.player;
    p.auras.push(buff({ sourceId: p.id }));
    sim.tick(); // drain any pending startup events
    sim.cancelAura('might');
    const events = sim.tick();
    expect(p.auras.some((a) => a.id === 'might')).toBe(false);
    expect(
      events.some((e: any) => e.type === 'aura' && e.name === 'Battle Might' && !e.gained),
    ).toBe(true);
  });

  it('un-folds the stat contribution (recalc) when a stat buff is canceled', () => {
    const sim = makeSim();
    const p = sim.player;
    const apBefore = p.attackPower;
    // Apply through the real path so recalc folds it in.
    (sim as any).applyAura(p, buff({ id: 'might', kind: 'buff_ap', value: 75, sourceId: p.id }));
    expect(p.attackPower).toBeGreaterThan(apBefore);
    sim.cancelAura('might');
    expect(p.attackPower).toBe(apBefore);
  });

  it('refuses to cancel a debuff (no free CC break)', () => {
    const sim = makeSim();
    const p = sim.player;
    p.auras.push(buff({ id: 'hex', name: 'Hex', kind: 'hex', value: 1, sourceId: 999 }));
    sim.cancelAura('hex');
    expect(p.auras.some((a) => a.id === 'hex')).toBe(true);
  });

  it('is a no-op for an unknown aura id', () => {
    const sim = makeSim();
    const p = sim.player;
    p.auras.push(buff({ sourceId: p.id }));
    sim.cancelAura('absent');
    expect(p.auras).toHaveLength(1);
  });
});
