// The woc-studio merge keeps the map editor, but every Studio change to how
// the BUILT-IN world draws is gated to authored maps (isBuiltinWorldActive).
// These pins exercise the gates through the real modules: the built-in world
// gets the release behaviour, an authored copy of it gets the Studio's.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBirds } from '../src/render/birds';
import {
  buildCampfireFlame,
  buildLegacyCampfireFlame,
  legacyCampfireFlameGeometry,
} from '../src/render/campfire_flame';
import { createTempleWaterMaterial } from '../src/render/dungeon_temple_water';
import { updateSceneryFlame } from '../src/render/scenery_flame';
import { UnderwaterView } from '../src/render/underwater';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';

const authored = (): void => setActiveWorldContent({ ...BUILTIN_WORLD });
const src = (file: string): string =>
  readFileSync(new URL(`../src/render/${file}`, import.meta.url), 'utf8');

afterEach(() => setActiveWorldContent(null));

describe('campfire flames', () => {
  it('the built-in world draws the release lathe and pumps it with the fast flicker', () => {
    const flame = buildLegacyCampfireFlame(legacyCampfireFlameGeometry(), {
      color: 0xffaa33,
      emissive: 0xff6600,
      emissiveIntensity: 1.4,
    });
    expect(flame.userData.legacyFlame).toBe(true);
    const mat = flame.material as THREE.MeshLambertMaterial;
    expect(mat).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(mat.opacity).toBe(0.92);
    expect(mat.color.getHex()).toBe(0xffaa33);
    expect((flame.geometry as THREE.LatheGeometry).parameters.segments).toBe(7);
    expect(flame.children).toHaveLength(0);

    const time = 1.3;
    const index = 2;
    flame.position.z = 10;
    updateSceneryFlame(flame, index, time, new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 900);
    const fast =
      0.85 + Math.sin(time * 9 + index * 2.4) * 0.12 + Math.sin(time * 23 + index) * 0.06;
    expect(flame.scale.x).toBeCloseTo(fast, 10);
    expect(flame.scale.y).toBeCloseTo(fast * (1 + Math.sin(time * 13 + index) * 0.12), 10);
  });

  it('the Studio shader flame keeps the slow breath', () => {
    const { flame } = buildCampfireFlame();
    flame.position.z = 10;
    const time = 1.3;
    updateSceneryFlame(flame, 2, time, new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 900);
    const slow = 0.97 + Math.sin(time * 1.7 + 2 * 2.4) * 0.035 + Math.sin(time * 4.1 + 2) * 0.02;
    expect(flame.scale.x).toBeCloseTo(slow, 10);
  });

  it('props.ts picks the release flame for the built-in world', () => {
    const props = src('props.ts');
    expect(props).toContain(
      'const legacyFlameGeo = builtInWorld ? legacyCampfireFlameGeometry() : null;',
    );
    expect(props.match(/buildLegacyCampfireFlame\(legacyFlameGeo/g)).toHaveLength(2);
  });
});

describe('ambient birds fly the release band in the built-in world', () => {
  function flockHeight(): number {
    const birds = buildBirds(1337);
    birds.update(0, 0, 0.016);
    const ys = birds.group.children.map((c) => c.getWorldPosition(new THREE.Vector3()).y);
    return ys.reduce((a, b) => a + b, 0) / ys.length;
  }

  it('built-in: 54 to 82 yards', () => {
    const y = flockHeight();
    expect(y).toBeGreaterThan(50);
    expect(y).toBeLessThan(86);
  });

  it('authored: the Studio band', () => {
    authored();
    const y = flockHeight();
    expect(y).toBeGreaterThan(155);
    expect(y).toBeLessThan(250);
  });
});

describe('underwater bubbles', () => {
  it('the built-in world compiles the release bubble pair without the size attribute', () => {
    const view = new UnderwaterView(false) as unknown as { bubbleMat: THREE.ShaderMaterial };
    expect(view.bubbleMat.vertexShader).not.toContain('aSize');
    expect(view.bubbleMat.vertexShader).toContain(
      'clamp(uSize * 40.0 / max(0.6, -mv.z), 1.5, 18.0)',
    );
    expect(view.bubbleMat.fragmentShader).not.toContain('pip');
  });

  it('an authored map gets the sized bubbles', () => {
    authored();
    const view = new UnderwaterView(false) as unknown as { bubbleMat: THREE.ShaderMaterial };
    expect(view.bubbleMat.vertexShader).toContain('attribute float aSize;');
  });
});

describe('terrain and far terrain compile the release shader in the built-in world', () => {
  const terrain = src('terrain.ts');

  it('resolves one authored flag per material and per terrain view', () => {
    expect(terrain).toContain('const authoredLook = !isBuiltinWorldActive();');
    expect(terrain).toContain('const cameraLod = !isBuiltinWorldActive();');
    expect(terrain).toContain(
      "isBuiltinWorldActive() ? 'Snow010A_Color.jpg' : 'Snow004_Color.jpg'",
    );
  });

  it('gates every Studio ground-look change on that flag', () => {
    expect(terrain).toContain(
      '...(authoredLook ? { side: THREE.DoubleSide, shadowSide: THREE.BackSide } : {}),',
    );
    expect(terrain).toContain("'vec3 wocTAN = vec3(0.0); vec2 wocTPlane = vWPos.xz;'");
    expect(terrain).toContain('const heightBlend = authoredLook');
    expect(terrain.match(/vec4 wocHW = vSplatR;\$\{heightBlend\}/g)).toHaveLength(2);
    expect(terrain).toContain('vec2(127.1, 311.7)) + cavH * 41.0) * 43758.5453);');
    // every compile-time variant is named in the program key
    expect(terrain).toContain('mat.customProgramCacheKey = () =>');
    expect(terrain).toContain('cameraLod && zoneBuildPool() !== null');
  });

  it('far terrain keeps the release discard on the shipped grid', () => {
    const far = src('far_terrain.ts');
    expect(far).toContain(
      "? 'void main() {\\n\\tif (distance(vFarXZ, uFarCut.xy) < uFarCut.z) discard;'",
    );
    expect(far).toContain('|far-grid:${shippedGrid ? 0 : 1}');
  });
});

describe('the temple water material moved out of dungeon.ts unchanged', () => {
  it('is a shared, fogged, depth-write-free caustic sheet', () => {
    const mat = createTempleWaterMaterial();
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.fog).toBe(true);
    expect(mat.uniforms.uShallow.value.getHex()).toBe(0x49c9bd);
    expect(mat.fragmentShader).toContain('float caust = smoothstep(0.5, 1.5, c * 0.5 + 0.7);');
  });
});
