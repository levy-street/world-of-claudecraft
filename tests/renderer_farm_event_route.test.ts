// The renderer's farm event route (Masterwrought phase 18, item
// renderer-farm-event-route-pin): handleEvent's switch routes EXACTLY the three
// farm flourish events (farmPlanted, farmHarvested, farmWithered) to
// farmPatchVisuals.onFarmEvent, and nothing else. The adapter suite pins what
// onFarmEvent does with each; this file pins that the renderer still sends
// them, since a dropped case label was otherwise only caught live. Derived
// from the comment-stripped source, never hand-listed, so a fourth case or a
// dropped one reds here.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildFarmPatchProps, FarmPatchVisuals } from '../src/render/farm_patches';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import type { SimEvent } from '../src/sim/types';
import { stripComments } from './helpers/strip_comments';

const ROUTED = ['farmPlanted', 'farmHarvested', 'farmWithered'];

const read = (rel: string): string =>
  stripComments(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));

/** The body of `handleEvent(ev: SimEvent): void {`, brace-walked from its
 *  declaration (never a `.handleEvent(` call reference). */
function handleEventBody(renderer: string): string {
  const decl = renderer.indexOf('  handleEvent(ev: SimEvent): void {');
  expect(decl, 'handleEvent declaration not found').toBeGreaterThan(-1);
  const open = renderer.indexOf('{', decl);
  let depth = 0;
  for (let i = open; i < renderer.length; i++) {
    if (renderer[i] === '{') depth++;
    else if (renderer[i] === '}') {
      depth--;
      if (depth === 0) return renderer.slice(open, i + 1);
    }
  }
  throw new Error('handleEvent body never closes');
}

describe('the renderer farm event route', () => {
  const renderer = read('src/render/renderer.ts');
  const body = handleEventBody(renderer);
  const call = 'this.farmPatchVisuals?.onFarmEvent(ev, this.sim.playerId);';

  it('routes exactly the three flourish events to farmPatchVisuals.onFarmEvent, and no other case', () => {
    // Exactly one dispatch, inside handleEvent.
    expect(renderer.split(call)).toHaveLength(2);
    const callAt = body.indexOf(call);
    expect(callAt, 'the dispatch must sit inside handleEvent').toBeGreaterThan(-1);
    // The case labels immediately preceding the dispatch, walked back from
    // it: every `case 'x':` up to the previous statement (a `break;`, a `}`
    // or another dispatch), in source order.
    const before = body.slice(0, callAt);
    const lastStatementEnd = Math.max(
      before.lastIndexOf('break;'),
      before.lastIndexOf('}'),
      before.lastIndexOf(';'),
    );
    const labelSpan = before.slice(lastStatementEnd + 1);
    const labels = [...labelSpan.matchAll(/case '([A-Za-z]+)':/g)].map((m) => m[1]);
    expect(labels).toEqual(ROUTED);
    // ...and the arm ends there: the next statement after the dispatch is its break.
    expect(
      body
        .slice(callAt + call.length)
        .trimStart()
        .startsWith('break;'),
    ).toBe(true);
    // No farm-family label routes anywhere else in the switch (farmDenied,
    // farmReady, farmFeastPlaced and the rest are HUD events, never a
    // renderer flourish).
    const farmLabels = [...body.matchAll(/case '(farm[A-Za-z]*)':/g)].map((m) => m[1]);
    expect(farmLabels).toEqual(ROUTED);
  });

  it('the routed three are real SimEvent types, and the module accepts exactly them', () => {
    const types = read('src/sim/types.ts');
    for (const type of ROUTED) {
      expect(types, `${type} missing from the SimEvent union`).toContain(`type: '${type}'`);
    }
    // The module's own guard names the same three (a fourth routed type would
    // be dropped silently by the guard, a dropped one never reaches it).
    const module = read('src/render/farm_patches.ts');
    const guardAt = module.indexOf('onFarmEvent(ev: SimEvent, viewerPid: number): void {');
    expect(guardAt).toBeGreaterThan(-1);
    const guard = module.slice(guardAt, module.indexOf('return;', guardAt));
    const accepted = [...guard.matchAll(/ev\.type !== '([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(accepted).toEqual(ROUTED);
  });

  it('a farm-family event outside the routed three is a no-op at the module (behavioral)', () => {
    // The route is what keeps farmDenied and friends away from the visuals;
    // if one ever reached onFarmEvent it must still do nothing: no emitter
    // call and no forced re-read.
    const scene = new THREE.Scene();
    const { seats } = buildFarmPatchProps(1234, FARM_PATCHES);
    const calls: string[] = [];
    const visuals = new FarmPatchVisuals(scene, seats, {
      burst: () => calls.push('burst'),
      groundPuff: () => calls.push('puff'),
    });
    const denied = {
      type: 'farmDenied',
      pid: 1,
      reason: 'range',
      bedId: 'bed_eastbrook_1',
      cropId: 'vale_wheat',
    } as unknown as SimEvent;
    visuals.onFarmEvent(denied, 1);
    expect(calls).toEqual([]);
    expect((visuals as unknown as { dirty: boolean }).dirty).toBe(false);
    // ...while a routed one both emits and arms the read.
    visuals.onFarmEvent(
      { type: 'farmPlanted', pid: 1, bedId: 'bed_eastbrook_1', cropId: 'vale_wheat' } as SimEvent,
      1,
    );
    expect(calls).toEqual(['puff', 'burst']);
    expect((visuals as unknown as { dirty: boolean }).dirty).toBe(true);
  });
});
