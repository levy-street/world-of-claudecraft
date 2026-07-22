// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderCraftingWindow } from '../src/ui/crafting_window';
import { GOLD_ACCENT_COLOR } from '../src/ui/icons';
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
    // The title line renders the PAIR archetype name (weaponcrafting +
    // armorcrafting is the Smith pair); the skill rows render craft names.
    expect(card?.textContent).toContain('Smith');
    expect(card?.textContent).toContain('Armorcrafting');
    // Phase 14: the attuned card surfaces the make-amends return cost
    // (requiredAmendsProgress(1) = 8, the switch-cost-at-rest figure).
    const returnCost = card?.querySelector('.profession-identity-returncost');
    expect(returnCost?.textContent).toContain('make-amends');
    expect(returnCost?.textContent).toContain('8');
    // One visual column-header row over the skill list, hidden from the
    // accessibility tree (each row reads as the full skillAria sentence).
    const header = card?.querySelectorAll<HTMLElement>('.profession-skill-header');
    expect(header).toHaveLength(1);
    expect(header?.[0].getAttribute('aria-hidden')).toBe('true');
    const headerLabels = [...(header?.[0].querySelectorAll('span') ?? [])].map(
      (s) => s.textContent,
    );
    expect(headerLabels).toEqual(['Craft', 'Skill', 'Role', 'Cap']);

    parent.replaceChildren();
    renderProfessionIdentityCard(
      parent,
      buildProfessionIdentityView({ ...identity, synced: false }),
    );
    expect(parent.textContent).toContain('Waiting for your crafting identity');
    // The syncing card has no skill rows, so no floating header row either.
    expect(parent.querySelectorAll('.profession-skill-header')).toHaveLength(0);
    // No return-cost line while syncing or unattuned (only shown once attuned).
    expect(parent.querySelectorAll('.profession-identity-returncost')).toHaveLength(0);
  });

  it('renders combo guidance outside the faded disabled craft button', () => {
    const parent = document.createElement('div');
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
        itemIcon: vi.fn(() => ''),
        moneyHtml: vi.fn(() => ''),
        itemTooltip: vi.fn(() => ''),
        attachTooltip: vi.fn(),
      },
    );

    const button = parent.querySelector<HTMLButtonElement>('button.vendor-item');
    const note = parent.querySelector<HTMLElement>('.crafting-combo-requirement');
    expect(button?.disabled).toBe(true);
    // The rendered guidance is the localized copy for the given reason
    // (not_attuned), so a wrong or empty reason string reddens here.
    expect(note?.textContent).toContain('Choose an archetype pair first.');
    expect(button?.contains(note ?? null)).toBe(false);
    expect(note?.parentElement?.classList.contains('crafting-recipe-item')).toBe(true);

    // Phase 6 legibility on the same row: the skill-req line and the
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
          },
        ],
      },
      {
        hideTooltip: vi.fn(),
        onCraft: vi.fn(),
        onClose: vi.fn(),
        itemIcon: vi.fn(() => ''),
        moneyHtml: vi.fn(() => ''),
        itemTooltip: vi.fn(() => ''),
        attachTooltip: vi.fn(),
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
    // carries the same sentence for non-visual users. Phase 8 re-pin: the
    // note now NAMES the station type (stationOutOfRangeNamed + stationName).
    expect(stationNote?.textContent).toBe('Move to the Toolworks to craft this.');
    expect(button?.contains(stationNote ?? null)).toBe(false);
    expect(button?.getAttribute('aria-label')).toContain('Move to the Toolworks to craft this.');
    // Full-gain difficulty still renders its text label (never color-only).
    expect(button?.querySelector('.crafting-difficulty')?.textContent).toBe('Full skill gain');
  });

  it('renders the Phase 14 learn-at-master hint under a hinted craft section only', () => {
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
          },
        ],
      },
      {
        hideTooltip: vi.fn(),
        onCraft: vi.fn(),
        onClose: vi.fn(),
        itemIcon: vi.fn(() => ''),
        moneyHtml: vi.fn(() => ''),
        itemTooltip: vi.fn(() => ''),
        attachTooltip: vi.fn(),
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
    expect(painter).toContain('identity.tutorial');
    expect(painter).toContain('identity.nearTier');
    expect(painter).toContain('identity.dormantKnowledge');
  });

  it('provides a labelled region and skill-list accessible text', () => {
    expect(painter).toContain("setAttribute('role', 'region')");
    expect(painter).toContain('aria-label');
    expect(painter).toContain('role="list"');
  });

  it('is integrated into the crafting window above recipe sections', () => {
    expect(craftingWindow).toContain('renderProfessionIdentityCard(');
    expect(craftingWindow.indexOf('renderProfessionIdentityCard(')).toBeLessThan(
      craftingWindow.indexOf('const sections = new Map'),
    );
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

describe('crafting window Phase 6 QA pins', () => {
  const deps = () => ({
    hideTooltip: vi.fn(),
    onCraft: vi.fn(),
    onClose: vi.fn(),
    itemIcon: vi.fn(() => ''),
    moneyHtml: vi.fn(() => ''),
    itemTooltip: vi.fn(() => ''),
    attachTooltip: vi.fn(),
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
          },
        ],
      },
      deps(),
    );
    const difficulty = parent.querySelector<HTMLElement>('.crafting-difficulty');
    expect(difficulty?.getAttribute('data-difficulty')).toBe('none');
    expect(difficulty?.textContent).toBe('No skill gain');
  });

  it('maps the four difficulty states to the classic tints with their labels (Phase 12c)', () => {
    // The classic four-color read: orange (QUALITY_COLOR.legendary), the
    // house gold yellow (--gold in styles/tokens.css, the masterwork seal
    // idiom), green (QUALITY_COLOR.uncommon), gray (QUALITY_COLOR.poor).
    const rows = [
      { difficulty: 'full' as const, tint: '#ff8000', label: 'Full skill gain' },
      { difficulty: 'reduced' as const, tint: '#ffd100', label: 'Reduced skill gain' },
      { difficulty: 'minimal' as const, tint: '#1eff00', label: 'Minimal skill gain' },
      { difficulty: 'none' as const, tint: '#9d9d9d', label: 'No skill gain' },
    ];
    for (const { difficulty, tint, label } of rows) {
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
            },
          ],
        },
        deps(),
      );
      const el = parent.querySelector<HTMLElement>('.crafting-difficulty');
      expect(el?.getAttribute('data-difficulty'), difficulty).toBe(difficulty);
      expect(el?.getAttribute('style'), difficulty).toContain(tint);
      // Never color-only: the localized label rides inside the tinted span.
      expect(el?.textContent, difficulty).toBe(label);
    }
    // The minimal state binds the NEW catalog key, full-literal for the
    // key scanner, alongside its three siblings.
    expect(craftingWindow).toContain("minimal: 'hudChrome.crafting.difficultyMinimal'");
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
          },
        ],
      },
      d,
    );
    const build = d.attachTooltip.mock.calls[0]?.[1] as () => string;
    const html = build();
    expect(html).toContain('Requires Armorcrafting 25');
    expect(html).toContain('Full skill gain');
    expect(html).toContain('Move to the Forge to craft this.');
  });
});

describe('GOLD_ACCENT_COLOR lockstep (Phase 12c QA)', () => {
  it('the TS twin, the CSS --gold token, and the literal agree', () => {
    // icons.ts GOLD_ACCENT_COLOR exists because inline-styling painters cannot
    // read the CSS custom property; the comment promises lockstep with --gold
    // in src/styles/tokens.css. This pin is the promise's teeth: a retheme
    // that moves either side without the other reds here. The literal arm
    // keeps the pair from drifting together unnoticed (the reduced-difficulty
    // tint pin above expects the same hex).
    const tokens = readFileSync(path.resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
    const match = tokens.match(/--gold:\s*(#[0-9a-fA-F]{6})\s*;/);
    expect(match, 'tokens.css should declare --gold as a 6-digit hex').not.toBeNull();
    expect(match?.[1]).toBe(GOLD_ACCENT_COLOR);
    expect(GOLD_ACCENT_COLOR).toBe('#ffd100');
  });
});

describe('crafting window station-range repaint liveness (source pins)', () => {
  const hud = readFileSync(path.resolve(process.cwd(), 'src/ui/hud.ts'), 'utf8');

  it('the slow band repaints an OPEN window only when the live in-range set changes', () => {
    // Walking into/out of a station's range (or the own mobile station
    // appearing/expiring) must refresh the cold painter's rows (out-of-range
    // note, disabled state) without a per-frame repaint: the slow band
    // compares the live set's signature against the last painted one.
    expect(hud).toContain("$('#crafting-window').style.display === 'block' &&");
    expect(hud).toMatch(
      /stationTypesSignature\(inRangeStationTypes\(sim\.player\.pos, sim\.activeMobileStationCraft\)\) !==\s*this\.lastCraftingStationSig/,
    );
  });

  it('renderCrafting records the painted signature and feeds the same set to the view', () => {
    expect(hud).toMatch(
      /const inRangeStations = inRangeStationTypes\(\s*this\.sim\.player\.pos,\s*this\.sim\.activeMobileStationCraft,\s*\);/,
    );
    expect(hud).toContain('this.lastCraftingStationSig = stationTypesSignature(inRangeStations);');
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
});
