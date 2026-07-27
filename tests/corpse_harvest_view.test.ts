// Pure view-core for the per-corpse focus picker (#1142), tested DOM-free in
// Node: corpseHarvestView is a UI_PURE_CORES member, so it imports nothing that
// needs a browser and a Vitest can assert its shape directly.
//
// The subject here is #2509. Four component families are tagged on shipped
// corpses but have no harvest item behind them yet (claw, tusk, gills, horn),
// and the picker renders a row per tag with no mapping filter, so on a mixed
// corpse a player could check only those and submit. The sim refuses that
// command pre-claim (src/sim/interaction.ts harvestCorpse); this core is the
// client mirror of the SAME predicate, so the dead-end submit is never offered.
// Every case below therefore states what the sim would do with the same pick.

import { describe, expect, it } from 'vitest';
import { HARVEST_COMPONENT_ITEMS } from '../src/sim/content/professions';
import { MOBS } from '../src/sim/data';
import { effectiveFocusComponents } from '../src/sim/professions/gathering';
import { corpseHarvestView } from '../src/ui/hud/loot/corpse_harvest_view';

const pick = (...tags: string[]) => new Set(tags);

describe('corpseHarvestView: rows and the concentrate flag', () => {
  it('renders one row per tag, in order, with the checked state from the selection', () => {
    const view = corpseHarvestView(['hide', 'fang', 'claw'], pick('fang'));
    expect(view.rows).toEqual([
      { tag: 'hide', checked: false },
      { tag: 'fang', checked: true },
      { tag: 'claw', checked: false },
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

  it('reports concentrated only for a strict subset', () => {
    expect(corpseHarvestView(['hide', 'fang'], pick()).concentrated).toBe(false);
    expect(corpseHarvestView(['hide', 'fang'], pick('hide')).concentrated).toBe(true);
    expect(corpseHarvestView(['hide', 'fang'], pick('hide', 'fang')).concentrated).toBe(false);
  });
});

describe('corpseHarvestView: a selection that forfeits every yield (#2509)', () => {
  it('is about families the content really leaves unmapped', () => {
    // Literal on both sides, so the cases below cannot be measuring the table
    // against itself: claw/tusk/gills/horn are tagged on corpses and map to
    // nothing, and the six mapped families are the ones that do.
    const tagged = new Set(Object.values(MOBS).flatMap((m) => m.componentTags ?? []));
    expect([...tagged].filter((t) => !HARVEST_COMPONENT_ITEMS[t]).sort()).toEqual([
      'claw',
      'gills',
      'horn',
      'tusk',
    ]);
  });

  it('disables Harvest when every checked family maps to no item', () => {
    // old_greyjaw's real tag list. Checking only Claw is the exact command the
    // sim refuses, so the picker must not offer it.
    const view = corpseHarvestView(['hide', 'fang', 'claw'], pick('claw'));
    expect(view.forfeitsEveryYield).toBe(true);
    expect(view.harvestDisabled).toBe(true);
    // Rows are NOT filtered: Claw is still shown, because hiding it would
    // change what "check every box" submits and so would move the sim's
    // concentration bonus on nine shipped mobs.
    expect(view.rows.map((r) => r.tag)).toEqual(['hide', 'fang', 'claw']);
  });

  it('stays live as soon as one checked family maps to something', () => {
    const mixed = corpseHarvestView(['hide', 'fang', 'claw'], pick('claw', 'hide'));
    expect(mixed.forfeitsEveryYield).toBe(false);
    expect(mixed.harvestDisabled).toBe(false);
  });

  it('covers the two-tag murloc, where a single checkbox is the whole refusal', () => {
    expect(MOBS.mudfin_murloc.componentTags).toEqual(['gills', 'hide']);
    expect(corpseHarvestView(['gills', 'hide'], pick('gills')).harvestDisabled).toBe(true);
    expect(corpseHarvestView(['gills', 'hide'], pick('hide')).harvestDisabled).toBe(false);
  });

  it('covers the worst shipped case, where two of three boxes are traps', () => {
    expect(MOBS.sethrael_palecoil.componentTags).toEqual(['hide', 'claw', 'horn']);
    const tags = ['hide', 'claw', 'horn'];
    expect(corpseHarvestView(tags, pick('claw')).harvestDisabled).toBe(true);
    expect(corpseHarvestView(tags, pick('horn')).harvestDisabled).toBe(true);
    expect(corpseHarvestView(tags, pick('claw', 'horn')).harvestDisabled).toBe(true);
    expect(corpseHarvestView(tags, pick('hide', 'claw', 'horn')).harvestDisabled).toBe(false);
  });

  it('leaves an all-unmapped corpse alone, exactly as the sim does', () => {
    // fen_troll forfeits nothing whatever the player checks, because no pick
    // could have paid out. The sim deliberately keeps its documented
    // zero-yield path there, so the picker must keep offering it. A mirror
    // written as "no checked family maps" without the third term would
    // disable this corpse and diverge from the command it is mirroring.
    expect(MOBS.fen_troll.componentTags).toEqual(['claw', 'tusk']);
    for (const selected of [pick(), pick('claw'), pick('tusk'), pick('claw', 'tusk')]) {
      const view = corpseHarvestView(['claw', 'tusk'], selected);
      expect(view.forfeitsEveryYield, JSON.stringify([...selected])).toBe(false);
      expect(view.harvestDisabled, JSON.stringify([...selected])).toBe(false);
    }
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
    // The oracle calls the REAL effectiveFocusComponents rather than restating
    // its spread rule, so moving that threshold in
    // src/sim/professions/gathering.ts reds this sweep instead of quietly
    // letting the picker and the command drift apart. (It deliberately does
    // NOT call forfeitsEveryMappedYield, which the view itself now calls: that
    // would be the predicate compared against itself.)
    let disabledSeen = 0;
    for (const m of Object.values(MOBS)) {
      const tags = m.componentTags;
      if (!tags?.length) continue;
      const mappedOnCorpse = tags.some((t) => HARVEST_COMPONENT_ITEMS[t]);
      for (let mask = 0; mask < 1 << tags.length; mask++) {
        const selected = tags.filter((_, i) => mask & (1 << i));
        const effective = effectiveFocusComponents(tags, selected);
        const simWouldRefuse = !effective.some((t) => HARVEST_COMPONENT_ITEMS[t]) && mappedOnCorpse;
        const view = corpseHarvestView(tags, new Set(selected));
        expect(view.harvestDisabled, `${m.id} ${JSON.stringify(selected)}`).toBe(simWouldRefuse);
        if (simWouldRefuse) disabledSeen++;
      }
    }
    // The sweep has to actually VISIT the disabled arm. A content retag that
    // left no mixed template would otherwise pass it all-false with the mirror
    // never exercised at all.
    expect(disabledSeen).toBe(11);
  });
});
