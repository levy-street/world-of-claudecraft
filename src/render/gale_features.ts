// The Galecrest's dressing, render-only: the Old Beacon lighthouse on its
// head (a body of stacked crenellated KayKit tower drums under the blue
// cap, with a slowly turning light, the realm's landmark from anywhere on
// the downs, plus the grey stone stair the sim's beaconSpiralLift makes
// walkable, hugging the column up to the C balcony, on the masonry plinth
// that fills the volume the same lift field walls off), the stilt piers and
// boardwalk of Wickharbor's harbor (drawn from the SAME sim/gale_harbor.ts
// decks the player walks, with steep ramps drawn as stepped stairs), and
// the ribs of old hulls half-buried on the Wreckfields. Same contract as the sibling
// realm modules: build once, update(time) turns the beacon.
import * as THREE from 'three';
import { BEACON_SPIRAL, beaconSpiralLift } from '../sim/beacon_spiral';
import { GALE_HARBOR_DECKS } from '../sim/gale_harbor';
import { GLIDER_TOWER } from '../sim/glider_tower_layout';
import { hash2 } from '../sim/rng';
import { terrainHeight, WATER_LEVEL } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { beamBetween, buildDeckWood } from './deck_render';
import { GFX } from './gfx';

// The lighthouse, bottom to top: four crenellated grey body drums (each
// seated into the battlement ring of the one below, so the shaft reads as
// one banded stone column) under the blue-roofed cap that carries the lamp.
// h is each drum's effective rise including the seat overlap.
const TOWER_STACK = [
  { url: '/models/biome/hexb_tower_base.glb', scale: 6.0, h: 8.1 },
  { url: '/models/biome/hexb_tower_base.glb', scale: 5.55, h: 7.5 },
  { url: '/models/biome/hexb_tower_base.glb', scale: 5.15, h: 7.0 },
  { url: '/models/biome/hexb_tower_base.glb', scale: 4.75, h: 6.4 },
  { url: '/models/biome/hexb_tower_b.glb', scale: 4.4, h: 10.9 },
] as const;
const towerScenes: (THREE.Group | null)[] = TOWER_STACK.map(() => null);
for (let i = 0; i < TOWER_STACK.length; i++) {
  registerDeferredPreload(() =>
    loadGltf(TOWER_STACK[i].url).then((gltf) => {
      towerScenes[i] = gltf.scene;
    }),
  );
}

export const galeFeaturesPreloadInternalsForTest = {
  towerAssetUrl: TOWER_STACK.map((t) => t.url),
};

export interface GaleFeaturesView {
  group: THREE.Group;
  glowLights: THREE.PointLight[];
  update(time: number): void;
}

const BEACON = { x: 498, z: 308 };
// hull ribs on the Wreckfields beach: position, heading, rib count, size
const WRECKS = [
  { x: 322, z: 656, rot: 0.7, ribs: 7, r: 5.2 },
  { x: 356, z: 666, rot: -0.9, ribs: 5, r: 3.8 },
  { x: 300, z: 634, rot: 2.2, ribs: 6, r: 4.4 },
] as const;

function mat(color: number, rough = 0.85): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true })
    : new THREE.MeshLambertMaterial({ color, flatShading: true });
}

// merge a pile of box geometries into one mesh (position + normal only)
function mergeBoxes(parts: THREE.BufferGeometry[], material: THREE.Material): THREE.Mesh {
  let total = 0;
  for (const g of parts) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const norm = new Float32Array(total * 3);
  let off = 0;
  for (const g of parts) {
    pos.set(g.getAttribute('position').array as Float32Array, off);
    norm.set(g.getAttribute('normal').array as Float32Array, off);
    off += g.getAttribute('position').count * 3;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildGaleFeatures(seed: number): GaleFeaturesView {
  const group = new THREE.Group();
  group.name = 'gale-features';
  const glowLights: THREE.PointLight[] = [];

  // --- the Old Beacon: a banded stone shaft under the blue cap ---
  const beaconY = terrainHeight(BEACON.x, BEACON.z, seed);
  const beam = new THREE.Group();
  {
    let lift = 0;
    for (let i = 0; i < TOWER_STACK.length; i++) {
      const scene = towerScenes[i];
      if (!scene) continue;
      const drum = scene.clone(true);
      drum.position.set(BEACON.x, beaconY + lift - (i === 0 ? 0.15 : 0.05), BEACON.z);
      drum.scale.setScalar(TOWER_STACK[i].scale);
      drum.rotation.y = i * 0.9; // stagger the drum details around the column
      drum.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      group.add(drum);
      lift += TOWER_STACK[i].h;
    }
    const lampY = beaconY + lift - 3.5;
    // the stone stair, two flights and two C balconies: drawn from the SAME
    // beaconSpiralLift samples the sim walks on, so deck and footing never
    // disagree
    {
      const s = BEACON_SPIRAL;
      const stone = mat(0x8f959c, 0.95);
      const baseStone = mat(0x7c828a, 0.95); // a shade darker so the treads read on it
      const iron = mat(0x4b4f56, 0.8);
      const slabs: THREE.BufferGeometry[] = [];
      const piers: THREE.BufferGeometry[] = [];
      const rails: THREE.BufferGeometry[] = [];
      const deckAt = (x: number, z: number): number =>
        terrainHeight(x, z, seed) + beaconSpiralLift(x, z);
      const slab = (x: number, z: number, w: number, len: number, yaw: number): void => {
        const h = deckAt(x, z);
        const g = new THREE.BoxGeometry(w, 0.4, len);
        g.rotateY(yaw);
        g.translate(x, h - 0.18, z);
        slabs.push(g.toNonIndexed());
      };
      // The masonry the climb rides on. beaconSpiralLift is a single-valued
      // heightfield, so the ground under an elevated tread IS that tread's
      // height: the whole column of air below a balcony is walled off by the
      // climb gate. Left undrawn it is an invisible wall (a player on the lawn
      // beside the tower is stopped by the upper balcony's rim 19yd overhead).
      // Fill that volume with stone, lawn up into the tread above, so the
      // blocked mass reads as the tower's plinth. Purely additive geometry:
      // nothing walkable changes, and it is built unconditionally because this
      // is the SHAPE OF THE COLLISION, never a graphics tier's richness.
      const pier = (a: number, outR: number, w: number): void => {
        const innerR = s.coreR - 0.4; // bite into the column face, never a hairline gap
        const midR = (innerR + outR) / 2;
        const x = s.x + Math.sin(a) * midR;
        const z = s.z + Math.cos(a) * midR;
        const top = deckAt(x, z) - 0.3; // up INTO the tread, so no faces are coplanar
        const bot = terrainHeight(x, z, seed) - 0.6; // sunk under the lawn
        const height = top - bot;
        if (height < 0.5) return; // the stair foot: the treads already meet the lawn
        const g = new THREE.BoxGeometry(w, height, outR - innerR);
        g.rotateY(a);
        g.translate(x, bot + height / 2, z);
        piers.push(g.toNonIndexed());
      };
      // whether an unwrapped angle sits on a balcony (wide band) or a flight
      const onBalcony = (a: number): boolean =>
        (a > s.flight1End && a <= s.balcony1End) || (a > s.flight2End && a <= s.balcony2End);
      // slabs along the whole climb: treads on the flights, wider boards on
      // the balconies, every one butted against the column face
      const total = s.balcony2End - 0.03;
      const slabsN = 130;
      for (let i = 0; i <= slabsN; i++) {
        const rel = (i / slabsN) * total;
        const balc = onBalcony(rel);
        const outR = balc ? s.balconyOut : s.stairOut;
        const midR = (s.coreR + outR) / 2;
        const a = s.a0 + rel;
        const w = balc ? 0.95 : 0.62;
        slab(s.x + Math.sin(a) * midR, s.z + Math.cos(a) * midR, w, outR - s.coreR, a);
        pier(a, outR, w);
      }
      // the handrail: posts along the outer edge, and a continuous helical
      // double rail sampled finely so it runs DIAGONALLY up the flights and
      // levels off around each balcony
      const railPts: THREE.Vector3[] = [];
      const railN = 96;
      for (let i = 0; i <= railN; i++) {
        const rel = (i / railN) * (s.balcony2End - 0.04);
        const outR = (onBalcony(rel) ? s.balconyOut : s.stairOut) - 0.2;
        const a = s.a0 + rel;
        const x = s.x + Math.sin(a) * outR;
        const z = s.z + Math.cos(a) * outR;
        railPts.push(new THREE.Vector3(x, deckAt(x, z), z));
      }
      for (let i = 0; i + 1 < railPts.length; i++) {
        for (const lift2 of [1.04, 0.56]) {
          beamBetween(
            rails,
            new THREE.Vector3(railPts[i].x, railPts[i].y + lift2, railPts[i].z),
            new THREE.Vector3(railPts[i + 1].x, railPts[i + 1].y + lift2, railPts[i + 1].z),
            0.08,
            0.1,
          );
        }
      }
      for (let i = 0; i <= 32; i++) {
        const p = railPts[Math.round((i / 32) * railN)];
        const g = new THREE.BoxGeometry(0.16, 1.12, 0.16);
        g.translate(p.x, p.y + 0.52, p.z);
        rails.push(g.toNonIndexed());
      }
      // the top balcony's far end: a short radial rail back to the tower
      const endA = s.a0 + s.balcony2End - 0.04;
      const endPts: THREE.Vector3[] = [];
      for (const r of [s.balconyOut - 0.2, (s.balconyOut + s.coreR) / 2, s.coreR + 0.25]) {
        const x = s.x + Math.sin(endA) * r;
        const z = s.z + Math.cos(endA) * r;
        const h = deckAt(x, z);
        const g = new THREE.BoxGeometry(0.16, 1.12, 0.16);
        g.translate(x, h + 0.52, z);
        rails.push(g.toNonIndexed());
        endPts.push(new THREE.Vector3(x, h, z));
      }
      for (let i = 0; i + 1 < endPts.length; i++) {
        for (const lift2 of [1.04, 0.56]) {
          beamBetween(
            rails,
            new THREE.Vector3(endPts[i].x, endPts[i].y + lift2, endPts[i].z),
            new THREE.Vector3(endPts[i + 1].x, endPts[i + 1].y + lift2, endPts[i + 1].z),
            0.08,
            0.1,
          );
        }
      }
      group.add(mergeBoxes(piers, baseStone));
      group.add(mergeBoxes(slabs, stone));
      group.add(mergeBoxes(rails, iron));
    }
    // the turning light: two opposed additive cones riding a pivot. Real-beam
    // treatment: per-vertex alpha runs each cone from a hot core at the lamp
    // to nothing at its mouth, so the beam melts into the night instead of
    // ending in a hard elliptical cap (the open mouth's far wall used to read
    // as one), and the HDR material color pushes the near-lamp core over the
    // bloom threshold so the light genuinely glares on composer tiers.
    const beamMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xffe9a8).multiplyScalar(2.1), // HDR, pre-tonemap
      transparent: true,
      opacity: 0.45,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    for (const flip of [1, -1]) {
      // 8 height segments so the alpha falloff curve interpolates smoothly
      const coneGeo = new THREE.ConeGeometry(4.2, 60, 12, 8, true);
      const conePos = coneGeo.getAttribute('position');
      const fade = new Float32Array(conePos.count * 4);
      for (let vi = 0; vi < conePos.count; vi++) {
        // apex (+y, at the lamp) alpha 1; mouth (-y) alpha 0, eased so the
        // core stays hot and the tail falls off long and soft
        const along = (conePos.getY(vi) + 30) / 60;
        const a = along ** 1.6;
        fade[vi * 4 + 0] = 1;
        fade[vi * 4 + 1] = 1;
        fade[vi * 4 + 2] = 1;
        fade[vi * 4 + 3] = a;
      }
      coneGeo.setAttribute('color', new THREE.BufferAttribute(fade, 4));
      const cone = new THREE.Mesh(coneGeo, beamMat);
      cone.rotation.z = (flip * Math.PI) / 2;
      cone.position.x = flip * 30;
      beam.add(cone);
    }
    beam.position.set(BEACON.x, lampY, BEACON.z);
    group.add(beam);
    const light = new THREE.PointLight(0xffd890, 5, 40, 2);
    light.position.set(BEACON.x, lampY, BEACON.z);
    light.userData.baseIntensity = 5;
    glowLights.push(light);
    group.add(light);
  }

  // --- Wickharbor's harbor: plank decks on stilts over the bay ---
  // Drawn from the same GALE_HARBOR_DECKS rectangles groundHeight walks, so
  // the plank plane underfoot is exactly the plank plane on screen (the
  // shared walkway builder in deck_render.ts).
  {
    const wood = mat(0x8a6a4a, 0.9);
    const postWood = mat(0x6b523d, 0.92);
    const { planks, posts } = buildDeckWood(
      GALE_HARBOR_DECKS,
      (x, z) => terrainHeight(x, z, seed),
      WATER_LEVEL,
      { bollards: true },
    );
    group.add(mergeBoxes(planks, wood));
    group.add(mergeBoxes(posts, postWood));
  }

  // --- the Wreckfields: hull ribs arcing out of the shingle ---
  {
    const ribGeo = new THREE.TorusGeometry(1, 0.08, 5, 10, Math.PI);
    const ribMat = mat(0x5a5048, 0.9);
    let count = 0;
    for (const w of WRECKS) count += w.ribs;
    const mesh = new THREE.InstancedMesh(ribGeo.toNonIndexed(), ribMat, count);
    const m = new THREE.Matrix4();
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    let i = 0;
    for (const w of WRECKS) {
      const dx = Math.sin(w.rot);
      const dz = Math.cos(w.rot);
      for (let k = 0; k < w.ribs; k++) {
        const t = (k - (w.ribs - 1) / 2) * 1.7;
        const x = w.x + dx * t;
        const z = w.z + dz * t;
        const y = terrainHeight(x, z, seed);
        // ribs shrink toward bow and stern, like a keel picked clean
        const shape = 1 - Math.abs(k - (w.ribs - 1) / 2) / w.ribs;
        const r = w.r * (0.6 + shape * 0.5);
        q.setFromEuler(e.set(0, w.rot + Math.PI / 2, (hash2(x, z, seed + 7401) - 0.5) * 0.24));
        v.set(x, y - 0.4, z);
        sc.set(r, r, r);
        mesh.setMatrixAt(i, m.compose(v, q, sc));
        i++;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // --- The Shear: Windrider Flight Atalaya (Flightmaster Zephyr's tower) ---
  // A soaring coastal flight tower at (450, 520) reaching Y = 74, matching
  // the sim's gliderTowerSurface(x, z). Built with a heavy stone plinth, banded
  // cylinder column, flared corbelled capital, wood-planked flight deck, and
  // a roadside updraft funnel at (450, 512.5) with spiraling wind rings.
  const updraftGroup = new THREE.Group();
  {
    const stone = mat(0x8f959c, 0.95);
    const baseStone = mat(0x7c828a, 0.95);
    const darkIron = mat(0x4b4f56, 0.8);
    const woodPlank = mat(0x8a6a4a, 0.9);
    const bannerBlue = mat(0x38bdf8, 0.75);

    const tx = GLIDER_TOWER.x;
    const tz = GLIDER_TOWER.z;
    const deckY = GLIDER_TOWER.deckY;
    const groundY = terrainHeight(tx, tz, seed);
    const totalH = deckY - groundY;

    // 1. Plinth at base
    const plinthGeo = new THREE.CylinderGeometry(5.2, 5.8, 6.0, 16);
    const plinth = new THREE.Mesh(plinthGeo, baseStone);
    plinth.position.set(tx, groundY + 2.5, tz);
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    group.add(plinth);

    // 2. Tower column shaft
    const shaftH = totalH - 5.0;
    const shaftGeo = new THREE.CylinderGeometry(
      GLIDER_TOWER.columnRadius,
      GLIDER_TOWER.columnRadius + 0.3,
      shaftH,
      16,
    );
    const shaft = new THREE.Mesh(shaftGeo, stone);
    shaft.position.set(tx, groundY + 3.0 + shaftH / 2, tz);
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    group.add(shaft);

    // 3. Banded decorative masonry rings every 14 yards up the column
    for (let by = groundY + 14; by < deckY - 8; by += 14) {
      const bandGeo = new THREE.CylinderGeometry(
        GLIDER_TOWER.columnRadius + 0.35,
        GLIDER_TOWER.columnRadius + 0.35,
        0.8,
        16,
      );
      const band = new THREE.Mesh(bandGeo, baseStone);
      band.position.set(tx, by, tz);
      band.castShadow = true;
      band.receiveShadow = true;
      group.add(band);
    }

    // 4. Corbelled capital flare beneath the platform
    const corbelGeo = new THREE.CylinderGeometry(
      GLIDER_TOWER.deckRadius,
      GLIDER_TOWER.columnRadius,
      4.0,
      16,
    );
    const corbel = new THREE.Mesh(corbelGeo, baseStone);
    corbel.position.set(tx, deckY - 2.0, tz);
    corbel.castShadow = true;
    corbel.receiveShadow = true;
    group.add(corbel);

    // 5. Flight deck stone slab & wooden decking
    const deckGeo = new THREE.CylinderGeometry(
      GLIDER_TOWER.deckRadius + 0.15,
      GLIDER_TOWER.deckRadius + 0.15,
      0.5,
      16,
    );
    const deckMesh = new THREE.Mesh(deckGeo, stone);
    deckMesh.position.set(tx, deckY - 0.25, tz);
    deckMesh.castShadow = true;
    deckMesh.receiveShadow = true;
    group.add(deckMesh);

    const woodDeckGeo = new THREE.CylinderGeometry(
      GLIDER_TOWER.deckRadius - 0.2,
      GLIDER_TOWER.deckRadius - 0.2,
      0.06,
      16,
    );
    const woodDeck = new THREE.Mesh(woodDeckGeo, woodPlank);
    woodDeck.position.set(tx, deckY + 0.03, tz);
    woodDeck.receiveShadow = true;
    group.add(woodDeck);

    // 6. Flight deck perimeter railings with open southern launch mouth
    const railParts: THREE.BufferGeometry[] = [];
    const railRadius = GLIDER_TOWER.deckRadius - 0.3;
    const postCount = 14;
    const postPositions: THREE.Vector3[] = [];
    for (let i = 0; i < postCount; i++) {
      const angle = (i / postCount) * Math.PI * 2;
      const px = tx + Math.sin(angle) * railRadius;
      const pz = tz + Math.cos(angle) * railRadius;
      if (angle > 1.1 && angle < 2.0) continue; // open mouth for glider takeoff

      const post = new THREE.BoxGeometry(0.14, 1.1, 0.14);
      post.translate(px, deckY + 0.55, pz);
      railParts.push(post.toNonIndexed());
      postPositions.push(new THREE.Vector3(px, deckY, pz));
    }
    for (let i = 0; i + 1 < postPositions.length; i++) {
      const p1 = postPositions[i];
      const p2 = postPositions[i + 1];
      if (p1.distanceTo(p2) < 3.2) {
        beamBetween(
          railParts,
          new THREE.Vector3(p1.x, deckY + 0.5, p1.z),
          new THREE.Vector3(p2.x, deckY + 0.5, p2.z),
          0.06,
          0.08,
        );
        beamBetween(
          railParts,
          new THREE.Vector3(p1.x, deckY + 1.0, p1.z),
          new THREE.Vector3(p2.x, deckY + 1.0, p2.z),
          0.06,
          0.08,
        );
      }
    }
    if (railParts.length > 0) group.add(mergeBoxes(railParts, darkIron));

    // 7. Wind indicator mast and fluttering pennants on the deck
    const mastGeo = new THREE.CylinderGeometry(0.08, 0.1, 4.2, 8);
    const mast = new THREE.Mesh(mastGeo, darkIron);
    mast.position.set(tx - 3.2, deckY + 2.1, tz - 2.2);
    group.add(mast);

    const pennantGeo = new THREE.ConeGeometry(0.4, 2.2, 3);
    pennantGeo.rotateZ(Math.PI / 2);
    pennantGeo.rotateY(-0.235);
    const pennant = new THREE.Mesh(pennantGeo, bannerBlue);
    pennant.position.set(tx - 3.2 + 0.9, deckY + 3.8, tz - 2.2);
    group.add(pennant);

    // 8. Ground-level updraft vent at (450, 512.5)
    const ux = GLIDER_TOWER.updraft.x;
    const uz = GLIDER_TOWER.updraft.z;
    const uy = terrainHeight(ux, uz, seed);

    const stoneRingGeo = new THREE.TorusGeometry(1.6, 0.22, 8, 24);
    stoneRingGeo.rotateX(Math.PI / 2);
    const stoneRing = new THREE.Mesh(stoneRingGeo, baseStone);
    stoneRing.position.set(ux, uy + 0.12, uz);
    group.add(stoneRing);

    // Spiraling wind funnel in Three.js
    const updraftMat = new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (const [ry, r] of [
      [0.6, 1.4],
      [1.8, 1.7],
      [3.2, 2.0],
      [4.8, 2.3],
    ]) {
      const ringGeo = new THREE.TorusGeometry(r, 0.06, 6, 20);
      ringGeo.rotateX(Math.PI / 2);
      const rMesh = new THREE.Mesh(ringGeo, updraftMat);
      rMesh.position.set(0, ry, 0);
      updraftGroup.add(rMesh);
    }
    updraftGroup.position.set(ux, uy, uz);
    group.add(updraftGroup);
  }

  return {
    group,
    glowLights,
    update(time: number): void {
      // the beacon turns, slow and steady, the way it always has
      beam.rotation.y = time * 0.45;
      updraftGroup.rotation.y = time * 2.2;
    },
  };
}
