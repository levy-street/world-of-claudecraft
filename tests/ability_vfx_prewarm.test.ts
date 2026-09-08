// The resumable half of the ability-VFX warm-up. AbilityVfxFx.prewarmSpawn can
// only run behind the loading screen (it spawns visible primitives), so the
// work that has to survive a missed boot deadline, and that constrained
// devices get INSTEAD of the entry, is expressed as explicit small units here:
// the six procedurally drawn impact sheets, the shared canvas set, and one
// program link per distinct pooled material.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/ability_vfx/contact_assets', async () => {
  const { Texture } = await import('three');
  const CONTACT_SHEETS = ['contact_cut', 'contact_crush', 'contact_pierce'];
  const textures = new Map(CONTACT_SHEETS.map((id) => [id, new Texture()]));
  return {
    CONTACT_SHEETS,
    contactTexture: (id: string) => textures.get(id),
    isContactSheet: (id: string) => textures.has(id),
  };
});

vi.mock('../src/render/ability_vfx/production_assets', async () => {
  const { Texture } = await import('three');
  const textures = {
    smoke: new Texture(),
    shout_dust: new Texture(),
    shockwave: new Texture(),
    pyroblast: new Texture(),
    frost_nova: new Texture(),
    chain_heal: new Texture(),
  };
  const pressure = new Texture();
  return {
    bakedTexture: (kind: keyof typeof textures) => textures[kind],
    warriorPressureTexture: () => pressure,
  };
});

vi.mock('../src/render/ability_vfx/signature_texture', async () => {
  const { Texture } = await import('three');
  const atlas = new Texture();
  return { signatureTexture: () => atlas };
});

vi.mock('../src/render/ability_vfx/simulation_assets', async () => {
  const { Texture } = await import('three');
  const maps = { normal: new Texture(), motion: new Texture(), lighting: new Texture() };
  return { liquidSurfaceMaps: () => maps };
});

import { FLIPBOOK_STYLES } from '../src/render/ability_vfx/fx_textures';
import {
  abilityVfxTexturePrewarmSteps,
  collectAbilityVfxCompileTargets,
} from '../src/render/ability_vfx/prewarm';

// The canvas textures are procedurally drawn, so a plain Node run needs a 2D
// context stub (same shape as the ability-VFX and vfx suites use).
function installCanvasStub(): void {
  const noop = () => {};
  const gradient = { addColorStop: noop };
  const context = {
    arc: noop,
    beginPath: noop,
    clip: noop,
    closePath: noop,
    createImageData: (width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    ellipse: noop,
    fill: noop,
    fillRect: noop,
    lineTo: noop,
    moveTo: noop,
    putImageData: noop,
    rect: noop,
    restore: noop,
    rotate: noop,
    save: noop,
    scale: noop,
    stroke: noop,
    translate: noop,
  };
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
}

function vfxMesh(name: string, material: THREE.Material | THREE.Material[]): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.name = name;
  mesh.visible = false;
  mesh.userData.renderCategory = 'vfx';
  return mesh;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('abilityVfxTexturePrewarmSteps', () => {
  it('gives every impact sheet its own unit, plus one for the shared canvases', () => {
    const steps = abilityVfxTexturePrewarmSteps();
    const ids = steps.map((step) => step.id);
    for (const style of FLIPBOOK_STYLES) expect(ids).toContain(`flipbook:${style}`);
    expect(ids).toContain('shared-canvases');
    expect(ids).toContain('signature-atlas');
    expect(ids).toContain('production:smoke');
    expect(ids).toContain('production:shout_dust');
    expect(ids).toContain('production:shockwave');
    for (const key of ['normal', 'motion', 'lighting'])
      expect(ids).toContain(`liquid-surface:${key}`);
    for (const id of ['contact_cut', 'contact_crush', 'contact_pierce']) expect(ids).toContain(id);
    expect(ids).toHaveLength(FLIPBOOK_STYLES.length + 15);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('builds real textures and returns the memoized instances on a second pass', () => {
    installCanvasStub();
    const first = abilityVfxTexturePrewarmSteps().map((step) => step.build());
    for (const textures of first) {
      expect(textures.length).toBeGreaterThan(0);
      for (const texture of textures) expect(texture.isTexture).toBe(true);
    }
    // A resumed unit that ran twice (a skip and a later drop) must not rebuild
    // the canvases: the pools bind these exact instances.
    const second = abilityVfxTexturePrewarmSteps().map((step) => step.build());
    expect(second).toEqual(first);
  });

  it('does not build anything until a unit actually runs', () => {
    // No canvas stub installed: constructing the steps must stay inert, since
    // the renderer builds the unit list inside the entry-time manifest loop.
    expect(() => abilityVfxTexturePrewarmSteps()).not.toThrow();
  });
});

describe('collectAbilityVfxCompileTargets', () => {
  it('returns one target per distinct pooled material', () => {
    const scene = new THREE.Scene();
    const shared = new THREE.MeshBasicMaterial();
    scene.add(vfxMesh('ring', shared));
    scene.add(vfxMesh('ring-slot-2', shared)); // same material: already covered
    scene.add(vfxMesh('decal', new THREE.MeshBasicMaterial()));
    const targets = collectAbilityVfxCompileTargets(scene);
    expect(targets).toHaveLength(2);
    expect(targets.map((target) => target.object.name)).toEqual(['ring', 'decal']);
    expect(new Set(targets.map((target) => target.id)).size).toBe(2);
  });

  it('ignores everything that is not a tagged VFX mesh', () => {
    const scene = new THREE.Scene();
    const holder = new THREE.Group();
    holder.userData.renderCategory = 'vfx'; // a spirit holder: no material of its own
    scene.add(holder);
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()));
    const terrain = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    terrain.userData.renderCategory = 'terrain';
    scene.add(terrain);
    expect(collectAbilityVfxCompileTargets(scene)).toEqual([]);
  });

  it('folds a pool that clones one prototype per slot into a single unit', () => {
    // ImpactFlipbooks clones its prototype material per slot: six distinct
    // material instances, one program, so one compile unit.
    const scene = new THREE.Scene();
    const proto = new THREE.ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4(position, 1.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
    });
    for (let slot = 0; slot < 6; slot++) scene.add(vfxMesh(`flip-${slot}`, proto.clone()));
    // A different shader in the same pool family still earns its own unit.
    scene.add(
      vfxMesh(
        'ribbon',
        new THREE.ShaderMaterial({
          vertexShader: 'void main() { gl_Position = vec4(position, 2.0); }',
          fragmentShader: 'void main() { gl_FragColor = vec4(0.5); }',
        }),
      ),
    );
    const targets = collectAbilityVfxCompileTargets(scene);
    expect(targets.map((target) => target.object.name)).toEqual(['flip-0', 'ribbon']);
  });

  it('covers a multi-material mesh once, on its first unseen material', () => {
    const scene = new THREE.Scene();
    const a = new THREE.MeshBasicMaterial();
    const b = new THREE.MeshBasicMaterial();
    scene.add(vfxMesh('pillar', [a, b]));
    scene.add(vfxMesh('pillar-cap', [a, b]));
    const targets = collectAbilityVfxCompileTargets(scene);
    expect(targets.map((target) => target.object.name)).toEqual(['pillar']);
  });
});

describe('the renderer wires the units into the prewarm resume lane', () => {
  const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
  const entry = readFileSync(
    new URL('../src/render/ability_vfx/primitive_prewarm.ts', import.meta.url),
    'utf8',
  );
  const entryStart = entry.indexOf("id: 'vfx.ability-primitives'");

  it('retains texture and program units, never the visible spawn', () => {
    expect(entryStart).toBeGreaterThan(-1);
    const unitsStart = entry.indexOf('const resumeUnits =');
    expect(unitsStart).toBeGreaterThan(-1);
    const units = entry.slice(unitsStart, entry.indexOf('\n  ];', unitsStart));
    expect(units).toContain('abilityVfxTexturePrewarmSteps()');
    expect(units).toContain('host.texture(texture)');
    expect(units).toContain('collectAbilityVfxCompileTargets(host.scene)');
    expect(units).toContain('host.compile(target.object, false)');
    expect(renderer).toContain('...abilityPreparation.entries(this.sim.cfg.playerClass,');
    expect(renderer).toContain('texture: (texture) => this.prewarmTexture(texture)');
    expect(renderer).toContain(
      'compile: (root, offscreen) => this.compilePrewarmColorPrograms(root, offscreen)',
    );
    expect(renderer).toContain(
      'draw: (group, child) => this.renderBoundedPrewarmRoot(group, child)',
    );
    // Replaying prewarmSpawn live would pop a white primitive burst.
    expect(units).not.toContain('prewarmSpawn');
    expect(units).not.toContain('host.spawn');
  });

  it('hands a policy-skipped entry its units instead of dropping them', () => {
    expect(renderer).toContain('const skipUnits = prewarmEntryResumesAfterSkip(entry.id, policy)');
    expect(renderer).toContain(
      'if (skipUnits.length > 0) droppedEntries.push({ id: entry.id, units: skipUnits });',
    );
    // The summary stays honest about what a skip deferred rather than dropped.
    const detailAt = renderer.indexOf('constrained-minimal;resume=');
    expect(detailAt).toBeGreaterThan(-1);
    expect(renderer.slice(detailAt, detailAt + 60)).toContain('skipUnits.length');
  });
});
