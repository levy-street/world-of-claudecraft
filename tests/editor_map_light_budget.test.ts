// The Studio's authored map lights ride the GAME's point-light budget.
//
// The editor used to add every authored light to the scene live and leave it
// shining. That is not merely "a few extra lights": numPointLights is compiled
// into every lit material, so a 24-lamp city made EVERY material in the scene
// loop 24 lights per fragment and re-upload 24 light structs on each material
// switch. Measured on one of SPACEY's own lamp-lit city maps (Retina, his own
// save): 63 -> 78 fps with the draw count UNCHANGED - the cost was never
// geometry. And the look it bought was one no player can ever see, because the
// shipped game budgets these same lights down to GFX.maxPointLights.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyPointLightBudget,
  type RankedPointLight,
  swapBudgetedLights,
} from '../src/render/point_light_budget';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

const RANGE_SQ = 55 * 55;

function sourceOf(relativePath: string): string {
  return codeWithoutLineComments(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

/** An authored map light the way viewport.ts builds one. */
function authored(x: number, z: number, intensity = 2.2): RankedPointLight {
  const light = new THREE.PointLight(0x7fd8ff, intensity, 34, 1.8);
  light.position.set(x, 4.5, z);
  light.updateMatrixWorld(true);
  return {
    light,
    d2: 0,
    worldPos: light.getWorldPosition(new THREE.Vector3()),
    // Static document value, so the budget owns it: NOT budgetDynamic.
    base: intensity,
    dynamic: false,
  };
}

describe('editor map lights', () => {
  it('lights only the nearest maxPointLights of a city ring, and rests the others', () => {
    // 24 lamps on a ring, the shape of a walled city's lamp line.
    const ranked: RankedPointLight[] = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ranked.push(authored(Math.cos(a) * 40, Math.sin(a) * 40));
    }
    const budget = 6;
    const drawn = applyPointLightBudget(ranked, 40, 0, budget, budget, RANGE_SQ);

    expect(drawn).toBe(budget);
    const lit = ranked.filter((r) => r.light.visible && r.light.intensity > 0);
    expect(lit).toHaveLength(budget);
    // and they are the six nearest the ranking origin, not the first six built
    const nearest = [...ranked].sort((a, b) => a.d2 - b.d2).slice(0, budget);
    expect(new Set(lit.map((r) => r.light.uuid))).toEqual(
      new Set(nearest.map((r) => r.light.uuid)),
    );
    // the rest are off, not dimmed: a resting lamp costs no shader work
    for (const r of ranked) {
      if (lit.includes(r)) continue;
      expect(r.light.intensity).toBe(0);
    }
  });

  it('gives a lamp its authored intensity back when the camera returns to it', () => {
    const near = authored(0, 0, 2.2);
    const far = authored(300, 0, 2.2);
    applyPointLightBudget([near, far], 300, 0, 1, 1, RANGE_SQ);
    expect(near.light.intensity).toBe(0);
    expect(far.light.intensity).toBe(2.2);

    applyPointLightBudget([near, far], 0, 0, 1, 1, RANGE_SQ);
    expect(near.light.intensity).toBe(2.2);
    expect(far.light.intensity).toBe(0);
  });

  it('is wired up: the editor hands its lights over and stops forcing them visible', () => {
    const viewport = sourceOf('../src/editor/3d/viewport.ts');
    // every rebuild of the light group hands the live list over (the empty
    // case included, or a deleted light leaks into the rank forever)
    expect(viewport).toContain('this.renderer.editor.setEditorMapLights(livePointLights)');
    expect(viewport.match(/setEditorMapLights\(/g) ?? []).toHaveLength(1);
    // the preview-mode toggles must not fight the budget for light.visible
    expect(viewport).not.toContain('for (const c of this.lightsGroup.children) c.visible = true');
    expect(viewport).not.toContain('c.visible = (c as THREE.Light).isLight === true');

    // the hook lives on the renderer's editor facade (renderer.editor)
    const facade = sourceOf('../src/render/editor_api/editor_api.ts');
    expect(facade).toContain('setEditorMapLights(lights: readonly THREE.PointLight[]): void');
    // the list surgery is the budget module's (the renderer owns registries,
    // not decisions), and it RELEASES before re-registering
    const start = facade.indexOf('  setEditorMapLights(');
    const body = facade.slice(start, facade.indexOf('\n  }', start));
    expect(body).toContain('swapBudgetedLights(this.host.viewLights(), this.mapLights, lights)');
    expect(body).toContain('this.host.markLightRankDirty()');
    const renderer = sourceOf('../src/render/renderer.ts');
    expect(renderer).toContain('markLightRankDirty: () => {\n        r.lightRankDirty = true;');
    // and NOT budgetDynamic: the budget owns a static lamp's intensity
    expect(body).not.toContain('budgetDynamic');
  });

  it('swaps a rebuilt light group without stacking dead lights in the rank', () => {
    // The editor rebuilds its whole light group on every document edit, so the
    // release half is what keeps 20 edits from leaving 480 lights in the rank.
    const viewLights: THREE.PointLight[] = [];
    const first = [authored(0, 0).light, authored(10, 0).light];
    let held = swapBudgetedLights(viewLights, [], first);
    expect(viewLights).toHaveLength(2);
    expect(held).toEqual(first);
    expect(first[0].userData.budgetBase).toBe(2.2);

    const second = [authored(20, 0, 3.5).light];
    held = swapBudgetedLights(viewLights, held, second);
    expect(viewLights).toEqual(second);
    expect(second[0].userData.budgetBase).toBe(3.5);

    // a foreign light in the same registry is never disturbed by the swap
    const foreign = authored(99, 99).light;
    viewLights.push(foreign);
    held = swapBudgetedLights(viewLights, held, []);
    expect(viewLights).toEqual([foreign]);
    expect(held).toEqual([]);
  });

  it('ranks from the free-cam look-at while the editor hosts the renderer', () => {
    const renderer = sourceOf('../src/render/renderer.ts');
    const start = renderer.indexOf('  private budgetFireLights(');
    const body = renderer.slice(start, renderer.indexOf('\n  private ', start + 1));
    // the dummy player sits at the map's spawn; ranking from it would light the
    // spawn while the maker works a mile away
    expect(body).toContain('this.editorCam ? this.cameraLookAt.x : px');
    expect(body).toContain('this.editorCam ? this.cameraLookAt.z : pz');
    expect(body).toContain('px: rankX');
    expect(body).toContain('pz: rankZ');
  });
});
