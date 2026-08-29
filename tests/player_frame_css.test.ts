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
      'width: calc(var(--player-frame-width, 612px) * var(--player-frame-scale, 1));';
    const docked = ruleBlock('#player-frame {');
    const detached = ruleBlock('#player-frame.pf-detached {');
    expect(docked).toContain(widthExpr);
    expect(detached).toContain(widthExpr);
    expect(hudCss).not.toContain('#player-frame.pf-detached .uf-bars');
  });
});

describe('party frame bar sizing', () => {
  it('the hp/resource bars absorb a partyFrameHeight drag like the other unit frames', () => {
    // The row height is the setting; the name line plus padding cost about
    // 24px and the remainder splits across the two bars, landing on the
    // stock 9px at the stock 42px row. A fixed bar height here is the bug
    // the owner reported: rows grew while the health bars stayed 9px.
    const bar = ruleBlock('.party-frame .bar {');
    expect(bar).toContain('height: max(4px, calc((var(--party-frame-height, 42px) - 24px) / 2));');
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
});
