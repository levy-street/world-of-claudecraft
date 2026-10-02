// The Katana Table (content/katana_forge.ts): kill credit on an equipped
// katana, and the `/katana` chat verbs that customize and evolve it at the
// table. Reached from the chat router (social/chat.ts) and from the kill
// credit loop (combat/damage.ts). Draws NO rng. Evolution swaps the main hand
// to the next EXISTING katana id and keeps the copy's payload, so stats always
// come from the item defs and the look is cosmetic.
import {
  KATANA_EVOLUTIONS,
  KATANA_KANJI,
  KATANA_PALETTES,
  KATANA_PARTS,
  KATANA_TABLE,
  KATANA_TABLE_RANGE,
  KATANA_TIER_IDS,
  type KatanaPart,
} from './content/katana_forge';
import { isKatanaColor, isKatanaKanji, MAX_KATANA_KILLS } from './katana_look';
import { normalizeLegendaryName } from './professions/legendary_name';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { ItemInstancePayload } from './types';

const KATANA_IDS: ReadonlySet<string> = new Set(KATANA_TIER_IDS);

export function isKatanaId(itemId: string | undefined | null): boolean {
  return !!itemId && KATANA_IDS.has(itemId);
}

/** The equipped main-hand katana payload, created on demand; null without a katana. */
function equippedKatana(meta: PlayerMeta, create: boolean): ItemInstancePayload | null {
  if (!isKatanaId(meta.equipment.mainhand)) return null;
  let payload = meta.equipmentInstance.mainhand;
  if (!payload) {
    if (!create) return null;
    payload = {};
    meta.equipmentInstance.mainhand = payload;
  }
  return payload;
}

/** Kill credit: one kill on the member's equipped katana, if they wield one. */
export function creditKatanaKill(meta: PlayerMeta): void {
  const payload = equippedKatana(meta, true);
  if (!payload) return;
  const look = payload.katana ?? {};
  look.kills = Math.min(MAX_KATANA_KILLS, (look.kills ?? 0) + 1);
  payload.katana = look;
}

/** Pure readout of what an evolution still needs; null when the tier is final. */
export function katanaEvolutionShortfall(
  itemId: string,
  kills: number,
  have: (materialId: string) => number,
  copper: number,
): {
  next: string;
  kills: number;
  materials: { itemId: string; missing: number }[];
  copper: number;
} | null {
  const evo = KATANA_EVOLUTIONS[itemId];
  if (!evo) return null;
  return {
    next: evo.next,
    kills: Math.max(0, evo.kills - kills),
    materials: evo.materials
      .map((m) => ({ itemId: m.itemId, missing: Math.max(0, m.count - have(m.itemId)) }))
      .filter((m) => m.missing > 0),
    copper: Math.max(0, evo.copper - copper),
  };
}

const USAGE =
  'Katana Table: /katana status | /katana evolve | /katana color <blade|guard|wrap|saya> <color> | /katana kanji <name> | /katana name <text>';

/** `/katana ...` from the chat router. Returns true when it handled the line. */
export function handleKatanaCommand(ctx: SimContext, pid: number, args: string[]): boolean {
  const r = ctx.resolve(pid);
  if (!r) return true;
  const { meta, e } = r;
  const verb = (args[0] ?? 'status').toLowerCase();
  if (verb === 'help') {
    ctx.notice(meta.entityId, USAGE);
    return true;
  }
  if (!isKatanaId(meta.equipment.mainhand)) {
    ctx.error(meta.entityId, 'Equip a katana in your main hand first.');
    return true;
  }
  const payload = equippedKatana(meta, true) as ItemInstancePayload;
  const look = payload.katana ?? {};
  const kills = look.kills ?? 0;

  if (verb === 'status') {
    const itemId = meta.equipment.mainhand as string;
    const short = katanaEvolutionShortfall(
      itemId,
      kills,
      (id) => ctx.countItem(id, pid),
      meta.copper,
    );
    ctx.notice(meta.entityId, `Your katana has slain ${kills} enemies.`);
    if (!short) ctx.notice(meta.entityId, 'This katana has reached its final form.');
    else if (short.kills === 0 && short.materials.length === 0 && short.copper === 0) {
      ctx.notice(meta.entityId, 'Your katana is ready to evolve at the Katana Table.');
    } else {
      ctx.notice(meta.entityId, `Kills still needed to evolve: ${short.kills}.`);
    }
    return true;
  }

  // Every change below happens AT the table.
  if (
    e.dead ||
    Math.hypot(e.pos.x - KATANA_TABLE.x, e.pos.z - KATANA_TABLE.z) > KATANA_TABLE_RANGE
  ) {
    ctx.error(meta.entityId, 'You must stand at the Katana Table.');
    return true;
  }

  if (verb === 'color') {
    const part = (args[1] ?? '').toLowerCase() as KatanaPart;
    const color = (args[2] ?? '').toLowerCase();
    if (!KATANA_PARTS.includes(part) || !isKatanaColor(part, color)) {
      ctx.error(meta.entityId, 'Unknown katana part or color.');
      return true;
    }
    look[part] = color;
    payload.katana = look;
    ctx.recalcPlayer(e); // refresh the render mirror (equippedInstances)
    ctx.notice(meta.entityId, 'Your katana has been refinished.');
    return true;
  }

  if (verb === 'kanji') {
    const id = (args[1] ?? '').toLowerCase();
    if (!isKatanaKanji(id)) {
      ctx.error(meta.entityId, 'Unknown kanji.');
      return true;
    }
    look.kanji = id;
    payload.katana = look;
    ctx.recalcPlayer(e);
    ctx.notice(meta.entityId, 'A kanji has been engraved on your blade.');
    return true;
  }

  if (verb === 'name') {
    const name = normalizeLegendaryName(args.slice(1).join(' '));
    if (!name) {
      ctx.error(meta.entityId, 'That is not a valid katana name.');
      return true;
    }
    payload.name = name;
    ctx.recalcPlayer(e);
    ctx.notice(meta.entityId, 'A name has been engraved on your blade.');
    return true;
  }

  if (verb === 'evolve') {
    const itemId = meta.equipment.mainhand as string;
    const evo = KATANA_EVOLUTIONS[itemId];
    if (!evo) {
      ctx.error(meta.entityId, 'This katana has reached its final form.');
      return true;
    }
    if (kills < evo.kills) {
      ctx.error(meta.entityId, 'Your katana has not slain enough enemies to evolve.');
      return true;
    }
    if (evo.materials.some((m) => ctx.countItem(m.itemId, pid) < m.count)) {
      ctx.error(meta.entityId, 'You lack the materials to evolve your katana.');
      return true;
    }
    if (meta.copper < evo.copper) {
      ctx.error(meta.entityId, 'You cannot afford to evolve your katana.');
      return true;
    }
    for (const m of evo.materials) ctx.removeItem(m.itemId, m.count, pid);
    meta.copper -= evo.copper;
    meta.equipment.mainhand = evo.next;
    ctx.recalcPlayer(e);
    ctx.notice(meta.entityId, 'Your katana has evolved!');
    return true;
  }

  ctx.notice(meta.entityId, USAGE);
  return true;
}

/** Exposed for tests and tooling: the full palette and kanji tables. */
export const KATANA_CHOICES = { palettes: KATANA_PALETTES, kanji: KATANA_KANJI };
