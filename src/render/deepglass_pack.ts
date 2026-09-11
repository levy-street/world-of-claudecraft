// The thrustpack on a fighter's back: Brennoch, Engine of the Fallen Heart.
//
// The model is the one the asset pipeline split into animatable parts
// (scripts/build_brennoch_jetpack.mjs): `core` plus `cog`, `booster.l`/`.r` and
// `fire.l`/`.r`. It carries no baked clips — every bit of motion here is
// procedural, driven by the wearer's live boost state.
//
// The `fire.*` nodes are now SOCKETS rather than art: their authored cones are
// switched off and the burner plume (models/cosmetics/brennoch_plume.glb, four
// parts, see ./jet_fire.ts) hangs off them instead. They keep their job of
// marking where the nozzle mouth is and which way it points, so everything the
// gimbal below does is unchanged by the swap.
//
// The animation contract (docs/prd/deepglass.md section 5.2) is that the MODEL
// is the boost meter: idle pilot flames, a hard flare on light-up, full cones
// while burning, and cold dark nozzles when spent. You should be able to tell
// from across the bell whether an opponent has a burn left.
//
// On top of that the pack must read as HARDWARE, which is two things:
//   * the burners answer the SHOVE — ignition and hard corners bark
//   * the cog is a flywheel: it winds up and coasts down, it does not snap
//
// The nozzles DO NOT MOVE. An earlier pass gimballed them to point the exhaust
// opposite the thrust, solved onto the fan the hardware could reach, driven by
// spring servos — correct on paper, measured at 0.80-0.99 exhaust-against-thrust,
// and it never looked right from inside the bell. It is gone: the `fire.*`
// sockets keep the pose the model was authored with, and the plume comes out of
// them the way the asset says it should.
//
// Attachment mirrors the hover-cosmetic seat: the payload hangs off the `chest`
// bone of the shared KayKit Rig_Medium skeleton, which every player class uses.

import * as THREE from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DG_CHARGE_MAX } from '../sim/deepglass/flight';
import { loadGltf } from './assets/loader';
import { GFX } from './gfx';
import {
  createPlumeMaterials,
  PLUME_NODES,
  type PlumeDrive,
  type PlumePart,
  preparePlumeGeometry,
} from './jet_fire';

const PACK_URL = 'models/cosmetics/brennoch_jetpack.glb';
const PLUME_URL = 'models/cosmetics/brennoch_plume.glb';

/** Chest-bone local mount, carried over from the asset pipeline's live viewer
 *  (HOVER_ATTACH.brennoch_jetpack) so the pack sits where it was dialled in. */
const MOUNT = { pos: [0, -0.02, -0.77] as const, rotY: Math.PI, scale: 0.9 };

/**
 * The arena's lighting response, applied to the pack the moment it loads.
 *
 * THIS IS WHY THE PACKS WERE INVISIBLE. Brennoch ships at `metalness: 1` — a
 * pure metal — and the bell runs a low `environmentIntensity` with NO scene
 * environment map at all. A pure metal has no diffuse term by definition, so
 * with nothing to reflect it renders as a black silhouette against a dark
 * character: attached, in the scene, visible, and completely unreadable.
 *
 * The arena kit (deepglass_kit.ts) already had to solve exactly this for its
 * brass, and this is the same treatment: pull metalness down so the directional
 * and hemisphere lights — which ARE bright in here — get a diffuse term to work
 * with, push the envMap boost back on top for the sheen, and lift the baked
 * albedo a touch against the low key. Every value SCALES the baked
 * metallicRoughness map rather than replacing it, so the brass/steel/rune split
 * the texture encodes still holds.
 */
const PACK_METALNESS = 0.38;
const PACK_ROUGHNESS = 0.86;
const PACK_ENV_INTENSITY = 2.4;
const PACK_ALBEDO_GAIN = 1.25;

function tuneForBell(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = mat as THREE.MeshStandardMaterial;
      if (!std?.isMeshStandardMaterial) continue;
      std.metalness = PACK_METALNESS;
      std.roughness = PACK_ROUGHNESS;
      std.envMapIntensity = PACK_ENV_INTENSITY;
      std.color.multiplyScalar(PACK_ALBEDO_GAIN);
      std.needsUpdate = true;
    }
  });
}

/** GLTFLoader strips dots from node names, so every lookup tries both. */
function findNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  return root.getObjectByName(name) ?? root.getObjectByName(name.replace(/\./g, '')) ?? null;
}

/** One nozzle's plume: the socket it hangs off, and the handles that drive it. */
interface Burner {
  /** The jetpack's own `fire.*` node, in its authored pose. */
  socket: THREE.Object3D;
  /** The four authored plume parts, cloned under the socket. */
  group: THREE.Object3D;
  /** Shared live state every part of this burner reads. */
  drive: PlumeDrive;
  materials: THREE.Material[];
}

interface Pack {
  payload: THREE.Object3D;
  cog: THREE.Object3D | null;
  boosters: THREE.Object3D[];
  burners: Burner[];
  /** Additive glow balls seated in the nozzle mouths. */
  glows: THREE.Mesh[];
  /** The point light, on the local player's pack only. */
  light: THREE.PointLight | null;
  /** Smoothed throttle 0..1, so light-up and cut-out are not instant pops. */
  heat: number;
  /** Seconds since the burners lit, for the ignition flare. */
  litFor: number;
  /** Was a dash flaring last frame? Edge-detects the bang. */
  wasDashing: boolean;
  /** Was the throttle open last frame? Edge-detects light-up for the kick. */
  wasBoosting: boolean;
  /** Cog spin rate, rad/s, with its own inertia so the flywheel winds up and
   *  coasts down instead of changing speed the instant the throttle does. */
  cogRate: number;
  /** Last frame's velocity, for the surge below. */
  prevVel: { x: number; y: number; z: number };
  /** 0..1 spike-and-decay on hard changes of direction. The sim's turn
   *  authority means a corner is the pack's HARDEST push; this is what lets you
   *  see that. */
  surge: number;
}

/** One wearer's live boost state, as the render needs it. */
export interface PackWearerState {
  boosting: boolean;
  /** 0..1 remaining charge. */
  charge: number;
  /** Body speed in yd/s. */
  speed: number;
  /** 0..1 thrust spool (Entity.dgSpool): how far the pack has wound up. Drives
   *  the idle pilot flame, so a fighter under way always has lit burners even
   *  with the throttle off — the pack should never look switched off while its
   *  wearer is flying. */
  spool: number;
  /**
   * WORLD-SPACE THRUST INTENT — the single most important field here.
   *
   * This is `Entity.dgWish`: the unit-ish direction the flight pass is actually
   * accelerating the body along, already lag-smoothed by the sim, magnitude
   * 0..1. The nozzles are aimed down its OPPOSITE, because that is what a
   * jetpack is: the exhaust goes the other way from where you are being pushed.
   * Zero when the wearer is coasting, which is what parks the gimbal in its
   * hover pose.
   */
  wish: { x: number; y: number; z: number };
  /** World-space velocity, yd/s. Only used for the surge (see {@link Pack}). */
  vel: { x: number; y: number; z: number };
  /**
   * A dash is flaring right now (Entity.dgDashTicks).
   *
   * The dash is an IMPULSE, not thrust: it does not show up in `wish` at all, so
   * without this the most violent thing the pack ever does — throwing the body
   * sideways in a fifth of a second — would be the one thing it never lit for.
   * Slams the throttle to full and jolts the gimbal, so a dash cracks.
   */
  dashing: boolean;
  /** This is the camera's own body. Only they get the real point light — a
   *  dozen dynamic lights in one scene is a shader recompile per roster change
   *  and a measurable frame cost, and the light you actually read is the one
   *  washing the water around YOU. */
  isSelf: boolean;
}

/** Radius of the additive glow ball sitting in each nozzle mouth. Small: it is
 *  a hot core for the bloom to bleed off, not a fog bank. */
const GLOW_RADIUS = 0.085;
const GLOW_COLOR = 0xffd39a;
/** The local player's burner light. */
const BURN_LIGHT_COLOR = 0xffa64d;
const BURN_LIGHT_MAX = 7;
const BURN_LIGHT_RANGE = 14;

/** Plume heat at full spool with the throttle off: a live pilot flame, small but
 *  unmistakably burning, against 1 for a burn. The contract (PRD 5.2) is that
 *  you can read a pack's state across the bell with no HUD, and that needs
 *  IDLE and SPENT to look different — a pilot flame you have to squint at is
 *  the same silhouette as a dead pack. */
const PACK_IDLE_HEAT = 0.33;

/** Change of velocity, yd/s in one sim tick, that reads as a full surge. The
 *  flight pass's boost kick alone is 4.5, so an ignition always barks. */
const SURGE_FULL_DV = 2.4;
/** Per-second decay of the surge once the shove is over. */
const SURGE_DECAY = 5;

/** One shared sphere for every nozzle glow; only the materials differ. */
const GLOW_GEO = new THREE.SphereGeometry(GLOW_RADIUS, 10, 8);

/** Retires the jetpack's own authored flame cones. Shared and never disposed:
 *  it draws nothing, so one instance for every pack is right. */
const NOZZLE_OFF = new THREE.MeshBasicMaterial({ visible: false });

/** Scratch, so the per-frame aim allocates nothing. */

export class DeepglassPacks {
  private template: THREE.Object3D | null = null;
  private plumeTemplate: THREE.Object3D | null = null;
  private loading = false;
  /** Settles when both loads above have resolved OR failed — the bench build
   *  rides it, and a missing plume degrades exactly like a live pack's does. */
  private loadSettled: Promise<void> | null = null;
  private readonly packs = new Map<number, Pack>();

  /** Kick the load. Safe to call every frame; it only fires once. */
  private ensureTemplate(): void {
    if (this.loading) return;
    this.loading = true;
    const pack = loadGltf(PACK_URL)
      .then((gltf: GLTF) => {
        tuneForBell(gltf.scene);
        this.template = gltf.scene;
      })
      .catch((err) => {
        console.error('[deepglass] thrustpack failed to load', err);
      });
    const plume = loadGltf(PLUME_URL)
      .then((gltf: GLTF) => {
        preparePlumeGeometry(gltf.scene);
        this.plumeTemplate = gltf.scene;
      })
      .catch((err) => {
        console.error('[deepglass] burner plume failed to load', err);
      });
    this.loadSettled = Promise.all([pack, plume]).then(() => undefined);
  }

  /**
   * Park one fully-dressed pack (payload, plumes, nozzle glows) hidden inside
   * `bench` the moment the templates land, and hand it to `onReady` so the
   * caller can link its programs off-thread. The models load async, so a pack
   * built at the first bout otherwise links every plume program on the exact
   * frame the roster spawns. The bench copy never animates and is never
   * released; its handful of materials ride the bench for the session.
   */
  warmInto(bench: THREE.Group, onReady: (node: THREE.Object3D) => void): void {
    this.ensureTemplate();
    void this.loadSettled?.then(() => {
      const pack = this.build();
      if (!pack) return;
      pack.payload.visible = false;
      bench.add(pack.payload);
      onReady(pack.payload);
    });
  }

  /** True once BOTH models are available (tests / callers can gate on it). */
  get ready(): boolean {
    return this.template !== null && this.plumeTemplate !== null;
  }

  /**
   * Seat one burner's plume in a nozzle.
   *
   * The `fire.*` node stays — it is the socket the gimbal already aims, sitting
   * at the nozzle mouth with the exhaust running down its own -Y — but its
   * authored cone mesh is switched off and the four plume parts hang under it
   * instead — seated in the socket's authored pose, which is the direction the
   * asset says the exhaust leaves in.
   */
  private dressNozzle(socket: THREE.Object3D, phase: number, out: Pack['burners']): void {
    // Switch the authored cone off through its MATERIAL, not through
    // `visible`. The socket is itself a Mesh, and Object3D visibility is
    // inherited — hiding the node takes the plume about to be parented under it
    // with it, silently and with every uniform still looking correct.
    socket.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.material = NOZZLE_OFF;
    });
    if (!this.plumeTemplate) return;
    const drive = { heat: { value: 0 }, burn: { value: 0 }, surge: { value: 0 } };
    const mats = createPlumeMaterials(drive, phase);
    const group = this.plumeTemplate.clone(true);
    for (const [part, node] of Object.entries(PLUME_NODES)) {
      const found = group.getObjectByName(node);
      if (!found) continue;
      found.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = mats[part as PlumePart];
        // Over the pack and the water, under the HUD. All four parts share one
        // order so their relative draw order stays the authored nesting.
        mesh.renderOrder = 13;
      });
    }
    socket.add(group);
    out.push({ socket, group, drive, materials: Object.values(mats) });
  }

  private build(): Pack | null {
    if (!this.template) return null;
    const payload = this.template.clone(true);
    payload.position.set(MOUNT.pos[0], MOUNT.pos[1], MOUNT.pos[2]);
    payload.rotation.set(0, MOUNT.rotY, 0);
    payload.scale.setScalar(MOUNT.scale);

    // One plume per side, each with its own materials: the shader carries a
    // phase, and a shared material would force both burners (and every wearer)
    // onto the same churn.
    const burners: Pack['burners'] = [];
    for (const [i, name] of ['fire.l', 'fire.r'].entries()) {
      const node = findNode(payload, name);
      if (node) this.dressNozzle(node, i * 0.5, burners);
    }

    // A hot core in each nozzle mouth. Additive and unlit, so it costs nothing
    // and the world bloom does the actual work of making it glow.
    const glows: THREE.Mesh[] = [];
    for (const b of burners) {
      const glow = new THREE.Mesh(
        GLOW_GEO,
        new THREE.MeshBasicMaterial({
          // Past 1.0 so the core actually crosses the bloom threshold, the
          // same trick ability_vfx/pillars.ts uses on its columns. A sub-1.0
          // colour at a capped opacity bled nothing at all.
          color: new THREE.Color(GLOW_COLOR).multiplyScalar(GFX.composer ? 2.2 : 1),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      );
      glow.renderOrder = 14;
      // Seated at the nozzle, which is the socket's own origin.
      b.socket.add(glow);
      glows.push(glow);
    }

    // Left in the pose the model was authored with — nothing rotates these.
    const boosters = ['booster.l', 'booster.r']
      .map((n) => findNode(payload, n))
      .filter((n): n is THREE.Object3D => n !== null);

    return {
      payload,
      cog: findNode(payload, 'cog'),
      boosters,
      burners,
      glows,
      light: null,
      heat: 0,
      litFor: 0,
      wasBoosting: false,
      wasDashing: false,
      cogRate: 0,
      prevVel: { x: 0, y: 0, z: 0 },
      surge: 0,
    };
  }

  /** Put a pack on `chest` for `id`, or return the one already there. */
  private acquire(id: number, chest: THREE.Object3D): Pack | null {
    const existing = this.packs.get(id);
    // Re-seat if the visual was rebuilt underneath us (form swap, pool reuse).
    if (existing) {
      if (existing.payload.parent !== chest) chest.add(existing.payload);
      return existing;
    }
    const pack = this.build();
    if (!pack) return null;
    chest.add(pack.payload);
    this.packs.set(id, pack);
    return pack;
  }

  /** Take the pack off `id` and drop it. */
  release(id: number): void {
    const pack = this.packs.get(id);
    if (!pack) return;
    pack.light?.dispose();
    pack.light = null;
    pack.payload.removeFromParent();
    pack.payload.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      // NOZZLE_OFF is shared by every pack in the bout — disposing it here would
      // take the other wearers' sockets down with this one.
      for (const m of mats) if (m && m !== NOZZLE_OFF) m.dispose();
    });
    // GLOW_GEO is shared across every pack, and so is every plume GEOMETRY —
    // the parts are cloned off one template, so the buffers belong to it and
    // not to this pack. Only the per-pack materials above are disposed, and the
    // traversal above already covers the plume's, since its meshes hang under
    // the payload.
    this.packs.delete(id);
  }

  releaseAll(): void {
    for (const id of [...this.packs.keys()]) this.release(id);
  }

  /**
   * Per-frame sync. `wearers` yields every body that should have a pack on,
   * with its live boost state; anyone previously wearing one and now absent has
   * it taken off.
   */
  update(
    dt: number,
    wearers: Iterable<{ id: number; chest: THREE.Object3D | null; state: PackWearerState }>,
  ): void {
    this.ensureTemplate();
    const seen = new Set<number>();

    for (const w of wearers) {
      if (!w.chest) continue;
      seen.add(w.id);
      const pack = this.acquire(w.id, w.chest);
      if (!pack) continue;
      this.animate(pack, w.state, dt);
    }

    for (const id of [...this.packs.keys()]) if (!seen.has(id)) this.release(id);
  }

  /**
   * The local player's burner light: created lazily on the first burn and kept
   * for the session, its intensity riding the throttle.
   *
   * Only the camera's own body gets one. Ten wearers with ten dynamic point
   * lights re-links every lit material's shader whenever the roster changes,
   * and the light a player actually reads is the one washing the water in
   * front of THEM — the rest is glow sprites and bloom.
   */
  private syncLight(pack: Pack, state: PackWearerState, glowK: number): void {
    if (!state.isSelf) {
      if (pack.light) {
        pack.light.removeFromParent();
        pack.light.dispose();
        pack.light = null;
      }
      return;
    }
    if (!pack.light) {
      pack.light = new THREE.PointLight(BURN_LIGHT_COLOR, 0, BURN_LIGHT_RANGE, 1.6);
      pack.payload.add(pack.light);
    }
    // ALWAYS visible, throttled by intensity alone. three counts a light into
    // numPointLights iff `visible` — intensity is irrelevant to the count — and
    // numPointLights is part of every lit material's program cache key, so a
    // visibility toggle here relinked the whole scene's programs on the frame
    // the burners crossed the threshold, mid-flight, both directions.
    pack.light.intensity = glowK * BURN_LIGHT_MAX;
  }

  private animate(pack: Pack, state: PackWearerState, dt: number): void {
    // ---- surge -------------------------------------------------------------
    // How hard the body was just shoved. The sim's turn authority means a hard
    // change of direction is the pack's BIGGEST push — bigger than holding a
    // straight line at top speed — and until now none of that reached the
    // model. Spike on the shove, decay after it, so every corner and every
    // ignition barks out of the burners.
    const dv = Math.hypot(
      state.vel.x - pack.prevVel.x,
      state.vel.y - pack.prevVel.y,
      state.vel.z - pack.prevVel.z,
    );
    pack.prevVel.x = state.vel.x;
    pack.prevVel.y = state.vel.y;
    pack.prevVel.z = state.vel.z;
    // Held as a maximum rather than filtered: the sim ticks at 20 Hz against a
    // 60 fps draw, so two frames in three see no change at all and an averaging
    // filter would just swallow the shove.
    pack.surge = Math.max(
      pack.surge * Math.exp(-dt * SURGE_DECAY),
      Math.min(1, dv / SURGE_FULL_DV),
    );

    // ---- throttle ----------------------------------------------------------
    // Smoothed throttle. Light-up is fast and cut-out slower, so a burn cracks
    // on and then sags away instead of blinking. With the throttle OFF the
    // burners fall back to a pilot flame scaled by the spool rather than going
    // out: cruising is still the pack pushing you along, and a dead pack on a
    // moving fighter reads as broken.
    const spent = state.charge <= 0.001 && !state.boosting;
    const idle = spent ? 0 : PACK_IDLE_HEAT * Math.max(0, Math.min(1, state.spool));
    const lit = state.boosting || state.dashing;
    const target = lit ? 1 : idle;
    const rate = lit ? 20 : 5;
    pack.heat += (target - pack.heat) * (1 - Math.exp(-dt * rate));
    pack.litFor = lit ? pack.litFor + dt : 0;
    if (state.dashing && !pack.wasDashing) {
      // A dash is a bang, not a burn: the surge goes straight to full.
      pack.surge = 1;
    }
    pack.wasDashing = state.dashing;
    if (state.boosting && !pack.wasBoosting) {
      pack.surge = 1;
    }
    pack.wasBoosting = state.boosting;

    // The cog is a flywheel, so its RATE is what chases the throttle — it winds
    // up over a beat and coasts back down, instead of changing speed in the
    // same instant the throttle does.
    if (pack.cog) {
      const wanted = 1.2 + pack.heat * 18 + pack.surge * 6;
      pack.cogRate += (wanted - pack.cogRate) * (1 - Math.exp(-dt * 3.5));
      pack.cog.rotation.z += dt * pack.cogRate;
    }

    // The boosters are NOT touched: they keep the pose the model was authored
    // with. (The gimbal that used to aim them is gone — see the header.)

    // ---- the plumes --------------------------------------------------------
    // The flames ARE the meter. Spent means genuinely dark, not merely small:
    // the plume hides outright below a sliver of heat.
    // Ignition flare: a brief overshoot on the first fifth of a second.
    const flare = pack.litFor > 0 ? 1 + Math.exp(-pack.litFor * 14) * 0.8 : 1;
    // Plume length tracks THRUST, not travel: a pack shoving a body out of a
    // standing start is at its hardest working and used to draw its smallest
    // flame. Speed keeps a light hand in it so a checked body still sags.
    const speedK = 0.9 + 0.1 * Math.min(1, state.speed / 26);
    const len = pack.heat * flare * speedK;
    // Every part of the plume stretches, fattens and brightens in the SHADER
    // off these three numbers, each with its own response (jet_fire.ts PARTS) —
    // which is why the collar can stay socketed in the nozzle while the tail
    // whips out four times its resting length. Scaling the socket node instead,
    // as the cones needed, moved all four together and skewed their normals.
    for (const b of pack.burners) {
      const lit = !spent && len > 0.02;
      b.group.visible = lit;
      if (!lit) continue;
      b.drive.heat.value = Math.min(1.6, len);
      b.drive.burn.value = Math.min(1, pack.heat / 0.7);
      b.drive.surge.value = pack.surge;
    }

    // The glow: a hot core that swells with the throttle. Scaled as well as
    // faded, because a burner at full chat should read as a bigger fire, not
    // just a brighter pixel.
    // Deliberately restrained. The nozzles swing onto the thrust, which means
    // the chase camera is looking straight INTO both of them whenever you fly
    // forward — at the first pass's size and opacity that put a white ball over
    // the player rather than a hot core in a nozzle.
    const glowK = spent ? 0 : Math.min(1, pack.heat * flare * (1 + pack.surge * 0.4));
    for (const g of pack.glows) {
      const mat = g.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.25 + glowK * 0.55;
      g.visible = glowK > 0.02;
      g.scale.setScalar(0.55 + glowK * 0.7);
    }

    // The one real light, on the local player only.
    this.syncLight(pack, state, glowK);
  }
}

/** Charge as a 0..1 fraction, for callers holding raw entity fields. */
export function packChargeFraction(charge: number | undefined): number {
  return Math.max(0, Math.min(1, (charge ?? 0) / DG_CHARGE_MAX));
}
