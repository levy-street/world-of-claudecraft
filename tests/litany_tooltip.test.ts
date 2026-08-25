import { afterEach, describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import { Hud } from '../src/ui/hud';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { EMPTY_TEST_WORLD } from './sim_shared';

interface AbilityTooltipHarness {
  sim: Sim;
  abilityTooltip(res: ResolvedAbility): string;
}

function tooltipHarness(): AbilityTooltipHarness {
  const hud = Object.create(Hud.prototype) as unknown as AbilityTooltipHarness;
  hud.sim = new Sim({
    seed: 42,
    playerClass: 'warlock',
    autoEquip: false,
    world: EMPTY_TEST_WORLD,
  });
  hud.sim.setPlayerLevel(20);
  expect(hud.sim.setSpec('affliction')).toBe(true);
  return hud;
}

function afflictionAbility(id: string): ResolvedAbility {
  const mods = computeTalentModifiers('warlock', {
    ...emptyAllocation(),
    spec: 'affliction',
  } as never);
  const ability = abilitiesKnownAt('warlock', 20, mods).find((known) => known.def.id === id);
  if (!ability) throw new Error(`missing Affliction ability ${id}`);
  return ability;
}

afterEach(() => setLanguage('en'));

describe('Litany of Guilt ability tooltip', () => {
  it('renders its resolved damage in the localized HUD effect line', async () => {
    await ensureLocaleLoaded('es');
    setLanguage('es');
    const html = tooltipHarness().abilityTooltip(afflictionAbility('litany_of_guilt'));

    expect(html).toContain(
      '<div class="tt-effect">Obtener Condena inflige 16 de daño de las Sombras a hasta 4 enemigos en 8 m, una vez por segundo</div>',
    );
  });

  it('does not add the Litany effect line to unrelated Affliction abilities', () => {
    const html = tooltipHarness().abilityTooltip(afflictionAbility('evil_eye'));

    expect(html).not.toContain('hudChrome.auraEffect.afflictionLitany');
    expect(html).not.toContain('Condemnation gains deal');
  });
});
