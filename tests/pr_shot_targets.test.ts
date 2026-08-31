// Unit test for the PR-screenshot diff classifier. classifyDiff is the whole "shoot only
// visual changes, and only the sections they touch" policy, kept pure so it needs no
// browser. The .mjs script has no TS/browser imports at module load, so vitest can import
// it directly.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyDiff,
  diffChangedPaths,
  resolveMobileViewport,
  resolveTargets,
  seedLowGraphicsPreset,
  // The directive sits HERE, not above the statement: it applies to the next
  // LINE, and a wrapped import reports its untyped-module error on the closing
  // `from` line. Above the `import` keyword it is simply unused, which tsc
  // reports as an error of its own.
  // @ts-expect-error - plain Node ESM script, no types
} from '../scripts/pr_shot_targets.mjs';
import { ABILITIES } from '../src/sim/data';

describe('classifyDiff', () => {
  it('clears the intentional prior-page entry probe before every isolated screenshot boot', () => {
    const script = readFileSync(join(__dirname, '../scripts/pr_screenshots.mjs'), 'utf8');
    expect(script).toContain("const ENTRY_PROBE_KEY = 'woc_entry_probe';");
    expect(script).toContain('async function clearIntentionalPageCloseProbe(page)');
    expect(script.match(/await clearIntentionalPageCloseProbe\((?:page|mobile)\);/g)).toHaveLength(
      4,
    );
    expect(script).toContain('localStorage.removeItem(key)');
    expect(script).toContain("waitUntil: variant.landing ? 'domcontentloaded' : 'networkidle0'");

    const sliceBetween = (start: string, end: string, from = 0) => {
      const startIndex = script.indexOf(start, from);
      const endIndex = script.indexOf(end, startIndex + start.length);
      expect(startIndex).toBeGreaterThanOrEqual(0);
      expect(endIndex).toBeGreaterThan(startIndex);
      return script.slice(startIndex, endIndex);
    };
    const expectClearBeforeLoad = (
      block: string,
      pageName: 'page' | 'mobile',
      firstLoad: string,
    ) => {
      const createdAt = block.indexOf(`await browser.newPage()`);
      const clearedAt = block.indexOf(`await clearIntentionalPageCloseProbe(${pageName});`);
      const loadedAt = block.indexOf(firstLoad);
      expect(createdAt).toBeGreaterThanOrEqual(0);
      expect(clearedAt).toBeGreaterThan(createdAt);
      expect(loadedAt).toBeGreaterThan(clearedAt);
    };

    const specificStart = script.indexOf('async function shootSpecific');
    const standalone = sliceBetween('if (standalone) {', '} else if (!page) {', specificStart);
    const shared = sliceBetween(
      '} else if (!page) {',
      'const region = await t.capture',
      specificStart,
    );
    const genericStart = script.indexOf('async function shootGenericHud');
    const desktop = sliceBetween(
      "if (frames.includes('hud-desktop')) {",
      "if (frames.includes('hud-mobile')) {",
      genericStart,
    );
    const mobile = sliceBetween(
      "if (frames.includes('hud-mobile')) {",
      '\n}\n\ntry {',
      genericStart,
    );

    expectClearBeforeLoad(standalone, 'page', 'await variant.beforeLoad?.(page);');
    expectClearBeforeLoad(shared, 'page', 'await page.goto(');
    expectClearBeforeLoad(desktop, 'page', 'await page.goto(');
    expectClearBeforeLoad(mobile, 'mobile', 'await mobile.goto(');
  });

  it('treats a backend/data-only diff as non-visual (captures nothing)', () => {
    const plan = classifyDiff(['server/game.ts', 'src/sim/spirit.ts', 'server/db.ts']);
    expect(plan.isVisual).toBe(false);
    expect(plan.specific).toHaveLength(0);
    expect(plan.generic).toHaveLength(0);
  });

  it('maps a bags change to the inventory window target', () => {
    const plan = classifyDiff(['src/ui/bags.ts']);
    expect(plan.isVisual).toBe(true);
    expect(plan.specific.map((t: { key: string }) => t.key)).toContain('inventory');
    // A specific window was found, so no generic HUD fallback.
    expect(plan.generic).toHaveLength(0);
  });

  it('maps the Steam wishlist owner to current web and borderless landing evidence', () => {
    const plan = classifyDiff(['src/ui/steam_wishlist.ts']);
    expect(plan.isVisual).toBe(true);
    expect(plan.specific.map((target: { key: string }) => target.key)).toContain('steam-wishlist');
    const target = plan.specific.find(
      (candidate: { key: string }) => candidate.key === 'steam-wishlist',
    );
    expect(target?.variants).toEqual([
      { key: 'homepage-header-web', landing: true, beforeLoad: expect.any(Function) },
      {
        key: 'homepage-header-borderless-1366',
        landing: true,
        beforeLoad: expect.any(Function),
        borderless: true,
      },
      {
        key: 'homepage-footer-web',
        landing: true,
        beforeLoad: expect.any(Function),
        footer: true,
      },
      {
        key: 'desktop-community-tray',
        beforeLoad: expect.any(Function),
        communityTray: true,
        charClass: 'warrior',
        charName: 'Thorgar',
      },
      {
        key: 'mobile-more-tray',
        landing: true,
        mobile: true,
        beforeLoad: expect.any(Function),
        moreTray: true,
      },
    ]);
    expect(target?.variants[1].beforeLoad.toString()).toContain(
      "localStorage.setItem('locale', 'de_DE')",
    );
    expect(plan.generic).toHaveLength(0);
  });

  it('maps an options_view change to the unlock, graphics dial, interface tab, and confirm-vendor-sell targets, in order', () => {
    // All four targets key on 'ui/options_view'; registry order is the
    // capture order: interface-unlock leads, then the graphics dial, then
    // interface tabs, then the confirm-vendor-sell toggle row (the last one
    // added). An ordering or selector regression here silently drops or
    // duplicates the options-panel evidence.
    const plan = classifyDiff(['src/ui/options_view.ts']);
    expect(plan.isVisual).toBe(true);
    expect(plan.specific.map((t: { key: string }) => t.key)).toEqual([
      'interface-unlock-option',
      'graphics-options-shadow-dial',
      'interface-options-tabs',
      'interface-options-confirm-vendor-sell',
    ]);
    expect(plan.generic).toHaveLength(0);
  });

  it('maps controller option changes to remapped desktop and mobile evidence', () => {
    const plan = classifyDiff(['src/game/gamepad_bindings.ts']);
    expect(plan.specific.map((t: { key: string }) => t.key)).toEqual([
      'controller-options-button-layout',
    ]);
    expect(plan.specific[0].variants.map((v: { key: string }) => v.key)).toEqual([
      'desktop',
      'mobile',
    ]);
    const captureSource = plan.specific[0].capture.toString();
    expect(captureSource).toContain('[aria-label="Cross"]');
    expect(captureSource).toContain('buttons[1]?.click()');
    expect(captureSource).toContain('#tutorial-greeting');
  });

  it('maps the player tooltip view to its focused hover target', () => {
    const plan = classifyDiff(['src/ui/player_tooltip_view.ts']);
    expect(plan.isVisual).toBe(true);
    expect(plan.specific.map((t: { key: string }) => t.key)).toEqual(['player-tooltip']);
  });

  it('captures offensive and healer target auras on desktop', () => {
    const plan = classifyDiff(['src/ui/target_auras_window.ts']);
    expect(plan.specific.map((target: { key: string }) => target.key)).toEqual(['target-auras']);
    expect(plan.specific[0].variants).toEqual([
      {
        key: 'lunar-tempest-desktop',
        charClass: 'druid',
        charName: 'Morphalo',
        abilityId: 'moonfire',
        friendly: false,
      },
      {
        key: 'second-bloom-desktop',
        charClass: 'druid',
        charName: 'Morphalo',
        abilityId: 'regrowth',
        friendly: true,
      },
    ]);
    const captureSource = plan.specific[0].capture.toString();
    expect(captureSource).not.toMatch(/sim\.castAbility\s*\(/);
    expect(captureSource).toContain('.action-btn[data-hotbar-slot="1"]');
    expect(captureSource).toContain('button.click()');
    expect(captureSource).toContain("PR_SHOTS_ALLOW_MISSING_TARGET_AURAS === '1'");
    expect(captureSource).toContain("throw new Error('target aura window is unavailable')");
    expect(captureSource.match(/#loading-screen/g)).toHaveLength(3);
    expect(captureSource).toContain("document.body.classList.contains('game-active')");
  });

  it('captures the held CC bands for any ability-vfx subsystem change', () => {
    const plan = classifyDiff(['src/render/ability_vfx/fx.ts']);
    expect(plan.isVisual).toBe(true);
    expect(plan.specific.map((t: { key: string }) => t.key)).toContain('cc-bands');
    // Every module the bands actually ship in resolves the target, the core
    // included (its `when` prefix must not silently cover only the directory).
    for (const path of [
      'src/render/ability_vfx_core.ts',
      'src/render/ability_vfx/painter.ts',
      'src/render/ability_vfx/sequencer.ts',
    ]) {
      expect(classifyDiff([path]).specific.map((t: { key: string }) => t.key)).toContain(
        'cc-bands',
      );
    }
    const target = plan.specific.find((t: { key: string }) => t.key === 'cc-bands');
    // One variant per band type: a shot set covering only one of the three
    // would read as complete evidence for a change that ships all three.
    expect(target.variants).toEqual([
      {
        key: 'sundering-gavel-desktop',
        charClass: 'paladin',
        charName: 'Aurelius',
        abilityId: 'hammer_of_justice',
        level: 16,
        auraKind: 'stun',
        settleMs: 1900,
      },
      {
        key: 'icebind-desktop',
        charClass: 'mage',
        charName: 'Frosthollow',
        abilityId: 'frost_nova',
        level: 5,
        auraKind: 'root',
        offsetAngle: 1,
        distance: 5.5,
        settleMs: 1900,
      },
      {
        key: 'harrow-desktop',
        charClass: 'warlock',
        charName: 'Vexmoor',
        abilityId: 'fear',
        level: 14,
        auraKind: 'incapacitate',
        auraId: 'fear_incap',
        pollMs: 150,
        settleMs: 0,
      },
    ]);
    // The control must come from the real action-bar click, never an injected
    // aura, and the poll must key off the aura KIND (plus the shared fear id,
    // since 'incapacitate' alone does not mean fear), the same read the bands
    // themselves use.
    const captureSource = target.capture.toString();
    expect(captureSource).not.toMatch(/sim\.castAbility\s*\(/);
    expect(captureSource).not.toMatch(/auras\.push/);
    expect(captureSource).toContain('.action-btn[data-hotbar-slot="1"]');
    expect(captureSource).toContain('button.click()');
    expect(captureSource).toContain('a.kind === shot.auraKind');
    expect(captureSource).toContain('a.id === shot.auraId');
    expect(captureSource).toContain("document.body.classList.contains('game-active')");
  });

  it('stages every CC-band variant at an ability its own class really learns', () => {
    // A variant staged on the wrong class or below the learn level fails only
    // at capture time, minutes into a browser run, and the failure reads as a
    // flake ("aura never applied") rather than as bad target data.
    const target = classifyDiff(['src/render/ability_vfx/fx.ts']).specific.find(
      (t: { key: string }) => t.key === 'cc-bands',
    );
    for (const variant of target.variants) {
      const ability = ABILITIES[variant.abilityId];
      expect(ability, `${variant.key}: unknown ability ${variant.abilityId}`).toBeDefined();
      expect(ability.class, `${variant.key}: wrong class for ${variant.abilityId}`).toBe(
        variant.charClass,
      );
      expect(variant.level, `${variant.key}: staged below the learn level`).toBeGreaterThanOrEqual(
        ability.learnLevel,
      );
    }
  });

  it('captures the market overview, browse collapse, sell price ref, collect ledger, buy confirmation, and expanded armor filters for market window changes', () => {
    const plan = classifyDiff(['src/ui/market_window.ts']);
    expect(plan.isVisual).toBe(true);
    expect(plan.specific.map((t: { key: string }) => t.key)).toEqual([
      'market-window',
      'market-collapse-toggle',
      'market-sell-price-ref',
      'market-collect-ledger',
      'market-buy-confirm',
      'market-armor-filters',
    ]);
    // Keyed, not indexed: this asserts the ARMOR FILTERS target's variants, and a
    // new market target landing ahead of it must not silently move the assertion
    // onto a different target.
    const armor = plan.specific.find((t: { key: string }) => t.key === 'market-armor-filters');
    expect(armor?.variants).toEqual([{ key: 'desktop' }, { key: 'mobile', mobile: true }]);
  });

  it('captures the buy confirmation for its own pure core too, not just the painter', () => {
    // The prompt's terms and its confirm-time recheck live in the core, so a change
    // there alters what the prompt SAYS with the painter untouched.
    const keys = classifyDiff(['src/ui/market_buy_confirm_core.ts']).specific.map(
      (target: { key: string }) => target.key,
    );
    expect(keys).toEqual(['market-buy-confirm']);
  });

  it('captures expanded armor filters for every market-specific UI module', () => {
    for (const path of [
      'src/ui/market_window.ts',
      'src/ui/market_view.ts',
      'src/ui/market_filters.ts',
    ]) {
      const keys = classifyDiff([path]).specific.map((target: { key: string }) => target.key);
      expect(keys).toContain('market-armor-filters');
    }
  });

  it('maps the tank cooldown regression suite to its focused visual target', () => {
    const plan = classifyDiff(['tests/tank_defensive_cds.test.ts']);
    expect(plan.isVisual).toBe(true);
    expect(plan.specific.map((t: { key: string }) => t.key)).toEqual(['tank-defensive-cds']);
    // paladin-desktop, druid-desktop, paladin-mobile, paladin-retribution-desktop:
    // the target widened past the tank when Dawnreaver grew Debt of Light.
    expect(plan.specific[0].variants).toHaveLength(4);
  });

  it('maps an ability-copy change to the tooltip target, per owning module', () => {
    // An ability's player-facing surface is its spellbook row and hovered
    // tooltip; nothing else in the registry shoots that. Pin the routing per
    // module so a when-list trim silently stops capturing the copy.
    for (const file of [
      'src/ui/hud/action_bar/ability_requirement_keys.ts',
      'src/sim/incapacitate_dr.ts',
      'src/sim/combat/stealth_focus.ts',
    ]) {
      const plan = classifyDiff([file]);
      expect(
        plan.specific.map((t: { key: string }) => t.key),
        file,
      ).toContain('ability-tooltip');
    }
    const target = resolveTargets(['src/sim/incapacitate_dr.ts']).find(
      (candidate: { key: string }) => candidate.key === 'ability-tooltip',
    );
    expect((target?.variants ?? []).map((v: { key: string } | null) => v?.key)).toEqual([
      'melting-acid',
      'nightshade-coating',
      'sap',
      'shadeslip',
      'shadeslip-mobile',
    ]);
    // The tooltip is the point, so the recipe must hover the row and prove the
    // shared #tooltip actually painted rather than shooting the row alone.
    expect(target?.capture.toString()).toContain('#tooltip');
    expect(target?.capture.toString()).toContain('mouseenter');
  });

  it('maps a zone/terrain change to the world-map target', () => {
    const plan = classifyDiff(['src/render/terrain.ts']);
    expect(plan.specific.map((t: { key: string }) => t.key)).toContain('world-map');
  });

  it('falls back to the desktop HUD for a generic visual change', () => {
    const plan = classifyDiff(['src/render/renderer.ts']);
    expect(plan.isVisual).toBe(true);
    expect(plan.specific).toHaveLength(0);
    expect(plan.generic).toEqual(['hud-desktop']);
  });

  it('maps the mobile HUD stylesheet to the cross-hotbar target it can visually change', () => {
    const plan = classifyDiff(['src/styles/hud.mobile.css']);
    expect(plan.specific.map((t: { key: string }) => t.key)).toContain('cross-hotbar');
    expect(plan.generic).toHaveLength(0);
  });

  it('keeps the desktop HUD fallback for the shared component stylesheet', () => {
    const plan = classifyDiff(['src/styles/components.css']);
    expect(plan.specific).toHaveLength(0);
    expect(plan.generic).toEqual(['hud-desktop']);
  });

  it('does not treat an i18n text-table change as visual', () => {
    const plan = classifyDiff(['src/ui/i18n.catalog/hud_chrome.ts']);
    expect(plan.isVisual).toBe(false);
    expect(plan.generic).toHaveLength(0);
  });

  it('does not treat a UI test file as visual', () => {
    const plan = classifyDiff(['tests/social_view.test.ts', 'src/ui/social_view.test.ts']);
    expect(plan.isVisual).toBe(false);
  });

  it('prefers specific targets even when other generic-visual files also changed', () => {
    const plan = classifyDiff(['src/ui/bags.ts', 'src/render/renderer.ts']);
    expect(plan.specific.map((t: { key: string }) => t.key)).toContain('inventory');
    expect(plan.generic).toHaveLength(0);
  });

  it('resolveTargets stays available and returns registry-ordered matches', () => {
    const keys = resolveTargets(['src/ui/map_window.ts', 'src/ui/bags.ts']).map(
      (t: { key: string }) => t.key,
    );
    expect(keys).toEqual(['inventory', 'world-map']);
  });

  it('stages unit-frame heraldry with deed ids across every required presentation', () => {
    const script = readFileSync(join(__dirname, '../scripts/pr_shot_targets.mjs'), 'utf8');
    const lowSeed = script.slice(
      script.indexOf('async function seedLowGraphicsPreset'),
      script.indexOf('async function seedHighGraphicsPreset'),
    );
    const highSeed = script.slice(
      script.indexOf('async function seedHighGraphicsPreset'),
      script.indexOf('async function seedClassicOnLowPreset'),
    );
    for (const seed of [lowSeed, highSeed]) {
      expect(seed).toContain('s.graphicsDefaultApplied = true');
      expect(seed).toContain("localStorage.setItem('woc_settings'");
    }
    const target = resolveTargets(['src/ui/unit_frame_painter.ts']).find(
      (candidate: { key: string }) => candidate.key === 'deed-heraldry-unit-frames',
    );
    expect(target?.variants).toEqual([
      { key: 'desktop-low', beforeLoad: expect.any(Function) },
      { key: 'desktop-high', beforeLoad: expect.any(Function) },
      { key: 'mobile', mobile: true, beforeLoad: expect.any(Function) },
      { key: 'parchment', beforeLoad: expect.any(Function) },
    ]);
    const capture = target?.capture.toString() ?? '';
    expect(capture).toContain("staged.selfBorder !== 'col_discovery_250'");
    expect(capture).toContain("staged.peerBorder !== 'col_discovery_250'");
    expect(capture).not.toContain("staged.peerBorder !== 'curators_gilt'");
    expect(capture).toContain("chat.value = '/daynight day'");
    expect(capture).toContain('chat instanceof HTMLTextAreaElement');
    expect(capture).toContain('chat composer is unavailable for daylight staging');
    expect(capture).toContain('await wait(8000)');
    expect(capture).toContain("variant.key === 'desktop-high' ? 3 : 1");
    expect(capture).toContain('staged.graphicsPreset !== expectedGraphicsPreset');
    expect(capture).toContain("variant.key === 'desktop-high' ? 'high' : 'low'");
    expect(capture).toContain("variant.key === 'desktop-high' ? '1' : '0'");
    expect(capture).toContain('staged.fxLevel !== expectedFxLevel');
    expect(capture).toContain('staged.fxShadow !== expectedFxShadow');
    expect(capture).toContain("document.querySelector('#options-menu')");
    expect(capture).toContain(
      "menu instanceof HTMLElement && getComputedStyle(menu).display !== 'none'",
    );
    expect(capture).toContain('window.__game?.hud?.toggleOptionsMenu?.()');
    for (const variant of target?.variants ?? []) {
      expect(String(variant.beforeLoad)).toContain(
        variant.key === 'parchment' ? "themeSeed('parchment')" : "themeSeed('classic')",
      );
    }
  });

  it('stages the picker and inspect heraldry recipes through their real UI flows', () => {
    const picker = resolveTargets(['src/ui/deeds_window.ts']).find(
      (candidate: { key: string }) => candidate.key === 'deed-border-picker',
    );
    expect(picker?.variants).toEqual([
      { key: 'desktop', beforeLoad: expect.any(Function) },
      { key: 'mobile', mobile: true, beforeLoad: expect.any(Function) },
      { key: 'parchment', beforeLoad: expect.any(Function) },
    ]);
    const pickerCapture = picker?.capture.toString() ?? '';
    for (const deed of [
      'prog_prestige_10',
      'dgn_deepward',
      'col_discovery_250',
      'col_reliquary_rank_5',
    ]) {
      expect(pickerCapture).toContain(deed);
    }
    expect(pickerCapture).toContain("openDeeds?.('titles')");
    expect(pickerCapture).toContain('option.focus()');
    expect(pickerCapture).toContain('previewed.after !== previewed.before');
    expect(pickerCapture).toContain("previewed.previewBorder !== 'reliquary_gilt'");
    for (const variant of picker?.variants ?? []) {
      expect(String(variant.beforeLoad)).toContain(
        variant.key === 'parchment' ? "themeSeed('parchment')" : "themeSeed('classic')",
      );
    }

    const inspect = resolveTargets(['src/ui/inspect_window.ts']).find(
      (candidate: { key: string }) => candidate.key === 'inspect-border-cartouche',
    );
    expect(inspect?.variants).toEqual([
      { key: 'desktop', beforeLoad: expect.any(Function) },
      { key: 'mobile', mobile: true, beforeLoad: expect.any(Function) },
      { key: 'parchment', beforeLoad: expect.any(Function) },
    ]);
    const inspectCapture = inspect?.capture.toString() ?? '';
    expect(inspectCapture).toContain("deedsEarned.set('col_reliquary_rank_5'");
    expect(inspectCapture).toContain("setActiveBorder('col_reliquary_rank_5')");
    expect(inspectCapture).toContain("deedsEarned.set('prog_grandmaster_armorcrafting'");
    expect(inspectCapture).toContain("setActiveTitle('prog_grandmaster_armorcrafting')");
    expect(inspectCapture).toContain('openInspect(sim.playerId)');
    expect(inspectCapture).toContain('inspect Deed Heraldry staging failed');
    for (const variant of inspect?.variants ?? []) {
      expect(String(variant.beforeLoad)).toContain(
        variant.key === 'parchment' ? "themeSeed('parchment')" : "themeSeed('classic')",
      );
    }
  });

  it('stages a complete profession identity for refresh-aware captures', () => {
    const target = resolveTargets(['src/ui/professions_window.ts']).find(
      (candidate: { key: string }) => candidate.key === 'professions',
    );
    expect(target?.capture.toString()).toContain('knownRecipes: []');
  });

  it('maps the identity card and view modules to the crafting target (phase 22)', () => {
    // A rename or when-list trim would silently stop capturing the identity
    // card framings; pin the routing per module the phase added.
    const cardPlan = classifyDiff(['src/ui/profession_identity_card.ts']);
    expect(cardPlan.isVisual).toBe(true);
    expect(cardPlan.specific.map((t: { key: string }) => t.key)).toContain('crafting');
    const viewPlan = classifyDiff(['src/ui/profession_identity_view.ts']);
    expect(viewPlan.specific.map((t: { key: string }) => t.key)).toContain('crafting');
    const crafting = cardPlan.specific.find(
      (candidate: { key: string }) => candidate.key === 'crafting',
    );
    expect((crafting?.variants ?? []).map((v: { key: string } | null) => v?.key)).toEqual(
      expect.arrayContaining([
        'desktop-identity-attuned',
        'mobile-identity-attuned',
        'desktop-identity-compact',
      ]),
    );
  });

  it('maps the quest-marker classifier to the repeat-marker target (phase 23)', () => {
    // A rename or when-list trim would silently stop capturing the marker
    // pairs (the phase 22 pin's lesson). Only the classifier leaf routes
    // here: the surface files route to their own specific targets (the
    // nameplate painter to holder-tier, minimap/map to world-map, the
    // gossip controller to attunement-legibility), so a colour-only marker
    // change captures no marker pair by design.
    const plan = classifyDiff(['src/sim/quests/quest_marker_kind.ts']);
    expect(plan.isVisual).toBe(true);
    expect(plan.specific.map((t: { key: string }) => t.key)).toContain('quest-marker-repeat');
    const target = plan.specific.find(
      (candidate: { key: string }) => candidate.key === 'quest-marker-repeat',
    );
    expect((target?.variants ?? []).map((v: { key: string }) => v.key)).toEqual([
      'repeat-desktop',
      'cooldown-desktop',
      'repeat-map-desktop',
      'repeat-mobile',
    ]);
  });

  it('routes the shared Reliquary label module to both Reliquary targets', () => {
    // reliquary_labels.ts resolves every relic display name AND the missing-cell
    // source line, so it changes what BOTH captures show: the Overview recent
    // chips and the page grid's cells, tooltips, and labels. Without it in the
    // when lists a source-line or display-name change ships with no screenshot.
    const plan = classifyDiff(['src/ui/reliquary_labels.ts']);
    // The negative keeps isVisual meaningful here: every src/ui path is
    // visual by prefix, so only the discriminating pair proves the flag.
    expect(classifyDiff(['docs/qa-gate.md']).isVisual).toBe(false);
    expect(plan.isVisual).toBe(true);
    // Cross-file contract for the reliquary-page cell picker: the script
    // selects on the data marker the painter stamps (never English aria
    // text), so both ends must spell the same attribute or the capture
    // silently degrades to the fallback cell. The painter side is pinned
    // behaviorally in tests/reliquary_window_behavior.test.ts. Both reads are
    // COMMENT-STRIPPED so prose mentioning the tokens can never satisfy them.
    const stripSource = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const script = stripSource(
      readFileSync(join(__dirname, '../scripts/pr_shot_targets.mjs'), 'utf8'),
    );
    expect(script).toContain("hasAttribute('data-cell-source')");
    const painterSrc = stripSource(
      readFileSync(join(__dirname, '../src/ui/reliquary_window.ts'), 'utf8'),
    );
    // The attribute carries the number of source lines the cell RESOLVES, not
    // a constant marker: the picker below reads it as a number to land the
    // shot on the richest multi-source cell, so a painter that went back to
    // "1" would leave the capture on an arbitrary one-line relic.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserts on source text that contains a template literally.
    expect(painterSrc).toContain('data-cell-source="${sourceLines.length}"');
    expect(script).toContain("Number.parseInt(node.getAttribute('data-cell-source')");
    expect(script).toContain('if (count > bestCount)');
    const keys = plan.specific.map((t: { key: string }) => t.key);
    expect(keys).toContain('reliquary-window');
    expect(keys).toContain('reliquary-page');
    for (const key of ['reliquary-window', 'reliquary-page']) {
      const target = plan.specific.find(
        (candidate: { key: string; variants: { key: string; mobile?: boolean }[] }) =>
          candidate.key === key,
      );
      expect(
        target?.variants.map((v: { key: string }) => v.key),
        key,
      ).toEqual(['desktop', 'mobile']);
      expect(target?.variants[1]?.mobile, key).toBe(true);
      // The capture rule (Phase 22): every reliquary rig seeds the LOW preset
      // before the document loads, so shots stay comparable across machines.
      for (const variant of target?.variants ?? []) {
        expect(String(variant.beforeLoad), `${key} ${variant.key} seeds the low preset`).toContain(
          'graphicsPreset = 1',
        );
      }
    }
  });

  it('holds the reliquary-tracker capture to the window contracts it borrows', () => {
    // The tracker capture stages pins through the window's OWN controls, so it
    // rests on cross-file spellings the script cannot import. Both reads are
    // COMMENT-STRIPPED so prose mentioning the tokens can never satisfy them.
    const stripSource = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const script = stripSource(
      readFileSync(join(__dirname, '../scripts/pr_shot_targets.mjs'), 'utf8'),
    );
    const windowSrc = stripSource(
      readFileSync(join(__dirname, '../src/ui/reliquary_window.ts'), 'utf8'),
    );
    // The between-variant cleanup sweeps the same storage prefix the window
    // persists under. A prefix drift would leave a prior variant's pins in
    // place, and the pin control is a TOGGLE, so a stale pin would be flipped
    // OFF and the capture would corrupt silently.
    expect(windowSrc).toContain("RELIQUARY_PIN_KEY_PREFIX = 'woc_reliquary_pins'");
    expect(script).toContain("indexOf('woc_reliquary_pins')");
    // The staging drives the window's markup: the pin toggle (skipped when
    // refused in EITHER form, or pressed), and the shelf rows' data-page.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserts on source text that contains a template literally.
    expect(windowSrc).toContain('data-pin="${esc(pageId)}"');
    expect(script).toContain('[data-pin=');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserts on source text that contains a template literally.
    expect(windowSrc).toContain('aria-pressed="${pinned}"');
    expect(windowSrc).toContain('aria-disabled="true"');
    expect(script).toContain("getAttribute('aria-disabled') === 'true'");
    expect(script).toContain("getAttribute('aria-pressed') === 'true'");
    expect(windowSrc).toContain('class="reliquary-page-row" data-page=');
    expect(script).toContain('.reliquary-page-row');
    // And the routing: both halves of the tracker pair reach the target.
    for (const path of [
      'src/ui/reliquary_tracker_painter.ts',
      'src/ui/reliquary_tracker_view.ts',
    ]) {
      const plan = classifyDiff([path]);
      expect(plan.isVisual, path).toBe(true);
      expect(
        plan.specific.map((t: { key: string }) => t.key),
        path,
      ).toContain('reliquary-tracker');
    }
  });
});

describe('diffChangedPaths', () => {
  function section(header: string, minus: string, plus: string) {
    return `diff --git ${header}\n--- ${minus}\n+++ ${plus}\n@@ -1 +1 @@\n-x\n+y\n`;
  }

  it('collects modified, added, and deleted paths (both diff sides, no /dev/null)', () => {
    const diff =
      section('a/src/ui/hud.ts b/src/ui/hud.ts', 'a/src/ui/hud.ts', 'b/src/ui/hud.ts') +
      section('a/src/render/new.ts b/src/render/new.ts', '/dev/null', 'b/src/render/new.ts') +
      section(
        'a/src/styles/hud.mobile.css b/src/styles/hud.mobile.css',
        'a/src/styles/hud.mobile.css',
        '/dev/null',
      );
    expect(diffChangedPaths(diff).sort()).toEqual([
      'src/render/new.ts',
      'src/styles/hud.mobile.css',
      'src/ui/hud.ts',
    ]);
  });

  it('a DELETED visual file still classifies as a visual change', () => {
    // src/game/mobile_controls.ts is visual (VISUAL_PREFIXES) and mobile (isMobilePath)
    // but maps to no specific window target's `when` list, so this stays a pure
    // generic-fallback probe.
    const diff = section(
      'a/src/game/mobile_controls.ts b/src/game/mobile_controls.ts',
      'a/src/game/mobile_controls.ts',
      '/dev/null',
    );
    const plan = classifyDiff(diffChangedPaths(diff));
    expect(plan.isVisual).toBe(true);
    expect(plan.generic).toEqual(['hud-desktop', 'hud-mobile']);
  });

  it('the vendor row gate resolves its own target from the sim table and both view halves', () => {
    // The gate spans a sim content table and the two vendor-window halves, and
    // only the sim table is outside src/ui, so a gate-table-only change would
    // fall through to "nothing to shoot" without its own `when` entry. Pinning
    // the resolved key ORDER also catches a typo in either list.
    expect(
      resolveTargets(['src/sim/content/vendor_row_gates.ts']).map((t: { key: string }) => t.key),
    ).toEqual(['vendor-tool-gate']);
    // Both view halves resolve the advisory target AND the phase 21 count-row
    // target (both windows change when either half changes), and nothing else.
    // Worth pinning because it is easy to assume otherwise: the bags target
    // lists 'ui/vendor' in its own `when`, but these modules live at
    // src/ui/hud/vendor/, so that entry does not substring-match them and
    // never shot this window.
    expect(
      resolveTargets(['src/ui/hud/vendor/vendor_view.ts']).map((t: { key: string }) => t.key),
    ).toEqual(['vendor-tool-gate', 'vendor-buy-count']);
    expect(
      resolveTargets(['src/ui/hud/vendor/vendor_window.ts']).map((t: { key: string }) => t.key),
    ).toEqual(['vendor-tool-gate', 'vendor-buy-count']);
    // The count leaf and the prompt module reach ONLY the count-row target.
    expect(
      resolveTargets(['src/sim/vendor_buy_stack.ts']).map((t: { key: string }) => t.key),
    ).toEqual(['vendor-buy-count']);
    expect(
      resolveTargets(['src/ui/hud/vendor/buy_quantity_prompt_window.ts']).map(
        (t: { key: string }) => t.key,
      ),
    ).toEqual(['vendor-buy-count']);
    // A sim-only content change is still visual, because the gate changes what
    // the goods grid paints.
    expect(classifyDiff(['src/sim/content/vendor_row_gates.ts']).isVisual).toBe(true);
  });

  it('gather-node content shoots all three surfaces it is visible on', () => {
    // Gather-node placement shows up in three places: the world map's terrain and
    // labels, the quest-objective blobs, and the in-world props. A `when` list that
    // only names the blobs would silently skip the other two, and the omission is
    // invisible because a missing target just means one fewer screenshot. Pinning
    // the resolved key ORDER makes a typo in either list red instead.
    expect(
      resolveTargets(['src/sim/content/gather_nodes.ts']).map((t: { key: string }) => t.key),
    ).toEqual(['world-map', 'gather-quest-map-areas', 'gather-node']);
    // The quest-blob geometry lives in the sim leaf, and only the blob target
    // depends on it, so that path resolves to exactly one.
    expect(resolveTargets(['src/sim/quest_targets.ts']).map((t: { key: string }) => t.key)).toEqual(
      ['gather-quest-map-areas'],
    );
    // Both are visual, so a placement-only or geometry-only change never falls
    // through to "nothing to shoot".
    expect(classifyDiff(['src/sim/content/gather_nodes.ts']).isVisual).toBe(true);
    expect(classifyDiff(['src/sim/quest_targets.ts']).isVisual).toBe(true);
  });

  it('maps the gossip Crafting shortcut from both the core and the dialog controller', () => {
    // A rename of the target key or a `when` trim would silently stop
    // capturing (a missing target is just one fewer screenshot), so pin the
    // routing from BOTH implicating paths and the variant list. The dialog
    // controller path also implies the attunement-legibility target, so use
    // toContain, not toEqual, for that arm.
    const fromCore = classifyDiff(['src/ui/hud/quest/master_craft_core.ts']);
    expect(fromCore.specific.map((t: { key: string }) => t.key)).toContain(
      'gossip-crafting-shortcut',
    );
    expect(
      classifyDiff(['src/ui/hud/quest/quest_dialog_controller.ts']).specific.map(
        (t: { key: string }) => t.key,
      ),
    ).toContain('gossip-crafting-shortcut');
    const target = fromCore.specific.find(
      (t: { key: string }) => t.key === 'gossip-crafting-shortcut',
    );
    expect(target?.variants.map((v: { key: string }) => v.key)).toEqual([
      'dialog-desktop',
      'dialog-mobile',
      'window-desktop',
    ]);
    // Every variant must seed the camera-mode prompt flag before the document
    // loads: page.screenshot clips paint overlapping chrome into the dialog
    // region, and a live prompt was covering the Crafting row in the after
    // desktop dialog shot. beforeLoad is a function (evaluateOnNewDocument),
    // so pin presence rather than its body string.
    for (const variant of target?.variants ?? []) {
      expect(typeof variant.beforeLoad, `${variant.key} beforeLoad`).toBe('function');
    }
  });
});

describe('the druid auto-unshift target', () => {
  it('fires on the sim rule and on the bar gate that has to agree with it', () => {
    // The behavior lives in the sim and its visible consequence lives on the
    // bar, so BOTH paths must select the target: a change to either one alone
    // still needs the evidence.
    for (const path of [
      'src/sim/combat/form_auto_unshift.ts',
      'src/ui/hud/action_bar/action_bar_view.ts',
    ]) {
      const plan = classifyDiff([path]);
      expect(plan.isVisual).toBe(true);
      expect(plan.specific.map((t: { key: string }) => t.key)).toContain('druid-auto-unshift');
      expect(plan.generic).toHaveLength(0);
    }
  });

  it('covers both bar-swapping and travel forms, on desktop and mobile', () => {
    // Bruin parks the mana pool and Fleet does not, which is the split the rule
    // turns on, so a variant list that lost either one would stop proving it.
    const target = classifyDiff(['src/sim/combat/form_auto_unshift.ts']).specific.find(
      (t: { key: string }) => t.key === 'druid-auto-unshift',
    );
    expect(target.variants.map((v: { key: string }) => v.key)).toEqual([
      'bruin-form-desktop',
      'fleet-form-desktop',
      'bruin-form-mobile',
    ]);
    expect(target.variants.map((v: { formAbility: string }) => v.formAbility)).toEqual([
      'bear_form',
      'travel_form',
      'bear_form',
    ]);
    expect(target.variants.filter((v: { mobile?: boolean }) => v.mobile)).toHaveLength(1);
    // Every variant drives the real druid kit, not a stand-in class.
    for (const v of target.variants) expect(v.charClass).toBe('druid');
    expect(ABILITIES.healing_touch.class).toBe('druid');
    expect(ABILITIES.healing_touch.castTime).toBeGreaterThan(1);
  });
});

describe('the bank-meter target routing (phase 08 QA)', () => {
  it('both meter files classify to the bank-meter target with its two variants', () => {
    // A `when` typo would silently disable the capture: nothing else pins
    // that the meter's own files route to it (the market targets' precedent).
    for (const path of [
      'src/ui/bank_view.ts',
      'src/ui/bank_window.ts',
      // The extracted siblings that now own bank pixels (phase 17). Without these
      // rows a bank change confined to one of them captures no bank evidence, and
      // the loop below is the only thing that would ever say so.
      'src/ui/bank_bonus_view.ts',
      'src/ui/bank_rung_view.ts',
      'src/ui/bank_rung_purchase_core.ts',
      // Bank Storage phase 18's two: the chrome contract that decides whether
      // the footer is inside the window at all, and the meter's own copy.
      'src/ui/bank_chrome_layout_core.ts',
      'src/ui/bank_meter_view.ts',
    ]) {
      const plan = classifyDiff([path]);
      const keys = plan.specific.map((t: { key: string }) => t.key);
      expect(keys, path).toContain('bank-meter');
    }
    const meter = classifyDiff(['src/ui/bank_view.ts']).specific.find(
      (t: { key: string }) => t.key === 'bank-meter',
    );
    // THREE, since phase 18: the footer's defect was a height budget, so one
    // mobile frame cannot show it. The second names its own viewport; the first
    // deliberately does not, so it keeps tracking the house frame.
    // Compared by SHAPE, not by identity, because beforeLoad is a function and
    // toEqual would compare it structurally. The seed is asserted separately
    // below so a leg that silently loses it is a failure, not a passing shot at
    // the wrong tier.
    expect(
      (meter?.variants ?? []).map((v: Record<string, unknown>) => ({
        key: v.key,
        mobile: v.mobile,
        viewport: v.viewport,
      })),
    ).toEqual([
      { key: 'desktop', mobile: undefined, viewport: undefined },
      { key: 'mobile', mobile: true, viewport: undefined },
      { key: 'mobile-short', mobile: true, viewport: { width: 740, height: 360 } },
    ]);
    // The standing capture rule: every leg shoots the LOWEST graphics preset.
    // The mobile legs go full frame, so the world behind the pane is in the shot
    // and an unseeded leg is a different tier, not a cosmetic difference.
    //
    // IDENTITY, not `typeof === 'function'`: any function passes that, including
    // a no-op or the deliberate HIGH comparison seed one target over. The
    // subject here is a helper the target table shares with the runner, which is
    // the case where a reference pin is the honest instrument rather than a
    // self-comparison.
    for (const v of meter?.variants ?? []) {
      expect((v as { beforeLoad?: unknown }).beforeLoad, `${v.key} seeds LOW`).toBe(
        seedLowGraphicsPreset,
      );
    }
    // ...and that shared seeder really seeds the LOWEST preset. The identity pin
    // above only says the table and the runner agree on WHICH function; both
    // sides move together if its body changes, which is the self-comparison
    // shape. The literal is what makes it LOW, so pin the literal once.
    const targetSrc = readFileSync(join(__dirname, '../scripts/pr_shot_targets.mjs'), 'utf8');
    const lowSeedBody = targetSrc.slice(
      targetSrc.indexOf('async function seedLowGraphicsPreset'),
      targetSrc.indexOf('async function seedHighGraphicsPreset'),
    );
    expect(lowSeedBody.length, 'the LOW seeder must be found').toBeGreaterThan(0);
    expect(lowSeedBody).toContain('s.graphicsPreset = 1');
  });

  it('the RUNNER applies a variant viewport, not just the table that declares one', () => {
    // The pin above proves the table says 740x360. Nothing there proves the
    // screenshot runner reads it, and a wrong property name would silently shoot
    // two identical house frames in the phase whose evidence is that the shorter
    // one differs. Three legs, including the default arm.
    expect(resolveMobileViewport({ key: 'mobile', mobile: true })).toEqual({
      width: 844,
      height: 390,
    });
    expect(
      resolveMobileViewport({
        key: 'mobile-short',
        mobile: true,
        viewport: { width: 740, height: 360 },
      }),
    ).toEqual({ width: 740, height: 360 });
    // A partial override keeps the house value for the axis it does not name.
    expect(resolveMobileViewport({ key: 'x', mobile: true, viewport: { height: 360 } })).toEqual({
      width: 844,
      height: 360,
    });
    // ...and the RUNNER really routes through it. Everything above is about the
    // pure function; `resolveMobileViewport({})` at the call site would leave all
    // of it green while both phone legs shot the house frame. A source pin,
    // because pr_screenshots.mjs launches a browser at import time and can never
    // be imported here. An occurrence BOUND, so a reintroduced inline default
    // cannot sit beside the call.
    const runner = readFileSync(join(__dirname, '../scripts/pr_screenshots.mjs'), 'utf8').replace(
      /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
      '',
    );
    expect(runner.match(/resolveMobileViewport\(variant\)/g)?.length).toBe(1);
    expect(runner).not.toMatch(/width\s*=\s*844/);
  });
});

describe('the Materials Vault evidence target', () => {
  it('routes both vault modules and pins low graphics plus each intended theme', async () => {
    for (const path of ['src/ui/vault_view.ts', 'src/ui/vault_window.ts']) {
      expect(classifyDiff([path]).specific.map((target: { key: string }) => target.key)).toContain(
        'bank-vault',
      );
    }
    const target = classifyDiff(['src/ui/vault_window.ts']).specific.find(
      (candidate: { key: string }) => candidate.key === 'bank-vault',
    );
    expect(target.variants.map((variant: { key: string }) => variant.key)).toEqual([
      'locked',
      'locked-mobile',
      'desktop',
      'mobile',
      'parchment',
      'high-contrast',
      'fine',
      'fine-mobile',
    ]);
    for (const variant of target.variants) {
      const storageSeeds: string[] = [];
      const mediaCalls: Array<{ method: string; payload: unknown }> = [];
      await variant.beforeLoad({
        async evaluateOnNewDocument(script: string) {
          storageSeeds.push(script);
        },
        async createCDPSession() {
          return {
            async send(method: string, payload: unknown) {
              mediaCalls.push({ method, payload });
            },
          };
        },
      });
      expect(storageSeeds.join('\n')).toContain('s.graphicsPreset = 1');
      const expectedTheme =
        variant.key === 'parchment'
          ? "preset: 'parchment'"
          : variant.key === 'high-contrast'
            ? "preset: 'highContrast'"
            : "preset: 'classic'";
      expect(storageSeeds.join('\n')).toContain(expectedTheme);
      expect(mediaCalls).toHaveLength(variant.key === 'high-contrast' ? 1 : 0);
    }
    expect(
      target.variants.find(
        (variant: { key: string; forcedColors?: boolean }) => variant.key === 'high-contrast',
      )?.forcedColors,
    ).toBe(true);
    expect(target.capture.toString()).toContain("matchMedia('(forced-colors: active)').matches");
    expect(target.capture.toString()).toContain("getElementById('tutorial-greeting')");
    expect(target.capture.toString()).toContain('signedSpecial');
  });
});
