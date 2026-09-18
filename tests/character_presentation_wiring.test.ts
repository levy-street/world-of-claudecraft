import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AbilityVfxFx } from '../src/render/ability_vfx/fx';
import { AbilityVfx, type AbilityVfxDeps } from '../src/render/ability_vfx/painter';
import type { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import { WarriorPowerForms } from '../src/render/ability_vfx/warrior_power_forms';
import { type WarriorPowerPiece, warriorPowerPiece } from '../src/render/warrior_power_core';

const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
const characterVisual = readFileSync(
  new URL('../src/render/characters/visual.ts', import.meta.url),
  'utf8',
);
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('character presentation sleep wiring', () => {
  it('routes hidden cosmetic rigs through bounded off-screen advancement', () => {
    expect(renderer).toContain(
      'const characterCasting = characterPresentationCasting(\n        e.castingAbility,\n        waterJetVisualChannel,\n        visuallyDead,',
    );
    expect(renderer).toContain(
      'const actionablePose = animatesEveryFrame(\n        id,\n        p.id,\n        p.targetId,\n        characterCasting,',
    );
    expect(renderer).toContain(
      'const runCharacterPresentation = shouldRunCharacterPresentationWork(',
    );
    expect(renderer).toContain(
      'if (runCharacterPresentation) active.update(dt, st, animate, this.reducedMotion());',
    );
    expect(renderer).toContain('else active.advanceOffscreen(dt);');
    // The weapon-skin rig is still gated on presentation (a hidden rig writes no
    // uniforms), and a visible one now carries its shed multiplier: the pin
    // covers both halves so neither can be dropped.
    expect(renderer).toContain(
      'if (runCharacterPresentation) {\n        v.visual.updateWeaponVfx(dt, weaponVfxShedScale(d2, this.appliedBudgetLevels?.vfx ?? 1));\n      }',
    );
    expect(renderer).toContain('v.mountVisual.advanceOffscreen(dt);');
  });

  it('ticks deferred weapon stow transitions while a rig is off screen', () => {
    const start = characterVisual.indexOf('advanceOffscreen(dt: number): void {');
    const end = characterVisual.indexOf('\n  /**', start + 1);
    const offscreenBlock = characterVisual.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(offscreenBlock).toContain('tickStow(this.stow, dt)');
    expect(offscreenBlock).toContain("if (stowTick === 'swap') this.applyStowSwap();");
    expect(offscreenBlock).toContain('this.endStowGesture();');
  });

  it('routes Recklessness sleep and re-entry through actual aura age without replaying activation', () => {
    expect(renderer.includes('this.abilityVfx.syncEntity(e, runCharacterPresentation);')).toBe(
      true,
    );
    const pool = new WarriorPowerForms(new THREE.Scene());
    for (const prep of pool.preparation) vi.spyOn(prep, 'ready').mockReturnValue(true);
    // Keep the real power hold/sleep dispatch. Other families own separate pools
    // and are inert here; no browser, texture generation or GPU setup is needed.
    const fx = Object.create(AbilityVfxFx.prototype) as AbilityVfxFx;
    const sleep = () => ({ sleep: vi.fn() });
    Object.assign(fx, {
      frame: 0,
      powerForms: pool,
      controlSignals: sleep(),
      guards: sleep(),
      furyStates: sleep(),
      warriorAttention: sleep(),
      warriorStorms: new Map(),
      crests: { releaseHeld: vi.fn() },
      ccBands: new Map(),
      windups: new Map(),
      orbits: new Map(),
      shells: { sleepEntity: vi.fn() },
      groundAuras: { sleepEntity: vi.fn() },
      glows: new Map(),
      cancelWarriorHammer: vi.fn(),
      holdControlSignals: vi.fn(),
    });
    const activation = vi.spyOn(fx, 'sequenceInstant').mockReturnValue(false);
    const sound = vi.fn(),
      detail = vi.fn();
    const painter = new AbilityVfx(
      {
        fx,
        vfx: {},
        localPlayerId: () => 1,
        warriorSpecOf: () => 'fury',
        abilityAudio: sound,
      } as unknown as AbilityVfxDeps,
      () => 0,
    );
    const e = {
      id: 1,
      castingAbility: null,
      castRemaining: 0,
      castTotal: 0,
      auras: [{ id: 'recklessness', kind: 'buff_reckless', duration: 20, remaining: 17 }],
    };
    const draw = (frame: number) =>
      pool.draw(
        frame,
        0,
        false,
        (_id, _fraction, out = new THREE.Vector3()) => out.set(0, 1, 0),
        () => 0,
        { appendHeld: vi.fn() } as unknown as AbilityVfxRibbons,
        detail,
      );
    const sync = (frame: number, visible: boolean, dead = false) => {
      Object.assign(fx, { frame });
      painter.syncEntity({ ...e, dead }, visible);
      draw(frame);
    };
    try {
      sync(0, true);
      expect(pool.meshes[1].count).toBe(6);
      sync(1, false);
      expect(pool.meshes.every((mesh) => mesh.count === 0 && !mesh.visible)).toBe(true);
      e.auras[0].remaining = 12;
      sync(10, true);
      expect(pool.meshes[1].count).toBe(6);
      for (let part = 0; part < 6; part++) {
        const p = warriorPowerPiece({} as WarriorPowerPiece, 1, 1, part, 8, false);
        const expected = new THREE.Matrix4().compose(
          new THREE.Vector3(p.x, p.y + 1, p.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.yaw, p.roll)),
          new THREE.Vector3(p.sx, p.sy, p.sz),
        );
        const actual = new THREE.Matrix4();
        pool.meshes[1].getMatrixAt(part, actual);
        actual.elements.forEach((value, index) => {
          expect(value).toBeCloseTo(expected.elements[index], 5);
        });
      }
      expect(detail).not.toHaveBeenCalled();
      expect(activation).not.toHaveBeenCalled();
      expect(sound).not.toHaveBeenCalled();
      e.auras[0].remaining = 20;
      sync(11, true);
      const fresh = new THREE.Matrix4();
      pool.meshes[1].getMatrixAt(0, fresh);
      const scale = new THREE.Vector3().setFromMatrixScale(fresh);
      expect(scale.y).toBeCloseTo(0.95 * 0.02, 6);
      e.auras[0].remaining = 0;
      sync(12, true);
      expect(pool.meshes.every((mesh) => mesh.count === 0 && !mesh.visible)).toBe(true);
      e.auras[0].remaining = 19;
      sync(13, true, true);
      expect(pool.meshes.every((mesh) => mesh.count === 0 && !mesh.visible)).toBe(true);
      expect(activation).not.toHaveBeenCalled();
      expect(sound).not.toHaveBeenCalled();
    } finally {
      activation.mockRestore();
      pool.dispose();
      vi.restoreAllMocks();
    }
  });

  it('sleeps ability VFX semantically while mount particles remain presentation-gated', () => {
    const mountStart = renderer.indexOf('if (v.mountVisual && mountSpec && mountShown) {');
    const abilityStart = renderer.indexOf('// per-ability windup orb + buff-orbit bands');
    expect(mountStart).toBeGreaterThan(-1);
    expect(abilityStart).toBeGreaterThan(mountStart);

    const mountBlock = renderer.slice(mountStart, abilityStart);
    expect(mountBlock).toContain('if (runCharacterPresentation) {');
    expect(mountBlock).toContain('this.vfx.mountSlimeTrail');
    expect(mountBlock).toContain('this.vfx.mountExhaust');
    expect(renderer.slice(abilityStart)).toContain(
      'this.abilityVfx.syncEntity(e, runCharacterPresentation);',
    );
    expect(renderer.slice(abilityStart)).toContain('if (runCharacterPresentation) {');
  });
});

// The recompose arm has no coverage that would run the composed body's
// GLTF/mixer pipeline (it needs a live GPU rig), so this pins the statement
// order the same way the far-LOD wiring above does: composedBefore is what
// keeps a body that WAS composed (a redesign clearing the look) recomposing
// down to the class rig, not just a body newly gaining one.
describe('modular recompose guard (source pin)', () => {
  it('nulls visualKey through composedBefore, in the order the recompose fix depends on', () => {
    const start = renderer.indexOf('if (e.modularAppearance !== v.modularAppearance) {');
    const end = renderer.indexOf('this.updateBaseVisual(e, v);', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = renderer.slice(start, end);

    const changedAt = block.indexOf('e.modularAppearance !== v.modularAppearance');
    const changedFnAt = block.indexOf(
      'modularLookChanged(v.modularAppearance, e.modularAppearance)',
    );
    const composedBeforeAt = block.indexOf('composedBefore');
    const guardAt = block.indexOf('!isMechWearer(e) && (modularLookFor(e) || composedBefore)');
    const copyAt = block.indexOf('v.modularAppearance = e.modularAppearance;');

    expect(changedAt).toBeGreaterThan(-1);
    expect(changedFnAt).toBeGreaterThan(changedAt);
    expect(composedBeforeAt).toBeGreaterThan(changedFnAt);
    expect(guardAt).toBeGreaterThan(composedBeforeAt);
    expect(copyAt).toBeGreaterThan(guardAt);
  });

  it('births EntityView with the current modularAppearance, nothing to reconcile on the first sync', () => {
    expect(renderer).toContain('modularAppearance: e.modularAppearance,');
  });
});

// The char-select roster row wiring lives in main.ts, not the renderer; same
// reason as above (a DOM-and-real-portrait-asset pipeline nothing here stands
// up), pinned as source in the same style.
describe('char-select roster wiring (source pins)', () => {
  it('captures the redesign opener before selectRow moves focus, and passes it to open()', () => {
    const start = main.indexOf(
      "row.querySelector('.reroll-char-btn')?.addEventListener('click', (e) => {",
    );
    const end = main.indexOf('redesignEditor.open(c, opener);', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = main.slice(start, end + 'redesignEditor.open(c, opener);'.length);

    const openerAt = block.indexOf('const opener = e.currentTarget as HTMLButtonElement;');
    const selectRowAt = block.indexOf('selectRow();');
    const openAt = block.indexOf('redesignEditor.open(c, opener);');

    expect(openerAt).toBeGreaterThan(-1);
    expect(selectRowAt).toBeGreaterThan(openerAt);
    expect(openAt).toBeGreaterThan(selectRowAt);
  });

  it('re-arms crest fallbacks after the composed-chip outerHTML swap', () => {
    // The swap lives in the roster's repaint module now (main.ts hands it the
    // row's hydrate); the order swap-then-hydrate is what keeps a blocked crest
    // asset on the fresh img falling back.
    const refresh = readFileSync(
      new URL('../src/ui/charselect_composed_refresh.ts', import.meta.url),
      'utf8',
    );
    const start = refresh.indexOf(
      "const chip = row.querySelector('.portrait-chip[data-portrait-composed]');",
    );
    expect(start).toBeGreaterThan(-1);
    const block = refresh.slice(start, refresh.indexOf('\n  };', start));
    const swapAt = block.indexOf('chip.outerHTML = chipHtml();');
    const hydrateAt = block.indexOf('hydrate();');
    expect(swapAt).toBeGreaterThan(-1);
    expect(hydrateAt).toBeGreaterThan(swapAt);
    expect(main).toContain('trackComposedChipRow(row, chipHtml, () => hydratePortraits(row));');
  });
});
