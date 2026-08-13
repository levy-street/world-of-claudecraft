// First-reveal compile gating wiring pins (hitch-hunt P3a). The gate's
// behavior is tested in tests/reveal_gate_core.test.ts / reveal_gate.test.ts,
// the cell state machine in tests/prop_cell_core.test.ts, and the town policy
// in tests/town_reveal_core.test.ts; what those cannot see is whether the
// live views actually consult a gate. These pins fail if the wiring is
// dropped: an unwired gate silently reverts to the measured 300 to 680 ms
// first-reveal submit stalls (S10) with every test still green. The scans
// run over comment-STRIPPED source so a commented-out wiring block cannot
// keep them green, and every anchor lookup fails loudly instead of slicing
// from -1.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const read = (path: string): string =>
  stripComments(readFileSync(new URL(path, import.meta.url), 'utf8'));

function anchor(source: string, needle: string): number {
  const index = source.indexOf(needle);
  expect(index, `anchor not found: ${needle}`).toBeGreaterThan(-1);
  return index;
}

describe('reveal gate wiring (source pins)', () => {
  const rendererSource = read('../src/render/renderer.ts');

  it('the renderer wires all three gates behind async-compile support', () => {
    const wiring = rendererSource.slice(
      anchor(rendererSource, 'if (this.asyncCompileSupported) {\n      const revealHost = {'),
      anchor(rendererSource, 'this.fenbridgeTownView.setRevealGate') + 400,
    );
    expect(wiring).toContain('priority: GPU_WORK_PRIORITY.VISIBLE_PREWARM,');
    expect(wiring).toContain('label: `reveal-gate:${target.name || target.type}`,');
    expect(wiring).toContain('this.compilePrewarmColorPrograms(target, false).then(() =>');
    expect(wiring).toContain('this.compileShadowPrograms(target),');
    expect(wiring).toContain('this.propsView.setFarCellRevealGate(');
    expect(wiring).toContain(
      'createRevealGate(revealHost, (key) => this.propsView.farCellRevealRoots(key))',
    );
    expect(wiring).toContain('this.eastbrookTownView.setRevealGate(');
    expect(wiring).toContain('this.fenbridgeTownView.setRevealGate(');
  });

  it('props threads the gate into the per-frame far-cell update', () => {
    const propsSource = read('../src/render/props.ts');
    expect(propsSource).toContain(
      'updatePropCell(cell, camX, camZ, fogFar, undefined, farCellRevealGate);',
    );
    // The reveal key IS the map key: if these diverge, farCellRevealRoots
    // returns [] for every consult and the gate degrades to an immediate
    // reveal that no behavior test can see.
    expect(propsSource).toContain('new Map(farCells.map((cell) => [cell.key, cell]))');
    expect(propsSource).toContain('key: cellKey,');
    expect(propsSource).toContain(`mesh.name = \`far-bake:\${cellKey}\`;`);
    expect(propsSource).toContain('farCellsByKey.get(key)?.meshes ?? []');
  });

  it.each([
    ['eastbrook', '../src/render/eastbrook_town.ts', 'eastbrook-town-static'],
    ['fenbridge', '../src/render/fenbridge_town.ts', 'fenbridge-town-static'],
  ])('%s resolves its static cull through the town reveal policy', (_town, path, key) => {
    const source = read(path);
    // The policy call must decide the SAME staticVisible the cull loop
    // applies, in that order: policy, latch, then the visibility writes.
    const policyAt = anchor(source, 'const reveal = townStaticReveal(');
    const keyAt = anchor(source, `'${key}',`);
    const latchAt = anchor(source, "if (reveal === 'revealed') staticRevealed = true;");
    const applyAt = anchor(source, "const staticVisible = reveal === 'revealed';");
    const cullAt = anchor(source, 'staticCullTargets[index].visible = staticVisible;');
    expect(policyAt).toBeLessThan(keyAt);
    expect(keyAt).toBeLessThan(latchAt);
    expect(latchAt).toBeLessThan(applyAt);
    expect(applyAt).toBeLessThan(cullAt);
    // The roots provider hands the gate the exact batch set the cull flips.
    expect(source).toContain('staticRevealRoots(): readonly THREE.Object3D[] {');
    expect(source).toContain('return staticCullTargets;');
  });
});
