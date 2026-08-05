// IdleEngine: the core loop host for Idle Classic.
//
// Owns one deterministic Sim, runs an accelerated tick loop with automatic
// combat/quest decisions, and persists per-character progress via the
// canonical `serializeCharacter` / `addPlayer` save path.
//
// Matches the headless RL env's step pattern (env_server.ts:99-100):
// choose action -> `applyAction` once -> `frameSkip` ticks -> drain events.

import { applyAction } from '../src/sim/obs';
import { Sim } from '../src/sim/sim';
import {
  angleTo,
  dist2d,
  MELEE_ARC,
  MELEE_RANGE,
  normAngle,
  type PlayerClass,
  type SimEvent,
  type Vec3,
} from '../src/sim/types';
import { AntiStuck } from './anti_stuck';
import { pickAction } from './auto_combat';
import type { QuestStepResult } from './auto_quest';
import { evaluateQuest } from './auto_quest';
import { isTooDangerous } from './difficulty';
import { type CampTarget, findBestCampTarget } from './progression_target';
import { steerTick } from './steer';
import { type IdleSaveData, readSave, writeSave } from './storage';
import { assessThreat } from './threat_map';

/**
 * The per-step counter baseline used to diff the next `step()`. Reused by the
 * browser dashboard restore path so an external restorer (localStorage) can set
 * the baseline without replaying history. Mirrors the private CounterSnapshot.
 */
export interface StepCounterSnapshot {
  kills: number;
  deaths: number;
  xpGained: number;
  questsCompleted: number;
  lootCopper: number;
  levelUps: number;
}

/**
 * Storage abstraction decoupling IdleEngine from the Node-only `storage.ts`
 * (fs/path). A browser host injects a provider backed by localStorage (or
 * IndexedDB); the Node CLI leaves it undefined and keeps the file path. The
 * provider only needs `save`; restore is a separate concern handled by the host
 * plumbing a saved `IdleSaveData` straight into a `noPlayer` engine + addPlayer.
 * Exported here (not the barrel) so idle/index.ts can surface it.
 */
export interface IdleStorageProvider {
  /** Persist the save data. Return false on failure; the host treats that as unsaved. */
  save(data: IdleSaveData, opts: { seed: number; playerClass: string; saveDir: string }): boolean;
}

export type { IdleSaveData } from './storage';

export interface IdleEngineOptions {
  seed: number;
  playerClass: PlayerClass;
  /** Sim ticks per step (default 20 = 1 sim-second @ 20 Hz). */
  frameSkip?: number;
  /** Path to the per-character save directory (default `idle/save/`). */
  saveDir?: string;
  /** Character name (default 'Adventurer'). */
  playerName?: string;
  /** Starting player level (default 1). */
  playerLevel: number;
  /** Internal: don't auto-create a primary player in the Sim ctor (for restore). */
  noPlayer?: boolean | undefined;
  /** Optional storage provider. Absent = Node filesystem (CLI); present = injected (browser). */
  storage?: IdleStorageProvider;
}

export interface IdleStepSummary {
  readonly events: SimEvent[];
  readonly kills: number;
  readonly deaths: number;
  readonly xpGained: number;
  readonly questsCompleted: number;
  readonly lootCopper: number;
  readonly levelUps: number;
  readonly level: number;
  readonly xp: number;
  readonly copper: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly deltaSeconds: number;
  readonly questLog: string[];
  readonly dead: boolean;
}

type CounterSnapshot = {
  kills: number;
  deaths: number;
  xpGained: number;
  questsCompleted: number;
  lootCopper: number;
  levelUps: number;
};

export class IdleEngine {
  readonly sim: Sim;
  readonly options: Required<IdleEngineOptions>;
  private prevCounters: CounterSnapshot;
  private readonly _storage: IdleStorageProvider | undefined;
  private readonly _antiStuck = new AntiStuck();

  constructor(opts: IdleEngineOptions) {
    this._storage = opts.storage;
    this.options = {
      frameSkip: 20,
      saveDir: 'idle/save',
      playerName: 'Adventurer',
      noPlayer: false,
      ...opts,
    } as Required<IdleEngineOptions>;
    this.options.playerLevel = opts.playerLevel ?? 1;
    // With `noPlayer: true`, the ctor skips auto-creating a primary (used by
    // `restore`, which calls addPlayer with saved CharacterState after).
    this.sim = new Sim({
      seed: this.options.seed,
      playerClass: this.options.playerClass,
      autoEquip: !this.options.noPlayer,
      playerName: this.options.playerName,
      noPlayer: this.options.noPlayer ?? false,
    });
    // Apply a starting level if the caller asked (setPlayerLevel also re-equips gear).
    if (!this.options.noPlayer && (this.options.playerLevel ?? 1) > 1) {
      this.sim.setPlayerLevel(this.options.playerLevel ?? 1);
    }
    // When noPlayer is true (restore path), counters are set after addPlayer.
    if (!this.options.noPlayer) {
      this.prevCounters = this.snapshotCounters();
    } else {
      this.prevCounters = {
        kills: 0,
        deaths: 0,
        xpGained: 0,
        questsCompleted: 0,
        lootCopper: 0,
        levelUps: 0,
      };
    }
  }

  /** Restore from a previously saved snapshot file. Returns null on failure. */
  static restore(savePath: string): IdleEngine | null {
    const data = readSave(savePath);
    if (!data) return null;
    // Create the engine with `noPlayer: true` so the Sim ctor does NOT
    // auto-create a throwaway primary — we add the saved one below.
    const engine = new IdleEngine({
      seed: data.seed,
      playerClass: data.playerClass,
      playerName: data.playerName ?? 'Adventurer',
      playerLevel: 1,
      noPlayer: true,
    });
    // Restore the saved character into the fresh world.
    engine.sim.addPlayer(data.playerClass, data.playerName ?? 'Adventurer', {
      state: data.characterState,
    });
    engine.prevCounters = data.counters;
    return engine;
  }

  /** Run one step: pick action -> applyAction -> frameSkip ticks -> drain -> persist. */
  step(_realMs: number): IdleStepSummary {
    const sim = this.sim;
    const frameSkip = this.options.frameSkip;
    const events: SimEvent[] = [];

    // 0. Anti-stuck: if the player hasn't moved in a while AND has no
    //    active target, override with escape actions. If there IS a target,
    //    let combat handle it (anti-stuck must not interfere with fighting).
    const hasTarget =
      sim.player.targetId !== null && sim.entities.get(sim.player.targetId)?.dead === false;
    const stuckAction = hasTarget ? null : this._antiStuck.check(sim);

    // 1. Pick action. Quest evaluation first (turn-in/accept), then combat.
    const questResult: QuestStepResult = evaluateQuest(sim, events);
    let action = questResult.action;
    if (questResult.didQuestAction) action = 0;
    let camp: CampTarget | null = null;
    if (action === 0 && !questResult.didQuestAction) {
      action = pickAction(sim);
      // When combat returns FORWARD with no active target, the player has
      // nothing to fight here. Steer toward a level-appropriate camp instead
      // of wandering randomly. This is the progression navigator: it makes
      // the character migrate to the right hunting grounds for its level.
      if (action === 1 && !sim.player.targetId && assessThreat(sim).level !== 'lethal') {
        camp = findBestCampTarget(sim.player.pos, sim.player.level);
        if (camp) {
          // Only navigate if we're not already in a reasonable camp distance.
          // If we are, stay put — auto_combat will pick targets as they spawn.
          if (dist2d(sim.player.pos, camp.pos) <= 15) camp = null;
        }
      }
    }
    // Override with escape action if stuck (highest priority).
    if (stuckAction !== null) {
      action = stuckAction;
    }

    // 2. Execution. The once-per-step action surface cannot steer: a single
    //    TURN held for the whole frameSkip batch rotates the player exactly
    //    PI radians (1 sim-second at TURN_SPEED), so the facing can only ever
    //    land on one of two antipodal angles and the steering loop never
    //    converges — the character spins and never reaches a camp or a mob.
    //    Movement is therefore driven PER TICK (the sim's normal input
    //    cadence) toward a resolved world-space goal; the once-per-step
    //    `action` is kept for the stationary cases (in-melee combat, ability
    //    casts, eat/drink, anti-stuck escape).
    const p0 = sim.player;
    const engagedTarget = p0.targetId !== null ? (sim.entities.get(p0.targetId) ?? null) : null;
    const threat = assessThreat(sim);
    let steerGoal: Vec3 | null = null;

    if (!p0.dead) {
      if (threat.level === 'lethal' && threat.fleeFrom) {
        // Lethal pack: run directly away from the flee centroid (highest
        // priority over every other goal).
        const dx = p0.pos.x - threat.fleeFrom.x;
        const dz = p0.pos.z - threat.fleeFrom.z;
        const len = Math.hypot(dx, dz) || 1;
        steerGoal = {
          x: p0.pos.x + (dx / len) * 40,
          y: p0.pos.y,
          z: p0.pos.z + (dz / len) * 40,
        };
      } else if (questResult.goalPos && !questResult.didQuestAction) {
        // The quest layer resolved a world-space objective (giver/turn-in/objective
        // area) it wants the character to reach this step. Steer per tick to it;
        // once the character is in range, evaluateQuest next step will issue the
        // stationary accept/turn-in action (didQuestAction) instead.
        steerGoal = { ...questResult.goalPos };
      } else if (engagedTarget && !engagedTarget.dead && !isTooDangerous(p0.level, engagedTarget)) {
        // Not yet in melee -> close the gap by steering to the target. Once
        // in melee (steerTick arrives within MELEE_RANGE) the next step's
        // once-per-step action starts auto-attack.
        const rel = normAngle(angleTo(p0.pos, engagedTarget.pos) - p0.facing);
        const closeEnough = dist2d(p0.pos, engagedTarget.pos) <= MELEE_RANGE + 2;
        if (!closeEnough || Math.abs(rel) > MELEE_ARC / 2) {
          steerGoal = { ...engagedTarget.pos };
        }
      } else if (camp) {
        steerGoal = { ...camp.pos };
      }
    }
    // Anti-stuck escape takes priority over navigation when the character is
    // genuinely wedged (its own sequence frees it, steering cannot).
    if (stuckAction !== null) steerGoal = null;

    // Save player position BEFORE ticks so we can set prevPos afterward for
    // smooth render interpolation (prevents teleporting).
    const prevPlayerPos = { ...sim.player.pos };
    const prevPlayerFacing = sim.player.facing;

    if (steerGoal) {
      // 3a. Per-tick steering toward the goal.
      for (let i = 0; i < frameSkip; i++) {
        steerTick(sim, steerGoal);
        const batch = sim.tick();
        for (const ev of batch) events.push(ev);
      }
    } else {
      // 3b. Apply the once-per-step action (clears previous moveInput).
      applyAction(sim, action);
      // If the action was a turn (3/4), undo the forward movement that
      // applyAction auto-sets so the player turns in place instead of walking.
      // This prevents the player from walking out of melee range while turning
      // to face a mob that is behind them.
      if (action === 3 || action === 4) {
        sim.moveInput.forward = false;
      }
      // 3c. Run frameSkip ticks, collecting events.
      for (let i = 0; i < frameSkip; i++) {
        const batch = sim.tick();
        for (const ev of batch) events.push(ev);
      }
    }
    // Set prevPos to the position before the tick batch so the renderer
    // interpolates smoothly from old to new position over the frame.
    sim.player.prevPos.x = prevPlayerPos.x;
    sim.player.prevPos.y = prevPlayerPos.y;
    sim.player.prevPos.z = prevPlayerPos.z;
    sim.player.prevFacing = prevPlayerFacing;

    // 4. Build summary.
    const p = sim.player;
    const c = sim.counters;
    const prev = this.prevCounters;
    const summary: IdleStepSummary = {
      events,
      kills: c.kills - prev.kills,
      deaths: c.deaths - prev.deaths,
      xpGained: c.xpGained - prev.xpGained,
      questsCompleted: c.questsCompleted - prev.questsCompleted,
      lootCopper: c.lootCopper - prev.lootCopper,
      levelUps: c.levelUps - prev.levelUps,
      level: p.level,
      xp: sim.xp,
      copper: sim.copper,
      hp: p.hp,
      maxHp: p.maxHp,
      deltaSeconds: frameSkip * 0.05,
      questLog: questResult.log,
      dead: p.dead,
    };

    // 5. Persist counters for next diff.
    this.prevCounters = this.snapshotCounters();

    return summary;
  }

  /** Serialize the engine state to a save file for later restore. */
  save(saveDir?: string): void {
    const pid = this.sim.primaryId;
    const snap = this.sim.serializeCharacter(pid);
    if (!snap) return;
    const data: IdleSaveData = {
      seed: this.options.seed,
      playerClass: this.options.playerClass,
      playerName: this.options.playerName,
      characterState: snap,
      // Counters is structural vs CounterSnapshot (same shape); the cast is only
      // because the type alias lives in storage.ts and prevCounters uses it.
      counters: this.prevCounters,
    };
    // Injected storage (browser). The Node path below stays for the CLI; Vite
    // tree-shakes writeSave out of a browser-only bundle because _storage is set.
    if (this._storage) {
      this._storage.save(data, {
        seed: this.options.seed,
        playerClass: this.options.playerClass,
        saveDir: saveDir ?? this.options.saveDir,
      });
      return;
    }
    writeSave(data, saveDir ?? this.options.saveDir);
  }

  /**
   * Set the per-step counter baseline from an externally restored snapshot
   * (the browser dashboard restore path), mirroring what `restore()` does with
   * internal access. Call once after `addPlayer(..., { state })` on a
   * `noPlayer` engine; the next `step()` diffs against this baseline.
   */
  setCounterBaseline(counters: StepCounterSnapshot): void {
    this.prevCounters = {
      kills: counters.kills,
      deaths: counters.deaths,
      xpGained: counters.xpGained,
      questsCompleted: counters.questsCompleted,
      lootCopper: counters.lootCopper,
      levelUps: counters.levelUps,
    };
  }

  private snapshotCounters(): CounterSnapshot {
    const c = this.sim.counters;
    return {
      kills: c.kills,
      deaths: c.deaths,
      xpGained: c.xpGained,
      questsCompleted: c.questsCompleted,
      lootCopper: c.lootCopper,
      levelUps: c.levelUps,
    };
  }
}
