// The compile gate's touch tail (src/render/linked_program_touch.ts): warm the
// uniform/attribute tables of every LINKED program variant under a target so
// the reveal draw issues no synchronous first-use query, never touching a
// variant still linking (that would block on the link).
//
// Readiness is the CALLER's record (linked_program_readiness.ts), never a
// question for three: the stubs below throw from `isReady`, because the walk
// asking it is the 5.6 s production freeze this suite exists to prevent.
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  collectLinkedPrograms,
  type LinkedProgramLike,
  type MaterialPropertiesLike,
  touchLinkedProgram,
  touchLinkedPrograms,
} from '../src/render/linked_program_touch';

function program(ready: boolean): LinkedProgramLike & {
  ready: boolean;
  isReady: () => never;
  uniforms: ReturnType<typeof vi.fn>;
  attributes: ReturnType<typeof vi.fn>;
} {
  const uniforms = vi.fn();
  const attributes = vi.fn();
  return {
    ready,
    isReady: () => {
      throw new Error('the walk must never query the driver for readiness');
    },
    getUniforms: uniforms,
    getAttributes: attributes,
    uniforms,
    attributes,
  };
}

/** The caller's record: what a settled compile proved, nothing else. */
const known = (program: LinkedProgramLike): boolean =>
  (program as { ready?: boolean }).ready === true;

function propertiesFor(
  entries: Map<THREE.Material, Map<string, LinkedProgramLike> | undefined>,
): MaterialPropertiesLike {
  return { get: (material) => ({ programs: entries.get(material) }) };
}

describe('touchLinkedPrograms', () => {
  it('touches every ready variant of every material under the target, once, and skips linking ones', () => {
    const shared = new THREE.MeshStandardMaterial({ name: 'shared' });
    const other = new THREE.MeshStandardMaterial({ name: 'other' });
    const bare = new THREE.MeshBasicMaterial({ name: 'no-programs' });
    const skinned = program(true);
    const far = program(true);
    const linking = program(false);
    const otherFar = program(true);
    const props = propertiesFor(
      new Map<THREE.Material, Map<string, LinkedProgramLike> | undefined>([
        // a tinted clone shared by the rig and the far mesh: both variants,
        // plus a third still linking
        [
          shared,
          new Map([
            ['skinned', skinned],
            ['far', far],
            ['linking', linking],
          ]),
        ],
        [other, new Map([['far', otherFar]])],
        [bare, undefined],
      ]),
    );
    const wrap = new THREE.Group();
    const farMesh = new THREE.Mesh(new THREE.BufferGeometry(), [shared, other, shared]);
    const proxy = new THREE.Mesh(new THREE.BufferGeometry(), bare);
    wrap.add(farMesh, proxy);
    // a non-mesh child and a null-material mesh are walked past
    wrap.add(new THREE.Group());
    const nulled = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    (nulled as unknown as { material: THREE.Material | null }).material = null;
    wrap.add(nulled);

    expect(touchLinkedPrograms(props, wrap, known)).toBe(3);

    for (const p of [skinned, far, otherFar]) {
      expect(p.uniforms).toHaveBeenCalledTimes(1);
      expect(p.attributes).toHaveBeenCalledTimes(1);
    }
    expect(linking.uniforms).not.toHaveBeenCalled();
    expect(linking.attributes).not.toHaveBeenCalled();
  });

  it('touches nothing on a target without meshes', () => {
    const props = propertiesFor(new Map());
    expect(touchLinkedPrograms(props, new THREE.Group(), known)).toBe(0);
  });
});

// The two halves the renderer schedules apart: the walk is one cheap pass, the
// touching is one driver round trip per program and therefore the unit a
// per-frame budget admits (src/render/linked_program_touch_lane.ts).
describe('collectLinkedPrograms and touchLinkedProgram', () => {
  it('collects every ready variant once, in walk order, and touches none of them', () => {
    const shared = new THREE.MeshStandardMaterial({ name: 'shared' });
    const other = new THREE.MeshStandardMaterial({ name: 'other' });
    const skinned = program(true);
    const far = program(true);
    const linking = program(false);
    const otherFar = program(true);
    const props = propertiesFor(
      new Map<THREE.Material, Map<string, LinkedProgramLike> | undefined>([
        [
          shared,
          new Map([
            ['skinned', skinned],
            ['far', far],
            ['linking', linking],
          ]),
        ],
        [other, new Map([['far', otherFar]])],
      ]),
    );
    const wrap = new THREE.Group();
    // the same material on two meshes: one entry, not two
    wrap.add(new THREE.Mesh(new THREE.BufferGeometry(), [shared, other]));
    wrap.add(new THREE.Mesh(new THREE.BufferGeometry(), shared));

    expect(collectLinkedPrograms(props, wrap, known)).toEqual([skinned, far, otherFar]);
    for (const p of [skinned, far, otherFar, linking]) {
      expect(p.uniforms).not.toHaveBeenCalled();
      expect(p.attributes).not.toHaveBeenCalled();
    }
  });

  it('never asks three whether a program is ready, whatever the record answers', () => {
    // three latches programReady false after one missed poll, so isReady() on
    // a program that has been linked and drawing for a minute re-issues the
    // COMPLETION_STATUS query: 5558 ms on the main thread in the 2026-08-18
    // production capture, with the reveal gates parked behind it.
    const clone = new THREE.MeshStandardMaterial({ name: 'tinted-clone' });
    const plain = new THREE.MeshStandardMaterial({ name: 'plain' });
    const recorded = program(true);
    const unrecorded = program(false);
    const alsoUnrecorded = program(false);
    const props = propertiesFor(
      new Map<THREE.Material, Map<string, LinkedProgramLike> | undefined>([
        [
          clone,
          new Map([
            ['skinned', recorded],
            ['far', unrecorded],
          ]),
        ],
        [plain, new Map([['far', alsoUnrecorded]])],
      ]),
    );
    const wrap = new THREE.Group();
    wrap.add(new THREE.Mesh(new THREE.BufferGeometry(), [clone, plain]));

    // Every stub throws from isReady, so a single driver question would fail
    // this outright; the record alone decides.
    expect(collectLinkedPrograms(props, wrap, known)).toEqual([recorded]);
    expect(() => touchLinkedPrograms(props, wrap, known)).not.toThrow();
  });

  it('touches one program: both tables, which is what the reveal draw would otherwise query', () => {
    const one = program(true);

    touchLinkedProgram(one);

    expect(one.uniforms).toHaveBeenCalledTimes(1);
    expect(one.attributes).toHaveBeenCalledTimes(1);
  });
});
