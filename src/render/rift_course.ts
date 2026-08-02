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

const EMBER = 0xff8a3e;
const ARCANE = 0x8f6fe8;
const GEM = 0x4fd8c8;

/**
 * Build one floor's course into `group` (the interior group, instance-local
 * frame with the floor at y 0). Returns the per-frame tick.
 */
export function buildRiftCourseFeatures(
  group: THREE.Group,
  plan: CoursePlan,
  instKey: string,
  lowGfx: boolean,
  localPid: () => number,
): (displayTime: number) => void {
  const deckMat = new THREE.MeshLambertMaterial({ color: 0x4a4038 });
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
      const drum = new THREE.Mesh(
        new THREE.CylinderGeometry(
          Math.min(deck.hw, deck.hd),
          Math.min(deck.hw, deck.hd) * 1.1,
          0.5,
          10,
        ),
        bandMat,
      );
      drum.position.y = -0.25;
      body.add(drum);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(Math.min(deck.hw, deck.hd) * 0.6, 2.6, 8),
        new THREE.MeshBasicMaterial({
          color: EMBER,
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      flame.position.y = 1.3;
      flame.visible = false;
      body.add(flame);
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
      for (let a = -1; a <= 1; a++) {
        const arrow = new THREE.Mesh(
          new THREE.ConeGeometry(0.28, 0.7, 4),
          new THREE.MeshBasicMaterial({ color: 0xc8ecf5 }),
        );
        arrow.rotation.z = -Math.PI / 2;
        arrow.rotation.y = Math.atan2(pad.dirZ ?? 0, pad.dirX ?? 1);
        arrow.position.set(
          pad.x + a * 1.4 * (pad.dirX ?? 1),
          pad.y + 0.14,
          pad.z + a * 1.4 * (pad.dirZ ?? 0),
        );
        group.add(arrow);
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
    const orb = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.42),
      new THREE.MeshBasicMaterial({ color: GEM, transparent: true, opacity: 0.9 }),
    );
    orb.position.set(gem.x, gem.y, gem.z);
    group.add(orb);
    return { index, orb, baseY: gem.y };
  });
  const brazierViews = plan.braziers.map((b) => {
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.32, 0.6, 8), bandMat);
    bowl.position.set(b.x, b.y + 0.3, b.z);
    group.add(bowl);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.34, 0.9, 6),
      new THREE.MeshBasicMaterial({
        color: EMBER,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    flame.position.set(b.x, b.y + 1.0, b.z);
    flame.visible = false;
    group.add(flame);
    return { b, flame };
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
        if (flame) flame.visible = dutyActive(deck.window, t);
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
      bv.flame.visible = lit !== null && bv.b.index <= lit;
    }
  };
}
