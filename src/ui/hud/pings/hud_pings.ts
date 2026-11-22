// The HUD's party pings, built from the Hud's own members on first use (the
// hud_world_markers.ts pattern: Hud members are private, so the factory takes
// the Hud untyped; the members it reads are welded to hud.ts in
// tests/party_pings_hud.test.ts). Every closure reads the Hud live.
//
// The surface main.ts reaches through the targeting slice
// (src/game/targeting_actions.ts): the Ping key's press and release, the pad's
// flat press, and the fast-band tick that sounds, logs and minimaps the
// group's pings.

import {
  activePvpOpponentIds,
  isAttackableEntity,
  type PickInteractionWorld,
} from '../../../game/interactions';
import { partyPingsEnabled } from '../../../game/party_pings_setting';
import { sfx } from '../../../game/sfx';
import type { IWorld } from '../../../world_api';
import { MINIMAP_BASE_SCALE } from '../../minimap_painter';
import type { PainterHostWriters } from '../../painter_host';
import { chatChannelColor } from '../chat/chat_channels';
import { PingFeedController } from './ping_feed_controller';
import { PingWheelController } from './ping_wheel_controller';
import { groundPingContext, PING_GROUND_RAY_REACH, type PingContext } from './ping_wheel_core';

/** The private Hud members the factory reads. */
interface PingsHost {
  sim: IWorld;
  writerFacet: PainterHostWriters;
  renderer: {
    picking: {
      pick(x: number, y: number, attackIntent?: boolean): number | null;
      groundHit(x: number, y: number, maxDist: number): { x: number; y: number; z: number } | null;
    };
  };
  minimapZoom: number;
  log(text: string, color?: string, icon?: string, channel?: string): void;
}

/** The Hud's one handle on its pings. */
export interface HudPings {
  readonly wheel: PingWheelController;
  readonly feed: PingFeedController;
  key(phase: 'down' | 'up' | 'cancel', x: number, y: number): void;
  padPing(): void;
  /** The HUD's fast-band tick. */
  frame(): void;
}

/** What a unit is to the pinging player (an enemy draws Attack, a friend Assist). */
function unitContext(world: IWorld, id: number): PingContext {
  const e = world.entities.get(id);
  if (!e || e.dead) return { kind: 'none' };
  const hostile = isAttackableEntity(
    e,
    world.playerId,
    activePvpOpponentIds(world as unknown as PickInteractionWorld),
  );
  return { kind: 'unit', id, hostile, x: e.pos.x, y: e.pos.y, z: e.pos.z };
}

/** The handle, its controllers built on first use (the Hud's field initializer
 *  runs before the members they read exist). */
export function createHudPings(hud: object): HudPings {
  let built: { wheel: PingWheelController; feed: PingFeedController } | null = null;
  const parts = () => {
    built ??= buildPings(hud as PingsHost);
    return built;
  };
  return {
    get wheel() {
      return parts().wheel;
    },
    get feed() {
      return parts().feed;
    },
    key: (phase, x, y) => parts().wheel.key(phase, x, y),
    padPing: () => parts().wheel.padPing(),
    frame: () => parts().feed.frame(),
  };
}

function buildPings(h: PingsHost): { wheel: PingWheelController; feed: PingFeedController } {
  const doc = document;
  const pick = (x: number, y: number): PingContext => {
    const world = h.sim;
    const id = h.renderer.picking.pick(x, y, true);
    if (id !== null) {
      const unit = unitContext(world, id);
      if (unit.kind === 'unit') return unit;
    }
    // The floor actually under the cursor (a ray march, not the flat plane at
    // the player's feet), so a far or sloped ground ping lands where it points.
    const hit = h.renderer.picking.groundHit(x, y, PING_GROUND_RAY_REACH);
    return groundPingContext(hit, world.player.pos);
  };
  const wheel = new PingWheelController({
    doc,
    writers: h.writerFacet,
    mount: () => doc.getElementById('ui') ?? doc.body,
    now: () => performance.now(),
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    enabled: partyPingsEnabled,
    pick,
    targetContext: () => {
      const id = h.sim.player.targetId;
      return id === null || id === undefined ? { kind: 'none' } : unitContext(h.sim, id);
    },
    send: (p) => h.sim.sendPing(p.kind, p.target, p.x, p.y, p.z),
    later: (fn, ms) => {
      const handle = window.setTimeout(fn, ms);
      return () => window.clearTimeout(handle);
    },
  });
  const feed = new PingFeedController({
    doc,
    writers: h.writerFacet,
    world: () => h.sim,
    enabled: partyPingsEnabled,
    log: (text) => h.log(text, chatChannelColor('party'), undefined, 'party'),
    sound: (key, rate, gain) => sfx.playUi(key, { rate, gain, cooldown: 0.08 }),
    minimapScale: () => MINIMAP_BASE_SCALE * h.minimapZoom,
    minimapHost: () => doc.getElementById('minimap-disc'),
  });
  return { wheel, feed };
}
