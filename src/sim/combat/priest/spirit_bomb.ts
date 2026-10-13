import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';

export const SPIRIT_BOMB_ID = 'spirit_bomb';
export const SPIRIT_BOMB_PROGRESS_ID = 'spirit_bomb_progress';
export const SPIRIT_BOMB_REQUIRED_GENERATION = 20;

/** The meter is session state, separate from the priest's spendable five-stack bank. */
export function spiritBombProgress(priest: Entity): number {
  return (
    priest.auras.find((aura) => aura.id === SPIRIT_BOMB_PROGRESS_ID && aura.sourceId === priest.id)
      ?.stacks ?? 0
  );
}

/** Credit eligible generation before the ordinary bank's five-stack cap. */
export function recordGloomtitheGeneration(ctx: SimContext, priest: Entity, amount: number): void {
  const meta = ctx.players.get(priest.id);
  if (priest.dead || meta?.cls !== 'priest' || meta.talents.spec !== 'shadow') return;
  if (!Number.isInteger(amount) || amount <= 0) return;
  const prior = spiritBombProgress(priest);
  const stacks = Math.min(SPIRIT_BOMB_REQUIRED_GENERATION, prior + amount);
  if (stacks === prior) return;
  const bank = priest.auras.find(
    (aura) => aura.id === SPIRIT_BOMB_PROGRESS_ID && aura.sourceId === priest.id,
  );
  if (bank) {
    bank.stacks = stacks;
    ctx.emit({ type: 'aura', targetId: priest.id, name: bank.name, gained: true });
    return;
  }
  ctx.applyAura(priest, {
    id: SPIRIT_BOMB_PROGRESS_ID,
    name: 'Tithe Bomb',
    kind: 'spirit_bomb_charge',
    // Finite JSON-safe backing value; persistent_aura owns the non-aging rule.
    remaining: 1,
    duration: 1,
    value: 0,
    stacks,
    sourceId: priest.id,
    school: 'shadow',
    undispellable: true,
  });
}

export function resetSpiritBombProgress(ctx: SimContext, priest: Entity): void {
  const bank = priest.auras.find(
    (aura) => aura.id === SPIRIT_BOMB_PROGRESS_ID && aura.sourceId === priest.id,
  );
  if (bank) {
    priest.auras.splice(priest.auras.indexOf(bank), 1);
    ctx.emit({ type: 'aura', targetId: priest.id, name: bank.name, gained: false });
  }
  if (priest.castingAbility === SPIRIT_BOMB_ID) ctx.cancelCast(priest);
}
