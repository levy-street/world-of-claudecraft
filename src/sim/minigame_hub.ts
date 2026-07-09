// The Proving Grounds: a shared circular room reached by a glowing portal just
// outside Eastbrook Vale, where the two event heralds stand. Walk into the
// overworld portal (or click it) to enter; walk into the exit portal to return.
//
// This is ONE shared room, not a per-party instance, so there is no slot
// fan-out: the two portal fixtures are reserved-id, zero-rng world-init spawns
// (the HC_HERALD_ID idiom, see content/hodrics.ts) that the parity goldens
// never see. The teleport in/out mirrors instances/dungeons enterDungeon /
// leaveDungeon (set pos + prevPos + rebucket + clear target), minus the slot
// machinery. Movers are held inside the room by a radial clamp in colliders.ts
// (isMinigameHubPos), and the renderer draws the room + portals from the same
// data.ts anchors this module spawns to.

import {
  HUB_EXIT_TEMPLATE,
  HUB_PORTAL_TEMPLATE,
  isMinigameHubPos,
  MINIGAME_HUB,
  MINIGAME_HUB_ENTRY,
  MINIGAME_HUB_EXIT,
  MINIGAME_HUB_PORTAL_POS,
} from './data';
import { createGroundObject } from './entity';
import type { SimContext } from './sim_context';
import { dist2d, type Entity } from './types';

// Reserved out-of-band entity ids (see content/gauntlet.ts GAUNTLET_RECRUITER_ID
// and content/hodrics.ts HC_HERALD_ID for the +100-block reservation scheme).
export const HUB_PORTAL_ID = 1_000_000_201;
export const HUB_EXIT_ID = 1_000_000_202;

// Walking this close to a portal passes you through it (the dungeon-door idiom;
// slightly wider than DOOR_TRIGGER_RADIUS so the flat far-band floor never
// leaves a gap the mover skips over between ticks).
const PORTAL_TRIGGER_RADIUS = 2.5;

// Spawn the two portal fixtures once at world init. Guarded and reserved-id, so
// re-entry is a no-op and the nextId sequence / shared rng stream are untouched.
export function spawnMinigameHub(ctx: SimContext): void {
  // The portals carry no floating name (empty label): the glowing stone arch is
  // self-evident and it keeps them out of the localized-object-name surface.
  if (!ctx.entities.has(HUB_PORTAL_ID)) {
    const portal = createGroundObject(
      HUB_PORTAL_ID,
      '',
      '',
      ctx.groundPos(MINIGAME_HUB_PORTAL_POS.x, MINIGAME_HUB_PORTAL_POS.z),
    );
    portal.templateId = HUB_PORTAL_TEMPLATE;
    portal.lootable = true; // click-to-enter, and the friendly interact cursor
    ctx.addEntity(portal);
  }
  if (!ctx.entities.has(HUB_EXIT_ID)) {
    const exit = createGroundObject(
      HUB_EXIT_ID,
      '',
      '',
      ctx.groundPos(MINIGAME_HUB.x + MINIGAME_HUB_EXIT.x, MINIGAME_HUB.z + MINIGAME_HUB_EXIT.z),
    );
    exit.templateId = HUB_EXIT_TEMPLATE;
    exit.lootable = true;
    ctx.addEntity(exit);
  }
}

// Teleport into the shared room, landing on the entrance mark facing the heralds.
export function enterMinigameHub(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r || r.e.dead) return;
  const p = r.e;
  p.pos = ctx.groundPos(
    MINIGAME_HUB.x + MINIGAME_HUB_ENTRY.x,
    MINIGAME_HUB.z + MINIGAME_HUB_ENTRY.z,
  );
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.facing = 0;
  p.targetId = null;
  p.autoAttack = false;
  ctx.emit({
    type: 'log',
    text: 'You step through the shimmering portal into the Proving Grounds.',
    color: '#b9f',
    pid: p.id,
  });
}

// Teleport back to Eastbrook, landing a few paces south of the entrance portal
// so the walk-in trigger does not immediately send you back through.
export function leaveMinigameHub(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r || r.e.dead) return;
  const p = r.e;
  p.pos = ctx.groundPos(MINIGAME_HUB_PORTAL_POS.x, MINIGAME_HUB_PORTAL_POS.z - 4);
  p.prevPos = { ...p.pos };
  ctx.rebucket(p);
  p.targetId = null;
  p.autoAttack = false;
  ctx.emit({
    type: 'log',
    text: 'You step back into Eastbrook Vale.',
    color: '#b9f',
    pid: p.id,
  });
}

// Per-player, per-tick walk-in check (called from the coordinator's movement
// phase next to updateDoorTriggers). Inside the room only the exit portal is
// live; outside only the entrance portal is: the split prevents cross-triggering
// and, with the landing offsets above, any re-trigger loop.
export function updateHubPortalTriggers(ctx: SimContext, p: Entity): void {
  if (p.kind !== 'player') return;
  if (isMinigameHubPos(p.pos.x)) {
    const exit = ctx.entities.get(HUB_EXIT_ID);
    if (exit && dist2d(p.pos, exit.pos) < PORTAL_TRIGGER_RADIUS) leaveMinigameHub(ctx, p.id);
    return;
  }
  const portal = ctx.entities.get(HUB_PORTAL_ID);
  if (portal && dist2d(p.pos, portal.pos) < PORTAL_TRIGGER_RADIUS) enterMinigameHub(ctx, p.id);
}
