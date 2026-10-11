// First sight of Varkhul's live encounter visuals on a real WebGL driver: the
// browser half of the Varkhul set the interior encounter prewarm stages from
// the Forge-Lift on (tests/interior_encounter_prewarm_pass.test.ts drives the
// pass itself). renderer.info.programs is three's own program list, so it
// grows exactly when a draw links a program. The control leg proves the
// harness sees the live links; the staged legs prove the Varkhul set covers
// every program a live Forgestorm warning, the Master's Assembly and the
// raider marks ask for, on both output paths: Low draws to the canvas with
// the renderer's tone mapping, the composer tiers draw into a render target,
// where three keys every material with no tone mapping. The rig is not staged
// here: building it needs the character asset gate (every character GLB), so
// the Node driven test pins its factory and entity instead.
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import threeSource from '../../node_modules/three/build/three.module.js?raw';
import { syncVarkhulEncounterVisuals } from '../../src/render/varkhul_encounter';
import { VarkhulForgestormVisuals } from '../../src/render/varkhul_forgestorm_visual';
import {
  VARKHUL_BOSS_ID,
  VARKHUL_CINDER_ORBS_AURA_ID,
  VARKHUL_MAKERS_BRAND_AURA_ID,
} from '../../src/sim/encounters/varkhul';
import {
  type ActiveVarkhulAssembly,
  VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS,
  varkhulAssemblyRuneSlots,
  varkhulAssemblyRuneStation,
} from '../../src/sim/varkhul_assembly';
import { VARKHUL_CINDER_FIRE_RADIUS } from '../../src/sim/varkhul_cinder_orbs';
import {
  type ActiveVarkhulForgestormWarning,
  activeVarkhulForgestormWarnings,
} from '../../src/sim/varkhul_forgestorm';
import { VARKHUL_FRONTAL_CAST_ID } from '../../src/sim/varkhul_frontal';
import { VARKHUL_SHARED_PYRE_AURA_ID } from '../../src/sim/varkhul_shared_pyre';
import { buildVarkhulPrewarmSetRoots } from '../helpers/varkhul_prewarm_set';

type ProgramDiagnostics = { diagnostics?: { runnable?: boolean } };
type RetainingInfo = { retainedPrograms?: unknown[] };
type Tier = 'low' | 'ultra';

// The released-program FIFO bound of the patched three
// (patches/three@0.185.1.patch, pinned by tests/three_compile_async_patch.test.ts),
// read from the installed build so the churn below always overflows it.
const RETAINED_PROGRAM_LIMIT = Number(
  /const RETAINED_PROGRAM_LIMIT = (\d+);/.exec(threeSource)?.[1] ?? Number.NaN,
);

const WIDTH = 320;
const HEIGHT = 240;
const BOSS_ENTITY_ID = 42;
const SLOTS = varkhulAssemblyRuneSlots('normal', 0);

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
});

interface Rig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  programs(): number;
  draw(): void;
  compile(): void;
}

function makeRig(tier: Tier): Rig {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // The world renderer's own setting on every tier: Low draws to the canvas
  // with it, the composer's scene target keys every material without it.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const target =
    tier === 'ultra'
      ? new THREE.WebGLRenderTarget(WIDTH, HEIGHT, { type: THREE.HalfFloatType })
      : null;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050100);
  scene.fog = new THREE.Fog(0x1a0802, 20, 160);
  scene.add(new THREE.HemisphereLight(0xffd9b0, 0x2a1206, 0.8));
  const sun = new THREE.DirectionalLight(0xffc890, 1.2);
  sun.position.set(10, 30, 10);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 400);
  camera.position.set(0, 34, 46);
  camera.lookAt(0, 0, 8);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  dispose = () => {
    target?.dispose();
    renderer.dispose();
    canvas.remove();
  };
  const onTarget = (work: () => void): void => {
    renderer.setRenderTarget(target);
    try {
      work();
    } finally {
      renderer.setRenderTarget(null);
    }
  };
  return {
    renderer,
    scene,
    camera,
    programs: () => renderer.info.programs?.length ?? 0,
    draw: () => onTarget(() => renderer.render(scene, camera)),
    compile: () => onTarget(() => renderer.compile(scene, camera)),
  };
}

/** The Varkhul set as the pass stages it (the rig aside; the shared builder
 *  list is held equal to the pass's own in the Node driven test), hidden, compiled
 *  where the frame draws, then detached and held undisposed exactly as the
 *  pass holds it after compileEncounterPrewarmGroup. */
function stageVarkhulSet(rig: Rig, forgestormTwin = true): THREE.Group {
  const staged = new THREE.Group();
  staged.name = 'interior-encounter-prewarm';
  staged.visible = false;
  staged.add(...buildVarkhulPrewarmSetRoots({ forgestormTwin }));
  rig.scene.add(staged);
  rig.compile();
  const programs = rig.renderer.info.programs as ProgramDiagnostics[] | null;
  expect(programs?.length ?? 0).toBeGreaterThan(0);
  expect(programs?.filter((program) => program.diagnostics?.runnable === false)).toHaveLength(0);
  staged.removeFromParent();
  return staged;
}

function liveTrailMaterial(scene: THREE.Scene): THREE.Material {
  const warning = scene.getObjectByName('varkhul-forgestorm-warning');
  const trail = warning?.getObjectByName('varkhul-forgestorm-meteor-trail') as THREE.Mesh;
  return trail.material as THREE.Material;
}

function programOf(rig: Rig, material: THREE.Material): { usedTimes: number } {
  const program = (rig.renderer.properties.get(material) as { currentProgram?: unknown })
    .currentProgram as { usedTimes: number } | undefined;
  expect(program).toBeDefined();
  return program as { usedTimes: number };
}

/** Links, draws once and disposes `count` materials of unique program keys:
 *  the interest churn of a live session (bodies and props leaving) that pushes
 *  every released program through the FIFO and out. */
function churnReleasedPrograms(rig: Rig, count: number): void {
  const scene = new THREE.Scene();
  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.Mesh(geometry);
  mesh.frustumCulled = false;
  scene.add(mesh);
  for (let i = 0; i < count; i++) {
    const material = new THREE.ShaderMaterial({
      vertexShader:
        'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `void main() { gl_FragColor = vec4(${i}.0 / 1024.0, 0.0, 0.0, 1.0); }`,
    });
    mesh.material = material;
    rig.renderer.render(scene, rig.camera);
    material.dispose();
  }
  geometry.dispose();
  const retained = (rig.renderer.info as RetainingInfo).retainedPrograms ?? [];
  expect(retained).toHaveLength(RETAINED_PROGRAM_LIMIT);
}

function linksAssembly(): ActiveVarkhulAssembly {
  const runes = Array.from({ length: 10 }, (_, symbol) => ({
    symbol,
    ...varkhulAssemblyRuneStation({ x: 0, z: 0 }, SLOTS[symbol]),
    radius: VARKHUL_ASSEMBLY_RUNE_CONTROL_RADIUS,
    assignedPlayerId: symbol < 5 ? symbol + 100 : null,
    orphaned: false,
    locked: symbol === 1,
    targetAngle: 0.4,
    glyphAngle: 0.7,
    control: symbol === 0 ? ('counterclockwise' as const) : ('off' as const),
    controlProgress: symbol === 0 ? 0.5 : 0,
    alignmentProgress: 0,
    aligned: false,
  }));
  return {
    bossId: BOSS_ENTITY_ID,
    difficulty: 'normal',
    phase: 'links',
    forgeX: 0,
    forgeZ: 22,
    forgeHp: 60,
    forgeMaxHp: 100,
    forgeOverheat: 0,
    forgeBeamActiveMask: 0,
    forgeBeamWarmupRemaining: 0,
    forgeMeltdownRemaining: 0,
    addWave: 0,
    addWaves: 0,
    addsRemaining: 0,
    forgeBeams: [],
    interceptBeam: null,
    cores: [],
    deliveryWindowRemaining: 0,
    assignments: runes
      .filter((rune) => rune.assignedPlayerId !== null)
      .map((rune) => ({
        playerId: rune.assignedPlayerId ?? 0,
        symbol: rune.symbol,
        locked: rune.locked,
      })),
    runes,
    round: 0,
    rounds: 2,
    remaining: 18,
  };
}

/** One Forgestorm wave as the sim projects it: five points, one cast key. */
function forgestormWave(castKey: number): ActiveVarkhulForgestormWarning[] {
  return activeVarkhulForgestormWarnings(BOSS_ENTITY_ID, {
    forgestormCastKey: castKey,
    forgestormWaveIndex: 0,
    forgestormWarningRemaining: 1.5,
    forgestormPoints: [
      { x: -12, z: 0 },
      { x: -6, z: 8 },
      { x: 0, z: 0 },
      { x: 6, z: 8 },
      { x: 12, z: 0 },
    ],
  });
}

function encounterWorld(warnings: readonly ActiveVarkhulForgestormWarning[]) {
  return {
    activeVarkhulForgestormWarnings: warnings,
    activeVarkhulCinderFires: [
      {
        id: 'fire-0',
        sourceId: BOSS_ENTITY_ID,
        x: 8,
        z: -6,
        radius: VARKHUL_CINDER_FIRE_RADIUS,
      },
    ],
    activeVarkhulCinderOrbProjectiles: [
      {
        id: 'orb-0',
        sourceId: BOSS_ENTITY_ID,
        x: -8,
        z: -6,
        dirX: 1,
        dirZ: 0,
        radius: 1.45,
        duration: 7,
        remaining: 4,
      },
    ],
    activeVarkhulAssemblies: [linksAssembly()],
    player: { id: 100, pos: { x: 0, z: 0 }, auras: [] },
    entities: new Map<number, { auras: { id: string; remaining: number; duration: number }[] }>(),
  };
}

/** The raider marks and the boss frontal through the live per-entity sync. */
function attachMarks(scene: THREE.Scene): void {
  const raider = new THREE.Group();
  raider.position.set(-4, 0, 4);
  syncVarkhulEncounterVisuals(raider, {
    id: 100,
    kind: 'player',
    templateId: 'warrior',
    pos: { x: -4, z: 4 },
    auras: [
      { id: VARKHUL_CINDER_ORBS_AURA_ID, remaining: 3, duration: 6 },
      { id: VARKHUL_MAKERS_BRAND_AURA_ID, stacks: 2, remaining: 8, duration: 12 },
      { id: VARKHUL_SHARED_PYRE_AURA_ID, remaining: 3, duration: 6 },
    ],
  });
  const boss = new THREE.Group();
  boss.position.set(0, 0, 16);
  syncVarkhulEncounterVisuals(boss, {
    id: BOSS_ENTITY_ID,
    kind: 'mob',
    templateId: VARKHUL_BOSS_ID,
    scale: 3.2,
    castingAbility: VARKHUL_FRONTAL_CAST_ID,
    castRemaining: 1,
    castTotal: 2,
    auras: [],
  });
  scene.add(raider, boss);
}

describe.each<Tier>(['low', 'ultra'])('Varkhul encounter prewarm (%s)', (tier) => {
  it('control: without the Varkhul set, the live encounter links programs at first sight', () => {
    const rig = makeRig(tier);
    rig.draw();
    const baseline = rig.programs();
    const visuals = new VarkhulForgestormVisuals(rig.scene, () => 0);
    visuals.syncWorld(encounterWorld(forgestormWave(1)));
    visuals.update(0.1, true);
    attachMarks(rig.scene);
    rig.draw();
    expect(rig.programs()).toBeGreaterThan(baseline);
    visuals.dispose();
  });

  it('staged: a live Forgestorm warning, the Assembly and the marks link zero programs', () => {
    const rig = makeRig(tier);
    stageVarkhulSet(rig);
    rig.draw();
    const staged = rig.programs();

    const visuals = new VarkhulForgestormVisuals(rig.scene, () => 0);
    visuals.syncWorld(encounterWorld(forgestormWave(1)));
    visuals.update(0.1, true);
    attachMarks(rig.scene);
    expect(rig.scene.getObjectByName('varkhul-forgestorm-warning')).toBeDefined();
    expect(rig.scene.getObjectByName(`varkhul-assembly-${BOSS_ENTITY_ID}`)).toBeDefined();
    rig.draw();
    expect(rig.programs()).toBe(staged);
    visuals.dispose();
  });

  it('control: without the Forgestorm twin, both storms link the meteor trail live across a churn', () => {
    // Isolates the twin: the rest of the set staged, and no other staged
    // builder carries the trail's program. Once the storm's warnings are
    // disposed that program is in use by nothing: only the patched three's
    // bounded released-program FIFO still holds it, and any later release
    // pushes it toward eviction before the next storm.
    const rig = makeRig(tier);
    stageVarkhulSet(rig, false);
    rig.draw();
    const staged = rig.programs();
    const visuals = new VarkhulForgestormVisuals(rig.scene, () => 0);
    visuals.syncWorld(encounterWorld(forgestormWave(1)));
    visuals.update(0.1, true);
    rig.draw();
    expect(rig.programs()).toBeGreaterThan(staged);
    const trail = programOf(rig, liveTrailMaterial(rig.scene));
    visuals.syncWorld(encounterWorld([]));
    expect(trail.usedTimes).toBe(0);

    // Churn past the FIFO bound: the parked trail program is destroyed, and
    // the second storm links it again in its first frame.
    expect(RETAINED_PROGRAM_LIMIT).toBeGreaterThan(0);
    churnReleasedPrograms(rig, RETAINED_PROGRAM_LIMIT + 1);
    expect(rig.renderer.info.programs).not.toContain(trail);
    const beforeSecond = rig.programs();
    visuals.syncWorld(encounterWorld(forgestormWave(2)));
    visuals.update(0.1, true);
    rig.draw();
    expect(rig.programs()).toBeGreaterThan(beforeSecond);
    expect(programOf(rig, liveTrailMaterial(rig.scene))).not.toBe(trail);
    visuals.dispose();
  });

  it("staged: the first storm's dispose releases nothing, and the second storm links nothing after a churn", () => {
    const rig = makeRig(tier);
    stageVarkhulSet(rig);
    rig.draw();
    const staged = rig.programs();

    const visuals = new VarkhulForgestormVisuals(rig.scene, () => 0);
    visuals.syncWorld(encounterWorld(forgestormWave(1)));
    visuals.update(0.1, true);
    rig.draw();
    expect(rig.programs()).toBe(staged);

    // The storm ends: its warnings leave the snapshot and the owner disposes
    // all five materials of each. The held twin keeps the trail's program in
    // use, so it never joins the released-program FIFO it could be evicted from.
    const trail = programOf(rig, liveTrailMaterial(rig.scene));
    visuals.syncWorld(encounterWorld([]));
    rig.draw();
    expect(rig.scene.getObjectByName('varkhul-forgestorm-warning')).toBeUndefined();
    expect(rig.programs()).toBe(staged);
    expect(trail.usedTimes).toBeGreaterThan(0);

    // The same churn that evicts the trail without the twin: the program the
    // twin holds never entered the FIFO, so it is still linked after it.
    churnReleasedPrograms(rig, RETAINED_PROGRAM_LIMIT + 1);
    expect(rig.renderer.info.programs).toContain(trail);
    const beforeSecond = rig.programs();
    visuals.syncWorld(encounterWorld(forgestormWave(2)));
    visuals.update(0.1, true);
    expect(rig.scene.getObjectByName('varkhul-forgestorm-warning')).toBeDefined();
    rig.draw();
    expect(rig.programs()).toBe(beforeSecond);
    expect(programOf(rig, liveTrailMaterial(rig.scene))).toBe(trail);
    visuals.dispose();
  });
});
