import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { CURATOR_RANK_DEFS } from '../src/sim/reliquary';
import type { EquipSlot } from '../src/sim/types';
import {
  buildPaperdollView,
  PAPERDOLL_LEFT_SLOTS,
  PAPERDOLL_RIGHT_SLOTS,
} from '../src/ui/char_view';
import { borderAccent } from '../src/ui/deed_border_view';
import {
  buildInspectRemoteView,
  buildInspectView,
  CURATOR_SIGIL_MIN_RANK,
  classColorCss,
  type InspectInput,
} from '../src/ui/inspect_view';

// Base inputs for a fully-decked mage with no identity flair; each test overrides
// the one dimension it exercises so every gate has a decisive negative case.
const base: InspectInput = {
  name: 'Elowen',
  level: 45,
  cls: 'mage',
  skin: 2,
  skinCatalog: 'class',
  deedTitleText: '',
  border: null,
  curatorRank: 0,
  relicsOwned: null,
  relicsTotal: null,
  equippedItems: {
    helmet: 'monarch_crown_helm',
    chest: 'gravewoven_raiment',
    mainhand: 'worn_sword',
  },
  holderTier: 0,
  holderBalance: null,
  discordTier: 0,
  discordName: null,
  discordAvatar: null,
  discordJoined: null,
  discordRole: null,
  devTier: 0,
  devMergedPrs: null,
  githubLogin: null,
  showDevBadges: true,
  now: 1_000 * 86_400_000, // a fixed "now" in whole days
};

describe('classColorCss', () => {
  it('mirrors hud.ts classCss: the mage class color as a #rrggbb string', () => {
    // Pinned literals (CLASSES[mage].color === 0x33c1f1, warrior === 0xd67a54), the
    // exact hue the inspect stage border / glow / haze take.
    expect(classColorCss('mage')).toBe('#33c1f1');
    expect(classColorCss('warrior')).toBe('#d67a54');
  });

  it('falls back to the shared blue for an unknown class id', () => {
    expect(classColorCss('not_a_class')).toBe('#5fa8ff');
  });
});

describe('buildInspectView: header', () => {
  it('carries name, level, class, and the class color', () => {
    const m = buildInspectView(base, ITEMS);
    expect(m.header).toMatchObject({
      name: 'Elowen',
      level: 45,
      cls: 'mage',
      classColor: '#33c1f1',
    });
    expect(m.skin).toBe(2);
  });

  it('carries the skin CATALOG through for the turntable, so a mech-cosmetic player keeps their rig', () => {
    // The turntable resolves the visual from (cls, skin, catalog); dropping the
    // catalog would apply a mech-catalog skin INDEX to the class rig (wrong skin).
    expect(buildInspectView(base, ITEMS).skinCatalog).toBe('class');
    expect(buildInspectView({ ...base, skinCatalog: 'mech' }, ITEMS).skinCatalog).toBe('mech');
  });

  it('deed title is null when the resolved text is empty, the text when present', () => {
    expect(buildInspectView(base, ITEMS).header.deedTitle).toBeNull();
    expect(
      buildInspectView({ ...base, deedTitleText: 'the Brightwood Remembered' }, ITEMS).header
        .deedTitle,
    ).toBe('the Brightwood Remembered');
  });
});

describe('buildInspectView: badge gating', () => {
  it('hides the holder badge at tier 0 and shows it (with balance) above', () => {
    expect(buildInspectView(base, ITEMS).badges.holder).toBeNull();
    const m = buildInspectView({ ...base, holderTier: 3, holderBalance: 4200 }, ITEMS);
    expect(m.badges.holder).toEqual({ tierIndex: 3, balance: 4200 });
    // A zero/absent balance collapses to null (painter shows the plain rung label).
    expect(
      buildInspectView({ ...base, holderTier: 3, holderBalance: 0 }, ITEMS).badges.holder,
    ).toEqual({ tierIndex: 3, balance: null });
  });

  it('hides the dev badge at tier 0, and hides it at a real tier when showDevBadges is off', () => {
    expect(buildInspectView({ ...base, devTier: 0 }, ITEMS).badges.dev).toBeNull();
    expect(
      buildInspectView({ ...base, devTier: 2, showDevBadges: false }, ITEMS).badges.dev,
    ).toBeNull();
    expect(
      buildInspectView(
        { ...base, devTier: 2, showDevBadges: true, devMergedPrs: 17, githubLogin: 'elowen' },
        ITEMS,
      ).badges.dev,
    ).toEqual({ tierIndex: 2, mergedPrs: 17, githubLogin: 'elowen' });
  });

  it('hides Discord at tier 0 and computes whole member-days from the injected now', () => {
    expect(buildInspectView(base, ITEMS).badges.discord).toBeNull();
    const joined = base.now - Math.floor(10.7 * 86_400_000); // 10 whole days ago
    const m = buildInspectView(
      { ...base, discordTier: 1, discordName: 'elowen#1', discordJoined: joined },
      ITEMS,
    );
    expect(m.badges.discord).toEqual({
      tierIndex: 1,
      name: 'elowen#1',
      avatar: null,
      memberDays: 10,
      role: null,
    });
  });

  it('member-days is null when the join stamp is absent, never negative for a future stamp', () => {
    expect(
      buildInspectView({ ...base, discordTier: 1, discordJoined: null }, ITEMS).badges.discord
        ?.memberDays,
    ).toBeNull();
    expect(
      buildInspectView(
        { ...base, discordTier: 1, discordJoined: base.now + 5 * 86_400_000 }, // joined "later"
        ITEMS,
      ).badges.discord?.memberDays,
    ).toBe(0);
  });
});

describe('buildInspectView: the Curator standing line', () => {
  // 'col_reliquary_rank_5' is the rank-5 deed bridge, whose reward IS the
  // reliquary_gilt border; the ids below are the live catalog's, so a content
  // rename reds here instead of silently dropping the accent.
  const ranked = { ...base, curatorRank: 3, relicsOwned: 42, relicsTotal: 300 };

  it('is null for a fresh character: no rank, no pair, no line', () => {
    expect(buildInspectView(base, ITEMS).curator).toBeNull();
  });

  it('carries rank and the whole pair once the player is ranked', () => {
    expect(buildInspectView(ranked, ITEMS).curator).toEqual({
      rank: 3,
      owned: 42,
      total: 300,
    });
  });

  it('shows at rank 1, the first ranked rung (the line is not sigil-gated)', () => {
    expect(buildInspectView({ ...ranked, curatorRank: 1 }, ITEMS).curator).toEqual({
      rank: 1,
      owned: 42,
      total: 300,
    });
  });

  it('fails CLOSED when a rank arrives without its pair, per missing half', () => {
    // A pair readout with half a pair would print a label and nothing to read.
    // Both dimensions get their own negative case: a shared "either missing"
    // fixture would pass with the guard reading only one of them.
    expect(buildInspectView({ ...ranked, relicsOwned: null }, ITEMS).curator).toBeNull();
    expect(buildInspectView({ ...ranked, relicsTotal: null }, ITEMS).curator).toBeNull();
  });

  it('never invents a line from a pair with no rank behind it', () => {
    expect(
      buildInspectView({ ...base, curatorRank: 0, relicsOwned: 4, relicsTotal: 300 }, ITEMS)
        .curator,
    ).toBeNull();
  });
});

describe('buildInspectView: self-inspect reads LIVE standing', () => {
  // The defect: the three wire fields answer "what did the server last
  // broadcast", which is right for other players and wrong for yourself twice
  // over. Offline nothing ever stamps them, so self-inspect showed no standing
  // at all; online they ride the 60s flair cycle, so it showed one up to a
  // minute behind the Reliquary window open beside it. Hud supplies
  // selfStanding only when the inspected pid is the local player.

  it('OFFLINE shape: selfStanding alone produces the line, with no wire fields at all', () => {
    // The offline world stamps nothing, so every wire field is at its absent
    // value. Before the fix this input produced curator: null.
    const offline: InspectInput = {
      ...base,
      curatorRank: 0,
      relicsOwned: null,
      relicsTotal: null,
      selfStanding: { curatorRank: 3, owned: 42, total: 300 },
    };
    expect(buildInspectView(offline, ITEMS).curator).toEqual({ rank: 3, owned: 42, total: 300 });
  });

  it('OVERRIDES a stale broadcast rather than merging with it', () => {
    // Every wire field disagrees with the live read, and each one has to lose:
    // a build that preferred the wire for any single field would print a
    // mismatched line. The expected object pins all three at once.
    const stale: InspectInput = {
      ...base,
      curatorRank: 1,
      relicsOwned: 10,
      relicsTotal: 300,
      selfStanding: { curatorRank: 4, owned: 88, total: 301 },
    };
    expect(buildInspectView(stale, ITEMS).curator).toEqual({ rank: 4, owned: 88, total: 301 });
  });

  it('leaves the entity-derived behavior alone for everyone else', () => {
    // Both the omitted and the explicitly-null forms are other players; neither
    // may disturb the wire reading. Omission is the shape every existing caller
    // and every test above uses, so it is the one that must not regress.
    const other = { ...base, curatorRank: 2, relicsOwned: 20, relicsTotal: 300 };
    const expected = { rank: 2, owned: 20, total: 300 };
    expect(buildInspectView(other, ITEMS).curator).toEqual(expected);
    expect(buildInspectView({ ...other, selfStanding: null }, ITEMS).curator).toEqual(expected);
  });

  it('drives the SIGIL too, so a live rank 5 wears the honor on self-inspect', () => {
    // The line and the badge read one resolved standing; a fix that changed only
    // the line would leave an Eternal Curator without their own sigil offline.
    const offlineTop: InspectInput = {
      ...base,
      curatorRank: 0,
      relicsOwned: null,
      relicsTotal: null,
      selfStanding: { curatorRank: 5, owned: 300, total: 300 },
    };
    const model = buildInspectView(offlineTop, ITEMS);
    expect(model.badges.curator).toEqual({ rank: 5 });
    expect(model.curator).toEqual({ rank: 5, owned: 300, total: 300 });
  });

  it('takes the sigil AWAY when the live read says the wire was wrong', () => {
    // The override has to work downward as well, or it is just an "or" over the
    // two sources: a wire rank 5 with a live rank 2 must show rank 2 and no
    // sigil, not the honor the stale broadcast claimed.
    const model = buildInspectView(
      {
        ...base,
        curatorRank: 5,
        relicsOwned: 300,
        relicsTotal: 300,
        selfStanding: { curatorRank: 2, owned: 30, total: 300 },
      },
      ITEMS,
    );
    expect(model.badges.curator).toBeNull();
    expect(model.curator).toEqual({ rank: 2, owned: 30, total: 300 });
  });

  it('fails closed on an unranked live read, even against a ranked broadcast', () => {
    const model = buildInspectView(
      {
        ...base,
        curatorRank: 3,
        relicsOwned: 42,
        relicsTotal: 300,
        selfStanding: { curatorRank: 0, owned: 0, total: 300 },
      },
      ITEMS,
    );
    expect(model.curator).toBeNull();
    expect(model.badges.curator).toBeNull();
  });
});

describe('buildInspectView: the Curator sigil badge (rank 5 only)', () => {
  const ranked = (rank: number): InspectInput => ({
    ...base,
    curatorRank: rank,
    relicsOwned: 100,
    relicsTotal: 300,
  });

  it('is locked to the top rung: nothing at rank 4, the sigil at rank 5', () => {
    // The boundary in both directions, which an "absent at 0, present at 5" pair
    // would not pin: rank 4 is the rung that would inherit the honor if the gate
    // slipped by one.
    expect(buildInspectView(ranked(4), ITEMS).badges.curator).toBeNull();
    expect(buildInspectView(ranked(5), ITEMS).badges.curator).toEqual({ rank: 5 });
  });

  it('is absent for every unranked and low-rank standing', () => {
    for (const rank of [0, 1, 2, 3]) {
      expect(buildInspectView(ranked(rank), ITEMS).badges.curator, `rank ${rank}`).toBeNull();
    }
  });

  it('rides RANK alone, so a standing whose counts went missing keeps the honor', () => {
    expect(
      buildInspectView({ ...ranked(5), relicsOwned: null, relicsTotal: null }, ITEMS).badges
        .curator,
    ).toEqual({ rank: 5 });
  });

  it('the locked rank IS the ladder top rung today (a re-tier must be deliberate)', () => {
    // CURATOR_SIGIL_MIN_RANK is a literal on purpose (a sixth rung must not
    // silently move the honor), so this is the pin that reds when the ladder
    // grows and asks a human to decide, rather than deriving the gate from the
    // very table it is meant to guard.
    expect(CURATOR_SIGIL_MIN_RANK).toBe(5);
    expect(CURATOR_RANK_DEFS.at(-1)?.rank).toBe(CURATOR_SIGIL_MIN_RANK);
    expect(CURATOR_RANK_DEFS).toHaveLength(5);
  });

  it('keeps the three older badge slots untouched at every Curator rank', () => {
    // The sigil is a FOURTH slot, not a replacement: a rank-5 player with no
    // other flair still shows exactly one badge.
    const m = buildInspectView(ranked(5), ITEMS).badges;
    expect(m.holder).toBeNull();
    expect(m.discord).toBeNull();
    expect(m.dev).toBeNull();
    expect(Object.keys(m).sort()).toEqual(['curator', 'dev', 'discord', 'holder']);
  });
});

describe('buildInspectView: the header border accent', () => {
  it('is null for a borderless player', () => {
    expect(buildInspectView(base, ITEMS).header.border).toBeNull();
  });

  it('resolves a worn border deed id to its slug AND that slug palette', () => {
    // Deed id in, slug + colors out: the painter must receive resolved colors so
    // it holds no palette of its own. The expected colors come from the ONE
    // table, so this cannot drift from what the nameplate and portrait ring draw.
    const accent = borderAccent('reliquary_gilt');
    expect(accent).not.toBeNull();
    expect(
      buildInspectView({ ...base, border: 'col_reliquary_rank_5' }, ITEMS).header.border,
    ).toEqual({
      slug: 'reliquary_gilt',
      frame: accent?.frame,
      edge: accent?.edge,
      glow: accent?.glow,
    });
  });

  it('fails closed for every id that resolves to no accent', () => {
    // A persisted id whose content record is gone, a TITLE-reward deed, and a
    // prototype key: each renders exactly like a borderless player rather than
    // an uncolored frame.
    for (const id of ['deed_that_no_longer_exists', 'prog_veteran', '__proto__', '']) {
      expect(buildInspectView({ ...base, border: id }, ITEMS).header.border, id).toBeNull();
    }
  });

  it('leaves the rest of the header alone (the accent is additive)', () => {
    const m = buildInspectView({ ...base, border: 'col_reliquary_rank_5' }, ITEMS).header;
    expect(m.name).toBe('Elowen');
    expect(m.classColor).toBe('#33c1f1');
  });
});

describe('buildInspectView: gear reuses the char_view paperdoll (no forked slot list)', () => {
  it('maps worn gear (and empty slots) exactly like buildPaperdollView', () => {
    const m = buildInspectView(base, ITEMS);
    // Identical to the shared core: same arrays, same empty-slot resolution.
    expect(m.gear).toEqual(buildPaperdollView(base.equippedItems, ITEMS));
    // And the column order IS char_view's 6/6 split (offhand in the left column).
    expect(m.gear.left.map((c) => c.slot)).toEqual([...PAPERDOLL_LEFT_SLOTS]);
    expect(m.gear.right.map((c) => c.slot)).toEqual([...PAPERDOLL_RIGHT_SLOTS]);
    expect(m.gear.left.map((c) => c.slot)).toContain('offhand');
    // Filled vs empty resolution.
    expect(m.gear.left[0].item).toBe(ITEMS.monarch_crown_helm);
    const emptySlots = m.gear.right.filter(
      (c: { slot: EquipSlot; item: unknown }) => c.item === null,
    );
    expect(emptySlots.length).toBe(m.gear.right.length); // nothing on the right in `base`
  });
});

describe('buildInspectRemoteView: the thin out-of-range card carries no gear', () => {
  it('carries only name, level, class, class color, and guild', () => {
    const m = buildInspectRemoteView({
      name: 'Elowen',
      level: 45,
      cls: 'mage',
      guild: 'Nightwatch',
    });
    expect(m).toEqual({
      name: 'Elowen',
      level: 45,
      cls: 'mage',
      classColor: '#33c1f1',
      guild: 'Nightwatch',
    });
    expect('gear' in m).toBe(false);
    expect('badges' in m).toBe(false);
    // The out-of-range card stays FLAIRLESS: the Curator standing rides the
    // per-entity wire and is proximity-gated like the three older badges, so
    // looking a name up from chat must not leak it.
    expect('curator' in m).toBe(false);
    expect('border' in m).toBe(false);
  });

  it('allows a null guild', () => {
    expect(
      buildInspectRemoteView({ name: 'X', level: 1, cls: 'warrior', guild: null }).guild,
    ).toBeNull();
  });
});
