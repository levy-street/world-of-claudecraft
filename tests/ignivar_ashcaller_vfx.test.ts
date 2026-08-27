import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  attachAshcallerVfx,
  buildAshcallerVfxPrewarmVisual,
  disposeAshcallerVfx,
  syncAshcallerVfx,
} from '../src/render/ignivar_ashcaller_vfx';
import { IGNIVAR_APOCALYPSE_CAST_ID } from '../src/sim/encounters/ignivar';

// GLTFLoader strips dots from animated node names at runtime, so the live rig
// carries the sanitized spellings the module must also match.
const RUNTIME_SOCKETS = ['vfx_core', 'vfx_belt', 'vfx_handr', 'vfx_eyes', 'vfx_staff'];

function ashcallerRoot(): THREE.Group {
  const root = new THREE.Group();
  for (const name of RUNTIME_SOCKETS) {
    const bone = new THREE.Bone();
    bone.name = name;
    root.add(bone);
  }
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ emissiveMap: new THREE.Texture() }),
  );
  root.add(body);
  return root;
}

function bodyMaterial(root: THREE.Group): THREE.MeshStandardMaterial {
  let found: THREE.MeshStandardMaterial | null = null;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !Array.isArray(mesh.material)) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat.emissiveMap) found = mat;
    }
  });
  if (!found) throw new Error('body material missing');
  return found;
}

describe('ignivar ashcaller vfx', () => {
  it('attaches every socket emitter idempotently and without a point light', () => {
    const root = ashcallerRoot();

    const handle = attachAshcallerVfx(root);
    expect(handle).not.toBeNull();
    // Second attach returns the SAME handle without duplicating nodes.
    expect(attachAshcallerVfx(root)).toBe(handle);
    for (const socket of RUNTIME_SOCKETS) {
      expect(root.getObjectByName(`${socket}__ember`), socket).toBeDefined();
    }
    // The belt vent is falling ash: no heat shimmer on it.
    expect(root.getObjectByName('vfx_belt__shimmer')).toBeUndefined();
    expect(root.getObjectByName('vfx_core__shimmer')).toBeDefined();
    expect(root.getObjectByName('vfx_staff__absorb')).toBeDefined();
    expect(root.getObjectByName('ashcaller__nova_ring')).toBeDefined();
    expect(root.getObjectByName('ashcaller__nova_pillar')).toBeDefined();
    expect(root.getObjectByName('ashcaller__shell')).toBeDefined();
    // Dynamic point lights ride the pad budget (point_light_budget.ts); this
    // module holds no pad lease, so the gem light stays off by default.
    expect(root.getObjectByName('vfx_staff__light')).toBeUndefined();

    // A model without the sockets is not an Ashcaller: attach refuses.
    expect(attachAshcallerVfx(new THREE.Group())).toBeNull();
  });

  it('follows a scaled parent in the ember shader point size', () => {
    const root = ashcallerRoot();
    attachAshcallerVfx(root);
    const ember = root.getObjectByName('vfx_core__ember') as THREE.Points<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >;
    // gl_PointSize is in screen pixels and does not follow a scaled parent, so
    // the shader must scale by uScale itself (update() reads the root's world
    // scale into it).
    expect(ember.material.vertexShader).toContain('gl_PointSize = aSize * uScale');
    // World-space buoyancy: the belt vent flips the sign so its ash falls.
    expect(ember.material.vertexShader).toContain('mix(1.0, -0.55, uFall)');
    const belt = root.getObjectByName('vfx_belt__ember') as THREE.Points<
      THREE.BufferGeometry,
      THREE.ShaderMaterial
    >;
    expect(belt.material.uniforms.uFall.value).toBe(1);
    expect(ember.material.uniforms.uFall.value).toBe(0);
  });

  it('winds up on the Apocalypse channel and fires the nova on the wipe edge', () => {
    const root = ashcallerRoot();
    const channeling = {
      dead: false,
      castingAbility: IGNIVAR_APOCALYPSE_CAST_ID,
      channeling: true,
    };
    for (let frame = 0; frame < 20; frame++) syncAshcallerVfx(root, channeling, 0.1);
    const handle = attachAshcallerVfx(root);
    expect(handle?.charge() ?? 0).toBeGreaterThan(0.3);
    const ring = root.getObjectByName('ashcaller__nova_ring') as THREE.Mesh;
    const pillar = root.getObjectByName('ashcaller__nova_pillar') as THREE.Mesh;
    expect(ring.visible).toBe(false);

    // The channel ending while he still lives IS the completed Apocalypse (the
    // sim clears the cast before dealing the wipe damage).
    syncAshcallerVfx(root, { dead: false, castingAbility: null, channeling: false }, 1 / 60);

    expect(ring.visible).toBe(true);
    expect(pillar.visible).toBe(true);
    // The stored wind-up is spent by the strike, not faded out.
    expect(handle?.charge()).toBe(0);
  });

  it('advances the wipe edge off-frustum and only defers the draw', () => {
    const root = ashcallerRoot();
    const channeling = {
      dead: false,
      castingAbility: IGNIVAR_APOCALYPSE_CAST_ID,
      channeling: true,
    };
    // The whole channel runs off screen: emitters hidden, state advancing.
    for (let frame = 0; frame < 20; frame++) syncAshcallerVfx(root, channeling, 0.1, false);
    const ember = root.getObjectByName('vfx_core__ember') as THREE.Points;
    expect(ember.visible).toBe(false);
    const ring = root.getObjectByName('ashcaller__nova_ring') as THREE.Mesh;

    // The Apocalypse resolves while the camera looks away: the edge fires NOW.
    syncAshcallerVfx(root, { dead: false, castingAbility: null, channeling: false }, 1 / 60, false);
    expect(ring.visible).toBe(false);

    // The camera swings back moments later: the still-live envelope draws.
    syncAshcallerVfx(root, { dead: false, castingAbility: null, channeling: false }, 1 / 60, true);
    expect(ring.visible).toBe(true);
    expect(ember.visible).toBe(true);

    // Long after the envelope is spent, coming back on screen replays nothing.
    for (let frame = 0; frame < 80; frame++) {
      syncAshcallerVfx(root, { dead: false, castingAbility: null, channeling: false }, 0.1, false);
    }
    syncAshcallerVfx(root, { dead: false, castingAbility: null, channeling: false }, 1 / 60, true);
    expect(ring.visible).toBe(false);
  });

  it('trades the nova for the body flash under reduced motion', () => {
    const root = ashcallerRoot();
    const channeling = {
      dead: false,
      castingAbility: IGNIVAR_APOCALYPSE_CAST_ID,
      channeling: true,
    };
    for (let frame = 0; frame < 10; frame++) {
      syncAshcallerVfx(root, channeling, 0.1, true, true);
    }

    syncAshcallerVfx(
      root,
      { dead: false, castingAbility: null, channeling: false },
      1 / 60,
      true,
      true,
    );

    const ring = root.getObjectByName('ashcaller__nova_ring') as THREE.Mesh;
    const shell = root.getObjectByName('ashcaller__shell') as THREE.Mesh;
    expect(ring.visible).toBe(false);
    expect(shell.visible).toBe(true);
  });

  it('restores the shared materials to the authored emissive baseline on dispose', () => {
    const root = ashcallerRoot();
    const channeling = {
      dead: false,
      castingAbility: IGNIVAR_APOCALYPSE_CAST_ID,
      channeling: true,
    };
    for (let frame = 0; frame < 10; frame++) syncAshcallerVfx(root, channeling, 0.1);
    const dead = { dead: true, castingAbility: null, channeling: false };
    for (let frame = 0; frame < 120; frame++) syncAshcallerVfx(root, dead, 0.1);
    const material = bodyMaterial(root);
    expect(material.emissiveIntensity).toBeLessThan(0.5);

    disposeAshcallerVfx(root);

    // The tinted-material cache entry outlives the entity: it must never keep
    // a mid-gutter value for its next mount.
    expect(material.emissiveIntensity).toBe(2.4);
  });

  it('links the same shader program surface from the prewarm stand-in as the live attach', () => {
    const signatures = (host: THREE.Object3D) => {
      const out = new Set<string>();
      host.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh && o.type !== 'Points') return;
        const material = (o as THREE.Mesh).material;
        for (const mat of Array.isArray(material) ? material : [material]) {
          const sm = mat as THREE.ShaderMaterial;
          if (!sm?.isShaderMaterial) continue;
          // The program-key surface a ShaderMaterial moves on: shader source,
          // side, and the Points-vs-Mesh object variant.
          out.add(`${o.type}|${sm.side}|${sm.vertexShader}|${sm.fragmentShader}`);
        }
      });
      return out;
    };
    const live = ashcallerRoot();
    // Full options, like the prewarm builder, so the comparison covers the
    // superset the prewarm is required to link.
    attachAshcallerVfx(live, { density: 1, shimmer: true });
    const prewarm = buildAshcallerVfxPrewarmVisual();

    expect(signatures(prewarm)).toEqual(signatures(live));
  });

  it('gutters out on death without firing the wipe nova', () => {
    const root = ashcallerRoot();
    const channeling = {
      dead: false,
      castingAbility: IGNIVAR_APOCALYPSE_CAST_ID,
      channeling: true,
    };
    for (let frame = 0; frame < 20; frame++) syncAshcallerVfx(root, channeling, 0.1);
    const material = bodyMaterial(root);
    expect(material.emissiveIntensity).toBeGreaterThan(1);

    // Killing the add ends the channel too, but the edge arrives dead: no nova.
    const dead = { dead: true, castingAbility: null, channeling: false };
    for (let frame = 0; frame < 120; frame++) syncAshcallerVfx(root, dead, 0.1);

    const ring = root.getObjectByName('ashcaller__nova_ring') as THREE.Mesh;
    expect(ring.visible).toBe(false);
    expect(material.emissiveIntensity).toBeLessThan(0.5);
  });

  it('disposes every node it added and re-attaches cleanly afterwards', () => {
    const root = ashcallerRoot();
    syncAshcallerVfx(
      root,
      { dead: false, castingAbility: IGNIVAR_APOCALYPSE_CAST_ID, channeling: true },
      1 / 60,
    );
    expect(root.getObjectByName('ashcaller__nova_ring')).toBeDefined();

    disposeAshcallerVfx(root);

    expect(root.getObjectByName('ashcaller__nova_ring')).toBeUndefined();
    expect(root.getObjectByName('vfx_core__ember')).toBeUndefined();
    // A pooled rig re-acquired for a fresh spawn attaches again from scratch.
    const again = attachAshcallerVfx(root);
    expect(again).not.toBeNull();
    expect(root.getObjectByName('ashcaller__nova_ring')).toBeDefined();
  });

  it('builds a prewarm stand-in carrying every shader program family', () => {
    const group = buildAshcallerVfxPrewarmVisual();
    const shaderMaterials = new Set<THREE.ShaderMaterial>();
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh && o.type !== 'Points') return;
      const material = (o as THREE.Mesh).material;
      for (const mat of Array.isArray(material) ? material : [material]) {
        if ((mat as THREE.ShaderMaterial)?.isShaderMaterial) {
          shaderMaterials.add(mat as THREE.ShaderMaterial);
        }
      }
    });
    // ember (per-socket variants share the shader but not the material), the
    // shimmer, the absorb, the nova ring, the pillar, and the shell.
    expect(shaderMaterials.size).toBeGreaterThanOrEqual(6);
    const shaders = new Set(
      [...shaderMaterials].map((mat) => `${mat.vertexShader}\n${mat.fragmentShader}`),
    );
    expect(shaders.size).toBeGreaterThanOrEqual(5);
  });
});
