// Per-frame Thornhollow Fields flag/rune animation + state-transition bursts. The
// renderer constructs one and calls update(time) from the live sync() fx block
// each frame; all math and the transition classifier live in
// battleground_fx_core (pure, Node-tested). This module only touches child
// objects the props builder handed it via `group.userData.bg` (BgObjectRefs):
// the group's own position/rotation stay renderer-owned, so there is nothing
// to fight.
//
// Flag state comes from bgInfo (the IWorld battleground facet), which is
// non-null exactly while the local player is in a match. Outside a match the
// pass early-returns before touching a single view, so the open world pays
// one null check per frame. A flag whose view was not seen this frame has its
// track dropped, so a view that churns out and back can never fire a
// celebration burst for a transition nobody watched.
import * as THREE from 'three';
import { BG_TEAM_COLORS } from '../sim/battleground_layout';
import {
  BATTLE_RUNE_AURA_ID,
  RUNE_VISUALS,
  SPRINT_RUNE_AURA_ID,
  WARD_RUNE_AURA_ID,
} from '../sim/social/battleground';
import type { BgInfo } from '../world_api/battleground';
import {
  BG_CARRY_BACK,
  BG_CARRY_RAISE,
  BG_CARRY_TILT,
  type BgFlagState,
  classifyFlagTransition,
  runeGemPose,
} from './battleground_fx_core';
import type { BgObjectRefs } from './battleground_props';
import { type DashedRingSpec, dashedRingGeometry, paddedOutlineDuty } from './dashed_ring_core';
import type { Vfx } from './vfx';

// Identity rings: a flat DASHED ring at every match player's feet. Custom
// nameplates make plate color unreliable, so ally-vs-enemy must read from the
// WORLD; the ring is actionable information and draws on every tier, ungated by
// quality (only cosmetic richness may be tier-shed). Colors are RELATIVE, not
// team-keyed (owner direction): red always means enemy and green always means
// ally, whatever your team's banner color, because the red-is-hostile
// convention outranks team identity at a glance. A dark underlay ring sits
// beneath the color so the mark holds on pale ground.
//
// Why DASHED, and thinner than it started: the solid ring at a unit's feet is
// already taken. renderer.ts draws the target reticle as a solid, pulsing,
// bloom-boosted annulus, and that is the sole visual language for "this is my
// target". A second solid red ring under every hostile in the match read as the
// same signal, so the whole enemy team looked targeted at once. Splitting the
// identity mark into dashes separates the two by SHAPE, which survives distance,
// color-vision differences, and bloom in a way a hue or opacity difference does
// not; the target reticle is left exactly as it was. The geometry math is the
// pure, Node-tested dashed_ring_core; this module only pools the result.
export const BG_RING_ALLY = 0x3fd06a;
export const BG_RING_ENEMY = 0xe8392b;
// Thinner than the old 0.55-to-0.74 annulus, thinned INWARD so the mark keeps
// its original footprint (players read the ring's outer edge as the unit's
// ground circle) while the stroke stops competing with the reticle's weight.
// 0.09 rather than the first pass's 0.12: still legible at fighting distance on
// every tier, but light enough that the identity mark reads as a hint under the
// feet instead of a second reticle.
const TEAM_RING_INNER = 0.65;
const TEAM_RING_OUTER = 0.74;
// 12 dashes at a 0.55 duty: each dash is roughly 0.2 yd of arc against a 0.16 yd
// gap, so it stays comfortably longer than the 0.09 yd stroke is thick (a dash
// shorter than it is wide reads as a dotted smear) while the gaps are wide
// enough not to close up into a solid ring at fighting distance.
export const BG_RING_DASH_SPEC: DashedRingSpec = {
  inner: TEAM_RING_INNER,
  outer: TEAM_RING_OUTER,
  dashes: 12,
  duty: 0.55,
  segments: 4,
};
const TEAM_RING_OPACITY = 0.95;
const RING_UNDERLAY_PAD = 0.035; // a thin dark outline, not a fat rim (playtest note)
const RING_UNDERLAY_OPACITY = 0.4;

const CAPTURE_GOLD = 0xffd24a;
const RETURN_GREEN = 0x9fdc7f;
const PICKUP_WHITE = 0xffffff;

// Burst anchor scratch: fireworkBurst reads at.x/y/z synchronously and keeps
// no reference, so one module-level vector serves every transition frame.
const tmpV = new THREE.Vector3();

// The one Three-side step the pure core leaves: wrap its arrays in a geometry.
// Position + index only; a MeshBasicMaterial with no map needs no normals or
// uvs, and the ring lies in the XY plane exactly like the RingGeometry it
// replaced, so the caller's rotation.x = -PI/2 is unchanged.
function dashedGeometry(spec: DashedRingSpec): THREE.BufferGeometry {
  const { positions, indices } = dashedRingGeometry(spec);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

interface ViewLike {
  group: THREE.Group;
}

interface FlagTrack {
  state: BgFlagState;
  x: number;
  y: number;
  z: number;
  yaw: number; // last applied lean yaw, held across carrier-view gaps
}

export class BattlegroundFx {
  // Last observed state + world position per flag (indexed by home team);
  // the position is last frame's, which is exactly the burst anchor a
  // capture/return needs (the entity has already snapped home this frame).
  private tracks: [FlagTrack | null, FlagTrack | null] = [null, null];

  // Per-player last rune-swirl time: the subtle colored aura on a rune buff
  // is a periodic wisp ring, not a per-frame emitter.
  private lastSwirl = new Map<number, number>();

  // One identity ring per visible match player (shared geometries + three
  // shared materials); reparented as views churn, torn down with the match.
  // Keyed by pid; the boolean remembers ally-ness so a rebuilt group is only
  // needed when the relative side would change (it cannot mid-match).
  private teamRings = new Map<number, THREE.Group>();
  /** Scratch for the ring pass's "still on the roster" set. Reused and cleared
   *  per frame: a fresh Set every frame is garbage on the render hot path. */
  private ringSeen = new Set<number>();
  private ringGeo: THREE.BufferGeometry | null = null;
  private ringUnderlayGeo: THREE.BufferGeometry | null = null;
  private ringMats: {
    ally: THREE.MeshBasicMaterial;
    enemy: THREE.MeshBasicMaterial;
    under: THREE.MeshBasicMaterial;
  } | null = null;

  constructor(
    private readonly sim: {
      bgInfo: BgInfo | null;
      entities: ReadonlyMap<number, { auras: readonly { id: string }[] }>;
    },
    private readonly views: Map<number, ViewLike>,
    private readonly vfx: Vfx,
  ) {}

  update(time: number): void {
    const match = this.sim.bgInfo?.match ?? null;
    if (!match) {
      // Open world / queue screen: no bg objects exist, pay nothing.
      this.tracks[0] = null;
      this.tracks[1] = null;
      if (this.lastSwirl.size > 0) this.lastSwirl.clear();
      this.clearTeamRings();
      return;
    }
    this.runeAuraSwirls(match, time);
    this.teamRingPass(match);
    const seen = [false, false];
    for (const view of this.views.values()) {
      const bg = view.group.userData.bg as BgObjectRefs | undefined;
      if (!bg) continue;
      if (bg.kind === 'rune') {
        const pose = runeGemPose(time);
        bg.gem.rotation.y = pose.spin;
        bg.gem.position.y = bg.gemBaseY + pose.bob;
        // The bespoke kit is GPU-driven off sharedUniforms.uTime; this call is
        // only the light pulse and the Ward shard yaw (battleground_rune_vfx).
        bg.vfx?.update(time);
        continue;
      }
      const flag = match.flags[bg.team];
      if (!flag) continue;
      seen[bg.team] = true;
      const carried = flag.state === 'carried';
      const prev = this.tracks[bg.team];
      let yaw = 0;
      if (carried) {
        const carrierView = flag.carrierPid !== null ? this.views.get(flag.carrierPid) : undefined;
        // Yaw the lean pivot to the carrier's facing (group yaw is the flag
        // entity's own facing, effectively 0), then tip it back. When the
        // carrier's view is momentarily absent, hold the last yaw instead of
        // snapping to world north.
        yaw =
          carrierView !== undefined
            ? carrierView.group.rotation.y - view.group.rotation.y
            : (prev?.yaw ?? 0);
        bg.lean.rotation.y = yaw;
        bg.lean.rotation.x = -BG_CARRY_TILT;
        // Mount the pole on the carrier's BACK (offset behind the body along
        // facing, slightly raised), so it reads as a strapped war banner
        // instead of sprouting from the head. No bob: the tiny fast bounce
        // read as jitter against the walk cycle. The mount pins to the
        // carrier's VIEW position each frame: the flag entity itself moves at
        // tick rate, and at sprint speeds (worst in the fast beast forms,
        // e.g. the spirit wolf) that gap read as the banner trailing the
        // body instead of riding it.
        const cp = carrierView?.group.position ?? null;
        const gp = view.group.position;
        const dx = cp ? cp.x - gp.x : 0;
        const dy = cp ? cp.y - gp.y : 0;
        const dz = cp ? cp.z - gp.z : 0;
        bg.lean.position.set(
          dx - Math.sin(yaw) * BG_CARRY_BACK,
          BG_CARRY_RAISE + dy,
          dz - Math.cos(yaw) * BG_CARRY_BACK,
        );
      } else {
        bg.lean.rotation.y = 0;
        bg.lean.rotation.x = 0;
        bg.lean.position.set(0, 0, 0);
      }
      const pos = view.group.position;
      const fx = classifyFlagTransition(prev?.state ?? null, flag.state);
      if (fx === 'pickup') {
        this.vfx.fireworkBurst(
          tmpV.set(pos.x, pos.y + 1.4, pos.z),
          [bg.color, PICKUP_WHITE],
          20,
          0.8,
        );
      } else if (fx === 'capture' && prev) {
        // The burst belongs where the score happened: the carrier's stand,
        // i.e. the flag's position last frame, in the CAPTURING team's color.
        this.vfx.fireworkBurst(
          tmpV.set(prev.x, prev.y + 2, prev.z),
          [BG_TEAM_COLORS[1 - bg.team], CAPTURE_GOLD],
          60,
          1.5,
        );
      } else if (fx === 'return' && prev) {
        this.vfx.fireworkBurst(
          tmpV.set(prev.x, prev.y + 1.2, prev.z),
          [bg.color, RETURN_GREEN],
          14,
          0.6,
        );
      }
      this.tracks[bg.team] = { state: flag.state, x: pos.x, y: pos.y, z: pos.z, yaw };
    }
    // A flag view missing this frame (interest churn, rebuild) invalidates its
    // track: transitions across the gap were not observed, so they never burst.
    if (!seen[0]) this.tracks[0] = null;
    if (!seen[1]) this.tracks[1] = null;
  }

  // The subtle character color for an active rune buff: a periodic wisp ring
  // in the rune's own color around each buffed participant (~every 0.8s).
  private runeAuraSwirls(match: NonNullable<BgInfo['match']>, time: number): void {
    for (const row of match.players) {
      const e = this.sim.entities.get(row.pid);
      const aura = e?.auras.find(
        (a) =>
          a.id === SPRINT_RUNE_AURA_ID ||
          a.id === BATTLE_RUNE_AURA_ID ||
          a.id === WARD_RUNE_AURA_ID,
      );
      if (!aura) {
        this.lastSwirl.delete(row.pid);
        continue;
      }
      const last = this.lastSwirl.get(row.pid);
      if (last !== undefined && time - last < 0.8) continue;
      this.lastSwirl.set(row.pid, time);
      const color =
        aura.id === SPRINT_RUNE_AURA_ID
          ? RUNE_VISUALS.sprint.color
          : aura.id === BATTLE_RUNE_AURA_ID
            ? RUNE_VISUALS.damage.color
            : RUNE_VISUALS.defense.color;
      this.vfx.buffSwirl(row.pid, color);
    }
  }

  // The per-player identity ring pass: ensure a ring rides every visible
  // match player's group (green ally / red enemy, relative to MY team; hidden
  // on a corpse), and drop rings whose player left the roster or scoped out.
  private teamRingPass(match: NonNullable<BgInfo['match']>): void {
    const seen = this.ringSeen;
    seen.clear();
    for (const row of match.players) {
      const view = this.views.get(row.pid);
      if (!view) continue;
      seen.add(row.pid);
      let ring = this.teamRings.get(row.pid);
      if (!ring) {
        ring = this.buildRing(row.team === match.myTeam);
        this.teamRings.set(row.pid, ring);
      }
      if (ring.parent !== view.group) view.group.add(ring);
      ring.visible = !row.dead;
    }
    for (const [pid, ring] of this.teamRings) {
      if (seen.has(pid)) continue;
      ring.parent?.remove(ring);
      this.teamRings.delete(pid);
    }
  }

  private buildRing(ally: boolean): THREE.Group {
    const mats = this.ringMaterials();
    const group = new THREE.Group();
    const under = new THREE.Mesh(this.ringUnderlayGeometry(), mats.under);
    const color = new THREE.Mesh(this.ringGeometry(), ally ? mats.ally : mats.enemy);
    under.renderOrder = 2;
    color.renderOrder = 3;
    for (const m of [under, color]) {
      m.rotation.x = -Math.PI / 2;
      group.add(m);
    }
    under.position.y = 0.05;
    color.position.y = 0.06;
    return group;
  }

  private clearTeamRings(): void {
    if (this.teamRings.size === 0) return;
    for (const ring of this.teamRings.values()) ring.parent?.remove(ring);
    this.teamRings.clear();
  }

  private ringGeometry(): THREE.BufferGeometry {
    if (!this.ringGeo) this.ringGeo = dashedGeometry(BG_RING_DASH_SPEC);
    return this.ringGeo;
  }

  // The underlay is dashed TOO, on the same cadence: a solid dark ring behind
  // the dashes would put the very silhouette back that the dashes remove, and
  // the mark would read as a targeted unit again from any distance where the
  // color layer thins out. It is padded on all four sides (both radii and both
  // dash ends), so every dash gets a full dark rim instead of meeting bare
  // ground where it is thinnest.
  private ringUnderlayGeometry(): THREE.BufferGeometry {
    if (!this.ringUnderlayGeo) {
      const duty = paddedOutlineDuty(BG_RING_DASH_SPEC, RING_UNDERLAY_PAD);
      const cell = (Math.PI * 2) / BG_RING_DASH_SPEC.dashes;
      this.ringUnderlayGeo = dashedGeometry({
        ...BG_RING_DASH_SPEC,
        inner: TEAM_RING_INNER - RING_UNDERLAY_PAD,
        outer: TEAM_RING_OUTER + RING_UNDERLAY_PAD,
        duty,
        // Re-center the widened dash on the color dash it backs.
        phase: -((duty - BG_RING_DASH_SPEC.duty) * cell) / 2,
      });
    }
    return this.ringUnderlayGeo;
  }

  private ringMaterials(): NonNullable<BattlegroundFx['ringMats']> {
    if (!this.ringMats) {
      const mat = (color: number, opacity: number) =>
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
      this.ringMats = {
        ally: mat(BG_RING_ALLY, TEAM_RING_OPACITY),
        enemy: mat(BG_RING_ENEMY, TEAM_RING_OPACITY),
        under: mat(0x000000, RING_UNDERLAY_OPACITY),
      };
    }
    return this.ringMats;
  }
}
