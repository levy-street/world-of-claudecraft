// The resumable half of the ability-VFX warm-up. AbilityVfxFx.prewarmSpawn can
// only run behind the loading screen (it spawns visible primitives), so the
// work that has to survive a missed boot deadline, and that constrained
// devices get INSTEAD of the entry, is expressed as explicit small units here:
// the six procedurally drawn impact sheets, the shared canvas set, and one
// program link per distinct pooled material.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as contactAssets from '../src/render/ability_vfx/contact_assets';
import { FLIPBOOK_STYLES } from '../src/render/ability_vfx/fx_textures';
import {
  abilityVfxGateMaterials,
  abilityVfxTexturePrewarmSteps,
  collectAbilityVfxCompileTargets,
} from '../src/render/ability_vfx/prewarm';
import * as productionAssets from '../src/render/ability_vfx/production_assets';
import { tagCastVfxEngine, tagCastVfxKit } from '../src/render/cast_vfx_family';

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
  tagCastVfxEngine(mesh);
  return mesh;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('abilityVfxTexturePrewarmSteps', () => {
  it('gives each procedural sheet its own preparation unit, plus one for the shared canvases', () => {
    const steps = abilityVfxTexturePrewarmSteps();
    expect(steps.map((step) => step.id)).toEqual([
      ...FLIPBOOK_STYLES.map((style) => `flipbook:${style}`),
      'shared-canvases',
    ]);
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

  it('reads none of the Warrior kit sheets, which only the kit recipe uploads', () => {
    // The kit's sheets load on demand after boot, so a boot read found null
    // and uploaded nothing; the kit's own recipe (active_kit_prewarm.ts) owns
    // every one of them, for a local and a remote Warrior alike.
    installCanvasStub();
    const reads = [
      vi.spyOn(contactAssets, 'contactTexture'),
      vi.spyOn(productionAssets, 'bakedTexture'),
      vi.spyOn(productionAssets, 'warriorBloodTexture'),
      vi.spyOn(productionAssets, 'warriorPressureTexture'),
      vi.spyOn(productionAssets, 'warriorRockTexture'),
      vi.spyOn(productionAssets, 'warriorSteelTexture'),
    ];
    for (const step of abilityVfxTexturePrewarmSteps()) step.build();
    for (const read of reads) expect(read).not.toHaveBeenCalled();
  });

  it('does not build anything until a unit actually runs', () => {
    // No canvas stub installed: constructing the steps must stay inert, since
    // the renderer builds the unit list inside the entry-time manifest loop.
    expect(() => abilityVfxTexturePrewarmSteps()).not.toThrow();
  });
});

describe('collectAbilityVfxCompileTargets', () => {
  it('returns one target per distinct pooled program', () => {
    const scene = new THREE.Scene();
    const shared = new THREE.MeshBasicMaterial();
    scene.add(vfxMesh('ring', shared));
    scene.add(vfxMesh('ring-slot-2', shared)); // same material: already covered
    scene.add(vfxMesh('decal', new THREE.MeshBasicMaterial({ transparent: true })));
    const targets = collectAbilityVfxCompileTargets(scene);
    expect(targets).toHaveLength(2);
    expect(targets.map((target) => target.object.name)).toEqual(['ring', 'decal']);
    expect(new Set(targets.map((target) => target.id)).size).toBe(2);
  });

  it('folds built-in material clones by program, not by material instance', () => {
    // The warlock verdict pools build one MeshBasicMaterial per part per slot:
    // hundreds of instances over a handful of programs. Keyed by uuid, each
    // clone was a compile unit and a gate entry (about 400 on Sentence and
    // Needle of Fate together); keyed by program, the slots collapse.
    const scene = new THREE.Scene();
    const proto = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    for (let slot = 0; slot < 8; slot++) {
      const clone = proto.clone();
      clone.color.setHex(0x100000 * (slot + 1));
      clone.opacity = slot / 8;
      scene.add(vfxMesh(`slot-${slot}`, clone));
    }
    // A real second program in the same pool still earns its own unit, and so
    // does the same material drawn by a Points cloud.
    scene.add(vfxMesh('opaque', new THREE.MeshBasicMaterial()));
    const cloud = new THREE.Points(new THREE.BufferGeometry(), proto.clone());
    cloud.name = 'cloud';
    tagCastVfxEngine(cloud);
    scene.add(cloud);
    const targets = collectAbilityVfxCompileTargets(scene);
    expect(targets.map((target) => target.object.name)).toEqual(['slot-0', 'opaque', 'cloud']);
    const gated = abilityVfxGateMaterials(scene);
    // The gate asks about the SAME representatives the units compile.
    expect(gated).toEqual(
      targets.map((target) => (target.object as THREE.Mesh).material as THREE.Material),
    );
  });

  it('puts the engine family first, then the kit, and lets a gated draw represent a shared program', () => {
    // The resume lane is serial in unit order, so the programs the cast gate
    // waits on must not queue behind a class pool walked ahead of them.
    const scene = new THREE.Scene();
    const shared = new THREE.MeshBasicMaterial({ transparent: true });
    const kitShared = new THREE.MeshBasicMaterial({ wireframe: true });
    const bespokeTwin = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shared.clone());
    bespokeTwin.name = 'bespoke-twin';
    bespokeTwin.userData.renderCategory = 'vfx';
    const kitTwin = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), kitShared.clone());
    kitTwin.name = 'kit-twin';
    kitTwin.userData.renderCategory = 'vfx';
    const bespoke = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    bespoke.name = 'bespoke';
    bespoke.userData.renderCategory = 'vfx';
    const crest = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), kitShared);
    crest.name = 'crest';
    tagCastVfxKit(crest);
    scene.add(bespokeTwin, kitTwin, bespoke, crest, vfxMesh('ring', shared));
    const targets = collectAbilityVfxCompileTargets(scene);
    expect(targets.map((target) => target.object.name)).toEqual(['ring', 'crest', 'bespoke']);
    expect(abilityVfxGateMaterials(scene)).toEqual([shared, kitShared]);
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
  const entryStart = renderer.indexOf("id: 'vfx.ability-primitives'");
  const entry = renderer.slice(renderer.lastIndexOf('{', entryStart), entryStart + 2000);

  it('retains texture units as cosmetic and program units as debt, never the visible spawn', () => {
    expect(entryStart).toBeGreaterThan(-1);
    const unitsStart = entry.indexOf('resumeUnits: () =>');
    expect(unitsStart).toBeGreaterThan(-1);
    const programsStart = entry.indexOf('resumeProgramUnits: () =>', unitsStart);
    expect(programsStart).toBeGreaterThan(unitsStart);
    const units = entry.slice(unitsStart, programsStart);
    expect(units).toContain('abilityVfxTexturePrewarmSteps()');
    expect(units).toContain('this.prewarmTexture(texture)');
    // The program links are the debt arm (cast_vfx_prewarm.ts): the lazy
    // stand-ins' stage + link, then one unit per pooled program.
    expect(entry.slice(programsStart)).toContain(
      'resumeProgramUnits: () => [...castVfxUnits(), ...abilityMaterialSlot.resumeUnits()],',
    );
    expect(renderer).toContain(
      'castVfxProgramUnits(this.scene, abilityMaterialSlot.group, this.compileArms, this.webgl);',
    );
    // run() links the same set behind the curtain; the spawn binds textures only.
    expect(entry).toContain('await Promise.all(castVfxUnits().map((unit) => unit.run()));');
    // Replaying prewarmSpawn live would pop a white primitive burst.
    expect(units).not.toContain('prewarmSpawn');
    expect(entry.slice(programsStart, entry.indexOf('run: async'))).not.toContain('prewarmSpawn');
  });

  it('hands a policy-skipped entry its units instead of dropping them', () => {
    expect(renderer).toContain('const resumes = prewarmEntryResumesAfterSkip(entry.id, policy);');
    expect(renderer).toContain('if (resumes) dropEntry(entry, skipUnits);');
    // dropEntry keeps the entry's own units in its class and hands the
    // program units over as `programs.<id>` debt (prewarm_policy.ts).
    expect(renderer).toContain(
      'if (units.length > 0) droppedEntries.push({ id: entry.id, units });',
    );
    expect(renderer).toContain(
      'droppedProgramEntries.push({ id: `programs.${entry.id}`, units: programs });',
    );
    // ... pushed between the compile remainder and the hidden catalogs.
    const submitAt = renderer.indexOf(
      "id: 'programs.compile-submit',\n        units: deferredSubmitUnits",
    );
    const programsAt = renderer.indexOf('droppedEntries.push(...droppedProgramEntries);');
    const postPaintAt = renderer.indexOf(
      "id: 'programs.compile-post-paint',\n        units: postPaintCompileUnits",
    );
    expect(submitAt).toBeGreaterThan(-1);
    expect(programsAt).toBeGreaterThan(submitAt);
    expect(postPaintAt).toBeGreaterThan(programsAt);
    // The summary stays honest about what a skip deferred rather than dropped.
    const detailAt = renderer.indexOf('constrained-minimal;resume=');
    expect(detailAt).toBeGreaterThan(-1);
    expect(renderer.slice(detailAt, detailAt + 60)).toContain('skipUnits.length');
  });
});
