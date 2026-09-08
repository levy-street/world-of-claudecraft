import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { OverlaySprites } from '../src/render/ability_vfx/overlay_sprites';
import type { RibbonAnchor } from '../src/render/ability_vfx/ribbons';
import { WarriorAttention } from '../src/render/ability_vfx/warrior_attention';

function fixture() {
  const state = new WarriorAttention(),
    push = vi.fn();
  const missing = new Set<number>();
  const anchor: RibbonAnchor = (id, frac, out) =>
    missing.has(id) ? null : out!.set(id, frac * 2, 0);
  const draw = (frame = 1, reduced = false) =>
    state.draw(frame, reduced, anchor, new THREE.Vector3(0, 0, 1), {
      push,
    } as unknown as OverlaySprites);
  return { state, push, missing, anchor, draw };
}
it('uses the current source and real remaining time without replaying late acquisition', () => {
  const f = fixture();
  f.state.hold(5, 1, 1.5, 1, true);
  f.draw();
  expect(f.push).toHaveBeenCalledExactlyOnceWith(5, 1.64, 0.85, 0xffa875, 1.18, 8, 1, 1.45, 1);
  f.push.mockClear();
  f.state.hold(5, 2, 1.4, 2, true);
  f.missing.add(1);
  f.draw(2);
  expect(f.push).toHaveBeenCalledTimes(1);
  f.push.mockClear();
  // The authoritative living source is already validated by the painter.
  // Its off-camera model must not hide a visible recipient's real control.
  f.missing.add(2);
  f.draw(2);
  expect(f.push).toHaveBeenCalledTimes(1);
  f.push.mockClear();
  f.missing.add(5);
  f.draw(2);
  expect(f.push).not.toHaveBeenCalled();
});
it('drops stale, sleeping and cleared state in the next rendered frame', () => {
  const f = fixture();
  f.state.hold(5, 1, 3, 1, false);
  f.draw(2);
  expect(f.push).not.toHaveBeenCalled();
  f.state.hold(5, 1, 2, 3, false);
  f.state.sleep(5);
  f.draw(3);
  expect(f.push).not.toHaveBeenCalled();
  f.state.hold(5, 1, 2, 4, false);
  f.state.clear();
  f.draw(4);
  expect(f.push).not.toHaveBeenCalled();
});
it('keeps a fixed 32-enemy budget and admits local forced attention ahead of remote decoration', () => {
  const f = fixture();
  for (let id = 1; id <= 40; id++) f.state.hold(id, 100, 2, 1, false);
  f.state.hold(90, 100, 2, 1, true);
  f.draw();
  expect(f.push).toHaveBeenCalledTimes(32);
  expect(f.push.mock.calls.some((c) => c[0] === 90)).toBe(true);
  expect(f.push.mock.calls.some((c) => c[0] === 1)).toBe(false);
});
it('does not overfill a pool whose entries are all local priorities', () => {
  const f = fixture();
  for (let id = 1; id <= 40; id++) f.state.hold(id, 100, 2, 1, true);
  f.draw();
  expect(f.push).toHaveBeenCalledTimes(32);
});
it('rejects invalid lifetimes and preserves the reduced-motion final cel', () => {
  const f = fixture();
  for (const t of [0, -1, NaN, Infinity]) f.state.hold(5, 1, t, 1, true);
  f.draw();
  expect(f.push).not.toHaveBeenCalled();
  f.state.hold(5, 1, 3, 1, true);
  f.draw(1, true);
  expect(f.push.mock.calls[0][5]).toBe(8);
});
it('can replace a cosmetic sprite at capacity without replacing protected hard-control points', () => {
  const scene = new THREE.Scene(),
    tex = new THREE.Texture();
  const overlay = new OverlaySprites(scene, { overlay: tex } as AbilityVfxTextures);
  overlay.beginFrame();
  for (let i = 0; i < 20; i++) overlay.push(i, 0, 0, 0xffffff, 1, 0, 1, 1);
  overlay.protectPrefix();
  for (let i = 20; i < 128; i++) overlay.push(i, 0, 0, 0xffffff, 1, 0, 1, 1);
  const f = fixture();
  f.state.hold(999, 1, 2, 1, true);
  f.state.draw(1, false, f.anchor, new THREE.Vector3(0, 0, 1), overlay);
  overlay.commit();
  const points = scene.children.find((n) => (n as THREE.Points).isPoints) as THREE.Points;
  const pos = points.geometry.getAttribute('position');
  expect(points.geometry.drawRange.count).toBe(128);
  for (let i = 0; i < 20; i++) expect(pos.getX(i)).toBe(i);
  expect(Array.from({ length: 128 }, (_, i) => pos.getX(i))).toContain(999);
  overlay.dispose();
  tex.dispose();
});
