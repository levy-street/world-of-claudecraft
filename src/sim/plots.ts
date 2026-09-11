// Tidehold's housing plots: the for-sale sign at every plot gate is a static
// world object (like the Realm Builder monument) that shows the deed when read
// and sells the plot to the reader for its price in copper (Troy, 2026-09-08:
// "a plot sign that players will interact with to buy the home ... name of the
// plot, cost in gold based on its location and size").
//
// Ownership lives in two places on purpose: the PLAYER carries the deed ids it
// bought (PlayerMeta.ownedPlots, saved with the character), and the SIGN
// entity carries who holds it for everyone else to read (stamped on purchase
// and re-stamped when an owner reads their own sign after a reload). The plot
// geometry and prices are the ring city's (deepglass/citadel_ring.ts), so a
// re-laid ring moves the signs and the deeds together.

import { RING_PLOT_DEEDS, RING_PLOT_SIGNS, type PlotDeed } from './deepglass/citadel_ring';
import { createGroundObject } from './entity';
import type { RealmBuilderMonumentSpawnHost } from './realm_builder_monument_spawn';
import type { SimContext } from './sim_context';
import { dist2d, type Entity, PLOT_SIGN_TEMPLATE_ID, type PlotDeedView } from './types';

/** Reserved static ids, one per sign, after the Tidehold monument's block. */
export const PLOT_SIGN_ENTITY_BASE = 2_000_000_200;
const PLOT_INTERACT_RANGE = 4;

export function plotSignEntityId(index: number): number {
  return PLOT_SIGN_ENTITY_BASE + index;
}

export function plotDeedById(id: string): PlotDeed | null {
  return RING_PLOT_DEEDS.find((d) => d.id === id) ?? null;
}

export function plotDeedForEntity(entityId: number): PlotDeed | null {
  const i = entityId - PLOT_SIGN_ENTITY_BASE;
  return i >= 0 && i < RING_PLOT_DEEDS.length ? RING_PLOT_DEEDS[i] : null;
}

/** Spawn a sign object on every plot seat, in the Deepglass world only. */
export function spawnPlotSigns(host: RealmBuilderMonumentSpawnHost, presentationMode: string | undefined): void {
  if (presentationMode !== 'deepglass') return;
  RING_PLOT_SIGNS.forEach((seat, i) => {
    const id = plotSignEntityId(i);
    if (host.entities.has(id)) throw new Error(`Duplicate static service entity id: ${id}`);
    const deed = RING_PLOT_DEEDS[i];
    const sign = createGroundObject(id, '', deed.name, host.groundPos(seat.x, seat.z));
    sign.templateId = PLOT_SIGN_TEMPLATE_ID;
    sign.objectItemId = null;
    sign.lootable = true;
    sign.facing = seat.rotY;
    sign.prevFacing = seat.rotY;
    host.addEntity(sign);
  });
}

function ownerKey(ctx: SimContext, meta: { characterId?: number; entityId: number }): number {
  void ctx;
  return meta.characterId ?? meta.entityId;
}

function deedView(sign: Entity, deed: PlotDeed, meta: { copper: number; ownedPlots?: string[] }, you: number): PlotDeedView {
  const ownedByYou = meta.ownedPlots?.includes(deed.id) === true || sign.plotOwner?.characterId === you;
  return {
    id: deed.id,
    name: deed.name,
    size: deed.size,
    w: deed.w,
    d: deed.d,
    priceCopper: deed.priceCopper,
    ownerName: sign.plotOwner?.name ?? null,
    ownedByYou,
    yourCopper: meta.copper,
  };
}

/** Reading the sign: the deed card. A returning owner's sign is re-stamped
 *  here, so the name on it survives a world reload without a world-side save. */
export function inspectPlotSign(ctx: SimContext, sign: Entity, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const { meta } = r;
  const deed = plotDeedForEntity(sign.id);
  if (!deed) return false;
  const you = ownerKey(ctx, meta);
  if (meta.ownedPlots?.includes(deed.id) && sign.plotOwner?.characterId !== you) {
    sign.plotOwner = { characterId: you, name: meta.name };
  }
  ctx.emit({ type: 'plotSign', plot: deedView(sign, deed, meta, you), pid: meta.entityId });
  return true;
}

/** Buy the plot whose sign the player is standing at. Charges the deed's
 *  price, records the deed on the character and stamps the sign; the refreshed
 *  card follows on the same event, so the button the player pressed becomes
 *  the SOLD plate in the same frame. */
export function buyPlot(ctx: SimContext, deedId: string, pid?: number): boolean {
  const r = ctx.resolve(pid);
  if (!r) return false;
  const { meta, e: p } = r;
  const deed = plotDeedById(deedId);
  if (!deed) return false;
  const sign = ctx.entities.get(plotSignEntityId(RING_PLOT_DEEDS.indexOf(deed)));
  if (!sign) return false;
  if (p.dead) {
    ctx.error(meta.entityId, "You can't do that while dead.");
    return false;
  }
  if (dist2d(p.pos, sign.pos) > PLOT_INTERACT_RANGE) {
    ctx.error(meta.entityId, 'Too far away.');
    return false;
  }
  const you = ownerKey(ctx, meta);
  if (meta.ownedPlots?.includes(deed.id)) {
    ctx.error(meta.entityId, 'You already hold this deed.');
    return false;
  }
  if (sign.plotOwner && sign.plotOwner.characterId !== you) {
    ctx.error(meta.entityId, `${sign.plotOwner.name} holds this deed.`);
    return false;
  }
  if (meta.copper < deed.priceCopper) {
    ctx.error(meta.entityId, "You can't afford this plot.");
    return false;
  }
  meta.copper -= deed.priceCopper;
  meta.ownedPlots = [...(meta.ownedPlots ?? []), deed.id];
  sign.plotOwner = { characterId: you, name: meta.name };
  ctx.emit({ type: 'plotSign', plot: deedView(sign, deed, meta, you), pid: meta.entityId });
  return true;
}
