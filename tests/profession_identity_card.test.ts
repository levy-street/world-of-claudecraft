// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CRAFT_RING } from '../src/sim/content/professions';
import { renderCraftingWindow } from '../src/ui/crafting_window';
import { QUALITY_COLOR } from '../src/ui/icons';
import { renderProfessionIdentityCard } from '../src/ui/profession_identity_card';
import { buildProfessionIdentityView } from '../src/ui/profession_identity_view';

const painter = readFileSync(
  path.resolve(process.cwd(), 'src/ui/profession_identity_card.ts'),
  'utf8',
);
const craftingWindow = readFileSync(
  path.resolve(process.cwd(), 'src/ui/crafting_window.ts'),
  'utf8',
);

describe('profession identity card painter contract', () => {
  it('renders syncing and attuned identity models into labelled, populated regions', () => {
    const parent = document.createElement('div');
    const identity = {
      version: 1 as const,
      synced: true,
      craftSkills: { armorcrafting: 49, weaponcrafting: 25, cooking: 30 },
      activeArchetype: 'armorcrafting',
      pairedMajor: 'weaponcrafting',
      hobbyCraft: 'leatherworking',
      attunedPairs: ['weaponcrafting+armorcrafting'],
      switchCount: 1,
      amendsProgress: 0,
      amendsRequired: 8,
      knownRecipes: [],
    };

    renderProfessionIdentityCard(parent, buildProfessionIdentityView(identity));
    const card = parent.querySelector<HTMLElement>('.profession-identity-card');
    expect(card?.getAttribute('role')).toBe('region');
    expect(card?.getAttribute('aria-label')).toBeTruthy();
    expect(card?.querySelectorAll('.profession-skill-row')).toHaveLength(10);
    const crest = card?.querySelector<HTMLImageElement>('.profession-archetype-crest');
    expect(crest?.getAttribute('src')).toBe('/ui/professions/archetype_smith.webp');
    expect(crest?.getAttribute('alt')).toBe('');
    // The title line renders the PAIR archetype name (weaponcrafting +
    // armorcrafting is the Smith pair); the skill rows render craft names.
    expect(card?.textContent).toContain('Smith');
    expect(card?.textContent).toContain('Armorcrafting');
    // The attuned card surfaces the make-amends return cost
    // (requiredAmendsProgress(1) = 8, the switch-cost-at-rest figure), pinned
    // as the exact sentence: a substring '8' also matches 18 or 80, and this
    // fixture's amendsRequired is ALSO 8, so only the full sentence proves
    // the right field fed the template.
    const returnCost = card?.querySelector('.profession-identity-returncost');
    expect(returnCost?.textContent).toBe(
      'If you leave this pair, returning to it later costs 8 make-amends tasks.',
    );
    // Phase 22: the rows are the professions row family (head line with the
    // right-aligned value, pill chips below); the 9px uppercase column header
    // died with the rework, and the attuned card mixes roles so the uniform
    // caption must NOT appear.
    expect(card?.querySelectorAll('.profession-skill-header')).toHaveLength(0);
    expect(card?.querySelectorAll('.profession-skill-uniform')).toHaveLength(0);
    // The attuned list keeps the height cap (no uniform-collapsed opt-out).
    expect(
      card?.querySelector('.profession-skill-list')?.classList.contains('uniform-collapsed'),
    ).toBe(false);
    const rows = [...(card?.querySelectorAll<HTMLElement>('.profession-skill-row') ?? [])];
    expect(rows.every((r) => r.classList.contains('prof-craft-row'))).toBe(true);
    // The family NESTING, not just class presence: the 13px rule lives on
    // .prof-craft-head and the chips line is what keeps wide chips off the
    // name baseline (the text-squish fix), so a flattened row that still
    // carries every class must fail here (the professions window's own
    // anatomy pin idiom).
    for (const row of rows) {
      const main = row.firstElementChild as HTMLElement;
      expect(main?.className, 'row first child').toBe('prof-craft-main');
      const head = main?.firstElementChild as HTMLElement;
      expect(head?.className, 'main first child').toBe('prof-craft-head');
      expect([...(head?.children ?? [])].map((c) => c.className)).toEqual([
        'prof-craft-name',
        'prof-skill-value',
      ]);
      const chips = head?.nextElementSibling as HTMLElement;
      expect(chips?.className, 'chips line').toBe('prof-craft-chips');
      expect([...(chips?.children ?? [])].map((c) => c.className)).toEqual([
        'prof-role-badge',
        'prof-ceiling',
      ]);
    }
    const armorRow = rows.find((r) =>
      r.querySelector('.prof-craft-name')?.textContent?.includes('Armorcrafting'),
    );
    expect(armorRow?.classList.contains('role-major')).toBe(true);
    expect(armorRow?.querySelector('.prof-role-badge')?.textContent).toBe('Major');
    expect(armorRow?.querySelector('.prof-ceiling')?.textContent).toBe('No empowerment cap');
    expect(armorRow?.querySelector('.prof-skill-value')?.textContent).toBe('49');
    const hobbyRow = rows.find((r) =>
      r.querySelector('.prof-craft-name')?.textContent?.includes('Leatherworking'),
    );
    expect(hobbyRow?.querySelector('.prof-role-badge')?.textContent).toBe('Hobby');
    expect(hobbyRow?.querySelector('.prof-ceiling')?.textContent).toBe('Rare cap');
    // The DORMANT arms render too (cooking, skill 30, no pair active for
    // it): role class for the family name mute, both pill texts. Without
    // this a swapped ternary arm in roleText/ceilingText ships green.
    const dormantRow = rows.find((r) =>
      r.querySelector('.prof-craft-name')?.textContent?.includes('Cooking'),
    );
    expect(dormantRow?.classList.contains('role-dormant')).toBe(true);
    expect(dormantRow?.querySelector('.prof-role-badge')?.textContent).toBe('Dormant knowledge');
    expect(dormantRow?.querySelector('.prof-ceiling')?.textContent).toBe('Common cap');
    // The full skillAria sentence stays on EVERY row (the chips are visual;
    // the aria carries the whole fact set): the exact sentence pinned once so
    // a dropped t() argument cannot slip through substring checks, plus a
    // structural every-row quantifier so no row can carry a truncated aria.
    expect(
      rows.every((r) =>
        /^.+, skill \d+, tier \d+, .+, .+$/.test(r.getAttribute('aria-label') ?? ''),
      ),
    ).toBe(true);
    expect(armorRow?.getAttribute('aria-label')).toBe(
      'Armorcrafting, skill 49, tier 1, Major, No empowerment cap',
    );
    // Role-priority order (the phase 22 QA round): the capped list leads with
    // the majors, then the hobby, then dormant knowledge, so the two rows the
    // attuned card exists to headline are never below the 264px fold. Stable
    // within groups (ring order), so weaponcrafting (ring 8) precedes
    // armorcrafting (ring 9).
    expect(rows.slice(0, 3).map((r) => r.querySelector('.prof-craft-name')?.textContent)).toEqual([
      'Weaponcrafting',
      'Armorcrafting',
      'Leatherworking',
    ]);
    // The capped (scrollable) attuned list is keyboard-reachable and named:
    // a scroll region with no focusable child is pointer-only without these.
    const list = card?.querySelector<HTMLElement>('.profession-skill-list');
    expect(list?.getAttribute('tabindex')).toBe('0');
    expect(list?.getAttribute('aria-label')).toBe('Craft skills');

    parent.replaceChildren();
    renderProfessionIdentityCard(
      parent,
      buildProfessionIdentityView({ ...identity, synced: false }),
    );
    expect(parent.textContent).toContain('Waiting for your crafting identity');
    // The syncing branch keeps the .profession-identity-main wrapper: the
    // card is a flex ROW, so bare children would render the waiting line
    // BESIDE its heading instead of under it.
    expect(parent.querySelector('.profession-identity-main h3')).not.toBeNull();
    expect(parent.querySelector('.profession-identity-main p')).not.toBeNull();
    // The syncing card has no skill rows, so no uniform caption either.
    expect(parent.querySelectorAll('.profession-skill-row')).toHaveLength(0);
    expect(parent.querySelectorAll('.profession-skill-uniform')).toHaveLength(0);
    // No return-cost line while syncing or unattuned (only shown once attuned).
    expect(parent.querySelectorAll('.profession-identity-returncost')).toHaveLength(0);
    expect(parent.querySelector('.profession-archetype-crest')).toBeNull();
  });

  it('renders a synced but unattuned identity without an archetype crest', () => {
    const parent = document.createElement('div');
    const identity = {
      version: 1 as const,
      synced: true,
      craftSkills: { cooking: 10 },
      activeArchetype: null,
      pairedMajor: null,
      hobbyCraft: null,
      attunedPairs: [],
      switchCount: 0,
      amendsProgress: 0,
      amendsRequired: 5,
      knownRecipes: [],
    };

    renderProfessionIdentityCard(parent, buildProfessionIdentityView(identity));

    expect(parent.querySelector('.profession-identity-card')).not.toBeNull();
    expect(parent.querySelectorAll('.profession-skill-row')).toHaveLength(10);
    expect(parent.querySelector('.profession-archetype-crest')).toBeNull();
    expect(parent.querySelector('.profession-identity-returncost')).toBeNull();
    // The first-tier tutorial renders its REAL localized sentence (cooking 10
    // is tier 0 everywhere, so the hint shows): the source pin alone was
    // satisfiable by the model property access identity.tutorial. The exact
    // sentence, same rationale as the return-cost pin (a substring '25'
    // could match the wrong number).
    expect(parent.querySelector('.profession-identity-tutorial')?.textContent).toBe(
      'First tier: reach skill 25 in a craft. Successful recipes raise that craft without erasing knowledge elsewhere.',
    );
  });

  it('collapses the uniform role/cap chips to one caption on the unattuned card (phase 22)', () => {
    const parent = document.createElement('div');
    renderProfessionIdentityCard(
      parent,
      buildProfessionIdentityView({
        version: 1 as const,
        synced: true,
        craftSkills: { cooking: 10 },
        activeArchetype: null,
        pairedMajor: null,
        hobbyCraft: null,
        attunedPairs: [],
        switchCount: 0,
        amendsProgress: 0,
        amendsRequired: 5,
        knownRecipes: [],
      }),
    );

    // One caption stating the shared pair in the same pill family the rows
    // would have carried, positioned as the list's first item. aria-hidden
    // like the retired header (every row's aria already carries the pair),
    // and role-classed so the family badge recolors reach its pill.
    const captions = parent.querySelectorAll<HTMLElement>('.profession-skill-uniform');
    expect(captions).toHaveLength(1);
    expect(captions[0].getAttribute('aria-hidden')).toBe('true');
    expect(captions[0].classList.contains('role-unattuned')).toBe(true);
    expect(captions[0].querySelector('.profession-skill-uniform-label')?.textContent).toBe(
      'All crafts',
    );
    expect(captions[0].querySelector('.prof-role-badge')?.textContent).toBe('Unattuned');
    expect(captions[0].querySelector('.prof-ceiling')?.textContent).toBe('Rare cap');
    expect(captions[0].parentElement?.classList.contains('profession-skill-list')).toBe(true);
    expect(captions[0].parentElement?.firstElementChild).toBe(captions[0]);
    // The collapsed list opts out of the height cap (one-line rows fit whole)
    // and never scrolls, so it stays OUT of the tab order and unnamed.
    expect(captions[0].parentElement?.classList.contains('uniform-collapsed')).toBe(true);
    expect(captions[0].parentElement?.getAttribute('tabindex')).toBeNull();
    expect(captions[0].parentElement?.getAttribute('aria-label')).toBeNull();

    // The rows drop their chips entirely (craft plus skill only) but keep the
    // name/value anatomy and the complete skillAria sentence, so no reader
    // loses the role/cap facts to the visual collapse.
    const rows = [...parent.querySelectorAll<HTMLElement>('.profession-skill-row')];
    expect(rows).toHaveLength(10);
    expect(parent.querySelectorAll('.profession-skill-row .prof-role-badge')).toHaveLength(0);
    expect(parent.querySelectorAll('.profession-skill-row .prof-ceiling')).toHaveLength(0);
    expect(parent.querySelectorAll('.profession-skill-row .prof-craft-name')).toHaveLength(10);
    expect(parent.querySelectorAll('.profession-skill-row .prof-skill-value')).toHaveLength(10);
    // EVERY collapsed row keeps its complete skillAria sentence, not just
    // the first (the collapse is visual only).
    expect(rows.every((r) => (r.getAttribute('aria-label') ?? '') !== '')).toBe(true);
    expect(rows.every((r) => (r.getAttribute('aria-label') ?? '').includes('Unattuned'))).toBe(
      true,
    );
    expect(rows[0].getAttribute('aria-label')).toContain('Rare cap');
  });

  it('renders combo guidance outside the faded disabled craft button', () => {
    const parent = document.createElement('div');
    const attachTooltip = vi.fn();
    renderCraftingWindow(
      parent,
      {
        recipes: [
          {
            recipeId: 'combo_recipe',
            professionId: 'armorcrafting',
            resultItemId: 'combo_result',
            resultCount: 1,
            reagents: [],
            skillReq: 50,
            difficulty: 'reduced',
            station: null,
            craftable: false,
            commissionEligible: false,
            comboRequirement: {
              craftA: 'armorcrafting',
              craftB: 'weaponcrafting',
              minTier: 2,
              met: false,
              reason: 'not_attuned',
              unmetCrafts: [],
            },
          },
        ],
      },
      {
        hideTooltip: vi.fn(),
        onCraft: vi.fn(),
        onClose: vi.fn(),
        onOpenOrders: vi.fn(),
        itemIcon: vi.fn(() => ''),
        moneyHtml: vi.fn(() => ''),
        itemTooltip: vi.fn(() => ''),
        attachTooltip,
        commissionChecked: () => false,
        onToggleCommission: vi.fn(),
        selectedCraft: () => null as string | null,
        onSelectCraft: vi.fn(),
      },
    );

    const button = parent.querySelector<HTMLButtonElement>('button.vendor-item');
    const note = parent.querySelector<HTMLElement>('.crafting-combo-requirement');
    const sectionIcon = parent.querySelector<HTMLImageElement>('.crafting-section-icon');
    expect(sectionIcon?.getAttribute('src')).toBe('/ui/professions/prof_armorcrafting.webp');
    expect(sectionIcon?.getAttribute('alt')).toBe('');
    const section = parent.querySelector<HTMLElement>('.crafting-section-title');
    expect(section?.getAttribute('role')).toBe('heading');
    expect(section?.getAttribute('aria-level')).toBe('3');
    expect(section?.tabIndex).toBe(-1);
    expect(attachTooltip.mock.calls.some(([target]) => target === section)).toBe(false);
    const recipeTooltip = attachTooltip.mock.calls.find(([target]) => target === button)?.[1] as
      | (() => string)
      | undefined;
    expect(recipeTooltip?.()).toContain('/ui/professions/prof_armorcrafting.webp');
    expect(recipeTooltip?.()).toContain('Armorcrafting');
    expect(button?.disabled).toBe(true);
    // The rendered guidance is the localized copy for the given reason
    // (not_attuned), so a wrong or empty reason string reddens here.
    expect(note?.textContent).toContain('Choose an archetype pair first.');
    expect(button?.contains(note ?? null)).toBe(false);
    expect(note?.parentElement?.classList.contains('crafting-recipe-item')).toBe(true);

    // Legibility on the same row: the skill-req line and the
    // difficulty LABEL render inside the button, and the difficulty is never
    // color-only (the tinted span carries the localized text, and the aria
    // name repeats both).
    const skillLine = button?.querySelector<HTMLElement>('.crafting-skill-line');
    const difficulty = button?.querySelector<HTMLElement>('.crafting-difficulty');
    expect(skillLine?.textContent).toContain('Requires Armorcrafting 50');
    expect(difficulty?.getAttribute('data-difficulty')).toBe('reduced');
    expect(difficulty?.textContent).toBe('Reduced skill gain');
    expect(button?.getAttribute('aria-label')).toContain('Requires Armorcrafting 50');
    expect(button?.getAttribute('aria-label')).toContain('Reduced skill gain');
    // A station-free recipe renders no station badge and no station note.
    expect(button?.querySelector('.crafting-station-badge')).toBeNull();
    expect(parent.querySelector('.crafting-station-requirement')).toBeNull();
  });

  it('renders the station badge and an out-of-range reason outside the disabled button', () => {
    const parent = document.createElement('div');
    renderCraftingWindow(
      parent,
      {
        recipes: [
          {
            recipeId: 'station_recipe',
            professionId: 'engineering',
            resultItemId: 'station_result',
            resultCount: 1,
            reagents: [],
            skillReq: 0,
            difficulty: 'full',
            station: { required: true, type: 'toolworks', inRange: false },
            craftable: false,
            commissionEligible: false,
          },
        ],
      },
      {
        hideTooltip: vi.fn(),
        onCraft: vi.fn(),
        onClose: vi.fn(),
        onOpenOrders: vi.fn(),
        itemIcon: vi.fn(() => ''),
        moneyHtml: vi.fn(() => ''),
        itemTooltip: vi.fn(() => ''),
        attachTooltip: vi.fn(),
        commissionChecked: () => false,
        onToggleCommission: vi.fn(),
        selectedCraft: () => null as string | null,
        onSelectCraft: vi.fn(),
      },
    );

    const button = parent.querySelector<HTMLButtonElement>('button.vendor-item');
    const badge = button?.querySelector<HTMLElement>('.crafting-station-badge');
    const stationNote = parent.querySelector<HTMLElement>('.crafting-station-requirement');
    expect(button?.disabled).toBe(true);
    expect(badge?.textContent).toBe('Station');
    expect(badge?.classList.contains('out-of-range')).toBe(true);
    // Never a bare disabled button: the reason text sits ADJACENT, outside the
    // button's :disabled opacity (the combo-note pattern), and the aria name
    // carries the same sentence for non-visual users. The
    // note now NAMES the station type (stationOutOfRangeNamed + stationName).
    expect(stationNote?.textContent).toBe('Move to the Toolworks to craft this.');
    expect(button?.contains(stationNote ?? null)).toBe(false);
    expect(button?.getAttribute('aria-label')).toContain('Move to the Toolworks to craft this.');
    // Full-gain difficulty still renders its text label (never color-only).
    expect(button?.querySelector('.crafting-difficulty')?.textContent).toBe('Full skill gain');
  });

  it('renders the learn-at-master hint under a hinted craft section only', () => {
    const parent = document.createElement('div');
    renderCraftingWindow(
      parent,
      {
        recipes: [
          {
            recipeId: 'known_weapon',
            professionId: 'weaponcrafting',
            resultItemId: 'known_weapon_result',
            resultCount: 1,
            reagents: [],
            skillReq: 0,
            difficulty: 'full',
            station: null,
            craftable: true,
            commissionEligible: false,
          },
          {
            recipeId: 'known_armor',
            professionId: 'armorcrafting',
            resultItemId: 'known_armor_result',
            resultCount: 1,
            reagents: [],
            skillReq: 0,
            difficulty: 'full',
            station: null,
            craftable: true,
            commissionEligible: false,
          },
        ],
      },
      {
        hideTooltip: vi.fn(),
        onCraft: vi.fn(),
        onClose: vi.fn(),
        onOpenOrders: vi.fn(),
        itemIcon: vi.fn(() => ''),
        moneyHtml: vi.fn(() => ''),
        itemTooltip: vi.fn(() => ''),
        attachTooltip: vi.fn(),
        commissionChecked: () => false,
        onToggleCommission: vi.fn(),
        selectedCraft: () => null as string | null,
        onSelectCraft: vi.fn(),
      },
      undefined,
      // Only weaponcrafting is hinted; armorcrafting is not in the map.
      new Map([
        ['weaponcrafting', { stationType: 'forge' as const, masterNpcId: 'forgemistress_darva' }],
      ]),
    );

    const hints = parent.querySelectorAll<HTMLElement>('.crafting-learn-hint');
    // Exactly one hint, and it names the master (entity i18n), the station, and
    // the craft.
    expect(hints).toHaveLength(1);
    expect(hints[0].textContent).toBe(
      'Forgemistress Darva at the Forge can teach you more Weaponcrafting recipes.',
    );
  });

  it('renders localized visible identity, cap, tutorial, and nudge text', () => {
    expect(painter).toContain("t('hudChrome.crafting.identity.title')");
    expect(painter).toContain('identity.ceiling');
    // Full t()-call literal: the bare substring 'identity.tutorial' was a
    // dead pin, satisfied by the model property access identity.tutorial.
    expect(painter).toContain("t('hudChrome.crafting.identity.tutorial'");
    expect(painter).toContain('identity.nearTier');
    expect(painter).toContain('identity.dormantKnowledge');
  });

  it('provides a labelled region and skill-list accessible text', () => {
    expect(painter).toContain("setAttribute('role', 'region')");
    expect(painter).toContain('role="list"');
  });

  it('makes no forced-reflow read and owns no repeating driver (cold contract)', () => {
    // profession_identity_card.ts escapes tests/hud_perf_budget.test.ts's
    // sweep by NAME (_card.ts does not match the painter file regex), so the
    // cold contract it happens to satisfy is pinned here instead: no layout
    // read, no frame driver, ever.
    const code = painter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    // The full FORCED_REFLOW_READS vocabulary from hud_perf_budget (not a
    // subset: getUiScale pays a getComputedStyle one hop away and is exactly
    // what a card painter might reach for).
    expect(code).not.toMatch(
      /\.scrollTop|\.scrollLeft|\.scrollWidth|\.scrollHeight|\.offsetWidth|\.offsetHeight|\.offsetTop|\.offsetLeft|\.offsetParent|\.clientWidth|\.clientHeight|\.innerText|getBoundingClientRect|getClientRects|getComputedStyle|getUiScale|scrollIntoView/,
    );
    expect(code).not.toMatch(/requestAnimationFrame|requestIdleCallback|setInterval/);
  });

  it('is integrated into the crafting window above recipe sections', () => {
    expect(craftingWindow).toContain('renderProfessionIdentityCard(');
    expect(craftingWindow.indexOf('renderProfessionIdentityCard(')).toBeLessThan(
      craftingWindow.indexOf('const sections = new Map'),
    );
  });

  it('renders the uniform caption through the allCrafts catalog key', () => {
    // Comment-stripped like the no-magic scan below, so a leftover comment
    // naming the key cannot satisfy the pin.
    const code = painter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).toContain("t('hudChrome.crafting.identity.allCrafts')");
    expect(code).toContain("t('hudChrome.crafting.identity.skillListAria')");
  });

  // The card is a cold *_card consumer (not a *_painter.ts), so it escapes the
  // per-painter no-magic sweep in hud_perf_budget; this source scan carries the
  // same contract: colors and sizes live in the stylesheet, never in TS.
  it('carries no literal hex or rgb color in TS (no-magic-values contract)', () => {
    const code = painter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    const rgb = code.match(/\brgba?\s*\(/g) ?? [];
    expect(hex, `hex colors: ${hex.join(', ')}`).toEqual([]);
    expect(rgb, `rgb colors: ${rgb.join(', ')}`).toEqual([]);
  });
});

describe('identity card type floor and numeral pins (phase 22, source pins)', () => {
  // The stylesheet is the authority the painter defers to (the no-magic
  // contract above), so the DESIGN.md floors pin against the CSS source the
  // way tests/mobile_window_layout.test.ts pins the vendor 40px floor.
  const components = readFileSync(
    path.resolve(process.cwd(), 'src/styles/components.css'),
    'utf8',
  ).replace(/\r\n/g, '\n');
  const mobileCss = readFileSync(
    path.resolve(process.cwd(), 'src/styles/hud.mobile.css'),
    'utf8',
  ).replace(/\r\n/g, '\n');

  it('the row family the card reuses carries the 13px name line and the tabular-nums value', () => {
    // .prof-craft-head is the name line (13px, at or above the DESIGN.md
    // 12px authored-body floor); .prof-skill-value is the right-aligned
    // numeral (tabular-nums per the every-player-read-number rule) whose
    // settled family size is 11px, the one non-pill exemption to the floor:
    // pinned exactly so it cannot drift lower with the tests green. The
    // leading newline-and-indent anchors the selector at rule position, so
    // rescoping the family (a #professions-window prefix would strip the
    // card's styling) fails the pin too.
    expect(components).toMatch(/\n {2}\.prof-craft-head \{[^}]*font-size: 13px;/);
    expect(components).toMatch(/\n {2}\.prof-skill-value \{[^}]*font-size: 11px;/);
    expect(components).toMatch(
      /\n {2}\.prof-skill-value \{[^}]*font-variant-numeric: tabular-nums;[^}]*color/,
    );
    expect(components).toMatch(/\n {2}\.prof-skill-value \{[^}]*margin-left: auto;/);
    // The pills stay BORDERED at their family 10px: the border is the
    // condition of the sub-12px chip exemption in acceptance (a). Two
    // separate pins on the same block so a harmless declaration reorder
    // stays green (the mobile-lift idiom below).
    const pillBlock = /\n {2}\.prof-role-badge,\s*\.prof-ceiling \{[^}]*/;
    expect(components).toMatch(new RegExp(`${pillBlock.source}font-size: 10px;`));
    expect(components).toMatch(new RegExp(`${pillBlock.source}border: 1px solid`));
  });

  it('the 10px rows and the 9px uppercase header are gone from the card scope', () => {
    // The defect this phase fixes: the app's only sub-11px data rows and its
    // only sub-10px column header. The selectors must not come back in ANY
    // spelling (bare, compound, grouped), so the pin is a whole-sheet
    // substring ban, valid because neither sheet mentions them at all now.
    expect(components).not.toContain('.profession-skill-header');
    expect(components).not.toContain('.profession-skill-row');
    expect(mobileCss).not.toContain('.profession-skill-header');
    expect(mobileCss).not.toContain('.profession-skill-row');
    // BOTH sheets ban a grid track list on the skill list (the [^{]* arm
    // also catches a grouped selector), so the retired subgrid cannot come
    // back on either arm.
    expect(mobileCss).not.toMatch(/\.profession-skill-list[^{]*\{[^}]*grid-template-columns/);
    expect(components).not.toMatch(/\.profession-skill-list[^{]*\{[^}]*grid-template-columns/);
  });

  it('the card narrative text sits on the 12px floor (summary, tutorial, nudges, caption)', () => {
    expect(components).toMatch(/\.profession-identity-summary \{[^}]*font-size: 12px;/);
    expect(components).toMatch(
      /\.profession-identity-tutorial,\s*\.profession-identity-nudges \{[^}]*font-size: 12px;/,
    );
    expect(components).toMatch(/\.profession-skill-uniform \{[^}]*font-size: 12px;/);
    // Every card paragraph, including the class-less unattuned and syncing
    // narratives and the return-cost line, which otherwise inherited the
    // 16px document default (the QA round's floor completion). :where() so
    // the classed tutorial rule above keeps outranking it for its own p.
    expect(components).toMatch(/:where\(\.profession-identity-card\) p \{[^}]*font-size: 12px;/);
  });

  it('the focusable capped list carries the shared focus-visible ring', () => {
    const base = readFileSync(path.resolve(process.cwd(), 'src/styles/base.css'), 'utf8');
    expect(base).toMatch(/\.profession-skill-list:focus-visible[^{]*\{[^}]*outline: 2px solid/s);
  });

  it('no card-scope rule in either sheet sets a font-size below 12px (the floor as a floor)', () => {
    // The three named pins above are an allowlist; this sweep is the FLOOR:
    // any rule scoped to the card or its skill list, in the desktop sheet or
    // the mobile arm, that sets font-size below 12px fails here, so a future
    // card-scope override cannot quietly re-shrink the rows (the family's
    // own .prof-* rules carry their exemptions in the pin above).
    for (const [sheet, minBlocks] of [
      [components, 14],
      [mobileCss, 2],
    ] as const) {
      const blocks = [...sheet.matchAll(/^\s+([^@{}][^{]*?)\{([^}]*)\}/gms)].filter(
        ([, sel]) => sel.includes('.profession-identity') || sel.includes('.profession-skill-'),
      );
      // Aliveness: the sweep must have FOUND the card-scope blocks each
      // sheet is known to carry (desktop 16, mobile 2 today; the floors sit
      // just under those counts so losing more than a couple of blocks to a
      // partial regex break fails loudly), never silently sweep nothing.
      expect(blocks.length, 'card-scope blocks found by the sweep').toBeGreaterThanOrEqual(
        minBlocks,
      );
      for (const [, sel, body] of blocks) {
        for (const m of body.matchAll(/font-size:\s*([^;]+);/g)) {
          // Every card-scope font-size must be authored px (the DESIGN.md
          // scale): a rem/em/var() size would evade a px-only floor.
          expect(m[1].trim(), `${sel.trim()} font-size unit`).toMatch(/^[0-9.]+px$/);
          expect(
            Number.parseFloat(m[1]),
            `${sel.trim()} sets font-size ${m[1]} (below the 12px floor)`,
          ).toBeGreaterThanOrEqual(12);
        }
      }
    }
  });

  it('caps the skill list instead of starving the recipe pane', () => {
    // The pinned-region contract: the card is pinned above the scrolling
    // .crafting-body, so the LIST scrolls internally past its cap (the
    // mobile card cap is the precedent, kept below). Unconditional, not a
    // compact-height media query: the attuned two-line rows pass 500px and
    // squeeze the pane to its 120px minimum even at 1600x900. The collapsed
    // list opts back out (its one-line rows fit whole; a cap would only add
    // a needless scrollbar). 264px is the LITERAL the phase measured (recipe
    // pane 180px at 1366x768): a retune re-measures and updates this pin.
    // Two separate pins on the capped block so a behavior-identical
    // declaration reorder stays green (the mobile-lift idiom below).
    const cappedList = /\n {2}\.profession-identity-card \.profession-skill-list \{[^}]*/;
    expect(components).toMatch(new RegExp(`${cappedList.source}max-height: 264px;`));
    expect(components).toMatch(new RegExp(`${cappedList.source}overflow-y: auto;`));
    expect(components).toMatch(
      /\.profession-identity-card \.profession-skill-list\.uniform-collapsed \{\s*max-height: none;/,
    );
    // 264px was measured against the shipped TEN-craft ring (the uncapped
    // collapsed list renders about 289px at ten): ring growth re-measures
    // the cap, the collapse-fits rationale, AND the recipe-pane floor, so a
    // new craft reddens here at the cap rather than only at the content pins.
    expect(CRAFT_RING).toHaveLength(10);
    // The mobile card cap is the exact viewport formula, pinned like the
    // desktop literal: a retune re-measures and updates this pin.
    expect(mobileCss).toMatch(
      /body\.mobile-touch \.profession-identity-card \{[^}]*max-height: calc\(var\(--app-vh\) \* 0\.34 \/ var\(--ui-scale, 1\)\);/,
    );
    expect(mobileCss).toMatch(
      /body\.mobile-touch \.profession-identity-card \{[^}]*overflow-y: auto;/,
    );
    // On mobile the CARD is the one scroller, so the desktop list cap lifts:
    // a capped (overflow-y: auto) list is a flex child with a zero automatic
    // minimum, and inside the height-capped column card it shrinks to
    // nothing, hiding every row (caught rendered, phase 22). Three separate
    // pins so a behavior-identical declaration reorder stays green.
    const mobileLift =
      /body\.mobile-touch \.profession-identity-card \.profession-skill-list \{[^}]*/;
    expect(mobileCss).toMatch(new RegExp(`${mobileLift.source}flex: none;`));
    expect(mobileCss).toMatch(new RegExp(`${mobileLift.source}max-height: none;`));
    expect(mobileCss).toMatch(new RegExp(`${mobileLift.source}overflow-y: visible;`));
  });

  it('dormant rows keep a visible mute through the family name rule', () => {
    // The rework deleted the old whole-row opacity dim; the replacement is
    // the family's muted name color. Pin the rule so a family cleanup pass
    // cannot silently drop the only dormant differentiation left.
    expect(components).toMatch(/\.role-dormant \.prof-craft-name \{[^}]*color:/);
  });
});

describe('crafting window pins', () => {
  const deps = () => ({
    hideTooltip: vi.fn(),
    onCraft: vi.fn(),
    onClose: vi.fn(),
    onOpenOrders: vi.fn(),
    itemIcon: vi.fn(() => ''),
    moneyHtml: vi.fn(() => ''),
    itemTooltip: vi.fn(() => ''),
    attachTooltip: vi.fn(),
    commissionChecked: () => false,
    onToggleCommission: vi.fn(),
    selectedCraft: () => null as string | null,
    onSelectCraft: vi.fn(),
  });
  const comboRow = (unmetCrafts: string[]) => ({
    recipes: [
      {
        recipeId: 'combo_recipe',
        professionId: 'armorcrafting',
        resultItemId: 'combo_result',
        resultCount: 1,
        reagents: [],
        skillReq: 50,
        difficulty: 'reduced' as const,
        station: null,
        craftable: false,
        commissionEligible: false,
        comboRequirement: {
          craftA: 'armorcrafting',
          craftB: 'weaponcrafting',
          minTier: 2,
          met: false,
          reason: 'tier_unmet' as const,
          unmetCrafts,
        },
      },
    ],
  });

  it('tier_unmet names the ONE unmet craft and the required tier', () => {
    const parent = document.createElement('div');
    renderCraftingWindow(parent, comboRow(['armorcrafting']), deps());
    const note = parent.querySelector<HTMLElement>('.crafting-combo-requirement');
    // The acceptance criterion: the player can tell WHICH craft to raise from
    // the row alone, not just that "both major crafts" are involved.
    expect(note?.textContent).toContain('Raise Armorcrafting to tier 2.');
    expect(note?.textContent).not.toContain('Weaponcrafting to tier');
    const button = parent.querySelector<HTMLButtonElement>('button.vendor-item');
    expect(button?.getAttribute('aria-label')).toContain('Raise Armorcrafting to tier 2.');
  });

  it('tier_unmet names BOTH crafts in the multi-craft case, list order stable', () => {
    const parent = document.createElement('div');
    renderCraftingWindow(parent, comboRow(['armorcrafting', 'weaponcrafting']), deps());
    const note = parent.querySelector<HTMLElement>('.crafting-combo-requirement');
    expect(note?.textContent).toContain('Raise Armorcrafting, Weaponcrafting to tier 2.');
  });

  it('tier_unmet with an empty unmetCrafts list falls back to the generic copy', () => {
    const parent = document.createElement('div');
    renderCraftingWindow(parent, comboRow([]), deps());
    const note = parent.querySelector<HTMLElement>('.crafting-combo-requirement');
    expect(note?.textContent).toContain('Raise both major crafts to the required tier.');
  });

  it("renders the 'none' difficulty band with its text label", () => {
    const parent = document.createElement('div');
    renderCraftingWindow(
      parent,
      {
        recipes: [
          {
            recipeId: 'gray_recipe',
            professionId: 'cooking',
            resultItemId: 'gray_result',
            resultCount: 1,
            reagents: [],
            skillReq: 25,
            difficulty: 'none' as const,
            station: null,
            craftable: true,
            commissionEligible: false,
          },
        ],
      },
      deps(),
    );
    const difficulty = parent.querySelector<HTMLElement>('.crafting-difficulty');
    expect(difficulty?.getAttribute('data-difficulty')).toBe('none');
    expect(difficulty?.textContent).toBe('No skill gain');
  });

  it('maps the four difficulty states to the classic tints with their labels', () => {
    // The classic four-color read: orange (QUALITY_COLOR.legendary), the
    // house gold yellow (--gold in styles/tokens.css, the masterwork seal
    // idiom), green (QUALITY_COLOR.uncommon), gray (QUALITY_COLOR.poor).
    // The tint moved off the inline style onto the --color-craft-* tokens
    // (DESIGN.md token discipline): the painter stamps data-difficulty, the
    // stylesheet colors it, and this pin holds the whole chain: attribute,
    // label, CSS rule, and token value.
    const rows = [
      { difficulty: 'full' as const, token: '--color-craft-full', label: 'Full skill gain' },
      {
        difficulty: 'reduced' as const,
        token: '--color-craft-reduced',
        label: 'Reduced skill gain',
      },
      {
        difficulty: 'minimal' as const,
        token: '--color-craft-minimal',
        label: 'Minimal skill gain',
      },
      { difficulty: 'none' as const, token: '--color-craft-none', label: 'No skill gain' },
    ];
    const componentsCss = readFileSync(
      path.resolve(process.cwd(), 'src/styles/components.css'),
      'utf8',
    );
    for (const { difficulty, token, label } of rows) {
      const parent = document.createElement('div');
      renderCraftingWindow(
        parent,
        {
          recipes: [
            {
              recipeId: `tint_${difficulty}`,
              professionId: 'cooking',
              resultItemId: 'tint_result',
              resultCount: 1,
              reagents: [],
              skillReq: 25,
              difficulty,
              station: null,
              craftable: true,
              commissionEligible: false,
            },
          ],
        },
        deps(),
      );
      const el = parent.querySelector<HTMLElement>('.crafting-difficulty');
      expect(el?.getAttribute('data-difficulty'), difficulty).toBe(difficulty);
      // No inline color: the tint flows from the stylesheet rule keyed on the
      // data attribute, so a theme retune is a one-file change.
      expect(el?.getAttribute('style'), difficulty).toBeNull();
      expect(componentsCss).toContain(
        `.crafting-difficulty[data-difficulty="${difficulty}"] {\n    color: var(${token});\n  }`,
      );
      // Never color-only: the localized label rides inside the tinted span.
      expect(el?.textContent, difficulty).toBe(label);
    }
    // The minimal state binds the NEW catalog key, full-literal for the
    // key scanner, alongside its three siblings.
    expect(craftingWindow).toContain("minimal: 'hudChrome.crafting.difficultyMinimal'");
  });

  const attunedIdentity = () =>
    buildProfessionIdentityView({
      version: 1 as const,
      synced: true,
      craftSkills: { armorcrafting: 49, weaponcrafting: 25, cooking: 30 },
      activeArchetype: 'armorcrafting',
      pairedMajor: 'weaponcrafting',
      hobbyCraft: 'leatherworking',
      attunedPairs: ['weaponcrafting+armorcrafting'],
      switchCount: 1,
      amendsProgress: 0,
      amendsRequired: 8,
      knownRecipes: [],
    });

  it('carries the capped skill list scroll offset and focus across a rebuild', () => {
    // The identity list is the window's third scroll region and rebuilds
    // with the rest; without the carry every repaint (a craft lands three)
    // yanks a scrolled reader to row one and drops keyboard focus to body.
    const el = document.createElement('div');
    document.body.appendChild(el);
    try {
      renderCraftingWindow(el, { recipes: [] }, deps(), attunedIdentity());
      const first = el.querySelector<HTMLElement>('.profession-skill-list');
      const firstCard = el.querySelector<HTMLElement>('.profession-identity-card');
      expect(first).not.toBeNull();
      if (!first || !firstCard) return;
      first.scrollTop = 123;
      // The CARD is the mobile scroller (hud.mobile.css lifts the list cap
      // there), so its offset must carry too.
      firstCard.scrollTop = 45;
      first.focus();
      expect(document.activeElement).toBe(first);
      renderCraftingWindow(el, { recipes: [] }, deps(), attunedIdentity());
      const second = el.querySelector<HTMLElement>('.profession-skill-list');
      const secondCard = el.querySelector<HTMLElement>('.profession-identity-card');
      expect(second).not.toBeNull();
      expect(second).not.toBe(first);
      expect(secondCard).not.toBe(firstCard);
      expect(second?.scrollTop).toBe(123);
      expect(secondCard?.scrollTop).toBe(45);
      expect(document.activeElement).toBe(second);
    } finally {
      el.remove();
    }
  });

  it('keeps the identity card a SIBLING of the scrolling body (the pinned-region contract)', () => {
    // The whole 264px-cap rationale assumes the card is pinned ABOVE
    // .crafting-body, never inside it: a future height refactor that moves
    // the card into the scroll pane would keep every other assertion green
    // while silently voiding the cap's purpose.
    const el = document.createElement('div');
    renderCraftingWindow(el, { recipes: [] }, deps(), attunedIdentity());
    const card = el.querySelector('.profession-identity-card');
    const body = el.querySelector('.crafting-body');
    expect(card).not.toBeNull();
    expect(body).not.toBeNull();
    expect(card?.parentElement).toBe(el);
    expect(body?.contains(card as Node)).toBe(false);
    expect(
      card && body ? card.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING : 0,
    ).toBeTruthy();
  });

  it('an IN-RANGE station row keeps the badge, drops the dashed style and the note', () => {
    const parent = document.createElement('div');
    renderCraftingWindow(
      parent,
      {
        recipes: [
          {
            recipeId: 'station_recipe',
            professionId: 'armorcrafting',
            resultItemId: 'station_result',
            resultCount: 1,
            reagents: [],
            skillReq: 25,
            difficulty: 'full' as const,
            station: { required: true, type: 'forge' as const, inRange: true },
            craftable: true,
            commissionEligible: false,
          },
        ],
      },
      deps(),
    );
    const badge = parent.querySelector<HTMLElement>('.crafting-station-badge');
    expect(badge?.textContent).toBe('Station');
    expect(badge?.classList.contains('out-of-range')).toBe(false);
    expect(parent.querySelector('.crafting-station-requirement')).toBeNull();
  });

  it('the hover tooltip repeats the skill line, difficulty, and station sentence', () => {
    const parent = document.createElement('div');
    const d = deps();
    renderCraftingWindow(
      parent,
      {
        recipes: [
          {
            recipeId: 'station_recipe',
            professionId: 'armorcrafting',
            resultItemId: 'station_result',
            resultCount: 1,
            reagents: [],
            skillReq: 25,
            difficulty: 'full' as const,
            station: { required: true, type: 'forge' as const, inRange: false },
            craftable: false,
            commissionEligible: false,
          },
        ],
      },
      d,
    );
    const build = d.attachTooltip.mock.calls.find(([target]) =>
      (target as HTMLElement).matches('button.vendor-item'),
    )?.[1] as () => string;
    const html = build();
    expect(html).toContain('Requires Armorcrafting 25');
    expect(html).toContain('Full skill gain');
    expect(html).toContain('Move to the Forge to craft this.');
  });
});

describe('crafting difficulty token lockstep (retuned to tokens)', () => {
  it('the --color-craft-* tokens carry the classic palette and the house gold', () => {
    // The successor to the retired GOLD_ACCENT_COLOR TS twin: the difficulty
    // tints live as semantic tokens in tokens.css. full/minimal/none must
    // stay in lockstep with the QUALITY_COLOR classic-fidelity anchors
    // (legendary/uncommon/poor), reduced must reference the house gold BY
    // NAME (var(--gold), the masterwork seal idiom), and --gold itself stays
    // the shipped #ffd100. A retheme that moves any side alone reds here.
    const tokens = readFileSync(path.resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
    expect(tokens).toContain(`--color-craft-full: ${QUALITY_COLOR.legendary};`);
    expect(tokens).toContain('--color-craft-reduced: var(--gold);');
    expect(tokens).toContain(`--color-craft-minimal: ${QUALITY_COLOR.uncommon};`);
    expect(tokens).toContain(`--color-craft-none: ${QUALITY_COLOR.poor};`);
    const match = tokens.match(/--gold:\s*(#[0-9a-fA-F]{6})\s*;/);
    expect(match, 'tokens.css should declare --gold as a 6-digit hex').not.toBeNull();
    expect(match?.[1]).toBe('#ffd100');
  });
});

describe('crafting window station-range repaint liveness (source pins)', () => {
  const hud = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');

  it('the slow band repaints an OPEN window only when the live in-range set changes', () => {
    // Walking into/out of a station's range (or the own mobile station
    // appearing/expiring) must refresh the cold painter's rows (out-of-range
    // note, disabled state) without a per-frame repaint: the slow band
    // compares the live set's signature against the last painted one.
    expect(hud).toContain("$('#crafting-window').style.display === 'flex' &&");
    expect(hud).toMatch(
      /stationTypesSignature\(\s*inRangeStationTypes\(\s*sim\.stationPlacements,\s*sim\.player\.pos,\s*sim\.activeMobileStationCraft,?\s*\),\s*\) !==\s*this\.lastCraftingStationSig/,
    );
  });

  it('renderCrafting records the painted signature and feeds the same set to the view', () => {
    expect(hud).toMatch(
      /const inRangeStations = inRangeStationTypes\(\s*this\.sim\.stationPlacements,\s*this\.sim\.player\.pos,\s*this\.sim\.activeMobileStationCraft,\s*\);/,
    );
    expect(hud).toContain('this.lastCraftingStationSig = stationTypesSignature(inRangeStations);');
  });

  it('a language switch rebuilds an OPEN crafting window (the relocalize arm)', () => {
    // Every crafting repaint memo is text-independent (station set, reagent
    // sig, the profession surface sig), so without an explicit arm in
    // refreshLocalizedDynamicUi an open window keeps the previous locale
    // indefinitely; its sibling professions window already has one.
    const relocalize = hud.slice(
      hud.indexOf('private refreshLocalizedDynamicUi'),
      hud.indexOf('\n  }', hud.indexOf('private refreshLocalizedDynamicUi')),
    );
    expect(relocalize).toContain(
      "if ($('#crafting-window').style.display === 'flex') this.renderCrafting();",
    );
  });
});

describe('craftResult deny toast names the station (source pins)', () => {
  const hud = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');

  it('station_required resolves the type from recipe content (no station field rides the event)', () => {
    expect(hud).toMatch(
      /ev\.reason === 'station_required' \? recipeById\(ev\.recipeId\)\?\.stationType : undefined/,
    );
  });

  it('a resolved type renders the NAMED toast via stationRequired + stationNameText', () => {
    expect(hud).toContain("t('hudChrome.crafting.stationRequired', {");
    expect(hud).toContain('station: stationNameText(deniedStationType),');
  });

  it('no_bag_space pairs with the noBagSpace toast, insufficientMaterials as the chain tail', () => {
    // The reason chain reads no_bag_space ? noBagSpace : insufficientMaterials,
    // so pin the pairing (a key swap in the ternary tail must fail here) rather
    // than a bare presence check that two swapped keys could still satisfy.
    expect(hud).toMatch(
      /ev\.reason === 'no_bag_space'\s*\?\s*'hudChrome\.crafting\.noBagSpace'\s*:\s*'hudChrome\.crafting\.insufficientMaterials'/,
    );
  });
});
