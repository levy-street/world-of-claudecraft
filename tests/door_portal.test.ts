// The dungeon door / exit-portal visual system extracted from renderer.ts.
// Geometry/material shape, shared-resource tagging, and the Nythraxis click-box
// special case. Three.js runs headless in Node (no WebGL needed for geometry).
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildDoorBody,
  buildDoorPrewarmBodies,
  doorArchAuthoredElsewhere,
} from '../src/render/door_portal';
import { isSharedGeometry, isSharedMaterial } from '../src/render/shared_resource';
import { DUNGEONS } from '../src/sim/data';

const meshes = (body: THREE.Group): THREE.Mesh[] =>
  body.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);

describe('buildDoorBody: standard arch door', () => {
  it('builds arch + keystone + two plinths + portal, and returns the portal mesh', () => {
    const { body, portal } = buildDoorBody(true, null, false);
    const ms = meshes(body);
    // arch, keystone, plinth x2, portal
    expect(ms.length).toBe(5);
    expect(portal).toBeDefined();
    expect(body.children).toContain(portal);
  });

  it('positions the portal at y=2.15 with the classic 1x1.35x1 oval scale', () => {
    const { portal } = buildDoorBody(false, null, false);
    expect(portal?.position.y).toBeCloseTo(2.15);
    expect(portal?.scale.x).toBeCloseTo(1);
    expect(portal?.scale.y).toBeCloseTo(1.35);
    expect(portal?.scale.z).toBeCloseTo(1);
  });

  it('the stone frame meshes cast shadows', () => {
    const { body } = buildDoorBody(true, null, false);
    // every non-portal mesh (arch/keystone/plinths) casts a shadow
    const frame = meshes(body).filter((m) => m.geometry.type !== 'CircleGeometry');
    expect(frame.length).toBe(4);
    expect(frame.every((m) => m.castShadow)).toBe(true);
  });
});

describe('buildDoorBody: Nythraxis crypt click-box', () => {
  it('an entering nythraxis_crypt door is a single invisible click-box with no portal', () => {
    const { body, portal } = buildDoorBody(true, 'nythraxis_crypt', false);
    const ms = meshes(body);
    expect(ms.length).toBe(1);
    expect(portal).toBeUndefined();
    expect(ms[0].position.y).toBeCloseTo(2.1);
  });

  it('the special-case only applies when entering (an exit uses the normal arch)', () => {
    const { body, portal } = buildDoorBody(false, 'nythraxis_crypt', false);
    expect(meshes(body).length).toBe(5);
    expect(portal).toBeDefined();
  });

  it('the rebuilt Last Keep yields its arch only to a castle_door standing AT the keep door', () => {
    const door = DUNGEONS.the_last_keep.doorPos;
    // no facade: the generic arch keeps the keep door visible
    expect(doorArchAuthoredElsewhere('the_last_keep', [{ key: 'stone_floor' }])).toBe(false);
    // the placed facade a row in front of doorPos IS the door
    expect(
      doorArchAuthoredElsewhere('the_last_keep', [
        { key: 'castle_door', x: door.x + 1.3, z: door.z },
      ]),
    ).toBe(true);
    // a castle_door placed at another site (a town gate) never claims the keep's arch,
    // and a row without coordinates cannot be located, so it never does either
    expect(
      doorArchAuthoredElsewhere('the_last_keep', [{ key: 'castle_door', x: 400, z: 1900 }]),
    ).toBe(false);
    expect(doorArchAuthoredElsewhere('the_last_keep', [{ key: 'castle_door' }])).toBe(false);
    // the shipped table carries the keep facade on the temple court
    expect(doorArchAuthoredElsewhere('the_last_keep')).toBe(true);
  });

  it('the Forgefather raid door yields to the facade only once one is baked', () => {
    // no facade in the table: the generic arch keeps the door visible
    expect(doorArchAuthoredElsewhere('ignivar_forge_lift', [{ key: 'stone_floor' }])).toBe(false);
    // a baked dungeon_entrance facade takes over as the visible door,
    // keyed to the chain HEAD (the Forge-Lift owns the overworld door now)
    expect(doorArchAuthoredElsewhere('ignivar_forge_lift', [{ key: 'dungeon_entrance' }])).toBe(
      true,
    );
    expect(doorArchAuthoredElsewhere('ignivar_forge_approach', [{ key: 'dungeon_entrance' }])).toBe(
      true,
    );
    // the crypt stays a click-box regardless, other doors keep their arch
    expect(doorArchAuthoredElsewhere('nythraxis_crypt', [])).toBe(true);
    expect(doorArchAuthoredElsewhere('nythraxis_boss_arena', [{ key: 'dungeon_entrance' }])).toBe(
      false,
    );
    // the lift back out of the approach keeps the normal leaving portal
    const exit = buildDoorBody(false, 'ignivar_forge_approach', false);
    expect(exit.portal).toBeDefined();
  });
});

describe('buildDoorBody: the Sunken Bastion Drowned Gate Tower', () => {
  it('the entering Bastion door is only the invisible click box: the gatehouse draws the portal', () => {
    expect(doorArchAuthoredElsewhere('sunken_bastion')).toBe(true);
    const { body, portal } = buildDoorBody(true, 'sunken_bastion', false);
    expect(portal).toBeUndefined();
    expect(meshes(body).length).toBe(1);
    // the exit inside the instance keeps the generic arch and its swirl
    expect(buildDoorBody(false, 'sunken_bastion', false).portal).toBeDefined();
  });
});

describe('buildDoorBody: the Hollow Crypt Fallen Chapel', () => {
  it('the entering Crypt door is only the invisible click box: the chapel draws the portal', () => {
    expect(doorArchAuthoredElsewhere('hollow_crypt')).toBe(true);
    const { body, portal } = buildDoorBody(true, 'hollow_crypt', false);
    expect(portal).toBeUndefined();
    let count = 0;
    body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) count++;
    });
    expect(count).toBe(1);
    // the exit inside the instance keeps the generic arch and its swirl
    expect(buildDoorBody(false, 'hollow_crypt', false).portal).toBeDefined();
  });
});

describe('buildDoorBody: the Drowned Temple Moon Stair', () => {
  it('the entering Temple door is only the invisible click box: the moongate draws the portal', () => {
    expect(doorArchAuthoredElsewhere('drowned_temple')).toBe(true);
    const { body, portal } = buildDoorBody(true, 'drowned_temple', false);
    expect(portal).toBeUndefined();
    expect(meshes(body).length).toBe(1);
    // the exit inside the instance keeps the generic arch and its swirl
    expect(buildDoorBody(false, 'drowned_temple', false).portal).toBeDefined();
  });
});

describe('buildDoorBody: the Wildheart Basin Jaguar Maw', () => {
  it('the entering Basin door is only the invisible click box: the idol draws the portal', () => {
    expect(doorArchAuthoredElsewhere('wildheart_basin')).toBe(true);
    const { body, portal } = buildDoorBody(true, 'wildheart_basin', false);
    expect(portal).toBeUndefined();
    expect(meshes(body).length).toBe(1);
    // the exit inside the instance keeps its own gate and membrane
    expect(buildDoorBody(false, 'wildheart_basin', false).portal).toBeDefined();
  });
});

describe('buildDoorBody: the Gravewyrm Sanctum Seal Gate', () => {
  it('the entering Sanctum door is only the invisible click box: no arch, no swirl disc', () => {
    expect(doorArchAuthoredElsewhere('gravewyrm_sanctum')).toBe(true);
    const { body, portal } = buildDoorBody(true, 'gravewyrm_sanctum', false);
    const ms = meshes(body);
    expect(ms.length).toBe(1);
    expect(portal).toBeUndefined();
    // the click box covers the Seal Gate's 4yd walk-in lane (|x| < 2)
    const box = ms[0].geometry as THREE.BoxGeometry;
    expect(box.parameters.width).toBeGreaterThanOrEqual(4);
    expect(ms[0].position.y).toBeCloseTo(2.1);
    const material = ms[0].material as THREE.MeshBasicMaterial;
    expect(material.opacity).toBeLessThan(0.01);
  });

  it('only the entering side yields: the exit inside the instance keeps its portal', () => {
    const { body, portal } = buildDoorBody(false, 'gravewyrm_sanctum', false);
    expect(body.name).toBe('sanctum-exit');
    expect(body.getObjectByName('frost-opening')).toBeDefined();
    expect(portal).toBeDefined();
  });
});

describe('the boot door prewarm bodies', () => {
  const drawn = (root: THREE.Object3D): THREE.Mesh[] => {
    const out: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
    });
    return out;
  };
  const materialsOf = (root: THREE.Object3D): Set<THREE.Material> =>
    new Set(drawn(root).map((mesh) => mesh.material as THREE.Material));

  it.each([false, true])('stages every live door body material on lowGfx=%s', (lowGfx) => {
    const staged = materialsOf(buildDoorPrewarmBodies(lowGfx));
    // The same shared instances the live views draw, so the boot compile
    // links exactly the programs a door view needs later.
    for (const [entering, dungeonId] of [
      [true, null],
      [false, null],
      [false, 'gravewyrm_sanctum'],
    ] as const) {
      const live = materialsOf(buildDoorBody(entering, dungeonId, lowGfx).body);
      expect(live.size, `${entering}:${dungeonId}`).toBeGreaterThan(0);
      for (const material of live) {
        expect(staged.has(material), `${entering}:${dungeonId}:${material.name}`).toBe(true);
      }
    }
  });

  it('stages the Sanctum frost exit, membrane and all, beside the two arches', () => {
    const group = buildDoorPrewarmBodies(false);
    expect(group.children).toHaveLength(3);
    const exit = group.getObjectByName('sanctum-exit');
    expect(exit).toBeDefined();
    // The veil and the vortex are the textured additive membranes no other
    // boot artifact links: both must be drawable meshes under the group.
    for (const name of ['aurora-veil', 'return-vortex']) {
      const mesh = group.getObjectByName(name) as THREE.Mesh | undefined;
      expect(mesh?.isMesh, name).toBe(true);
      const material = mesh?.material as THREE.MeshBasicMaterial;
      expect(material.blending, name).toBe(THREE.AdditiveBlending);
      expect(material.side, name).toBe(THREE.DoubleSide);
    }
    // The three bodies stand apart so none hides another from the compile.
    const xs = group.children.map((body) => body.position.x);
    expect(new Set(xs).size).toBe(3);
    // Staging owns nothing: every resource stays shared, so tearing the
    // group out at world entry disposes no live door's material.
    for (const mesh of drawn(group)) {
      expect(isSharedGeometry(mesh.geometry)).toBe(true);
      expect(isSharedMaterial(mesh.material as THREE.Material)).toBe(true);
    }
  });

  it('is what the renderer stages in its required props.dungeon-doors entry', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const start = renderer.indexOf("id: 'props.dungeon-doors'");
    const entry = renderer.slice(start, renderer.indexOf('      {\n', start + 1));
    expect(entry).toContain('required: true');
    expect(entry).toContain('doorPrewarmGroup = this.buildDoorPrewarmGroup();');
    expect(entry).toContain('this.scene.add(doorPrewarmGroup);');
    const builder = renderer.slice(
      renderer.indexOf('private buildDoorPrewarmGroup(): THREE.Group {'),
    );
    expect(builder.slice(0, builder.indexOf('\n  }\n'))).toContain(
      'buildDoorPrewarmBodies(this.lowGfx)',
    );
  });
});

describe('shared-resource tagging (disposal guard contract)', () => {
  it('door geometries and materials are marked shared so per-view disposal skips them', () => {
    const { body, portal } = buildDoorBody(true, null, false);
    for (const m of meshes(body)) {
      expect(isSharedGeometry(m.geometry)).toBe(true);
      expect(isSharedMaterial(m.material as THREE.Material)).toBe(true);
    }
    if (!portal) throw new Error('expected a portal mesh');
    expect(isSharedMaterial(portal.material as THREE.Material)).toBe(true);
  });

  it('reuses the same cached geometry instances across builds', () => {
    const a = buildDoorBody(true, null, false);
    const b = buildDoorBody(true, null, false);
    const archA = meshes(a.body)[0];
    const archB = meshes(b.body)[0];
    // same shared geometry object, not a fresh allocation per door
    expect(archA.geometry).toBe(archB.geometry);
  });
});

describe('portal material: tint per direction and HDR boost per tier', () => {
  const portalMat = (entering: boolean, lowGfx: boolean): THREE.MeshBasicMaterial => {
    const { portal } = buildDoorBody(entering, null, lowGfx);
    if (!portal) throw new Error('expected a portal mesh');
    return portal.material as THREE.MeshBasicMaterial;
  };

  it('entering vs exit use distinct base tints', () => {
    // low tier: no boost, so the color is the raw tint
    const enter = portalMat(true, true);
    const exit = portalMat(false, true);
    expect(enter.color.getHex()).toBe(0x9a5df0);
    expect(exit.color.getHex()).toBe(0x6ab8ff);
    expect(enter.transparent).toBe(true);
    expect(enter.blending).toBe(THREE.AdditiveBlending);
    expect(enter.depthWrite).toBe(false);
  });

  it('non-low tier multiplies the tint by the bloom boost (2x), low tier does not', () => {
    const enterHigh = portalMat(true, false);
    const enterLow = portalMat(true, true);
    // The boost multiplies the working color channels by 2 (no clamp at this tint).
    expect(enterHigh.color.r).toBeCloseTo(enterLow.color.r * 2);
    expect(enterHigh.color.r).toBeGreaterThan(enterLow.color.r);
  });
});
