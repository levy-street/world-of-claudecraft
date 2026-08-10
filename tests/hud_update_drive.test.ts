// THE DRIVE REGISTRY for `Hud.update()` (#2498).
//
// WHAT QUESTION THIS ANSWERS, AND WHY THE PAINTER GATE CANNOT.
// `tests/hud_perf_budget.test.ts` sorts every `src/ui` painter into a bucket, and its cold
// bucket deliberately makes NO claim about cadence, because a per-module source scan cannot
// see a driver that lives in the coordinator (#2497 recorded that gap and filed this issue as
// the close). The premise a reader would assume is false in this tree: a `*_window.ts` is NOT
// cold. `Hud.update()` polls about half of them. `spellbookWindow.tickOpen()` runs EVERY
// FRAME while the window is open; arena / dungeon_finder / vale_cup / card_duel `render()` on
// the 250 ms band behind only a display check; social / market / mailbox / bank / bags /
// deeds / professions / calendar get `refreshIfChanged()` on the 500 ms band.
//
// The repo's intended pattern is POLL CHEAPLY, REBUILD ON A SIGNATURE CHANGE, and it works.
// What was missing is that nothing said WHICH windows are on a poll, on which band, or behind
// which guard. Drop a signature guard and a full `innerHTML` rebuild becomes a 4 Hz or
// per-frame rebuild while every number in every gate holds. That is what this file fixes.
//
// WHAT IT IS. One hand-written table, `HUD_UPDATE_DRIVES`, with a row per distinct
// (callee, band, gate) that `Hud.update()` drives, diffed BOTH WAYS against a TypeScript AST
// walk of the real method. Adding a call to `update()` fails until it is registered; deleting
// one fails until its row goes; moving one between bands fails; and changing the condition
// that gates it fails, because the gate TEXT is part of the key.
//
// IT IS THE WHOLE BODY, NOT JUST THE WINDOWS, and that is deliberate. Scoping the table to
// windows would repeat the mistake #2497 refused to ship (a declaration naming a handful of
// windows when half the family qualifies reads as a complete classification and is not one),
// and it would hand a new repaint a free way out: name it `syncFoo()` and it is not a window.
// Every call `update()` evaluates is registered; the `surface` field is what answers the
// window question. The cost is real and is the point: a new line in `update()` is now a diff
// line here too.
//
// WHERE ITS TEETH STOP, stated rather than implied:
//   - It sees `update()`'s OWN body. A repaint two hops down a `Hud` private method is named
//     by the row for that method (`this.updateTradeWindow` says it rebuilds `#trade-window`),
//     but the walk does not follow it, so a NEW repaint added inside an ALREADY-registered
//     method is invisible here. The `surface` and `guard` fields are what a reviewer reads;
//     the diff is what a machine enforces.
//   - In a VALUE slot (a declaration's initializer, an assignment's right side, a `return`)
//     only a call on `this` is registered, so `const bar = xpBarView({...})` is not a row
//     while `const music = this.instanceMusic.update({...})` is. A repaint written as a call
//     on a LOCAL in a value slot would escape; the whole registry is about what the
//     coordinator drives, and registering every pure producer would bury that under two
//     dozen rows of formatters. `helpers/method_call_sites.ts` states the full rule.
//   - A `guard` proof is a source-text pin. It fails when the guard is DELETED, which is the
//     criterion #2498 asked for, and it cannot tell a guard that was neutered while its field
//     survived. The instrument for THAT is behavioral (render, poll unchanged, assert zero
//     writes) and already exists per window in `tests/<window>.test.ts`; this table's job is
//     to make a missing one visible, not to replace it.
//   - Cadence here is the CALL SITE's band. A callee may throttle itself further (`meters`
//     self-limits to 250 ms on a per-frame call), which the row's `why` records and no walk
//     over `hud.ts` can check.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type CallSite,
  normalizeCondition,
  readMethodCallSites,
} from './helpers/method_call_sites';

// --------------------------------------------------------------------------
// The band split.
// --------------------------------------------------------------------------

/**
 * The cadence latch that admits a call. `frame` means nothing in `update()` throttles it, so
 * it runs at the render loop's rate; the other three are the dividers `update()` computes at
 * its top (`fastHud` 100 ms, `mediumHud` 250 ms, `slowHud` 500 ms).
 */
type Band = 'frame' | 'fast' | 'medium' | 'slow';

/** The divider variable each band is spelled with, in `src/ui/hud.ts`. */
const BAND_TOKENS: ReadonlyArray<readonly [string, Band]> = [
  ['fastHud', 'fast'],
  ['mediumHud', 'medium'],
  ['slowHud', 'slow'],
];

/** Split a condition on TOP-LEVEL ` && ` only, so a `&&` inside a call argument survives. */
function splitTopLevelAnd(cond: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < cond.length; i++) {
    const c = cond[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && c === '&' && cond[i + 1] === '&') {
      parts.push(cond.slice(start, i).trim());
      start = i + 2;
      i++;
    }
  }
  parts.push(cond.slice(start).trim());
  return parts.filter((p) => p !== '');
}

/**
 * Separate the cadence latch from the rest of the guard.
 *
 * The band token can share its condition with a real gate (`slowHud && this.bankWindow
 * .isOpen`), so the token is removed from the condition that carries it and whatever remains
 * joins the gate. A part holding a top-level `||` is parenthesized on the way in, because
 * joining `!npc || dist2d(...) > NPC_WINDOW_CLOSE_RANGE` onto a preceding condition with a bare
 * ` && ` would print
 * a gate that reads as a different expression than the source it came from.
 */
function splitBand(conditions: readonly string[]): { band: Band; gate: string } {
  let band: Band = 'frame';
  const gateParts: string[] = [];
  for (const cond of conditions) {
    const hit = BAND_TOKENS.find(([token]) => new RegExp(`\\b${token}\\b`).test(cond));
    if (!hit) {
      gateParts.push(cond);
      continue;
    }
    band = hit[1];
    gateParts.push(...splitTopLevelAnd(cond).filter((part) => part !== hit[0]));
  }
  return {
    band,
    gate: gateParts
      .map((p) => (p.includes('||') && !/^\(.*\)$/.test(p) ? `(${p})` : p))
      .join(' && '),
  };
}

/** The registry key: what the diff below compares in both directions. */
const keyOf = (call: string, band: Band, gate: string): string => `${call}|${band}|${gate}`;

// --------------------------------------------------------------------------
// The registry.
// --------------------------------------------------------------------------

/**
 * What the call repaints.
 *
 * `window` is the subject of #2498: a window, panel or popup container, whether the row
 * repaints it, opens it or closes it. `chrome` is always-on HUD furniture (unit frames, bars,
 * trackers, badges, banners, canvases, live regions), whose write contract belongs to the
 * painter gate. `none` makes no DOM write on this path (state sync, audio, logic).
 */
type Surface = 'window' | 'chrome' | 'none';

/**
 * What stops a repeated poll from rebuilding.
 *
 * `module` and `hud` both carry a `proof`: the source line the guard is spelled on, matched
 * whitespace-normalized against the comment-stripped module, so DELETING the guard fails this
 * gate and reformatting it does not. `callsite` means the row's own `gate` is the whole guard.
 * `none` is the honest record that there is not one, and it must say why.
 */
type Guard =
  | { readonly kind: 'module'; readonly module: string; readonly proof: string }
  | { readonly kind: 'hud'; readonly proof: string }
  | { readonly kind: 'callsite' }
  | { readonly kind: 'none'; readonly why: string };

interface DriveRow {
  /** The callee chain exactly as the AST walk reports it. */
  readonly call: string;
  readonly band: Band;
  /** Every enclosing condition except the band token, outermost first. */
  readonly gate: string;
  /** How many statement sites share this exact key. Omitted means one. */
  readonly sites?: number;
  readonly surface: Surface;
  /** Required for `surface: 'window'`, forbidden otherwise, so it cannot rot into decoration. */
  readonly guard?: Guard;
  /** What it repaints, in one line. */
  readonly why: string;
}

const SIG_RETURN = 'if (sig === this.lastSig) return;';
const VIEW_SIG_RETURN = 'if (view.sig === this.lastSig) return;';
// The merged PvP window guards its two tab arms with the same shape against the same
// field, so the Thornhollow Fields arm names its signature apart to stay pinnable.
const RAVENRIFT_SIG_RETURN = 'if (ravenriftSig === this.lastSig) return;';
const VIEW_SIG_BLOCK = 'if (view.sig !== this.lastSig) {';

/**
 * Every statement-position call `Hud.update()` makes, in SOURCE ORDER, so the table reads as
 * the method reads. Hand-written on purpose: deriving it from the walk would make the diff a
 * tautology that can never fail.
 */
const HUD_UPDATE_DRIVES: readonly DriveRow[] = [
  {
    call: 'this.fxTier',
    band: 'frame',
    gate: '',
    surface: 'none',
    why: 'reads the STATIC graphics-preset stamp that tiers several cadences below it; no DOM write',
  },
  {
    call: 'this.resolvePendingLoadoutBar',
    band: 'frame',
    gate: '',
    surface: 'none',
    why: 'applies a server-acked loadout bar swap the moment activeLoadout confirms (v0.29 class stack); early-returns to bookkeeping only on ordinary frames, no DOM write',
  },
  {
    call: 'this.reconcileSfx',
    band: 'fast',
    gate: '',
    surface: 'none',
    why: 'prunes the mob-aggro and cast SFX bookkeeping sets; no DOM',
  },
  {
    call: 'this.sweepMobIdleBarks',
    band: 'frame',
    gate: 'now - this.lastIdleSweepAt >= MOB_IDLE_CHECK_INTERVAL_MS',
    surface: 'none',
    why: 'idle bark audio on its own interval latch; no DOM',
  },
  {
    call: 'this.combatAnnouncer.flush',
    band: 'fast',
    gate: '',
    surface: 'chrome',
    why: 'drains the trailing combat burst into the polite live region',
  },
  {
    call: 'this.chatAnnouncer.flush',
    band: 'fast',
    gate: '',
    surface: 'chrome',
    why: 'drains the trailing chat burst into the tab-independent live region',
  },
  {
    call: 'this.questDialog.updateVoice',
    band: 'frame',
    gate: '',
    surface: 'none',
    why: 'sets the gossip voice distance; audio only, no DOM',
  },
  {
    call: 'this.meters.update',
    band: 'frame',
    gate: '',
    surface: 'window',
    guard: {
      kind: 'module',
      module: 'meters.ts',
      proof: 'if (!this.isOpen || now - this.lastRender < 250) return;',
    },
    why: 'the damage/healing meters window; called per frame and self-limits to 250 ms',
  },
  {
    call: 'this.lockpickController.repaintIfChanged',
    band: 'frame',
    gate: '',
    surface: 'window',
    guard: {
      kind: 'module',
      module: 'hud/delve/lockpick_window.ts',
      proof: 'if (lockpickRenderSig(view) !== this.lastSig) this.renderBoard();',
    },
    why: 'the delve lockpick panel; a per-frame safety net behind a display check and a sig diff',
  },
  {
    call: 'this.tutorial.update',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'the tutorial hint overlay',
  },
  {
    call: 'this.lootRolls.update',
    band: 'frame',
    gate: '',
    surface: 'window',
    guard: {
      kind: 'none',
      why: 'reconciles the live roll set and ticks their timers with no signature latch; cheap only because the roll maps are empty outside a group loot window',
    },
    why: 'the need/greed roll popups',
  },
  {
    call: 'this.updateRaidLockoutBadge',
    band: 'slow',
    gate: '',
    surface: 'chrome',
    why: 'the minimap raid-lockout badge class, value-diffed',
  },
  {
    call: 'this.refreshDailyRewardsLauncher',
    band: 'slow',
    gate: '',
    surface: 'chrome',
    why: 'the daily-rewards launcher button state (not the window)',
  },
  {
    call: 'this.maybeRestoreActionBarLayout',
    band: 'frame',
    gate: '',
    surface: 'none',
    why: 'one-shot latch that reloads the saved action-bar layout once',
  },
  {
    call: 'this.paladinDevotionPainter.paint',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'write-elided paladin Devotion/Ascension resource widget driven by the paladinDevotionView core',
  },
  {
    call: 'this.syncActiveHotbarForm',
    band: 'frame',
    gate: '',
    surface: 'none',
    why: 'action-bar controller state sync; no DOM',
  },
  {
    call: 'this.syncSlotMap',
    band: 'frame',
    gate: '',
    surface: 'none',
    why: 'picks up newly learned abilities mid-session; no DOM',
  },
  {
    call: 'document.getElementById().classList.toggle',
    band: 'frame',
    gate: '',
    sites: 2,
    surface: 'chrome',
    why: 'the unspent-talent-points glow on the desktop and mobile talent buttons',
  },
  {
    call: 'this.isInTown',
    band: 'slow',
    gate: '',
    surface: 'none',
    why: 'the zone read behind the Town Focus button and the open panel gate; no DOM write',
  },
  {
    call: 'this.refreshOpenTownFocusIfChanged',
    band: 'slow',
    gate: '',
    surface: 'window',
    guard: { kind: 'hud', proof: 'if (sig === this.lastTownFocusSig) return;' },
    why: 'rebuilds the Town Focus window when the allocation draft or the in-town flag moves. The standing exception of this table until #2500, when the open check was the whole gate and an idle panel rebuilt its whole subtree twice a second, restoring scrollTop but destroying keyboard focus',
  },
  {
    call: 'this.renderCrafting',
    band: 'slow',
    gate: "$('#crafting-window').style.display === 'flex' && stationTypesSignature(inRangeStationTypes(sim.stationPlacements, sim.player.pos, sim.activeMobileStationCraft)) !== this.lastCraftingStationSig",
    surface: 'window',
    guard: { kind: 'callsite' },
    why: 'rebuilds the crafting window when the in-range station-type set changes',
  },
  {
    call: 'this.refreshOpenCraftingIfReagentsChanged',
    band: 'slow',
    gate: '',
    surface: 'window',
    guard: {
      kind: 'hud',
      proof:
        'if (craftingReagentSig(this.sim.inventory, this.sim.player.name) === this.lastCraftingReagentSig) return;',
    },
    why: 'the other half of the Craft gate: rebuilds the crafting window when the bags move',
  },
  {
    call: 'this.paintOpenCraftingCastProgress',
    band: 'frame',
    gate: '',
    surface: 'window',
    guard: {
      kind: 'hud',
      proof: 'if (craftCastActivitySig(session) !== this.lastCraftingCastSig) {',
    },
    why: 'in-window craft-cast progress strip: full rebuild only when the activity signature moves, fill-only ticks while casting',
  },
  {
    call: 'this.playerFramePainter.paint',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'the player unit frame, facet-routed',
  },
  {
    call: 'this.updateLowHealthVignette',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'the low-health vignette class and its two custom properties, through the elided writers',
  },
  {
    call: 'this.updateLowResource',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'the low-resource pulse on the player resource bar',
  },
  {
    call: 'this.setDisplay',
    band: 'frame',
    gate: "p.resourceType === 'energy'",
    surface: 'chrome',
    why: 'shows the combo-point row for energy users, through the elided writer',
  },
  {
    call: 'this.writerFacet.setAttr',
    band: 'frame',
    gate: "p.resourceType === 'energy'",
    sites: 4,
    surface: 'chrome',
    why: 'combo-row a11y state (aria hidden/valuenow/valuetext/label), elided writer',
  },
  {
    call: 'this.writerFacet.setAttr',
    band: 'frame',
    gate: "!(p.resourceType === 'energy')",
    surface: 'chrome',
    why: 'hides the combo row for non-energy classes, through the elided writer',
  },
  {
    call: 'this.doomMeter.paint',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'write-elided Warlock Doom meter driven by its own view core',
  },
  {
    call: 'this.procOverlayPainter.paintNecromancyCharges',
    band: 'frame',
    gate: "this.sim.talentSpec === 'demonology'",
    surface: 'chrome',
    why: 'Demonology necromancy charge pips on the proc overlay',
  },
  {
    call: 'this.procOverlayPainter.paintDestructionMarks',
    band: 'frame',
    gate: "!(this.sim.talentSpec === 'demonology') && this.sim.talentSpec === 'destruction'",
    surface: 'chrome',
    why: 'Destruction burn marks on the proc overlay',
  },
  {
    call: 'this.procOverlayPainter.paintChronoCharges',
    band: 'frame',
    gate: "!(this.sim.talentSpec === 'demonology') && !(this.sim.talentSpec === 'destruction') && this.sim.talentSpec === 'arcane'",
    surface: 'chrome',
    why: 'Chronomancy charge pips on the proc overlay',
  },
  {
    call: 'this.procOverlayPainter.paintFrostCharges',
    band: 'frame',
    gate: "!(this.sim.talentSpec === 'demonology') && !(this.sim.talentSpec === 'destruction') && !(this.sim.talentSpec === 'arcane') && this.sim.talentSpec === 'frost'",
    surface: 'chrome',
    why: 'Frost icicle pips on the proc overlay',
  },
  {
    call: 'this.procOverlayPainter.paint',
    band: 'frame',
    gate: "!(this.sim.talentSpec === 'demonology') && !(this.sim.talentSpec === 'destruction') && !(this.sim.talentSpec === 'arcane') && !(this.sim.talentSpec === 'frost')",
    surface: 'chrome',
    why: 'the generic proc overlay for every spec without its own charge readout',
  },
  {
    call: 'this.comboRowEl.appendChild',
    band: 'frame',
    gate: "p.resourceType === 'energy' && this.comboRowEl.children.length !== COMBO_PIP_COUNT",
    surface: 'chrome',
    why: 'lazily builds the combo pips ONCE; the child-count check is the one-shot latch',
  },
  {
    call: 'this.toggleClass',
    band: 'frame',
    gate: "p.resourceType === 'energy'",
    surface: 'chrome',
    why: 'lights each combo pip, through the elided writer',
  },
  {
    call: 'this.setDisplay',
    band: 'frame',
    gate: "!(p.resourceType === 'energy')",
    surface: 'chrome',
    why: 'hides the combo-point row for every other resource type',
  },
  {
    call: 'this.buffBarPainter.paint',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'the SELF buff row: never tier-gated, every frame on every graphics preset (the debuff row below and the target debuffs strip further down share this rule)',
  },
  {
    call: 'this.debuffBarPainter.paint',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'the SELF debuff row: never tier-gated (your own debuffs are the ACTIONABLE read, docs/design/graphics-settings-fairness.md), so it paints every frame on every graphics preset, same as the target debuffs strip',
  },
  {
    call: 'this.targetReannounce.mark',
    band: 'frame',
    gate: "target && target.kind !== 'object' && target.id !== this.lastAnnouncedTargetId",
    surface: 'chrome',
    why: 'marks the target-name announcement so a same-named re-target still re-reads; its result is written straight to the target live region, deliberately NOT through the elided writer, and the id gate makes that an event write rather than a per-frame one',
  },
  {
    call: 'this.targetFramePainter.paint',
    band: 'frame',
    gate: "target && target.kind !== 'object' && nonSelfRepaintDue(targetChanged, this.lastTargetFramePaintAt, now, targetFrameNonSelfIntervalMs(fxTier))",
    surface: 'chrome',
    why: 'the target unit frame; a target swap bypasses the non-self throttle',
  },
  {
    call: 'this.toggleClass',
    band: 'frame',
    gate: "target && target.kind !== 'object'",
    sites: 3,
    surface: 'chrome',
    why: 'the target elite class, the boss class, and the forced-colors hostile cue',
  },
  {
    call: 'this.setText',
    band: 'frame',
    gate: "target && target.kind !== 'object'",
    surface: 'chrome',
    why: 'the target elite/boss tag text',
  },
  {
    call: 'this.setStyleProp',
    band: 'frame',
    gate: "target && target.kind !== 'object'",
    surface: 'chrome',
    why: 'the target name color (staff role, else hostile/friendly)',
  },
  {
    call: 'this.updateTargetDiscordLine',
    band: 'frame',
    gate: "target && target.kind !== 'object'",
    surface: 'chrome',
    why: 'the Discord nickname/rank/role line under the target healthbar, signature-gated',
  },
  {
    call: 'this.targetDebuffsPainter.paint',
    band: 'frame',
    gate: "target && target.kind !== 'object'",
    surface: 'chrome',
    why: 'the complete target aura strip, full-rate and tier-neutral because every aura is actionable',
  },
  {
    call: 'this.targetAurasView.tick',
    band: 'frame',
    gate: "target && target.kind !== 'object'",
    surface: 'none',
    why: 'derives the complete own-first model shared by the classic strip and optional detail window',
  },
  {
    call: 'this.targetAurasWindow.paint',
    band: 'frame',
    gate: "target && target.kind !== 'object' && this.targetAurasWindow.isVisible",
    surface: 'window',
    guard: { kind: 'callsite' },
    why: 'updates the pooled detailed target-aura panel, with a target swap bypassing the cadence',
  },
  {
    call: 'this.targetCastBarPainter.paint',
    band: 'frame',
    gate: "target && target.kind !== 'object'",
    surface: 'chrome',
    why: 'the target/boss cast bar (a raid mechanic indicator, deliberately untiered)',
  },
  {
    call: 'this.totFramePainter.paint',
    band: 'frame',
    gate: "target && target.kind !== 'object' && tot && tot.kind !== 'object' && nonSelfRepaintDue(totChanged, this.lastTotFramePaintAt, now, targetFrameNonSelfIntervalMs(fxTier))",
    surface: 'chrome',
    why: 'the target-of-target mini frame',
  },
  {
    call: 'this.totFramePainter.paint',
    band: 'frame',
    gate: "target && target.kind !== 'object' && !(tot && tot.kind !== 'object')",
    surface: 'chrome',
    why: 'hides the target-of-target frame and resets its portrait gate',
  },
  {
    call: 'this.targetReannounce.reset',
    band: 'frame',
    gate: "!(target && target.kind !== 'object') && this.lastAnnouncedTargetId !== null",
    surface: 'none',
    why: 'clears the re-announce marker on the no-target EDGE; the tracker keeps it off the per-frame path',
  },
  {
    call: 'this.targetFramePainter.paint',
    band: 'frame',
    gate: "!(target && target.kind !== 'object')",
    surface: 'chrome',
    why: 'hides the target frame when there is no target',
  },
  {
    call: 'this.ownPet',
    band: 'frame',
    gate: '',
    surface: 'none',
    why: 'resolves the player-owned pet out of the entity roster ONCE per frame (findOwnPet, pet_frame_view.ts, early-returning), shared by the pet frame here and renderPetBar below, which takes it as a parameter; ungated on purpose because the pet BAR needs it whatever showPetFrame says, and it replaces the scan renderPetBar previously did itself, so the frame costs no extra walk',
  },
  {
    call: 'this.petFramePainter.paint',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'the pet health frame under the player frame, deliberately UNTIERED and on the frame band (pet health is information the owner acts on, so a tier knob may not delay it); every write is elided, so a pet at steady health costs nothing, and a null pet paints it hidden',
  },
  {
    call: 'this.targetAurasWindow.clear',
    band: 'frame',
    gate: "!(target && target.kind !== 'object')",
    surface: 'window',
    guard: {
      kind: 'module',
      module: 'target_auras_window.ts',
      proof: 'if (this.cleared) return;',
    },
    why: 'clears the target aura rows while preserving the always-visible transparent handle',
  },
  {
    call: 'this.totFramePainter.paint',
    band: 'frame',
    gate: "!(target && target.kind !== 'object')",
    surface: 'chrome',
    why: 'hides the target-of-target frame when there is no target',
  },
  {
    call: 'this.playerCastBarPainter.paint',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'the player cast bar plus the eat/drink overlay',
  },
  {
    call: 'this.swingTimerPainter.paint',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'the auto-attack swing timer',
  },
  {
    call: 'this.procOverlayEl.classList.add',
    band: 'frame',
    gate: "!this.procOverlayPreviewed && this.sim.talentSpec === 'fire'",
    surface: 'chrome',
    why: 'the one-shot login preview of the proc bird; the latch field is the guard',
  },
  {
    call: 'window.setTimeout',
    band: 'frame',
    gate: "!this.procOverlayPreviewed && this.sim.talentSpec === 'fire'",
    surface: 'chrome',
    why: 'clears that preview after 8 s; a one-shot behind the same latch, not a repeating driver',
  },
  {
    call: 'this.auraOverlayController.paint',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'the configured Warrior proc frames; writer-facet toggles elide unchanged states',
  },
  {
    call: 'this.renderPetBar',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'the pet bar; rebuilds its buttons behind a signature latch',
  },
  {
    call: 'this.renderStanceBar',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'the stance/form bar; rebuilds its buttons behind a signature latch',
  },
  {
    call: 'this.flushPendingProcAuraNotes',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'drains queued proc self-notes; early-outs on an empty set',
  },
  {
    call: 'this.spellbookWindow.tickOpen',
    band: 'frame',
    gate: 'this.spellbookWindow.isOpen',
    surface: 'window',
    guard: {
      kind: 'module',
      module: 'spellbook_window.ts',
      proof: 'if (this.knownChanged(this.deps.world().known)) {',
    },
    why: 'the ONLY window on the per-frame band, and since #2519 BOTH of its halves are gated: the guard proved below (knownChanged, an in-place walk of the resolved-ability numbers, no signature string built per frame) gates the rebuild, and the fall-through hotbar-control refresh takes its own change check (takeControlChange) over the three bar inputs its toggles render, so an unchanged frame makes no lookup, no allocation and no DOM write',
  },
  {
    call: 'this.actionBarPainter.paint',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'the desktop action bar, facet-routed',
  },
  {
    call: 'this.currentMobileActionPage',
    band: 'frame',
    gate: 'this.isMobileLayout() && this.mobileActionRingView && this.mobileActionRingPainter',
    surface: 'none',
    why: 'selects the active source page for the touch action ring; no DOM write',
  },
  {
    call: 'this.mobileActionSourceSlotCount',
    band: 'frame',
    gate: 'this.isMobileLayout() && this.mobileActionRingView && this.mobileActionRingPainter',
    surface: 'none',
    why: 'counts the source slots that determine the touch action ring pagination; no DOM write',
  },
  {
    call: 'this.mobileActionRingPainter.paint',
    band: 'frame',
    gate: 'this.isMobileLayout() && this.mobileActionRingView && this.mobileActionRingPainter',
    surface: 'chrome',
    why: 'the touch action ring; desktop skips the tick and the paint entirely',
  },
  {
    call: 'this.consumableBarPainter.paint',
    band: 'frame',
    gate: 'this.isMobileLayout() && this.consumablesOpen && this.consumableBarView && this.consumableBarPainter',
    surface: 'chrome',
    why: 'the touch consumables quick bar, only while the row is expanded',
  },
  {
    call: 'this.xpBarPainter.paint',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'the XP bar, including the max-level overflow styling',
  },
  {
    call: 'this.fctPainter.step',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'TTL-recycles the floating-combat-text pool; returns immediately when empty',
  },
  {
    call: 'this.closeResurrectionPrompt',
    band: 'frame',
    gate: '!p.dead',
    surface: 'chrome',
    why: 'removes the resurrection prompt node once the player is alive',
  },
  {
    call: 'document.body.classList.toggle',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'the spirit-mode body class that drains the world to greyscale',
  },
  {
    call: 'this.setDisplay',
    band: 'frame',
    gate: '',
    surface: 'chrome',
    why: 'the full-screen death overlay, through the elided writer',
  },
  {
    call: 'this.setDisplay',
    band: 'frame',
    gate: 'ghost && !ghostInBgMatch',
    sites: 3,
    surface: 'chrome',
    why: 'the ghost prompt and its two resurrect buttons; a battleground spirit is exempt because the respawn wave is its only way back',
  },
  {
    call: 'this.setDisplay',
    band: 'frame',
    gate: '!(ghost && !ghostInBgMatch)',
    surface: 'chrome',
    why: 'hides the ghost prompt while not a corpse-running ghost',
  },
  {
    call: 'this.showBanner',
    band: 'medium',
    gate: "!inDungeon && currentZone.id !== this.lastZoneId && this.lastZoneId !== ''",
    surface: 'chrome',
    why: 'the zone banner on a real zone crossing, committed the moment zoneAt flips (the old z-only dead band never fired on an east-west realm crossing)',
  },
  {
    call: 'this.log',
    band: 'medium',
    gate: "!inDungeon && currentZone.id !== this.lastZoneId && this.lastZoneId !== ''",
    surface: 'chrome',
    why: 'the zone-entry chat line',
  },
  {
    call: 'this.logZoneWelcome',
    band: 'medium',
    gate: "!inDungeon && currentZone.id !== this.lastZoneId && this.lastZoneId !== ''",
    surface: 'chrome',
    why: 'the zone welcome blurb in chat',
  },
  {
    call: 'this.renderer.vistaPan',
    band: 'medium',
    gate: "!inDungeon && currentZone.id !== this.lastZoneId && this.lastZoneId !== '' && !p.dead && !p.inCombat && !recentCombat",
    surface: 'none',
    why: 'the zone-entry camera sweep; a renderer call, not a HUD write',
  },
  {
    call: 'this.prewarmMapBg',
    band: 'medium',
    gate: '!inDungeon && currentZone.id !== this.lastZoneId',
    surface: 'none',
    why: 'idle-schedules the new zone map background into an offscreen canvas',
  },
  {
    call: 'this.mountRaceStrip.repaintIfChanged',
    band: 'frame',
    gate: '',
    surface: 'window',
    guard: {
      kind: 'module',
      module: 'mount_race_strip.ts',
      proof:
        'if (view.raceId !== this.lastRaceId || view.phase !== this.lastPhase || second !== this.lastSecond) {',
    },
    why: 'the show-jumping race timer strip; the same per-frame safety net as lockpick, behind a display check and a sig diff bucketed to whole seconds',
  },
  {
    call: 'this.mountRaceControls.update',
    band: 'frame',
    gate: '',
    surface: 'window',
    guard: {
      kind: 'module',
      module: 'mount_race_controls.ts',
      proof: 'if (!button || mode === this.buttonMode) return;',
    },
    why: 'the Start/Cancel Race button and the 3..2..1..GO countdown; each painter returns early on an unchanged mode',
  },
  {
    call: 'this.showSubzone',
    band: 'medium',
    gate: 'subzone !== this.lastSubzone && subzone',
    surface: 'chrome',
    why: 'the subzone banner on a landmark crossing',
  },
  {
    call: 'this.instanceMusic.update',
    band: 'medium',
    gate: '',
    surface: 'none',
    why: 'the zone/combat/boss music state machine, and the source of the inCombat and atSowfield reads under it; audio only',
  },
  {
    call: 'this.toggleClass',
    band: 'medium',
    gate: '',
    surface: 'chrome',
    why: 'the combat swords/ring on the player portrait, through the elided writer',
  },
  {
    call: 'restEl.classList.toggle',
    band: 'medium',
    gate: 'rest.resting !== this.lastResting',
    surface: 'chrome',
    why: 'the resting zZz on the player portrait, behind an edge latch',
  },
  {
    call: 'this.updateQuestTracker',
    band: 'medium',
    gate: '',
    surface: 'chrome',
    why: 'the quest tracker, rebuilt behind an html diff',
  },
  {
    call: 'this.updateDelveTracker',
    band: 'medium',
    gate: '',
    surface: 'chrome',
    why: 'the delve tracker',
  },
  {
    call: 'this.updateRiftTracker',
    band: 'medium',
    gate: '',
    surface: 'chrome',
    why: 'the rift floor + closing-timer tracker (#2655), signature-gated on floor/timer numbers',
  },
  {
    call: 'this.updatePartyFrames',
    band: 'medium',
    gate: '',
    surface: 'window',
    guard: { kind: 'hud', proof: 'if (sig !== this.lastLootSettingsSig) {' },
    why: 'the party frames (a pooled painter) AND, via paintLootSettings, the loot-settings window',
  },
  {
    call: 'this.updateTradeWindow',
    band: 'medium',
    gate: '',
    surface: 'window',
    guard: { kind: 'hud', proof: 'if (sig === this.lastTradeSig) return;' },
    why: 'the trade window, rebuilt on a signature change; also auto-opens it on a trade start',
  },
  {
    call: 'this.updateArenaStatus',
    band: 'medium',
    gate: '',
    surface: 'chrome',
    why: 'the arena status banner, signature-gated',
  },
  {
    call: 'this.updateFiestaHud',
    band: 'medium',
    gate: '',
    surface: 'chrome',
    why: 'the fiesta score, respawn, offer and augment overlays',
  },
  {
    call: 'this.bgScoreboard.update',
    band: 'medium',
    gate: '',
    surface: 'chrome',
    why: 'the Thornhollow Fields in-match strip, the wave-respawn overlay and the spawn-protection line; the view core short-circuits an inactive match',
  },
  {
    call: 'this.bgKillFeed.update',
    band: 'medium',
    gate: '',
    surface: 'chrome',
    why: 'ages out the Thornhollow Fields banner kill feed on its own clock, so an entry expires with no new event to drive it',
  },
  {
    call: 'this.yumiPainter.update',
    band: 'medium',
    gate: '',
    surface: 'chrome',
    why: 'the arena match strip, facet-routed',
  },
  {
    call: 'this.vcupIndicator.update',
    band: 'medium',
    gate: '',
    surface: 'chrome',
    why: 'the Vale Cup minimap indicator button',
  },
  {
    call: 'this.vcupMatchHud.update',
    band: 'medium',
    gate: '',
    surface: 'chrome',
    why: 'the Vale Cup in-match strip',
  },
  {
    call: 'this.vcupBriefing.update',
    band: 'medium',
    gate: '',
    surface: 'window',
    guard: { kind: 'module', module: 'vale_cup_briefing.ts', proof: VIEW_SIG_BLOCK },
    why: 'the Vale Cup briefing card, a self-mounting full-screen panel',
  },
  {
    call: 'this.vcupBetting.update',
    band: 'medium',
    gate: '',
    surface: 'window',
    guard: { kind: 'module', module: 'vale_cup_betting.ts', proof: VIEW_SIG_BLOCK },
    why: 'the Vale Cup betting banner and card',
  },
  {
    call: 'this.updateShootCharge',
    band: 'medium',
    gate: '',
    surface: 'chrome',
    why: 'the Vale Cup shot-charge meter',
  },
  {
    call: 'this.updateMapWindow',
    band: 'medium',
    gate: "$('#map-window').style.display === 'block'",
    surface: 'window',
    guard: {
      kind: 'none',
      why: 'the open check is the whole gate: the map canvas is re-stroked 4x/sec while the window is open, which is a canvas redraw rather than a DOM rebuild and is why it has never needed one',
    },
    why: 'repaints the map window canvas and its summary line',
  },
  {
    call: 'this.arenaWindow.render',
    band: 'medium',
    gate: "$('#arena-window').style.display === 'block'",
    surface: 'window',
    guard: { kind: 'module', module: 'arena_window.ts', proof: RAVENRIFT_SIG_RETURN },
    why: 'the merged PvP window (Thornhollow Fields and arena tabs); each tab arm builds its\n      own signature and returns on an unchanged one',
  },
  {
    call: 'this.dungeonFinderWindow.render',
    band: 'medium',
    gate: "$('#dungeon-finder-window').style.display === 'flex'",
    surface: 'window',
    guard: {
      kind: 'module',
      module: 'dungeon_finder_window.ts',
      proof: 'if (sig === this.lastSig) {',
    },
    why: 'the dungeon finder window; an unchanged sig still ticks its 1 Hz clock text',
  },
  {
    call: 'this.dungeonFinderProposalPopup.render',
    band: 'medium',
    gate: 'this.dungeonFinderProposalPopup.isOpen',
    surface: 'window',
    guard: {
      kind: 'module',
      module: 'dungeon_finder_proposal_popup.ts',
      proof: VIEW_SIG_BLOCK,
    },
    why: 'the ready-check popup; a bare-named module the painter gate does not sweep',
  },
  {
    call: 'this.bgProposalPopup.render',
    band: 'medium',
    gate: 'this.bgProposalPopup.isOpen',
    surface: 'window',
    guard: {
      kind: 'module',
      module: 'hud/battleground/battleground_proposal_popup.ts',
      proof: VIEW_SIG_BLOCK,
    },
    why: 'the battleground queue-pop prompt; a *_popup name the painter gate does not sweep either',
  },
  {
    call: 'this.valeCupWindow.render',
    band: 'medium',
    gate: "$('#valecup-window').style.display === 'block'",
    surface: 'window',
    guard: { kind: 'module', module: 'vale_cup_window.ts', proof: VIEW_SIG_RETURN },
    why: 'the Vale Cup queue window',
  },
  {
    call: 'this.cardDuelWindow.toggle',
    band: 'medium',
    gate: 'cardDuelInMatch && !this.cardDuelWasInMatch && !this.cardDuelWindow.isOpen',
    surface: 'window',
    guard: { kind: 'callsite' },
    why: 'auto-opens the card duel window on the false->true match edge',
  },
  {
    call: 'this.cardDuelWindow.render',
    band: 'medium',
    gate: "$('#card-duel-window').style.display === 'block'",
    surface: 'window',
    guard: { kind: 'module', module: 'card_duel_window.ts', proof: SIG_RETURN },
    why: 'the card duel window',
  },
  {
    call: 'this.lootWindow.updateProximity',
    band: 'medium',
    gate: '',
    surface: 'window',
    guard: {
      kind: 'none',
      why: 'no latch field: it is close-only, gated on a non-null corpse/chest id plus a range test, and nulling the id disarms it',
    },
    why: 'closes the loot window when the player walks away from the corpse or chest',
  },
  {
    call: 'this.closeVendor',
    band: 'medium',
    gate: 'this.openVendorNpcId !== null && (!npc || dist2d(p.pos, npc.pos) > NPC_WINDOW_CLOSE_RANGE)',
    surface: 'window',
    guard: { kind: 'callsite' },
    why: 'closes the vendor window out of range',
  },
  {
    call: 'this.closeHeroicVendor',
    band: 'medium',
    gate: 'this.openHeroicVendorNpcId !== null && (!npc || dist2d(p.pos, npc.pos) > NPC_WINDOW_CLOSE_RANGE)',
    surface: 'window',
    guard: { kind: 'callsite' },
    why: 'closes the heroic vendor window out of range',
  },
  {
    call: 'this.closeWarfareVendor',
    band: 'medium',
    gate: 'this.openWarfareVendorNpcId !== null && (!npc || dist2d(p.pos, npc.pos) > NPC_WINDOW_CLOSE_RANGE)',
    surface: 'window',
    guard: { kind: 'callsite' },
    why: 'closes the WARFARE quartermaster shop out of range',
  },
  {
    call: 'this.closeTrain',
    band: 'medium',
    gate: 'this.openTrainNpcId !== null && (!npc || dist2d(p.pos, npc.pos) > NPC_WINDOW_CLOSE_RANGE)',
    surface: 'window',
    guard: { kind: 'callsite' },
    why: 'closes the trainer window out of range',
  },
  {
    call: 'this.closeUnbind',
    band: 'medium',
    gate: 'this.openUnbindNpcId !== null && (!npc || dist2d(p.pos, npc.pos) > NPC_WINDOW_CLOSE_RANGE)',
    surface: 'window',
    guard: { kind: 'callsite' },
    why: 'closes the unbind window out of range',
  },
  {
    call: 'this.questDialog.updateProximity',
    band: 'medium',
    gate: '',
    surface: 'window',
    guard: {
      kind: 'none',
      why: 'no latch field: close-only, gated on a non-null npc id plus a range test',
    },
    why: 'closes the gossip dialog when the player walks away from the NPC',
  },
  {
    call: 'this.arenaWindow.close',
    band: 'frame',
    gate: "inArenaMatch && !this.arenaMatchSeen && $('#arena-window').style.display === 'block'",
    surface: 'window',
    guard: { kind: 'callsite' },
    why: 'gets the arena queue window out of the way when a bout starts; the seen latch makes it an edge',
  },
  {
    call: 'this.arenaWindow.close',
    band: 'frame',
    gate: "inBgMatch && !this.bgMatchSeen && $('#arena-window').style.display === 'block'",
    surface: 'window',
    guard: { kind: 'callsite' },
    why: "the same edge close when a Thornhollow Fields match seats: the queue lives on that window's Thornhollow Fields tab",
  },
  {
    call: 'this.valeCupWindow.close',
    band: 'frame',
    gate: "inVcupMatch && !this.vcupMatchSeen && $('#valecup-window').style.display === 'block'",
    surface: 'window',
    guard: { kind: 'callsite' },
    why: 'the same edge close for the Vale Cup queue window',
  },
  {
    call: 'this.updateMinimap',
    band: 'fast',
    gate: 'cadenceDue(this.lastMinimapDrawAt, now, minimapRedrawIntervalMs(fxTier))',
    surface: 'chrome',
    why: 'the minimap canvas redraw, the heaviest fast-band item, tier-coarsened',
  },
  {
    call: 'this.updateClock',
    band: 'fast',
    gate: '',
    surface: 'chrome',
    why: 'the minimap clock text, value-diffed',
  },
  {
    call: 'this.updateDayNightDial',
    band: 'fast',
    gate: '',
    surface: 'chrome',
    why: 'the decorative day/night ring beside the minimap, repainted from the same world clock',
  },
  {
    call: 'this.updateMinimapCoords',
    band: 'fast',
    gate: '',
    surface: 'chrome',
    why: 'the minimap coordinate readout, value-diffed',
  },
  {
    call: 'this.updateCompass',
    band: 'fast',
    gate: '',
    surface: 'chrome',
    why: 'the compass marks and heading; early-outs on an unchanged facing',
  },
  {
    call: 'this.socialWindow.refreshIfChanged',
    band: 'slow',
    gate: '',
    surface: 'window',
    guard: {
      kind: 'module',
      module: 'social_window.ts',
      proof: 'if (struct !== this.lastStruct) {',
    },
    why: 'the social window; a struct change rebuilds, a content change refreshes the list only',
  },
  {
    call: 'this.updateGuildBillboardEcho',
    band: 'slow',
    gate: '',
    surface: 'chrome',
    why: 'appends one guild-billboard line to the chat log, latched on the MOTD value in guild_motd_login.ts (login and mid-session changes only, never on unrelated social re-pushes)',
  },
  {
    call: 'this.marketWindow.close',
    band: 'slow',
    gate: 'this.marketWindow.isOpen && !this.nearbyMarketNpc()',
    surface: 'window',
    guard: { kind: 'callsite' },
    why: 'closes the market window when the player leaves the auctioneer',
  },
  {
    call: 'this.marketWindow.refreshIfChanged',
    band: 'slow',
    gate: 'this.marketWindow.isOpen && !(!this.nearbyMarketNpc())',
    surface: 'window',
    guard: { kind: 'module', module: 'market_window.ts', proof: SIG_RETURN },
    why: 'the market window',
  },
  {
    call: 'this.mailboxWindow.refreshIfChanged',
    band: 'slow',
    gate: 'this.mailboxWindow.isOpen',
    surface: 'window',
    guard: { kind: 'module', module: 'mailbox_window.ts', proof: SIG_RETURN },
    why: 'the mailbox window; it also closes itself when the mail mirror goes null',
  },
  {
    call: 'this.bankWindow.refreshIfChanged',
    band: 'slow',
    gate: 'this.bankWindow.isOpen',
    surface: 'window',
    guard: { kind: 'module', module: 'bank_window.ts', proof: SIG_RETURN },
    why: 'the bank window; it also closes itself when the bank mirror goes null',
  },
  {
    call: 'this.bagsWindow.refreshIfChanged',
    band: 'slow',
    gate: '',
    surface: 'window',
    guard: {
      kind: 'module',
      module: 'bags_window.ts',
      proof:
        'if (!bagsMoneyRowStale(el.style.display, this.deps.world().copper, this.lastMoneyCopper)) return;',
    },
    why: 'DELIBERATELY has no isOpen gate: the money-footer backstop (#2373) that converges every copper credit reaching no bags arm',
  },
  {
    call: 'this.deedsWindow.refreshIfChanged',
    band: 'slow',
    gate: 'this.deedsWindow.isOpen',
    surface: 'window',
    guard: { kind: 'module', module: 'deeds_window.ts', proof: SIG_RETURN },
    why: 'the Book of Deeds window',
  },
  {
    call: 'this.refreshOpenProfessionSurfacesIfChanged',
    band: 'slow',
    gate: '',
    surface: 'window',
    guard: { kind: 'hud', proof: 'if (sig === this.lastProfessionSurfaceSig) return;' },
    why: 'repaints the character window and the crafting window when a profession number moves',
  },
  {
    call: 'this.professionsWindow.refreshIfChanged',
    band: 'slow',
    gate: 'this.professionsWindow.isOpen',
    surface: 'window',
    guard: {
      kind: 'module',
      module: 'professions_window.ts',
      // The guard compares the freshly built input's signature directly (no
      // local sig binding): render() re-latches lastSig from the one input it
      // painted, so this band never re-acts on a stale one.
      proof:
        'const input = this.buildInput(); const sig = professionsRefreshSig(input); if (sig === this.lastSig) return;',
    },
    why: 'the professions window',
  },
  {
    call: 'this.questDialog.refreshIfChanged',
    band: 'slow',
    gate: '',
    surface: 'window',
    guard: {
      kind: 'module',
      module: 'hud/quest/quest_dialog_controller.ts',
      proof:
        'if (this.introHintVisibleFor(npc) !== this.lastIntroHintVisible || gossipRowSig(this.offerableRows(npc)) !== this.lastGossipRowSig) { this.refresh(); }',
    },
    why: "the gossip dialog's intro hint row plus the offerable-row set (phase 23: a cadence lapse re-offers a work order), both edges no quest event fires for",
  },
  {
    call: 'this.updateDeedTracker',
    band: 'slow',
    gate: '',
    surface: 'chrome',
    why: 'the always-on deed tracker (not gated on a window)',
  },
  {
    call: 'this.calendarWindow.refreshIfChanged',
    band: 'slow',
    gate: 'this.calendarWindow.isOpen',
    surface: 'window',
    guard: { kind: 'module', module: 'calendar_window.ts', proof: SIG_RETURN },
    why: 'the guild calendar window',
  },
  {
    call: 'this.updateMailIndicator',
    band: 'slow',
    gate: '',
    surface: 'chrome',
    why: 'the minimap envelope badge, value-diffed',
  },
  {
    call: 'this.updateMarketIndicator',
    band: 'slow',
    gate: '',
    surface: 'chrome',
    why: 'the minimap market badge, value-diffed',
  },
];

// --------------------------------------------------------------------------
// The verdict path, extracted so a synthetic control can drive it.
// --------------------------------------------------------------------------

/**
 * Both directions of the diff between the registry and the walk.
 *
 * Takes both sides as PARAMETERS, module constants included, so the positive control below
 * runs the same code the real assertion does. Resolving `declared` from `HUD_UPDATE_DRIVES`
 * inside would leave the real path unproven, which is the shape #2497 shipped twice.
 */
function driveProblems(declared: readonly DriveRow[], observed: readonly CallSite[]): string[] {
  const problems: string[] = [];
  const want = new Map<string, number>();
  for (const row of declared) {
    const key = keyOf(row.call, row.band, row.gate);
    if (want.has(key)) {
      problems.push(`${key} (registered twice: merge the rows and set sites)`);
      continue;
    }
    want.set(key, row.sites ?? 1);
  }
  const got = new Map<string, number>();
  for (const site of observed) {
    const { band, gate } = splitBand(site.conditions);
    const key = keyOf(site.call, band, gate);
    got.set(key, (got.get(key) ?? 0) + 1);
  }
  for (const [key, count] of got) {
    const expected = want.get(key);
    if (expected === undefined) problems.push(`${key} (drives ${count}x, registered nowhere)`);
    else if (expected !== count) {
      problems.push(`${key} (drives ${count}x, registered as ${expected})`);
    }
  }
  for (const key of want.keys()) {
    if (!got.has(key)) problems.push(`${key} (registered, drives nothing)`);
  }
  return problems.sort();
}

/**
 * A callee whose own name says it is a window. Case-sensitive on purpose, so the global
 * `window.setTimeout` is not swept in with `this.arenaWindow.render`.
 */
const NAMES_A_WINDOW = /\.\w*(?:Window|Popup)\b/;

/** The per-row shape rules, which nothing about a green diff would otherwise enforce. */
function rowShapeProblems(declared: readonly DriveRow[]): string[] {
  const problems: string[] = [];
  for (const row of declared) {
    const at = keyOf(row.call, row.band, row.gate);
    if (!row.why.trim()) problems.push(`${at} (why is empty: say what it repaints)`);
    if ((row.sites ?? 1) < 1) problems.push(`${at} (sites must be at least 1)`);
    if (row.surface === 'window' && !row.guard) {
      problems.push(`${at} (a window row must name its invalidation guard)`);
    }
    if (row.surface !== 'window' && row.guard) {
      problems.push(`${at} (only a window row carries a guard, so the field cannot rot)`);
    }
    if (row.guard?.kind === 'none' && !row.guard.why.trim()) {
      problems.push(`${at} (guard kind "none" must record WHY there is none)`);
    }
    // The cheapest way out of the guard requirement is to relabel the row rather than fix
    // it, and mutation testing found exactly that: flipping card_duel_window's row to
    // `chrome` dropped its guard with the whole suite green. A name is not proof a call
    // touches a window, but it IS proof of what the author called it, so where the callee
    // says window or popup the classification is not a judgment any more.
    if (NAMES_A_WINDOW.test(row.call) && row.surface !== 'window') {
      problems.push(
        `${at} (a callee named Window/Popup is a window row: it cannot be relabelled ${row.surface} to shed its guard)`,
      );
    }
  }
  return problems;
}

/**
 * The guard proofs: every `module`/`hud` guard's source line must still be in its file.
 *
 * `read` is a parameter so the control can plant a module whose guard was deleted. Both the
 * proof and the source are normalized the same way, so biome reflowing a guard across lines
 * does not fail this, and deleting it does.
 */
function guardProblems(
  declared: readonly DriveRow[],
  read: (module: string) => string,
): { problems: string[]; checked: string[] } {
  const problems: string[] = [];
  const checked: string[] = [];
  for (const row of declared) {
    const guard = row.guard;
    if (!guard || (guard.kind !== 'module' && guard.kind !== 'hud')) continue;
    const module = guard.kind === 'hud' ? 'hud.ts' : guard.module;
    checked.push(`${module}: ${guard.proof}`);
    // Counted, not merely present. Every proof is unique in its module today, which is what
    // makes deleting the guard fail this; the day a second copy appears somewhere else in the
    // file, "contains it" would stay true with the real one gone and the pin would weaken
    // with no diff to notice. An exact count turns that into a loud failure whose fix is to
    // choose a proof line that is still unique.
    const hits = normalizeCondition(read(module)).split(normalizeCondition(guard.proof)).length - 1;
    if (hits !== 1) {
      problems.push(
        hits === 0
          ? `${row.call}: ${module} no longer contains its invalidation guard \`${guard.proof}\``
          : `${row.call}: ${module} contains \`${guard.proof}\` ${hits}x, so the pin no longer identifies one guard`,
      );
    }
  }
  return { problems, checked };
}

// --------------------------------------------------------------------------
// The read.
// --------------------------------------------------------------------------

const UI_DIR = fileURLToPath(new URL('../src/ui/', import.meta.url));
const readUi = (module: string): string => readFileSync(`${UI_DIR}${module}`, 'utf8');
const HUD_PATH = `${UI_DIR}hud.ts`;
const HUD_SOURCE = readFileSync(HUD_PATH, 'utf8');
const scan = readMethodCallSites(HUD_PATH, HUD_SOURCE, 'Hud', 'update');
const observedKeys = scan.sites.map((s) => {
  const { band, gate } = splitBand(s.conditions);
  return keyOf(s.call, band, gate);
});

describe('Hud.update() drives exactly the registered set, on the registered bands', () => {
  it('keeps the classic target strip complete and reuses that model for the detail window', () => {
    const source = readFileSync(HUD_PATH, 'utf8');
    expect(source).toMatch(
      /targetAurasView = createAurasView\('all', this\.aurasViewDeps, \{\s*ownFirst: true,\s*effectHtmlCacheVersion: getLanguage,\s*\}\);/,
    );
    expect(source).toMatch(
      /const targetAuraState = this\.targetAurasView\.tick\(target\);\s*this\.targetDebuffsPainter\.paint\(targetAuraState\);\s*if \(this\.targetAurasWindow\.isVisible\) \{\s*this\.targetAurasWindow\.paint\([^,]+, targetAuraState,/,
    );
    expect(source).not.toContain('targetSummaryAurasView');
  });

  it('keeps target aura visibility and refresh tier-neutral', () => {
    const source = readFileSync(HUD_PATH, 'utf8');
    const painterStart = source.indexOf('private readonly targetDebuffsPainter');
    const painterEnd = source.indexOf('private readonly minimapPainter', painterStart);
    const painterDefinition = source.slice(painterStart, painterEnd);

    expect(painterStart).toBeGreaterThanOrEqual(0);
    expect(painterDefinition).toMatch(
      /private readonly targetDebuffsPainter = new AurasPainter\(\s*this\.writerFacet,\s*this\.targetDebuffsEl,\s*this\.aurasPainterDeps,\s*document,\s*\);/,
    );
    expect(source).not.toContain('lastTargetDebuffsPaintAt');
    expect(source).toMatch(
      /toggleTargetAuras\(\): void \{\s*this\.targetAurasWindow\.toggle\(\);\s*\}/,
    );
  });

  it('feeds the server-authoritative Hunter reactive window into the aura overlay', () => {
    expect(HUD_SOURCE).toMatch(
      /this\.auraOverlayController\.paint\(\s*p\.auras,\s*this\.sim\.reactiveAbilityWindowRemaining\('mongoose_bite'\),?\s*\)/,
    );
  });

  // ANTI-VACUITY FIRST, because every assertion after it is an empty-collection check and an
  // empty collection is what a narrowed walk produces. `readMethodCallSites` THROWS on a
  // missing class or method rather than returning nothing, which is the load-bearing half:
  // the shape risk #2498 named is an extraction behind a controller, and that must be a red
  // test, not a quiet zero. These floors catch the other half, a walk that resolved the file
  // but stopped part way through it.
  it('read a whole, real Hud.update() before asserting anything about it', () => {
    expect(
      scan.classMembers,
      'the Hud class shrank past recognition: re-point this gate',
    ).toBeGreaterThan(600);
    expect(scan.bodyLines, 'Hud.update() shrank past recognition').toBeGreaterThan(400);
    expect(
      scan.sites.length,
      'the statement walk came back short: it stopped parsing',
    ).toBeGreaterThan(100);
    // One floor per band, because three empty bands hide behind one healthy one.
    const perBand = new Map<Band, number>();
    for (const site of scan.sites) {
      const { band } = splitBand(site.conditions);
      perBand.set(band, (perBand.get(band) ?? 0) + 1);
    }
    expect(perBand.get('frame') ?? 0).toBeGreaterThan(45);
    expect(perBand.get('fast') ?? 0).toBeGreaterThan(4);
    expect(perBand.get('medium') ?? 0).toBeGreaterThan(25);
    expect(perBand.get('slow') ?? 0).toBeGreaterThan(15);
  });

  // NAMED POSITIVE CONTROLS, one per band and one per walker arm that a narrowing would
  // silently empty. Each is a different failure mode: the frame-band window is the case the
  // painter gate calls cold; the medium one carries a display-check gate; the slow one carries
  // NO gate on purpose; and the last is the non-`this` arm, which a `this.`-only walk drops
  // without changing any count enough to trip a floor.
  it('finds the five call shapes that a narrowed walk would lose', () => {
    expect(observedKeys).toContain(
      'this.spellbookWindow.tickOpen|frame|this.spellbookWindow.isOpen',
    );
    expect(observedKeys).toContain(
      "this.arenaWindow.render|medium|$('#arena-window').style.display === 'block'",
    );
    expect(observedKeys).toContain('this.bagsWindow.refreshIfChanged|slow|');
    expect(observedKeys).toContain('this.updateClock|fast|');
    expect(observedKeys).toContain('document.body.classList.toggle|frame|');
  });

  it('registers every call Hud.update() makes, and nothing it does not', () => {
    const problems = driveProblems(HUD_UPDATE_DRIVES, scan.sites);
    expect(
      problems,
      `Hud.update()'s drive list and this registry disagree. A NEW call needs a row saying what it repaints, on which band, behind which gate; a REMOVED call needs its row deleted; a MOVED one needs its band or gate updated. That is the point of the table: a repaint added to the per-frame path should cost a diff line here.\n${problems.join('\n')}`,
    ).toEqual([]);
  });

  it('keeps every row well formed', () => {
    const problems = rowShapeProblems(HUD_UPDATE_DRIVES);
    expect(problems, `malformed registry row(s):\n${problems.join('\n')}`).toEqual([]);
    expect(HUD_UPDATE_DRIVES.length).toBeGreaterThan(100);
    // The surface split is pinned EXACTLY, not floored. A floor is what let mutation
    // testing relabel one window row as chrome and shed its guard with the suite green:
    // dropping one of thirty-odd sits comfortably above any floor worth setting. Adding a
    // call to update() already costs a row here, so it costing a number here too is
    // proportionate, and it forces the surface question to be answered out loud.
    const bySurface: Record<Surface, number> = { window: 0, chrome: 0, none: 0 };
    for (const row of HUD_UPDATE_DRIVES) bySurface[row.surface]++;
    expect(
      bySurface,
      "the surface split moved. A new call needs its surface decided; a CHANGED one means a repaint was reclassified, which is the one edit that can quietly drop a window row's invalidation guard.",
    ).toEqual({ window: 45, chrome: 81, none: 17 });
    const windows = HUD_UPDATE_DRIVES.filter((r) => r.surface === 'window');
    expect(windows.map((r) => r.call)).toContain('this.spellbookWindow.tickOpen');
    expect(windows.map((r) => r.call)).toContain('this.refreshOpenTownFocusIfChanged');
    // The guard KINDS are pinned the same way and for the same reason: `kind` is otherwise a
    // free-text opt-out, so a row could keep `surface: 'window'`, keep the counts above
    // intact, and swap `module` for a plausible-sounding `none` while the real guard was
    // deleted from the tree.
    const byKind: Record<string, number> = {};
    for (const row of HUD_UPDATE_DRIVES)
      if (row.guard) byKind[row.guard.kind] = (byKind[row.guard.kind] ?? 0) + 1;
    expect(byKind, 'a guard kind changed: say why in the PR, not only in the table').toEqual({
      module: 23,
      hud: 6,
      callsite: 12,
      none: 4,
    });
    // ...and the honest-exception list by NAME, because that is the one that should never
    // grow quietly: every entry is a window this repo knows has no invalidation guard.
    expect(
      HUD_UPDATE_DRIVES.filter((r) => r.guard?.kind === 'none')
        .map((r) => r.call)
        .sort(),
    ).toEqual([
      'this.lootRolls.update',
      'this.lootWindow.updateProximity',
      'this.questDialog.updateProximity',
      'this.updateMapWindow',
    ]);
  });

  it('still finds every invalidation guard the window rows name', () => {
    const { problems, checked } = guardProblems(HUD_UPDATE_DRIVES, readUi);
    // PINNED EXACTLY, module and proof together, and this is the assertion that carries the
    // whole guard half of the gate. A floor here was the hole mutation testing found twice
    // over: a window row could downgrade its guard to `kind: 'none'` with a plausible
    // sentence, or repoint its `module` at any of the seven other files that spell the proof
    // identically, and both left the count comfortably above any floor while a real guard was
    // deleted from the tree. `if (sig === this.lastSig) return;` appears in seven modules, so
    // the module a row NAMES has to be part of the pin, not just the line it looks for.
    expect(
      [...checked].sort(),
      'the resolved guard list moved. A row changed which module it points at, which line it looks for, or dropped to a guard kind that names no source at all.',
    ).toEqual(
      [
        'arena_window.ts: if (ravenriftSig === this.lastSig) return;',
        'bags_window.ts: if (!bagsMoneyRowStale(el.style.display, this.deps.world().copper, this.lastMoneyCopper)) return;',
        'bank_window.ts: if (sig === this.lastSig) return;',
        'calendar_window.ts: if (sig === this.lastSig) return;',
        'card_duel_window.ts: if (sig === this.lastSig) return;',
        'deeds_window.ts: if (sig === this.lastSig) return;',
        'dungeon_finder_proposal_popup.ts: if (view.sig !== this.lastSig) {',
        'dungeon_finder_window.ts: if (sig === this.lastSig) {',
        'hud/battleground/battleground_proposal_popup.ts: if (view.sig !== this.lastSig) {',
        'hud.ts: if (craftCastActivitySig(session) !== this.lastCraftingCastSig) {',
        'hud.ts: if (craftingReagentSig(this.sim.inventory, this.sim.player.name) === this.lastCraftingReagentSig) return;',
        'hud.ts: if (sig !== this.lastLootSettingsSig) {',
        'hud.ts: if (sig === this.lastProfessionSurfaceSig) return;',
        'hud.ts: if (sig === this.lastTownFocusSig) return;',
        'hud.ts: if (sig === this.lastTradeSig) return;',
        'hud/delve/lockpick_window.ts: if (lockpickRenderSig(view) !== this.lastSig) this.renderBoard();',
        'hud/quest/quest_dialog_controller.ts: if (this.introHintVisibleFor(npc) !== this.lastIntroHintVisible || gossipRowSig(this.offerableRows(npc)) !== this.lastGossipRowSig) { this.refresh(); }',
        'mailbox_window.ts: if (sig === this.lastSig) return;',
        'market_window.ts: if (sig === this.lastSig) return;',
        'meters.ts: if (!this.isOpen || now - this.lastRender < 250) return;',
        'mount_race_controls.ts: if (!button || mode === this.buttonMode) return;',
        'mount_race_strip.ts: if (view.raceId !== this.lastRaceId || view.phase !== this.lastPhase || second !== this.lastSecond) {',
        // The professions guard hashes the freshly built input inline (no local
        // sig binding): render() re-latches lastSig from the one input it
        // painted, so the band never re-acts on a stale signature.
        'professions_window.ts: const input = this.buildInput(); const sig = professionsRefreshSig(input); if (sig === this.lastSig) return;',
        'social_window.ts: if (struct !== this.lastStruct) {',
        // #2519 replaced the joined signature string this used to build every frame with
        // an in-place comparison against the retained numbers; same guard, same place, no
        // per-frame allocation.
        'spellbook_window.ts: if (this.knownChanged(this.deps.world().known)) {',
        'target_auras_window.ts: if (this.cleared) return;',
        'vale_cup_betting.ts: if (view.sig !== this.lastSig) {',
        'vale_cup_briefing.ts: if (view.sig !== this.lastSig) {',
        'vale_cup_window.ts: if (view.sig === this.lastSig) return;',
      ].sort(),
    );
    expect(
      problems,
      `a window on a poll rebuilds only because a signature guard says nothing changed. Deleting one turns a full innerHTML rebuild into a 2 Hz (or per-frame) rebuild that moves no number in any other gate. Restore the guard, or update the row to say where it went:\n${problems.join('\n')}`,
    ).toEqual([]);
  });

  // The bridge to tests/hud_perf_budget.test.ts, and the honest half of it. That gate sweeps
  // three DOM-adapter filenames; a window under a BARE name escapes it entirely, which
  // src/ui/CLAUDE.md already records as a limit. This pins WHICH driven windows are in that
  // hole, so the set cannot grow silently: a new bare-named module polled from update() fails
  // here until someone either renames it into the sweep or adds it to this list on purpose.
  it('names the driven windows the painter gate cannot see', () => {
    const adapterName = /_(?:painter|window|controller)\.ts$/;
    const modules = HUD_UPDATE_DRIVES.flatMap((r) =>
      r.guard?.kind === 'module' ? [r.guard.module] : [],
    );
    expect(
      modules.length,
      'no window row names a module: the guard kinds were gutted',
    ).toBeGreaterThan(15);
    expect(modules.filter((m) => !adapterName.test(m)).sort()).toEqual([
      'dungeon_finder_proposal_popup.ts',
      'hud/battleground/battleground_proposal_popup.ts',
      'meters.ts',
      'mount_race_controls.ts',
      'mount_race_strip.ts',
      'vale_cup_betting.ts',
      'vale_cup_briefing.ts',
    ]);
  });
});

describe('the drive registry checks themselves have teeth', () => {
  const site = (call: string, conditions: string[]): CallSite => ({ call, line: 1, conditions });

  it('splits the cadence latch off the gate, and only the latch', () => {
    expect(splitBand([])).toEqual({ band: 'frame', gate: '' });
    expect(splitBand(['slowHud'])).toEqual({ band: 'slow', gate: '' });
    expect(splitBand(['mediumHud', "$('#x').style.display === 'block'"])).toEqual({
      band: 'medium',
      gate: "$('#x').style.display === 'block'",
    });
    // The compound form: the token shares its condition with a real gate.
    expect(splitBand(['slowHud && this.bankWindow.isOpen'])).toEqual({
      band: 'slow',
      gate: 'this.bankWindow.isOpen',
    });
    // A `&&` INSIDE a call argument is not a top-level separator.
    expect(splitBand(['fastHud && cadenceDue(a && b, c)'])).toEqual({
      band: 'fast',
      gate: 'cadenceDue(a && b, c)',
    });
    // A part holding a top-level `||` is parenthesized, so the joined gate reads as the
    // source expression rather than as a different one with the same tokens.
    expect(splitBand(['mediumHud', 'id !== null', '!npc || far'])).toEqual({
      band: 'medium',
      gate: 'id !== null && (!npc || far)',
    });
    // ...and an already-parenthesized part is not double-wrapped.
    expect(splitBand(['(a || b)'])).toEqual({ band: 'frame', gate: '(a || b)' });
    // An identifier that merely CONTAINS a band token is not one.
    expect(splitBand(['lastSlowHudAt > 0'])).toEqual({ band: 'frame', gate: 'lastSlowHudAt > 0' });
    // A `&&` inside a BRACKET is not a top-level separator either. No live condition in
    // `update()` uses an index access today, so without this the bracket half of the depth
    // counter matches nothing and could be deleted with the suite green.
    expect(splitBand(['slowHud && rows[a && b].open'])).toEqual({
      band: 'slow',
      gate: 'rows[a && b].open',
    });
  });

  // The positive control for the diff. Everything the real assertions do is "expect an array
  // to be empty", which a broken comparator satisfies trivially; this drives the same function
  // over synthetic input with one planted fault of each kind and requires it to REPORT.
  it('reports an unregistered call, an orphan row, and a count that moved', () => {
    const declared: DriveRow[] = [
      { call: 'this.a', band: 'slow', gate: '', surface: 'none', why: 'x' },
      { call: 'this.gone', band: 'frame', gate: '', surface: 'none', why: 'x' },
      { call: 'this.twice', band: 'frame', gate: '', sites: 2, surface: 'none', why: 'x' },
    ];
    const observed = [
      site('this.a', ['slowHud']),
      site('this.surprise', ['mediumHud', 'open']),
      site('this.twice', []),
    ];
    expect(driveProblems(declared, observed)).toEqual([
      'this.gone|frame| (registered, drives nothing)',
      'this.surprise|medium|open (drives 1x, registered nowhere)',
      'this.twice|frame| (drives 1x, registered as 2)',
    ]);
    // ...and it stays silent on a set that agrees, so it is not simply always noisy.
    expect(
      driveProblems(
        [{ call: 'this.a', band: 'slow', gate: 'open', sites: 2, surface: 'none', why: 'x' }],
        [site('this.a', ['slowHud', 'open']), site('this.a', ['slowHud', 'open'])],
      ),
    ).toEqual([]);
    // A key registered twice is caught rather than silently taking the last write.
    expect(
      driveProblems(
        [
          { call: 'this.a', band: 'frame', gate: '', surface: 'none', why: 'x' },
          { call: 'this.a', band: 'frame', gate: '', surface: 'none', why: 'y' },
        ],
        [site('this.a', [])],
      ),
    ).toEqual(['this.a|frame| (registered twice: merge the rows and set sites)']);
  });

  it('reports each kind of malformed row', () => {
    expect(
      rowShapeProblems([
        { call: 'this.a', band: 'frame', gate: '', surface: 'window', why: 'x' },
        {
          call: 'this.b',
          band: 'frame',
          gate: '',
          surface: 'chrome',
          guard: { kind: 'callsite' },
          why: 'x',
        },
        {
          call: 'this.c',
          band: 'frame',
          gate: '',
          surface: 'window',
          guard: { kind: 'none', why: '  ' },
          why: 'x',
        },
        { call: 'this.d', band: 'frame', gate: '', surface: 'none', why: '' },
        { call: 'this.e', band: 'frame', gate: '', sites: 0, surface: 'none', why: 'x' },
        { call: 'this.someWindow.render', band: 'frame', gate: '', surface: 'chrome', why: 'x' },
        // The Popup alternate matches exactly ONE live row, which already passes, so nothing
        // else ever drives it in the reporting direction: the dead-arm shape this repo has
        // shipped twice.
        { call: 'this.somePopup.render', band: 'frame', gate: '', surface: 'chrome', why: 'x' },
      ]),
    ).toEqual([
      'this.a|frame| (a window row must name its invalidation guard)',
      'this.b|frame| (only a window row carries a guard, so the field cannot rot)',
      'this.c|frame| (guard kind "none" must record WHY there is none)',
      'this.d|frame| (why is empty: say what it repaints)',
      'this.e|frame| (sites must be at least 1)',
      'this.someWindow.render|frame| (a callee named Window/Popup is a window row: it cannot be relabelled chrome to shed its guard)',
      'this.somePopup.render|frame| (a callee named Window/Popup is a window row: it cannot be relabelled chrome to shed its guard)',
    ]);
    // The three negatives that pin the rest of the matcher, none of which the positives
    // above can reach. The global `window.` object is lowercase (so the alternation itself
    // rejects it); `windowManager` has no leading dot before the word, which is what the
    // `\.` anchor is for; and `windowed` continues past the word, which is what `\b` is for.
    expect(
      rowShapeProblems([
        { call: 'window.setTimeout', band: 'frame', gate: '', surface: 'chrome', why: 'x' },
        { call: 'windowManager.tick', band: 'frame', gate: '', surface: 'chrome', why: 'x' },
        { call: 'this.windowed.paint', band: 'frame', gate: '', surface: 'chrome', why: 'x' },
      ]),
    ).toEqual([]);
    expect(
      rowShapeProblems([
        {
          call: 'this.ok',
          band: 'slow',
          gate: '',
          surface: 'window',
          guard: { kind: 'callsite' },
          why: 'x',
        },
      ]),
    ).toEqual([]);
  });

  it('reports a guard whose source line is gone, and tolerates a reformatted one', () => {
    const rows: DriveRow[] = [
      {
        call: 'this.kept',
        band: 'slow',
        gate: '',
        surface: 'window',
        guard: {
          kind: 'module',
          module: 'kept_window.ts',
          proof: 'if (sig === this.lastSig) return;',
        },
        why: 'x',
      },
      {
        call: 'this.lost',
        band: 'slow',
        gate: '',
        surface: 'window',
        guard: {
          kind: 'module',
          module: 'lost_window.ts',
          proof: 'if (sig === this.lastSig) return;',
        },
        why: 'x',
      },
    ];
    const sources: Record<string, string> = {
      // Reformatted across lines the way biome would, plus a comment mentioning the guard,
      // which the strip must not accept as the guard itself.
      'kept_window.ts': 'render() {\n  if (\n    sig === this.lastSig\n  )\n    return;\n}',
      'lost_window.ts': '// the lastSig guard used to live here\nrender() { this.rebuild(); }',
    };
    const { problems, checked } = guardProblems(rows, (m) => sources[m]);
    expect(problems).toEqual([
      'this.lost: lost_window.ts no longer contains its invalidation guard `if (sig === this.lastSig) return;`',
    ]);
    expect(checked).toEqual([
      'kept_window.ts: if (sig === this.lastSig) return;',
      'lost_window.ts: if (sig === this.lastSig) return;',
    ]);
  });
});
