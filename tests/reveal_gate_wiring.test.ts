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
import { prewarmResumeIsDebt } from '../src/render/prewarm_policy';

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

/** Every clock a reveal path could reach for. `gpuPrepNow` is the repo's own
 *  wrapper; the two raw globals are what a hand-rolled bound would use. */
const CLOCK_TOKENS = ['gpuPrepNow', 'performance.now()', 'Date.now()'] as const;

/**
 * No clock anywhere in a reveal path: the cores hold none and there is no
 * bound left for one to feed.
 *
 * A never-present token is a vacuous assertion on its own (a typo'd needle, or
 * a `read()` that silently returned nothing, passes it), so the same needles
 * are proven against a POSITIVE CONTROL first: gpu_prep_events.ts is the
 * sibling that legitimately carries all three (it IS the clock), and it is read
 * through the same `read`.
 */
function expectNoClock(source: string, label: string): void {
  const control = read('../src/render/gpu_prep_events.ts');
  expect(source.length, `${label} read back empty`).toBeGreaterThan(1_000);
  for (const token of CLOCK_TOKENS) {
    expect(control, `${token} is no longer a live token anywhere`).toContain(token);
    expect(source, `${label} reaches for ${token}`).not.toContain(token);
  }
}

describe('reveal gate wiring (source pins)', () => {
  const rendererSource = read('../src/render/renderer.ts');

  it('the shared reveal compile host links, arms shadows, then runs the touch tail', () => {
    // The host moved out of the renderer constructor, so the pins move with
    // it: what must not drift is the lane it rides (the imminent one above the
    // rest of the reveals, the ordinary one below the live entity gates), the
    // label its cost model is keyed on, and the order of the three arms, since
    // a touch tail before the link warms nothing. The priorities themselves are
    // tested for real in tests/reveal_compile_host.test.ts.
    const host = read('../src/render/reveal_compile_host.ts');
    expect(host).toContain("export const REVEAL_GATE_PREP_KIND = 'reveal-gate';");
    expect(host).toContain(
      '(imminent ? GPU_WORK_PRIORITY.LIVE_VIEW : GPU_WORK_PRIORITY.VISIBLE_PREWARM)',
    );
    // A caller may name the priority outright (the occluder-fade gate's edge
    // frame); the mapping above is the default, never overridden silently.
    expect(host).toContain('namedPriority ??');
    expect(host).toContain('label: `${REVEAL_GATE_PREP_KIND}:${target.name || target.type}`');
    // The link is cut into one queue unit per material group of the root
    // (compile_gate_pieces.ts), each running the colour arm, the shadow arm,
    // then the variant settle on that group's representative node, each under
    // its own deadline.
    const colourAt = anchor(
      host,
      'const pieces = linkPieceWork(target, deps.compileColor, deps.compileShadow, deps.settle);',
    );
    // Uploads sit BETWEEN the link and the touch: the touch's driver round trip
    // flushes behind everything already queued, so an upload paid after it is
    // measured by it instead of being its own budgeted piece. Both ride the
    // SAME priority the link did, so an imminent key's tail cannot fall behind
    // the lane its link overtook.
    const uploadAt = anchor(
      host,
      '.then((gate) => deps.upload(target, priority).then(() => gate))',
    );
    // The tail also carries the GATE's own result: what a settle proved is the
    // only readiness the walk has (src/render/linked_program_readiness.ts).
    const touchAt = anchor(host, '.then((gate) => deps.touch(target, priority, gate))');
    expect(colourAt).toBeLessThan(uploadAt);
    expect(uploadAt).toBeLessThan(touchAt);
    // The soft deadline is the budget's learned per-unit cost times the PIECES
    // the key's roots submit (the budget learns a piece, not a root), and it is
    // the host's answer, not a second policy in the renderer.
    expect(host).toContain(
      'pieces += submittedPieces.get(root) ?? linkPiecesOf(root as THREE.Object3D).length;',
    );
    expect(host).toContain('return revealSoftDeadlineMs(deps.predictRevealMs(), pieces);');
  });

  it('the renderer wires all four gates behind async-compile support', () => {
    const wiring = rendererSource.slice(
      anchor(rendererSource, 'if (this.asyncCompileSupported) {\n      const revealHost ='),
      anchor(rendererSource, 'this.foliageRevealGate = createRevealGate') + 200,
    );
    expect(wiring).toContain('const revealHost = createRevealCompileHost({');
    expect(wiring).toContain(
      'compileColor: (target) => this.compilePrewarmColorPrograms(target, false),',
    );
    expect(wiring).toContain('compileShadow: (target) => this.compileShadowPrograms(target),');
    // The settle arm is bound to the SAME material properties the touch tail
    // reads and the SAME depth-twin cache the shadow arm fills, so the depth
    // programs are polled under the twins that own them.
    expect(wiring).toContain(
      'settle: pieceProgramSettle(this.webgl.properties, this.prewarmDepthMaterials),',
    );
    expect(wiring).toContain(
      'upload: (target, priority) => this.uploadGateTexturesGated(target, priority),',
    );
    expect(wiring).toContain(
      'touch: (target, priority, gate) => this.touchLinkedProgramsGated(target, priority, gate),',
    );
    // The soft deadline reads the LEARNED cost of a reveal compile, under the
    // same kind the host labels its units with.
    expect(wiring).toContain(
      'predictRevealMs: () => this.gpuPrepBudget.predictMs(REVEAL_GATE_PREP_KIND),',
    );
    expect(wiring).toContain('startAfterInitialPaint: () => this.initialGpuWorkStart,');
    expect(wiring).toContain(
      'this.propsRevealGate = createRevealGate(revealHost, (key) => this.propsView.revealRoots(key));',
    );
    expect(wiring).toContain('this.propsView.setRevealGate(this.propsRevealGate);');
    // The band arm of the props gate installs at the start of EVERY scene
    // prewarm, never in the constructor: armed under the curtain, the
    // bands beyond half the fog would queue their compiles beside the
    // manifest's near-first units for content the initial frame links
    // anyway. The negative scans the WHOLE constructor, bounded on its
    // declaration and its closing brace, not a character window.
    const constructorStart = anchor(rendererSource, '\n  constructor(');
    const constructorEnd = rendererSource.indexOf('\n  }\n', constructorStart);
    expect(constructorEnd).toBeGreaterThan(constructorStart);
    const constructorBody = rendererSource.slice(constructorStart, constructorEnd);
    expect(constructorBody).toContain('this.propsView.setRevealGate(this.propsRevealGate);');
    expect(constructorBody).not.toContain('setBandRevealGate');
    // Same reason for the foliage buckets: armed under the curtain, every
    // bucket past half the fog would queue a compile beside the manifest's
    // near-first units for content the initial frame links anyway.
    expect(constructorBody).not.toContain('this.foliage.setRevealGate');
    const prewarm = rendererSource.slice(
      anchor(rendererSource, 'async prewarmInitialScene('),
      anchor(rendererSource, 'const policy: PrewarmPolicy = resolvePrewarmPolicy'),
    );
    expect(prewarm).toContain('this.installSceneryRevealGates();');
    expect(prewarm).toContain('this.initialGpuWorkStart = null;');
    const install = rendererSource.slice(
      anchor(rendererSource, 'private installSceneryRevealGates(): void {'),
      anchor(rendererSource, 'armEntryDetailHorizon(): void {'),
    );
    expect(install).toContain('this.propsView.setBandRevealGate(this.propsRevealGate);');
    expect(install).toContain('this.foliage.setRevealGate(this.foliageRevealGate);');
    const entryArm = rendererSource.slice(
      anchor(rendererSource, 'armEntryDetailHorizon(): void {'),
      anchor(rendererSource, 'setHitchLogEnabled(enabled: boolean)'),
    );
    expect(entryArm).not.toContain('setBandRevealGate');
    expect(entryArm).not.toContain('this.foliage.setRevealGate');
    expect(wiring).toContain('this.eastbrookTownView.setRevealGate(');
    expect(wiring).toContain('this.fenbridgeTownView.setRevealGate(');
    // The foliage buckets ride the SAME host and the same queue: one more
    // createRevealGate, never a second host (foliage.ts revealRoots hands back
    // the one representative bucket mesh per program key).
    expect(wiring).toContain(
      'this.foliageRevealGate = createRevealGate(revealHost, (key) => this.foliage.revealRoots(key));',
    );
    expect(
      rendererSource.match(/const revealHost = createRevealCompileHost\(/g) ?? [],
    ).toHaveLength(1);
  });

  it('covers graphics rebuild prewarm and bounds the entry-only first-paint barrier', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const rebuild = main.slice(
      anchor(main, 'prewarmRenderer: async (next) => {'),
      anchor(main, 'validateRenderer: (next) => {'),
    );
    expect(rebuild).toContain('await next.prewarmInitialScene();');

    const entry = main.slice(
      anchor(main, 'const initialPrewarmResumeStartGate = createInitialPrewarmResumeStartGate();'),
      anchor(main, "entryDiagnostics.checkpoint('first-paint');"),
    );
    expect(entry).toContain('resumeAfterFirstPaint: initialPrewarmResumeStartGate.wait,');
    expect(entry.indexOf('initialPrewarmResumeStartGate.armBackstop();')).toBeLessThan(
      entry.indexOf('await nextPaint();'),
    );
  });

  it("lets the detail horizon inherit the governor's observed external display pacing", () => {
    const demandAt = anchor(rendererSource, 'const detailHorizonDemandFar =');
    const vistaAt = rendererSource.indexOf('if (vista) {', demandAt);
    expect(vistaAt).toBeGreaterThan(demandAt);
    const ambience = rendererSource.slice(demandAt, vistaAt);
    expect(ambience).toContain('this.renderBudgetState.externalFrameCap,');
  });

  it('props threads the gate into the per-frame far-cell and band updates', () => {
    const propsSource = read('../src/render/props.ts');
    expect(propsSource).toContain(
      'updatePropCell(cell, camX, camZ, fogFar, undefined, revealGate);',
    );
    // The bands go through the LIST pass, not the per-band entry: that is what
    // consults a frame's imminent bands nearest to the camera first, and its
    // scratch is built once per view rather than per frame.
    expect(propsSource).toContain(
      'updatePropCullables(cullables, camX, camZ, fogFar, fogFarSq, bandRevealGate, cullPass);',
    );
    expect(propsSource).toContain('const cullPass = newPropCullPass();');
    expectNoClock(propsSource, 'props.ts');
    expect(propsSource).toContain('setBandRevealGate(gate: RevealGateCore | null): void {');
    // The reveal key IS the map key: if these diverge, revealRoots returns
    // [] for every consult and the gate degrades to an immediate reveal that
    // no behavior test can see. Band keys are minted from the slot at push
    // time and resolve to the one band object.
    expect(propsSource).toContain('new Map(farCells.map((cell) => [cell.key, cell]))');
    expect(propsSource).toContain('key: cellKey,');
    expect(propsSource).toContain(`mesh.name = \`far-bake:\${cellKey}\`;`);
    expect(propsSource).toContain('new Map(cullables.map((cullable) => [cullable.key, cullable]))');
    expect(propsSource).toContain(
      'cullableBounds(obj, propCullKey(cullables.length), box, sphere)',
    );
    // The hideables (buildings, tents, campfires) deliberately do NOT ride a
    // first-sight gate (props.ts explains: 116 keys at once starved the
    // reveal pipeline on the iGPU ride); their unique-material case is the
    // far cell's `:near` hold, which resolves through the same far-cell map.
    expect(propsSource).not.toContain('propHideable');
    const rootsAt = anchor(propsSource, 'revealRoots(key: string): readonly THREE.Object3D[] {');
    const roots = propsSource.slice(rootsAt, rootsAt + 200);
    expect(roots).toContain(
      'return propRevealRoots<THREE.Object3D>(farCellsByKey, cullablesByKey, key);',
    );
    // Every band goes through the ONE gated cull entry: no raw `.obj.visible =`
    // write anywhere in props.ts (the pre-change loop had exactly one). The
    // matcher is proven live on a fixture first, so the zero is not vacuous.
    const rawBandWrite = /\.obj\.visible\s*=/g;
    expect('c.obj.visible = cullableVisible(c, camX);'.match(rawBandWrite)).toHaveLength(1);
    expect(propsSource.match(rawBandWrite) ?? []).toHaveLength(0);
  });

  it('foliage threads the gate into the per-frame bucket cull', () => {
    const foliageSource = read('../src/render/foliage.ts');
    expect(foliageSource).toContain('setRevealGate(gate: FoliageBucketRevealGate | null): void {');
    expect(foliageSource).toContain('revealRoots(key: string): readonly THREE.Object3D[] {');
    // Both bucket arms go through the gated entry: the camera-window rows and
    // the light-volume shadow rows.
    expect(foliageSource.match(/foliageBucketVisible\(/g) ?? []).toHaveLength(2);
    expect(foliageSource).toContain('? bucketVisible(bucketWindow)');
    const shadowGateAt = anchor(foliageSource, 'Math.sqrt(sdx * sdx + sdz * sdz) - b.radius),');
    expect(shadowGateAt).toBeLessThan(anchor(foliageSource, 'b.mesh.visible = visible;'));
    // The reveal key IS the roots-map key: if these diverge, revealRoots
    // returns [] for every consult and the gate degrades to an immediate
    // reveal no behavior test can see.
    expect(foliageSource).toContain('revealRootByKey.set(b.reveal.key, b.mesh);');
    expect(foliageSource).toContain('const root = revealRootByKey.get(key);');
    // Every bucket goes through the ONE gated entry: no raw `b.mesh.visible =`
    // write left in the cull loop. The matcher is proven on a fixture first,
    // so the zero is not vacuous.
    const rawWrite = /b\.mesh\.visible = (?!b\.reveal|visible;)/g;
    expect('b.mesh.visible = bucketVisible(bucketWindow);'.match(rawWrite)).toHaveLength(1);
    expect(foliageSource.match(rawWrite) ?? []).toHaveLength(0);
  });

  it.each([
    [
      'eastbrook',
      '../src/render/eastbrook_town.ts',
      'eastbrook-town-static',
      'roofVisibilityPlan.visible &&\n          townRootVisible(reveal, staticPiecewise, buildingRootBase + index);',
    ],
    [
      'fenbridge',
      '../src/render/fenbridge_town.ts',
      'fenbridge-town-static',
      'visibilityPlan.visible &&\n          townRootVisible(reveal, staticPiecewise, buildingRootBase + index);',
    ],
  ])(
    '%s resolves its static cull and its buildings through the town reveal policy',
    (_town, path, key, buildingWrite) => {
      const source = read(path);
      // The policy call must decide what the cull loop applies, in that order:
      // policy, latch, the per-root piecewise pass, then the visibility
      // writes, batches first and then the buildings under the same hold.
      const policyAt = anchor(source, 'const reveal = townStaticReveal(');
      const keyAt = anchor(source, 'STATIC_REVEAL_KEY,\n      );');
      const latchAt = anchor(source, "if (reveal === 'revealed') staticRevealed = true;");
      const piecewiseAt = anchor(
        source,
        'townPiecewiseRevealInto(staticPiecewise, reveal, camX, camZ, revealGate);',
      );
      const cullAt = anchor(
        source,
        'staticCullTargets[index].visible = townRootVisible(reveal, staticPiecewise, index);',
      );
      const baseAt = anchor(source, 'const buildingRootBase = staticCullTargets.length;');
      const buildingAt = anchor(source, buildingWrite);
      expect(policyAt).toBeLessThan(keyAt);
      expect(keyAt).toBeLessThan(latchAt);
      expect(latchAt).toBeLessThan(piecewiseAt);
      expect(piecewiseAt).toBeLessThan(cullAt);
      expect(cullAt).toBeLessThan(baseAt);
      expect(baseAt).toBeLessThan(buildingAt);
      // The key is one constant both the policy call and the piecewise state
      // read: two literals could drift and the gate would answer for a key
      // nobody holds.
      expect(source).toContain(`const STATIC_REVEAL_KEY = '${key}';`);
      expect(source).toContain('newTownPiecewiseReveal(');
      // Only the buildings are FOOTPRINT-anchored. Every static batch anchors
      // at the town centre, so without the flag list a camera standing there
      // takes the reach floor on all of them in one unlinked frame.
      expect(source).toContain(
        'const rootFootprint: boolean[] = staticCullTargets.map(() => false);',
      );
      expect(source).toContain('rootFootprint.push(true);');
      expect(source).toContain('rootFootprint,\n  );');
      // The roots provider hands the gate the batch set the cull flips PLUS
      // every building group: a building outside the roots links its
      // unshared materials cold on its own first fog reveal. The piecewise
      // anchors are built in the SAME order, so root index i is root i.
      expect(source).toContain(
        'const staticRevealRoots: THREE.Object3D[] = [...staticCullTargets, ...buildingGroups];',
      );
      expect(source).toContain('buildingGroups.push(built.group);');
      expect(source).toContain('staticRevealRoots(): readonly THREE.Object3D[] {');
      // The gate asks for the roots inside the consult that fires the request,
      // so the view hands them over NEAREST FIRST at that frame's camera: an
      // arrival links the buildings it landed among before the far side.
      expect(source).toContain('return orderTownRootsNearestFirst(');
      expect(source).toContain('staticPiecewise.x,');
      expect(source).toContain('orderedRevealRoots,');
      const camAt = anchor(source, 'lastCamX = camX;');
      expect(camAt).toBeLessThan(policyAt);
      expectNoClock(source, path);
      const anchorsAt = anchor(source, 'const rootX: number[] = staticCullTargets.map(');
      expect(anchorsAt).toBeGreaterThan(
        anchor(source, 'const staticRevealRoots: THREE.Object3D[] ='),
      );
    },
  );

  it('the boot scene sweep stays visible-only, and the idle zone prepare links both arms', () => {
    // Measured (iGPU, far login, 2026-08-17): a `traverse` sweep also
    // collects the entity views hidden behind their live compile gates; their
    // already-linked programs settle instantly, the adaptive link budget of
    // the early submit lane reads that as progress and keeps submitting until
    // the hard deadline (13.8 s instead of stalling after one unit), and the
    // whole manifest behind it (settle-state, textures, the initial frame)
    // times out. Hidden decor is the reveal gates' job, not the sweep's.
    const compileUnits = read('../src/render/initial_scene_compile_units.ts');
    const sweep = compileUnits.slice(
      anchor(compileUnits, "id: 'scene',"),
      anchor(compileUnits, 'compileRootDistanceSq(root, options.playerX'),
    );
    // The scene unit's collector call, whitespace-agnostic: the visible-only
    // flag is the literal `true` second argument.
    expect(sweep).toMatch(
      /compileRoots\(\s*options\.scene\.children\.filter\(\(root\) => !stagedRoots\.has\(root\)\),\s*true,\s*\)/,
    );
    // The background (idle) zone prepare compiles the shadow-pass depth
    // variant AFTER the colour one, inside the same queue unit.
    const idle = rendererSource.slice(
      anchor(rendererSource, "if (opts?.pace === 'idle') {"),
      anchor(rendererSource, 'for (const mesh of waterMeshes) mesh.visible = true;'),
    );
    const idleUnit = idle.slice(
      anchor(idle, 'await this.backgroundGpuWork.run('),
      anchor(idle, '`zone-prepare-compile:${obj.name || obj.type}`,'),
    );
    const idleColourAt = anchor(
      idleUnit,
      'this.compilePrewarmColorPrograms(obj, false).then(() =>',
    );
    const idleShadowAt = anchor(idleUnit, 'this.compileShadowPrograms(obj),');
    expect(idleColourAt).toBeLessThan(idleShadowAt);
  });

  it('the foliage material prewarm resumes after a deadline drop with both compile arms', () => {
    const entry = rendererSource.slice(
      anchor(rendererSource, "id: 'foliage.materials',"),
      anchor(rendererSource, "id: 'foliage.great-tree-materials',"),
    );
    expect(entry).toContain('required: false,');
    expect(entry).toContain('resumeUnits: () => {');
    // The resumed group is staged HIDDEN (frustumCulled=false casters would
    // otherwise link on the next live frame), then linked colour THEN shadow,
    // one species per unit.
    const buildAt = anchor(entry, 'const group = buildFoliageMaterialPrewarmGroup();');
    const hideAt = anchor(entry, 'group.visible = false;');
    const groupAt = anchor(entry, "id: 'foliage-materials:group',");
    const compileAt = anchor(entry, 'group.children.map((child, index) => ({');
    const compileIdAt = anchor(entry, 'id: `foliage-materials:compile:${index}`,');
    const colourAt = anchor(entry, 'await this.compilePrewarmColorPrograms(child, false);');
    const shadowAt = anchor(entry, 'await this.compileShadowPrograms(child);');
    expect(buildAt).toBeLessThan(hideAt);
    expect(hideAt).toBeLessThan(groupAt);
    expect(groupAt).toBeLessThan(compileAt);
    expect(compileAt).toBeLessThan(compileIdAt);
    expect(compileIdAt).toBeLessThan(colourAt);
    expect(colourAt).toBeLessThan(shadowAt);
    // The compile units end before the entry's own run(): both arms belong
    // to the resume units, not to the boot run.
    expect(shadowAt).toBeLessThan(anchor(entry, 'run: () => {\n          foliagePrewarmGroup ='));
    // Ambient-scene debt: its dropped units ride the BOOT_DEBT arm.
    expect(prewarmResumeIsDebt('foliage.materials')).toBe(true);
  });
});
