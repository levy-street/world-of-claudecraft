// Regression pins for the target-of-target mini-frame placement (src/styles/hud.css
// and the mobile arm in hud.mobile.css). The mini used to anchor BELOW the target
// frame's right edge (right: -6px; top: calc(100% + 6px)), the same band the
// #tf-debuffs strip occupies: the strip wraps full-width, so at real aura counts its
// first row reached the right edge and collided with the mini. The fix anchors the
// mini BESIDE the frame (left of nothing but free canvas), leaving the whole
// below-frame band to the strip; these pins keep the anchor, the compounded mini
// zoom, the portrait-left orientation, and the deliberate mobile arm from regressing.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Biome wraps long declarations across lines, so pin against a whitespace-normalized
// view of the source (collapse runs of whitespace, drop the space a wrap leaves
// inside parentheses); a reformat then never breaks a pin, only a value change does.
const flat = (css: string): string =>
  css.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');
const hudCss = flat(readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8'));
const hudMobileCss = flat(
  readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8'),
);

const rule = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped} \\{([^}]*)\\}`));
  return match?.[1] ?? '';
};

describe('target-of-target frame sits BESIDE the target frame', () => {
  const tot = rule(hudCss, '#target-frame > #totarget-frame');

  it('anchors to the right of the frame, top aligned, gap zoom-compensated', () => {
    // Percentage offsets resolve against the unzoomed containing block but px
    // lengths are multiplied by the element's zoom, so the 18px gap divides by
    // the zoom factor to stay a true 18px at every targetFrameScale.
    expect(tot).toContain('left: calc(100% + 18px / (0.74 * var(--target-frame-scale, 1)));');
    expect(tot).toContain('top: 0;');
    expect(tot).not.toContain('right:');
  });

  it('mini zoom really applies and compounds the target frame scale', () => {
    // The selector needs the #target-frame prefix: a bare #totarget-frame (1,0,0)
    // loses the zoom declaration to the children-zoom rule
    // #target-frame > :not(.tf-move-btn) at (1,1,0), which is why the original
    // plain `zoom: 0.74` never actually applied.
    expect(tot).toContain('zoom: calc(0.74 * var(--target-frame-scale, 1));');
  });

  it('old below-frame anchor (the aura-strip band) must not return', () => {
    expect(hudCss).not.toContain('right: -6px; top: calc(100% + 6px);');
    // The strip still owns the below-frame band on its own.
    expect(rule(hudCss, '#target-frame > #tf-debuffs')).toContain('top: calc(100% + 6px);');
  });

  it('reads portrait-left like every other unit frame (mirror overrides dropped)', () => {
    // The #target-frame prefix outranks the LATER #target-frame .portrait-wrap /
    // .uf-bars mirror rules, which otherwise win the same-specificity tie on
    // source order and mirror the mini too.
    expect(rule(hudCss, '#target-frame > #totarget-frame .portrait-wrap')).toContain('order: 1;');
    const bars = rule(hudCss, '#target-frame > #totarget-frame .uf-bars');
    expect(bars).toContain('order: 2;');
    expect(bars).toContain('margin-left: -16px;');
    expect(bars).toContain('margin-right: 0;');
    expect(bars).toContain('border-radius: 11px 6px 6px 11px;');
  });

  it('boss-ranked target widens the gap past the boss chrome overhangs', () => {
    // The boss move button sits at right: -30px (vs -10px normally) and the
    // dragon emblem overhangs the portrait side by 15px at children-zoom, so
    // the mini needs a true 36px gap to clear both.
    const boss = rule(hudCss, '#target-frame.boss > #totarget-frame');
    expect(boss).toContain('left: calc(100% + 36px / (0.74 * var(--target-frame-scale, 1)));');
  });

  it('rank chrome binds to the target portrait only, never the mini', () => {
    // The mini is a #target-frame descendant, so a bare descendant selector
    // would decorate the mini's portrait with the target's elite ring / boss
    // emblem / boss portrait-chrome strip too.
    expect(hudCss).toContain('#target-frame.elite > .portrait-wrap .portrait {');
    expect(hudCss).toContain('#target-frame.boss > .portrait-wrap::before {');
    expect(hudCss).toContain('#target-frame.boss > .portrait-wrap .portrait {');
    expect(hudCss).not.toContain('#target-frame.elite .portrait {');
    expect(hudCss).not.toContain('#target-frame.boss .portrait {');
    expect(hudCss).not.toContain('#target-frame.boss .portrait-wrap::before {');
  });

  it('mobile makes a deliberate placement decision (no default fallthrough)', () => {
    // The option is reachable from the mobile options sheet, so the mini keeps
    // the beside-the-frame anchor there as an EXPLICIT rule (verified to fit at
    // 844x390 landscape); hiding or moving it must stay a conscious change here.
    const mobile = rule(hudMobileCss, 'body.mobile-touch #target-frame > #totarget-frame');
    expect(mobile).toContain('left: calc(100% + 18px / (0.74 * var(--target-frame-scale, 1)));');
    expect(mobile).toContain('top: 0;');
  });
});

// The mini frame joined the "Unlock interface" frame table (interface_unlock_core.ts
// HUD_FRAME_SPECS), so a player can give it a spot of its own instead of it riding
// wherever the target frame was dragged. Positioning it re-homes it onto #ui
// (detachToUiRoot), which drops EVERY `#target-frame > #totarget-frame` rule pinned
// above at once: these pins are the detached arm that has to restate them.
describe('target-of-target frame: the moved (detached) arm', () => {
  const detached = rule(hudCss, '#totarget-frame.hud-frame-detached');

  it('positions off its own left/top with the other re-homed frames', () => {
    // The shared block, so a dragged mini cannot be left stuck at its docked spot
    // with its saved coordinates silently ignored (what #pet-frame's own
    // `position: relative` used to do before it was id-qualified here).
    expect(hudCss).toContain('#totarget-frame.hud-frame-detached, #stancebar.hud-frame-detached,');
  });

  it('moves the mini zoom onto the CHILDREN, never the positioned frame itself', () => {
    // zoom on a positioned frame also multiplies its used left/top, which is
    // exactly what would break the MovableFrame drag math; the player and target
    // frames zoom their children for the same reason. The mini factor and the
    // targetFrameScale compounding are unchanged from the docked arm above.
    expect(rule(hudCss, '#totarget-frame.hud-frame-detached > :not(.tf-move-btn)')).toContain(
      'zoom: calc(0.74 * var(--target-frame-scale, 1));',
    );
    expect(detached).not.toContain('zoom:');
  });

  it('restates the bar-height var it no longer inherits from #target-frame', () => {
    // #target-frame declares --uf-bar-height for its subtree; re-homed onto #ui
    // the mini would fall back to the 15px default and stop tracking the Target
    // Frame Height setting.
    expect(detached).toContain('--uf-bar-height: var(--target-frame-height, 15px);');
  });

  it('restates portrait-left, which the re-home leaves nothing else to supply', () => {
    // Deliberately NOT a specificity story (PR review caught the earlier wording):
    // makeUiRootDetacher re-parents the frame onto #ui, so the docked rule and the
    // LATER #target-frame .portrait-wrap / .uf-bars mirror rules are ALL descendant
    // selectors with no ancestor left to match. They drop out together, nothing
    // contests anything, and the order has to be declared again from scratch.
    expect(rule(hudCss, '#totarget-frame.hud-frame-detached .portrait-wrap')).toContain(
      'order: 1;',
    );
    const bars = rule(hudCss, '#totarget-frame.hud-frame-detached .uf-bars');
    expect(bars).toContain('order: 2;');
    expect(bars).toContain('width: 132px;');
    expect(bars).toContain('margin-left: -16px;');
    expect(bars).toContain('margin-right: 0;');
    expect(bars).toContain('border-radius: 11px 6px 6px 11px;');
  });

  it('shows an empty mini as an arrangeable placeholder while the interface is unlocked', () => {
    // Otherwise the frame is display:none whenever the target has no target,
    // which is most of the time, and there would be nothing to drag.
    expect(hudCss).toContain(
      'body.interface-unlocked #totarget-frame.tf-unlocked, body.interface-unlocked #pet-frame.tf-unlocked,',
    );
  });
});

// The mini is the ONE governed frame nested inside another one, so the two rules
// that assume governed frames are siblings both had to learn about it. Caught by
// re-shooting the arrange-mode screenshot: the frame showed its name chip but no
// drag ever started, and the press fell through to the world.
describe('target-of-target frame: reachable while the interface is unlocked', () => {
  it('is carved out of the unlocked-frame pointer-inert rule', () => {
    // body.interface-unlocked .tf-unlocked :not(...) is a DESCENDANT selector and
    // #target-frame is itself governed, so the mini matched it and became
    // pointer-events: none !important, the one arrangeable frame nothing could grab.
    expect(hudCss).toContain(
      'body.interface-unlocked .tf-unlocked :not(.tf-move-btn):not(.mf-resize-grip):not(#totarget-frame) { pointer-events: none !important; }',
    );
  });

  it("leaves the mini's own CONTENTS inert, so a grab anywhere on it drags the mini", () => {
    // Only the frame itself is carved out: its portrait and bars still match the
    // rule through it, which is what makes the whole mini one drag handle rather
    // than a portrait that swallows the press.
    expect(hudCss).not.toContain(':not(#totarget-frame *)');
    expect(hudCss).not.toContain('#totarget-frame :not(.tf-move-btn) { pointer-events: auto');
  });
});
