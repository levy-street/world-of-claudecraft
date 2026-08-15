// Cheap Trick (rogue row 11) retires Gut Punch's stealth requirement, and the
// tooltip's requirement LINE is already talent-aware (PR #3325). The description
// prose must follow: a talented tooltip should not still read "Must be stealthed."
//
// The fix is a UI-layer description variant (entities.abilities.cheap_shot
// .descriptionNoStealth), selected by the tooltip when the resolved ability has
// dropped the requirement. It lives ONLY in the UI i18n catalog, so the sim
// ability def, and the mob-portrait renderer fingerprint it feeds through
// src/sim/data.ts, stay untouched (no portrait re-bless), and a normal rogue's
// description is unchanged.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { computeTalentModifiers } from '../src/sim/content/talents';
import { ABILITIES } from '../src/sim/data';
import { abilityDescriptionField, abilityDisplayDescription } from '../src/ui/ability_description';
import { tEntity, tEntityOptional } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, isPendingTranslation, setLanguage } from '../src/ui/i18n';

const VARIANT_KEY = 'entities.abilities.cheap_shot.descriptionNoStealth';

// A locale that ships the variant, and one standing in for a locale that has not
// translated it yet.
const FILLED_LOCALE = 'ja_JP';
const PENDING_LOCALE = 'de_DE';

// The pending arm cannot ride real catalog state. A release fill drives the
// registry to zero pending BY DESIGN, so any locale pinned here as "not yet
// translated" flips the moment that fill lands (de_DE did, in the v0.38.0 fill),
// and the fallback this suite exists for would then go unproven for good. Pin the
// pending set itself instead: PENDING_SETS is built once, at i18n module load,
// from this generated module, so a synthetic entry drives isPendingTranslation
// (and through it tEntityOptional) down the exact production path. Only
// PENDING_LOCALE carries the variant key, so the FILLED_LOCALE arm still reads
// real catalog state.
vi.mock('../src/ui/i18n.resolved.generated/pending', () => ({
  pending: { de_DE: ['entities.abilities.cheap_shot.descriptionNoStealth'] } as Record<
    string,
    readonly string[]
  >,
}));

/** Gut Punch as the real talent bake produces it: the row-11 option is selected
 *  through the live allocation, never a hand-built modifier bag. */
function knownCheapShot(rowOption: string) {
  const mods = computeTalentModifiers('rogue', { spec: null, rows: { 11: rowOption } }, 20);
  const known = abilitiesKnownAt('rogue', 20, mods).find((k) => k.def.id === 'cheap_shot');
  if (!known) throw new Error('cheap_shot missing from the resolved rogue kit at level 20');
  return known;
}

beforeAll(async () => {
  await Promise.all([
    ensureLocaleLoaded('en'),
    ensureLocaleLoaded(FILLED_LOCALE),
    ensureLocaleLoaded(PENDING_LOCALE),
  ]);
  setLanguage('en');
});

afterEach(() => {
  setLanguage('en');
});

describe('Gut Punch stealth-free description variant', () => {
  it('the base description still states the stealth gate for a normal rogue', () => {
    expect(tEntity({ kind: 'ability', id: 'cheap_shot', field: 'description' })).toMatch(
      /stealth/i,
    );
  });

  it('the variant drops the stealth clause but keeps the rest of the prose', () => {
    const variant = tEntityOptional({
      kind: 'ability',
      id: 'cheap_shot',
      field: 'descriptionNoStealth',
    });
    expect(variant).not.toBeNull();
    expect(variant).not.toMatch(/stealth/i);
    // Same prose otherwise: the stun and the combo-point award both survive.
    expect(variant).toMatch(/4 sec/);
    expect(variant).toContain('2 combo points');
  });

  it('leaves the sim content description intact, so the portrait fingerprint never moves', () => {
    // The clause is trimmed only at the UI layer. The sim ability def keeps "Must
    // be stealthed.", and that string is what src/sim/data.ts bundles into the mob
    // portrait renderer fingerprint, so this fix requires no portrait re-bless.
    expect(ABILITIES.cheap_shot.description).toMatch(/stealth/i);
  });
});

describe('abilityDescriptionField: which field the resolved ability reads', () => {
  it('picks the variant only when a talent has cleared a real stealth gate', () => {
    expect(abilityDescriptionField(knownCheapShot('rog_r11_cheap_trick'))).toBe(
      'descriptionNoStealth',
    );
    expect(abilityDescriptionField(knownCheapShot('rog_r11_foul_play'))).toBe('description');
  });

  it('leaves an ability that never demanded stealth on the base description', () => {
    // Both halves of the condition matter: a resolve carrying the flag against a
    // def with no stealth gate has no variant to prefer.
    const sinisterStrike = knownCheapShot('rog_r11_cheap_trick');
    const noGate = {
      ...sinisterStrike,
      def: { ...sinisterStrike.def, requiresStealth: false },
    };
    expect(abilityDescriptionField(noGate)).toBe('description');
  });
});

// The finding this suite exists for: the dense locale tables English-FILL a key a
// locale has not translated, so a plain bundle read would hand back English. An
// optional VARIANT must decline that fill, because its caller has a better answer
// (the locale's own base description) than one English sentence mid-tooltip.
describe('an untranslated locale falls back to its OWN prose, never to English', () => {
  const talented = knownCheapShot('rog_r11_cheap_trick');

  it('a locale that ships the variant renders it, in its own language', () => {
    setLanguage(FILLED_LOCALE);
    expect(isPendingTranslation(VARIANT_KEY)).toBe(false);
    const variant = tEntityOptional({
      kind: 'ability',
      id: 'cheap_shot',
      field: 'descriptionNoStealth',
      values: { damage: '100' },
    });
    expect(variant).not.toBeNull();
    // Japanese prose, with the stealth sentence gone and the rest intact.
    expect(variant).not.toContain('ステルス');
    expect(variant).toContain('コンボポイント');
    expect(abilityDisplayDescription(talented, '100')).toBe(variant);
  });

  it('a pending locale resolves the variant to null rather than the English fill', () => {
    setLanguage(PENDING_LOCALE);
    expect(isPendingTranslation(VARIANT_KEY)).toBe(true);
    expect(
      tEntityOptional({ kind: 'ability', id: 'cheap_shot', field: 'descriptionNoStealth' }),
    ).toBeNull();
  });

  it('so the pending locale reads its own base description, in its own language', () => {
    setLanguage(PENDING_LOCALE);
    const rendered = abilityDisplayDescription(talented, '100');
    // German, not the English fill the dense table carries for the variant.
    expect(rendered).toContain('Combopunkte');
    expect(rendered).not.toContain('combo points');
    expect(rendered).toBe(
      tEntity({
        kind: 'ability',
        id: 'cheap_shot',
        field: 'description',
        values: { damage: '100' },
      }),
    );
  });
});
