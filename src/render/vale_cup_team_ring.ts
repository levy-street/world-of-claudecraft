// Team glow rings for the Vale Cup boarball match (docs/prd/vale-cup.md): a soft
// colored disc draped on the pitch under every live match fighter so ally vs
// enemy is readable at a glance, with a brighter self ring so you can find your
// own footing in the scrum. Built once (a small pooled set, 5v5 cap), driven each
// frame from IWorld's cupInfo.match; it reads ONLY the world snapshot so it works
// identically offline and online (the ClientWorld mirror carries the same roster
// pids the client has entities for).
//
// Palette is the FIXED ally-green / enemy-red / self-gold semantic, NOT raw nation
// color: two nations that fly similar banners must still read as two teams, and
// green/red/gold is the fastest-parsed, clash-proof convention (the away palette
// only fixes the flags). This is gameplay-readable info, so the ring shows on every
// tier (Lambert low included); only the bloom-boost overshoot is tier-shed.
//
// Draping honors the "terrain height = sim height" invariant via drapeRingLocalY
// (selection_ring.ts). Geometry/material are pooled and reused; the per-frame path
// allocates nothing.
import * as THREE from 'three';
import type { VcMatchInfo, VcRosterPlayer } from '../world_api/vale_cup';
import { drapeRingLocalY, type HeightSampler } from './selection_ring';
import { nationColors } from './vale_cup_flags';

// 5v5 is the largest bracket, so ten rings covers every roster with headroom.
const MAX_RINGS = 10;
const RING_RADIUS = 1.15; // world yards; a fighter-footprint disc
const SELF_RADIUS = 1.5; // the local player's own ring is bigger + brighter
const LIFT = 0.05; // sit just above the turf, matching the stadium VISUAL_LIFT
const RING_SEGMENTS = 40;

// Fixed team semantics (never raw nation color): ally green, enemy red, self gold.
const COLOR_ALLY = 0x2fe07a;
const COLOR_ENEMY = 0xff4a38;
const COLOR_SELF = 0xffd24a;
// Bloom-boost overshoot on the non-low tiers (matches SELECTION_RING_BOOST feel).
const BOOST = 1.5;

export interface ValeCupTeamRingsView {
  group: THREE.Group;
  /**
   * Redraw every match fighter's ground ring for this frame. `views` resolves a
   * roster pid to its live render node (the renderer's entity view map satisfies
   * it structurally); a fighter with no visible view (benched, absent, culled) is
   * skipped. `sample` is the ground-height sampler (groundHeight bound to the seed).
   */
  update(
    match: VcMatchInfo | null,
    time: number,
    dt: number,
    lowGfx: boolean,
    sample: HeightSampler,
    views: { get(id: number): { group: THREE.Object3D } | undefined },
  ): void;
  /** A quick expanding ground flash at a scored goal (team-colored). */
  flashGoal(x: number, z: number, color: number, sample: HeightSampler): void;
}

interface PooledRing {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  drapeY: Float32Array;
  lastX: number;
  lastZ: number;
  lastScale: number;
}

// Soft radial glow that peaks as a ring near the rim, tinted by material.color
// under additive blending (white texture * color). Module-owned canvas: textures.ts
// is off-limits (its shared LCG generation order is load-bearing).
function glowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  grd.addColorStop(0.0, 'rgba(255,255,255,0.16)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.42)');
  grd.addColorStop(0.82, 'rgba(255,255,255,1.0)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildValeCupTeamRings(): ValeCupTeamRingsView {
  const group = new THREE.Group();
  group.name = 'vale-cup-team-rings';
  group.visible = false;

  const tex = glowTexture();

  // Unit disc laid flat in XZ; each pooled ring clones it so it can drape its own
  // per-vertex Y. RingGeometry(0, 1) gives concentric rows the drape rides.
  const unit = new THREE.RingGeometry(0.0, 1.0, RING_SEGMENTS, 1);
  unit.rotateX(-Math.PI / 2);
  const unitPos = unit.getAttribute('position') as THREE.BufferAttribute;
  const vtx = unitPos.count;
  const localXZ = new Float32Array(vtx * 2);
  for (let i = 0; i < vtx; i++) {
    localXZ[i * 2] = unitPos.getX(i);
    localXZ[i * 2 + 1] = unitPos.getZ(i);
  }

  const rings: PooledRing[] = [];
  for (let i = 0; i < MAX_RINGS; i++) {
    const geo = unit.clone();
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      color: COLOR_ALLY,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; // draped: its baked bounding sphere goes stale
    mesh.renderOrder = 1; // above the turf, under the chalk lines (renderOrder 2)
    mesh.visible = false;
    group.add(mesh);
    rings.push({
      mesh,
      mat,
      drapeY: new Float32Array(vtx),
      lastX: Number.NaN,
      lastZ: Number.NaN,
      lastScale: Number.NaN,
    });
  }
  unit.dispose();

  // One pooled goal-flash ring (expands + fades on a score).
  const flashGeo = new THREE.RingGeometry(0.0, 1.0, RING_SEGMENTS, 1);
  flashGeo.rotateX(-Math.PI / 2);
  const flashMat = new THREE.MeshBasicMaterial({
    map: tex,
    color: COLOR_SELF,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const flashMesh = new THREE.Mesh(flashGeo, flashMat);
  flashMesh.frustumCulled = false;
  flashMesh.renderOrder = 1;
  flashMesh.visible = false;
  group.add(flashMesh);
  let flashAge = 0;
  let flashTtl = 0;
  const flashY = { base: 0 };

  // Spectator ring tints: nationColors() allocates a tuple, so resolve the two
  // banner colors only when the matchup changes, never per frame.
  let tintNationA = '';
  let tintNationB = '';
  let tintAway = false;
  let tintValid = false;
  let tintA = 0;
  let tintB = 0;

  const place = (
    ring: PooledRing,
    x: number,
    z: number,
    scale: number,
    color: number,
    boostedOpacity: number,
    sample: HeightSampler,
  ): void => {
    ring.mesh.visible = true;
    ring.mat.color.setHex(color);
    ring.mat.opacity = boostedOpacity;
    if (x !== ring.lastX || z !== ring.lastZ || scale !== ring.lastScale) {
      ring.lastX = x;
      ring.lastZ = z;
      ring.lastScale = scale;
      const gy = sample(x, z);
      ring.mesh.position.set(x, gy, z);
      ring.mesh.scale.setScalar(scale);
      const drape = drapeRingLocalY(localXZ, x, z, gy, scale, LIFT, sample, ring.drapeY);
      const pos = ring.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < drape.length; i++) pos.setY(i, drape[i]);
      pos.needsUpdate = true;
    }
  };

  const emitTeam = (
    roster: readonly VcRosterPlayer[],
    isViewerSide: boolean,
    spectatorColor: number | null,
    startIdx: number,
    time: number,
    lowGfx: boolean,
    sample: HeightSampler,
    views: { get(id: number): { group: THREE.Object3D } | undefined },
  ): number => {
    let idx = startIdx;
    // Gentle, out-of-phase pulses so the two teams' rings breathe independently.
    const teamPulse = 0.5 + 0.5 * Math.sin(time * 3.0 + (isViewerSide ? 0 : Math.PI));
    const selfPulse = 0.5 + 0.5 * Math.sin(time * 4.6);
    for (const rp of roster) {
      if (idx >= MAX_RINGS) break;
      const view = views.get(rp.pid);
      if (!view || !view.group.visible) continue;
      const p = view.group.position;
      const self = rp.me;
      // A PARTICIPANT reads the fixed ally-green / enemy-red / self-gold semantic
      // (isViewerSide encodes ally vs enemy, set by the caller). A neutral
      // SPECTATOR (no side) instead sees each team in its own banner color, so the
      // rings match the flags and the betting card's "Eastbrook vs Ogres" framing.
      const ally = isViewerSide;
      const color =
        spectatorColor !== null
          ? spectatorColor
          : self
            ? COLOR_SELF
            : ally
              ? COLOR_ALLY
              : COLOR_ENEMY;
      const scale = self ? SELF_RADIUS : RING_RADIUS;
      const pulse = self ? selfPulse : teamPulse;
      let opacity = (self ? 0.5 : 0.34) + (self ? 0.34 : 0.22) * pulse;
      if (!lowGfx) opacity *= BOOST;
      opacity = Math.min(1, opacity);
      place(rings[idx], p.x, p.z, scale, color, opacity, sample);
      idx++;
    }
    return idx;
  };

  return {
    group,
    update(match, time, dt, lowGfx, sample, views): void {
      // advance the goal flash regardless (it may outlive the match end frame)
      if (flashTtl > 0) {
        flashAge += dt;
        const f = flashAge / flashTtl;
        if (f >= 1) {
          flashTtl = 0;
          flashMesh.visible = false;
          flashMat.opacity = 0;
        } else {
          const s = 1.5 + f * 7.5;
          flashMesh.scale.setScalar(s);
          flashMesh.position.y = flashY.base;
          flashMat.opacity = (1 - f) * (lowGfx ? 0.7 : 0.95);
        }
      }

      if (!match) {
        group.visible = false;
        return;
      }
      group.visible = true;
      // A neutral spectator (no side) tints each team with its banner color so the
      // rings match the flags; a participant passes null and keeps ally/enemy/self.
      const spectator = match.team === null;
      if (
        spectator &&
        (!tintValid ||
          match.nationA !== tintNationA ||
          match.nationB !== tintNationB ||
          match.awayPalette !== tintAway)
      ) {
        tintNationA = match.nationA;
        tintNationB = match.nationB;
        tintAway = match.awayPalette;
        tintValid = true;
        tintA = nationColors(match.nationA, false)[0];
        tintB = nationColors(match.nationB, match.awayPalette)[0];
      }
      const colorA = spectator ? tintA : null;
      const colorB = spectator ? tintB : null;
      let idx = emitTeam(match.teamA, match.team !== 'B', colorA, 0, time, lowGfx, sample, views);
      idx = emitTeam(match.teamB, match.team === 'B', colorB, idx, time, lowGfx, sample, views);
      for (; idx < MAX_RINGS; idx++) rings[idx].mesh.visible = false;
    },
    flashGoal(x, z, color, sample): void {
      const gy = sample(x, z);
      flashY.base = gy + LIFT + 0.02;
      flashMesh.position.set(x, flashY.base, z);
      flashMesh.scale.setScalar(1.5);
      flashMat.color.setHex(color);
      flashMesh.visible = true;
      flashAge = 0;
      flashTtl = 0.7;
    },
  };
}
