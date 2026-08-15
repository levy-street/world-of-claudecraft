import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { type DrainLifeParticleKind, DrainLifeVfx } from '../src/render/drain_life_vfx';

const DRAIN_LIFE_VFX_SOURCE = readFileSync(
  new URL('../src/render/drain_life_vfx.ts', import.meta.url),
  'utf8',
);

function drainFragmentShaderSource(): string {
  const fragmentShader = DRAIN_LIFE_VFX_SOURCE.match(
    /const DRAIN_FRAGMENT_SHADER = `([\s\S]*?)`;/,
  )?.[1];
  expect(fragmentShader).toBeDefined();
  return fragmentShader ?? '';
}

function harness() {
  const scene = new THREE.Scene();
  const anchors = new Map<number, THREE.Vector3>([
    [1, new THREE.Vector3(0, 1, 0)],
    [2, new THREE.Vector3(10, 1, 0)],
  ]);
  const particles: Array<{
    kind: DrainLifeParticleKind;
    x: number;
    vx: number;
  }> = [];
  const emit = vi.fn(
    (kind: DrainLifeParticleKind, x: number, _y: number, _z: number, vx: number) => {
      particles.push({ kind, x, vx });
    },
  );
  const vfx = new DrainLifeVfx(scene, (id) => anchors.get(id) ?? null, emit);
  return { scene, anchors, particles, emit, vfx };
}

describe('Drain Life sustained VFX', () => {
  it('keeps fragment-shader smoothstep edges ordered', () => {
    const fragmentShader = drainFragmentShaderSource();
    const number = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?`;
    const smoothsteps = [
      ...fragmentShader.matchAll(
        new RegExp(String.raw`smoothstep\s*\(\s*(${number})\s*,\s*(${number})\s*,`, 'gi'),
      ),
    ];
    expect(smoothsteps.length).toBeGreaterThan(0);
    for (const [, edge0, edge1] of smoothsteps) {
      expect(Number(edge0)).toBeLessThan(Number(edge1));
    }
  });

  it('inverts the terminal ramp so alpha survives through the middle of the beam', () => {
    const fragmentShader = drainFragmentShaderSource();
    expect(fragmentShader).toMatch(
      /float\s+endFade\s*=\s*smoothstep\(\s*0\.0,\s*0\.1,\s*vLong\s*\)\s*\*\s*\(\s*1\.0\s*-\s*smoothstep\(\s*0\.9,\s*1\.0,\s*vLong\s*\)\s*\)\s*;/,
    );
    expect(fragmentShader).toMatch(/float\s+alpha\s*=\s*edge\s*\*\s*endFade\s*\*/);
  });

  it('preallocates a fixed pool and reuses it across repeated full channels', () => {
    const h = harness();
    const childCount = h.scene.children.length;

    for (let cast = 0; cast < 30; cast++) {
      h.vfx.drain(1, 2, 5);
      h.vfx.update(0.1);
      h.vfx.drain(1, 2, 0);
    }

    expect(h.scene.children.length).toBe(childCount);
    expect(h.scene.children.some((child) => child.visible)).toBe(false);
  });

  it('shows extraction at the victim, absorption at the caster, and target-to-caster flow', () => {
    const h = harness();

    h.vfx.drain(1, 2, 5);
    h.vfx.update(0.25);

    expect(h.particles.some((particle) => particle.kind === 'extraction' && particle.x > 8)).toBe(
      true,
    );
    expect(h.particles.some((particle) => particle.kind === 'absorption' && particle.x < 2)).toBe(
      true,
    );
    expect(h.particles.some((particle) => particle.kind === 'transfer' && particle.vx < 0)).toBe(
      true,
    );
    const active = h.scene.children.find((child) => child.visible);
    expect(active?.userData.flowDirection).toBe('target-to-caster');
  });

  it('adds a restrained surge on the authoritative damage tick', () => {
    const h = harness();
    h.vfx.drain(1, 2, 5);
    const before = h.emit.mock.calls.length;

    h.vfx.tick(1);

    expect(h.emit.mock.calls.length).toBeGreaterThan(before);
    expect(h.particles.some((particle) => particle.kind === 'tick')).toBe(true);
  });

  it('does not infer early ticks from duration, so haste cannot desynchronize feedback', () => {
    const h = harness();
    h.vfx.drain(1, 2, 2.5);
    h.particles.length = 0;

    h.vfx.update(0.51);

    expect(h.particles.some((particle) => particle.kind === 'tick')).toBe(false);
    h.vfx.tick(1);
    expect(h.particles.filter((particle) => particle.kind === 'tick')).toHaveLength(10);
  });

  it('ends cleanly on stop, lost target, and reduced-motion updates', () => {
    const h = harness();
    h.vfx.drain(1, 2, 5);
    h.vfx.update(0.1, true);
    expect(h.scene.children.some((child) => child.visible)).toBe(true);

    h.anchors.delete(2);
    h.vfx.update(0.1, true);
    expect(h.scene.children.some((child) => child.visible)).toBe(false);

    h.anchors.set(2, new THREE.Vector3(10, 1, 0));
    h.vfx.drain(1, 2, 5);
    h.vfx.update(0.1, true);
    expect(h.scene.children.some((child) => child.visible)).toBe(true);
    h.vfx.drain(1, 2, 0);
    expect(h.scene.children.some((child) => child.visible)).toBe(false);
  });

  it('keeps the core readable while quality and reduced motion shed cosmetic load', () => {
    const full = harness();
    full.vfx.drain(1, 2, 5);
    full.particles.length = 0;
    full.vfx.update(1);
    const fullTransfers = full.particles.filter((particle) => particle.kind === 'transfer').length;

    const reduced = harness();
    reduced.vfx.update(0, true);
    reduced.vfx.setQuality(0);
    reduced.vfx.drain(1, 2, 5);
    reduced.particles.length = 0;
    reduced.vfx.update(1, true);
    const reducedTransfers = reduced.particles.filter(
      (particle) => particle.kind === 'transfer',
    ).length;
    const group = reduced.scene.children.find((child) => child.visible) as THREE.Group;
    const [veil, flow, core] = group.children as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >[];

    expect(core.visible).toBe(true);
    expect(flow.visible).toBe(false);
    expect(veil.visible).toBe(false);
    expect(core.material.uniforms.uMotion.value).toBe(0.25);
    expect(reducedTransfers).toBeLessThanOrEqual(fullTransfers / 2);
  });

  it('sheds only the outer veil for reduced motion at full quality', () => {
    const h = harness();
    h.vfx.setQuality(1);
    h.vfx.drain(1, 2, 5);
    h.vfx.update(0.1, true);
    const group = h.scene.children.find((child) => child.visible) as THREE.Group;
    const [veil, flow, core] = group.children;

    expect(core.visible).toBe(true);
    expect(flow.visible).toBe(true);
    expect(veil.visible).toBe(false);
  });

  it('caps simultaneous channels at twelve fixed slots and reuses a released slot', () => {
    const scene = new THREE.Scene();
    const vfx = new DrainLifeVfx(
      scene,
      (id, _height, _x, _z, out) => (out ?? new THREE.Vector3()).set(id, 1, 0),
      vi.fn(),
    );

    for (let caster = 1; caster <= 12; caster++) vfx.drain(caster, 100 + caster, 5);
    vfx.update(0.01);
    expect(scene.children).toHaveLength(12);
    expect(scene.children.filter((child) => child.visible)).toHaveLength(12);

    vfx.drain(13, 113, 5);
    vfx.update(0.01);
    expect(scene.children).toHaveLength(12);
    expect(scene.children.filter((child) => child.visible)).toHaveLength(12);

    vfx.drain(2, 102, 0);
    vfx.drain(14, 114, 5);
    vfx.update(0.01);
    expect(scene.children).toHaveLength(12);
    expect(scene.children.filter((child) => child.visible)).toHaveLength(12);
  });
});
