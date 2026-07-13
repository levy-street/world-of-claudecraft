// The starter tutorial's staged scenes: the cinematic moments on Dawnhaven Isle.
//
// This is the HOST half of the tutorial (the pure camera math is
// tutorial_cinematic.ts, the step machine is src/ui/starter_tutorial_core.ts). It
// is the one place that is allowed to touch the concrete offline Sim, the input
// camera and the renderer at once, because main.ts constructs it and hands it to
// the HUD as an opaque hook bag: `src/ui/` still only ever sees IWorld, exactly
// like the fiesta-practice hook already does.
//
// What a scene is: the camera leaves the player's shoulder, glides in on
// something, holds while a CUE fires (an entity is staged in, a burst of VFX pops)
// and glides back. Four of them:
//
//   wardenReveal - the empty shrine on the knoll; the Warden materializes on it.
//   yardReveal   - fires the instant the player takes her task, so the camera
//                  TRAVELS: it sweeps east off their shoulder onto an empty
//                  practice yard, and the three dummies land in it.
//   wolfReveal   - the brush at the lip of the hollow; the first strand wolf
//                  explodes out of it. This is the player's first real enemy, and
//                  the beat the Warden narrates ("that is a mob").
//   finale       - a slow orbit as the Warden hands over the reward.
//
// Every reveal stages something that WAS NOT THERE. That is deliberate and it is
// the difference between a reveal and a camera move: nothing on this isle stands
// around waiting to be panned across.
//
// Accessibility: `reduceMotion` is honored the way the spawn cinematic honors it.
// A reduce-motion player gets NO camera movement at all, but every cue still fires
// immediately, so the Warden and the wolf still appear and the tutorial can never
// dead-end on a scene that was skipped.

import {
  DAWNHAVEN_AMBUSH,
  DAWNHAVEN_DUMMY_POSTS,
  DAWNHAVEN_WARDEN_POS,
  DAWNHAVEN_YARD,
} from '../sim/content/tutorial';
import {
  chasePose,
  cuesBetween,
  frameSubject,
  type Scene,
  type ShotPose,
  scenePose,
  type Vec3Like,
} from './tutorial_cinematic';

export type TutorialSceneId = 'wardenReveal' | 'yardReveal' | 'wolfReveal' | 'finale';

/** Everything a scene needs from the host, injected so this module never imports
 *  the Renderer, the Sim or the Input directly (and a Vitest can drive it). */
export interface TutorialSceneDeps {
  playerPos(): Vec3Like;
  /** The live chase-camera orbit knobs, so a scene opens and lands without a cut. */
  cameraOrbit(): { yaw: number; pitch: number; dist: number };
  /** Write the free-camera override, or null to hand control back to the chase cam. */
  setFreeCam(pose: ShotPose | null): void;
  /** Lock player movement while a scene runs. */
  suspendInput(suspended: boolean): void;
  /** Stage an entity at an exact spot; returns its entity id. */
  spawnMob(templateId: string, x: number, z: number, facing: number): number | null;
  /** `facing` omitted = the NPC's own authored facing (see sim/tutorial_stage.ts). */
  spawnNpc(npcId: string, x: number, z: number, facing?: number): number | null;
  /** Pop a burst of school-colored VFX on an entity. */
  burst(entityId: number, school: string): void;
  /** True when the player has asked for reduced motion (OS query or in-game switch). */
  reduceMotion(): boolean;
  /** Ground height at a spot, so a camera eye never buries itself in a hill. */
  groundY(x: number, z: number): number;
}

const WARDEN_NPC_ID = 'dawnhaven_warden';
const WOLF_MOB_ID = 'dawnhaven_strandwolf';
const DUMMY_MOB_ID = 'dawnhaven_dummy';

// Cue names. A cue fires exactly once, when its shot begins.
const CUE_SPAWN_WARDEN = 'spawnWarden';
const CUE_SPAWN_DUMMIES = 'spawnDummies';
const CUE_SPAWN_WOLF = 'spawnWolf';

export class TutorialScenePlayer {
  private scene: Scene | null = null;
  private sceneId: TutorialSceneId | null = null;
  private startedAt: number | null = null;
  private lastElapsed = 0;
  private readonly played = new Set<TutorialSceneId>();

  constructor(private readonly deps: TutorialSceneDeps) {}

  /** The scene running right now, or null. The HUD panel reads this to swap in the
   *  Warden's narration line while a reveal is on screen. */
  get active(): TutorialSceneId | null {
    return this.sceneId;
  }

  hasPlayed(id: TutorialSceneId): boolean {
    return this.played.has(id);
  }

  /** Start a scene, once. A second request for the same scene is a no-op, as is
   *  any request while another scene is still running. */
  play(id: TutorialSceneId, nowSec: number): void {
    if (this.played.has(id) || this.scene !== null) return;
    this.played.add(id);

    const scene = this.buildScene(id);

    // Reduce motion: no camera movement at all, but every cue fires now, so the
    // staged entities still arrive and the tutorial stays completable.
    if (this.deps.reduceMotion()) {
      for (const shot of scene.shots) {
        if (shot.cue !== undefined) this.fireCue(shot.cue);
      }
      return;
    }

    this.scene = scene;
    this.sceneId = id;
    this.startedAt = nowSec;
    this.lastElapsed = -1; // so a cue on the very first shot (t=0) still fires
    this.deps.suspendInput(true);
  }

  /** Drive the running scene. Called every frame by main.ts, after the follow
   *  camera updates and before the renderer reads it, so the scene pose wins. */
  tick(nowSec: number): void {
    if (!this.scene || this.startedAt === null) return;
    const elapsed = nowSec - this.startedAt;

    for (const cue of cuesBetween(this.lastElapsed, elapsed, this.scene)) this.fireCue(cue);
    this.lastElapsed = elapsed;

    const pose = scenePose(elapsed, this.scene);
    this.deps.setFreeCam({ eye: pose.eye, target: pose.target });
    if (pose.done) this.end();
  }

  /** Cut the scene short (Escape, or a burst of taps on touch). Every cue that has
   *  not fired yet fires now, so skipping can never strand the tutorial. */
  skip(): void {
    if (!this.scene) return;
    for (const cue of cuesBetween(this.lastElapsed, Number.POSITIVE_INFINITY, this.scene)) {
      this.fireCue(cue);
    }
    this.end();
  }

  /** Safety net: the reveals are what put the Warden and the wolf in the world, so
   *  if a scene was somehow never reached, stage the entity anyway rather than let
   *  the player stand in front of an empty shrine. */
  forceCue(id: TutorialSceneId): void {
    if (this.played.has(id)) return;
    this.played.add(id);
    for (const shot of this.buildScene(id).shots) {
      if (shot.cue !== undefined) this.fireCue(shot.cue);
    }
  }

  private end(): void {
    this.scene = null;
    this.sceneId = null;
    this.startedAt = null;
    this.deps.setFreeCam(null);
    this.deps.suspendInput(false);
  }

  private fireCue(cue: string): void {
    if (cue === CUE_SPAWN_WARDEN) {
      // No facing override: her NpcDef already says which way she looks (down the
      // path the player walks up), and that record is the one source of truth.
      const id = this.deps.spawnNpc(WARDEN_NPC_ID, DAWNHAVEN_WARDEN_POS.x, DAWNHAVEN_WARDEN_POS.z);
      if (id !== null) this.deps.burst(id, 'holy');
      return;
    }
    if (cue === CUE_SPAWN_DUMMIES) {
      // All three land together, each with its own pop. They face back down the row
      // toward the player, who is standing at the Warden's knoll watching this.
      const p = this.deps.playerPos();
      for (const post of DAWNHAVEN_DUMMY_POSTS) {
        const facing = Math.atan2(p.x - post.x, p.z - post.z);
        const id = this.deps.spawnMob(DUMMY_MOB_ID, post.x, post.z, facing);
        if (id !== null) this.deps.burst(id, 'arcane');
      }
      return;
    }
    if (cue === CUE_SPAWN_WOLF) {
      // Faces the player it is about to charge.
      const p = this.deps.playerPos();
      const facing = Math.atan2(p.x - DAWNHAVEN_AMBUSH.x, p.z - DAWNHAVEN_AMBUSH.z);
      const id = this.deps.spawnMob(WOLF_MOB_ID, DAWNHAVEN_AMBUSH.x, DAWNHAVEN_AMBUSH.z, facing);
      if (id !== null) this.deps.burst(id, 'nature');
    }
  }

  private at(x: number, z: number, lift: number): Vec3Like {
    return { x, y: this.deps.groundY(x, z) + lift, z };
  }

  private open(): ShotPose {
    return chasePose(this.deps.playerPos(), this.deps.cameraOrbit());
  }

  private buildScene(id: TutorialSceneId): Scene {
    const open = this.open();
    // Every scene lands back exactly where it opened. Player movement is suspended
    // for the whole scene, so the chase pose cannot have drifted underneath us.
    const land = { to: open, durationSec: 1.2 };

    if (id === 'wardenReveal') {
      const shrine = this.at(DAWNHAVEN_WARDEN_POS.x, DAWNHAVEN_WARDEN_POS.z, 1.6);
      return {
        open,
        shots: [
          // Swing off the shoulder and up onto the empty shrine.
          { to: frameSubject(shrine, 0.35, 11, 3.4), durationSec: 1.6 },
          // Hold on the empty stone: she is not there yet, and that is the point.
          { to: frameSubject(shrine, 0.35, 7.5, 2.2), durationSec: 1.0, cue: CUE_SPAWN_WARDEN },
          // Settle on her as she finds her feet.
          { to: frameSubject(shrine, -0.25, 6, 1.8), durationSec: 1.4 },
          land,
        ],
      };
    }

    if (id === 'yardReveal') {
      const yard = this.at(DAWNHAVEN_YARD.x, DAWNHAVEN_YARD.z, 1.2);
      return {
        open,
        shots: [
          // The long one. This fires the instant the player takes the task, from
          // wherever they are standing (the Warden's knoll), so the camera actually
          // TRAVELS: it lifts off their shoulder and sweeps east across the meadow
          // onto the yard. That journey is what tells them where they are being sent.
          { to: frameSubject(yard, 2.4, 16, 5.0), durationSec: 2.0 },
          // Drop onto the empty row, and hold on it being empty for a beat.
          { to: frameSubject(yard, 3.0, 10, 2.6), durationSec: 1.2 },
          // The beat: the three of them land in it.
          {
            to: frameSubject(yard, 3.0, 10, 2.6),
            durationSec: 0.5,
            hold: true,
            cue: CUE_SPAWN_DUMMIES,
          },
          { to: frameSubject(yard, 3.0, 10, 2.6), durationSec: 1.1, hold: true },
          land,
        ],
      };
    }

    if (id === 'wolfReveal') {
      const brush = this.at(DAWNHAVEN_AMBUSH.x, DAWNHAVEN_AMBUSH.z, 0.9);
      return {
        open,
        shots: [
          // Drop low and close on the brush: something is in there.
          { to: frameSubject(brush, 1.5, 8, 1.6), durationSec: 1.4 },
          // The beat itself: hold tight on the thicket as the wolf explodes out.
          { to: frameSubject(brush, 1.5, 4.5, 1.1), durationSec: 0.8, cue: CUE_SPAWN_WOLF },
          { to: frameSubject(brush, 1.5, 4.5, 1.1), durationSec: 0.9, hold: true },
          // Pull back to take in the whole standoff.
          { to: frameSubject(brush, 0.9, 10, 3.2), durationSec: 1.1 },
          land,
        ],
      };
    }

    // finale: a slow orbit around the player as the Warden pays out.
    const me = this.deps.playerPos();
    const hero = { x: me.x, y: me.y + 1.4, z: me.z };
    return {
      open,
      shots: [
        { to: frameSubject(hero, 1.2, 7, 2.2), durationSec: 1.5 },
        { to: frameSubject(hero, 3.0, 8, 3.0), durationSec: 1.8 },
        land,
      ],
    };
  }
}
