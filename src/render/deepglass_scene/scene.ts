// The Deepglass arena world's scene layer, moved out of renderer.ts: the bell,
// the arena and card crowd around it, Tidehold's monument FX, the bout-only
// warm bench, and the per-frame bout presentation (bodies, ball, cues, HUD,
// market pack-up, crowd cheers, the goal celebration).
//
// The renderer builds one ONLY in the standalone Deepglass arena world
// (presentationMode 'deepglass'): the glass sphere is 76 yd across and would
// be a landmark in the middle of anybody else's map, so it self-gates on the
// presentation mode from day one (the sowfieldIsLive lesson, PRD risk 4).

import * as THREE from 'three';
import { TH_GATE_Z, TH_MONUMENT } from '../../sim/deepglass/citadel';
import { dgBowlDeckY, insideBell } from '../../sim/deepglass/layout';
import { deepglassMatch } from '../../sim/deepglass/match';
import { groundHeight } from '../../sim/world';
import type { IWorld } from '../../world_api';
import type { CharacterVisual } from '../characters';
import { isDeepglassCrowdTemplate } from '../characters/npc_looks';
import { buildDeepglass, type DeepglassView } from '../deepglass';
import { createAuraWarmMeshes } from '../deepglass_aura';
import { buildTidesow } from '../deepglass_ball';
import { buildDeepglassCrowdCards, type DeepglassCrowdView } from '../deepglass_crowd_cards';
import { firstCheerTime, nextCheerTime, pickCheerEmote } from '../deepglass_crowd_fx_core';
import { DeepglassGoalWave, DG_GOAL_SHAKE } from '../deepglass_goal_wave';
import { worldPlacesArenaKit } from '../deepglass_kit';
import { buildDeepglassStadium, type DeepglassStadiumView } from '../deepglass_stadium';
import type { PlacedCullHalfPlane } from '../placed_assets';
import type { BudgetPointLightRegistry } from '../point_light_budget';
import { deepglassStallGroups } from '../props';
import {
  buildRealmBuilderMonumentFx,
  type RealmBuilderMonumentFx,
} from '../realm_builder_monument_fx';
import type { EntityView } from '../renderer';
import { setRenderCategory } from '../renderer_diagnostics';
import type { DeepglassBallFx } from './ball';
import { DeepglassBodies } from './bodies';
import { DeepglassCues } from './cues';
import { deepglassCrowdExcite, deepglassCrowdLevel } from './deepglass_cue_core';
import { syncDeepglassHud } from './hud_feed';

/** Tidehold's curtain wall stands at v = 0 in the city frame, i.e. world
 *  z = TH_GATE_Z. The few yards of slack keep the wall run itself, the two
 *  gate towers on that line and the colossi just south of it, the pieces that
 *  make the cut invisible from the water. */
const DEEPGLASS_CITY_CULL: PlacedCullHalfPlane = { nx: 0, nz: 1, d: TH_GATE_Z + 6 };

/** What the scene layer needs from the renderer. */
export interface DeepglassSceneHost {
  readonly sim: IWorld;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly views: ReadonlyMap<number, EntityView>;
  readonly ball: DeepglassBallFx;
  /** The renderer's point-light registry (the thrustpacks' burner lights). */
  readonly lightBudget: BudgetPointLightRegistry;
  activeVisual(v: EntityView): CharacterVisual | null;
  compileGate(node: THREE.Object3D): Promise<unknown>;
  reducedMotion(): boolean;
  addShake(amount: number): void;
  punchFov(degrees: number): void;
  zapBurst(entityId: number): void;
}

export class DeepglassScene {
  private readonly bell: DeepglassView;
  /** The arena around the bell; null when the document PLACES the arena kit. */
  private readonly stadium: DeepglassStadiumView | null = null;
  private readonly crowdCards: DeepglassCrowdView;
  /** The goal celebration. Not a scene node: it repaints the finished frame
   *  (src/render/deepglass_goal_wave.ts explains why it has to). */
  private goalWave: DeepglassGoalWave | null;
  /** Tidehold's Realm Builder monument FX (the projected name and lantern
   *  embers). The statue itself is a placed asset (citadel.ts TH_MONUMENT);
   *  this is the part a GLB cannot carry. */
  private monumentFx: RealmBuilderMonumentFx | null;
  private readonly bodies: DeepglassBodies;
  private readonly cues: DeepglassCues;
  /** Whether the city-event market is currently packed up for a bout. */
  private marketHidden = false;
  /** Crowd cheering: a render-local clock plus, per spectator, when its next
   *  cheer is due and how many it has thrown (the hash salt). */
  private cheerClock = 0;
  private readonly cheerDue = new Map<number, number>();
  private readonly cheerRound = new Map<number, number>();

  /** `bootLights` is the renderer's fire-light registry DURING CONSTRUCTION:
   *  every light pushed here lands before the constructor's mass hide, so it
   *  joins hidden and ranked like any other boot light. Never kept. */
  constructor(
    private readonly host: DeepglassSceneHost,
    bootLights: THREE.PointLight[],
  ) {
    const { scene } = host;
    this.bodies = new DeepglassBodies(host.lightBudget);
    this.cues = new DeepglassCues(host);
    this.bell = buildDeepglass();
    setRenderCategory(this.bell.group, 'props');
    scene.add(this.bell.group);
    // The arena around it. Built after the bell so its lights land in the
    // same budget the bell's ring lights already joined, unless the
    // document PLACES the arena kit, in which case the editable one wins
    // and this would only draw through it (worldPlacesArenaKit).
    const placedArena = worldPlacesArenaKit();
    if (!placedArena) {
      this.stadium = buildDeepglassStadium();
      setRenderCategory(this.stadium.group, 'props');
      scene.add(this.stadium.group);
      for (const light of this.stadium.lights) {
        scene.add(light);
        bootLights.push(light);
      }
    }
    // The card crowd filling the bowl: thousands of animated cutout fans in
    // one draw call, over the handful of real composed spectators in the
    // front rows. See deepglass_crowd_cards.ts.
    // The placed kit's seating is a continuous rake, not the six flat
    // terraces the default assumes.
    this.crowdCards = buildDeepglassCrowdCards(placedArena ? dgBowlDeckY : undefined);
    setRenderCategory(this.crowdCards.group, 'props');
    scene.add(this.crowdCards.group);
    this.bodies.attach(scene);
    for (const light of this.bell.lights) {
      scene.add(light);
      bootLights.push(light);
    }
    // The goal celebration draws AFTER the composer, so it owns no scene
    // node here, the renderer hands it the canvas at the end of the frame.
    this.goalWave = new DeepglassGoalWave();
    // Tidehold's monument: the honouree projection and lantern embers, seated
    // on the same point the city places the statue at.
    this.monumentFx = buildRealmBuilderMonumentFx({
      x: TH_MONUMENT.x,
      z: TH_MONUMENT.z,
      groundY: groundHeight(TH_MONUMENT.x, TH_MONUMENT.z, host.sim.cfg.seed),
      rotation: TH_MONUMENT.rotY,
      nativeWidth: TH_MONUMENT.nativeWidth,
      nativeHeight: TH_MONUMENT.nativeHeight,
      nativeDepth: TH_MONUMENT.nativeDepth,
    });
    setRenderCategory(this.monumentFx.group, 'vfx');
    scene.add(this.monumentFx.group);
    // The warm bench: one hidden instance of every bout-only material whose
    // program otherwise links at first sight mid-bout (the aura hull's three
    // variants, the Tidesow, the thrustpack's plumes). The bench is in the
    // scene before the entry prewarm's programs.compile pass, and compileAsync
    // traverses hidden objects, so these link behind the loading screen, the
    // pack lands async and goes through the live compile gate instead the
    // moment it arrives.
    const warmBench = new THREE.Group();
    warmBench.name = 'deepglass-warm-bench';
    warmBench.visible = false;
    for (const mesh of createAuraWarmMeshes()) warmBench.add(mesh);
    const tidesowWarm = buildTidesow();
    tidesowWarm.group.visible = false;
    warmBench.add(tidesowWarm.group);
    scene.add(warmBench);
    this.bodies.packs.warmInto(warmBench, (node) => {
      // Rejection here is the shutdown path draining its queue; the bench is
      // best-effort and the pack still links (synchronously) at first sight.
      void host.compileGate(node).catch(() => undefined);
    });
  }

  /** Re-bake Tidehold's monument name (src/game/realm_builder_boot.ts). */
  setHonouree(name: string): void {
    this.monumentFx?.setHonouree(name);
  }

  /** The slab of the Deepglass map hidden while the camera is inside the bell:
   *  everything north of the Tide Gate. Null the moment the camera breaks the
   *  surface, which is the same reading the underwater wash uses, so the city
   *  comes back on exactly the frame the water that was hiding it starts to
   *  lift. */
  cityCull(): PlacedCullHalfPlane | null {
    const cam = this.host.camera.position;
    return insideBell(cam.x, cam.y, cam.z) ? DEEPGLASS_CITY_CULL : null;
  }

  /** How loud the bowl reads from (x, z); see deepglassCrowdLevel. */
  crowdLevel(x: number, z: number, submerged: boolean): number {
    return deepglassCrowdLevel(deepglassMatch()?.phase ?? null, x, z, submerged);
  }

  /** The per-frame pass, in the order the renderer used to run it inline. */
  update(px: number, pz: number, dt: number, showBallMark: boolean): void {
    const { host } = this;
    this.bell.update(px, pz, dt);
    this.stadium?.update(dt);
    // The card crowd's mood: a goal spikes the whole bowl, a running bout
    // keeps it lively, the market-day idle keeps a gentle murmur. A live
    // bout packs every seat; an ordinary day keeps a quarter crowd.
    const m = deepglassMatch();
    this.crowdCards.update(dt, deepglassCrowdExcite(m?.phase ?? null), m !== null);
    // Edge-triggered off the match phase inside update(); true on the one
    // frame the whistle blows, and the shells leave the net on that frame.
    if (this.goalWave?.update(dt, host.reducedMotion())) host.addShake(DG_GOAL_SHAKE);
    if (this.monumentFx) {
      const camX = host.camera.position.x;
      const camZ = host.camera.position.z;
      this.monumentFx.update(
        host.reducedMotion(),
        Math.hypot(camX - TH_MONUMENT.x, camZ - TH_MONUMENT.z),
      );
    }
    syncDeepglassHud(host.sim, host.camera, showBallMark);
    this.bodies.update(dt, host.sim, host.views);
    host.ball.sync(host.sim, dt, host.camera.quaternion, showBallMark);
    this.cues.sync();
    this.syncMarket();
    this.syncCrowdCheer(dt);
  }

  /** Last thing onto the canvas (see the renderer's present step). */
  drawGoalWave(webgl: THREE.WebGLRenderer, camera: THREE.Camera): void {
    this.goalWave?.draw(webgl, camera);
  }

  /** Positional beds outlive the renderer otherwise: nothing else ever calls
   *  the cue sync again to release them. */
  stopBoostLoops(): void {
    this.cues.stopBoostLoops();
  }

  dispose(): void {
    this.goalWave?.dispose();
    this.goalWave = null;
    if (this.monumentFx) {
      this.host.scene.remove(this.monumentFx.group);
      this.monumentFx.dispose();
      this.monumentFx = null;
    }
  }

  /** The city-event market packs up for every bout: stall groups hide while a
   *  match runs and return at the whistle, the prop half of the sim-side crowd
   *  despawn (sim/deepglass/crowd.ts). Edge-triggered: visibility writes only
   *  on the phase flip, not per frame. */
  private syncMarket(): void {
    const matchLive = deepglassMatch() !== null;
    if (matchLive === this.marketHidden) return;
    this.marketHidden = matchLive;
    for (const g of deepglassStallGroups) g.visible = !matchLive;
  }

  /** The city-event crowd cheers at the bell: each spectator throws a
   *  Cheer-family emote on its own hashed cadence (deepglass_crowd_fx_core.ts),
   *  so the stand never claps in unison. Presentation only, and skipped
   *  outright once a bout starts, because the crowd despawns for the match. */
  private syncCrowdCheer(dt: number): void {
    if (deepglassMatch()) return;
    const { host } = this;
    this.cheerClock += dt;
    for (const [id, v] of host.views) {
      const e = host.sim.entities.get(id);
      if (e?.kind !== 'npc' || !isDeepglassCrowdTemplate(e.templateId)) continue;
      let due = this.cheerDue.get(id);
      if (due === undefined) {
        due = firstCheerTime(id, this.cheerClock);
        this.cheerDue.set(id, due);
        continue;
      }
      if (this.cheerClock < due) continue;
      const round = (this.cheerRound.get(id) ?? 0) + 1;
      this.cheerRound.set(id, round);
      this.cheerDue.set(id, nextCheerTime(id, this.cheerClock, round));
      const visual = host.activeVisual(v);
      // A pacer mid-stride keeps walking: a one-shot over a walk cycle reads
      // as a stumble, and the pacers are the ones who should look busy anyway.
      if (!visual || visual.isMidOneShot) continue;
      const moving = Math.hypot(e.pos.x - e.prevPos.x, e.pos.z - e.prevPos.z) > 0.001;
      if (moving) continue;
      visual.playEmote(pickCheerEmote(id, round));
    }
  }
}
