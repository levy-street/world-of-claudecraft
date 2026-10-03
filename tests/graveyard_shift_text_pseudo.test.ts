// @vitest-environment happy-dom
//
// The English keys read exactly like the English names the sim stamps on auras and
// combat events, so an English run cannot tell a keyed name from a raw fallback.
// The en_XA pseudo-locale can: every keyed leaf comes back accent-pushed and
// bracketed, a raw English name comes back untouched. A fresh import per case lets
// the i18n init read ?lang=en_XA (the tests/deed_i18n_pseudo.test.ts pattern).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { morthenIdentityAura } from '../src/sim/graveyard_shift/morthen_identity';
import { en_XA } from '../src/ui/i18n.resolved.generated/en_XA';

const PSEUDO = en_XA.devCommand.graveyardShift;

async function loadPseudoActive() {
  window.history.replaceState({}, '', '/?lang=en_XA');
  vi.resetModules();
  const [aura, ability, cast] = await Promise.all([
    import('../src/ui/aura_display_name'),
    import('../src/ui/ability_display_name'),
    import('../src/ui/cast_display_name'),
  ]);
  return { ...aura, ...ability, ...cast };
}

afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.resetModules();
});

describe('Graveyard Shift names under the pseudo-locale', () => {
  it('keys the identity aura and the kit auras in the buff bar localizer', async () => {
    const { auraDisplayNameFromSource, auraDisplayNameForHud } = await loadPseudoActive();
    const identity = morthenIdentityAura(1).name;
    expect(PSEUDO.identityAura).not.toBe(identity);
    expect(auraDisplayNameFromSource(identity)).toBe(PSEUDO.identityAura);
    expect(auraDisplayNameForHud(identity, null)).toBe(PSEUDO.identityAura);
    expect(auraDisplayNameForHud('Barrow Shroud', null)).toBe(PSEUDO.abilities.barrowShroud.name);
  });

  it('keys combat-event names and cast-bar ids for the kit', async () => {
    const { abilityDisplayNameFromSource, castDisplayName } = await loadPseudoActive();
    expect(abilityDisplayNameFromSource('Gravecall')).toBe(PSEUDO.abilities.gravecall.name);
    expect(abilityDisplayNameFromSource("Sexton's Chain")).toBe(PSEUDO.abilities.sextonsChain.name);
    expect(castDisplayName('gshift_shadow_pulse')).toBe(PSEUDO.abilities.shadowPulse.name);
  });
});
