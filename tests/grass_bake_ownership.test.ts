// The grass ground bake is a module singleton holding a render-target texture
// owned by one WebGLRenderer's GL context. Terrain materials capture it when
// they BUILD, and terrain chunks build lazily as the player walks, so getting
// its lifetime wrong does not show up at spawn, it eats the ground a chunk at
// a time over the next half minute.
//
// Two ways to get it wrong, and this pins the boundary between them:
//
//  1. Never clearing it. The Studio rebuilds the renderer on every map load and
//     on return from Playtest, so the next renderer's terrain binds a texture
//     from a dead context and the ground samples WHITE.
//  2. Clearing it unconditionally in Renderer.shutdown(). That runs from an
//     ASYNC shutdownTask, which can land AFTER the incoming renderer has
//     already baked and built its materials, so the teardown disposes the
//     LIVE bake and the ground goes white again, progressively, as chunks
//     re-mesh while walking. (Shipped 2026-09-22, made it worse.)
//
// Ownership is what separates them: a renderer may only retire the bake it
// made itself.
import { describe, expect, it } from 'vitest';
import {
  clearGrassGroundBakeFor,
  getGrassGroundBake,
  setGrassGroundBake,
} from '../src/render/grass_ground_bake';

type Renderer = { id: string };
const fakeBake = (owner: Renderer) => {
  let disposed = false;
  return {
    bake: {
      owner: owner as unknown as Parameters<typeof clearGrassGroundBakeFor>[0],
      texture: {
        dispose() {
          disposed = true;
        },
      } as unknown as import('three').Texture,
      mean: [0, 0, 0] as [number, number, number],
    },
    isDisposed: () => disposed,
  };
};

describe('grass ground bake ownership', () => {
  it('lets a renderer retire its own bake', () => {
    const a: Renderer = { id: 'A' };
    const { bake, isDisposed } = fakeBake(a);
    setGrassGroundBake(bake);

    expect(clearGrassGroundBakeFor(a as never)).toBe(true);
    expect(getGrassGroundBake()).toBeNull();
    expect(isDisposed()).toBe(true);
  });

  it("does NOT let a late teardown dispose the incoming renderer's bake", () => {
    // The real sequence: engine A starts shutting down, engine B is built and
    // bakes, THEN A's async teardown finally runs.
    const a: Renderer = { id: 'outgoing' };
    const b: Renderer = { id: 'incoming' };
    const first = fakeBake(a);
    setGrassGroundBake(first.bake);

    const second = fakeBake(b);
    setGrassGroundBake(second.bake); // B bakes at construction

    expect(clearGrassGroundBakeFor(a as never)).toBe(false); // A's late teardown
    expect(getGrassGroundBake()).toBe(second.bake); // B's bake survives
    expect(second.isDisposed()).toBe(false); // and its texture is alive
  });

  it('is a no-op when nothing is baked', () => {
    setGrassGroundBake(null);
    expect(clearGrassGroundBakeFor({ id: 'x' } as never)).toBe(false);
    expect(getGrassGroundBake()).toBeNull();
  });
});
