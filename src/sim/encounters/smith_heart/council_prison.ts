// The Hammer Council's Stone Prison (docs/design/raid/smith_heart.md section 7.1):
// the Slabwright's bar shuts a few players (never its foes' tanks while anyone else
// stands) in blocks of stone, stunned where they stand. Each block is a real target:
// the raid breaks it to free its player, and when its time runs out it crushes them.
// An immunity that frees from control breaks it too. It stops with the Slabwright, but the blocks already standing still count down.
// Zero rng in the picks (pickMarks hashes).

import { isInStasis } from '../../combat/cc';
import { MOBS } from '../../data';
import { createMob } from '../../entity';
import { applyDungeonMobTuning, mobTemplateForDungeonDifficulty } from '../../instances/difficulty';
import type { Entity } from '../../types';
import { DT } from '../../types';
import { dropAuraById, dropEncounterBody } from '../sunken_bastion/claim';
import {
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_NAMES,
  COUNCIL_PRISON,
  COUNCIL_ROLES,
  COUNCIL_TUNING as T,
} from './council_ids';
import {
  beginBar,
  type CouncilScope,
  living,
  memberFree,
  pickMarks,
  raidWarn,
} from './council_scope';

/** The Slabwright begins its bar. Exported for the dev trigger. */
export function startPrison(s: CouncilScope): boolean {
  const slab = s.bodies.slabwright;
  if (!living(slab) || s.st.prisons.length > 0 || !memberFree(s, 'slabwright')) return false;
  s.st.prisonTimer = T.prisonEvery;
  beginBar(s, 'slabwright', COUNCIL_CASTS.prison, T.prisonCast, null, false);
  return true;
}

function raiseBlock(s: CouncilScope, slab: Entity, p: Entity): Entity | null {
  const template = MOBS[COUNCIL_PRISON];
  if (!template) return null;
  const { ctx, inst } = s;
  const difficulty = inst.difficulty ?? 'normal';
  const tuned = mobTemplateForDungeonDifficulty(template, inst.dungeonId, difficulty);
  const e = createMob(ctx.nextId++, tuned, tuned.maxLevel, { ...p.pos });
  applyDungeonMobTuning(e, inst.dungeonId, difficulty);
  e.maxHp = Math.round(e.maxHp * s.rules.prisonHpMult);
  e.hp = e.maxHp;
  e.spawnPos = { ...e.pos };
  e.prevPos = { ...e.pos };
  e.facing = p.facing;
  e.prevFacing = p.facing;
  e.summonedAdd = true;
  e.ignoreHardLeash = true;
  e.tappedById = slab.tappedById;
  ctx.addEntity(e);
  inst.mobIds.push(e.id);
  return e;
}

/** The bar lands: a block round each marked player. */
export function landPrisonBar(s: CouncilScope, caster: Entity): void {
  const seconds = s.rules.prisonSeconds;
  const marked = pickMarks(s, caster, s.rules.prisonMarks);
  const names: string[] = [];
  for (const p of marked) {
    const block = raiseBlock(s, caster, p);
    if (!block) continue;
    s.ctx.applyAura(p, {
      id: COUNCIL_AURAS.prisoned,
      name: COUNCIL_NAMES.prison,
      kind: 'stun',
      remaining: seconds,
      duration: seconds,
      value: 0,
      sourceId: caster.id,
      school: 'physical',
      unbreakableControl: true,
      undispellable: true,
    });
    s.st.prisons.push({ playerId: p.id, blockId: block.id, remaining: seconds });
    names.push(p.name);
  }
  if (names.length === 0) return;
  const players = names.join(', ');
  raidWarn(s, caster, 'prison', `Stone Prison on ${players}! Break them out!`, { players });
}

/** Whoever the fight's blows come from: the Slabwright, else a survivor, else the block. */
function crusher(s: CouncilScope, block: Entity): Entity {
  for (const r of COUNCIL_ROLES) {
    const b = s.bodies[r];
    if (living(b)) return b;
  }
  return block;
}

function endPrison(s: CouncilScope, playerId: number, blockId: number): void {
  const p = s.ctx.entities.get(playerId);
  if (p) dropAuraById(p, COUNCIL_AURAS.prisoned);
  if (s.ctx.entities.get(blockId)) {
    const owner = s.bodies.slabwright ?? crusher(s, s.ctx.entities.get(blockId) as Entity);
    dropEncounterBody(s.ctx, s.inst, owner, blockId);
  }
}

/** The block closes: lethal whatever shields them, as the Cornice's void is
 *  (breath_void.ts): a blow the damage path caps still ends in a death. */
function crush(s: CouncilScope, from: Entity, p: Entity): void {
  if (p.gm || (p.profilerInvulnerable && s.ctx.devCommands)) return;
  s.ctx.dealDamage(
    from,
    p,
    p.hp + p.maxHp * 10,
    false,
    'physical',
    COUNCIL_NAMES.prison,
    'hit',
    true,
  );
  if (!p.dead) s.ctx.handleDeath(p, from, COUNCIL_NAMES.prison);
}

/** One tick: a broken block frees its player; a block out of time crushes them. */
export function stepPrisons(s: CouncilScope): void {
  const st = s.st;
  if (st.prisons.length === 0) return;
  const keep = [];
  for (const pr of st.prisons) {
    const p = s.ctx.entities.get(pr.playerId);
    const block = s.ctx.entities.get(pr.blockId);
    // A broken block frees its player; so does an immunity that frees from control
    // (the mage's Cold Coffin, the one stasis a player can press while stunned).
    if (!block || block.dead || block.hp <= 0 || !p || p.dead || isInStasis(p)) {
      endPrison(s, pr.playerId, pr.blockId);
      continue;
    }
    pr.remaining -= DT;
    if (pr.remaining > 1e-9) {
      keep.push(pr);
      continue;
    }
    const from = crusher(s, block);
    endPrison(s, pr.playerId, pr.blockId);
    crush(s, from, p);
  }
  st.prisons = keep;
}

/** Every block off the floor and its player free (a wipe, the kill). */
export function clearPrisons(s: CouncilScope): void {
  for (const pr of s.st.prisons) endPrison(s, pr.playerId, pr.blockId);
  s.st.prisons = [];
}
