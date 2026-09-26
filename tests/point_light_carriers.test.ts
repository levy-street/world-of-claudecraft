import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  attachPointLightCarriers,
  findStrayPointLights,
  hideBlackPointLights,
  isPointLightCarrier,
  PointLightCarriers,
} from '../src/render/point_light_carriers';
import {
  darkenPointLightCarriers,
  isLivePointLightSource,
  markPointLightSource,
  POINT_LIGHT_SOURCE_LAYER,
  POINT_LIGHT_SOURCE_MASK,
  packPointLightSources,
} from '../src/render/point_light_carriers_core';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { tsFilesUnder } from './helpers/ts_files_under';

const CAMERA_MASK = 1;

function source(color: number, intensity: number, at: [number, number, number]): THREE.PointLight {
  const light = new THREE.PointLight(color, intensity, 9, 2);
  light.position.set(...at);
  return light;
}

function carriers(count: number): THREE.PointLight[] {
  return Array.from({ length: count }, () => {
    const carrier = new THREE.PointLight(0x000000, 0, 0, 2);
    carrier.matrixAutoUpdate = false;
    carrier.matrixWorldAutoUpdate = false;
    return carrier;
  });
}

function sceneWith(...lights: THREE.Object3D[]): THREE.Scene {
  const scene = new THREE.Scene();
  for (const light of lights) scene.add(light);
  for (const light of lights) markPointLightSource(light as THREE.PointLight);
  scene.updateMatrixWorld();
  return scene;
}

function pack(
  lists: readonly (readonly THREE.PointLight[])[],
  slots: THREE.PointLight[],
  scene: THREE.Object3D,
  mask = CAMERA_MASK,
): number {
  let cursor = 0;
  for (const list of lists) cursor = packPointLightSources(list, slots, cursor, scene, mask);
  darkenPointLightCarriers(slots, cursor);
  return cursor;
}

/** What three gathers for a render: visible lights on the camera's layers, in
 *  traversal order (projectObject, and the patched compile path). */
function gatheredPointLights(scene: THREE.Object3D, camera: THREE.Camera): THREE.PointLight[] {
  const out: THREE.PointLight[] = [];
  scene.traverseVisible((object) => {
    const light = object as THREE.PointLight;
    if (light.isPointLight && light.layers.test(camera.layers)) out.push(light);
  });
  return out;
}

function isBlack(light: THREE.PointLight): boolean {
  return (
    light.color.r * light.intensity === 0 &&
    light.color.g * light.intensity === 0 &&
    light.color.b * light.intensity === 0
  );
}

describe('point-light carrier packing core', () => {
  it('packs the live sources into the leading carriers, in source order, and blacks out the rest', () => {
    const a = source(0xff0000, 3, [1, 2, 3]);
    const dark = source(0x00ff00, 0, [4, 5, 6]);
    const b = source(0x0000ff, 5, [7, 8, 9]);
    const hidden = source(0xffffff, 4, [0, 0, 0]);
    hidden.visible = false;
    const c = source(0xffff00, 2, [-1, -2, -3]);
    const scene = sceneWith(a, dark, b, hidden, c);
    const slots = carriers(5);
    slots[4].color.setRGB(1, 1, 1);
    slots[4].intensity = 7;

    expect(
      pack(
        [
          [a, dark, b],
          [hidden, c],
        ],
        slots,
        scene,
      ),
    ).toBe(3);

    expect(slots.map((slot) => slot.intensity)).toEqual([3, 5, 2, 0, 0]);
    expect(slots[0].color.getHex()).toBe(0xff0000);
    expect(slots[1].color.getHex()).toBe(0x0000ff);
    expect(slots[2].color.getHex()).toBe(0xffff00);
    expect(slots[3].color.getHex()).toBe(0x000000);
    expect(slots[4].color.getHex()).toBe(0x000000);
    expect(slots.slice(0, 3).map((slot) => slot.matrixWorld.elements.slice(12, 15))).toEqual([
      [1, 2, 3],
      [7, 8, 9],
      [-1, -2, -3],
    ]);
  });

  it('copies distance and decay, which the attenuation reads', () => {
    const light = new THREE.PointLight(0xffffff, 6, 17.5, 1.6);
    const scene = sceneWith(light);
    const slots = carriers(2);
    pack([[light]], slots, scene);
    expect(slots[0].distance).toBe(17.5);
    expect(slots[0].decay).toBe(1.6);
  });

  it('never leaves a live carrier behind a black one, whatever the source order', () => {
    const lights = [0, 3, 0, 0, 6, 0, 2, 0, 0, 9].map((intensity, k) =>
      source(0xffffff, intensity, [k, 0, 0]),
    );
    const scene = sceneWith(...lights);
    const slots = carriers(10);
    expect(pack([lights], slots, scene)).toBe(4);
    const firstBlack = slots.findIndex(isBlack);
    expect(firstBlack).toBe(4);
    expect(slots.slice(firstBlack).every(isBlack)).toBe(true);
  });

  it('keeps the carrier count fixed and counts an overflow past it, first lists first', () => {
    const lights = [1, 2, 3, 4].map((k) => source(0xffffff, k, [k, 0, 0]));
    const scene = sceneWith(...lights);
    const slots = carriers(3);
    expect(pack([lights.slice(0, 2), lights.slice(2)], slots, scene)).toBe(4);
    expect(slots).toHaveLength(3);
    expect(slots.map((slot) => slot.intensity)).toEqual([1, 2, 3]);
  });

  it('keeps a slot for every pulse while the budget holds its share', () => {
    const budgeted = [1, 2, 3, 4, 5, 6].map((k) => source(0xffaa66, k, [k, 0, 0]));
    const pulses = [7, 8, 9, 10].map((k) => source(0x86c9ff, k, [0, k, 0]));
    const scene = sceneWith(...budgeted, ...pulses);
    const slots = carriers(budgeted.length + pulses.length);
    expect(pack([budgeted, [], pulses], slots, scene)).toBe(slots.length);
    expect(slots.slice(6).map((slot) => slot.intensity)).toEqual([7, 8, 9, 10]);
  });

  it('darkens a carrier the frame its source goes out', () => {
    const light = source(0xffffff, 4, [0, 0, 0]);
    const scene = sceneWith(light);
    const slots = carriers(2);
    expect(pack([[light]], slots, scene)).toBe(1);
    light.intensity = 0;
    expect(pack([[light]], slots, scene)).toBe(0);
    expect(slots.every(isBlack)).toBe(true);
    expect(slots[0].color.getHex()).toBe(0x000000);
  });

  describe('liveness is what three would have drawn', () => {
    it('needs the own visible flag', () => {
      const light = source(0xffffff, 4, [0, 0, 0]);
      const scene = sceneWith(light);
      expect(isLivePointLightSource(light, scene, CAMERA_MASK)).toBe(true);
      light.visible = false;
      expect(isLivePointLightSource(light, scene, CAMERA_MASK)).toBe(false);
    });

    it('needs every ancestor visible, the scene root included', () => {
      const outer = new THREE.Group();
      const inner = new THREE.Group();
      const light = source(0xffffff, 4, [0, 0, 0]);
      inner.add(light);
      outer.add(inner);
      const scene = sceneWith(outer);
      markPointLightSource(light);
      expect(isLivePointLightSource(light, scene, CAMERA_MASK)).toBe(true);
      outer.visible = false;
      expect(isLivePointLightSource(light, scene, CAMERA_MASK)).toBe(false);
      outer.visible = true;
      inner.visible = false;
      expect(isLivePointLightSource(light, scene, CAMERA_MASK)).toBe(false);
      inner.visible = true;
      scene.visible = false;
      expect(isLivePointLightSource(light, scene, CAMERA_MASK)).toBe(false);
    });

    it('needs the source attached under the rendered scene', () => {
      const scene = sceneWith();
      const detached = source(0xffffff, 4, [0, 0, 0]);
      markPointLightSource(detached);
      expect(isLivePointLightSource(detached, scene, CAMERA_MASK)).toBe(false);
      const elsewhere = new THREE.Scene();
      elsewhere.add(detached);
      expect(isLivePointLightSource(detached, scene, CAMERA_MASK)).toBe(false);
    });

    it('tests the layer the source had before it was moved off every camera', () => {
      const onDefault = source(0xffffff, 4, [0, 0, 0]);
      const onLayerThree = source(0xffffff, 4, [0, 0, 0]);
      onLayerThree.layers.set(3);
      const scene = sceneWith(onDefault, onLayerThree);
      expect(onDefault.layers.mask).toBe(POINT_LIGHT_SOURCE_MASK);
      expect(onLayerThree.layers.mask).toBe(POINT_LIGHT_SOURCE_MASK);
      expect(isLivePointLightSource(onDefault, scene, 1 << 0)).toBe(true);
      expect(isLivePointLightSource(onLayerThree, scene, 1 << 0)).toBe(false);
      expect(isLivePointLightSource(onLayerThree, scene, 1 << 3)).toBe(true);
      expect(isLivePointLightSource(onDefault, scene, 1 << 3)).toBe(false);
    });

    it('needs a colour uniform the shader cannot read as black', () => {
      const black = source(0x000000, 5, [0, 0, 0]);
      const off = source(0xffffff, 0, [0, 0, 0]);
      const flushable = source(0xffffff, 2 ** -130, [0, 0, 0]);
      const oneChannel = source(0x000100, 3, [0, 0, 0]);
      const scene = sceneWith(black, off, flushable, oneChannel);
      expect(isLivePointLightSource(black, scene, CAMERA_MASK)).toBe(false);
      expect(isLivePointLightSource(off, scene, CAMERA_MASK)).toBe(false);
      expect(isLivePointLightSource(flushable, scene, CAMERA_MASK)).toBe(false);
      expect(isLivePointLightSource(oneChannel, scene, CAMERA_MASK)).toBe(true);
    });
  });

  it('marks a source once, keeping the first recorded mask', () => {
    const light = source(0xffffff, 1, [0, 0, 0]);
    light.layers.set(2);
    markPointLightSource(light);
    markPointLightSource(light);
    expect(light.layers.mask).toBe(POINT_LIGHT_SOURCE_MASK);
    expect(light.layers.isEnabled(POINT_LIGHT_SOURCE_LAYER)).toBe(true);
    const camera = new THREE.PerspectiveCamera();
    const scene = sceneWith(light);
    expect(isLivePointLightSource(light, scene, camera.layers.mask)).toBe(false);
    expect(isLivePointLightSource(light, scene, 1 << 2)).toBe(true);
  });

  it("reuses the carriers' own objects on every pack", () => {
    const lights = [1, 0, 2].map((k) => source(0xffffff, k, [k, 0, 0]));
    const scene = sceneWith(...lights);
    const slots = carriers(4);
    const lists = [lights];
    pack(lists, slots, scene);
    const before = slots.map((slot) => [slot.color, slot.matrixWorld, slot.matrixWorld.elements]);
    pack(lists, slots, scene);
    const after = slots.map((slot) => [slot.color, slot.matrixWorld, slot.matrixWorld.elements]);
    for (let i = 0; i < after.length; i++) {
      for (let j = 0; j < after[i].length; j++) expect(after[i][j]).toBe(before[i][j]);
    }
  });
});

describe('the carriers in a three scene', () => {
  function world(count: number, sources: readonly THREE.PointLight[][]) {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const set = attachPointLightCarriers(
      scene,
      count,
      sources.map((list) => () => list),
    );
    return { scene, camera, set };
  }

  /** The steps three's render takes around the hook. */
  function render(scene: THREE.Scene, camera: THREE.Camera): THREE.PointLight[] {
    scene.updateMatrixWorld();
    scene.onBeforeRender(
      {} as THREE.WebGLRenderer,
      scene,
      camera,
      {} as THREE.BufferGeometry,
      {} as THREE.Material,
      {} as THREE.Group,
    );
    return gatheredPointLights(scene, camera);
  }

  it('adds exactly the pinned carriers, in order, and three gathers only them', () => {
    const fire = [source(0xffaa66, 8, [3, 1, 0]), source(0xffaa66, 0, [9, 1, 0])];
    const pulses = [source(0x86c9ff, 0, [0, 0, 0]), source(0x86c9ff, 6, [2, 2, 2])];
    const { scene, camera, set } = world(10, [fire, pulses]);
    for (const light of [...fire, ...pulses]) {
      markPointLightSource(light);
      scene.add(light);
    }

    const gathered = render(scene, camera);

    expect(set.lights).toHaveLength(10);
    expect(gathered).toEqual(set.lights);
    expect(scene.children.slice(0, 10)).toEqual(set.lights);
    expect(set.lights.every((carrier) => isPointLightCarrier(carrier))).toBe(true);
    expect(gathered.map((light) => light.intensity)).toEqual([8, 6, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(findStrayPointLights(scene, camera)).toEqual([]);
  });

  it('draws a moving source where it is on the frame being rendered', () => {
    const rig = new THREE.Group();
    const lamp = source(0xffcc88, 3, [0, 1, 0]);
    rig.add(lamp);
    const { scene, camera, set } = world(2, [[lamp]]);
    markPointLightSource(lamp);
    scene.add(rig);
    render(scene, camera);
    expect(set.lights[0].matrixWorld.elements.slice(12, 15)).toEqual([0, 1, 0]);

    rig.position.set(5, 0, -2);
    render(scene, camera);
    expect(set.lights[0].matrixWorld.elements.slice(12, 15)).toEqual([5, 1, -2]);
    // three's own update pass must not overwrite the packed position.
    scene.updateMatrixWorld(true);
    expect(set.lights[0].matrixWorld.elements.slice(12, 15)).toEqual([5, 1, -2]);
  });

  it('keeps any hook the scene already had', () => {
    const scene = new THREE.Scene();
    const earlier = vi.fn();
    scene.onBeforeRender = earlier;
    attachPointLightCarriers(scene, 1, []);
    const camera = new THREE.PerspectiveCamera();
    scene.onBeforeRender(
      {} as THREE.WebGLRenderer,
      scene,
      camera,
      {} as THREE.BufferGeometry,
      {} as THREE.Material,
      {} as THREE.Group,
    );
    expect(earlier).toHaveBeenCalledTimes(1);
  });

  it('names a point light three would gather beside the carriers', () => {
    const { scene, camera, set } = world(2, []);
    const stray = source(0xffffff, 1, [0, 0, 0]);
    const marked = source(0xffffff, 1, [0, 0, 0]);
    markPointLightSource(marked);
    scene.add(stray, marked);
    expect(findStrayPointLights(scene, camera)).toEqual([stray]);
    expect(gatheredPointLights(scene, camera)).toEqual([...set.lights, stray]);
  });

  it('a constructed set packs without a hook, for callers that render by hand', () => {
    const scene = new THREE.Scene();
    const light = source(0xffffff, 2, [1, 1, 1]);
    const set = new PointLightCarriers(scene, 3, [() => [light]]);
    markPointLightSource(light);
    scene.add(light);
    scene.updateMatrixWorld();
    expect(set.pack(scene, new THREE.PerspectiveCamera())).toBe(1);
    expect(set.lights.map((carrier) => carrier.intensity)).toEqual([2, 0, 0]);
  });
});

describe('the DEV audit of the world scene', () => {
  function renderOnce(scene: THREE.Scene, camera: THREE.Camera): void {
    scene.updateMatrixWorld();
    scene.onBeforeRender(
      {} as THREE.WebGLRenderer,
      scene,
      camera,
      {} as THREE.BufferGeometry,
      {} as THREE.Material,
      {} as THREE.Group,
    );
  }

  it('reports a stray, a doubly listed source and a shadow caster, once each', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const twice = source(0xffffff, 2, [0, 0, 0]);
    const caster = source(0xffffff, 2, [0, 0, 0]);
    caster.castShadow = true;
    const set = attachPointLightCarriers(scene, 4, [() => [twice, caster], () => [twice]]);
    for (const light of [twice, caster]) {
      markPointLightSource(light);
      scene.add(light);
    }
    const lamp = source(0xffffff, 3, [0, 0, 0]);
    lamp.name = 'glb-lamp';
    const prop = new THREE.Group();
    prop.name = 'stray-prop';
    prop.add(lamp);
    scene.add(prop);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const reports = set.audit(scene, camera);
      expect(reports).toHaveLength(3);
      expect(reports[0]).toContain('glb-lamp < stray-prop < Scene');
      expect(reports.some((report) => report.includes('listed twice'))).toBe(true);
      expect(reports.some((report) => report.includes('casts a shadow'))).toBe(true);
      expect(errors).toHaveBeenCalledTimes(3);
      expect(set.audit(scene, camera)).toEqual([]);
      expect(errors).toHaveBeenCalledTimes(3);
    } finally {
      errors.mockRestore();
    }
  });

  it('costs nothing in a production build: the whole audit sits behind the DEV flag', () => {
    const carriers = sourceOf('render/point_light_carriers.ts');
    expect(carriers).toContain('if (import.meta.env.DEV) this.devChecks(scene, camera, cursor);');
    expect(carriers.split('this.devChecks(')).toHaveLength(2);
    expect(carriers.split('this.audit(')).toHaveLength(2);
  });

  it('runs on a registry change, at most every few seconds, never on a steady frame', () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const fire: THREE.PointLight[] = [];
    const set = attachPointLightCarriers(scene, 2, [() => fire]);
    const audit = vi.spyOn(set, 'audit').mockReturnValue([]);
    let now = 1000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      renderOnce(scene, camera);
      expect(audit).toHaveBeenCalledTimes(1);
      now += 60_000;
      renderOnce(scene, camera);
      expect(audit).toHaveBeenCalledTimes(1);

      fire.push(source(0xffffff, 0, [0, 0, 0]));
      now += 1000;
      renderOnce(scene, camera);
      expect(audit).toHaveBeenCalledTimes(2);

      fire.push(source(0xffffff, 0, [0, 0, 0]));
      now += 1000;
      renderOnce(scene, camera);
      expect(audit).toHaveBeenCalledTimes(2);
      now += 5000;
      renderOnce(scene, camera);
      expect(audit).toHaveBeenCalledTimes(3);
    } finally {
      clock.mockRestore();
    }
  });
});

describe('a one-shot scene without carriers', () => {
  it('hides only its black point lights, so none can stand in front of a live one', () => {
    const model = new THREE.Group();
    const off = source(0xffffff, 0, [0, 0, 0]);
    const black = source(0x000000, 3, [0, 0, 0]);
    const live = source(0xffaa00, 2, [0, 0, 0]);
    model.add(off, black, live);
    hideBlackPointLights(model);
    expect([off.visible, black.visible, live.visible]).toEqual([false, false, true]);
  });
});

// Every point light that can reach a scene the patched chunk draws, and the
// route by which it stays out of three's light array (or is provably live).
// The world scene's registries: `fireLights` (budget-ranked static lights,
// marked on adoption and on every rank rebuild), `viewLights` (marked when an
// entity view is reconciled, or when an fx or a placed GLB registers), and the
// pulses. A new producer is a light three would gather in its traversal slot,
// after a black carrier the lit programs have already stopped at. This scan
// sees constructors only: a glTF punctual light is built inside three's loader,
// which tests/glb_punctual_lights.test.ts covers for every shipped GLB.
const POINT_LIGHT_PRODUCERS: Readonly<Record<string, string>> = {
  'render/battleground.ts':
    'field lights, born hidden, handed to the fireLights registry through the battleground host',
  'render/battleground_props.ts':
    'rune pad light inside the battleground entity view body, a view light marked on reconcile',
  'render/battleground_rune_vfx.ts':
    'rune kit light inside the battleground entity view body, a view light marked on reconcile',
  'render/camp_braziers.ts':
    'zone feature glowLights, lifted to the scene root and adopted into fireLights by attachZoneFeature',
  'render/dawnhold_features.ts':
    'zone feature glowLights, lifted to the scene root and adopted into fireLights by attachZoneFeature',
  'render/delve_props.ts':
    'delve interactable lights inside the entity view body, view lights marked on reconcile',
  'render/dungeon.ts':
    'interior torches pushed through the fireLights adopter sink the interiors are handed',
  'render/dungeon_torch_rig.ts':
    'interior torch rig lights pushed through the fireLights adopter sink the interiors are handed',
  'render/ember_features.ts':
    'zone feature glowLights, lifted to the scene root and adopted into fireLights by attachZoneFeature',
  'render/gale_features.ts':
    'zone feature glowLights, lifted to the scene root and adopted into fireLights by attachZoneFeature',
  'render/haunt_features.ts':
    'zone feature glowLights, lifted to the scene root and adopted into fireLights by attachZoneFeature',
  'render/ignivar_fire_vfx.ts':
    'Ignivar flame light on the model bone inside the entity view, a view light marked on reconcile',
  'render/ignivar_model_vfx.ts':
    'Ignivar fallback shoulder and chest lights inside the entity view, view lights marked on reconcile',
  'render/impact_site.ts':
    'the impact-site light, pushed into fireLights before the constructor mass hide',
  'render/jail_scene.ts':
    'the moderator gate glow, lifted to the scene root and adopted into fireLights',
  'render/light_pulses.ts':
    'the pulse pool, marked at birth and listed as a carrier source; its size is part of the carrier count',
  'render/mount_lamps.ts':
    'mount lamps on the mount bones, born hidden and dark, view lights marked on reconcile',
  'render/night_features.ts':
    'zone feature glowLights, lifted to the scene root and adopted into fireLights by attachZoneFeature',
  'render/point_light_carriers.ts': 'the carriers themselves, the only lights three gathers',
  'render/props.ts':
    'campfire and prop fire lights, the seed of the fireLights registry, mass hidden in the constructor',
  'render/quest_objects.ts':
    'the ground-object glow inside the entity view body, a view light marked on reconcile',
  'render/realm_flora.ts':
    'zone feature glowLights, lifted to the scene root and adopted into fireLights by attachZoneFeature',
  'render/soulwell.ts':
    'the soulwell glow inside the entity view body, a view light marked on reconcile',
  'render/stations.ts': 'the crafting-station fire light, adopted into fireLights at construction',
  'render/warlock_meteor_fx.ts':
    'fall and impact lights handed to registerBudgetPointLight, born hidden, marked on the rank rebuild',
  'render/weapon_vfx.ts':
    'weapon-skin light: in the world a hidden view light marked on reconcile; in a preview canvas the only point lights of that scene, all driven live together',
  'render/wildheart_props.ts':
    'the Wildheart fire light, pushed through the fireLights adopter sink the interiors are handed',
  'render/wyrmwatch_harbor_house.ts':
    'the Harbormaster House hearth and lantern lights, pushed into the props fireLights by buildProps and mass hidden with them',
  'render/yumi_maze.ts': 'maze brazier lights pushed through the fireLights adopter sink',
};

const SRC_ROOT = fileURLToPath(new URL('../src', import.meta.url));
const POINT_LIGHT_PATTERN = /new\s+(?:THREE\.)?PointLight\s*\(/;

function sourceOf(relative: string): string {
  return codeWithoutLineComments(
    readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8'),
  );
}

describe('every point-light producer is a carrier source', () => {
  it('constructs a point light only in files whose route to a carrier is known', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
    const files = tsFilesUnder(SRC_ROOT);
    expect(files.length).toBeGreaterThan(1500);
    const producers = files
      .filter(({ full }) =>
        POINT_LIGHT_PATTERN.test(codeWithoutLineComments(readFileSync(full, 'utf8'))),
      )
      .map(({ file }) => file)
      .sort();
    expect(
      producers,
      'a new THREE.PointLight producer: three gathers it in its traversal slot, after a black carrier the lit programs already stopped at. Route it into a carrier source list (fireLights adopter, a reconciled entity view, registerBudgetPointLight) and add its row here',
    ).toEqual(Object.keys(POINT_LIGHT_PRODUCERS).sort());
    for (const [file, reason] of Object.entries(POINT_LIGHT_PRODUCERS)) {
      expect(reason.length, `${file} needs a real reason`).toBeGreaterThan(40);
    }
  });

  it('detects both spellings of the constructor (positive control)', () => {
    expect(POINT_LIGHT_PATTERN.test('const l = new THREE.PointLight(0xffffff, 2);')).toBe(true);
    expect(POINT_LIGHT_PATTERN.test('const l = new  PointLight (0xffffff);')).toBe(true);
    expect(POINT_LIGHT_PATTERN.test('const l = light as THREE.PointLight;')).toBe(false);
  });

  it('wires the world scene: the pinned count, the source lists in order, and one scene hook', () => {
    const renderer = sourceOf('render/renderer.ts');
    const start = renderer.indexOf('attachPointLightCarriers(this.scene, ');
    expect(start, 'the carriers attach moved; re-anchor this pin').toBeGreaterThan(-1);
    const call = renderer.slice(start, renderer.indexOf(']);', start));
    expect(call).toContain('GFX.maxPointLights + lightPulsePoolSize()');
    // Order is the overflow priority: the budget caps fire plus view lights at
    // GFX.maxPointLights, which is what keeps a slot for every pulse.
    const order = [
      '() => this.fireLights,',
      '() => this.viewLights,',
      '() => this.lightPulses?.lights ?? NO_POINT_LIGHTS,',
    ].map((entry) => call.indexOf(entry));
    expect(order.every((at, k) => at > -1 && (k === 0 || at > order[k - 1]))).toBe(true);
    expect(call.split('() =>')).toHaveLength(4);
    expect(renderer.split('attachPointLightCarriers(')).toHaveLength(2);
    expect(renderer).not.toContain('lightPads');

    // Any other assignment of a scene's hook replaces the pack without a
    // word: the carriers freeze on their last state. Every onBeforeRender
    // write in src is listed with its receiver, and none is a scene but ours.
    const hooks: string[] = [];
    for (const { file, full } of tsFilesUnder(SRC_ROOT)) {
      const code = codeWithoutLineComments(readFileSync(full, 'utf8'));
      for (const match of code.matchAll(/([\w.\][]+)\.onBeforeRender\s*=(?!=)/g)) {
        hooks.push(`${file}: ${match[1]}`);
      }
      if (/\[\s*['"]onBeforeRender['"]\s*\]\s*=|onBeforeRender\s*:/.test(code)) {
        hooks.push(`${file}: indirect`);
      }
      if (/extends\s+(?:THREE\.)?Scene\b/.test(code)) hooks.push(`${file}: Scene subclass`);
    }
    expect([...new Set(hooks)].sort()).toEqual([
      'render/ability_vfx/decals.ts: mesh',
      'render/ability_vfx/decals.ts: slot.mesh',
      'render/ability_vfx/flipbooks.ts: mesh',
      'render/ability_vfx/ground_auras.ts: mesh',
      'render/ability_vfx/ground_auras.ts: slot.mesh',
      'render/ability_vfx/rings.ts: mesh',
      'render/ability_vfx/rings.ts: slot.mesh',
      'render/gather_nodes.ts: target',
      'render/goblin_rocket_sled_fx.ts: inner',
      'render/goblin_rocket_sled_fx.ts: outer',
      'render/jail_scene.ts: swirl',
      'render/point_light_carriers.ts: scene',
      'render/scene_sampling.ts: this.sentinel',
    ]);

    expect(sourceOf('render/light_pulses.ts')).toContain('markPointLightSource(light);');
    expect(sourceOf('render/placed_assets.ts')).toContain('this.lights.register(light);');
    expect(sourceOf('editor/asset_thumbs.ts')).toContain('hideBlackPointLights(model);');
  });

  it('never lets a camera reach the source layer', () => {
    // Cameras keep three's default mask. A layer call anywhere could enable
    // the source layer on one and gather every source beside the carriers.
    const layerCalls: string[] = [];
    const maskWrites: string[] = [];
    for (const { file, full } of tsFilesUnder(SRC_ROOT)) {
      const code = codeWithoutLineComments(readFileSync(full, 'utf8'));
      if (/\.layers\.(?:set|enable|enableAll|toggle|copy)\s*\(/.test(code)) layerCalls.push(file);
      if (/\.layers\.mask\s*[|&^]?=(?!=)/.test(code)) maskWrites.push(file);
    }
    expect(layerCalls).toEqual([]);
    expect(maskWrites.sort()).toEqual([
      'render/characters/makeup.ts',
      'render/characters/rig_merge.ts',
      'render/characters/stubble.ts',
      'render/gather_nodes.ts',
      'render/point_light_carriers_core.ts',
    ]);
  });
});

describe('the three render order the carriers rely on', () => {
  // The pack runs in scene.onBeforeRender: after three's own matrix update, so
  // a moving source is read where this render draws it, and before three
  // gathers lights. And a carrier's packed matrixWorld survives the update
  // only while three gates the compose on matrixWorldAutoUpdate.
  it('updates world matrices, then calls the scene hook, then gathers lights', () => {
    const build = readFileSync(
      new URL('../node_modules/three/build/three.module.js', import.meta.url),
      'utf8',
    );
    const update = build.indexOf(
      'if ( scene.matrixWorldAutoUpdate === true ) scene.updateMatrixWorld();',
    );
    const hook = build.indexOf(
      'scene.onBeforeRender( _this, scene, camera, _currentRenderTarget );',
    );
    const gather = build.indexOf('projectObject( scene, camera, 0, _this.sortObjects );');
    expect(update).toBeGreaterThan(-1);
    expect(hook).toBeGreaterThan(update);
    expect(gather).toBeGreaterThan(hook);
    const core = readFileSync(
      new URL('../node_modules/three/build/three.core.js', import.meta.url),
      'utf8',
    );
    expect(core).toContain('if ( this.matrixWorldAutoUpdate === true ) {');
  });
});
