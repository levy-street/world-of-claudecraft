// The Goblin Rocket Sled plume's material ownership (src/render/goblin_rocket_sled_fx.ts):
// ONE module-owned outer/core ShaderMaterial pair for every sled, never
// disposed by a rider, with each rider's values pushed right before its own
// draw. three keys a ShaderMaterial's program on its shader stages, which die
// with the last material compiled from them, so a per-rider pair disposed on
// dismount relinked the program at the next plume, live, and the
// retained-program FIFO could never serve it (the real-GL half of this is
// tests/browser/goblin_rocket_sled_plume_programs.browser.test.ts).
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import type { GraphicsSettingsSnapshot } from '../src/game/graphics_rebuild_core';
import {
  activateGfxProfile,
  GFX,
  type GfxCapabilities,
  type GfxProfile,
  getActiveGfxProfile,
  resolveGfxProfile,
} from '../src/render/gfx';
import {
  GoblinRocketSledFx,
  goblinRocketSledPlumeMaterials,
  resetGoblinRocketSledProfileCaches,
} from '../src/render/goblin_rocket_sled_fx';
import {
  type GoblinRocketSledFxInputs,
  type GoblinRocketSledFxPlan,
  type GoblinRocketSledFxState,
  stepGoblinRocketSledFx,
} from '../src/render/goblin_rocket_sled_fx_core';

const LAYERS = ['Outer', 'Core'] as const;
const SIDES = ['L', 'R'] as const;

function sledRoot(): THREE.Group {
  const root = new THREE.Group();
  for (const side of SIDES) {
    const socket = new THREE.Object3D();
    socket.name = `Socket_Exhaust_${side}`;
    root.add(socket);
  }
  return root;
}

function ride(): { fx: GoblinRocketSledFx; root: THREE.Group } {
  const root = sledRoot();
  const fx = GoblinRocketSledFx.create(root);
  if (!fx) throw new Error('a root carrying both exhaust sockets gets a plume');
  return { fx, root };
}

function plumeMesh(root: THREE.Object3D, side: 'L' | 'R', layer: 'Outer' | 'Core'): THREE.Mesh {
  const mesh = root.getObjectByName(`GoblinRocketPlume_${side}_${layer}`) as THREE.Mesh | undefined;
  if (!mesh) throw new Error(`no ${side} ${layer} plume mesh`);
  return mesh;
}

type Snapshot = Record<
  'uTime' | 'uIntensity' | 'uOpacity' | 'uReverseBlend' | 'uIgnition' | 'uAirborneHeat',
  number
>;

/** Run a mesh's own pre-draw hook, as three does right before its draw, and
 *  read what the shared material now holds. */
function drawAndRead(mesh: THREE.Mesh): Snapshot {
  const material = mesh.material as THREE.ShaderMaterial;
  material.uniformsNeedUpdate = false;
  mesh.onBeforeRender(
    null as unknown as THREE.WebGLRenderer,
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    mesh.geometry,
    material,
    null as unknown as THREE.Group,
  );
  expect(material.uniformsNeedUpdate, `${mesh.name} flags its upload`).toBe(true);
  const u = material.uniforms;
  return {
    uTime: u.uTime.value,
    uIntensity: u.uIntensity.value,
    uOpacity: u.uOpacity.value,
    uReverseBlend: u.uReverseBlend.value,
    uIgnition: u.uIgnition.value,
    uAirborneHeat: u.uAirborneHeat.value,
  };
}

const freshState = (): GoblinRocketSledFxState => ({
  intensity: 0,
  reverseBlend: 0,
  ignitionAge: -1,
  ignitionCooldown: 0,
  nonForwardTime: 0,
  forwardAge: 0,
  fullBoreLatched: false,
  wasForward: false,
  wasAirborne: false,
  airborneBlend: 0,
  landingAge: -1,
});

const freshPlan = (): GoblinRocketSledFxPlan => ({
  visible: false,
  intensity: 0,
  outerLength: 0,
  outerWidth: 0,
  innerLength: 0,
  opacity: 0,
  flutter: 0,
  particleStrength: 0,
  smokeStrength: 0,
  reverseBlend: 0,
  ignition: 0,
  ignitionAge: -1,
  ignitionBurst: false,
  thrustSpool: 0,
  airborneOverburn: 0,
  jetHunt: 0,
  takeoffBurst: false,
  landingBurst: false,
  stationaryPressure: 0,
});

type Drive = Omit<GoblinRocketSledFxInputs, 'time' | 'mounted'>;
type Phase = readonly [steps: number, drive: Drive];

/** Drive the controller and, beside it, the pure core with the same inputs,
 *  phase after phase, and return the per-layer uniforms the per-material code
 *  wrote before the pair was shared (the formulas of the release controller). */
function driveBoth(fx: GoblinRocketSledFx, phases: readonly Phase[], t0: number) {
  const state = freshState();
  const plan = freshPlan();
  let time = t0;
  for (const [steps, drive] of phases) {
    for (let i = 0; i < steps; i++) {
      time += drive.dt;
      fx.update(
        drive.dt,
        time,
        drive.moving,
        drive.backwards,
        drive.airborne,
        drive.speed,
        drive.reducedMotion,
        true,
        null,
      );
      stepGoblinRocketSledFx(state, { ...drive, time, mounted: true }, plan);
    }
  }
  const outer: Snapshot = {
    uTime: time,
    uIntensity: plan.intensity,
    uOpacity: plan.opacity * 0.72,
    uReverseBlend: plan.reverseBlend,
    uIgnition: plan.ignition,
    uAirborneHeat: plan.airborneOverburn * 0.18 + plan.stationaryPressure * 0.42,
  };
  const core: Snapshot = {
    uTime: time + 0.37,
    uIntensity: plan.intensity,
    uOpacity: plan.opacity * 0.92,
    uReverseBlend: plan.reverseBlend,
    uIgnition: plan.ignition,
    uAirborneHeat: Math.min(1, plan.airborneOverburn * 0.72 + plan.stationaryPressure),
  };
  return { outer, core, visible: plan.visible, plan: { ...plan } };
}

const FORWARD: Drive = {
  dt: 0.05,
  moving: true,
  backwards: false,
  airborne: false,
  speed: 14,
  reducedMotion: false,
};
const REVERSE_AIRBORNE: Drive = {
  dt: 0.05,
  moving: true,
  backwards: true,
  airborne: true,
  speed: 4,
  reducedMotion: false,
};
const FORWARD_AIRBORNE: Drive = { ...FORWARD, airborne: true };
const HOVER: Drive = { ...FORWARD, moving: false, airborne: true, speed: 0 };

describe('the shared plume pair', () => {
  afterEach(() => {
    resetGoblinRocketSledProfileCaches();
  });

  it('is one outer and one core material for every rider', () => {
    const shared = goblinRocketSledPlumeMaterials();
    expect(shared.outer).not.toBe(shared.core);
    const a = ride();
    const b = ride();
    for (const { root } of [a, b]) {
      for (const side of SIDES) {
        expect(plumeMesh(root, side, 'Outer').material).toBe(shared.outer);
        expect(plumeMesh(root, side, 'Core').material).toBe(shared.core);
      }
    }
    // The per-rider part stays per rider: its own cone geometry.
    expect(plumeMesh(a.root, 'L', 'Outer').geometry).not.toBe(
      plumeMesh(b.root, 'L', 'Outer').geometry,
    );
  });

  it('gives each rider its own values at its own draw, the release formulas exactly', () => {
    const a = ride();
    const b = ride();
    const c = ride();
    const expectA = driveBoth(a.fx, [[30, FORWARD]], 10);
    const expectB = driveBoth(b.fx, [[12, REVERSE_AIRBORNE]], 40);
    // A hover right after a short airborne burn: the stationary pressure term
    // is live, and the core heat reaches its clamp at 1.
    const expectC = driveBoth(
      c.fx,
      [
        [8, FORWARD_AIRBORNE],
        [2, HOVER],
      ],
      70,
    );
    expect(expectA.visible && expectB.visible && expectC.visible, 'all plumes flare').toBe(true);
    // A decisive pair: the two riders write different values on every uniform.
    for (const layer of ['outer', 'core'] as const) {
      for (const key of Object.keys(expectA[layer]) as (keyof Snapshot)[]) {
        expect(expectA[layer][key], `${layer} ${key}`).not.toBe(expectB[layer][key]);
      }
    }
    expect(expectC.plan.stationaryPressure, 'the hover presses').toBeGreaterThan(0);
    expect(
      expectC.plan.airborneOverburn * 0.72 + expectC.plan.stationaryPressure,
      'the core heat before its clamp',
    ).toBeGreaterThan(1);
    expect(expectC.core.uAirborneHeat).toBe(1);

    // Interleaved the way a frame sorts them: another rider's draw must not
    // leave its values on the next draw, on either layer or nozzle.
    const riders = [
      [a, expectA],
      [b, expectB],
      [c, expectC],
    ] as const;
    for (const side of SIDES) {
      for (const [rider, expected] of riders) {
        expect(drawAndRead(plumeMesh(rider.root, side, 'Outer'))).toEqual(expected.outer);
      }
      for (const [rider, expected] of riders) {
        expect(drawAndRead(plumeMesh(rider.root, side, 'Core'))).toEqual(expected.core);
      }
    }
    expect(drawAndRead(plumeMesh(a.root, 'L', 'Outer'))).toEqual(expectA.outer);
  });

  it('survives dismounts and remounts: only the rider geometry is disposed', () => {
    const shared = goblinRocketSledPlumeMaterials();
    let materialDisposals = 0;
    for (const material of [shared.outer, shared.core]) {
      material.addEventListener('dispose', () => materialDisposals++);
    }
    const first = ride();
    const geometryDisposals: string[] = [];
    for (const layer of LAYERS) {
      plumeMesh(first.root, 'L', layer).geometry.addEventListener('dispose', () =>
        geometryDisposals.push(layer),
      );
    }
    first.fx.dispose();
    expect(first.root.getObjectByName('GoblinRocketPlume_L')).toBeUndefined();
    expect(geometryDisposals.sort()).toEqual(['Core', 'Outer']);

    const again = ride();
    const third = ride();
    for (const { root } of [again, third]) {
      expect(plumeMesh(root, 'R', 'Outer').material).toBe(shared.outer);
      expect(plumeMesh(root, 'R', 'Core').material).toBe(shared.core);
    }
    again.fx.dispose();
    third.fx.dispose();
    expect(goblinRocketSledPlumeMaterials()).toBe(shared);
    expect(materialDisposals).toBe(0);
  });

  it('has no plume without both authored exhaust sockets', () => {
    const root = sledRoot();
    root.remove(root.children[1]);
    expect(GoblinRocketSledFx.create(root)).toBeNull();
  });
});

describe('the shared pair on both tiers', () => {
  const capabilities: GfxCapabilities = Object.freeze({
    deviceMemory: 8,
    hardwareConcurrency: 12,
    maxTouchPoints: 0,
    coarsePointer: false,
    narrowViewport: false,
    gpuRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080)',
    nativeApp: false,
    tightMemory: false,
    platform: 'other',
    softwareRendering: false,
  });
  const preferences: GraphicsSettingsSnapshot = {
    graphicsPreset: 2,
    terrainDetail: 1,
    foliageDensity: 1,
    surfaceDetail: 1,
    effectsQuality: 1,
    shadowQuality: 1,
    antiAliasing: 1,
    bloomQuality: 1,
    ambientOcclusion: 1,
    viewDistance: 1,
    waterQuality: 1,
    characterDetail: 1,
    dynamicLights: 1,
    particleEffects: 1,
    ghostFade: 0,
  };
  let restore: GfxProfile | null = null;

  afterEach(() => {
    if (restore) activateGfxProfile(restore);
    restore = null;
    resetGoblinRocketSledProfileCaches();
  });

  const colours = () => {
    const { outer, core } = goblinRocketSledPlumeMaterials();
    const hex = (m: THREE.ShaderMaterial, name: string) =>
      (m.uniforms[name].value as THREE.Color).toArray();
    return {
      outer: hex(outer, 'uColor'),
      outerReverse: hex(outer, 'uReverseColor'),
      core: hex(core, 'uColor'),
      coreReverse: hex(core, 'uReverseColor'),
    };
  };
  const scaled = (color: number, gain: number) =>
    new THREE.Color(color).multiplyScalar(gain).toArray();

  it.each([
    ['ultra', true, 2.1, 2.6],
    ['low', false, 1, 1],
  ] as const)(
    'the %s tier builds its own HDR gain after the profile reset',
    (tier, composer, outerGain, coreGain) => {
      restore = getActiveGfxProfile();
      activateGfxProfile(resolveGfxProfile(capabilities, preferences, `?gfx=${tier}`));
      expect(GFX.composer, `${tier} premise`).toBe(composer);
      resetGoblinRocketSledProfileCaches();
      const built = goblinRocketSledPlumeMaterials();
      expect(colours()).toEqual({
        outer: scaled(0xff5a16, outerGain),
        outerReverse: scaled(0x70bfff, outerGain),
        core: scaled(0xffd36a, coreGain),
        coreReverse: scaled(0xedfbff, coreGain),
      });
      // A rider built now wears exactly this tier's pair.
      const { root } = ride();
      expect(plumeMesh(root, 'L', 'Outer').material).toBe(built.outer);
    },
  );

  it('a tier switch through the profile reset hands later riders the new tier pair', () => {
    restore = getActiveGfxProfile();
    activateGfxProfile(resolveGfxProfile(capabilities, preferences, '?gfx=ultra'));
    resetGoblinRocketSledProfileCaches();
    const ultra = goblinRocketSledPlumeMaterials();
    activateGfxProfile(resolveGfxProfile(capabilities, preferences, '?gfx=low'));
    resetGoblinRocketSledProfileCaches();
    const low = goblinRocketSledPlumeMaterials();
    expect(low).not.toBe(ultra);
    expect((low.outer.uniforms.uColor.value as THREE.Color).toArray()).toEqual(scaled(0xff5a16, 1));
    const { root } = ride();
    expect(plumeMesh(root, 'L', 'Outer').material).toBe(low.outer);
  });
});

describe('the shipped sled model', () => {
  it('carries both exhaust sockets the plume parents to', () => {
    const glb = readFileSync(
      new URL('../public/models/mounts/goblin_rocket_sled.glb', import.meta.url),
    );
    expect(glb.toString('latin1', 0, 4)).toBe('glTF');
    const jsonLength = glb.readUInt32LE(12);
    expect(glb.toString('latin1', 16, 20)).toBe('JSON');
    const json = JSON.parse(glb.toString('utf8', 20, 20 + jsonLength)) as {
      nodes?: { name?: string }[];
    };
    const names = new Set((json.nodes ?? []).map((node) => node.name));
    for (const side of SIDES) expect(names.has(`Socket_Exhaust_${side}`)).toBe(true);
  });
});
