// Pure view-core for the per-corpse focus picker (#1142), tested DOM-free in
// Node: corpseHarvestView is a UI_PURE_CORES member, so it imports nothing that
// needs a browser and a Vitest can assert its shape directly.
//
// The subject here is #2509. A component family can be tagged on a corpse
// with no harvest item behind it (gills and horn shipped that way until
// Masterwrought Phase 11m mapped both, as claw and tusk had until #2905), and
// the picker renders a row per tag with no mapping filter, so on a mixed
// corpse a player could check only those and submit. The sim refuses that
// command pre-claim (src/sim/interaction.ts harvestCorpse); this core is the
// client mirror of the SAME predicate, so the dead-end submit is never
// offered. Every case below therefore states what the sim would do with the
// same pick. No shipped family is unmapped any more, so the mixed shapes
// below carry the synthetic never-mapped pair (tests/helpers/unmapped_family.ts)
// in the slots gills and horn used to fill, and the shipped exemplars that
// used to drive them (mudfin_murloc, sethrael_palecoil) are pinned as the
// all-mapped corpses they are today.

import { describe, expect, it } from 'vitest';
import { HARVEST_COMPONENT_ITEMS } from '../src/sim/content/professions';
import { MOBS } from '../src/sim/data';
import { effectiveFocusComponents } from '../src/sim/professions/gathering';
import { corpseHarvestView } from '../src/ui/hud/loot/corpse_harvest_view';
import {
  UNMAPPED_FAMILY,
  UNMAPPED_FAMILY_2,
  withRetaggedTemplates,
} from './helpers/unmapped_family';

const pick = (...tags: string[]) => new Set(tags);

describe('corpseHarvestView: rows and the concentrate flag', () => {
  it('renders one row per tag, in order, with the checked state from the selection', () => {
    const view = corpseHarvestView(['hide', 'fang', UNMAPPED_FAMILY], pick('fang'));
    expect(view.rows).toEqual([
      { tag: 'hide', checked: false, yieldsItem: true },
      { tag: 'fang', checked: true, yieldsItem: true },
      // #2514: the row is still OFFERED (the corpse really does carry the tag)
      // and still checkable, and it carries the flag the painter marks it by.
      // Rows are not filtered: filtering would hide a component the corpse
      // has, and would put the #2509 refusal out of reach of the shipped
      // picker.
      { tag: UNMAPPED_FAMILY, checked: false, yieldsItem: false },
    ]);
    expect(view.concentrated).toBe(true);
    expect(view.harvestDisabled).toBe(false);
  });

  it('de-duplicates repeated tags without reordering them', () => {
    expect(corpseHarvestView(['hide', 'fang', 'hide'], pick()).rows.map((r) => r.tag)).toEqual([
      'hide',
      'fang',
    ]);
  });

  it('disables only on a corpse with no tags at all, not on an empty selection', () => {
    // An empty selection spreads across every tag, which is well defined, so
    // the button stays live. This is the pin that forbids "disable when
    // nothing is checked".
    expect(corpseHarvestView(['hide'], pick()).harvestDisabled).toBe(false);
    expect(corpseHarvestView([], pick()).harvestDisabled).toBe(true);
  });

  it('reports concentrated only for a strict subset, on an ALL-MAPPED corpse', () => {
    expect(corpseHarvestView(['hide', 'fang'], pick()).concentrated).toBe(false);
    expect(corpseHarvestView(['hide', 'fang'], pick('hide')).concentrated).toBe(true);
    expect(corpseHarvestView(['hide', 'fang'], pick('hide', 'fang')).concentrated).toBe(false);
  });

  it('measures concentration against the WIDEST pick the corpse offers, not the box count (#2514)', () => {
    // The fixture above cannot see this: on an all-mapped corpse "strict subset
    // of the boxes" and "beats the widest available pick" are the same set, so
    // it stayed green through the redefinition while proving nothing about it.
    // The murloc shape is the discriminator (the two-tag shape mudfin_murloc
    // shipped with as `gills, hide` until Phase 11m mapped gills; the
    // synthetic family fills that slot). The unmapped family extracts nothing,
    // so hide alone IS the widest pick there is here: a box count would call
    // checking both a spread and checking one a concentrate, and the sim pays
    // the same bonus 1 for both.
    const murloc = [UNMAPPED_FAMILY_2, 'hide'];
    expect(corpseHarvestView(murloc, pick()).concentrated).toBe(false);
    expect(corpseHarvestView(murloc, pick('hide')).concentrated).toBe(false);
    expect(corpseHarvestView(murloc, pick(UNMAPPED_FAMILY_2, 'hide')).concentrated).toBe(false);
    // On the 3-tag mixed shape the choice is real again, and the unmapped box
    // is transparent to it: hide beside the unmapped family concentrates
    // exactly as hide alone does, and naming both mapped families does not.
    const palecoil = ['hide', 'fang', UNMAPPED_FAMILY];
    expect(corpseHarvestView(palecoil, pick()).concentrated).toBe(false);
    expect(corpseHarvestView(palecoil, pick('hide')).concentrated).toBe(true);
    expect(corpseHarvestView(palecoil, pick('hide', UNMAPPED_FAMILY)).concentrated).toBe(true);
    expect(corpseHarvestView(palecoil, pick('hide', 'fang')).concentrated).toBe(false);
    expect(corpseHarvestView(palecoil, pick('hide', 'fang', UNMAPPED_FAMILY)).concentrated).toBe(
      false,
    );
    // A pick the sim refuses is never "concentrated", though its raw bonus is
    // the whole tag count: the field describes the harvest the button would
    // run, and that button is dead.
    expect(corpseHarvestView(palecoil, pick(UNMAPPED_FAMILY)).harvestDisabled).toBe(true);
    expect(corpseHarvestView(palecoil, pick(UNMAPPED_FAMILY)).concentrated).toBe(false);
    // Same for a corpse no pick can harvest.
    expect(corpseHarvestView([UNMAPPED_FAMILY_2, UNMAPPED_FAMILY], pick()).concentrated).toBe(
      false,
    );
    // ...and the shipped murloc today, every tag mapped: checking one of its
    // two boxes IS a concentrate again, because the widest pick reaches both.
    expect(MOBS.mudfin_murloc.componentTags).toEqual(['gills', 'hide']);
    expect(corpseHarvestView(['gills', 'hide'], pick('gills')).concentrated).toBe(true);
    expect(corpseHarvestView(['gills', 'hide'], pick('gills', 'hide')).concentrated).toBe(false);
  });

  it('marks the rows with no item behind them, and only those (#2514)', () => {
    const rows = (tags: string[]) =>
      Object.fromEntries(corpseHarvestView(tags, pick()).rows.map((r) => [r.tag, r.yieldsItem]));
    expect(rows(['hide', 'fang', UNMAPPED_FAMILY])).toEqual({
      hide: true,
      fang: true,
      [UNMAPPED_FAMILY]: false,
    });
    expect(rows([UNMAPPED_FAMILY_2, 'hide'])).toEqual({ [UNMAPPED_FAMILY_2]: false, hide: true });
    expect(rows([UNMAPPED_FAMILY_2, UNMAPPED_FAMILY])).toEqual({
      [UNMAPPED_FAMILY_2]: false,
      [UNMAPPED_FAMILY]: false,
    });
    // Reads the real yield table, both directions, so it cannot be measuring
    // the table against itself: every mapped family marks true (ten since
    // Phase 11m mapped gills and horn) and every never-mapped one marks false.
    for (const mapped of [
      'claw',
      'cloth',
      'fang',
      'gills',
      'hide',
      'horn',
      'meat',
      'silk',
      'tusk',
      'venomSac',
    ]) {
      expect(rows([mapped])[mapped], mapped).toBe(true);
    }
    for (const unmapped of [UNMAPPED_FAMILY, UNMAPPED_FAMILY_2]) {
      expect(rows([unmapped])[unmapped], unmapped).toBe(false);
    }
    // The shipped rows that used to be marked are not any more: mudfin's
    // gills and sethrael's horn both read true off the real table.
    expect(rows(MOBS.mudfin_murloc.componentTags ?? [])).toEqual({ gills: true, hide: true });
    expect(rows(MOBS.sethrael_palecoil.componentTags ?? [])).toEqual({
      hide: true,
      claw: true,
      horn: true,
      venomSac: true,
    });
  });
});

describe('corpseHarvestView: a selection that forfeits every yield (#2509)', () => {
  it('is about families no row maps: none ships since Phase 11m, so the synthetic pair carries the case', () => {
    // Literal on both sides, so the cases below cannot be measuring the table
    // against itself. gills and horn were the tagged-but-unmapped families
    // until they shipped as mudfin_scale and curved_tusk mappings; the
    // shipped unmapped set is EMPTY now, pinned as such with the ten mapped
    // families beside it,
    // and the synthetic pair is unmapped by construction: no row and no
    // shipped carrier (tests/harvest_geography.test.ts pins both from the
    // content side).
    const tagged = new Set(Object.values(MOBS).flatMap((m) => m.componentTags ?? []));
    expect([...tagged].filter((t) => !HARVEST_COMPONENT_ITEMS[t]).sort()).toEqual([]);
    expect(Object.keys(HARVEST_COMPONENT_ITEMS).sort()).toEqual([
      'claw',
      'cloth',
      'fang',
      'gills',
      'hide',
      'horn',
      'meat',
      'silk',
      'tusk',
      'venomSac',
    ]);
    for (const family of [UNMAPPED_FAMILY, UNMAPPED_FAMILY_2]) {
      expect(HARVEST_COMPONENT_ITEMS[family], family).toBeUndefined();
      expect(tagged.has(family), family).toBe(false);
    }
    // ...and the sweep above is a measurement: the same set holds real tags.
    expect(tagged.has('gills')).toBe(true);
    expect(tagged.has('horn')).toBe(true);
  });

  it('disables Harvest when every checked family maps to no item', () => {
    // The three-tag shape sethrael_palecoil shipped with (hide, claw, horn)
    // until Phase 11m mapped horn, with the synthetic family in horn's slot.
    // Checking only that box is the exact command the sim refuses, so the
    // picker must not offer it.
    const view = corpseHarvestView(['hide', 'claw', UNMAPPED_FAMILY], pick(UNMAPPED_FAMILY));
    expect(view.forfeitsEveryYield).toBe(true);
    expect(view.harvestDisabled).toBe(true);
    // Rows are NOT filtered: the unmapped row is still shown, because hiding
    // it would change what "check every box" submits and so would move the
    // sim's concentration bonus on a mixed corpse.
    expect(view.rows.map((r) => r.tag)).toEqual(['hide', 'claw', UNMAPPED_FAMILY]);
  });

  it('stays live as soon as one checked family maps to something', () => {
    const mixed = corpseHarvestView(
      ['hide', 'claw', UNMAPPED_FAMILY],
      pick(UNMAPPED_FAMILY, 'hide'),
    );
    expect(mixed.forfeitsEveryYield).toBe(false);
    expect(mixed.harvestDisabled).toBe(false);
  });

  it('covers the two-tag murloc shape, where a single checkbox is the whole refusal', () => {
    const shape = [UNMAPPED_FAMILY_2, 'hide'];
    expect(corpseHarvestView(shape, pick(UNMAPPED_FAMILY_2)).harvestDisabled).toBe(true);
    expect(corpseHarvestView(shape, pick('hide')).harvestDisabled).toBe(false);
    // The murloc that shipped in that shape carries gills beside hide today
    // and gills pays (Phase 11m), so the single checkbox is a live concentrate
    // now, not a refusal: the picker offers what the command accepts.
    expect(MOBS.mudfin_murloc.componentTags).toEqual(['gills', 'hide']);
    expect(corpseHarvestView(['gills', 'hide'], pick('gills')).harvestDisabled).toBe(false);
    expect(corpseHarvestView(['gills', 'hide'], pick('gills')).forfeitsEveryYield).toBe(false);
  });

  it('covers the worst shape that shipped, where one of three boxes is a trap', () => {
    // sethrael_palecoil shipped as (hide, claw, horn) with horn the one trap
    // (claw was mapped at #2905); the synthetic family takes horn's slot.
    // hide and claw both keep the button live.
    const tags = ['hide', 'claw', UNMAPPED_FAMILY];
    expect(corpseHarvestView(tags, pick('claw')).harvestDisabled).toBe(false);
    expect(corpseHarvestView(tags, pick(UNMAPPED_FAMILY)).harvestDisabled).toBe(true);
    expect(corpseHarvestView(tags, pick('claw', UNMAPPED_FAMILY)).harvestDisabled).toBe(false);
    expect(corpseHarvestView(tags, pick('hide', 'claw', UNMAPPED_FAMILY)).harvestDisabled).toBe(
      false,
    );
    // The serpent itself is four tags today, every one of them mapped, so no
    // single box on it is a trap any more: horn alone is a live pick.
    expect(MOBS.sethrael_palecoil.componentTags).toEqual(['hide', 'claw', 'horn', 'venomSac']);
    for (const tag of ['hide', 'claw', 'horn', 'venomSac']) {
      const view = corpseHarvestView(['hide', 'claw', 'horn', 'venomSac'], pick(tag));
      expect(view.harvestDisabled, tag).toBe(false);
      expect(view.forfeitsEveryYield, tag).toBe(false);
    }
  });

  it('disables an all-unmapped corpse on the OTHER term, exactly as the sim does (#2513)', () => {
    // The two terms of harvestDisabled, pinned apart. An all-unmapped corpse
    // forfeits nothing whatever the player checks, because no pick could have
    // paid out, so the #2509 mirror (forfeitsEveryYield) stays FALSE here and
    // must: a mirror written as "no checked family maps" without its third
    // term would make this corpse report a forfeit that is not happening, and
    // would move the concentration bonus on a mixed corpse. What disables the
    // button is isHarvestableCorpse (#2513), which the sim's own command gate
    // reads first. A fixture where both terms fired would let either one rot.
    // The synthetic pair is the all-unmapped corpse: gills and horn were,
    // until Phase 11m mapped both (fen_troll's claw and tusk went at #2905).
    const ALL_UNMAPPED = [UNMAPPED_FAMILY_2, UNMAPPED_FAMILY];
    const picks = [
      pick(),
      pick(UNMAPPED_FAMILY_2),
      pick(UNMAPPED_FAMILY),
      pick(UNMAPPED_FAMILY_2, UNMAPPED_FAMILY),
    ];
    for (const selected of picks) {
      const view = corpseHarvestView(ALL_UNMAPPED, selected);
      expect(view.forfeitsEveryYield, JSON.stringify([...selected])).toBe(false);
      expect(view.harvestDisabled, JSON.stringify([...selected])).toBe(true);
    }
    // An EMPTY tag list produces the same MODEL, which is why no new warning
    // copy is owed here. Note it is only the model: the painter early-returns on
    // `rows.length === 0`, so an empty tag list never rendered a section at all,
    // and an all-unmapped corpse has rows. That is what `corpseHarvestable`
    // exists for, and the painter refuses the section on it
    // (tests/corpse_harvest_window.test.ts), so neither case draws a dead button.
    const empty = corpseHarvestView([], pick());
    expect(empty.harvestDisabled).toBe(true);
    expect(empty.forfeitsEveryYield).toBe(false);
    expect(empty.corpseHarvestable).toBe(false);
    // The new field is the discriminator the painter reads, so it is asserted
    // separately from harvestDisabled: on a MIXED corpse it is true even when the
    // pick disables the button, which is exactly the pair that must not coincide.
    const forfeited = corpseHarvestView(['hide', UNMAPPED_FAMILY], pick(UNMAPPED_FAMILY));
    expect(forfeited.corpseHarvestable).toBe(true);
    expect(forfeited.harvestDisabled).toBe(true);
    for (const selected of picks) {
      expect(corpseHarvestView(ALL_UNMAPPED, selected).corpseHarvestable).toBe(false);
    }
    // ...and the discriminating contrast: one mapped family among the same
    // unmapped ones re-enables the button, so the term reads the yield table
    // rather than the tag count.
    expect(
      corpseHarvestView([UNMAPPED_FAMILY_2, 'hide', UNMAPPED_FAMILY], pick()).harvestDisabled,
    ).toBe(false);
  });

  it('never fires on a full cover, because a full cover spreads', () => {
    // The sim treats a pick covering every tag as the spread, so it always
    // reaches the mapped families. Checking every box can only forfeit
    // everything on a corpse that had nothing to give, which the case above
    // already excludes.
    for (const tags of Object.values(MOBS)
      .map((m) => m.componentTags)
      .filter((t): t is string[] => !!t?.length)) {
      const view = corpseHarvestView(tags, new Set(tags));
      expect(view.forfeitsEveryYield, tags.join(',')).toBe(false);
    }
  });

  it('agrees with the sim on every subset of every shipped corpse', () => {
    // The mirror stated as the property it has to hold rather than as a list
    // of hand-picked rows: for every tagged template and every subset of its
    // tags, the picker disables exactly when the sim's own gate would refuse.
    // The oracle deliberately does NOT call forfeitsEveryMappedYield or
    // isHarvestableCorpse, which the view itself calls: that would be the
    // predicate compared against itself. It DOES call the real
    // effectiveFocusComponents, and that half is knowingly self-referential (the
    // view reaches the same function through forfeitsEveryMappedYield), so a
    // moved spread threshold shifts both sides together and this sweep would
    // stay green on the equality alone. The three literal counts below are what
    // catch it: a threshold change drives byPickGate off 11.
    //
    // The oracle has BOTH of the sim's gates, in the order harvestCorpse runs
    // them (#2513 first, #2509 second), and counts them separately so a change
    // that moved every refusal onto one gate could not pass the total.
    //
    // No shipped template is fully unmapped any more (claw and tusk since
    // #2905) and none is MIXED any more (gills and horn since Phase 11m), so
    // three real, otherwise-untagged templates are retagged for the duration
    // of the sweep, restored in a finally: warlock_imp (this file's plain "no
    // tags" fixture elsewhere) all-unmapped, to keep the corpse-level gate
    // (#2513) visited, and warlock_voidwalker and tunnel_rat in the two mixed
    // widths shipped content used to carry (sethrael_palecoil's three-tag
    // shape and the murlocs' two-tag one), to keep the pick-level gate
    // (#2509) visited.
    const sweep = () => {
      let disabledSeen = 0;
      let byCorpseGate = 0;
      let byPickGate = 0;
      for (const m of Object.values(MOBS)) {
        const tags = m.componentTags;
        if (!tags?.length) continue;
        const mappedOnCorpse = tags.some((t) => HARVEST_COMPONENT_ITEMS[t]);
        for (let mask = 0; mask < 1 << tags.length; mask++) {
          const selected = tags.filter((_, i) => mask & (1 << i));
          const effective = effectiveFocusComponents(tags, selected);
          // Gate 1 (#2513): the corpse itself has no mapped family.
          const corpseGate = !mappedOnCorpse;
          // Gate 2 (#2509): the pick throws away everything the corpse had.
          const pickGate = !corpseGate && !effective.some((t) => HARVEST_COMPONENT_ITEMS[t]);
          const simWouldRefuse = corpseGate || pickGate;
          const view = corpseHarvestView(tags, new Set(selected));
          expect(view.harvestDisabled, `${m.id} ${JSON.stringify(selected)}`).toBe(simWouldRefuse);
          if (simWouldRefuse) disabledSeen++;
          if (corpseGate) byCorpseGate++;
          if (pickGate) byPickGate++;
        }
      }
      return { disabledSeen, byCorpseGate, byPickGate };
    };
    // The shipped reality first: every tagged template is all-mapped, so the
    // mirror agrees with the sim on every subset by never disabling. Pinned
    // as the zeros they are (tagged 54, untagged 181, mixed 0 after the 11m
    // spread and mapping), not left implicit in the retagged run below.
    expect(sweep()).toEqual({ disabledSeen: 0, byCorpseGate: 0, byPickGate: 0 });
    // The sweep has to actually VISIT both disabled arms, or it passes
    // all-false with the mirror never exercised at all. The retagged
    // warlock_imp contributes its four subsets to byCorpseGate; on each mixed
    // width exactly one subset (the unmapped family alone) trips the pick
    // gate, since every other subset either names a mapped family or spreads.
    // Before 11m the shipped mixed templates gave byPickGate 6 (the four
    // `gills, hide` swamp dwellers plus sethrael_palecoil and
    // wildheart_hexcaller, one subset each); the two fixtures give 2.
    const retagged = withRetaggedTemplates(
      {
        warlock_imp: [UNMAPPED_FAMILY_2, UNMAPPED_FAMILY],
        warlock_voidwalker: ['hide', 'claw', UNMAPPED_FAMILY],
        tunnel_rat: [UNMAPPED_FAMILY_2, 'hide'],
      },
      sweep,
    );
    expect(retagged).toEqual({ disabledSeen: 6, byCorpseGate: 4, byPickGate: 2 });
  });
});
