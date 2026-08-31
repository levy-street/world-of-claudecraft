import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CharacterVisual } from '../src/render/characters';
import { spinMountWheels, type WheelSpinView } from '../src/render/rickshaw_mount';

/** Builds a minimal WheelSpinView backed by a real THREE.Group carrying named
 *  wheel nodes at a known radius, so the tests exercise real Object3D math
 *  (rotateX, getObjectByName, Box3) rather than a mocked stand-in. */
function makeWheelView(opts: { withWheels?: boolean; radius?: number } = {}): WheelSpinView {
  const { withWheels = true, radius = 0.3 } = opts;
  const root = new THREE.Group();
  if (withWheels) {
    for (const name of ['Wheel_L', 'Wheel_R']) {
      // +X is the axle (spinMountWheels rotates about X), so the cylinder's
      // own axis (Y by default) is rotated onto X: its disk then spans the
      // Y/Z plane, matching a real wheel's Y-extent to its diameter.
      const geometry = new THREE.CylinderGeometry(radius, radius, 0.08, 8);
      geometry.rotateZ(Math.PI / 2);
      const wheel = new THREE.Mesh(geometry);
      wheel.name = name;
      // getObjectByName traverses the tree; nest one level to match the real
      // shipped GLB shape (wheels are children of a frame node, not the root).
      const frame = new THREE.Group();
      frame.add(wheel);
      root.add(frame);
    }
  }
  return {
    mountVisual: { root } as unknown as CharacterVisual,
    mountWheels: undefined,
    mountWheelRadius: undefined,
  };
}

function wheelAngles(v: WheelSpinView): number[] {
  return (v.mountWheels ?? []).map((w) => w.rotation.x);
}

describe('spinMountWheels', () => {
  it('does nothing when mountVisual is null', () => {
    const v: WheelSpinView = { mountVisual: null };
    spinMountWheels(v, 5, false, 1 / 20);
    expect(v.mountWheels).toBeUndefined();
  });

  it('finds and caches the wheel nodes on first call, keeps the cache on later calls', () => {
    const v = makeWheelView();
    expect(v.mountWheels).toBeUndefined();
    spinMountWheels(v, 5, false, 1 / 20);
    expect(v.mountWheels).toHaveLength(2);
    const firstLookup = v.mountWheels;
    spinMountWheels(v, 5, false, 1 / 20);
    // Same array reference: the lookup ran once, not once per call.
    expect(v.mountWheels).toBe(firstLookup);
  });

  it('caches a null (not undefined) absence for a mount with no wheel nodes', () => {
    const v = makeWheelView({ withWheels: false });
    spinMountWheels(v, 5, false, 1 / 20);
    expect(v.mountWheels).toBeNull();
    expect(v.mountWheelRadius).toBeUndefined();
  });

  it('measures the wheel radius off the built model rather than a hardcoded constant', () => {
    const v = makeWheelView({ radius: 0.42 });
    spinMountWheels(v, 5, false, 1 / 20);
    // Box3 measures the full mesh extent (cylinder radius on both axes it
    // matters for here), so the derived radius should land close to authored.
    expect(v.mountWheelRadius).toBeCloseTo(0.42, 1);
  });

  it('rotates both wheels forward by v*dt/r for positive, non-backwards speed', () => {
    const v = makeWheelView({ radius: 0.5 });
    const speed = 4;
    const dt = 1 / 20;
    spinMountWheels(v, speed, false, dt);
    const expected = (speed * dt) / 0.5;
    for (const angle of wheelAngles(v)) expect(angle).toBeCloseTo(expected, 5);
  });

  it('rotates the opposite direction when backwards is true', () => {
    const v = makeWheelView({ radius: 0.5 });
    const speed = 4;
    const dt = 1 / 20;
    spinMountWheels(v, speed, true, dt);
    const expected = -(speed * dt) / 0.5;
    for (const angle of wheelAngles(v)) expect(angle).toBeCloseTo(expected, 5);
  });

  it('accumulates rotation across frames (integrates, does not snap)', () => {
    // Small speed/dt/radius combination on purpose: rotation.x reads back
    // through a quaternion-to-Euler conversion that wraps to (-pi, pi], so
    // the test stays well inside that range rather than asserting through a
    // wrap seam.
    const v = makeWheelView({ radius: 2 });
    const speed = 0.5;
    const dt = 1 / 20;
    spinMountWheels(v, speed, false, dt);
    const afterOne = wheelAngles(v)[0];
    spinMountWheels(v, speed, false, dt);
    const afterTwo = wheelAngles(v)[0];
    expect(afterTwo).toBeCloseTo(afterOne * 2, 5);
  });

  it('holds the wheel exactly still, not slowing to a stop, once speed hits zero', () => {
    const v = makeWheelView({ radius: 0.5 });
    spinMountWheels(v, 5, false, 1 / 20);
    const spunAngle = wheelAngles(v)[0];
    expect(spunAngle).not.toBe(0);
    // A hard stop, per the module's own contract: no further rotation applied
    // on the very next frame speed drops to zero, no decelerating coast.
    spinMountWheels(v, 0, false, 1 / 20);
    expect(wheelAngles(v)[0]).toBe(spunAngle);
  });

  it('treats speed at or below the deadzone as stopped (absorbs jitter, not a real crawl)', () => {
    const v = makeWheelView({ radius: 0.5 });
    spinMountWheels(v, 0.05, false, 1 / 20);
    expect(wheelAngles(v)[0]).toBe(0);
  });

  it('still rolls a genuine slow crawl just above the deadzone', () => {
    const v = makeWheelView({ radius: 0.5 });
    spinMountWheels(v, 0.06, false, 1 / 20);
    expect(wheelAngles(v)[0]).toBeGreaterThan(0);
  });
});
