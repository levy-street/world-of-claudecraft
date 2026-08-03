// The render half of rift parkour courses: build every course feature as
// procedural geometry, return a per-frame tick closure that animates them
// off the SAME clock and registries the sim's floor query reads. A deck
// stands exactly where its collision stands, frame for frame; a blink
// tile's ghost fades in as its flip approaches; a crumble deck shakes,
// drops, and re-hangs exactly when the support query says so.
//
// Personal state (gems, braziers) renders for the LOCAL player only, via
// the pid the renderer passes: your collected gems vanish for you, your lit
// braziers burn for you, and a party mate's progress never repaints yours.
//
// Descended from the Blackspan pit-course renderer on the physics branch,
// rebuilt against the course kernel: all-procedural (no GLB kit on this
// branch), tier-aware through lowGfx only.

import * as THREE from 'three';
import {
  type CourseDeck,
  type CoursePlan,
  courseCheckpointFor,
  courseClockNow,
  courseCrumblePhase,
  courseDeckSolid,
  courseDeckTop,
  courseGemCollected,
  courseRopeOffset,
  courseRopePointAt,
  dutyActive,
  dutyTimeToFlip,
  ferryPos,
  hazardActive,
  hazardPos,
  sweeperAngle,
} from '../sim/course';
import { buildRiftCourseProp } from './rift_course_props';

const EMBER = 0xff8a3e;
const ARCANE = 0x8f6fe8;
const GEM = 0x4fd8c8;

/** A house-style scenery flame: emissive, flickered and ember-emitting once
 *  registered in the renderer's flame list, exactly like the dungeon
 *  torches. The old static additive cones bypassed all of that, which is
 *  why they read as placeholder. */
function makeSceneryFlame(radius: number, height: number, lowGfx: boolean): THREE.Mesh {
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(radius, height, 6),
    new THREE.MeshLambertMaterial({
      color: 0xffc36b,
      emissive: 0xff7a1e,
      emissiveIntensity: lowGfx ? 1.6 : 2.4,
      transparent: true,
      opacity: 0.92,
    }),
  );
  flame.matrixAutoUpdate = true;
  return flame;
}

/**
 * Build one floor's course into `group` (the interior group, instance-local
 * frame with the floor at y 0). Returns the per-frame tick.
 */
export interface RiftCourseFxHosts {
  /** The renderer's scenery-flame list: joining it buys the shared flicker,
   *  ember emission, and perceptual cadence for free. */
  flames: THREE.Mesh[];
  /** The renderer's budgeted fire lights. */
  fireLights: THREE.PointLight[];
}

export function buildRiftCourseFeatures(
  group: THREE.Group,
  plan: CoursePlan,
  instKey: string,
  lowGfx: boolean,
  localPid: () => number,
  fx?: RiftCourseFxHosts,
): (displayTime: number) => void {
  const deckMat = new THREE.MeshLambertMaterial({ color: 0x4a4038 });
  const conveyorChevrons: Array<{
    pad: CoursePlan['pads'][number];
    chevron: THREE.Group;
    phase: number;
  }> = [];
  const bandMat = new THREE.MeshLambertMaterial({ color: 0x6b5a3e });
  const emberMat = new THREE.MeshBasicMaterial({ color: EMBER, transparent: true, opacity: 0.7 });

  // ---- Decks --------------------------------------------------------------
  interface DeckView {
    deck: CourseDeck;
    index: number;
    mesh: THREE.Object3D;
    ghost?: THREE.Mesh;
  }
  const deckViews: DeckView[] = [];
  for (let i = 0; i < plan.decks.length; i++) {
    const deck = plan.decks[i];
    const body = new THREE.Group();
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(deck.hw * 2, 0.5, deck.hd * 2),
      deck.kind === 'blink'
        ? new THREE.MeshLambertMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.95 })
        : deckMat,
    );
    slab.position.y = -0.25;
    body.add(slab);
    if (deck.kind === 'piston') {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 26, 8), bandMat);
      shaft.position.y = -13.2;
      body.add(shaft);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(deck.hw * 2, 0.16, deck.hd * 2), emberMat);
      rim.position.y = 0.03;
      body.add(rim);
    } else if (deck.kind === 'crumble') {
      const crack = new THREE.Mesh(
        new THREE.BoxGeometry(deck.hw * 1.7, 0.06, 0.12),
        new THREE.MeshBasicMaterial({ color: 0x1c130c }),
      );
      crack.position.y = 0.01;
      crack.rotation.y = 0.6;
      body.add(crack);
    } else if (deck.kind === 'ferry') {
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(deck.hw * 2, 0.4, 0.12), emberMat);
        rail.position.set(0, 0.3, side * deck.hd);
        body.add(rail);
      }
    } else if (deck.kind === 'geyser') {
      // The launch pad: pipeline-built machinery, not a drawn cone. The
      // eruption is a house-style scenery flame (emissive, flickered, ember
      // emitting via the shared renderer loop), scaled up while the window
      // is open and hidden between eruptions.
      const pad = buildRiftCourseProp('rift_launch_pad');
      if (pad) {
        const s = (Math.min(deck.hw, deck.hd) * 2) / 2.4;
        pad.scale.setScalar(s);
        pad.position.y = -0.05;
        body.add(pad);
      }
      const flame = makeSceneryFlame(0.55, 1.6, lowGfx);
      flame.position.y = 0.9;
      flame.visible = false;
      body.add(flame);
      fx?.flames.push(flame);
      body.userData.flame = flame;
    }
    body.position.set(deck.x, deck.y, deck.z);
    group.add(body);
    const view: DeckView = { deck, index: i, mesh: body };
    if (deck.kind === 'blink') {
      // The ghost: an outline that fades IN while the tile is gone, so the
      // return is telegraphed exactly on the clock that returns it.
      const ghost = new THREE.Mesh(
        new THREE.BoxGeometry(deck.hw * 2, 0.5, deck.hd * 2),
        new THREE.MeshBasicMaterial({
          color: 0x9fd8ff,
          transparent: true,
          opacity: 0,
          wireframe: true,
        }),
      );
      ghost.position.set(deck.x, deck.y - 0.25, deck.z);
      group.add(ghost);
      view.ghost = ghost;
    }
    deckViews.push(view);
  }

  // ---- Pads ---------------------------------------------------------------
  for (const pad of plan.pads) {
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(pad.hw * 2, 0.06, pad.hd * 2),
      new THREE.MeshBasicMaterial({
        color: pad.kind === 'boost' ? ARCANE : 0x86c9d8,
        transparent: true,
        opacity: 0.45,
      }),
    );
    strip.position.set(pad.x, pad.y + 0.04, pad.z);
    group.add(strip);
    if (pad.kind === 'conveyor' && !lowGfx) {
      // Travelling chevrons: the belt's direction and speed, readable in
      // motion. Two thin angled slats per chevron; the tick slides them
      // along the run and wraps.
      const yaw = Math.atan2(pad.dirX ?? 1, pad.dirZ ?? 0);
      for (let a = 0; a < 3; a++) {
        const chevron = new THREE.Group();
        for (const side of [-1, 1]) {
          const slat = new THREE.Mesh(
            new THREE.BoxGeometry(0.34, 0.04, 0.1),
            new THREE.MeshBasicMaterial({
              color: 0xc8ecf5,
              transparent: true,
              opacity: 0.85,
            }),
          );
          slat.position.set(side * 0.14, 0, side * 0.12);
          slat.rotation.y = side * 0.8;
          chevron.add(slat);
        }
        chevron.rotation.y = yaw;
        chevron.position.set(pad.x, pad.y + 0.12, pad.z);
        group.add(chevron);
        conveyorChevrons.push({ pad, chevron, phase: a / 3 });
      }
    }
  }

  // ---- Hazards ------------------------------------------------------------
  interface HazardView {
    h: CoursePlan['hazards'][number];
    mesh: THREE.Object3D;
    base: number;
  }
  const hazardViews: HazardView[] = [];
  for (const h of plan.hazards) {
    let mesh: THREE.Object3D;
    if (h.kind === 'spikes' || h.kind === 'darts') {
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry((h.hw ?? 1) * 2, 0.5, (h.hd ?? 1) * 2),
        new THREE.MeshLambertMaterial({ color: 0x707a82 }),
      );
    } else if (h.kind === 'sweeper') {
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, h.len ?? 4),
        new THREE.MeshLambertMaterial({ color: 0x5a5148 }),
      );
      beam.position.z = (h.len ?? 4) / 2;
      const pivot = new THREE.Group();
      pivot.add(beam);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.7, 8), bandMat);
      pivot.add(hub);
      mesh = pivot;
    } else if (h.kind === 'blade') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(h.r ?? 1.2, h.r ?? 1.2, 0.25, 12), bandMat);
    } else {
      mesh = new THREE.Mesh(
        new THREE.DodecahedronGeometry(h.r ?? 1.5),
        new THREE.MeshLambertMaterial({ color: 0x5f564c }),
      );
    }
    mesh.position.set(h.x, h.y + (h.kind === 'boulder' ? (h.r ?? 1.5) : 0.4), h.z);
    group.add(mesh);
    hazardViews.push({ h, mesh, base: h.y });
  }

  // ---- Ropes --------------------------------------------------------------
  const PLANKS = lowGfx ? 13 : 27;
  const ropeViews = plan.ropes.map((rope) => {
    const planks: THREE.Mesh[] = [];
    for (let i = 0; i < PLANKS; i++) {
      const plank = new THREE.Mesh(
        new THREE.BoxGeometry(rope.halfWidth * 2 + 0.3, 0.08, 0.34),
        new THREE.MeshLambertMaterial({ color: 0x54402c }),
      );
      group.add(plank);
      planks.push(plank);
    }
    return { rope, planks };
  });

  // ---- Gems, braziers, summit ---------------------------------------------
  const gemViews = plan.gems.map((gem, index) => {
    const orb: THREE.Object3D =
      buildRiftCourseProp('rift_gem_crystal') ??
      new THREE.Mesh(
        new THREE.OctahedronGeometry(0.42),
        new THREE.MeshBasicMaterial({ color: GEM, transparent: true, opacity: 0.9 }),
      );
    // The crystal is floor-seated; a collectible floats. Hang it from its
    // middle so the spin reads.
    orb.position.set(gem.x, gem.y - 0.45, gem.z);
    group.add(orb);
    return { index, orb, baseY: gem.y - 0.45 };
  });
  const brazierViews = plan.braziers.map((b) => {
    const stand = buildRiftCourseProp('rift_waybrazier');
    if (stand) {
      stand.position.set(b.x, b.y, b.z);
      group.add(stand);
    } else {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.32, 0.6, 8), bandMat);
      bowl.position.set(b.x, b.y + 0.3, b.z);
      group.add(bowl);
    }
    const flame = makeSceneryFlame(0.26, 0.7, lowGfx);
    flame.position.set(b.x, b.y + 1.55, b.z);
    flame.visible = false;
    group.add(flame);
    fx?.flames.push(flame);
    let light: THREE.PointLight | null = null;
    if (fx && !lowGfx) {
      light = new THREE.PointLight(0xff9a4a, 0, 9);
      light.position.set(b.x, b.y + 1.8, b.z);
      group.add(light);
      fx.fireLights.push(light);
    }
    return { b, flame, light };
  });
  {
    const banner = new THREE.Mesh(
      new THREE.ConeGeometry(0.5, 1.4, 4),
      new THREE.MeshBasicMaterial({ color: ARCANE, transparent: true, opacity: 0.8 }),
    );
    banner.position.set(plan.summit.x, plan.summit.y + 2.4, plan.summit.z);
    group.add(banner);
  }

  // ---- The tick -----------------------------------------------------------
  return (displayTime: number) => {
    const t = courseClockNow();
    const pid = localPid();
    for (const v of deckViews) {
      const { deck } = v;
      if (deck.kind === 'piston') {
        v.mesh.position.y = courseDeckTop(deck, t);
      } else if (deck.kind === 'ferry' && deck.track) {
        const at = ferryPos(deck.x, deck.z, deck.track, t);
        v.mesh.position.x = at.x;
        v.mesh.position.z = at.z;
      } else if (deck.kind === 'blink' && deck.window) {
        const solid = courseDeckSolid(deck, v.index, instKey, t);
        v.mesh.visible = solid;
        if (v.ghost) {
          // Fade the ghost in over the last 1.2 s before the tile returns.
          const flip = dutyTimeToFlip(deck.window, t);
          v.ghost.visible = !solid;
          (v.ghost.material as THREE.MeshBasicMaterial).opacity = solid
            ? 0
            : Math.max(0.12, 1 - flip / 1.2) * 0.5;
        }
      } else if (deck.kind === 'crumble' && deck.crumble) {
        const phase = courseCrumblePhase(deck.crumble, instKey, v.index, t);
        if (phase === 'solid') {
          v.mesh.visible = true;
          v.mesh.position.set(deck.x, deck.y, deck.z);
        } else if (phase === 'shaking') {
          v.mesh.visible = true;
          v.mesh.position.x = deck.x + Math.sin(displayTime * 37) * 0.06;
          v.mesh.position.z = deck.z + Math.cos(displayTime * 41) * 0.06;
        } else {
          // Falling, then hidden: the drop reads before the deck vanishes.
          const gone = v.mesh.position.y - (deck.y - 8);
          if (gone > 0.5) {
            v.mesh.position.y -= 0.5;
          } else {
            v.mesh.visible = false;
            v.mesh.position.y = deck.y;
          }
        }
      } else if (deck.kind === 'geyser' && deck.window) {
        const flame = v.mesh.userData.flame as THREE.Mesh | undefined;
        if (flame) {
          const active = dutyActive(deck.window, t);
          flame.visible = active;
          if (active) {
            // Rise through the eruption window: the jet grows as it vents.
            const flip = dutyTimeToFlip(deck.window, t);
            const total = deck.window.duty * deck.window.period;
            const grow = 1 + 1.6 * Math.min(1, Math.max(0, 1 - flip / Math.max(0.2, total)));
            flame.scale.set(1, grow, 1);
          }
        }
      }
    }
    for (const hv of hazardViews) {
      const { h } = hv;
      if (h.kind === 'spikes' || h.kind === 'darts') {
        hv.mesh.position.y = hv.base + (hazardActive(h, t) ? 0.9 : -0.15);
      } else if (h.kind === 'sweeper') {
        hv.mesh.rotation.y = -sweeperAngle(h, t);
      } else {
        const at = hazardPos(h, t);
        hv.mesh.position.x = at.x;
        hv.mesh.position.z = at.z;
        if (h.kind === 'boulder') hv.mesh.rotation.x += 0.12;
        else hv.mesh.rotation.y = displayTime * 6;
      }
    }
    for (const rv of ropeViews) {
      const offset = courseRopeOffset(instKey, rv.rope.id);
      const n = rv.planks.length - 1;
      for (let i = 0; i <= n; i++) {
        const at = courseRopePointAt(rv.rope, i / n, offset);
        rv.planks[i].position.set(at.x, at.y - 0.05, at.z);
        const ahead = courseRopePointAt(rv.rope, Math.min(1, (i + 1) / n), offset);
        rv.planks[i].rotation.y = Math.atan2(ahead.x - at.x, ahead.z - at.z);
      }
    }
    for (const gv of gemViews) {
      const mine = pid >= 0 && courseGemCollected(instKey, pid, gv.index);
      gv.orb.visible = !mine;
      if (!mine) {
        gv.orb.rotation.y = displayTime * 2.2;
        gv.orb.position.y = gv.baseY + Math.sin(displayTime * 2.6) * 0.12;
      }
    }
    const lit = pid >= 0 ? courseCheckpointFor(instKey, pid) : null;
    for (const bv of brazierViews) {
      const on = lit !== null && bv.b.index <= lit;
      bv.flame.visible = on;
      if (bv.light) bv.light.intensity = on ? 9 : 0;
    }
    for (const cv of conveyorChevrons) {
      // Travel the belt and wrap: speed matches the sim drift, so the belt
      // tells the truth about how hard it pushes.
      const speed = cv.pad.strength ?? 2.4;
      const span = Math.max(cv.pad.hw, cv.pad.hd) * 1.6;
      const u = (((displayTime * speed) / span + cv.phase) % 1) - 0.5;
      cv.chevron.position.set(
        cv.pad.x + (cv.pad.dirX ?? 0) * u * span,
        cv.pad.y + 0.12,
        cv.pad.z + (cv.pad.dirZ ?? 0) * u * span,
      );
    }
  };
}
