// The Deepglass art kit: the four authored GLBs that replace what were plain
// primitives in deepglass.ts — the cradle pylons, the goal gates, the powerup
// stations and the boost vents.
//
// Everything here is DRESSING. Every position comes from the one layout module
// (src/sim/deepglass/layout.ts) that the ball physics and the flight clamp also
// read, so a model can never disagree with what the ball banks off.
//
// Loading is async and the arena does not wait for it: buildDeepglassKit()
// returns a live view immediately and each family populates when its GLB
// resolves. A failed load leaves that family empty rather than stalling world
// entry.
import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import {
  DEEPGLASS_CENTER,
  DEEPGLASS_CRADLE_R,
  DG_BOOST_PADS,
  DG_GOAL_HOUSING_OFFSET,
  DG_POWERUP_SITES,
} from '../sim/deepglass/layout';
import { getActiveWorldContent } from '../sim/data';
import { loadGltf, releaseGltf } from './assets/loader';
import { prepareRuneModel, RUNE_MODEL_DEFS, type RuneModelDef } from './battleground_rune_model';

// boost_vent.glb and powerup_station.glb are no longer loaded: the pads and the
// prizes are battleground rune bodies now (see the pickups below). The GLBs stay
// in the repo — they are still what the Studio asset browser offers for dressing
// a map by hand.
const MODEL_PYLON = '/models/deepglass/cradle_pylon.glb';
const MODEL_GATE = '/models/deepglass/goal_gate.glb';

/** Team tints, matching the ring shaders in deepglass.ts exactly. */
const GATE_WEST = 0xffa53a;
const GATE_EAST = 0x49d6ff;
/**
 * How much of its authored size the goal SURROUND keeps.
 *
 * The gate model is a 19.5 yd arch around a scoring ring of 6 — so the
 * architecture was promising an opening three times wider than the one that
 * actually scores, and a shot that sailed through the arch and missed the ring
 * read as a bug rather than as a miss. Shrinking the surround pulls the promise
 * back toward the truth.
 *
 * ONLY the surround. The scoring ring itself is drawn from DG_RING_RADIUS in
 * deepglass.ts and is untouched, so the target a player aims at is exactly the
 * target the sim tests. At this factor the arch's inner edge still clears the
 * ring by a comfortable margin (19.5 * 0.62 = 12.1 against 6), which is what
 * keeps the ring hanging INSIDE a frame rather than clipping through it.
 */
export const GATE_SURROUND_SCALE = 0.62;
/** The vent housing's rune inlay reads as fuel — the same green as the pads. */
const VENT_TINT = 0x8effc8;
const STATION_FREEZE = 0x8ee8ff;
const STATION_OVERBURN = 0xff9de2;

// Lighting response, measured against the live arena rather than guessed.
//
// The bell runs `scene.environmentIntensity` at ~0.2 — deliberately, the water
// is meant to feel enclosed — and a near-pure metal under that has neither a
// diffuse term (metals have none) nor anything to reflect, so the authored
// brass rendered as a black silhouette. Pulling metalness down hands the brass
// back to the directional + hemisphere lights that ARE bright here, and the
// envMap boost puts the sheen back on top.
//
// These scale the baked metallicRoughness map rather than replacing it, so the
// stone/brass/rune split the texture encodes still holds.
const KIT_METALNESS = 0.38;
const KIT_ROUGHNESS = 0.92;
const KIT_ENV_INTENSITY = 2.4;
/** Multiplies the baked base colour. Lifts the arena's low key without
 *  re-baking every texture a stop brighter. */
const KIT_ALBEDO_GAIN = 1.25;

/** Sixteen buttresses, standing on the plaza inside the base ring. */
const PYLON_COUNT = 16;
/** Where the plaza's top face is — the pylons stand ON it, not on the ring. */
const PYLON_BASE_Y = 0.4;
/** Lean, in radians, of a buttress toward the bell's axis. Small on purpose:
 *  past ~0.1 the claw stops reading as gripping and starts reading as falling. */
const PYLON_LEAN = 0.06;

const UP = new THREE.Vector3(0, 1, 0);

export interface DeepglassKitState {
  /** Per-pad cooldown from the match driver; > 0 means taken. */
  padCooldown: readonly number[];
  /** Per-powerup cooldown; > 0 means the prize is gone. */
  powerupCooldown: readonly number[];
  /** A live goal celebration: which side CONCEDED, and 0..1 through the flare. */
  flare: { conceded: 'A' | 'B'; t: number } | null;
}

export interface DeepglassKit {
  group: THREE.Group;
  update(dt: number, time: number, state: DeepglassKitState): void;
  dispose(): void;
}

interface KitPart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** The node's transform inside the GLB. Load-bearing: the shipping pipeline
   *  meshopt-QUANTIZES positions, so the de-quantising scale/offset lives on
   *  the node and geometry read without it is the wrong size. */
  matrix: THREE.Matrix4;
}

/** Apply the arena's lighting response to a kit material. Every clone made
 *  later (per team, per station) inherits it. */
function tuneForBell(m: THREE.MeshStandardMaterial): void {
  m.metalness = KIT_METALNESS;
  m.roughness = KIT_ROUGHNESS;
  m.envMapIntensity = KIT_ENV_INTENSITY;
  m.color.setScalar(KIT_ALBEDO_GAIN);
}

/**
 * Tame a metallic CHARACTER material so it is not a black hole in the bell.
 *
 * The same trap the kit's brass fell into, arriving from a different direction.
 * A metal has no diffuse term by definition — all it can do is reflect — and the
 * arena deliberately runs `scene.environmentIntensity` at ~0.2 because the water
 * is meant to feel enclosed. Character armour authored at `metalness: 1` (the
 * paladin's and the knight's plate, among others) therefore has 20% of a dim IBL
 * and nothing else, and renders as a BLACK PATCH welded to the body — the
 * "black squares on players" that only show up on the tiers that have an
 * environment at all.
 *
 * Pulled to the same figures the kit uses, so plate in here is lit by the
 * directional and hemisphere lights that ARE bright, with the envMap boost back
 * on top for the sheen. Metals only: touching the cloth and skin materials would
 * relight every character in the arena for no reason.
 *
 * Mutates in place and remembers what it has done. The bell is its OWN WORLD —
 * you cannot walk from here to anywhere else — so there is no outside for a
 * shared material to leak into, and cloning ten characters' worth of materials
 * to avoid a leak that cannot happen would cost more than it saves.
 */
const TUNED = new WeakSet<THREE.Material>();
/** Above this, a material is "a metal" and gets the treatment. */
const BELL_METAL_CUTOFF = 0.5;

export function tuneCharacterMetalsForBell(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = mat as THREE.MeshStandardMaterial;
      if (!std?.isMeshStandardMaterial) continue;
      if (TUNED.has(std)) continue;
      TUNED.add(std);
      if (std.metalness < BELL_METAL_CUTOFF) continue;
      std.metalness = KIT_METALNESS;
      std.roughness = Math.max(std.roughness, KIT_ROUGHNESS * 0.75);
      std.envMapIntensity = KIT_ENV_INTENSITY;
      std.needsUpdate = true;
    }
  });
}

/** Pull every named mesh out of a parsed GLB, cloning geometry and material so
 *  the kit owns them outright and dispose() can never free the shared cache. */
function partsOf(gltf: GLTF): Map<string, KitPart> {
  const out = new Map<string, KitPart>();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
    const src = mesh.material as THREE.MeshStandardMaterial;
    const material = src.clone();
    // Blender ships these double-sided; several parts (the capped-off lathes in
    // the capital and the gate's throat plate) are genuinely open shells, so
    // keep both faces rather than punching holes in them.
    material.side = THREE.DoubleSide;
    tuneForBell(material);
    out.set(mesh.name, {
      geometry: mesh.geometry.clone(),
      material,
      matrix: mesh.matrixWorld.clone(),
    });
  });
  return out;
}

function dress(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!(m as unknown as { isMesh?: boolean }).isMesh) return;
    m.castShadow = false;
    m.receiveShadow = true;
  });
}

/**
 * Whether the ACTIVE world already carries a kit family as editable placements,
 * in which case the kit must not draw its own copy of that family.
 *
 * A Studio document of this venue places the cradle pylons and goal gates as
 * ordinary placements so a maker can move them (editor/shipped_deepglass.ts).
 * The document also keeps presentationMode 'deepglass' — the bell, water and
 * stadium hang off it — so this builder still runs there, and without the gate
 * it drew a second pylon ring exactly inside the placed one: move a pylon and
 * its ghost stays behind. The Goldcrest palms bug, one venue over.
 */
function worldPlacesKitModel(url: string): boolean {
  const content = getActiveWorldContent();
  // The explicit flag first: the editor viewport strips `placements` from its
  // active world (the render owns them there), so the scan alone reads empty
  // exactly where a maker is looking at the doubled ring.
  if (content.deepglassKitPlaced) return true;
  return (content.placements ?? []).some((p) => p.path === url);
}

export function buildDeepglassKit(): DeepglassKit {
  const group = new THREE.Group();
  group.name = 'deepglass-kit';

  const owned: { dispose(): void }[] = [];
  let disposed = false;

  // --- state the update loop drives once each family has landed -------------
  let pylonMat: THREE.MeshStandardMaterial | null = null;
  const gates: { mesh: THREE.Object3D; mat: THREE.MeshStandardMaterial; side: 'A' | 'B' }[] = [];
  /** Every floating pickup in the bell: the boost boots and the two prizes.
   *  `index` keys into the cooldown array of its own kind. */
  const pickups: {
    root: THREE.Group;
    index: number;
    kind: 'pad' | 'powerup';
    /** Turns per second. */
    spin: number;
    /** Offsets the bob so a row of pads does not pulse in lockstep. */
    phase: number;
    /** Rest height, so the bob is around the authored position rather than
     *  integrating away from it. */
    baseY: number;
    /** The body's own materials, and the opacity the def asked for. */
    mats: (THREE.Material & { emissiveIntensity: number })[];
    baseOpacity: number;
  }[] = [];

  /**
   * Load a battleground rune body and dress it for the bell.
   *
   * prepareRuneModel does the hard part (scale to a target height, anchor on
   * the spin axis, clone geometry and material off the immutable loader cache,
   * tint the emissive) — this adds the arena's own lighting response on top,
   * because a body authored for a bright field is as dark in here as everything
   * else was (see tuneCharacterMetalsForBell).
   */
  async function pickupBody(
    def: RuneModelDef | null,
    tint: number,
    height: number,
  ): Promise<THREE.Group | null> {
    if (!def) return null;
    try {
      const gltf = await loadGltf(def.url);
      if (disposed) return null;
      const body = prepareRuneModel(gltf.scene, { ...def, targetHeight: height }, tint);
      releaseGltf(def.url);
      body.traverse((c) => {
        const mesh = c as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const std = mat as THREE.MeshStandardMaterial;
          if (std?.isMeshStandardMaterial) {
            std.metalness = Math.min(std.metalness, KIT_METALNESS);
            std.envMapIntensity = KIT_ENV_INTENSITY;
          }
          owned.push(mat);
        }
        owned.push(mesh.geometry);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      });
      body.frustumCulled = false;
      return body;
    } catch (err) {
      console.warn('[deepglass] pickup model failed', def.url, err);
      return null;
    }
  }

  /** Collect the emissive materials a pickup's pulse drives. */
  function pickupMats(root: THREE.Object3D): (THREE.Material & { emissiveIntensity: number })[] {
    const out: (THREE.Material & { emissiveIntensity: number })[] = [];
    root.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (mat && 'emissiveIntensity' in mat) {
          out.push(mat as THREE.Material & { emissiveIntensity: number });
        }
      }
    });
    return out;
  }

  const tmpM = new THREE.Matrix4();
  const tmpSpin = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpQ2 = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const tmpAxis = new THREE.Vector3();
  const ONE = new THREE.Vector3(1, 1, 1);

  function claim(part: KitPart): void {
    owned.push(part.geometry, part.material);
  }

  // --- the cradle pylons ----------------------------------------------------
  if (!worldPlacesKitModel(MODEL_PYLON)) {
    void loadGltf(MODEL_PYLON)
      .then((gltf) => {
        if (disposed) return;
        const part = partsOf(gltf).get('pylon');
        releaseGltf(MODEL_PYLON);
        if (!part) return;
        claim(part);
        pylonMat = part.material;
        const inst = new THREE.InstancedMesh(part.geometry, part.material, PYLON_COUNT);
        inst.name = 'deepglass-pylons';
        inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        // A ring of sixteen is one draw call this way; sixteen clones were
        // sixteen, and the pylon is the single heaviest mesh in the arena.
        for (let i = 0; i < PYLON_COUNT; i++) {
          const a = (i / PYLON_COUNT) * Math.PI * 2;
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          // Tilt +Y toward the bell's axis: the rotation axis is the horizontal
          // perpendicular to this pylon's radial.
          tmpAxis.set(-sin, 0, cos);
          tmpQ.setFromAxisAngle(tmpAxis, PYLON_LEAN);
          tmpQ2.setFromAxisAngle(UP, -a);
          tmpQ.multiply(tmpQ2);
          tmpV.set(
            DEEPGLASS_CENTER.x + cos * DEEPGLASS_CRADLE_R,
            PYLON_BASE_Y,
            DEEPGLASS_CENTER.z + sin * DEEPGLASS_CRADLE_R,
          );
          tmpM.compose(tmpV, tmpQ, ONE).multiply(part.matrix);
          inst.setMatrixAt(i, tmpM);
        }
        inst.instanceMatrix.needsUpdate = true;
        inst.frustumCulled = false;
        dress(inst);
        group.add(inst);
      })
      .catch((err: unknown) => console.warn('[deepglass] pylon model failed', err));
  }

  // --- the goal gates -------------------------------------------------------
  // Placed gates lose the match-state emissive flare (that animation needs the
  // kit's material hooks); the trade is the maker can move them.
  if (!worldPlacesKitModel(MODEL_GATE)) {
    void loadGltf(MODEL_GATE)
      .then((gltf) => {
        if (disposed) return;
        const part = partsOf(gltf).get('goal_gate');
        releaseGltf(MODEL_GATE);
        if (!part) return;
        // The GLB's +X points DEEPER into the goal, so the east gate is identity
        // and the west one is a plain yaw flip. The housings hang just OUTSIDE
        // the glass now, wrapping the two holes cut through it (layout.ts): the
        // funnel's mouth faces the hole and its throat is the pocket a scored
        // ball settles in.
        for (const [x, yaw, tint, side] of [
          [DEEPGLASS_CENTER.x - DG_GOAL_HOUSING_OFFSET, Math.PI, GATE_WEST, 'A'],
          [DEEPGLASS_CENTER.x + DG_GOAL_HOUSING_OFFSET, 0, GATE_EAST, 'B'],
        ] as const) {
          const material = part.material.clone();
          material.emissive = new THREE.Color(tint);
          const mesh = new THREE.Mesh(part.geometry, material);
          mesh.name = `deepglass-gate-${side}`;
          mesh.applyMatrix4(part.matrix);
          const root = new THREE.Group();
          root.add(mesh);
          root.position.set(x, DEEPGLASS_CENTER.y, DEEPGLASS_CENTER.z);
          root.rotation.y = yaw;
          root.scale.setScalar(GATE_SURROUND_SCALE);
          root.frustumCulled = false;
          dress(root);
          group.add(root);
          gates.push({ mesh: root, mat: material, side });
          owned.push(material);
        }
        owned.push(part.geometry, part.material);
      })
      .catch((err: unknown) => console.warn('[deepglass] gate model failed', err));
  }

  // --- the pickups: boots and prizes ----------------------------------------
  // Both families are the BATTLEGROUND rune bodies (render/battleground_rune_model.ts),
  // re-tinted for the bell. They already solve the problem this arena has —
  // "a floating object you fly through to collect" — and reusing them means one
  // visual language across the two events instead of two dialects. The old
  // authored vent cowls and gimballed stations are gone with the swap; what a
  // pickup does is spin, bob, and go dark when it has been taken.
  for (const [i, pad] of DG_BOOST_PADS.entries()) {
    // Sprint boots for the fuel, at the size the pad's own reach implies.
    void pickupBody(RUNE_MODEL_DEFS.sprint, VENT_TINT, pad.big ? 2.3 : 1.5).then((body) => {
      if (disposed || !body) return;
      body.name = `deepglass-vent-${i}`;
      body.position.set(pad.x, pad.y, pad.z);
      group.add(body);
      pickups.push({
        root: body,
        index: i,
        kind: 'pad',
        spin: pad.big ? 1.5 : 2.1,
        phase: i * 0.7,
        baseY: pad.y,
        mats: pickupMats(body),
        baseOpacity: RUNE_MODEL_DEFS.sprint?.opacity ?? 1,
      });
    });
  }
  for (const [i, site] of DG_POWERUP_SITES.entries()) {
    // The Lance is a ward, Overburn is a weapon: the shield and the blade read
    // that difference without a word of UI.
    const def = site.kind === 'zap' ? RUNE_MODEL_DEFS.defense : RUNE_MODEL_DEFS.damage;
    const tint = site.kind === 'zap' ? STATION_FREEZE : STATION_OVERBURN;
    void pickupBody(def, tint, 3.2).then((body) => {
      if (disposed || !body) return;
      body.name = `deepglass-station-${site.kind}`;
      body.position.set(site.x, site.y, site.z);
      group.add(body);
      pickups.push({
        root: body,
        index: i,
        kind: 'powerup',
        spin: 0.9,
        phase: i * 1.4,
        baseY: site.y,
        mats: pickupMats(body),
        baseOpacity: def?.opacity ?? 1,
      });
    });
  }

  return {
    group,
    update(dt, time, state) {
      // Pylons: the rune conduits breathe, slowly, so the cradle is alive
      // without competing with the pads for attention.
      if (pylonMat) pylonMat.emissiveIntensity = 0.85 + 0.35 * Math.sin(time * 0.9);

      // Gates: a steady pulse, and a hard flare on the ring that conceded.
      for (const g of gates) {
        let e = 1.0 + 0.28 * Math.sin(time * 1.6 + (g.side === 'A' ? 0 : Math.PI));
        if (state.flare && state.flare.conceded === g.side) {
          e += 7 * (1 - state.flare.t) ** 2;
        }
        g.mat.emissiveIntensity = e;
      }

      // The pickups: spin, bob, and go dark the moment they are taken. Where
      // boost is and is not has to be readable from across the bell, and motion
      // carries at a range where a tint does not.
      for (const p of pickups) {
        const cooling =
          (p.kind === 'pad' ? state.padCooldown[p.index] : state.powerupCooldown[p.index]) > 0;
        // A taken pickup does not stop dead — it sags to a slow drift, which
        // reads as "coming back" rather than as "broken".
        const rate = cooling ? p.spin * 0.12 : p.spin;
        p.root.rotation.y = (p.root.rotation.y + dt * rate) % (Math.PI * 2);
        p.root.position.y = p.baseY + (cooling ? 0 : Math.sin(time * 1.4 + p.phase) * 0.35);
        for (const m of p.mats) {
          m.emissiveIntensity = cooling ? 0.12 : 1.0 + 0.45 * Math.sin(time * 2.6 + p.phase);
          m.opacity = cooling ? 0.22 : p.baseOpacity;
        }
      }
    },
    dispose() {
      disposed = true;
      for (const o of owned) o.dispose();
      owned.length = 0;
    },
  };
}
