// The seasonal-event tick: opens and closes an event in the world. Runs once per
// sim tick, draws no rng, and does almost nothing on a tick where the active event
// did not change (one Map lookup, one walk of the player roster's worn flags).
//
// On open: the event's keeper NPC is raised at each city's stall, each under her own
// reserved singleton id.
// On close: the keeper leaves and every seasonal cosmetic comes off every body.
// The event's solid city dressing collides exactly while it runs: its gate is synced at
// the top of every tick, beside the ferry berths (world_gates.ts), never here.
// While open: a worn pumpkin head is put back on a body that lost it (a death, a
// relog), so wearing it is the character's standing choice for the whole event,
// for as long as the character still owns one (bags or bank): a head destroyed
// while worn comes off for good, never stuck on a body nothing can take it off.
import { countStacked } from '../bags';
import {
  CARVED_PUMPKIN_HEAD_ID,
  GOURDLIGHT_EVE_ID,
  GOURDLIGHT_KEEPER_NPC,
  GOURDLIGHT_KEEPER_POSTS,
  PUMPKIN_HEAD_AURA_ID,
} from '../content/gourdlight_eve';
import { createNpc } from '../entity';
import { resolvedKeeperPosts } from '../seasonal_keeper_posts';
import type { SimContext } from '../sim_context';
import type { NpcDef } from '../types';
import { updateGourdlightDailyObjects } from './gourdlight_dailies';
import { updateHauntedPumpkins } from './haunted_pumpkins';
import { updateScarecrow } from './scarecrow';
import { updateEventBoundItems } from './seasonal_bound_items';
import {
  pumpkinHeadAura,
  SEASONAL_COSMETIC_AURA_IDS,
  stripSeasonalAura,
  stripTricks,
} from './seasonal_cosmetics';
import { activeSeasonalEventOf } from './seasonal_state';
import { updateToyCauldrons } from './toy_cauldron';

/** Each event's keeper: the NPC who works a stall in each main city while it runs (one
 *  entity per stall, all under the one template). Her spots resolve against the live
 *  world (seasonal_keeper_posts.ts), the same answer the renderer draws her stall from. */
const EVENT_KEEPERS: Readonly<Record<string, NpcDef>> = {
  [GOURDLIGHT_EVE_ID]: GOURDLIGHT_KEEPER_NPC,
};

/** The seasonal event ids this build knows (the dev toggle validates against it). */
export const KNOWN_SEASONAL_EVENTS: readonly string[] = Object.keys(EVENT_KEEPERS);

function raiseKeeper(ctx: SimContext, eventId: string): void {
  const def = EVENT_KEEPERS[eventId];
  if (!def) return;
  for (const post of resolvedKeeperPosts(ctx.cfg.seed)) {
    if (ctx.entities.has(post.post.entityId)) continue;
    const npc = createNpc(post.post.entityId, def, ctx.groundPos(post.pos.x, post.pos.z));
    npc.facing = post.facing;
    npc.prevFacing = post.facing;
    ctx.addEntity(npc);
  }
}

function dismissKeeper(ctx: SimContext, eventId: string | null): void {
  const def = eventId ? EVENT_KEEPERS[eventId] : undefined;
  if (!def) return;
  for (const post of GOURDLIGHT_KEEPER_POSTS) {
    const npc = ctx.entities.get(post.entityId);
    if (npc && npc.templateId === def.id) ctx.dropEntity(post.entityId);
  }
}

export function updateSeasonal(ctx: SimContext): void {
  const state = ctx.seasonal;
  const active = activeSeasonalEventOf(state);
  const edge = active !== state.lastActive;
  // Toy cauldrons: forget the ones whose time ran out, and clear every one on a close.
  updateToyCauldrons(ctx, edge && active !== GOURDLIGHT_EVE_ID);
  if (edge) {
    updateHauntedPumpkins(ctx, active);
    updateGourdlightDailyObjects(ctx, active);
    dismissKeeper(ctx, state.lastActive);
    state.lastActive = active;
    if (active === null) {
      for (const meta of ctx.players.values()) {
        const e = ctx.entities.get(meta.entityId);
        if (!e) continue;
        for (const id of SEASONAL_COSMETIC_AURA_IDS) stripSeasonalAura(ctx, e, id);
      }
    }
  }
  // Event-bound items (the broom) leave with their event, also from a later login.
  updateEventBoundItems(ctx, active, edge);
  // The field boss rises and leaves with his event (and runs his fight while he lives).
  updateScarecrow(ctx, active);
  if (active === null) return;
  raiseKeeper(ctx, active);
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || e.dead) continue;
    // a trick body never fights: combat starting ends it (graphics fairness)
    if (e.inCombat) stripTricks(ctx, e);
    if (!meta.pumpkinHeadWorn) continue;
    const owned =
      countStacked(meta.inventory, CARVED_PUMPKIN_HEAD_ID) > 0 ||
      countStacked(meta.bank.inventory, CARVED_PUMPKIN_HEAD_ID) > 0;
    if (!owned) {
      meta.pumpkinHeadWorn = false;
      stripSeasonalAura(ctx, e, PUMPKIN_HEAD_AURA_ID);
      continue;
    }
    if (!e.auras.some((a) => a.id === PUMPKIN_HEAD_AURA_ID))
      ctx.applyAura(e, pumpkinHeadAura(e.id));
  }
}
