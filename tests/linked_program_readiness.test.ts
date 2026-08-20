// The record the touch walk reads instead of the driver
// (src/render/linked_program_readiness.ts). A settled compileAsync over a
// target is the ONLY thing that proves a program linked here: three latches
// `programReady` false for the session once a poll misses, so `isReady()` on
// such a program re-issues a COMPLETION_STATUS query, and one of those blocked
// a live main thread 5.6 s in production.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  isProgramKnownReady,
  markProgramReady,
  markProgramsReadyUnder,
} from '../src/render/linked_program_readiness';
import type { LinkedProgramLike, MaterialPropertiesLike } from '../src/render/linked_program_touch';

function program(name: string): LinkedProgramLike & { name: string } {
  return { name, getUniforms: () => {}, getAttributes: () => {} };
}

function propertiesFor(
  entries: Map<THREE.Material, { currentProgram?: LinkedProgramLike } | undefined>,
): MaterialPropertiesLike {
  return { get: (material) => entries.get(material) };
}

const meshOf = (...materials: THREE.Material[]): THREE.Mesh =>
  new THREE.Mesh(new THREE.BufferGeometry(), materials);

describe('markProgramsReadyUnder', () => {
  it('records the current program of every material under the target', () => {
    const body = new THREE.MeshStandardMaterial({ name: 'body' });
    const trim = new THREE.MeshStandardMaterial({ name: 'trim' });
    const bodyProgram = program('body');
    const trimProgram = program('trim');
    const props = propertiesFor(
      new Map([
        [body, { currentProgram: bodyProgram }],
        [trim, { currentProgram: trimProgram }],
      ]),
    );
    const target = new THREE.Group();
    target.add(meshOf(body, trim));
    target.add(new THREE.Group());

    expect(markProgramsReadyUnder(props, target)).toBe(2);

    expect(isProgramKnownReady(bodyProgram)).toBe(true);
    expect(isProgramKnownReady(trimProgram)).toBe(true);
  });

  it('counts each program once however many meshes share the material', () => {
    const shared = new THREE.MeshStandardMaterial({ name: 'shared' });
    const sharedProgram = program('shared');
    const props = propertiesFor(new Map([[shared, { currentProgram: sharedProgram }]]));
    const target = new THREE.Group();
    target.add(meshOf(shared));
    target.add(meshOf(shared));

    expect(markProgramsReadyUnder(props, target)).toBe(1);
    // A second settle over the same target claims nothing new either.
    expect(markProgramsReadyUnder(props, target)).toBe(0);
    expect(isProgramKnownReady(sharedProgram)).toBe(true);
  });

  it('walks past a non-mesh, a null material, and a material with no current program', () => {
    const cold = new THREE.MeshBasicMaterial({ name: 'cold' });
    const props = propertiesFor(new Map([[cold, {}]]));
    const target = new THREE.Group();
    target.add(meshOf(cold));
    target.add(new THREE.Object3D());
    const nulled = meshOf(new THREE.MeshBasicMaterial());
    (nulled as unknown as { material: THREE.Material | null }).material = null;
    target.add(nulled);

    expect(markProgramsReadyUnder(props, target)).toBe(0);
  });

  it('survives a properties map with no entry for the material at all', () => {
    const unseen = new THREE.MeshBasicMaterial({ name: 'unseen' });
    const target = new THREE.Group();
    target.add(meshOf(unseen));

    expect(markProgramsReadyUnder(propertiesFor(new Map()), target)).toBe(0);
  });
});

describe('markProgramReady', () => {
  it('records ONE program, whichever material or slot carries it, and reports whether it was new', () => {
    // The variant settle proves programs one at a time as its poll answers
    // ready, including the variants no material's current slot names.
    const sibling = program('sibling-variant');
    expect(isProgramKnownReady(sibling)).toBe(false);
    expect(markProgramReady(sibling)).toBe(true);
    expect(isProgramKnownReady(sibling)).toBe(true);
    expect(markProgramReady(sibling)).toBe(false);
  });

  it('is what the walk-level marking counts, so the two records never disagree', () => {
    const material = new THREE.MeshStandardMaterial({ name: 'both-paths' });
    const current = program('current');
    markProgramReady(current);
    const target = new THREE.Group();
    target.add(meshOf(material));
    // already proved by the per-program record: nothing new to count
    expect(
      markProgramsReadyUnder(
        propertiesFor(new Map([[material, { currentProgram: current }]])),
        target,
      ),
    ).toBe(0);
  });
});

describe('isProgramKnownReady', () => {
  it('answers false for a program no settle ever recorded', () => {
    // Unknown means "not proved", never "not linked": the walk leaves it alone
    // rather than asking three, which is the whole point of the record.
    expect(isProgramKnownReady(program('never-marked'))).toBe(false);
  });

  it('keeps the record per program, not per material or target', () => {
    const material = new THREE.MeshStandardMaterial({ name: 'variant-holder' });
    const drawn = program('drawn');
    const otherVariant = program('other-variant');
    const target = new THREE.Group();
    target.add(meshOf(material));

    markProgramsReadyUnder(propertiesFor(new Map([[material, { currentProgram: drawn }]])), target);

    expect(isProgramKnownReady(drawn)).toBe(true);
    expect(isProgramKnownReady(otherVariant)).toBe(false);
  });
});
