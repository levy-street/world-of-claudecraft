import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hudCss = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8').replace(
  /\r\n/g,
  '\n',
);

function ruleBlock(selector: string): string {
  const start = hudCss.indexOf(selector);
  expect(start).toBeGreaterThan(-1);
  return hudCss.slice(start, hudCss.indexOf('}', start));
}

describe('desktop player frame sizing', () => {
  it('keeps the full configured player frame width after dragging detaches it', () => {
    // The box is the playerFrameWidth setting scaled by the frame scale
    // (real-dimension sizing from the interface editor), and the docked and
    // detached seats carry the SAME expression: any difference between the
    // two renders as the content jumping sideways the moment a drag starts.
    const widthExpr =
      'width: calc(var(--player-frame-width, var(--unit-frame-w)) * var(--player-frame-scale, 1));';
    const docked = ruleBlock('#player-frame {');
    const detached = ruleBlock('#player-frame.pf-detached {');
    expect(docked).toContain(widthExpr);
    expect(detached).toContain(widthExpr);
    expect(hudCss).not.toContain('#player-frame.pf-detached .uf-bars');
  });
});

describe('party frame bar sizing', () => {
  it('keeps the classic HP and resource bars at their authored heights', () => {
    const bar = ruleBlock('.party-frame .bar {');
    const hp = ruleBlock('\n  .party-frame .bar.hp {');
    expect(bar).toContain('height: var(--party-res-h);');
    expect(hp).toContain('height: var(--party-hp-h);');
  });

  it('lays classic rows around a 30px class-ring crest and preserves the target cue', () => {
    const name = ruleBlock('\n  .party-frame .pfm-name {');
    const crest = ruleBlock('\n  .party-frame .pfm-crest {');
    const bar = ruleBlock('\n  .party-frame .bar {');
    const target = ruleBlock('\n  .party-frame.is-on {');
    const oor = ruleBlock('\n  .party-frame.oor {');
    expect(name).toContain('padding-left: 38px;');
    expect(crest).toContain('width: 30px;');
    expect(crest).toContain('height: 30px;');
    expect(crest).toContain('border: 2px solid var(--cls);');
    expect(bar).toContain('margin-left: 38px;');
    expect(target).toContain('outline: 1px solid var(--gold);');
    expect(oor).toContain('opacity: 0.55;');
  });

  it('keeps the Party N header unbacked and the raid cells at their authored footprint', () => {
    const header = ruleBlock('#party-frame-header {');
    const raid = ruleBlock('#party-frames.party-style-raid .party-frame {');
    const role = ruleBlock('#party-frames.party-style-raid .party-frame .pfm-role {');
    expect(header).toContain('width: var(--party-row-w);');
    expect(header).toContain('padding: 0 4px 2px;');
    expect(header).toContain('background: transparent;');
    expect(raid).toContain('width: var(--party-raid-cell-w);');
    expect(raid).toContain('height: var(--party-raid-cell-h);');
    expect(role).toContain('width: 10px;');
    expect(role).toContain('height: 10px;');
  });
});

describe('snap-to-grid alignment overlay', () => {
  it('draws its lines on the FRAME_SNAP_GRID pitch in VISUAL px', () => {
    // FRAME_SNAP_GRID is 16 (pinned in tests/target_frame_pos.test.ts) and
    // every snap quantizes VISUAL px, but the overlay lives inside #ui,
    // which zooms by --ui-scale: the author-space pitch must divide by the
    // scale so the zoom lands the drawn lines back on 16 visual px. A plain
    // 16px here drew the grid offset from where snaps land at any UI Scale
    // other than 1 (review round four, blocker 1).
    const overlay = hudCss.slice(hudCss.indexOf('#interface-grid-overlay {'));
    const block = overlay.slice(0, overlay.indexOf('}'));
    const pitches = block.match(/transparent 1px calc\(16px \/ var\(--ui-scale, 1\)\)/g) ?? [];
    expect(pitches, 'both gradients carry the scale-compensated pitch').toHaveLength(2);
    expect(block).toContain('repeating-linear-gradient');
    // No uncompensated pitch may survive in the block.
    expect(block).not.toMatch(/transparent 1px 16px/);
    expect(block).toContain('pointer-events: none;');
  });

  it('draws a scale-compensated centerline pair through the screen middle', () => {
    // The two ::before/::after bars are overlay children, so they show and
    // hide with the grid; like the grid pitch, their px thickness divides by
    // --ui-scale (the 50% midpoint needs no compensation).
    const overlay = hudCss.slice(hudCss.indexOf('#interface-grid-overlay {'));
    expect(overlay).toMatch(
      /#interface-grid-overlay::before\s*\{[\s\S]*?left:\s*calc\(50% - 1px \/ var\(--ui-scale, 1\)\);[\s\S]*?width:\s*calc\(2px \/ var\(--ui-scale, 1\)\);/,
    );
    expect(overlay).toMatch(
      /#interface-grid-overlay::after\s*\{[\s\S]*?top:\s*calc\(50% - 1px \/ var\(--ui-scale, 1\)\);[\s\S]*?height:\s*calc\(2px \/ var\(--ui-scale, 1\)\);/,
    );
  });
});

describe('unit frame bar fills', () => {
  // The review finding: the player health bar read as a striped fill. hud.css must
  // leave the fill's LOOK to the library bevel gradient (only --bar-color per power
  // type), and the hatched absorb overlay must start collapsed so a unit with no
  // shield shows plain health.
  it('gives the fills only their power color and no look of their own', () => {
    const fill = ruleBlock('\n  .bar-fill {');
    expect(fill).not.toContain('background');
    for (const [cls, token] of [
      ['.hp', '--color-hp'],
      ['.mana', '--color-mana'],
      ['.rage', '--color-rage'],
      ['.energy', '--color-energy'],
      ['.focus', '--color-focus'],
    ]) {
      const block = ruleBlock(`\n  ${cls} {`);
      expect(block).toContain(`--bar-color: var(${token});`);
      expect(block).not.toContain('background');
    }
  });

  it('keeps the absorb hatch collapsed until a shield exists', () => {
    const absorb = ruleBlock('\n  .bar-absorb {');
    expect(absorb).toContain('transform: scaleX(0);');
    expect(absorb).toContain('transform-origin: left;');
  });
});

// Regression pin for the buff-placement bug: the anchored buff row's
// above/below side used to be keyed on #player-frame.pf-detached (whether the
// player has ever dragged/nudged the frame, or loaded a saved position), so
// moving the frame even once silently and permanently flipped the buffs below
// it. It is now keyed on its OWN class (body.auras-below-frame), driven by the
// dedicated auraBarBelowFrame setting (main.ts), never by the frame's move
// state.
describe('player frame buff-row placement (auraBarBelowFrame)', () => {
  it('sits above the frame by default', () => {
    const docked = ruleBlock('#player-frame > #buff-bar {');
    expect(docked).toContain('bottom: calc(100% + 8px);');
  });

  it('flips below the frame only via its own body.auras-below-frame class', () => {
    const below = ruleBlock('body.auras-below-frame #player-frame > #buff-bar {');
    expect(below).toContain('top: calc(100% + 8px);');
  });

  it('never re-couples the buff row to the frame drag/detach state', () => {
    const detached = ruleBlock(
      'body.auras-on-frame.auras-below-frame #player-frame.pf-detached > #buff-bar {',
    );
    expect(detached).not.toMatch(/\b(?:top|bottom):/);
  });

  // A docked (never-dragged) frame has no z-index of its own, so before this
  // fix "buffs below" only ever coexisted with pf-detached (which does carry
  // z-index: 6): a docked frame flipped below is a combination this fix newly
  // makes reachable, and without a matching z-index the flipped icon painted
  // behind the action bar's buttons (same DOM-order stacking, no positioning
  // to override it). The z-index lands on the row itself, not the whole
  // frame, so the portrait/bars never get hoisted into a needless new
  // stacking context. Caught via the PR screenshot capture, not a unit test.
  it('lifts the flipped row (not the whole frame) above the action bar', () => {
    const lifted = ruleBlock('body.auras-on-frame.auras-below-frame #player-frame > #buff-bar {');
    expect(lifted).toContain('z-index: 6;');
  });

  // The docked 8px gap has no room to clear the action bar's first slot
  // entirely without reflowing #actionbar-stack, so the row's visibility (via
  // the z-index above) trades away its own clickability here: a click in the
  // overlap reaches the action button underneath, never the buff icon. The
  // action slot is the more safety-critical of the two.
  it('lets clicks in the overlap reach the action bar, not the buff icon', () => {
    const lifted = ruleBlock('body.auras-on-frame.auras-below-frame #player-frame > #buff-bar {');
    expect(lifted).toContain('pointer-events: none;');
  });

  it('keeps detached buff icons interactive below the player frame', () => {
    const detached = ruleBlock(
      'body.auras-on-frame.auras-below-frame #player-frame.pf-detached > #buff-bar {',
    );
    expect(detached).toContain('pointer-events: auto;');
  });
});
