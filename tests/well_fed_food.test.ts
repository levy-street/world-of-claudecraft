import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { CONSUME_DURATION, type Entity } from '../src/sim/types';
import { setLanguage, supportedLanguages } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function addPlayer(sim: Sim): { pid: number; p: Entity } {
  const pid = sim.addPlayer('warrior', 'Aleph');
  sim.tick();
  const p = sim.entities.get(pid);
  if (!p) throw new Error('player missing after addPlayer');
  return { pid, p };
}

function finishConsume(sim: Sim): void {
  for (let i = 0; i < 20 * (CONSUME_DURATION + 1); i++) sim.tick();
}

describe('Well Fed food buffs', () => {
  it('applies a stamina aura only after cooked food is fully eaten', () => {
    const sim = makeWorld();
    const { pid, p } = addPlayer(sim);
    const beforeSta = p.stats.sta;
    const beforeMaxHp = p.maxHp;

    sim.addItem('baked_bread', 1, pid);
    sim.useItem('baked_bread', pid);

    expect(p.auras.some((a) => a.id === 'well_fed')).toBe(false);
    finishConsume(sim);

    const aura = p.auras.find((a) => a.id === 'well_fed');
    if (!aura) throw new Error('Well Fed aura missing after completed eating');
    expect(aura.name).toBe('Well Fed');
    expect(aura.kind).toBe('buff_sta');
    expect(aura.value).toBe(2);
    expect(aura.remaining).toBeGreaterThan(890);
    expect(p.eating).toBe(null);
    expect(p.stats.sta).toBe(beforeSta + 2);
    expect(p.maxHp).toBeGreaterThan(beforeMaxHp);
  });

  it('does not apply Well Fed when eating is interrupted', () => {
    const sim = makeWorld();
    const { pid, p } = addPlayer(sim);

    sim.addItem('baked_bread', 1, pid);
    sim.useItem('baked_bread', pid);
    for (let i = 0; i < 20 * 5; i++) sim.tick();
    sim.moveInput.forward = true;
    sim.tick();
    sim.moveInput.forward = false;
    finishConsume(sim);

    expect(p.eating).toBe(null);
    expect(p.auras.some((a) => a.id === 'well_fed')).toBe(false);
  });

  it('does not give raw fish a cooked-food buff', () => {
    const sim = makeWorld();
    const { pid, p } = addPlayer(sim);

    sim.addItem('raw_mirror_trout', 1, pid);
    sim.useItem('raw_mirror_trout', pid);
    finishConsume(sim);

    expect(p.auras.some((a) => a.id === 'well_fed')).toBe(false);
  });

  it('refreshes and replaces the shared food buff instead of stacking it', () => {
    const sim = makeWorld();
    const { pid, p } = addPlayer(sim);

    sim.addItem('baked_bread', 1, pid);
    sim.useItem('baked_bread', pid);
    finishConsume(sim);
    expect(p.auras.find((a) => a.id === 'well_fed')?.value).toBe(2);

    for (let i = 0; i < 20 * 5; i++) sim.tick();
    sim.addItem('roast_mountain_goat', 1, pid);
    sim.useItem('roast_mountain_goat', pid);
    finishConsume(sim);

    const foodAuras = p.auras.filter((a) => a.id === 'well_fed');
    expect(foodAuras).toHaveLength(1);
    expect(foodAuras[0].value).toBe(8);
    expect(foodAuras[0].remaining).toBeGreaterThan(890);
  });

  it('registers the Well Fed aura name for every supported locale', () => {
    for (const lang of supportedLanguages) {
      setLanguage(lang);
      const out = localizeSimAuraName('Well Fed');
      expect(out, `${lang}: Well Fed aura not recognized`).not.toBeNull();
      if (lang !== 'en' && lang !== 'en_CA') {
        expect(out, `${lang}: Well Fed aura stayed English`).not.toBe('Well Fed');
      }
    }
    setLanguage('en');
  });
});
