// @vitest-environment happy-dom

// The clickable Reliquary announcements, driven through the REAL Hud method
// (the deed_unlock_chat_link.test.ts rig): a relic gain, an Illumination, and a
// Curator rank-up each render their NAME as a chat-deed-link span inside the
// localized line, and activating it (click or Enter) jumps to the surface that
// explains it. The link labels resolve from the local catalog
// (reliquaryRelicDisplayName, reliquaryPageName, the curator rank key), never
// from the wire.
//
// Two arms exist for the Illumination line (the durable log that survives when
// rank-up claims the banner slot, and the banner branch's own line): a
// single-site conversion is the known trap, so BOTH are driven here.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../src/game/audio';
import { RELIQUARY_PAGES, RELIQUARY_PAGES_BY_ID } from '../src/sim/content/reliquary';
import { Hud } from '../src/ui/hud';
import { formatNumber, t, tPlural } from '../src/ui/i18n';
import { reliquaryPageName } from '../src/ui/reliquary_i18n';
import { reliquaryRelicDisplayName } from '../src/ui/reliquary_labels';
import { curatorRankNameKey, type ReliquaryUnlockEventModel } from '../src/ui/reliquary_view';
import { isReliquaryNavId } from '../src/ui/reliquary_window';

// A tier set piece really lives on TWO pages: the raid page that drops it
// (first in authored order) and its set page. That is what makes the first-find
// hint observable at all, since a resolver that ignored the hint would still
// land on a real page holding the relic and pass a weaker assertion.
const RELIC_ID = 'deathlord_legguards';
const SECOND_RELIC_ID = 'deathlord_warplate';
const RELIC_PAGE = 'conquerors_gravewyrm_sanctum';
const HINT_PAGE = 'conquerors_set_deathlord';
const ILLUMINATED_PAGE = 'professions_field_notes';
const RANK = 3;

// The DOM normalizes an assigned hex (rgb() form differs per engine), so
// round-trip the expected color through the same style property.
const cssColor = (hex: string): string => {
  const el = document.createElement('span');
  el.style.color = hex;
  return el.style.color;
};

const GOLD = '#ffd100';

/** The independent oracle for the rank label: the shared key table, resolved
 *  here rather than through the Hud's own private helper. */
const rankName = (rank: number): string =>
  t(curatorRankNameKey(rank), { rank: formatNumber(rank) });

interface ReliquaryLinkHarness {
  sim: { reliquaryFirstFind: Record<string, { clears?: number }> };
  chatLogEl: HTMLElement;
  chatTimestamps: boolean;
  chatClock: string;
  chatWindow: { hideIfFiltered: ReturnType<typeof vi.fn> };
  chatAnnouncer: { push: ReturnType<typeof vi.fn> };
  combatAnnouncer: { push: ReturnType<typeof vi.fn> };
  bannerEl: HTMLElement;
  bannerTimer: number | undefined;
  bannerSource: 'unstuck' | null;
  log: ReturnType<typeof vi.fn>;
  reliquaryWindow: {
    isOpen: boolean;
    open: ReturnType<typeof vi.fn>;
    openWithPage: ReturnType<typeof vi.fn>;
    flashRelics: ReturnType<typeof vi.fn>;
    celebrateIllumination: ReturnType<typeof vi.fn>;
    refreshIfChanged: ReturnType<typeof vi.fn>;
  };
  handleReliquaryUnlocks(events: ReliquaryUnlockEventModel[]): void;
}

function makeHud(): ReliquaryLinkHarness {
  const hud = Object.create(Hud.prototype) as unknown as ReliquaryLinkHarness;
  hud.sim = { reliquaryFirstFind: {} };
  hud.chatLogEl = document.createElement('div');
  hud.chatTimestamps = false;
  hud.chatClock = '24h';
  hud.chatWindow = { hideIfFiltered: vi.fn() };
  hud.chatAnnouncer = { push: vi.fn() };
  hud.combatAnnouncer = { push: vi.fn() };
  hud.bannerEl = document.createElement('div');
  hud.bannerTimer = undefined;
  hud.bannerSource = null;
  // The plain-text log arm (the retro summary, and the inert line for a relic
  // the catalog lost) stays a stub: this suite is about the NODE lines, which
  // run the real logNodes/appendLog path.
  hud.log = vi.fn();
  hud.reliquaryWindow = {
    isOpen: false,
    open: vi.fn(),
    openWithPage: vi.fn(),
    flashRelics: vi.fn(),
    celebrateIllumination: vi.fn(),
    refreshIfChanged: vi.fn(),
  };
  return hud;
}

const links = (hud: ReliquaryLinkHarness): HTMLElement[] => [
  ...hud.chatLogEl.querySelectorAll<HTMLElement>('span.chat-deed-link'),
];

/** The first page in authored order that lists an item relic, scanned here so
 *  the suite's premises never lean on the resolver under test. */
const firstAuthoredPage = (relicId: string): string | null => {
  for (const page of RELIQUARY_PAGES) {
    for (const relic of page.relics) {
      if (relic.kind === 'item' && relic.itemId === relicId) return page.id;
    }
  }
  return null;
};

/** One chat line by index, in emission order. */
const line = (hud: ReliquaryLinkHarness, index: number): HTMLElement => {
  const node = hud.chatLogEl.children[index];
  if (!node) throw new Error(`no chat line at ${index}`);
  return node as HTMLElement;
};

beforeEach(() => {
  document.body.innerHTML = '';
  vi.spyOn(audio, 'achievement').mockImplementation(() => {});
  // Content premises: a rename would otherwise make every jump assertion below
  // vacuous (openWithPage would simply be called with a different string).
  for (const pageId of [RELIC_PAGE, HINT_PAGE, ILLUMINATED_PAGE]) {
    if (!RELIQUARY_PAGES_BY_ID[pageId]) {
      throw new Error(`content premise: ${pageId} is a live Reliquary page`);
    }
  }
  // An INDEPENDENT scan of the catalog (never the production resolver): the
  // relic's first authored page must be the fallback this suite expects, and
  // the hint page must be a different page that really holds it.
  if (firstAuthoredPage(RELIC_ID) !== RELIC_PAGE) {
    throw new Error(`content premise: ${RELIC_PAGE} is the first authored page for ${RELIC_ID}`);
  }
  if (firstAuthoredPage(SECOND_RELIC_ID) !== RELIC_PAGE) {
    throw new Error(`content premise: ${SECOND_RELIC_ID} is first found on ${RELIC_PAGE} too`);
  }
  const hintHolds = (RELIQUARY_PAGES_BY_ID[HINT_PAGE]?.relics ?? []).some(
    (relic) => relic.kind === 'item' && relic.itemId === RELIC_ID,
  );
  if (!hintHolds) {
    throw new Error(`content premise: ${HINT_PAGE} is a SECOND page holding ${RELIC_ID}`);
  }
});

describe('the relic unlock line', () => {
  it('renders the localized line with the relic name as a chat-deed-link span', () => {
    const hud = makeHud();
    hud.handleReliquaryUnlocks([{ itemId: RELIC_ID }]);
    const first = line(hud, 0);
    const label = reliquaryRelicDisplayName('item', RELIC_ID);
    // The whole line reads exactly as before, name bracketed link-style.
    expect(first.textContent).toBe(t('hudChrome.reliquary.unlockToast', { name: `[${label}]` }));
    const link = first.querySelector('span.chat-deed-link') as HTMLElement;
    expect(link).not.toBeNull();
    expect(link.textContent).toBe(`[${label}]`);
    expect(link.getAttribute('role')).toBe('button');
    expect(link.tabIndex).toBe(0);
    // The gold announcement color rides the line, the link inherits it.
    expect(first.style.color).toBe(cssColor(GOLD));
  });

  it('click and Enter both open the Reliquary on the page holding the relic', () => {
    const hud = makeHud();
    hud.handleReliquaryUnlocks([{ itemId: RELIC_ID }]);
    const link = links(hud)[0] as HTMLElement;
    link.click();
    expect(hud.reliquaryWindow.openWithPage).toHaveBeenCalledWith(RELIC_PAGE);
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(hud.reliquaryWindow.openWithPage).toHaveBeenCalledTimes(2);
    // The keyboard arm lands on the SAME page: a count alone would pass if the
    // second activation jumped somewhere else.
    expect(hud.reliquaryWindow.openWithPage).toHaveBeenNthCalledWith(2, RELIC_PAGE);
  });

  it('jumps by CATALOG order, never by stored first-find meta', () => {
    // Phase 17 retired the stored pageId hint the resolver used to prefer, so
    // the answer is the first authored page and nothing else. RELIC_ID sits on
    // HINT_PAGE too (asserted as a content premise above), which is what makes
    // this decisive: a resolver still reading per-relic find history would have
    // to answer HINT_PAGE for at least one of the two states below.
    const withMeta = makeHud();
    withMeta.sim.reliquaryFirstFind = { [RELIC_ID]: { clears: 2 } };
    withMeta.handleReliquaryUnlocks([{ itemId: RELIC_ID }]);
    (links(withMeta)[0] as HTMLElement).click();
    expect(withMeta.reliquaryWindow.openWithPage).toHaveBeenCalledWith(RELIC_PAGE);
    expect(withMeta.reliquaryWindow.openWithPage).not.toHaveBeenCalledWith(HINT_PAGE);

    // The retro / veteran state (no entry at all) lands on the same page: the
    // jump target cannot depend on whether provenance was ever recorded.
    const withoutMeta = makeHud();
    withoutMeta.handleReliquaryUnlocks([{ itemId: RELIC_ID }]);
    (links(withoutMeta)[0] as HTMLElement).click();
    expect(withoutMeta.reliquaryWindow.openWithPage).toHaveBeenCalledWith(RELIC_PAGE);
  });

  it('leaves the line PLAIN for a relic the catalog no longer places', () => {
    // A link that opens nothing is worse than no link, so the inert case keeps
    // the durable prose and offers no jump at all.
    const hud = makeHud();
    hud.handleReliquaryUnlocks([{ itemId: 'relic_the_catalog_forgot' }]);
    expect(links(hud)).toHaveLength(0);
    expect(hud.log).toHaveBeenCalledWith(
      t('hudChrome.reliquary.unlockToast', {
        name: reliquaryRelicDisplayName('item', 'relic_the_catalog_forgot'),
      }),
      GOLD,
    );
  });

  it('gives every relic in a drain its own link node', () => {
    // One node per occurrence, never one node moved: a shared node could only
    // sit in the last line's DOM slot, so the first line would lose its jump.
    const hud = makeHud();
    hud.handleReliquaryUnlocks([{ itemId: RELIC_ID }, { itemId: SECOND_RELIC_ID }]);
    expect(links(hud)).toHaveLength(2);
    expect(line(hud, 0).textContent).toBe(
      t('hudChrome.reliquary.unlockToast', {
        name: `[${reliquaryRelicDisplayName('item', RELIC_ID)}]`,
      }),
    );
    (links(hud)[1] as HTMLElement).click();
    expect(hud.reliquaryWindow.openWithPage).toHaveBeenCalledWith(RELIC_PAGE);
  });
});

describe('the Illumination line (both emitters)', () => {
  it('is clickable on the banner branch (Illumination owns the banner slot)', () => {
    const hud = makeHud();
    hud.handleReliquaryUnlocks([{ itemId: RELIC_ID, illuminatedPageId: ILLUMINATED_PAGE }]);
    const pageLabel = reliquaryPageName(ILLUMINATED_PAGE);
    // Emission order: the relic line, then the banner branch's own line.
    const illuminate = line(hud, 1);
    expect(illuminate.textContent).toBe(
      t('hudChrome.reliquary.illuminateToast', { name: `[${pageLabel}]` }),
    );
    expect(illuminate.style.color).toBe(cssColor(GOLD));
    const link = illuminate.querySelector('span.chat-deed-link') as HTMLElement;
    expect(link.textContent).toBe(`[${pageLabel}]`);
    link.click();
    expect(hud.reliquaryWindow.openWithPage).toHaveBeenCalledWith(ILLUMINATED_PAGE);
    // The banner argument is REAL prose: three sibling t() calls in the same
    // method interpolate the node-splice sentinel (DEED_NAME_TOKEN), so a
    // pasted token here would ship a banner reading the raw sentinel in every
    // locale with nothing else red.
    expect(hud.combatAnnouncer.push).toHaveBeenCalledWith(
      t('hudChrome.reliquary.illuminateBanner', { name: pageLabel }),
      expect.any(Number),
    );
  });

  it('leaves the BANNER-branch line plain when the illuminated page left the catalog', () => {
    // The relic line's inert-link policy, applied to the Illumination arms: a
    // drifted (or forged) wire id must not render a link that opens nothing.
    // Premise first: were this id ever authored, both drift tests would drive
    // the live-catalog arm and pass over an untested guard.
    expect(RELIQUARY_PAGES_BY_ID['page_the_catalog_forgot']).toBeUndefined();
    const hud = makeHud();
    hud.handleReliquaryUnlocks([
      { itemId: RELIC_ID, illuminatedPageId: 'page_the_catalog_forgot' },
    ]);
    // The relic line still links; the Illumination line does not.
    expect(links(hud)).toHaveLength(1);
    expect(hud.log).toHaveBeenCalledWith(
      t('hudChrome.reliquary.illuminateToast', {
        name: reliquaryPageName('page_the_catalog_forgot'),
      }),
      GOLD,
    );
  });

  it('leaves the DURABLE line plain when the illuminated page left the catalog', () => {
    // Same policy on the other emitter (rank-up owns the banner slot here).
    expect(RELIQUARY_PAGES_BY_ID['page_the_catalog_forgot']).toBeUndefined();
    const hud = makeHud();
    hud.handleReliquaryUnlocks([
      { itemId: RELIC_ID, illuminatedPageId: 'page_the_catalog_forgot', curatorRank: RANK },
    ]);
    // The relic and rank-up lines still link; the Illumination line does not.
    expect(links(hud)).toHaveLength(2);
    expect(hud.log).toHaveBeenCalledWith(
      t('hudChrome.reliquary.illuminateToast', {
        name: reliquaryPageName('page_the_catalog_forgot'),
      }),
      GOLD,
    );
  });

  it('is clickable on the DURABLE branch (rank-up owns the banner slot)', () => {
    // The known single-site trap: this is the other emitter, and it is the one
    // that fires on the rarest, most celebrated drain of all.
    const hud = makeHud();
    hud.handleReliquaryUnlocks([
      { itemId: RELIC_ID, illuminatedPageId: ILLUMINATED_PAGE, curatorRank: RANK },
    ]);
    const pageLabel = reliquaryPageName(ILLUMINATED_PAGE);
    const illuminate = line(hud, 1);
    expect(illuminate.textContent).toBe(
      t('hudChrome.reliquary.illuminateToast', { name: `[${pageLabel}]` }),
    );
    // The gold announcement color rides this emitter too: the durable line is
    // the one that fires on the rarest drain, and it must not read as ordinary
    // chat just because rank-up took the banner slot.
    expect(illuminate.style.color).toBe(cssColor(GOLD));
    (illuminate.querySelector('span.chat-deed-link') as HTMLElement).click();
    expect(hud.reliquaryWindow.openWithPage).toHaveBeenCalledWith(ILLUMINATED_PAGE);
    // Three lines, three links: relic, Illumination, rank-up.
    expect(links(hud)).toHaveLength(3);
  });
});

describe('the Curator rank-up line', () => {
  it('renders the rank name as the link and opens the Overview', () => {
    const hud = makeHud();
    hud.handleReliquaryUnlocks([{ itemId: RELIC_ID, curatorRank: RANK }]);
    const label = rankName(RANK);
    const rankLine = line(hud, 1);
    expect(rankLine.textContent).toBe(
      t('hudChrome.reliquary.rankUpToast', { rank: formatNumber(RANK), name: `[${label}]` }),
    );
    expect(rankLine.style.color).toBe(cssColor(GOLD));
    const link = rankLine.querySelector('span.chat-deed-link') as HTMLElement;
    expect(link.textContent).toBe(`[${label}]`);
    link.click();
    // The rank belongs to the whole collection, so it lands on Overview, and
    // that nav-bearing open is what drops a persisted off-shelf page.
    expect(hud.reliquaryWindow.open).toHaveBeenCalledWith('overview');
    expect(hud.reliquaryWindow.openWithPage).not.toHaveBeenCalled();
    // Composition with the REAL window (whose own focus placement is driven in
    // reliquary_window_jump.test.ts): the argument has to be a nav id the
    // window's validator accepts, or the shelf jump, and the reading-position
    // move it arms, would quietly land nowhere.
    const navArg: unknown = hud.reliquaryWindow.open.mock.calls[0]?.[0];
    expect(typeof navArg).toBe('string');
    expect(isReliquaryNavId(navArg as string)).toBe(true);
    // The banner argument is REAL prose, never the node-splice sentinel (see
    // the Illumination banner pin for the trap this closes).
    expect(hud.combatAnnouncer.push).toHaveBeenCalledWith(
      t('hudChrome.reliquary.rankUpBanner', { rank: formatNumber(RANK), name: label }),
      expect.any(Number),
    );
  });
});

describe('the retro catch-up summary', () => {
  it('stays a plain line with no link (it names no single relic)', () => {
    const hud = makeHud();
    hud.handleReliquaryUnlocks([
      { itemId: RELIC_ID, retro: true },
      { itemId: 'cryptbone_greaves', retro: true },
    ]);
    expect(links(hud)).toHaveLength(0);
    expect(hud.chatLogEl.children).toHaveLength(0);
    expect(hud.log).toHaveBeenCalledWith(
      tPlural('hudChrome.plurals.reliquaryRetroSummary', 2, {
        count: formatNumber(2, { maximumFractionDigits: 0 }),
      }),
      GOLD,
    );
  });
});
