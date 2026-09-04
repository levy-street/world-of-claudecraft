// The sim reverse-map name-collision guard (Phase 18).
//
// src/ui/sim_i18n.ts localizes the English item/mob/ability/zone names the sim
// splices into its text by mapping the name BACK to an entity id. An English
// display name is not unique, so every such map has a collision problem, and the
// bare `map.set(name, id)` loops these maps used to be resolved it by catalog
// spread order: last write wins, silently. Three ability lines shipped
// mistranslated that way, each losing to a record no player can reach.
//
// This suite holds the recorded collision set (`NAME_COLLISIONS`) against what the
// entity dictionary actually renders. A collision is acceptable only two ways:
// every colliding id renders the SAME string in every locale (so which one wins
// cannot matter), or exactly one of them is reachable and the map resolves to it.
// Anything else is a player reading the wrong name, and lands here as a review
// item rather than as a silent map entry.
import { describe, expect, it } from 'vitest';
import { ABILITIES, CLASSES, MOBS } from '../src/sim/data';
import { tEntity } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage, supportedLanguages } from '../src/ui/i18n';
import { localizeSimText, NAME_COLLISIONS } from '../src/ui/sim_i18n';

// The LITERAL record, not a re-derivation: a list agreeing with itself is exactly
// the failure this pin exists to catch. Every row's `resolved` is the assertion
// that the preference rule (and, for the mobs, the sorted-id tiebreak) still picks
// what it picked when this was reviewed.
const EXPECTED: readonly {
  kind: string;
  name: string;
  ids: readonly string[];
  resolved: string;
}[] = [
  {
    kind: 'mob',
    name: 'Raised Bonewalker',
    ids: ['raised_bonewalker', 'reliquary_bonewalker'],
    resolved: 'raised_bonewalker',
  },
  {
    kind: 'mob',
    name: 'Rime Elemental',
    ids: ['rift_rime_elemental', 'rime_elemental'],
    resolved: 'rift_rime_elemental',
  },
  {
    kind: 'ability',
    name: 'Sacred Goad',
    ids: ['holy_taunt', 'sacred_challenge'],
    resolved: 'sacred_challenge',
  },
  {
    kind: 'ability',
    name: 'Aether Surge',
    ids: ['arcane_power', 'arcane_surge'],
    resolved: 'arcane_surge',
  },
  { kind: 'ability', name: 'Patch Up', ids: ['mend_pet', 'revive_pet'], resolved: 'revive_pet' },
];

// The residue: a collision no rule at this seam can resolve, because BOTH records
// are live content a player meets and the sim line carrying the name ("Raised
// Bonewalker dies.") carries no id to disambiguate with. Listing one here is a
// REVIEWED admission, not a waiver: the fix is upstream (rename one record in
// English, or reconcile the two renderings in the locale overlays), and both are
// content/translation work outside this module. A new entry must argue its way in.
const UNRESOLVABLE: readonly { name: string; why: string }[] = [
  {
    name: 'Raised Bonewalker',
    why: "raised_bonewalker is Velkhar's summoned add, reliquary_bonewalker the restless_graves Heroic-affix add; both live, and 8 locales translate them apart.",
  },
  {
    name: 'Rime Elemental',
    why: 'rime_elemental is the Frostveil mob, rift_rime_elemental the rift elite; both live, and 5 locales translate them apart.',
  },
];

describe('reverse-map name collisions are resolved on purpose', () => {
  it('records exactly the reviewed collision set', () => {
    expect(
      NAME_COLLISIONS.map((c) => ({
        kind: c.kind,
        name: c.name,
        ids: [...c.ids],
        resolved: c.resolved,
      })),
    ).toEqual(EXPECTED.map((c) => ({ ...c, ids: [...c.ids] })));
  });

  it('no ITEM name collides once the Heroic copies collapse', () => {
    // itemNameToId keys on `heroicOf ?? id`, so the 64 base/Heroic name pairs
    // resolve to one id and are not collisions. If that collapse ever breaks, the
    // pairs arrive here in a flood rather than as a subtle mistranslation.
    expect(NAME_COLLISIONS.filter((c) => c.kind === 'item')).toEqual([]);
  });

  it('every colliding ABILITY resolves to the one a player can reach', () => {
    // The rule that fixed the three shipped mistranslations, asserted on its own
    // terms: of each colliding pair exactly one id is in a class kit and not
    // hidden, and that is the one the map returns.
    const kit = new Set(Object.values(CLASSES).flatMap((c) => c.abilities));
    const reachable = (id: string) => kit.has(id) && !ABILITIES[id]?.hiddenFromPlayer;
    const abilities = NAME_COLLISIONS.filter((c) => c.kind === 'ability');
    expect(abilities.length, 'no ability collisions: the arm is vacuous').toBeGreaterThanOrEqual(3);
    for (const c of abilities) {
      const live = c.ids.filter(reachable);
      expect(live, `${c.name} must have exactly one reachable id`).toHaveLength(1);
      expect(c.resolved, `${c.name} must resolve to its reachable id`).toBe(live[0]);
    }
  });

  it('every colliding MOB id is real content, so the residue is honest', () => {
    for (const c of NAME_COLLISIONS.filter((c) => c.kind === 'mob')) {
      for (const id of c.ids) expect(MOBS[id], `${id} is not a live mob`).toBeTruthy();
    }
  });

  it('a collision either renders identically everywhere or is a reviewed residue', async () => {
    // The decisive arm. Walks every supported locale and asks whether the choice
    // the map made can be observed by a player. Where it can, the name must be on
    // the reviewed UNRESOLVABLE list with its reason.
    const observable: string[] = [];
    let comparisons = 0;
    for (const c of NAME_COLLISIONS) {
      for (const lang of supportedLanguages) {
        await ensureLocaleLoaded(lang);
        setLanguage(lang);
        const rendered = c.ids.map((id) =>
          tEntity({ kind: c.kind as 'mob' | 'ability' | 'item' | 'zone', id, field: 'name' }),
        );
        comparisons++;
        if (new Set(rendered).size > 1) observable.push(`${c.kind} ${c.name} (${lang})`);
      }
    }
    setLanguage('en');
    expect(comparisons, 'the locale walk is vacuous').toBeGreaterThan(80);
    const names = [
      ...new Set(observable.map((o) => o.split(' (')[0].split(' ').slice(1).join(' '))),
    ];
    expect(names.sort(), 'a collision players can see must be a reviewed residue').toEqual(
      [
        ...UNRESOLVABLE.map((u) => u.name),
        ...EXPECTED.filter((e) => e.kind === 'ability').map((e) => e.name),
      ].sort(),
    );
    // The ability half is observable only because the two records genuinely differ;
    // what matters there is that the RIGHT one wins, which the next test proves.
    for (const u of UNRESOLVABLE) {
      expect(u.why.length, `${u.name} needs a reason`).toBeGreaterThan(40);
      expect(NAME_COLLISIONS.some((c) => c.name === u.name)).toBe(true);
    }
  });

  it('the learned-ability line localizes to the reachable ability, end to end', async () => {
    // The player-visible proof, through the real exported entry point: before the
    // fix these three read as the retired record's name.
    const cases: readonly [line: string, id: string, loser: string][] = [
      ['You have learned a new ability: Aether Surge.', 'arcane_surge', 'arcane_power'],
      ['You have learned a new ability: Patch Up.', 'revive_pet', 'mend_pet'],
      ['You have learned a new ability: Sacred Goad.', 'sacred_challenge', 'holy_taunt'],
    ];
    let distinguishing = 0;
    for (const lang of supportedLanguages) {
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      for (const [line, id, loser] of cases) {
        const winnerName = tEntity({ kind: 'ability', id, field: 'name' });
        const loserName = tEntity({ kind: 'ability', id: loser, field: 'name' });
        // Where the pair happens to share a rendering (de_DE spells both hunter
        // ids 'Zusammenflicken') the line cannot tell the two apart, so it
        // evidences nothing either way. Only count the locales that can.
        if (winnerName === loserName) continue;
        distinguishing++;
        const out = localizeSimText(line);
        expect(out, `${lang} ${line}`).toContain(winnerName);
        expect(out, `${lang} must not name ${loser}`).not.toContain(loserName);
      }
    }
    setLanguage('en');
    // Non-vacuity: 14 + 15 + 9 locales distinguish the three pairs today.
    expect(distinguishing, 'no locale distinguished any pair').toBeGreaterThan(30);
  });
});
