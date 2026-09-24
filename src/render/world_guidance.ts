// The world's personal ground guidance, relocated without changing race/island
// ordering or the entity-loop's NPC fizz admission. No sim writes.
import type * as THREE from 'three';
import type { IWorld } from '../world_api';
import { CannonEncounterVisual } from './cannon_encounter_visual';
import { GliderCourseVisual } from './glider_course_visual';
import { IslandGuidance } from './island_guidance';
import { MountBeacon } from './mount_beacon';
import { RaceLine } from './race_line';
import { ShadowInfiltrationVisual } from './shadow_infiltration_visual';
import { WispMazeVisual } from './wisp_maze_visual';
import { WorldQuestTraceVisual } from './world_quest_trace_visual';

export class WorldGuidance {
  readonly readyForEntry: Promise<void>;
  private readonly race: RaceLine;
  private readonly mount: MountBeacon;
  private readonly island: IslandGuidance;
  private readonly trace: WorldQuestTraceVisual;
  private readonly cannon: CannonEncounterVisual;
  private readonly glider: GliderCourseVisual;
  private readonly shadow: ShadowInfiltrationVisual;
  private readonly wispMaze: WispMazeVisual;

  constructor(
    scene: THREE.Object3D,
    groundAt: (x: number, z: number) => number,
    compileGate?: (target: THREE.Object3D, requiredForEntry?: boolean) => Promise<unknown>,
    isQuestTracked?: (questId: string) => boolean,
    isEastbrookGuidanceEnabled?: () => boolean,
  ) {
    // Show-jumping racing line: self-scoped course guidance, hidden outside the
    // player's own race (driven per frame from world.mountRaceView() below).
    this.race = new RaceLine(scene, groundAt);
    // Riding-lesson start platform: the glowing square behind the start arch.
    this.mount = new MountBeacon(scene, groundAt);
    // The Proving Shore's guidance: beacon fizz, route ribbon, target ring.
    this.island = new IslandGuidance(
      scene,
      groundAt,
      compileGate,
      isQuestTracked,
      isEastbrookGuidanceEnabled,
    );
    // Unlike an untimed coach ribbon, a hidden six-second preview has no
    // actionable stand-in. Run its gate before first paint and include it in
    // the required-landmark entry barrier on every graphics profile.
    this.trace = new WorldQuestTraceVisual(
      scene,
      groundAt,
      compileGate && ((root) => compileGate(root, true)),
    );
    this.cannon = new CannonEncounterVisual(
      scene,
      groundAt,
      compileGate && ((root) => compileGate(root, true)),
    );
    this.glider = new GliderCourseVisual(
      scene,
      groundAt,
      compileGate && ((root) => compileGate(root, true)),
    );
    this.shadow = new ShadowInfiltrationVisual(
      scene,
      groundAt,
      compileGate && ((root) => compileGate(root, true)),
    );
    this.wispMaze = new WispMazeVisual(
      scene,
      groundAt,
      compileGate && ((root) => compileGate(root, true)),
    );
    this.readyForEntry = Promise.all([
      this.wispMaze.readyForEntry,
      this.shadow.readyForEntry,
      this.trace.readyForEntry,
      this.cannon.readyForEntry,
      this.glider.readyForEntry,
    ]).then(() => {});
  }

  npcFizz(...args: Parameters<IslandGuidance['npcFizz']>): void {
    this.island.npcFizz(...args);
  }

  update(
    world: IWorld,
    time: number,
    dt: number,
    reducedMotion = false,
    renderedSelf?: { group: Pick<THREE.Object3D, 'position' | 'rotation'> },
  ): void {
    // Racing line (cosmetic; reads the self race view only).
    this.race.update(world.mountRaceView(), time, dt);
    // Island guidance trail (actionable on every tier; island-gated inside).
    this.island.update(world, time, dt);
    // Start platform: visible while the riding quest is active and no race is live.
    this.mount.update(
      world.questState('q_riding_lessons') === 'active' && !world.mountRaceView(),
      time,
    );
    this.trace.update(world);
    this.cannon.update(world.vehicleSession, dt, reducedMotion);
    this.glider.update(world, renderedSelf?.group);
    this.shadow.update(world);
    this.wispMaze.update(world, reducedMotion);
  }

  dispose(): void {
    this.trace.dispose();
    this.cannon.dispose();
    this.glider.dispose();
    this.shadow.dispose();
    this.wispMaze.dispose();
  }
}
