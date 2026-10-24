import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  attachGrassInteractionUniforms,
  createGrassInteractionState,
  evaluateGrassInteractionAt,
  GRASS_INTERACT_BASE_RADIUS,
  GRASS_INTERACT_MAX_WAKE_LEN,
  GRASS_INTERACT_MOVE_RADIUS,
  GRASS_INTERACT_TELEPORT_DIST,
  grassBladeInteractionGlsl,
  grassInteractionUniformDeclGlsl,
  grassTuftInteractionGlsl,
  stepGrassInteraction,
} from '../src/render/grass_interaction_core';

describe('player-through-grass interaction core', () => {
  it('starts at rest on the first step and is idempotent on duplicate frame timestamps', () => {
    const state = createGrassInteractionState();
    stepGrassInteraction(state, 10, -20, 1.0);
    expect(state.px).toBe(10);
    expect(state.pz).toBe(-20);
    expect(state.wakeX).toBe(10);
    expect(state.wakeZ).toBe(-20);
    expect(state.speedNorm).toBe(0);
    expect(state.rustleEnergy).toBe(0);
    expect(state.wakeStrength).toBe(0);
    expect(state.wakeRadius).toBeCloseTo(GRASS_INTERACT_BASE_RADIUS, 6);

    // Stepping again with the exact same timestamp and position is a no-op
    stepGrassInteraction(state, 10, -20, 1.0);
    expect(state.speedNorm).toBe(0);
  });

  it('builds smoothed velocity, trailing wake, and rustle energy as the player runs through grass', () => {
    const state = createGrassInteractionState();
    let t = 0;
    let x = 0;
    const z = 0;
    const dt = 1 / 60;
    const runSpeed = 7.2; // yards/sec along +X
    stepGrassInteraction(state, x, z, t);

    for (let frame = 0; frame < 30; frame++) {
      t += dt;
      x += runSpeed * dt;
      stepGrassInteraction(state, x, z, t);
    }

    expect(state.speedNorm).toBeGreaterThan(0.85);
    expect(state.rustleEnergy).toBeGreaterThan(0.85);
    expect(state.dirX).toBeGreaterThan(0.98);
    expect(Math.abs(state.dirZ)).toBeLessThan(0.05);
    // Wake trails behind the player along -X within the max wake length
    expect(state.wakeX).toBeLessThan(state.px);
    expect(state.px - state.wakeX).toBeGreaterThan(0.4);
    expect(state.px - state.wakeX).toBeLessThanOrEqual(GRASS_INTERACT_MAX_WAKE_LEN + 1e-6);
    expect(state.wakeStrength).toBeGreaterThan(0.5);
    expect(state.wakeRadius).toBeGreaterThan(GRASS_INTERACT_BASE_RADIUS);
    expect(state.wakeRadius).toBeLessThanOrEqual(GRASS_INTERACT_MOVE_RADIUS);

    // Uniform values mirror the state for WebGLUniforms
    expect(state.uGrassMove.value).toEqual({
      x: state.dirX,
      y: state.dirZ,
      z: state.speedNorm,
      w: state.rustleEnergy,
    });
    expect(state.uGrassWake.value).toEqual({
      x: state.wakeX,
      y: state.wakeZ,
      z: state.wakeStrength,
      w: state.wakeRadius,
    });
  });

  it('parts blades outward to both sides of the player path, sweeps forward, and keeps roots planted', () => {
    const state = createGrassInteractionState();
    let t = 0;
    let x = 0;
    const dt = 1 / 60;
    stepGrassInteraction(state, x, 0, t);
    for (let i = 0; i < 25; i++) {
      t += dt;
      x += 7.2 * dt;
      stepGrassInteraction(state, x, 0, t);
    }

    // Root vertex (localY = 0) never moves
    const rootDisp = evaluateGrassInteractionAt(state, state.px + 0.3, 0.4, 0, t);
    expect(rootDisp.dx).toBe(0);
    expect(rootDisp.dy).toBe(0);
    expect(rootDisp.dz).toBe(0);

    // Blade to the left (z = -0.55) parts toward -Z and sweeps forward (+X), dipping downward (dy < 0)
    const leftTip = evaluateGrassInteractionAt(state, state.px, -0.55, 1.0, t);
    expect(leftTip.push).toBeGreaterThan(0.25);
    expect(leftTip.dz).toBeLessThan(-0.05);
    expect(leftTip.dx).toBeGreaterThan(0.02);
    expect(leftTip.dy).toBeLessThan(-0.02);

    // Blade to the right (z = +0.55) parts toward +Z and sweeps forward (+X), dipping downward (dy < 0)
    const rightTip = evaluateGrassInteractionAt(state, state.px, 0.55, 1.0, t);
    expect(rightTip.push).toBeGreaterThan(0.25);
    expect(rightTip.dz).toBeGreaterThan(0.05);
    expect(rightTip.dx).toBeGreaterThan(0.02);
    expect(rightTip.dy).toBeLessThan(-0.02);

    // Trailing wake behind the player (state.px - 0.9) still parts blades before springing back
    const wakeTip = evaluateGrassInteractionAt(state, state.px - 0.9, 0.35, 1.0, t);
    expect(wakeTip.push).toBeGreaterThan(0.1);
    expect(wakeTip.dz).toBeGreaterThan(0.01);

    // Far blades (> 4.5 yd away) are completely unaffected
    const farTip = evaluateGrassInteractionAt(state, state.px + 10, 10, 1.0, t);
    expect(farTip.push).toBe(0);
    expect(farTip.dx).toBe(0);
    expect(farTip.dy).toBe(0);
    expect(farTip.dz).toBe(0);
  });

  it('smoothly decays wake and rustle back to rest when the player stops moving', () => {
    const state = createGrassInteractionState();
    let t = 0;
    let x = 0;
    const dt = 1 / 60;
    stepGrassInteraction(state, x, 0, t);
    for (let i = 0; i < 20; i++) {
      t += dt;
      x += 7.2 * dt;
      stepGrassInteraction(state, x, 0, t);
    }
    const movingWake = state.wakeStrength;
    expect(movingWake).toBeGreaterThan(0.4);

    // Stand still for 2.5 seconds
    for (let i = 0; i < 150; i++) {
      t += dt;
      stepGrassInteraction(state, x, 0, t);
    }
    expect(state.speedNorm).toBeLessThan(0.005);
    expect(state.rustleEnergy).toBeLessThan(0.01);
    expect(state.wakeStrength).toBeLessThan(0.02);
    expect(Math.hypot(state.px - state.wakeX, state.pz - state.wakeZ)).toBeLessThan(0.02);
  });

  it('snaps the wake cleanly on a teleport jump instead of stretching a trail across the map', () => {
    const state = createGrassInteractionState();
    stepGrassInteraction(state, 0, 0, 0);
    stepGrassInteraction(state, 0.12, 0, 1 / 60);
    expect(state.speedNorm).toBeGreaterThan(0);

    // Jump beyond GRASS_INTERACT_TELEPORT_DIST
    const jumpX = GRASS_INTERACT_TELEPORT_DIST + 50;
    stepGrassInteraction(state, jumpX, -120, 2 / 60);
    expect(state.px).toBe(jumpX);
    expect(state.pz).toBe(-120);
    expect(state.wakeX).toBe(jumpX);
    expect(state.wakeZ).toBe(-120);
    expect(state.speedNorm).toBe(0);
    expect(state.wakeStrength).toBe(0);
  });

  it('wires uniforms and shader displacement into blade carpet, mid band, and card tufts', () => {
    const uniforms: Record<string, { value: unknown }> = {};
    const state = createGrassInteractionState(5, 6);
    attachGrassInteractionUniforms(uniforms, state);
    expect(uniforms.uGrassMove).toBe(state.uGrassMove);
    expect(uniforms.uGrassWake).toBe(state.uGrassWake);

    expect(grassInteractionUniformDeclGlsl()).toContain('uniform vec4 uGrassMove;');
    expect(grassInteractionUniformDeclGlsl()).toContain('uniform vec4 uGrassWake;');
    expect(grassBladeInteractionGlsl()).toContain('uGrassMove');
    expect(grassBladeInteractionGlsl()).toContain('uGrassWake');
    expect(grassTuftInteractionGlsl()).toContain('uGrassMove');
    expect(grassTuftInteractionGlsl()).toContain('uGrassWake');

    for (const file of ['blade_grass.ts', 'blade_grass_band.ts', 'foliage.ts']) {
      const src = readFileSync(new URL(`../src/render/${file}`, import.meta.url), 'utf8');
      expect(src, file).toContain('attachGrassInteractionUniforms(sh.uniforms)');
      expect(src, file).toContain('uniform vec4 uGrassMove;');
      expect(src, file).toContain('uniform vec4 uGrassWake;');
    }
  });
});
