// Pure, host-agnostic view model for the Protect Yumi match HUD strip.
//
// The pure-core half of the pure-core + thin-painter split (root CLAUDE.md
// Conventions; the painter is yumi_match_painter.ts). It merges the two data
// sources the mode has into one render model:
//   - the ArenaInfo snapshot (arenaInfo.match.yumi): per-frame fresh offline,
//     rate-limited online; always the STRUCTURE source (team, phase, size).
//   - the event-fed live cache (the 1/s yumiStatus heartbeat + the yumiDown
//     bench countdown the painter accumulates): identical on both hosts, so
//     the DYNAMIC numbers (both cat HPs, teleport countdown, sudden death)
//     prefer it whenever a heartbeat has been seen this match.
// Both Yumi bars are ALWAYS present while a match is visible: the enemy
// objective's HP is actionable info (graphics-fairness invariant), never
// hidden or tier-delayed.
//
// DOM-free and i18n-free; numbers stay raw (the painter formats via t() /
// formatNumber). Allocation-light: one module-level model container is reused
// every call (per-frame path).

import type { ArenaInfo } from '../world_api';

export interface YumiLiveState {
  /** True once a yumiStatus heartbeat arrived for the current match. */
  seen: boolean;
  myHp: number;
  myMax: number;
  enemyHp: number;
  enemyMax: number;
  teleportIn: number;
  suddenDeathIn: number;
  suddenDeath: boolean;
}

export interface YumiHudModel {
  /** A yumi match is visible (countdown, active, or sudden death). */
  active: boolean;
  phase: 'countdown' | 'active' | 'sudden' | 'over';
  team: 'A' | 'B';
  size: number;
  myHp: number;
  myMax: number;
  myFrac: number;
  enemyHp: number;
  enemyMax: number;
  enemyFrac: number;
  /** Whole seconds to the next simultaneous teleport; 0 once frozen. */
  teleportIn: number;
  /** Whole seconds of match time left before sudden death; 0 once latched. */
  suddenDeathIn: number;
  suddenDeath: boolean;
  down: boolean;
  /** Whole seconds until my revive (0 when alive). */
  respawnIn: number;
}

const model: YumiHudModel = {
  active: false,
  phase: 'over',
  team: 'A',
  size: 3,
  myHp: 0,
  myMax: 1,
  myFrac: 0,
  enemyHp: 0,
  enemyMax: 1,
  enemyFrac: 0,
  teleportIn: 0,
  suddenDeathIn: 0,
  suddenDeath: false,
  down: false,
  respawnIn: 0,
};

/**
 * Build the reused HUD model. `localRespawn` is the painter's event-seeded
 * bench countdown in (fractional) seconds; the snapshot's respawnIn seeds the
 * display instead when no local countdown runs (reconnect mid-bench).
 */
export function yumiMatchView(
  info: ArenaInfo | null,
  live: YumiLiveState | null,
  localRespawn: number,
): YumiHudModel {
  const y = info?.match?.yumi;
  if (!y || y.phase === 'over') {
    model.active = false;
    model.phase = 'over';
    model.down = false;
    model.respawnIn = 0;
    return model;
  }
  const useLive = live !== null && live.seen && y.phase !== 'countdown';
  const myView = y.team === 'A' ? y.yumiA : y.yumiB;
  const enemyView = y.team === 'A' ? y.yumiB : y.yumiA;
  model.active = true;
  model.phase = y.phase;
  model.team = y.team;
  model.size = y.size;
  model.myHp = useLive ? live.myHp : myView.hp;
  model.myMax = Math.max(1, useLive ? live.myMax : myView.maxHp);
  model.enemyHp = useLive ? live.enemyHp : enemyView.hp;
  model.enemyMax = Math.max(1, useLive ? live.enemyMax : enemyView.maxHp);
  model.myFrac = Math.max(0, Math.min(1, model.myHp / model.myMax));
  model.enemyFrac = Math.max(0, Math.min(1, model.enemyHp / model.enemyMax));
  model.suddenDeath = y.phase === 'sudden' || (useLive && live.suddenDeath);
  model.teleportIn = model.suddenDeath ? 0 : useLive ? live.teleportIn : y.teleportIn;
  model.suddenDeathIn = model.suddenDeath ? 0 : useLive ? live.suddenDeathIn : y.suddenDeathIn;
  model.respawnIn = localRespawn > 0 ? Math.ceil(localRespawn) : y.down ? y.respawnIn : 0;
  model.down = model.respawnIn > 0 && y.phase !== 'countdown';
  return model;
}
