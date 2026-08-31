import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildIgnivarRaidGate,
  IGNIVAR_RAID_GATE_HEIGHT,
  ignivarRaidGatePlan,
} from '../src/render/ignivar_raid_gate';

describe('Ignivar raid gate', () => {
  it('keeps a solid physical barrier while locked', () => {
    const gate = buildIgnivarRaidGate({ open: false, height: IGNIVAR_RAID_GATE_HEIGHT });
    expect(gate.name).toBe('ignivar-raid-gate-locked');
    expect(gate.getObjectByName('ember-lock')).toBeDefined();
    expect(gate.getObjectByName('left-iron-leaf')?.position.x).toBeCloseTo(-1.58);
    expect(gate.getObjectByName('right-iron-leaf')?.position.x).toBeCloseTo(1.58);
    expect(IGNIVAR_RAID_GATE_HEIGHT).toBe(6.4);
  });

  it('swings both leaves clear without changing the frame', () => {
    const gate = buildIgnivarRaidGate({ open: true, height: IGNIVAR_RAID_GATE_HEIGHT });
    expect(gate.name).toBe('ignivar-raid-gate-open');
    expect(gate.getObjectByName('ember-lock')).toBeUndefined();
    expect(gate.getObjectByName('left-stone-jamb')).toBeDefined();
    const left = gate.getObjectByName('left-iron-leaf');
    const right = gate.getObjectByName('right-iron-leaf');
    if (!left || !right) throw new Error('Opened gate leaves are missing');
    expect(left.position.z).toBeLessThan(0);
    expect(right.position.z).toBeLessThan(0);
    const leftHinge = new THREE.Vector3(-1.55, 0, 0).applyEuler(left.rotation).add(left.position);
    const rightHinge = new THREE.Vector3(1.55, 0, 0).applyEuler(right.rotation).add(right.position);
    expect(leftHinge.x).toBeCloseTo(-3.13, 6);
    expect(leftHinge.z).toBeCloseTo(0, 6);
    expect(rightHinge.x).toBeCloseTo(3.13, 6);
    expect(rightHinge.z).toBeCloseTo(0, 6);
    expect(gate.getObjectByName('transition-threshold')).toBeDefined();
  });

  it('dispatches only the locked gate and its opened raid-route doors', () => {
    expect(ignivarRaidGatePlan('ignivar_raid_gate_locked', 'ignivar_inner_crucible')).toEqual({
      open: false,
      height: 6.4,
    });
    expect(ignivarRaidGatePlan('dungeon_door', 'ignivar_inner_crucible')).toEqual({
      open: true,
      height: 6.4,
    });
    expect(ignivarRaidGatePlan('dungeon_door', 'ignivar_molten_assembly')).toEqual({
      open: true,
      height: 6.4,
    });
    expect(ignivarRaidGatePlan('dungeon_door', 'hollow_crypt')).toBeNull();
    // the Forge-Lift's portals all ride the lift kind and render NOTHING:
    // the owner fronts each with a placed mist-veiled dungeon_entrance
    // facade (the lift dressing owns both looks), so the sealed gate, the
    // opened gate, and the exit portal keep only triggers and labels
    expect(ignivarRaidGatePlan('ignivar_lift_gate_locked', 'ignivar_forge_approach')).toEqual({
      open: false,
      height: 7.2,
      kind: 'lift',
    });
    expect(ignivarRaidGatePlan('dungeon_door', 'ignivar_forge_approach')).toEqual({
      open: true,
      height: 7.2,
      kind: 'lift',
    });
    expect(ignivarRaidGatePlan('dungeon_exit', 'ignivar_forge_lift')).toEqual({
      open: true,
      height: 7.2,
      kind: 'lift',
    });
    // every OTHER room's exit keeps the generic way-home body
    expect(ignivarRaidGatePlan('dungeon_exit', 'ignivar_forge_approach')).toBeNull();
    expect(ignivarRaidGatePlan('dungeon_exit', 'hollow_crypt')).toBeNull();

    const rendererSource = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    );
    expect(rendererSource).toContain('ignivarRaidGatePlan(e.templateId, e.dungeonId)');
    expect(rendererSource).toContain('buildIgnivarRaidGate(raidGatePlan)');
    expect(rendererSource).toContain('height = raidGatePlan.height');
    const dungeonSource = readFileSync(
      new URL('../src/render/dungeon.ts', import.meta.url),
      'utf8',
    );
    // ignivar_depths (and every newer interior, the Forge-Lift included)
    // resolves through the INTERIOR_LAYOUTS registry fallback
    expect(dungeonSource).toMatch(/INTERIOR_LAYOUTS\[interior\] \?\? CRYPT_LAYOUT/);
    expect(dungeonSource).toMatch(
      /interior === 'ignivar_approach'[\s\S]{0,120}\? IGNIVAR_FORGE_APPROACH_LAYOUT/,
    );
  });
});
