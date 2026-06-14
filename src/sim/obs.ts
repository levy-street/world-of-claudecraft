import { ITEMS, QUESTS, QUEST_ORDER, WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z } from './data';
import { Sim } from './sim';
import { Entity, GCD, angleTo, dist2d, normAngle, xpForLevel, MAX_LEVEL } from './types';

// ---------------------------------------------------------------------------
// Discrete action space for RL agents.
// Movement actions are "held" for the duration of one env step (frame-skip).
// ---------------------------------------------------------------------------

export const ACTIONS = [
  'noop',          // 0
  'forward',       // 1
  'back',          // 2
  'turn_left',     // 3
  'turn_right',    // 4
  'strafe_left',   // 5
  'strafe_right',  // 6
  'jump',          // 7  (forward+jump)
  'target_nearest',// 8
  'attack',        // 9  start auto-attack on current target
  'ability_1',     // 10  abilities index the learned list in learn order
  'ability_2',     // 11
  'ability_3',     // 12
  'ability_4',     // 13
  'ability_5',     // 14
  'ability_6',     // 15
  'ability_7',     // 16
  'ability_8',     // 17
  'ability_9',     // 18
  'ability_10',    // 19
  'interact',      // 20 loot corpse / pick up object / talk to quest npc
  'stop',          // 21 stop moving + stop attacking
  'eat_drink',     // 22 consume best food (or water for mana classes) from bags
] as const;

export const NUM_ACTIONS = ACTIONS.length;
const ABILITY_SLOTS = 10;

export function applyAction(sim: Sim, action: number): void {
  const inp = sim.moveInput;
  inp.forward = false; inp.back = false; inp.turnLeft = false; inp.turnRight = false;
  inp.strafeLeft = false; inp.strafeRight = false; inp.jump = false;
  const name = ACTIONS[action] ?? 'noop';
  switch (name) {
    case 'forward': inp.forward = true; break;
    case 'back': inp.back = true; break;
    case 'turn_left': inp.turnLeft = true; inp.forward = true; break;
    case 'turn_right': inp.turnRight = true; inp.forward = true; break;
    case 'strafe_left': inp.strafeLeft = true; break;
    case 'strafe_right': inp.strafeRight = true; break;
    case 'jump': inp.jump = true; inp.forward = true; break;
    case 'target_nearest': sim.targetNearestEnemy(); break;
    case 'attack': sim.startAutoAttack(); break;
    case 'interact': sim.interact(); break;
    case 'stop': sim.stopAutoAttack(); break;
    case 'eat_drink': {
      const p = sim.player;
      const wantMana = p.resourceType === 'mana' && p.resource < p.maxResource * 0.5;
      const wantHp = p.hp < p.maxHp * 0.6;
      for (const s of sim.inventory) {
        const def = ITEMS[s.itemId];
        if (!def) continue;
        if (wantMana && def.kind === 'drink') { sim.useItem(s.itemId); break; }
        if (wantHp && def.kind === 'food') { sim.useItem(s.itemId); break; }
      }
      break;
    }
    case 'noop': break;
    default: {
      if (name.startsWith('ability_')) {
        sim.castAbilityBySlot(parseInt(name.slice(8), 10) - 1);
      }
    }
  }
  // If the player is dead, any action releases the spirit.
  if (sim.player.dead) sim.releaseSpirit();
}

// ---------------------------------------------------------------------------
// Observation vector
// ---------------------------------------------------------------------------

const NEARBY_MOBS = 5;

export function obsSize(): number {
  return 16 + ABILITY_SLOTS * 2 + 9 + NEARBY_MOBS * 6 + 5 + QUEST_ORDER.length * 2;
}

export function encodeObs(sim: Sim): number[] {
  const p = sim.player;
  const obs: number[] = [];

  // --- self (16) ---
  obs.push(p.hp / Math.max(1, p.maxHp));
  obs.push(p.resource / Math.max(1, p.maxResource));
  obs.push(p.level / MAX_LEVEL);
  obs.push(p.level >= MAX_LEVEL ? 1 : sim.xp / xpForLevel(p.level));
  obs.push(clamp(p.pos.x / WORLD_MAX_X, -1, 1));
  obs.push(clamp((p.pos.z - (WORLD_MIN_Z + WORLD_MAX_Z) / 2) / ((WORLD_MAX_Z - WORLD_MIN_Z) / 2), -1, 1));
  obs.push(Math.sin(p.facing));
  obs.push(Math.cos(p.facing));
  obs.push(p.gcdRemaining / GCD);
  obs.push(p.castTotal > 0 && p.castingAbility ? p.castRemaining / p.castTotal : 0);
  obs.push(p.dead ? 1 : 0);
  obs.push(p.inCombat ? 1 : 0);
  obs.push(p.autoAttack ? 1 : 0);
  obs.push(p.comboPoints / 5);
  obs.push(p.sitting || p.eating || p.drinking ? 1 : 0);
  obs.push(sim.time > p.overpowerUntil ? 0 : 1); // dodge proc available

  // --- abilities (10 x 2 = 20) ---
  for (let i = 0; i < ABILITY_SLOTS; i++) {
    const known = sim.known[i];
    if (!known) { obs.push(0, 0); continue; }
    const cd = p.cooldowns.get(known.def.id) ?? 0;
    const ready = cd <= 0 && p.resource >= known.cost && (known.def.offGcd || p.gcdRemaining <= 0);
    obs.push(ready ? 1 : 0);
    obs.push(known.def.cooldown > 0 ? cd / known.def.cooldown : 0);
  }

  // --- target (9) ---
  const target = p.targetId !== null ? sim.entities.get(p.targetId) : null;
  if (target && (!target.dead || target.lootable)) {
    const d = dist2d(p.pos, target.pos);
    const rel = normAngle(angleTo(p.pos, target.pos) - p.facing);
    obs.push(1);
    obs.push(target.hp / Math.max(1, target.maxHp));
    obs.push(clamp((target.level - p.level) / 5, -1, 1));
    // distance shares the d/40 scale used for nearby mobs and the interactable
    // below; clamp to the same 1.5 ceiling (the 60-unit observation radius) so a
    // target beyond 40 units stays distinguishable instead of saturating at 1
    obs.push(clamp(d / 40, 0, 1.5));
    obs.push(Math.sin(rel));
    obs.push(Math.cos(rel));
    obs.push(target.hostile ? 1 : 0);
    obs.push(target.dead && target.lootable ? 1 : 0);
    obs.push(target.aggroTargetId === p.id ? 1 : 0);
  } else {
    obs.push(0, 0, 0, 0, 0, 0, 0, 0, 0);
  }

  // --- nearest mobs (5 x 6 = 30) ---
  const mobs: { e: Entity; d: number }[] = [];
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || !e.hostile) continue;
    const d = dist2d(p.pos, e.pos);
    if (d < 60) mobs.push({ e, d });
  }
  mobs.sort((a, b) => a.d - b.d);
  for (let i = 0; i < NEARBY_MOBS; i++) {
    if (i < mobs.length) {
      const { e, d } = mobs[i];
      const rel = normAngle(angleTo(p.pos, e.pos) - p.facing);
      obs.push(clamp(d / 40, 0, 1.5));
      obs.push(Math.sin(rel));
      obs.push(Math.cos(rel));
      obs.push(e.hp / Math.max(1, e.maxHp));
      obs.push(clamp((e.level - p.level) / 5, -1, 1));
      obs.push(e.aggroTargetId === p.id ? 1 : 0);
    } else {
      obs.push(1.5, 0, 0, 0, 0, 0);
    }
  }

  // --- nearest interactable (5): corpse, ground object, or quest npc ---
  let best: { e: Entity; d: number; type: number } | null = null;
  for (const e of sim.entities.values()) {
    let type = 0;
    if (e.kind === 'mob' && e.lootable) type = 0.33;
    else if (e.kind === 'object' && e.lootable) type = 0.66;
    else if (e.kind === 'npc') type = 1;
    else continue;
    const d = dist2d(p.pos, e.pos);
    if (d < 60 && (!best || d < best.d)) best = { e, d, type };
  }
  if (best) {
    const rel = normAngle(angleTo(p.pos, best.e.pos) - p.facing);
    obs.push(1, clamp(best.d / 40, 0, 1.5), Math.sin(rel), Math.cos(rel), best.type);
  } else {
    obs.push(0, 1.5, 0, 0, 0);
  }

  // --- quests (10 x 2 = 20) ---
  for (const qid of QUEST_ORDER) {
    const state = sim.questState(qid);
    obs.push(state === 'done' ? 1 : state === 'ready' ? 0.66 : state === 'active' ? 0.33 : 0);
    const qp = sim.questLog.get(qid);
    if (qp) {
      const quest = QUESTS[qid];
      let total = 0, have = 0;
      quest.objectives.forEach((obj, i) => { total += obj.count; have += Math.min(qp.counts[i], obj.count); });
      obs.push(total > 0 ? have / total : 0);
    } else {
      obs.push(state === 'done' ? 1 : 0);
    }
  }

  return obs;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
