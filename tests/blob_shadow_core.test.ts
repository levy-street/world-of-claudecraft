import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BLOB_FADE_HEIGHT,
  BLOB_GROUND_LIFT,
  BLOB_MIN_SCALE,
  BLOB_RADIUS_MAX,
  BLOB_RADIUS_MIN,
  BLOB_RADIUS_PER_HEIGHT,
  type BlobShadowSlot,
  blobBaseRadius,
  blobDistanceFade,
  blobHeightFade,
  blobShadowPlanInto,
  createBlobShadowSlot,
  JUMP_APEX,
} from '../src/render/blob_shadow_core';

const RANGE_SQ = 58 * 58;

/** A grounded body of human height standing 10 yards from the camera anchor. */
function planGrounded(out: BlobShadowSlot, overrides: Partial<Record<string, number>> = {}) {
  return blobShadowPlanInto(
    out,
    overrides.x ?? 12,
    overrides.drawnY ?? 4,
    overrides.z ?? -7,
    overrides.groundY ?? 4,
    overrides.baseRadius ?? blobBaseRadius(1.85, 1),
    overrides.distanceSq ?? 10 * 10,
    RANGE_SQ,
    true,
  );
}

describe('blob shadow footprint radius', () => {
  it('scales with body height and scale, clamped at both ends', () => {
    expect(blobBaseRadius(1.85, 1)).toBeCloseTo(1.85 * BLOB_RADIUS_PER_HEIGHT, 6);
    // a mounted / grown body scales with it
    expect(blobBaseRadius(1.85, 2)).toBeCloseTo(1.85 * 2 * BLOB_RADIUS_PER_HEIGHT, 6);
    // a critter never loses its blob entirely
    expect(blobBaseRadius(0.3, 1)).toBe(BLOB_RADIUS_MIN);
    // a boss-scale rig never paints a car park
    expect(blobBaseRadius(12, 4)).toBe(BLOB_RADIUS_MAX);
  });
});

describe('blob shadow height fade', () => {
  it('is full on the ground and gone by the fade height', () => {
    expect(blobHeightFade(0)).toBe(1);
    expect(blobHeightFade(-0.5)).toBe(1); // below its ground reference: never inverts
    expect(blobHeightFade(BLOB_FADE_HEIGHT)).toBe(0);
    expect(blobHeightFade(BLOB_FADE_HEIGHT * 4)).toBe(0);
  });

  it('is anchored to the real jump arc: half at a plain hop apex, gone by a knockup', () => {
    expect(JUMP_APEX).toBeCloseTo(1.125, 6);
    expect(BLOB_FADE_HEIGHT).toBeCloseTo(2.25, 6);
    expect(blobHeightFade(JUMP_APEX)).toBeCloseTo(0.5, 6);
    expect(blobHeightFade(1.76)).toBeGreaterThan(0); // a mounted hop still shows
    expect(blobHeightFade(1.76)).toBeLessThan(0.25);
    expect(blobHeightFade(3)).toBe(0); // knockup
  });

  it('never increases as the body rises', () => {
    let prev = blobHeightFade(0);
    for (let h = 0.05; h <= BLOB_FADE_HEIGHT + 0.5; h += 0.05) {
      const next = blobHeightFade(h);
      expect(next).toBeLessThanOrEqual(prev);
      prev = next;
    }
  });
});

describe('blob shadow distance fade', () => {
  it('is full up close, eased at the edge, and zero past the range', () => {
    expect(blobDistanceFade(0, RANGE_SQ)).toBe(1);
    expect(blobDistanceFade(20 * 20, RANGE_SQ)).toBe(1);
    expect(blobDistanceFade(RANGE_SQ, RANGE_SQ)).toBe(0);
    expect(blobDistanceFade(RANGE_SQ * 4, RANGE_SQ)).toBe(0);
    const edge = blobDistanceFade(57 * 57, RANGE_SQ);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(0.2); // eased out, so nothing pops at the boundary
  });

  it('never increases with distance', () => {
    let prev = blobDistanceFade(0, RANGE_SQ);
    for (let d = 1; d <= 60; d += 0.5) {
      const next = blobDistanceFade(d * d, RANGE_SQ);
      expect(next).toBeLessThanOrEqual(prev);
      prev = next;
    }
  });
});

describe('blob shadow plan', () => {
  it('shows a grounded body in range, lifted just above its ground', () => {
    const slot = createBlobShadowSlot();
    planGrounded(slot);
    expect(slot.visible).toBe(true);
    expect(slot.x).toBe(12);
    expect(slot.z).toBe(-7);
    expect(slot.y).toBeCloseTo(4 + BLOB_GROUND_LIFT, 6);
    expect(BLOB_GROUND_LIFT).toBeGreaterThan(0);
    expect(slot.scale).toBeCloseTo(blobBaseRadius(1.85, 1), 6);
  });

  it('collapses the instance out of range instead of hiding it some other way', () => {
    const slot = createBlobShadowSlot();
    planGrounded(slot, { distanceSq: RANGE_SQ + 1 });
    expect(slot.visible).toBe(false);
    expect(slot.scale).toBe(0);
  });

  it('collapses a body the renderer is not drawing (hidden view, off screen, dead-hidden)', () => {
    const slot = createBlobShadowSlot();
    blobShadowPlanInto(slot, 12, 4, -7, 4, blobBaseRadius(1.85, 1), 100, RANGE_SQ, false);
    expect(slot.visible).toBe(false);
    expect(slot.scale).toBe(0);
    // ...and the position is still written, so a stale slot can never be reused
    expect(slot.y).toBeCloseTo(4 + BLOB_GROUND_LIFT, 6);
  });

  it('shrinks with height and collapses once the body has cleared the fade', () => {
    const slot = createBlobShadowSlot();
    const grounded = planGrounded(slot).scale;
    const mid = planGrounded(slot, { drawnY: 4 + JUMP_APEX }).scale;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(grounded);
    planGrounded(slot, { drawnY: 4 + BLOB_FADE_HEIGHT });
    expect(slot.visible).toBe(false);
    expect(slot.scale).toBe(0);
    // a swimmer: the lake bed several yards below is what collapses the blob
    planGrounded(slot, { drawnY: 4, groundY: -1 });
    expect(slot.visible).toBe(false);
  });

  it('drops a sub-pixel blob rather than drawing a speck', () => {
    const slot = createBlobShadowSlot();
    planGrounded(slot, { baseRadius: BLOB_MIN_SCALE / 2 });
    expect(slot.visible).toBe(false);
    expect(slot.scale).toBe(0);
    planGrounded(slot, { baseRadius: 0 });
    expect(slot.visible).toBe(false);
  });

  it('is allocation free: the caller owns the slot and gets it back', () => {
    const slot = createBlobShadowSlot();
    const first = planGrounded(slot);
    const second = planGrounded(slot, { x: 3, distanceSq: RANGE_SQ * 2 });
    expect(first).toBe(slot);
    expect(second).toBe(slot);
    expect(slot.x).toBe(3);
  });
});

describe('renderer wiring', () => {
  const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

  it('builds the blob painter ONLY where dynamic shadows are off', () => {
    expect(source).toContain(
      'if (!GFX.dynamicShadows) {\n      this.blobShadows = new BlobShadows();',
    );
    // exactly one construction site, so no second path can build it on a
    // tier that already casts real shadows
    expect(source.match(/new BlobShadows\(\)/g)).toHaveLength(1);
  });

  it('drives it from the character loop, at the fixed (never crowd-adaptive) range', () => {
    expect(source).toContain('this.blobShadows?.begin();');
    expect(source).toContain('this.blobShadows.push(');
    expect(source).toContain('blobShadowPlanInto(');
    expect(source).toContain('this.blobShadows?.commit();');
    expect(source).toContain('const BLOB_SHADOW_RANGE_SQ = CHARACTER_LOD_RANGE_SQ;');
    // the plan reads the entity data the loop already has, never a raycast
    expect(source).toContain('blobBaseRadius(active.height, v.liveScale),');
    expect(source).toContain(
      'const blobGroundY = onSurface ? smoothY : groundHeight(x, z, this.sim.cfg.seed);',
    );
  });

  it('keeps the blob out of the real shadow plumbing', () => {
    // one scratch slot for the whole crowd: no per-character allocation
    expect(source).toContain('private blobShadowSlot: BlobShadowSlot = createBlobShadowSlot();');
    expect(source).not.toMatch(/blobShadows[^\n]*setShadow/);
    expect(source).not.toMatch(/blobShadows[^\n]*setProxyShadow/);
  });
});

describe('blob painter', () => {
  const source = readFileSync(new URL('../src/render/blob_shadows.ts', import.meta.url), 'utf8');

  it('is one instanced draw with its own dense character blob texture', () => {
    expect(source.match(/new THREE\.InstancedMesh\(/g)).toHaveLength(1);
    // Deliberately NOT the Vale Cup ball's contact texture: a character stands
    // ON its blob and occludes the core, so the character texture holds a wide
    // dense core and shoulder (the visibility calibration comment in the
    // painter). The alpha stops are pinned so a well-meaning re-share of the
    // ball texture, whose skirt measured invisible on dark ground, goes red.
    expect(source).toContain('this.texture = characterBlobTexture();');
    expect(source).toContain("grd.addColorStop(0.4, 'rgba(10,8,5,0.55)');");
    expect(source).toContain("grd.addColorStop(0.75, 'rgba(10,8,5,0.35)');");
    expect(source).not.toContain('contactBlobTexture');
    expect(source).toContain('depthWrite: false,');
    expect(source).toContain('transparent: true,');
    expect(source).toContain('polygonOffset: true,');
    expect(source).toContain('this.mesh.frustumCulled = false;');
    expect(source).toContain('this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);');
  });

  it('uploads only on a real change and skips the draw when nothing was filled', () => {
    expect(source).toContain('if (this.dirty) this.mesh.instanceMatrix.needsUpdate = true;');
    expect(source).toContain('this.mesh.count = this.count;');
    expect(source).toContain('this.mesh.visible = this.count > 0;');
  });
});

describe('blob painter write-elision (behavioral)', () => {
  // A Float32Array elision cache truncates the float64 slot values, so every
  // comparison is false and the buffer re-uploads each frame (review round 1).
  // This is the behavioral pin the source-text assertion above cannot give:
  // the same slot pushed twice must not mark the buffer dirty again.
  const fakeCtx = {
    createRadialGradient: () => ({ addColorStop() {} }),
    fillStyle: null as unknown,
    fillRect() {},
  };
  const fakeCanvas = { width: 0, height: 0, getContext: () => fakeCtx };

  it('re-uploads on a real change only, at real world coordinates', async () => {
    (globalThis as Record<string, unknown>).document = {
      createElement: () => fakeCanvas,
    };
    try {
      const { BlobShadows } = await import('../src/render/blob_shadows');
      const painter = new BlobShadows();
      const slot = {
        x: 137.42318,
        y: 1.5612348,
        z: -42.703125e-1 * 13.7,
        scale: 0.7823411,
        visible: true,
      };
      // BufferAttribute.needsUpdate is a write-only setter that bumps
      // `version`; the readable signal is the version counter.
      const v0 = painter.mesh.instanceMatrix.version;
      painter.begin();
      painter.push(slot);
      painter.commit();
      expect(painter.mesh.count).toBe(1);
      const v1 = painter.mesh.instanceMatrix.version;
      expect(v1).toBeGreaterThan(v0);

      painter.begin();
      painter.push(slot);
      painter.commit();
      expect(painter.mesh.count).toBe(1);
      expect(painter.mesh.instanceMatrix.version).toBe(v1);

      slot.x += 0.25;
      painter.begin();
      painter.push(slot);
      painter.commit();
      expect(painter.mesh.instanceMatrix.version).toBeGreaterThan(v1);
    } finally {
      delete (globalThis as Record<string, unknown>).document;
    }
  });
});
