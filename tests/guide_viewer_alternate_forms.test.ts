// The Guide viewer shows a model's default body alone (src/guide/viewer/model.ts
// hideAlternateForms). A model that carries several bodies over one mesh for the game to swap
// between (the Smith's Heart final boss: one mesh, five paintings) marks every body but its
// default one with a node extra; the viewer drives no toggles, and drawn together the coincident
// bodies showed whichever material three built last, so the mob portrait baked from this
// assembly once came out in the ice form by chance.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { HIDDEN_FORM_KEY, hideAlternateForms, skinAwareBounds } from '../src/guide/viewer/model';
import { MASTERLESS_STRENGTH_URL } from '../src/render/characters/smith_heart_boss_looks';
import { FINAL_BODY_FORMS, FINAL_BODY_NODES } from '../src/render/smith_heart_fx/final_body_core';

function glbNodes(
  rel: string,
): { name?: string; mesh?: number; extras?: Record<string, unknown> }[] {
  const buf = readFileSync(`public/${rel}`);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8')).nodes;
}

describe('the Guide viewer shows a default body alone', () => {
  it('hides every node its file marks as an alternate form, and nothing else', () => {
    const model = new THREE.Group();
    const base = new THREE.Mesh();
    base.name = 'Body_Four';
    const alt = new THREE.Mesh();
    alt.name = 'Body_Heat';
    alt.userData[HIDDEN_FORM_KEY] = true;
    const deep = new THREE.Mesh();
    deep.name = 'Body_Quench';
    deep.userData[HIDDEN_FORM_KEY] = true;
    const bone = new THREE.Bone();
    bone.add(deep);
    // A truthy value that is not the marker hides nothing.
    const prop = new THREE.Mesh();
    prop.userData[HIDDEN_FORM_KEY] = 'yes';
    model.add(base, alt, bone, prop);
    expect(hideAlternateForms(model)).toBe(2);
    expect(base.visible).toBe(true);
    expect(alt.visible).toBe(false);
    expect(deep.visible).toBe(false);
    expect(prop.visible).toBe(true);
    expect(bone.visible).toBe(true);
    // An ordinary model is left exactly as it was.
    const plain = new THREE.Group().add(new THREE.Mesh(), new THREE.Mesh());
    expect(hideAlternateForms(plain)).toBe(0);
    for (const c of plain.children) expect(c.visible).toBe(true);
  });

  it('survives the clone the viewer builds from (the marker rides userData)', () => {
    const src = new THREE.Group();
    const alt = new THREE.Mesh();
    alt.userData[HIDDEN_FORM_KEY] = true;
    src.add(alt);
    const copy = src.clone(true);
    expect(hideAlternateForms(copy)).toBe(1);
    expect(copy.children[0].visible).toBe(false);
    // The source (the shared parse) is never touched.
    expect(alt.visible).toBe(true);
  });

  it('frames the default body only: a hidden form adds nothing to the bounds', () => {
    const model = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1));
    const alt = new THREE.Mesh(new THREE.BoxGeometry(9, 9, 9));
    alt.userData[HIDDEN_FORM_KEY] = true;
    model.add(base, alt);
    hideAlternateForms(model);
    model.updateMatrixWorld(true);
    const size = skinAwareBounds(model).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(1, 5);
    expect(size.y).toBeCloseTo(2, 5);
  });

  it("the final boss's file marks its four element bodies and leaves the base form shown", () => {
    const nodes = glbNodes(MASTERLESS_STRENGTH_URL).filter((n) => n.mesh !== undefined);
    expect(nodes).toHaveLength(FINAL_BODY_FORMS.length);
    for (const form of FINAL_BODY_FORMS)
      for (const name of FINAL_BODY_NODES[form]) {
        const node = nodes.find((n) => n.name === name);
        expect(node, name).toBeDefined();
        expect(node?.extras?.[HIDDEN_FORM_KEY] === true, name).toBe(form !== 'four');
      }
  });
});
