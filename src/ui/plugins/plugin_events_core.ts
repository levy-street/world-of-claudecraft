// Pure plugin-event mapping core (registered in UI_PURE_CORES): folds the
// SimEvent stream the HUD already drains into the small, stable, versioned
// event vocabulary the plugin API exposes (docs/prd/plugins-store.md, API v1).
// DOM-free, i18n-free, allocation-honest (one small object per MAPPED event;
// unmapped events return null and allocate nothing). The host fans the mapped
// events out to sandboxed plugin handlers; this module never sees a plugin.

import { type SimEvent, xpForLevel } from '../../sim/types';

/** The plugin API v1 event vocabulary. Additions are append-only. */
export type PluginEventType =
  | 'combat'
  | 'chat'
  | 'loot'
  | 'xp'
  | 'levelup'
  | 'quest'
  | 'death'
  | 'respawn'
  | 'deed'
  | 'tick'
  | 'enable'
  | 'disable';

export interface PluginEvent {
  readonly type: PluginEventType;
  readonly data: Record<string, unknown>;
}

/** The narrow world surface the player snapshot reads (structural subset of
 * IWorld + its player entity; both Sim and ClientWorld satisfy it). */
export interface PluginPlayerSource {
  player: {
    id: number;
    name: string;
    level: number;
    hp: number;
    maxHp: number;
    pos: { x: number; y: number; z: number };
  };
  xp: number;
  copper: number;
}

/** The read-only player snapshot handed to plugins (woc.player() and the tick
 * event). A fresh object every call, so a plugin can never mutate HUD state.
 * `id` is the player's own entity id (combat events attribute by entity id),
 * and `xpNext` is the XP required for the current level's bar (the classic
 * curve via xpForLevel), so meters and forecasts need no private imports. */
export interface PluginPlayerSnapshot {
  id: number;
  name: string;
  level: number;
  hp: number;
  hpMax: number;
  xp: number;
  xpNext: number;
  copper: number;
  x: number;
  z: number;
}

export function buildPlayerSnapshot(src: PluginPlayerSource): PluginPlayerSnapshot {
  const p = src.player;
  return {
    id: p.id,
    name: p.name,
    level: p.level,
    hp: p.hp,
    hpMax: p.maxHp,
    xp: src.xp,
    xpNext: xpForLevel(p.level),
    copper: src.copper,
    x: Math.round(p.pos.x * 10) / 10,
    z: Math.round(p.pos.z * 10) / 10,
  };
}

/**
 * Map one SimEvent to its plugin event, or null when the event is not part of
 * the v1 vocabulary (wire details, presentation cues, and social plumbing stay
 * private). Chat lines pass the already-server-filtered text; plugins get the
 * same view the chat log paints.
 */
export function mapSimEventForPlugins(ev: SimEvent): PluginEvent | null {
  switch (ev.type) {
    case 'damage':
      return {
        type: 'combat',
        data: {
          kind: 'damage',
          sourceId: ev.sourceId,
          targetId: ev.targetId,
          amount: ev.amount,
          crit: ev.crit,
          school: ev.school,
          ability: ev.ability,
          outcome: ev.kind,
        },
      };
    case 'heal':
      return { type: 'combat', data: { kind: 'heal', targetId: ev.targetId, amount: ev.amount } };
    case 'death':
      return {
        type: 'combat',
        data: { kind: 'death', entityId: ev.entityId, killerId: ev.killerId },
      };
    case 'xp':
      return { type: 'xp', data: { amount: ev.amount, rested: ev.rested ?? 0 } };
    case 'levelup':
      return { type: 'levelup', data: { level: ev.level } };
    case 'loot':
      return { type: 'loot', data: { kind: 'text', text: ev.text } };
    case 'lootRoll':
      return {
        type: 'loot',
        data: { kind: 'roll', itemId: ev.itemId, itemName: ev.itemName, quality: ev.quality },
      };
    case 'chat':
      return {
        type: 'chat',
        data: {
          from: ev.from,
          fromPid: ev.fromPid,
          channel: ev.channel ?? 'say',
          text: ev.text,
        },
      };
    case 'questAccepted':
      return { type: 'quest', data: { stage: 'accepted', questId: ev.questId } };
    case 'questProgress':
      return {
        type: 'quest',
        data: {
          stage: 'progress',
          questId: ev.questId,
          objectiveIndex: ev.objectiveIndex,
          current: ev.current,
          required: ev.required,
        },
      };
    case 'questReady':
      return { type: 'quest', data: { stage: 'ready', questId: ev.questId } };
    case 'questDone':
      return { type: 'quest', data: { stage: 'done', questId: ev.questId } };
    case 'playerDeath':
      return { type: 'death', data: {} };
    case 'respawn':
      return { type: 'respawn', data: {} };
    case 'deedUnlocked':
      return { type: 'deed', data: { deedId: ev.deedId, retro: ev.retro === true } };
    default:
      return null;
  }
}
