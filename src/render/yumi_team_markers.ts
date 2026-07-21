// Protect Yumi team identity on the fighters themselves: a small blue/red
// arrow floating above every participant's head (bobbing + slowly spinning
// so it reads as a badge, not combat state; a ground ring was tried first
// and read like a target/aggro indicator on enemies being attacked). The
// roster comes from arenaInfo.match.yumi (both team scoreboards carry every
// pid), so all ten fighters read at a glance for EVERY viewer, on every
// graphics tier (team identity is actionable info).
//
// Owned by the renderer as a tiny per-frame manager: renderer.ts calls
// update() once per frame next to the maze views; everything else lives
// here (module-first, no EntityView field changes). The bob/spin clock is
// performance.now, render-side presentation timing only.
import * as THREE from 'three';
import type { IWorld } from '../world_api';

const TEAM_BLUE = 0x2f6fe0;
const TEAM_RED = 0xd8342c;
// A downward-pointing cone above the head, under the DOM nameplate.
const ARROW_RADIUS = 0.2;
const ARROW_HEIGHT = 0.38;
const ARROW_BASE_Y = 3.2; // well clear of the tallest hats/helmets
const ARROW_BOB = 0.07;
const ARROW_BOB_HZ = 1.6; // slow float
const ARROW_SPIN_HZ = 0.35; // slow turn, reads 3D from every angle

interface MarkerEntry {
  mesh: THREE.Mesh;
  team: 'A' | 'B';
  group: THREE.Group;
  phase: number; // per-fighter bob offset so a squad does not pump in sync
}

/** The minimal slice of the renderer's per-entity view the markers need. */
export interface MarkerHostView {
  group: THREE.Group;
}

export class YumiTeamMarkers {
  private readonly markers = new Map<number, MarkerEntry>();
  private readonly geo = new THREE.ConeGeometry(ARROW_RADIUS, ARROW_HEIGHT, 6);
  private readonly mats = {
    A: new THREE.MeshBasicMaterial({ color: TEAM_BLUE }),
    B: new THREE.MeshBasicMaterial({ color: TEAM_RED }),
  } as const;

  update(world: IWorld, views: ReadonlyMap<number, MarkerHostView>): void {
    const yumi = world.arenaInfo?.match?.yumi;
    if (!yumi) {
      if (this.markers.size > 0) this.clear();
      return;
    }
    // Mark-and-sweep against the roster so a leaver's arrow goes with them.
    for (const [pid, entry] of this.markers) {
      const view = views.get(pid);
      if (!view || view.group !== entry.group) {
        entry.mesh.removeFromParent();
        this.markers.delete(pid);
      }
    }
    const ensure = (pid: number, team: 'A' | 'B') => {
      const view = views.get(pid);
      if (!view) return;
      const existing = this.markers.get(pid);
      if (existing && existing.team === team && existing.group === view.group) return;
      if (existing) existing.mesh.removeFromParent();
      const mesh = new THREE.Mesh(this.geo, this.mats[team]);
      mesh.rotation.x = Math.PI; // point DOWN at the fighter
      mesh.position.y = ARROW_BASE_Y;
      view.group.add(mesh);
      this.markers.set(pid, { mesh, team, group: view.group, phase: (pid % 7) * 0.9 });
    };
    for (const p of yumi.teamA) ensure(p.pid, 'A');
    for (const p of yumi.teamB) ensure(p.pid, 'B');
    // Gentle float + slow spin (UI presentation timing, not sim state).
    const t = performance.now() / 1000;
    for (const entry of this.markers.values()) {
      entry.mesh.position.y =
        ARROW_BASE_Y + Math.sin((t + entry.phase) * ARROW_BOB_HZ * Math.PI * 2) * ARROW_BOB;
      entry.mesh.rotation.y = t * ARROW_SPIN_HZ * Math.PI * 2;
    }
  }

  clear(): void {
    for (const entry of this.markers.values()) entry.mesh.removeFromParent();
    this.markers.clear();
  }
}
