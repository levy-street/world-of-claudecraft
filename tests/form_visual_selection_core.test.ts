import { describe, expect, it } from 'vitest';
import {
  activeCharacterFormVisual,
  CHARACTER_FORM_READY,
  characterFormMaskForAura,
  characterFormReadyMask,
  characterFormShadowPlan,
  characterFormVisibility,
  requestedCharacterForm,
  resolvedCharacterForm,
} from '../src/render/characters/form_visual_selection_core';

function maskFor(auras: ReadonlyArray<{ kind: string; id?: string }>): number {
  return auras.reduce((mask, aura) => mask | characterFormMaskForAura(aura), 0);
}

describe('character form visual selection', () => {
  it('keeps every asset readiness bit independent', () => {
    expect(CHARACTER_FORM_READY).toEqual({
      sheep: 1,
      bear: 2,
      cat: 4,
      travel: 8,
      metamorph: 16,
    });
    expect(resolvedCharacterForm('metamorph', CHARACTER_FORM_READY.travel)).toBe('base');
    expect(resolvedCharacterForm('travel', CHARACTER_FORM_READY.metamorph)).toBe('base');
  });

  it('maps both replicated Warlock form markers to the dedicated Metamorphosis visual', () => {
    for (const kind of ['form_metamorph', 'form_lich']) {
      const requested = requestedCharacterForm(maskFor([{ kind }]));
      expect(requested).toBe('metamorph');
      expect(resolvedCharacterForm(requested, CHARACTER_FORM_READY.metamorph)).toBe('metamorph');
    }
  });

  it('keeps the base visual visible while a requested form build is unavailable', () => {
    const requested = requestedCharacterForm(maskFor([{ kind: 'form_metamorph' }]));
    expect(resolvedCharacterForm(requested, 0)).toBe('base');
  });

  it('gives polymorph precedence and never falls through to a lower form', () => {
    const requested = requestedCharacterForm(
      maskFor([{ kind: 'form_metamorph' }, { kind: 'form_bear' }, { kind: 'polymorph' }]),
    );
    expect(requested).toBe('sheep');
    expect(resolvedCharacterForm(requested, CHARACTER_FORM_READY.metamorph)).toBe('base');
    expect(
      resolvedCharacterForm(requested, CHARACTER_FORM_READY.sheep | CHARACTER_FORM_READY.metamorph),
    ).toBe('sheep');
  });

  it('preserves the established form ordering', () => {
    expect(
      requestedCharacterForm(
        maskFor([
          { kind: 'form_metamorph' },
          { kind: 'form_travel' },
          { kind: 'form_cat' },
          { kind: 'form_bear' },
        ]),
      ),
    ).toBe('bear');
    expect(
      requestedCharacterForm(
        maskFor([
          { kind: 'form_metamorph' },
          { kind: 'form_travel' },
          { id: 'ghost_wolf', kind: 'buff_speed' },
        ]),
      ),
    ).toBe('cat');
    expect(
      requestedCharacterForm(maskFor([{ kind: 'form_metamorph' }, { kind: 'form_fireball' }])),
    ).toBe('fireball');
    expect(
      requestedCharacterForm(
        maskFor([{ kind: 'form_travel' }, { kind: 'form_fireball' }, { kind: 'form_metamorph' }]),
      ),
    ).toBe('travel');
  });

  it.each([
    ['sheep', { kind: 'polymorph' }, CHARACTER_FORM_READY.sheep],
    ['bear', { kind: 'form_bear' }, CHARACTER_FORM_READY.bear],
    ['cat', { kind: 'form_cat' }, CHARACTER_FORM_READY.cat],
    ['travel', { kind: 'form_travel' }, CHARACTER_FORM_READY.travel],
    ['metamorph', { kind: 'form_lich' }, CHARACTER_FORM_READY.metamorph],
  ] as const)('resolves the %s branch only when its visual is ready', (form, aura, ready) => {
    const requested = requestedCharacterForm(maskFor([aura]));
    expect(requested).toBe(form);
    expect(resolvedCharacterForm(requested, 0)).toBe('base');
    expect(resolvedCharacterForm(requested, ready)).toBe(form);
  });

  it('selects fireball independently because its procedural visual has no asset retry', () => {
    const requested = requestedCharacterForm(maskFor([{ kind: 'form_fireball' }]));
    expect(requested).toBe('fireball');
    expect(resolvedCharacterForm(requested, 0)).toBe('fireball');
    expect(characterFormVisibility('fireball')).toEqual({
      base: false,
      sheep: false,
      bear: false,
      cat: false,
      travel: false,
      metamorph: false,
    });
  });

  it('keeps the base visual through a failed Lich build, then swaps after a later retry', () => {
    const base = { id: 'base' };
    const lich = { id: 'lich' };
    const requested = requestedCharacterForm(maskFor([{ kind: 'form_lich' }]));
    let metamorph: typeof lich | null = null;

    let ready = characterFormReadyMask(null, null, null, null, metamorph);
    let resolved = resolvedCharacterForm(requested, ready);
    expect(activeCharacterFormVisual(resolved, base, null, null, null, null, metamorph)).toBe(base);

    metamorph = lich;
    ready = characterFormReadyMask(null, null, null, null, metamorph);
    resolved = resolvedCharacterForm(requested, ready);
    expect(resolved).toBe('metamorph');
    expect(activeCharacterFormVisual(resolved, base, null, null, null, null, metamorph)).toBe(lich);

    resolved = resolvedCharacterForm(requestedCharacterForm(0), ready);
    expect(activeCharacterFormVisual(resolved, base, null, null, null, null, metamorph)).toBe(base);
  });

  it.each([
    ['base', 'base'],
    ['sheep', 'sheep'],
    ['bear', 'bear'],
    ['cat', 'cat'],
    ['travel', 'travel'],
    ['metamorph', 'metamorph'],
  ] as const)('makes only the %s root visible', (form, visibleKey) => {
    const visibility = characterFormVisibility(form);
    expect(visibility).toEqual({
      base: visibleKey === 'base',
      sheep: visibleKey === 'sheep',
      bear: visibleKey === 'bear',
      cat: visibleKey === 'cat',
      travel: visibleKey === 'travel',
      metamorph: visibleKey === 'metamorph',
    });
    expect(Object.values(visibility).filter(Boolean)).toHaveLength(1);
  });

  it('plans near, far-proxy, and out-of-band Metamorphosis shadows', () => {
    expect(
      characterFormShadowPlan('metamorph', {
        isSelf: false,
        nearShadow: true,
        inProxyBand: true,
        staticFar: false,
      }),
    ).toEqual({ activeArticulated: true, baseProxy: false, formProxy: false });
    expect(
      characterFormShadowPlan('metamorph', {
        isSelf: false,
        nearShadow: false,
        inProxyBand: true,
        staticFar: false,
      }),
    ).toEqual({ activeArticulated: true, baseProxy: false, formProxy: false });
    expect(
      characterFormShadowPlan('metamorph', {
        isSelf: false,
        nearShadow: false,
        inProxyBand: true,
        staticFar: true,
      }),
    ).toEqual({ activeArticulated: true, baseProxy: false, formProxy: true });
    expect(
      characterFormShadowPlan('metamorph', {
        isSelf: false,
        nearShadow: false,
        inProxyBand: false,
        staticFar: true,
      }),
    ).toEqual({ activeArticulated: false, baseProxy: false, formProxy: false });
    expect(
      characterFormShadowPlan('base', {
        isSelf: false,
        nearShadow: false,
        inProxyBand: true,
        staticFar: true,
      }),
    ).toEqual({ activeArticulated: false, baseProxy: true, formProxy: false });
    expect(
      characterFormShadowPlan('metamorph', {
        isSelf: true,
        nearShadow: false,
        inProxyBand: false,
        staticFar: false,
      }),
    ).toEqual({ activeArticulated: true, baseProxy: false, formProxy: false });
    expect(
      characterFormShadowPlan('fireball', {
        isSelf: true,
        nearShadow: true,
        inProxyBand: true,
        staticFar: false,
      }),
    ).toEqual({ activeArticulated: false, baseProxy: false, formProxy: false });
  });

  it('returns cleanly to the base visual across rapid toggles without mutating aura input', () => {
    const metamorphAura = Object.freeze({ kind: 'form_metamorph' });
    const activeMask = maskFor([metamorphAura]);
    const ready = CHARACTER_FORM_READY.metamorph;

    const sequence = [activeMask, 0, activeMask].map((mask) => {
      const resolved = resolvedCharacterForm(requestedCharacterForm(mask), ready);
      return { resolved, visibility: characterFormVisibility(resolved) };
    });
    expect(sequence).toEqual([
      {
        resolved: 'metamorph',
        visibility: {
          base: false,
          sheep: false,
          bear: false,
          cat: false,
          travel: false,
          metamorph: true,
        },
      },
      {
        resolved: 'base',
        visibility: {
          base: true,
          sheep: false,
          bear: false,
          cat: false,
          travel: false,
          metamorph: false,
        },
      },
      {
        resolved: 'metamorph',
        visibility: {
          base: false,
          sheep: false,
          bear: false,
          cat: false,
          travel: false,
          metamorph: true,
        },
      },
    ]);
    for (const step of sequence) {
      expect(Object.values(step.visibility).filter(Boolean)).toHaveLength(1);
    }
    expect(metamorphAura).toEqual({ kind: 'form_metamorph' });
  });
});
