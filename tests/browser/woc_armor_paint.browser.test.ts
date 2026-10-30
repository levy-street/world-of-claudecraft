// Real-WebGL pin for the painted WOC armour (woc_armor_paint_core.ts, woc_armor_paint.ts).
// The Node suite pins the GLSL TEXT; only a real driver can say the block preprocesses,
// compiles and links under every material class an armour file draws with (Standard,
// Physical for the KHR_materials_specular files, the Lambert rebuild of Low and iOS), with
// and without its maps, skinned and rigid, beside shadows and a point light. It also reads
// the treatment back: the painted key lifts an up-facing albedo and the cool shade darkens
// and cools a down-facing one by the SAME factors on Standard and on Lambert (the actor
// treatment never varies by tier), and every knob at zero draws the stock pixels exactly.

import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyWocArmorPaint,
  setWocArmorPaintSettingsForTest,
  WOC_ARMOR_PAINT_TAG,
} from '../../src/render/characters/woc_armor_paint';
import {
  WOC_ARMOR_PAINT_DEFAULTS,
  WOC_ARMOR_PAINT_OFF,
  WOC_ARMOR_SHADE_TINT,
  type WocArmorPaintSettings,
} from '../../src/render/characters/woc_armor_paint_core';

const SIZE = 8;

afterEach(() => {
  setWocArmorPaintSettingsForTest(WOC_ARMOR_PAINT_DEFAULTS);
});

function makeRenderer(errors: string[]): THREE.WebGLRenderer {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    errors.push(
      `${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vs)} ${gl.getShaderInfoLog(fs)}`,
    );
  };
  return renderer;
}

function texture(rgba: [number, number, number, number], srgb = false): THREE.DataTexture {
  const data = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) data.set(rgba, i * 4);
  const t = new THREE.DataTexture(data, 4, 4);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

type Kind = 'standard-maps' | 'standard-bare' | 'physical' | 'lambert-map' | 'lambert-bare';
const KINDS: readonly Kind[] = [
  'standard-maps',
  'standard-bare',
  'physical',
  'lambert-map',
  'lambert-bare',
];

/** An armour material of `kind` as the factory derives it, with the paint applied. */
function armour(kind: Kind): THREE.Material {
  const orm = texture([255, 110, 255, 255]);
  const maps = {
    map: texture([128, 128, 128, 255], true),
    normalMap: texture([128, 128, 255, 255]),
    metalnessMap: orm,
    roughnessMap: orm,
    aoMap: orm,
  };
  let material: THREE.Material;
  if (kind === 'standard-maps')
    material = new THREE.MeshStandardMaterial({ ...maps, metalness: 1 });
  else if (kind === 'standard-bare') material = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  else if (kind === 'physical') {
    material = new THREE.MeshPhysicalMaterial({ ...maps, metalness: 1, specularIntensity: 0.5 });
  } else if (kind === 'lambert-map') material = new THREE.MeshLambertMaterial({ map: maps.map });
  else material = new THREE.MeshLambertMaterial();
  material.side = THREE.DoubleSide;
  material.userData[WOC_ARMOR_PAINT_TAG] = true;
  applyWocArmorPaint(material, material);
  return material;
}

function skinnedBox(material: THREE.Material): THREE.SkinnedMesh {
  const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const count = geometry.attributes.position.count;
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0), 4),
  );
  geometry.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute(new Array(count).fill([1, 0, 0, 0]).flat(), 4),
  );
  const mesh = new THREE.SkinnedMesh(geometry, material);
  const bone = new THREE.Bone();
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  return mesh;
}

describe('the painted armour on a real WebGL context', () => {
  it('links under every material class, with and without maps, skinned and rigid', () => {
    const errors: string[] = [];
    const renderer = makeRenderer(errors);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdcefff, 0x465f39, 0.4));
    const sun = new THREE.DirectionalLight(0xffd99a, 3.5);
    sun.position.set(2, 6, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(64, 64);
    scene.add(sun);
    const point = new THREE.PointLight(0xff8844, 4, 6, 2);
    point.position.set(0, 1, 2);
    scene.add(point);
    KINDS.forEach((kind, i) => {
      const rigid = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), armour(kind));
      rigid.position.set((i - 2) * 0.7, 0.4, 0);
      rigid.castShadow = true;
      scene.add(rigid);
      const skinned = skinnedBox(armour(kind));
      skinned.position.set((i - 2) * 0.7, -0.4, 0);
      skinned.castShadow = true;
      scene.add(skinned);
    });
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 20);
    camera.position.set(0, 0, 5);
    renderer.render(scene, camera);
    // every armour program is a painted one (two shapes per kind: rigid and skinned)
    expect(renderer.info.programs?.length ?? 0).toBeGreaterThanOrEqual(KINDS.length * 2);
    renderer.dispose();
    expect(errors).toEqual([]);
  });
});

/** Linear RGB of a grey armour quad facing up (`up`) or down, seen square on, under an
 *  even white fill (so up and down receive the same light), drawn with `look`. */
function quadColour(
  renderer: THREE.WebGLRenderer,
  lambert: boolean,
  up: boolean,
  look: WocArmorPaintSettings | null,
): [number, number, number] {
  setWocArmorPaintSettingsForTest(look);
  const material = lambert
    ? new THREE.MeshLambertMaterial({ color: 0x808080 })
    : new THREE.MeshStandardMaterial({ color: 0x808080, metalness: 0, roughness: 1 });
  material.userData[WOC_ARMOR_PAINT_TAG] = true;
  applyWocArmorPaint(material, material);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 1));
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), material);
  quad.rotation.x = up ? -Math.PI / 2 : Math.PI / 2;
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.set(0, up ? 5 : -5, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.FloatType });
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const px = new Float32Array(4);
  renderer.readRenderTargetPixels(target, SIZE / 2, SIZE / 2, 1, 1, px);
  renderer.setRenderTarget(null);
  target.dispose();
  material.dispose();
  return [px[0], px[1], px[2]];
}

describe('the painted key and shade, read back', () => {
  // the brush is a noise and the saturation a no-op on grey: the read takes the key alone
  const KEY_AND_SHADE: WocArmorPaintSettings = { ...WOC_ARMOR_PAINT_DEFAULTS, brush: 0 };

  it('lifts an up-facing albedo and cools a down-facing one by the same factors on both classes', () => {
    const errors: string[] = [];
    const renderer = makeRenderer(errors);
    const ratios: Record<string, [number, number, number]> = {};
    for (const lambert of [false, true]) {
      for (const up of [true, false]) {
        const stock = quadColour(renderer, lambert, up, null);
        const painted = quadColour(renderer, lambert, up, KEY_AND_SHADE);
        expect(stock[0], `stock ${lambert} ${up}`).toBeGreaterThan(0.05);
        ratios[`${lambert ? 'lambert' : 'standard'}/${up ? 'up' : 'down'}`] = [
          painted[0] / stock[0],
          painted[1] / stock[1],
          painted[2] / stock[2],
        ];
      }
    }
    renderer.dispose();
    expect(errors).toEqual([]);
    const key = 1 + KEY_AND_SHADE.key;
    const shade = WOC_ARMOR_SHADE_TINT.map((t) => 1 + (t - 1) * KEY_AND_SHADE.shade);
    for (const cls of ['standard', 'lambert']) {
      for (const c of [0, 1, 2]) {
        expect(ratios[`${cls}/up`][c], `${cls} up ${c}`).toBeCloseTo(key, 2);
        expect(ratios[`${cls}/down`][c], `${cls} down ${c}`).toBeCloseTo(shade[c], 2);
      }
      // cooler: the shade keeps more blue than red
      expect(ratios[`${cls}/down`][2]).toBeGreaterThan(ratios[`${cls}/down`][0]);
    }
    // the same treatment on the Standard tiers and the Lambert ones
    for (const c of [0, 1, 2]) {
      expect(ratios['lambert/up'][c]).toBeCloseTo(ratios['standard/up'][c], 3);
      expect(ratios['lambert/down'][c]).toBeCloseTo(ratios['standard/down'][c], 3);
    }
  });

  it('draws the stock pixels exactly with every knob at zero', () => {
    const errors: string[] = [];
    const renderer = makeRenderer(errors);
    for (const lambert of [false, true]) {
      for (const up of [true, false]) {
        expect(quadColour(renderer, lambert, up, WOC_ARMOR_PAINT_OFF)).toEqual(
          quadColour(renderer, lambert, up, null),
        );
      }
    }
    renderer.dispose();
    expect(errors).toEqual([]);
  });
});
