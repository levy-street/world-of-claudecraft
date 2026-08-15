import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureNightLightField,
  nightLightStaticCount,
  resetNightLightFieldForTest,
} from '../src/render/night_light_field';
import {
  LIGHT_SOCKET_NODE,
  prepareStreetlampAsset,
  STREETLAMP_ASSET_DEFS,
  streetlampPreloadInternalsForTest,
} from '../src/render/streetlamp_assets';
import { LAMP_GLASS_MATERIAL, LAMP_SOURCE_MATERIAL } from '../src/render/streetlamp_emissive';
import {
  buildLampFixtureGeometry,
  buildLampGlassGeometry,
  buildStreetlamps,
  LAMP_SCALE,
} from '../src/render/streetlamps';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { LAMP_LIGHT_AXIS_MIN } from '../src/sim/streetlamp_layout';
import { roadDistance } from '../src/sim/world';

afterEach(() => {
  setActiveWorldContent(null);
  resetNightLightFieldForTest();
  streetlampPreloadInternalsForTest.reset();
});

// The lamp fixture is five primitives merged into one instanced draw.
// mergeGeometries returns NULL for a mixed indexed/non-indexed set (Three's
// polyhedra come back non-indexed while the lathe primitives are indexed), and
// the builder turns that into a throw, which fails the whole scene build at
// boot. That is exactly the kind of break a unit test should catch instead of a
// screenshot run, so the merge is pinned here.

describe('the streetlamp fixture geometry', () => {
  it('merges into a single indexed draw', () => {
    const geo = buildLampFixtureGeometry();
    expect(geo).toBeInstanceOf(THREE.BufferGeometry);
    expect(geo.getAttribute('position').count).toBeGreaterThan(0);
    expect(geo.getIndex()).not.toBeNull();
    // one merged part, so one instanced draw per zone rather than five
    expect(geo.groups).toHaveLength(0);
    geo.dispose();
  });

  it('is scaled half again over the original build', () => {
    expect(LAMP_SCALE).toBe(1.5);
  });

  it('stands on the ground and reaches streetlamp height', () => {
    const geo = buildLampFixtureGeometry();
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (!box) throw new Error('lamp fixture has no bounding box');
    // Local origin is the post's foot, so the fixture must not sink below it.
    expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
    // The pre-scale fixture stood between 3 and 4.5 yd; the whole piece is now
    // blown up by LAMP_SCALE, twice a character but short of a building eave.
    expect(box.max.y).toBeGreaterThan(3 * LAMP_SCALE);
    expect(box.max.y).toBeLessThan(4.5 * LAMP_SCALE);
    // and slim: a post, not a pillar
    expect(box.max.x - box.min.x).toBeLessThan(1 * LAMP_SCALE);
    geo.dispose();
  });

  it('hangs the glass inside the housing, not beside it', () => {
    const fixture = buildLampFixtureGeometry();
    const glass = buildLampGlassGeometry();
    fixture.computeBoundingBox();
    glass.computeBoundingBox();
    const fixtureBox = fixture.boundingBox;
    const glassBox = glass.boundingBox;
    if (!fixtureBox || !glassBox) throw new Error('lamp geometry has no bounding box');
    // the lit glass sits up in the lantern head, above the post
    expect(glassBox.min.y).toBeGreaterThan(fixtureBox.max.y * 0.7);
    expect(glassBox.max.y).toBeLessThan(fixtureBox.max.y);
    // and on the post's axis
    expect(Math.abs(glassBox.min.x + glassBox.max.x) / 2).toBeLessThan(0.01);
    fixture.dispose();
    glass.dispose();
  });
});

describe('streetlamp GLB preparation', () => {
  it('clones, floor-seats, centers, height-normalizes, and footprint-bounds a source', () => {
    const source = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(4, 10, 3),
      new THREE.MeshStandardMaterial({ color: 0x884422, name: 'housing' }),
    );
    mesh.position.set(3, 7, -2);
    source.add(mesh);
    const originalPosition = mesh.position.clone();

    const asset = prepareStreetlampAsset('eastbrook_civic', source);
    const bounds = new THREE.Box3();
    for (const part of asset.parts) {
      part.geometry.computeBoundingBox();
      if (part.geometry.boundingBox) bounds.union(part.geometry.boundingBox);
    }

    expect(mesh.position).toEqual(originalPosition);
    // Housing binds no emitter: only the authored LAMP_* materials ever glow.
    expect(asset.glowStates).toHaveLength(0);
    expect(bounds.min.y).toBeCloseTo(0, 6);
    expect(asset.height).toBeCloseTo(5.5, 6);
    expect((bounds.min.x + bounds.max.x) * 0.5).toBeCloseTo(0, 6);
    expect((bounds.min.z + bounds.max.z) * 0.5).toBeCloseTo(0, 6);
    expect(asset.width).toBeLessThanOrEqual(streetlampPreloadInternalsForTest.maxFootprint);
    expect(asset.depth).toBeLessThanOrEqual(streetlampPreloadInternalsForTest.maxFootprint);
  });

  it('carries the authored LIGHT_SOCKET through the same normalization as the geometry', () => {
    // A hanging lantern: the fixture is 10 tall and offset in the source's own
    // space, and its socket sits off-axis inside the lantern head. After
    // normalization the socket must still be at the head, not at the post foot,
    // or the lamp lights the ground beside itself.
    const source = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(4, 10, 3),
      new THREE.MeshStandardMaterial({ name: 'housing' }),
    );
    mesh.position.set(3, 7, -2);
    source.add(mesh);
    // Source-space bounds are x [1,5], y [2,12], z [-3.5,-0.5]; put the socket
    // three quarters up the fixture and off its centre line.
    const socket = new THREE.Object3D();
    socket.name = LIGHT_SOCKET_NODE;
    socket.position.set(4, 9.5, -1);
    source.add(socket);

    const asset = prepareStreetlampAsset('eastbrook_civic', source);
    // The socket must take the fixture's EXACT transform, including the radial
    // footprint clamp: height normalization alone would leave it off-centre on
    // any model wide enough to be squeezed.
    const uniformScale = 5.5 / 10;
    const radialScale = Math.min(
      1,
      streetlampPreloadInternalsForTest.maxFootprint / (4 * uniformScale),
    );
    expect(radialScale, 'this fixture is wide enough to be clamped').toBeLessThan(1);
    expect(asset.socket[0]).toBeCloseTo((4 - 3) * uniformScale * radialScale, 6);
    expect(asset.socket[1]).toBeCloseTo((9.5 - 2) * uniformScale, 6);
    expect(asset.socket[2]).toBeCloseTo((-1 - -2) * uniformScale * radialScale, 6);
    // and it lands inside the normalized fixture, near its head
    expect(asset.socket[1]).toBeGreaterThan(asset.height * 0.7);
    expect(asset.socket[1]).toBeLessThan(asset.height);
  });

  it('measures the light axis from the foot of the post to the socket', () => {
    // A hanging lantern: a 10 tall post at the source origin with its head out
    // on a +x arm. The axis is what says "the light hangs off THIS edge", so it
    // must run foot to socket, not centre to socket: the whole fixture is
    // centred on its own bounds, which puts the post itself off to one side.
    const source = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(1, 10, 1), new THREE.MeshStandardMaterial());
    post.position.y = 5;
    const head = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    head.position.set(3, 9, 0);
    const socket = new THREE.Object3D();
    socket.name = LIGHT_SOCKET_NODE;
    socket.position.set(3, 9, 0);
    source.add(post, head, socket);

    const asset = prepareStreetlampAsset('eastbrook_civic', source);
    // source bounds x [-0.5, 3.5] -> centre 1.5, height 10 -> scale 5.5/10,
    // and the 4-wide footprint is squeezed to the 2 yd cap on top of that
    const scale = (5.5 / 10) * (streetlampPreloadInternalsForTest.maxFootprint / (4 * (5.5 / 10)));
    expect(asset.socket[0]).toBeCloseTo(1.5 * scale, 6);
    // foot is the post, a full arm's length back from the socket
    expect(asset.lightAxis[0]).toBeCloseTo(3 * scale, 6);
    expect(asset.lightAxis[1]).toBeCloseTo(0, 6);
  });

  it('reads no light axis for a lantern carried straight above its post', () => {
    const source = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(1, 10, 1), new THREE.MeshStandardMaterial());
    post.position.y = 5;
    const socket = new THREE.Object3D();
    socket.name = LIGHT_SOCKET_NODE;
    socket.position.set(0, 9.5, 0);
    source.add(post, socket);

    const asset = prepareStreetlampAsset('eastbrook_civic', source);
    expect(Math.hypot(asset.lightAxis[0], asset.lightAxis[1])).toBeLessThan(LAMP_LIGHT_AXIS_MIN);
  });

  it('falls back to the def anchor when a model carries no socket', () => {
    const source = new THREE.Group();
    source.add(new THREE.Mesh(new THREE.BoxGeometry(1, 5.5, 1), new THREE.MeshStandardMaterial()));
    const asset = prepareStreetlampAsset('eastbrook_civic', source);
    expect([...asset.socket]).toEqual([...STREETLAMP_ASSET_DEFS.eastbrook_civic.lightOffset]);
  });

  it('preserves authored transparency, alpha, sidedness and emissive on the pane', () => {
    const source = new THREE.Group();
    const glassMat = new THREE.MeshStandardMaterial({
      name: LAMP_GLASS_MATERIAL,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      emissive: new THREE.Color(0.31, 0.2, 0.09),
      emissiveIntensity: 1,
    });
    const sourceMat = new THREE.MeshStandardMaterial({
      name: LAMP_SOURCE_MATERIAL,
      emissive: new THREE.Color(0.74, 0.49, 0.21),
      emissiveIntensity: 1,
    });
    const housingMat = new THREE.MeshStandardMaterial({ name: 'housing' });
    for (const material of [glassMat, sourceMat, housingMat]) {
      source.add(new THREE.Mesh(new THREE.BoxGeometry(1, 5.5, 1), material));
    }

    const asset = prepareStreetlampAsset('eastbrook_civic', source);
    const byName = new Map(
      asset.parts.map((part) => {
        const material = part.material as THREE.MeshStandardMaterial;
        return [material.name, material];
      }),
    );
    const glass = byName.get(`streetlamp:${LAMP_GLASS_MATERIAL}`);
    const emitter = byName.get(`streetlamp:${LAMP_SOURCE_MATERIAL}`);
    const housing = byName.get('streetlamp:housing');
    if (!glass || !emitter || !housing) throw new Error('converted materials missing');

    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBeCloseTo(0.55, 6);
    expect(glass.side).toBe(THREE.DoubleSide);
    // A blended pane must not write depth, or it hides the emitter behind it.
    expect(glass.depthWrite).toBe(false);
    expect(glass.emissive.getHex()).toBe(glassMat.emissive.getHex());
    expect(emitter.emissive.getHex()).toBe(sourceMat.emissive.getHex());
    // The opaque emitter keeps writing depth.
    expect(emitter.transparent).toBe(false);
    expect(emitter.depthWrite).toBe(true);

    // Both authored roles bind; the housing never does.
    expect(asset.glowStates).toHaveLength(2);
    expect(glass.emissiveIntensity).toBe(0);
    expect(emitter.emissiveIntensity).toBe(0);
    expect(housing.emissiveIntensity).toBe(1);
  });

  it('expands meshopt-style normalized integer positions before scaling the model', () => {
    const source = new THREE.Group();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const positions = geometry.getAttribute('position');
    const quantized = new Int16Array(positions.count * positions.itemSize);
    for (let index = 0; index < positions.count; index++) {
      for (let component = 0; component < positions.itemSize; component++) {
        quantized[index * positions.itemSize + component] = Math.round(
          positions.getComponent(index, component) * 32_767,
        );
      }
    }
    geometry.setAttribute('position', new THREE.Int16BufferAttribute(quantized, 3, true));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    mesh.position.y = 0.5;
    source.add(mesh);

    const asset = prepareStreetlampAsset('eastbrook_civic', source);
    expect(asset.height).toBeCloseTo(5.5, 3);
    expect(asset.parts[0].geometry.getAttribute('position').array).toBeInstanceOf(Float32Array);
  });

  it('builds one instanced model body per planned site and preserves the light registry', () => {
    ensureNightLightField();
    for (const style of Object.keys(streetlampPreloadInternalsForTest.assetDefs)) {
      const source = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 5.5, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x555555 }),
      );
      body.position.y = 2.75;
      source.add(body);
      streetlampPreloadInternalsForTest.installSource(
        style as keyof typeof streetlampPreloadInternalsForTest.assetDefs,
        source,
      );
    }

    const view = buildStreetlamps(0);
    let bodyInstances = 0;
    let emitterInstances = 0;
    view.group.traverse((object) => {
      if (!(object instanceof THREE.InstancedMesh)) return;
      if (object.userData.streetlampRole === 'body') bodyInstances += object.count;
      if (object.userData.streetlampRole === 'emitter') emitterInstances += object.count;
    });

    expect(bodyInstances).toBe(nightLightStaticCount());
    // Loaded Tripo lamps already author their glass, flame, crystal, or flower.
    // Runtime geometry over that source either clips through the housing or
    // blooms as a second fixture, so only the fallback lane may add an emitter.
    expect(emitterInstances).toBe(0);
    expect(bodyInstances).toBeGreaterThan(200);
    // A stride-selected PointLight made identical fixtures render at radically
    // different brightness. Every lamp now uses the authored emissive plus the
    // every-site terrain field and draped pool instead.
    expect(view.glowLights).toHaveLength(0);
    expect(view.cullGroups.length).toBeGreaterThan(10);
  });

  it('hangs every fixture with its light over the road and its base outside', () => {
    // The end-to-end claim, on the real road network: a lamp with its light out
    // on an arm must be instanced turned so the ARM crosses the track and the
    // POST is left standing on the verge. Anything less and a hanging lantern
    // lights the field beside the road half the time.
    ensureNightLightField();
    const source = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(1, 10, 1), new THREE.MeshStandardMaterial());
    post.position.y = 5;
    const head = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    head.position.set(3, 9, 0);
    const socketNode = new THREE.Object3D();
    socketNode.name = LIGHT_SOCKET_NODE;
    socketNode.position.set(3, 9, 0);
    source.add(post, head, socketNode);
    for (const style of Object.keys(streetlampPreloadInternalsForTest.assetDefs)) {
      streetlampPreloadInternalsForTest.installSource(
        style as keyof typeof streetlampPreloadInternalsForTest.assetDefs,
        source,
      );
    }
    // every style shares this source, so one measurement describes them all
    const asset = prepareStreetlampAsset('eastbrook_civic', source);
    const socket = new THREE.Vector3(asset.socket[0], 0, asset.socket[2]);
    const foot = socket.clone().sub(new THREE.Vector3(asset.lightAxis[0], 0, asset.lightAxis[1]));

    const view = buildStreetlamps(0);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    const scratch = new THREE.Vector3();
    let checked = 0;
    view.group.traverse((object) => {
      if (!(object instanceof THREE.InstancedMesh)) return;
      if (object.userData.streetlampRole !== 'body') return;
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, matrix);
        matrix.decompose(position, quaternion, scale);
        const stand = roadDistance(position.x, position.z);
        const lit = scratch.copy(socket).applyQuaternion(quaternion).add(position);
        const base = scratch.clone().copy(foot).applyQuaternion(quaternion).add(position);
        // The lit end reaches over the track, and the post is the far end of
        // the fixture from it. (The post is NOT asserted to be farther from
        // every road than the site: a handful of lamps stand between two roads,
        // where backing away from one approaches the other.)
        const lightClear = roadDistance(lit.x, lit.z);
        expect(lightClear).toBeLessThan(stand);
        expect(roadDistance(base.x, base.z)).toBeGreaterThan(lightClear);
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(200);
  });

  it('clears the previous static lamp field when an editor rebuild has no roads', () => {
    ensureNightLightField();
    const source = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 5.5, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x555555 }),
    );
    body.position.y = 2.75;
    source.add(body);
    for (const style of Object.keys(streetlampPreloadInternalsForTest.assetDefs)) {
      streetlampPreloadInternalsForTest.installSource(
        style as keyof typeof streetlampPreloadInternalsForTest.assetDefs,
        source,
      );
    }
    buildStreetlamps(0);
    expect(nightLightStaticCount()).toBeGreaterThan(0);

    setActiveWorldContent({ ...BUILTIN_WORLD, roads: [] });
    buildStreetlamps(0);
    expect(nightLightStaticCount()).toBe(0);
  });
});

describe('the per-frame lamp drive', () => {
  /** Install one source on every style, carrying an authored emitter. */
  function installGlowingSource(): void {
    const source = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(1, 5.5, 1), new THREE.MeshStandardMaterial());
    post.position.y = 2.75;
    const flame = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.4, 0.3),
      new THREE.MeshStandardMaterial({
        name: LAMP_SOURCE_MATERIAL,
        emissive: new THREE.Color(0.74, 0.49, 0.21),
        emissiveIntensity: 1,
      }),
    );
    flame.position.y = 4.7;
    source.add(post, flame);
    for (const style of Object.keys(streetlampPreloadInternalsForTest.assetDefs)) {
      streetlampPreloadInternalsForTest.installSource(
        style as keyof typeof streetlampPreloadInternalsForTest.assetDefs,
        source,
      );
    }
  }

  function emitterMaterials(view: { group: THREE.Group }): THREE.MeshStandardMaterial[] {
    const found: THREE.MeshStandardMaterial[] = [];
    view.group.traverse((object) => {
      if (!(object instanceof THREE.InstancedMesh)) return;
      const material = object.material as THREE.MeshStandardMaterial;
      if (material.name.endsWith(LAMP_SOURCE_MATERIAL)) found.push(material);
    });
    return found;
  }

  it('writes the dark state once instead of every frame of daylight', () => {
    // The lamps are out for the whole daylight half of a 20 minute cycle, and
    // the drive used to rewrite the same zero into every authored emitter of
    // every style on every one of those frames. Poking a value in and watching
    // it survive is the decisive test: an elided write leaves it alone.
    ensureNightLightField();
    installGlowingSource();
    const view = buildStreetlamps(0);
    const emitters = emitterMaterials(view);
    expect(emitters.length).toBeGreaterThan(0);

    view.update(0, 1);
    for (const material of emitters) expect(material.emissiveIntensity).toBe(0);
    for (const material of emitters) material.emissiveIntensity = 0.5;
    view.update(0, 2);
    view.update(0, 3);
    for (const material of emitters) expect(material.emissiveIntensity).toBe(0.5);
  });

  it('resumes driving the moment the lamplighter is out, and stands down after', () => {
    ensureNightLightField();
    installGlowingSource();
    const view = buildStreetlamps(0);
    const emitters = emitterMaterials(view);

    view.update(0, 1);
    view.update(1, 2);
    for (const material of emitters) expect(material.emissiveIntensity).toBeGreaterThan(0);
    view.update(0, 3);
    for (const material of emitters) expect(material.emissiveIntensity).toBe(0);
  });
});
