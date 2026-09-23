import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { CharacterSurfaceResponse } from '../src/render/characters/surface_response';
import { SurfaceResponsePreparation } from '../src/render/characters/surface_response_preparation';
import type { CharacterVisual } from '../src/render/characters/visual';
import {
  gateSurfaceForm,
  gateSurfaceReplacement,
} from '../src/render/surface_receiver_preparation';

function fixture() {
  const geometry = new THREE.BoxGeometry();
  const base = new THREE.MeshStandardMaterial();
  const skinned = new THREE.SkinnedMesh(geometry, base);
  const rigid = new THREE.Mesh(geometry, base);
  const parent = new THREE.Group();
  parent.add(skinned, rigid);
  const sources = new Map<THREE.Mesh, THREE.Material>([
    [skinned, base],
    [rigid, base],
  ]);
  const response = new CharacterSurfaceResponse();
  const linked = new WeakSet<THREE.Material>();
  const prep = new SurfaceResponsePreparation();
  const begin = () => prep.begin(parent, sources, response, linked);
  const clean = () => {
    prep.clear();
    for (const mat of response.materials.values()) mat.dispose();
    geometry.dispose();
    base.dispose();
  };
  return { geometry, base, skinned, rigid, parent, sources, response, linked, prep, begin, clean };
}

describe('receiver surface preparation before the first hit', () => {
  it('keeps the outgoing body until replacement materials have settled', () => {
    const group = new THREE.Group();
    const old = { root: new THREE.Group(), dispose: vi.fn() };
    group.add(old.root);
    const next = { root: new THREE.Group(), stageSurfaceResponsePreparation: () => null };
    const view = { group, visualCompilePending: false };
    const host = { gateSwapFlagOnCompile: vi.fn() };
    gateSurfaceReplacement(host, view, next as CharacterVisual, old as unknown as CharacterVisual);
    expect(view.visualCompilePending).toBe(true);
    expect(old.root.parent).toBe(group);
    expect(old.dispose).not.toHaveBeenCalled();
    host.gateSwapFlagOnCompile.mock.calls[0][1]();
    expect(view.visualCompilePending).toBe(false);
    expect(old.root.parent).toBeNull();
    expect(old.dispose).toHaveBeenCalledOnce();
  });
  it('warms an ungated metamorph receiver through the background lane without hiding its body', () => {
    const root = new THREE.Group();
    const settle = vi.fn();
    const visual = { root, stageSurfaceResponsePreparation: () => ({ root, settle }) };
    const host = { farBakeGate: vi.fn(), gateSwapFlagOnCompile: vi.fn() };
    const view = { formCompilePending: null };
    gateSurfaceForm(host, visual as unknown as CharacterVisual, view, false);
    expect(host.farBakeGate).toHaveBeenCalledOnce();
    expect(host.gateSwapFlagOnCompile).not.toHaveBeenCalled();
    expect(view.formCompilePending).toBeNull();
    host.farBakeGate.mock.calls[0][1](() => true);
    expect(settle).toHaveBeenCalledWith(true);
    expect(root.visible).toBe(true);
  });

  it('prepares both draw paths once without activating a response or recoloring the body', () => {
    const h = fixture();
    try {
      const ticket = h.begin()!;
      expect(h.begin()).toBe(ticket);
      expect(ticket.root.visible).toBe(false);
      expect(ticket.root.children).toHaveLength(2);
      expect((ticket.root.children[0] as THREE.SkinnedMesh).isSkinnedMesh).toBe(true);
      expect((ticket.root.children[1] as THREE.SkinnedMesh).isSkinnedMesh).toBeUndefined();
      expect(ticket.root.children.every((o) => (o as THREE.Mesh).geometry === h.geometry)).toBe(
        true,
      );
      expect(h.skinned.material).toBe(h.base);
      expect(h.response.active).toBe(false);
      const clone = h.response.material(h.base);
      expect(h.linked.has(clone)).toBe(false);
      ticket.settle(true);
      expect(ticket.root.parent).toBeNull();
      expect(h.linked.has(clone)).toBe(true);
      expect(h.begin()).toBeNull();
      expect(h.response.materials.size).toBe(1);
    } finally {
      h.clean();
    }
  });
  it('rejects failed and stale settlements and never disposes borrowed resources', () => {
    const h = fixture();
    const geometryDispose = vi.spyOn(h.geometry, 'dispose');
    const materialDispose = vi.spyOn(h.base, 'dispose');
    try {
      const old = h.begin()!;
      const clone = h.response.material(h.base);
      h.prep.clear();
      const next = h.begin()!;
      old.settle(true);
      expect(h.linked.has(clone)).toBe(false);
      expect(next.root.parent).toBe(h.parent);
      next.settle(false);
      expect(h.linked.has(clone)).toBe(false);
      expect(h.begin()).not.toBeNull();
      expect(geometryDispose).not.toHaveBeenCalled();
      expect(materialDispose).not.toHaveBeenCalled();
    } finally {
      h.clean();
    }
  });
});
