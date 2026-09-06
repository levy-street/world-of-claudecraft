// Pure view-core for the corpse popup's harvest STATUS section (Intentional
// Gathering PR3, corpse-status-contract.md), tested DOM-free in Node:
// corpseHarvestStatusView/corpseHarvestStatusSignature are UI_PURE_CORES
// members, so they import nothing that needs a browser.
//
// Replaces the retired per-tag checkbox picker's pure core (#1142): there is
// now ONE remembered global preference, and this core only projects the
// live `CorpseHarvestInfo` query answer (or its pre-answer `checking` state)
// into the section's render model.

import { describe, expect, it } from 'vitest';
import { HARVEST_COMPONENT_ITEMS } from '../src/sim/content/professions';
import {
  corpseHarvestStatusSignature,
  corpseHarvestStatusView,
} from '../src/ui/hud/loot/corpse_harvest_view';
import type { CorpseHarvestInfo } from '../src/world_api';

function info(over: Partial<CorpseHarvestInfo> = {}): CorpseHarvestInfo {
  return {
    corpseId: 1,
    componentTags: [],
    preference: { kind: 'all' },
    denial: null,
    reservation: null,
    tierBonus: 0,
    ...over,
  };
}

describe('corpseHarvestStatusView: checking', () => {
  it('disables Harvest, carries no preference/denial, and still derives the available materials', () => {
    const [hideItem] = Object.entries(HARVEST_COMPONENT_ITEMS).find(([, itemId]) => itemId)!;
    const view = corpseHarvestStatusView({ kind: 'checking' }, [hideItem]);
    expect(view).toEqual({
      kind: 'checking',
      preference: null,
      denial: null,
      reservation: null,
      tierBonus: 0,
      resolvedComponentTags: [hideItem],
      availableMaterialItemIds: [HARVEST_COMPONENT_ITEMS[hideItem]],
      harvestDisabled: true,
    });
  });
});

describe('corpseHarvestStatusView: settled null (no usable current answer)', () => {
  it('disables Harvest and carries no preference/denial/reservation', () => {
    const view = corpseHarvestStatusView({ kind: 'settled', info: null }, []);
    expect(view.kind).toBe('unavailable');
    expect(view.preference).toBeNull();
    expect(view.denial).toBeNull();
    expect(view.reservation).toBeNull();
    expect(view.tierBonus).toBe(0);
    expect(view.harvestDisabled).toBe(true);
  });

  it('null is never re-derived as a permission: it disables exactly like checking', () => {
    const checking = corpseHarvestStatusView({ kind: 'checking' }, []);
    const settledNull = corpseHarvestStatusView({ kind: 'settled', info: null }, []);
    expect(checking.harvestDisabled).toBe(true);
    expect(settledNull.harvestDisabled).toBe(true);
    // Distinct kinds even though both disable, so a painter can show a
    // different (checking vs unavailable) status line.
    expect(checking.kind).not.toBe(settledNull.kind);
  });
});

describe('corpseHarvestStatusView: settled with real info', () => {
  it('an admitted All-materials read enables Harvest and carries zero tier bonus', () => {
    const view = corpseHarvestStatusView(
      { kind: 'settled', info: info({ preference: { kind: 'all' }, denial: null }) },
      [],
    );
    expect(view.kind).toBe('ready');
    expect(view.preference).toEqual({ kind: 'all' });
    expect(view.denial).toBeNull();
    expect(view.harvestDisabled).toBe(false);
    expect(view.tierBonus).toBe(0);
  });

  it('an admitted material read carries the preference and a real tier bonus through unchanged', () => {
    const view = corpseHarvestStatusView(
      {
        kind: 'settled',
        info: info({ preference: { kind: 'material', itemId: 'rough_hide' }, tierBonus: 3 }),
      },
      [],
    );
    expect(view.preference).toEqual({ kind: 'material', itemId: 'rough_hide' });
    expect(view.tierBonus).toBe(3);
    expect(view.harvestDisabled).toBe(false);
  });

  it('ANY non-null denial disables Harvest, whatever the reason', () => {
    const reasons = [
      'malformed_input',
      'actor_dead',
      'actor_in_combat',
      'actor_busy',
      'corpse_invalid',
      'wrong_world',
      'out_of_range',
      'no_field_kit',
      'already_harvested',
      'reserved',
      'priority_protected',
      'corpse_expiring',
      'preference_malformed',
      'nothing_to_harvest',
      'material_unavailable',
      'bags_full',
    ] as const;
    for (const denial of reasons) {
      const view = corpseHarvestStatusView({ kind: 'settled', info: info({ denial }) }, []);
      expect(view.harvestDisabled, denial).toBe(true);
      expect(view.denial, denial).toBe(denial);
    }
  });

  it('carries the reservation through unchanged, self and other alike', () => {
    const other = corpseHarvestStatusView(
      {
        kind: 'settled',
        info: info({ denial: 'reserved', reservation: { name: 'Rival', self: false } }),
      },
      [],
    );
    expect(other.reservation).toEqual({ name: 'Rival', self: false });

    const self = corpseHarvestStatusView(
      {
        kind: 'settled',
        info: info({ denial: 'reserved', reservation: { name: 'Me', self: true } }),
      },
      [],
    );
    expect(self.reservation).toEqual({ name: 'Me', self: true });
  });
});

describe('corpseHarvestStatusView: availableMaterialItemIds', () => {
  it("derives the body's supported materials from the caller-supplied componentTags, deduplicated by item", () => {
    // Two tags that yield the SAME item id fold into one entry; an unmapped
    // tag contributes nothing.
    const mapped = Object.entries(HARVEST_COMPONENT_ITEMS).filter(([, itemId]) => itemId);
    const [tagA, itemA] = mapped[0];
    const otherPair = mapped.find(([, itemId]) => itemId !== itemA);
    if (!otherPair) throw new Error('need at least two distinct mapped materials for this fixture');
    const [tagB, itemB] = otherPair;
    const view = corpseHarvestStatusView({ kind: 'checking' }, [tagA, tagB, 'not_a_real_tag']);
    expect(view.availableMaterialItemIds).toEqual([itemA, itemB]);
  });

  it('checking and unavailable share the LOCAL fallback tags (neither has an authoritative answer)', () => {
    const [tag] = Object.entries(HARVEST_COMPONENT_ITEMS).find(([, id]) => id)!;
    const tags = [tag];
    const checking = corpseHarvestStatusView({ kind: 'checking' }, tags);
    const unavailable = corpseHarvestStatusView({ kind: 'settled', info: null }, tags);
    expect(checking.availableMaterialItemIds).toEqual(unavailable.availableMaterialItemIds);
  });

  it('ready uses the AUTHORITATIVE info.componentTags instead, so it can legitimately differ from the local fallback', () => {
    const [tag, itemId] = Object.entries(HARVEST_COMPONENT_ITEMS).find(([, id]) => id)!;
    const localTags = ['not_a_real_tag'];
    const unavailable = corpseHarvestStatusView({ kind: 'settled', info: null }, localTags);
    const ready = corpseHarvestStatusView(
      { kind: 'settled', info: info({ componentTags: [tag] }) },
      localTags,
    );
    expect(unavailable.availableMaterialItemIds).toEqual([]);
    expect(ready.availableMaterialItemIds).toEqual([itemId]);
  });
});

describe('corpseHarvestStatusView: resolvedComponentTags (authoritative once answered)', () => {
  it('falls back to the local (synchronous availability) tags while checking or unavailable', () => {
    const localTags = ['hide', 'fang'];
    expect(corpseHarvestStatusView({ kind: 'checking' }, localTags).resolvedComponentTags).toEqual(
      localTags,
    );
    expect(
      corpseHarvestStatusView({ kind: 'settled', info: null }, localTags).resolvedComponentTags,
    ).toEqual(localTags);
  });

  it('prefers the AUTHORITATIVE server-confirmed info.componentTags once settled with a real answer, even when it differs from the local tags', () => {
    const localTags = ['hide', 'fang'];
    const authoritativeTags = ['claw'];
    const view = corpseHarvestStatusView(
      { kind: 'settled', info: info({ componentTags: authoritativeTags }) },
      localTags,
    );
    expect(view.resolvedComponentTags).toEqual(authoritativeTags);
    expect(view.resolvedComponentTags).not.toEqual(localTags);
  });

  it('drives availableMaterialItemIds off the resolved (not the local) tags', () => {
    const [tagA, itemA] = Object.entries(HARVEST_COMPONENT_ITEMS).find(([, id]) => id)!;
    const localTags = ['not_a_real_tag'];
    const view = corpseHarvestStatusView(
      { kind: 'settled', info: info({ componentTags: [tagA] }) },
      localTags,
    );
    expect(view.availableMaterialItemIds).toEqual([itemA]);
  });

  it('an unavailable/retired material choice never falls back to All: it stays refused and named', () => {
    const view = corpseHarvestStatusView(
      {
        kind: 'settled',
        info: info({
          preference: { kind: 'material', itemId: 'retired_item' },
          denial: 'material_unavailable',
        }),
      },
      [],
    );
    expect(view.preference).toEqual({ kind: 'material', itemId: 'retired_item' });
    expect(view.harvestDisabled).toBe(true);
  });
});

describe('corpseHarvestStatusSignature', () => {
  it('gives checking and settled-null distinct, stable signatures', () => {
    expect(corpseHarvestStatusSignature({ kind: 'checking' }, [])).toBe(
      corpseHarvestStatusSignature({ kind: 'checking' }, []),
    );
    expect(corpseHarvestStatusSignature({ kind: 'settled', info: null }, [])).toBe(
      corpseHarvestStatusSignature({ kind: 'settled', info: null }, []),
    );
    expect(corpseHarvestStatusSignature({ kind: 'checking' }, [])).not.toBe(
      corpseHarvestStatusSignature({ kind: 'settled', info: null }, []),
    );
  });

  it('two settled answers with identical fields share a signature (no rebuild on repeat)', () => {
    const a = info({ preference: { kind: 'all' }, tierBonus: 1 });
    const b = info({ preference: { kind: 'all' }, tierBonus: 1, corpseId: 999 });
    // corpseId is deliberately excluded from the signature: the popup already
    // scopes the query to one open body, so two answers for THAT body differ
    // only in the fields the section actually renders.
    expect(corpseHarvestStatusSignature({ kind: 'settled', info: a }, [])).toBe(
      corpseHarvestStatusSignature({ kind: 'settled', info: b }, []),
    );
  });

  it('changes when the preference, denial, reservation, or tier bonus changes', () => {
    const base = corpseHarvestStatusSignature({ kind: 'settled', info: info() }, []);
    expect(
      corpseHarvestStatusSignature(
        {
          kind: 'settled',
          info: info({ preference: { kind: 'material', itemId: 'rough_hide' } }),
        },
        [],
      ),
    ).not.toBe(base);
    expect(
      corpseHarvestStatusSignature({ kind: 'settled', info: info({ denial: 'out_of_range' }) }, []),
    ).not.toBe(base);
    expect(
      corpseHarvestStatusSignature(
        {
          kind: 'settled',
          info: info({ denial: 'reserved', reservation: { name: 'Rival', self: false } }),
        },
        [],
      ),
    ).not.toBe(base);
    expect(
      corpseHarvestStatusSignature({ kind: 'settled', info: info({ tierBonus: 2 }) }, []),
    ).not.toBe(base);
  });

  it('changes when the resolved component tags change (authoritative once answered)', () => {
    const checkingA = corpseHarvestStatusSignature({ kind: 'checking' }, ['hide']);
    const checkingB = corpseHarvestStatusSignature({ kind: 'checking' }, ['fang']);
    expect(checkingA).not.toBe(checkingB);

    const readyA = corpseHarvestStatusSignature(
      { kind: 'settled', info: info({ componentTags: ['hide'] }) },
      [],
    );
    const readyB = corpseHarvestStatusSignature(
      { kind: 'settled', info: info({ componentTags: ['fang'] }) },
      [],
    );
    expect(readyA).not.toBe(readyB);
  });
});
