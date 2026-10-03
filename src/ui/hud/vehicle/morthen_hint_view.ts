// Pure view core for the Graveyard Shift hint line: one short line per kit
// ability, shown once per shift at the moment the ability becomes useful (the
// first playtest found the kit unreadable from tooltips alone). Sexton's Chain
// on arrival, Shadow Pulse the first time the Dread pays for it, Raise the
// Fallen the first time a corpse lies within its reach. One line at a time,
// each held for MORTHEN_HINT_MS, later ones queued. The shift controller shows
// each line through the HUD banner, which every surface (desktop, touch, pad)
// already reads.

import { MORTHEN_KIT } from '../../../sim/graveyard_shift/kit';
import type { Entity } from '../../../sim/types';
import { dist2d } from '../../../sim/types';
import { type TranslationKey, t } from '../../i18n';

export type MorthenHintId = 'chain' | 'pulse' | 'raise';

export const MORTHEN_HINT_MS = 9000;
// The corpse scan walks every entity, so it runs at most this often, and only
// until the Raise the Fallen line has been queued.
export const MORTHEN_CORPSE_CHECK_MS = 500;

const HINT_ABILITY: Readonly<Record<MorthenHintId, string>> = {
  chain: 'gshift_sextons_chain',
  pulse: 'gshift_shadow_pulse',
  raise: 'gshift_raise_fallen',
};

const HINT_KEY: Readonly<Record<MorthenHintId, TranslationKey>> = {
  chain: 'devCommand.graveyardShift.hints.chain',
  pulse: 'devCommand.graveyardShift.hints.pulse',
  raise: 'devCommand.graveyardShift.hints.raise',
};

const PULSE = MORTHEN_KIT.find((def) => def.id === HINT_ABILITY.pulse) ?? null;
const RAISE = MORTHEN_KIT.find((def) => def.id === HINT_ABILITY.raise) ?? null;
const RAISE_EFFECT = RAISE?.effects.find((effect) => effect.type === 'gshiftRaiseFallen');
const RAISE_RADIUS = RAISE_EFFECT?.type === 'gshiftRaiseFallen' ? RAISE_EFFECT.radius : 0;

/** The hint line, localized. */
export function morthenHintText(id: MorthenHintId): string {
  return t(HINT_KEY[id]);
}

export type MorthenCorpseCandidate = Pick<Entity, 'id' | 'dead' | 'kind' | 'ownerId' | 'pos'>;

/** A corpse Raise the Fallen could reach: a fallen player or an ownerless dead
 *  creature within its radius (the sim's own rule, minus the run's raised set,
 *  which the client cannot see; a hint only needs the first corpse). */
export function morthenCorpseInReach(
  entities: Iterable<MorthenCorpseCandidate>,
  self: Pick<Entity, 'id' | 'pos'>,
): boolean {
  for (const e of entities) {
    if (!e.dead || e.id === self.id || e.ownerId !== null) continue;
    if (e.kind !== 'player' && e.kind !== 'mob') continue;
    if (dist2d(e.pos, self.pos) <= RAISE_RADIUS) return true;
  }
  return false;
}

export function createMorthenHints() {
  const queued: MorthenHintId[] = [];
  const seen = new Set<MorthenHintId>();
  let current: MorthenHintId | null = null;
  let shownAt = 0;
  let corpseCheckedAt = Number.NEGATIVE_INFINITY;
  function offer(id: MorthenHintId): void {
    if (seen.has(id)) return;
    seen.add(id);
    queued.push(id);
  }
  return {
    /** The hint to show this frame, or null. Positional so a frame allocates nothing. */
    tick(nowMs: number, dread: number, corpseInReach: () => boolean): MorthenHintId | null {
      offer('chain');
      if (PULSE && dread >= PULSE.cost) offer('pulse');
      if (!seen.has('raise') && nowMs - corpseCheckedAt >= MORTHEN_CORPSE_CHECK_MS) {
        corpseCheckedAt = nowMs;
        if (corpseInReach()) offer('raise');
      }
      if (current !== null && nowMs - shownAt >= MORTHEN_HINT_MS) current = null;
      if (current === null && queued.length > 0) {
        current = queued.shift() ?? null;
        shownAt = nowMs;
      }
      return current;
    },
    /** A new shift shows every line again. */
    reset(): void {
      queued.length = 0;
      seen.clear();
      current = null;
      corpseCheckedAt = Number.NEGATIVE_INFINITY;
    },
  };
}
