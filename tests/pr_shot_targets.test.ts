// Unit test for the PR-screenshot diff classifier. classifyDiff is the whole "shoot only
// visual changes, and only the sections they touch" policy, kept pure so it needs no
// browser. The .mjs script has no TS/browser imports at module load, so vitest can import
// it directly.
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain Node ESM script, no types
import { classifyDiff, diffChangedPaths, resolveTargets } from '../scripts/pr_shot_targets.mjs';
import { ABILITIES } from '../src/sim/data';

describe('classifyDiff', () => {
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

  it('captures the market overview, collect ledger, buy confirmation, and expanded armor filters for market window changes', () => {
    const plan = classifyDiff(['src/ui/market_window.ts']);
    expect(plan.isVisual).toBe(true);
    expect(plan.specific.map((t: { key: string }) => t.key)).toEqual([
      'market-window',
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

  it('adds the mobile HUD when the visual change touches the mobile surface', () => {
    const plan = classifyDiff(['src/styles/hud.mobile.css']);
    expect(plan.generic).toEqual(['hud-desktop', 'hud-mobile']);
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

  it('maps the Vale Cup unrated-gates UI change to its two targets, per path (#2767)', () => {
    // One classifyDiff per path, so each target's `when` routing is proven on
    // its own rather than through the OR of the union.
    const windowKeys = classifyDiff(['src/ui/vale_cup_window.ts']).specific.map(
      (t: { key: string }) => t.key,
    );
    expect(windowKeys).toContain('vale-cup-unrated-notes');
    expect(windowKeys).not.toContain('vale-cup-briefing-unrated');
    const briefingPlan = classifyDiff(['src/ui/vale_cup_briefing.ts']);
    const briefingKeys = briefingPlan.specific.map((t: { key: string }) => t.key);
    expect(briefingKeys).toContain('vale-cup-briefing-unrated');
    expect(briefingKeys).not.toContain('vale-cup-unrated-notes');
    for (const key of ['vale-cup-unrated-notes', 'vale-cup-briefing-unrated']) {
      const target = classifyDiff([
        'src/ui/vale_cup_window.ts',
        'src/ui/vale_cup_briefing.ts',
      ]).specific.find((candidate: { key: string }) => candidate.key === key);
      expect(target?.variants).toEqual([{ key: 'desktop' }, { key: 'mobile', mobile: true }]);
    }
  });

  it('maps a deed catalog copy change to the Book of Deeds target (#2767)', () => {
    const plan = classifyDiff(['src/sim/content/deeds.ts']);
    expect(plan.isVisual).toBe(true);
    expect(plan.specific.map((t: { key: string }) => t.key)).toContain('vale-cup-skill-deed-copy');
    const target = plan.specific.find(
      (candidate: { key: string }) => candidate.key === 'vale-cup-skill-deed-copy',
    );
    expect(target?.variants).toEqual([{ key: 'desktop' }, { key: 'mobile', mobile: true }]);
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
