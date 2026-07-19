import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { delveInteractableVisible } from '../src/render/delve_interactable_visibility_core';
import { buildHunterFreezingTrap } from '../src/render/hunter_freezing_trap';
import { HunterFrozenFeetVisual, syncHunterFrozenFeet } from '../src/render/hunter_frozen_feet';

describe('Hunter Freezing Trap render prop', () => {
  it('shows a compact ice restraint at the feet of the trapped enemy', () => {
    const visual = new HunterFrozenFeetVisual(1.8);
    visual.update(true);
    expect(visual.group.visible).toBe(true);
    expect(visual.group.getObjectByName('hunter-frozen-feet-base')).toBeInstanceOf(THREE.Mesh);
    const bounds = new THREE.Box3().setFromObject(visual.group);
    expect(bounds.min.y).toBeGreaterThanOrEqual(0);
    expect(bounds.max.y).toBeGreaterThan(0.9);
    expect(bounds.max.y).toBeLessThan(1.4);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(1.6);
  });

  it('creates, reuses, and hides the frozen-feet restraint with the aura state', () => {
    const parent = new THREE.Group();
    const created = syncHunterFrozenFeet(null, parent, 1.8, true);
    expect(created).not.toBeNull();
    if (!created) throw new Error('expected frozen-feet visual');
    expect(parent.children).toContain(created.group);
    expect(created.group.visible).toBe(true);

    const hidden = syncHunterFrozenFeet(created, parent, 1.8, false);
    expect(hidden).toBe(created);
    expect(hidden?.group.visible).toBe(false);
  });

  it('builds a compact ice bear trap with a base and opposing toothed jaws', () => {
    const built = buildHunterFreezingTrap();
    const meshNames: string[] = [];
    built.group.traverse((child) => {
      if (child instanceof THREE.Mesh) meshNames.push(child.name);
    });

    expect(built.height).toBeGreaterThan(0.2);
    expect(meshNames).toContain('freezing-trap-base');
    expect(meshNames.filter((name) => name.startsWith('freezing-trap-jaw')).length).toBe(2);
    expect(
      meshNames.filter((name) => name.startsWith('freezing-trap-tooth')).length,
    ).toBeGreaterThanOrEqual(8);
    const bounds = new THREE.Box3().setFromObject(built.group);
    // The replicated entity is anchored to the exact terrain sample, while the
    // rendered terrain is triangulated between samples. A shallow buried base
    // keeps the prop grounded on slopes instead of hovering above the triangle.
    expect(bounds.min.y).toBeLessThanOrEqual(-0.08);
  });

  it('keeps the replicated trap template wired to its bespoke renderer', () => {
    const source = readFileSync(join(process.cwd(), 'src/render/renderer.ts'), 'utf8');
    expect(source).toContain("e.templateId === 'hunter_freezing_trap'");
    expect(source).toContain('buildHunterFreezingTrap()');
    expect(source).toContain("a.id === 'freezing_trap' && a.kind === 'incapacitate'");
    expect(source).toContain('v.hunterFrozenFeet = syncHunterFrozenFeet(');
    expect(source).toContain('hasHunterFreeze,');
    expect(delveInteractableVisible('hunter_freezing_trap', false)).toBe(true);
  });
});
