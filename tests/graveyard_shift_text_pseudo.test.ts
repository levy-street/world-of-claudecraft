// @vitest-environment happy-dom
//
// The English keys read exactly like the English names the sim stamps on auras and
// combat events, so an English run cannot tell a keyed name from a raw fallback.
// The en_XA pseudo-locale can: every keyed leaf comes back accent-pushed and
// bracketed, a raw English name comes back untouched.
//
// The i18n init reads ?lang= once, at module evaluation. The URL is set in a
// vi.hoisted block, which runs before the static imports below, so the whole
// resolver graph (sim content, talent and sim tables, both catalogs) is evaluated
// ONCE with the pseudo flag on. A vi.resetModules plus dynamic import per case
// re-evaluated that graph for every case and blew the 20 sec budget under a
// loaded parallel run.

import { afterAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  window.history.replaceState({}, '', '/?lang=en_XA');
});

import { morthenIdentityAura } from '../src/sim/graveyard_shift/morthen_identity';
import { abilityDisplayNameFromSource } from '../src/ui/ability_display_name';
import { resourceDisplayName } from '../src/ui/ability_tooltip_lines';
import { auraDisplayNameForHud, auraDisplayNameFromSource } from '../src/ui/aura_display_name';
import { castDisplayName } from '../src/ui/cast_display_name';
import { localizeErrorText } from '../src/ui/error_text_i18n_core';
import { isPseudoActive } from '../src/ui/i18n';
import { en_XA } from '../src/ui/i18n.resolved.generated/en_XA';

const PSEUDO = en_XA.graveyardShift;

afterAll(() => {
  window.history.replaceState({}, '', '/');
});

describe('Graveyard Shift names under the pseudo-locale', () => {
  it('runs with the pseudo-locale active', () => {
    expect(isPseudoActive()).toBe(true);
  });

  it('keys the identity aura and the kit auras in the buff bar localizer', () => {
    const identity = morthenIdentityAura(1).name;
    expect(PSEUDO.identityAura).not.toBe(identity);
    expect(auraDisplayNameFromSource(identity)).toBe(PSEUDO.identityAura);
    expect(auraDisplayNameForHud(identity, null)).toBe(PSEUDO.identityAura);
    expect(auraDisplayNameForHud("Sexton's Chain", null)).toBe(PSEUDO.abilities.sextonsChain.name);
  });

  it('keys combat-event names and cast-bar ids for the kit', () => {
    expect(abilityDisplayNameFromSource('Raise the Fallen')).toBe(
      PSEUDO.abilities.raiseFallen.name,
    );
    expect(abilityDisplayNameFromSource("Sexton's Chain")).toBe(PSEUDO.abilities.sextonsChain.name);
    expect(castDisplayName('gshift_shadow_pulse')).toBe(PSEUDO.abilities.shadowPulse.name);
  });

  it('keys the Dread refusal and the Dread resource label', () => {
    const deps = { raidLockouts: () => [], formatLockoutDuration: () => '' };
    expect(PSEUDO.errors.notEnoughDread).not.toBe('Not enough Dread!');
    expect(localizeErrorText('Not enough Dread!', deps)).toBe(PSEUDO.errors.notEnoughDread);
    expect(PSEUDO.resource).not.toBe('Dread');
    expect(resourceDisplayName('dread')).toBe(PSEUDO.resource);
  });
});
