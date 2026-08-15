import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Renderer.ts is a coordinator that needs a live WebGL/DOM context to instantiate
// (see tests/CLAUDE.md), so its wiring is pinned by scanning the actual source, the
// same pattern tests/prewarm_policy.test.ts and tests/prewarm_resume.test.ts use for
// the sibling compile-gate/prewarm wiring in this file. settlePendingSwap's own
// behavior (including the rapid form-swap race this gate exists to survive) is
// covered directly in tests/compile_gate.test.ts.
const renderer = () => readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

describe('shapeshift-form compile gate (#2571)', () => {
  it('declares one shared pending-root token on EntityView, not one flag per form', () => {
    const source = renderer();
    const fieldStart = source.indexOf('formCompilePending: THREE.Object3D | null;');
    expect(fieldStart).toBeGreaterThan(-1);
    // Sits beside the two existing per-frame-recomputed gate flags this mirrors.
    const mountFlagAt = source.indexOf('mountCompilePending: boolean;');
    const visualFlagAt = source.indexOf('visualCompilePending: boolean;');
    expect(mountFlagAt).toBeGreaterThan(-1);
    expect(visualFlagAt).toBeGreaterThan(mountFlagAt);
    expect(fieldStart).toBeGreaterThan(visualFlagAt);
    // Initialized to null (no form pending) on every new EntityView.
    expect(source).toContain('formCompilePending: null,');
  });

  it('gates all four lazy form-visual builds (sheep, bear, cat, travel) on compile', () => {
    const source = renderer();
    const blockStart = source.indexOf('// lazy form visuals, swapped by visibility');
    const blockEnd = source.indexOf('// rideable mount under the player', blockStart);
    expect(blockStart).toBeGreaterThan(-1);
    expect(blockEnd).toBeGreaterThan(blockStart);
    const block = source.slice(blockStart, blockEnd);

    for (const form of ['sheepVisual', 'bearVisual', 'catVisual', 'travelVisual']) {
      const visualAt = block.indexOf(`v.${form} = built;`);
      expect(visualAt, `${form} assignment`).toBeGreaterThan(-1);
      const addAt = block.indexOf('v.group.add(built.root)', visualAt);
      expect(addAt, `${form} group.add`).toBeGreaterThan(visualAt);
      const pendingAt = block.indexOf('v.formCompilePending = built.root;', addAt);
      expect(pendingAt, `${form} pending set`).toBeGreaterThan(addAt);
      const gateAt = block.indexOf('this.gateSwapFlagOnCompile(built.root, () => {', pendingAt);
      expect(gateAt, `${form} gate call`).toBeGreaterThan(pendingAt);
      const settleAt = block.indexOf(
        'v.formCompilePending = settlePendingSwap(v.formCompilePending, built.root);',
        gateAt,
      );
      expect(settleAt, `${form} settle callback`).toBeGreaterThan(gateAt);
    }

    // Uses the flag shape (gateSwapFlagOnCompile), not the direct-hide shape
    // (gateSwapOnCompile): the visibility lines right below recompute every tick.
    expect(block).not.toContain('this.gateSwapOnCompile(built.root)');
  });

  it('consults the pending token, keyed per form root, in the per-frame visibility recompute', () => {
    const source = renderer();
    const blockStart = source.indexOf(
      '// Gated per form root: the resolved visibility AND the compile-pending',
    );
    const blockEnd = source.indexOf('// rideable mount under the player', blockStart);
    expect(blockStart).toBeGreaterThan(-1);
    expect(blockEnd).toBeGreaterThan(blockStart);
    const block = source.slice(blockStart, blockEnd);

    expect(block).toContain(
      'v.sheepVisual?.setActive(formVisibility.sheep && v.formCompilePending !== v.sheepVisual.root);',
    );
    expect(block).toContain(
      'v.bearVisual?.setActive(formVisibility.bear && v.formCompilePending !== v.bearVisual.root);',
    );
    expect(block).toContain(
      'v.catVisual?.setActive(formVisibility.cat && v.formCompilePending !== v.catVisual.root);',
    );
    expect(block).toContain(
      'formVisibility.travel && v.formCompilePending !== v.travelVisual.root,',
    );
    expect(block).toContain(
      'formVisibility.metamorph && v.formCompilePending !== v.metamorphVisual.root,',
    );
  });

  it('imports settlePendingSwap from the shared compile_gate core', () => {
    const source = renderer();
    expect(source).toContain(
      "import { CompileGateQueue, settlePendingSwap } from './compile_gate';",
    );
  });
});
