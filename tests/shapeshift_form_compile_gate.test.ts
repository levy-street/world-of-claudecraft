import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterVisual } from '../src/render/characters/visual';
import { gateSurfaceForm } from '../src/render/surface_receiver_preparation';

// Renderer.ts is a coordinator that needs a live WebGL/DOM context to instantiate
// (see tests/CLAUDE.md), so its wiring is pinned by scanning the actual source, the
// same pattern tests/prewarm_policy.test.ts and tests/prewarm_resume.test.ts use for
// the sibling compile-gate/prewarm wiring in this file. The extracted form
// helper's ownership check is also exercised below with out-of-order settlements.
const renderer = () => readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
const formGate = () =>
  readFileSync(new URL('../src/render/surface_receiver_preparation.ts', import.meta.url), 'utf8');

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

    // Every form is built by the one shared builder, and the four that must not
    // pop in half-linked ask it for the gate. Metamorphosis is the deliberate
    // exception: it grows out of the body it replaces.
    for (const [form, slot] of [
      ['sheep', 'sheepVisual'],
      ['bear', 'bearVisual'],
      ['cat', 'catVisual'],
      ['travel', 'travelVisual'],
    ]) {
      expect(block, `${slot} gated build`).toContain(
        `this.buildFormVisual(e, v, 'form_${form}', '${slot}', true)`,
      );
    }
    expect(block).toContain(
      "this.buildFormVisual(e, v, 'form_metamorph', 'metamorphVisual', false)",
    );

    // The builder still attaches before handing ownership to the shared helper.
    const builderStart = source.indexOf('  private buildFormVisual(');
    expect(builderStart).toBeGreaterThan(-1);
    const builder = source.slice(builderStart, source.indexOf('\n  private ', builderStart + 10));
    const assignAt = builder.indexOf('v[slot] = built;');
    expect(assignAt, 'slot assignment').toBeGreaterThan(-1);
    const addAt = builder.indexOf('v.group.add(built.root)', assignAt);
    expect(addAt, 'group.add').toBeGreaterThan(assignAt);
    const delegateAt = builder.indexOf('gateSurfaceForm(this, built, v, gateCompile);', addAt);
    expect(delegateAt, 'form gate delegation').toBeGreaterThan(addAt);
    const helperSource = formGate();
    const helperStart = helperSource.indexOf('export function gateSurfaceForm(');
    expect(helperStart).toBeGreaterThan(-1);
    const helperEnd = helperSource.indexOf('export function stageSurfaceReceiver(', helperStart);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helper = helperSource.slice(helperStart, helperEnd);
    const prepareAt = helper.indexOf(
      'const settle = stageSurfaceReceiver(host, visual, gateCompile);',
    );
    expect(prepareAt, 'receiver preparation').toBeGreaterThan(-1);
    const skipAt = helper.indexOf('if (!gateCompile) return;', prepareAt);
    expect(skipAt, 'ungated early return').toBeGreaterThan(prepareAt);
    const pendingAt = helper.indexOf('view.formCompilePending = visual.root;', skipAt);
    expect(pendingAt, 'pending set').toBeGreaterThan(skipAt);
    const gateAt = helper.indexOf(
      '(host as Host).gateSwapFlagOnCompile(visual.root, () => {',
      pendingAt,
    );
    expect(gateAt, 'gate call').toBeGreaterThan(pendingAt);
    const settleAt = helper.indexOf(
      'if (view.formCompilePending === visual.root) view.formCompilePending = null;',
      gateAt,
    );
    expect(settleAt, 'settle callback').toBeGreaterThan(gateAt);
    const surfaceSettleAt = helper.indexOf('settle();', gateAt);
    expect(surfaceSettleAt).toBeGreaterThan(gateAt);
    expect(surfaceSettleAt).toBeLessThan(settleAt);

    // Uses the flag shape (gateSwapFlagOnCompile), not the direct-hide shape
    // (gateSwapOnCompile): the visibility lines right below recompute every tick.
    expect(builder).not.toContain('this.gateSwapOnCompile(built.root)');
    expect(helper).not.toContain('.gateSwapOnCompile(');
  });

  it('feeds the pending token to the readiness mask, so the BASE body stands in', () => {
    const source = renderer();
    const blockStart = source.indexOf('// A form rig that is still linking is NOT ready');
    const blockEnd = source.indexOf('// rideable mount under the player', blockStart);
    expect(blockStart).toBeGreaterThan(-1);
    expect(blockEnd).toBeGreaterThan(blockStart);
    const block = source.slice(blockStart, blockEnd);

    // The readiness mask, not the per-root setActive lines, is what the gate
    // now feeds: a pending form is NOT ready, so resolvedCharacterForm stays
    // 'base' and formVisibility.base keeps the body drawing.
    expect(block).toContain('const formReadyMask = characterFormReadyMask(');
    expect(block).toContain('v.formCompilePending,\n      );');
    expect(block).toContain(
      'const resolvedForm = resolvedCharacterForm(requestedForm, formReadyMask);',
    );
    expect(block).toContain('const formVisibility = characterFormVisibility(resolvedForm);');
    expect(block).toContain(
      'applyCharacterFormVisibility(v, formVisibility, v.visualCompilePending);',
    );
  });

  it('never darkens a rig on formCompilePending any more (that was the fairness hole)', () => {
    const source = renderer();
    // The old shape hid the FORM on its pending token while the resolved form
    // had already left 'base', so both bodies were dark at once. No setActive
    // call may read the token again; the readiness mask owns it.
    for (const line of source.split('\n')) {
      if (line.includes('setActive(')) {
        expect(line, 'setActive must not read the form gate token').not.toContain(
          'formCompilePending',
        );
      }
    }
    // ...and the base body is only ever hidden by its OWN swap gate, which has
    // the outgoing rig standing in (updateBaseVisual).
    expect(source).not.toContain('formVisibility.base && !v.visualCompilePending');
  });

  it('keeps a newer pending form when an older helper callback settles', () => {
    const pending: Array<() => void> = [];
    const view = { formCompilePending: null as THREE.Object3D | null };
    const host = {
      gateSwapFlagOnCompile: vi.fn((root: THREE.Object3D, settled: () => void) => {
        expect(view.formCompilePending).toBe(root);
        pending.push(settled);
      }),
    };
    const first = { root: new THREE.Group(), stageSurfaceResponsePreparation: () => null };
    const second = { root: new THREE.Group(), stageSurfaceResponsePreparation: () => null };
    gateSurfaceForm(host, first as unknown as CharacterVisual, view, true);
    gateSurfaceForm(host, second as unknown as CharacterVisual, view, true);
    expect(host.gateSwapFlagOnCompile).toHaveBeenCalledTimes(2);
    pending[0]();
    expect(view.formCompilePending).toBe(second.root);
    pending[1]();
    expect(view.formCompilePending).toBeNull();
    pending[0]();
    expect(view.formCompilePending).toBeNull();
  });
});
