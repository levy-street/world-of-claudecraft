// Slash-command readout formatters (W5), extracted verbatim from the Sim monolith
// behind SimContext. These are the ~40 `*Readout` builders the chat() router (in the
// sibling social/chat.ts) dispatches to, plus the three chat-only helpers they call
// (auraLabel/threatName/nearbyLabel) and the readout-only consts (HARMFUL_AURA_KINDS/
// isHarmfulAura, NEARBY_RANGE/NEARBY_MAX).
//
// This is a MOVE: statements, branches, and formatting are byte-identical to the
// pre-move Sim methods. None of these draw rng or mutate state; each returns a string.
// They are reached only from chat() (a non-literal `error(id, fn(...))` arg), so the
// S3 i18n guard never scanned their internal `return '...'` strings; the existing en/
// em-dash readout literals are preserved byte-for-byte under the move-not-rewrite waiver.

import { isDebuffAura } from '../aura_classify';
import { isRooted } from '../combat/cc';
import {
  FIRST_TALENT_LEVEL,
  pointsSpent,
  talentPointsAtLevel,
  talentsFor,
} from '../content/talents';
import {
  ABILITIES,
  abilitiesKnownAt,
  CLASSES,
  DUNGEON_LIST,
  ITEMS,
  QUESTS,
  ZONES,
  zoneAt,
} from '../data';
import { formatMoney } from '../format_money';
import { MARKET_MAX_LISTINGS } from '../market';
import * as petCommands from '../pet/pet_commands';
import { FALL_SAFE_DISTANCE, type PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { threatEntries } from '../threat';
import {
  type ArenaFormat,
  type Aura,
  type AuraKind,
  dist2d,
  type Entity,
  type EquipSlot,
  FISHING_CAST_ID,
  MAX_LEVEL,
  MELEE_RANGE,
  xpForLevel,
} from '../types';
import { groundHeight } from '../world';

const NEARBY_RANGE = 40; // /nearby scan radius — wider than say, tighter than yell
const NEARBY_MAX = 10; // cap the /nearby list so a crowded camp can't spam chat

// Builds the self-only "/stats" readout line from live entity state. The
// resource clause is dropped for classes whose resourceType is null.
export function statsReadout(meta: PlayerMeta, e: Entity): string {
  const className = CLASSES[meta.cls].name;
  const crit = (e.critChance * 100).toFixed(1);
  let line = `Level ${e.level} ${className} — HP ${Math.round(e.hp)}/${Math.round(e.maxHp)}`;
  if (e.resourceType) {
    const res = e.resourceType.charAt(0).toUpperCase() + e.resourceType.slice(1);
    line += `, ${res} ${Math.round(e.resource)}/${Math.round(e.maxResource)}`;
  }
  line += `. AP ${Math.round(e.attackPower)}, Crit ${crit}%, Armor ${Math.round(e.stats.armor)}.`;
  return line;
}
// Self-only readout of carried items for "/bags": items sorted by quality
// (epic first), ties keeping inventory order, with the purse appended via
// formatMoney. Reads only PlayerMeta state, so it works online for free.
export function bagsReadout(meta: PlayerMeta): string {
  const purse = `Purse: ${formatMoney(meta.copper)}.`;
  if (meta.inventory.length === 0) return `Your bags are empty. ${purse}`;
  const rank: Record<string, number> = { epic: 0, rare: 1, uncommon: 2, common: 3, poor: 4 };
  const sorted = meta.inventory
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const qa = rank[ITEMS[a.s.itemId]?.quality ?? 'common'] ?? 3;
      const qb = rank[ITEMS[b.s.itemId]?.quality ?? 'common'] ?? 3;
      return qa - qb || a.i - b.i;
    });
  const parts = sorted.map(({ s }) => {
    const name = ITEMS[s.itemId]?.name ?? s.itemId;
    return s.count > 1 ? `${name} x${s.count}` : name;
  });
  return `Bags (${parts.length}): ${parts.join(', ')}. ${purse}`;
}
// Self-only readout of the player's party: each member in join order with
// level, class, and HP% (or (dead)/(offline)), the leader tagged [leader].
export function partyReadout(ctx: SimContext, pid: number): string {
  const party = ctx.partyOf(pid);
  if (!party) return 'You are not in a party.';
  const parts = party.members.map((mPid) => {
    const meta = ctx.players.get(mPid);
    const e = ctx.entities.get(mPid);
    if (!meta || !e) return meta ? `${meta.name} (offline)` : `Player ${mPid} (offline)`;
    const cls = CLASSES[meta.cls].name;
    const state = e.hp <= 0 ? '(dead)' : `${Math.round((e.hp / e.maxHp) * 100)}%`;
    const tag = mPid === party.leader ? ' [leader]' : '';
    return `${meta.name} (Lvl ${e.level} ${cls}, ${state})${tag}`;
  });
  return `${party.raid ? 'Raid' : 'Party'} (${party.members.length}/${ctx.partyCapacity(party)}): ${parts.join(', ')}.`;
}
// Self-only readout for "/zones": lists every overworld zone in travel order
// (south -> north) with its level range, tagging the zone the player is in.
// `currentZ` is the player's world Z (use zoneAt(currentZ) to find their zone).
// ZONES is the ordered ZoneDef[] from ./data; each has .name and
// .levelRange = [min, max].
export function zonesReadout(currentZ: number): string {
  if (ZONES.length === 0) return 'No zones are defined.';
  const here = zoneAt(currentZ);
  const parts = ZONES.map((z) => {
    const line = `${z.name} (Lvl ${z.levelRange[0]}-${z.levelRange[1]})`;
    return z.id === here.id ? `${line} [you are here]` : line;
  });
  return `Zones (${ZONES.length}): ${parts.join(', ')}.`;
}
// Self-only readout of a character's Ashen Coliseum standing. Reads only the
// persisted PlayerMeta arena fields (no new state). Draws count as neither a
// win nor a loss (see resolveArena), so "matches played" is wins + losses.
export function arenaReadout(meta: PlayerMeta): string {
  const part = (label: ArenaFormat, rating: number, wins: number, losses: number): string => {
    const played = wins + losses;
    if (played <= 0) return `${label} Rating ${rating} - no matches played yet`;
    const pct = Math.round((wins / played) * 100);
    return `${label} Rating ${rating} - ${wins} wins, ${losses} losses (${pct}% win rate)`;
  };
  return `Arena: ${part('1v1', meta.arenaRating, meta.arenaWins, meta.arenaLosses)}. ${part('2v2', meta.arena2v2Rating, meta.arena2v2Wins, meta.arena2v2Losses)}.`;
}
export function buybackReadout(meta: PlayerMeta): string {
  const slots = meta.vendorBuyback.filter((s) => ITEMS[s.itemId] && s.count > 0);
  if (slots.length === 0) return 'Your vendor buyback list is empty.';
  const parts = slots.map((s) => {
    const def = ITEMS[s.itemId];
    const qty = s.count > 1 ? ` x${s.count}` : '';
    return `${def.name}${qty} (${formatMoney(def.sellValue)} each)`;
  });
  return `Vendor buyback (${slots.length}): ${parts.join(', ')}. Repurchase at any merchant.`;
}
export function comboReadout(ctx: SimContext, e: Entity): string {
  if (e.comboPoints <= 0) return 'You have no combo points built up.';
  const target = e.comboTargetId !== null ? ctx.entities.get(e.comboTargetId) : undefined;
  const on = target ? ` on ${target.name}` : '';
  return `Combo points: ${e.comboPoints}/5${on}.`;
}
// Readout for "/combat": reads only the live Entity.inCombat / combatTimer
// (no new fields). combatTimer is "time since last combat event"; a player
// lingers in combat until it reaches COMBAT_LINGER (the literal 5s drop-out
// window applied in updatePlayers, sim.ts where inCombat is recomputed). If
// inCombat is still set past that window, an enemy is actively engaged, so no
// countdown can be promised.
export function combatReadout(e: Entity): string {
  if (!e.inCombat) return 'You are not in combat.';
  const COMBAT_LINGER = 5;
  const remaining = COMBAT_LINGER - e.combatTimer;
  if (remaining > 0) {
    return `You are in combat — leaving in ${Math.ceil(remaining)}s if no further action.`;
  }
  return 'You are in combat (enemies still engaged).';
}
// Readout for "/dungeons": lists every group instance in entrance order with
// the overworld zone its door sits in and its suggested party size. Reads
// only the static DUNGEON_LIST (already entrance-sorted by index) and the
// door zone via zoneAt — no new fields.
export function dungeonsReadout(): string {
  const parts = DUNGEON_LIST.map(
    (d) => `${d.name} (${zoneAt(d.doorPos.z).name}, ${d.suggestedPlayers} players)`,
  );
  return `Dungeons (${parts.length}): ${parts.join(', ')}.`;
}
// Readout for "/consider": sizes up the current target's level versus yours.
// The verdict bands track the real combat model — meleeMissChance (types.ts)
// applies a sharp miss penalty once the target is 3+ levels above you (its
// `diff > 2` cliff), and dodge/crit also scale with the level gap — so a
// target 3+ levels up is flagged as a steep step beyond a merely tough one.
// Reads only the live target Entity.level versus your own (no new fields).
export function considerReadout(ctx: SimContext, self: Entity): string {
  const t = self.targetId !== null ? ctx.entities.get(self.targetId) : undefined;
  if (!t) return 'You have no target to consider.';
  const diff = t.level - self.level;
  let verdict: string;
  if (diff >= 5) verdict = 'an overwhelming fight';
  else if (diff >= 3) verdict = 'a daunting fight';
  else if (diff >= 1) verdict = 'a tough fight';
  else if (diff === 0) verdict = 'an even fight';
  else if (diff >= -2) verdict = 'a manageable fight';
  else verdict = 'an easy fight';
  return `${t.name} is level ${t.level} — ${verdict} for you (level ${self.level}).`;
}
// Readout for "/pois": the named landmarks of your current zone, nearest
// first, each with its distance in yards. Reads only the static ZoneDef.pois
// (the same labels the HUD pins on the map) and your live position — no new
// fields.
export function poisReadout(self: Entity): string {
  const zone = zoneAt(self.pos.z);
  if (zone.pois.length === 0) return `${zone.name} has no notable landmarks.`;
  const parts = zone.pois
    .map((p) => ({ label: p.label, d: dist2d(self.pos, { x: p.x, y: 0, z: p.z }) }))
    .sort((a, b) => a.d - b.d)
    .map((p) => `${p.label} (${Math.round(p.d)}yd)`);
  return `Landmarks in ${zone.name} (${parts.length}): ${parts.join(', ')}.`;
}
// Readout for "/completed": the quests you have turned in, in completion
// order (questsDone is a Set whose insertion order is preserved on save/load).
// Reads only PlayerMeta.questsDone + the QUESTS registry for names (no new
// fields); distinct from /quest, which lists the active log.
export function completedReadout(meta: PlayerMeta): string {
  const names = [...meta.questsDone].map((id) => QUESTS[id]?.name ?? id);
  if (names.length === 0) return 'You have not completed any quests yet.';
  return `Completed quests (${names.length}): ${names.join(', ')}.`;
}
// Readout for "/listings": your own active World Market listings (house stock
// and other sellers excluded), each with item, asking price, and time left
// before it returns unsold. Reads only the live marketListings, ITEMS names,
// and ctx.time (no new fields); the count is shown against MARKET_MAX_LISTINGS
// so you know how much room you have left, mirroring the cap in marketList.
export function listingsReadout(ctx: SimContext, meta: PlayerMeta): string {
  const mine = ctx.marketListings.filter((l) => ctx.marketListingBelongsTo(l, meta));
  if (mine.length === 0) return 'You have no goods on the World Market.';
  const parts = mine.map((l) => {
    const name = ITEMS[l.itemId]?.name ?? l.itemId;
    const qty = l.count > 1 ? ` x${l.count}` : '';
    const secs = Math.max(0, Math.ceil(l.expiresAt - ctx.time));
    const h = Math.floor(secs / 3600),
      m = Math.floor((secs % 3600) / 60);
    const left = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m` : `${secs}s`;
    return `${name}${qty} — ${formatMoney(l.price)} (${left} left)`;
  });
  return `Your market listings (${parts.length}/${MARKET_MAX_LISTINGS}): ${parts.join(', ')}.`;
}
// Self-only readout of the auras on the player's current target, each tagged
// [buff] or [debuff]. Mirrors the self-aura readout but reaches across to the
// target's live Entity.auras, so it works for mobs, pets, and other players.
export function targetBuffsReadout(ctx: SimContext, self: Entity): string {
  const target = self.targetId !== null ? ctx.entities.get(self.targetId) : undefined;
  if (!target || target.hp <= 0) return 'You have no target.';
  const auras = target.auras;
  if (auras.length === 0) return `${target.name} has no active effects.`;
  const parts = auras.map((a) => {
    const stack = (a.stacks ?? 1) > 1 ? ` x${a.stacks}` : '';
    const tag = isDebuffAura(a.kind, a.value) ? 'debuff' : 'buff';
    return `${a.name}${stack} [${tag}] (${Math.ceil(a.remaining)}s)`;
  });
  return `Effects on ${target.name} (${auras.length}): ${parts.join(', ')}.`;
}
// Self-only readout of current movement speed as a percent of normal run
// speed. Effective speed is RUN_SPEED * moveSpeedMult(p), where the
// multiplier folds slow/stealth auras against speed buffs; a root pins the
// player regardless of the multiplier, so it is reported first.
export function speedReadout(ctx: SimContext, e: Entity): string {
  if (isRooted(e)) return 'You are rooted in place and cannot move.';
  const mult = ctx.moveSpeedMult(e);
  const pct = Math.round(mult * 100);
  if (pct > 100) return `Movement speed: ${pct}% of normal (hastened).`;
  if (pct < 100) return `Movement speed: ${pct}% of normal (slowed).`;
  return 'Movement speed: 100% of normal.';
}
// Self-only readout for /attack: reads only live Entity auto-attack state
// (autoAttack/swingTimer/targetId). The displayed swing interval reuses the
// exact expression the engine resets the timer with (weapon.speed *
// swingIntervalMult), so it reflects any active haste/slow auras.
export function attackReadout(ctx: SimContext, p: Entity, meta: PlayerMeta): string {
  if (!p.autoAttack) return 'Auto-attack is off.';
  const t = p.targetId !== null ? ctx.entities.get(p.targetId) : null;
  if (!t || t.dead) return 'Auto-attack is on, but you have no valid target.';
  // ranged classes (hunter auto shot, caster wands) swing at their ranged
  // speed; everyone else uses the equipped weapon's speed
  const base = CLASSES[meta.cls].ranged?.speed ?? p.weapon.speed;
  const interval = base * ctx.swingIntervalMult(p);
  const next = p.swingTimer <= 0 ? 'now' : `in ${p.swingTimer.toFixed(1)}s`;
  return `Auto-attack is on against ${t.name} — next swing ${next} (${interval.toFixed(1)}s swing).`;
}
// Overpower is a warrior reactive: an enemy dodging the player's attack opens
// a 5s window (overpowerUntil = time + 5) in which the ability becomes usable.
// It is neither an aura nor a normal cooldown, so no other readout exposes it.
export function overpowerReadout(ctx: SimContext, e: Entity, meta: PlayerMeta): string {
  if (meta.cls !== 'warrior') return 'Overpower is a warrior ability; your class cannot use it.';
  const remaining = Math.ceil(e.overpowerUntil - ctx.time);
  if (remaining > 0) {
    return `Overpower is ready — strike within ${remaining}s (an enemy dodged your attack).`;
  }
  return 'Overpower is not available. It opens for 5s after an enemy dodges your attack.';
}
// Reports the active shapeshift form or combat stance. Anchored to the
// same toggle set the cast path treats as mutually-exclusive persistent
// states (form_bear / form_cat / defensive_stance / stealth); realistically
// only one is ever active, so the first match is the answer.
export function formReadout(e: Entity): string {
  const form = e.auras.find(
    (a) =>
      a.kind === 'form_bear' ||
      a.kind === 'form_cat' ||
      a.kind === 'form_travel' ||
      a.kind === 'defensive_stance' ||
      a.kind === 'stealth',
  );
  if (!form) return 'You are not in any form or stance.';
  if (form.kind === 'stealth') return 'You are stealthed.';
  return `You are in ${form.name}.`;
}
// Self-only readout of the five-second-rule mana state (#103 out-of-combat
// regen). `fiveSecondRule` is the seconds elapsed since the player last spent
// mana on an ability (reset to 0 at sim.ts cast path, bumped by DT each tick);
// out-of-combat mana regen only ticks once it reaches FSR_THRESHOLD. Only
// mana users have meaningful state here — rage/energy classes never spend mana.
export function manaRegenReadout(e: Entity): string {
  const FSR_THRESHOLD = 5; // matches the `fiveSecondRule >= 5` gate in updateRegen
  if (e.resourceType !== 'mana') {
    return 'Mana regeneration does not apply to your class.';
  }
  if (e.fiveSecondRule >= FSR_THRESHOLD) {
    return 'Your mana is regenerating (out of combat for 5s+).';
  }
  const resumesIn = Math.ceil(FSR_THRESHOLD - e.fiveSecondRule);
  return `Mana regen is paused — resumes in ${resumesIn}s (you spent mana recently).`;
}
// Self-only readout of vertical/fall state — surfaces the otherwise-invisible
// jump physics (sim.ts updatePlayerMovement). Reads only live Entity fields and
// the same groundHeight()/FALL_SAFE_DISTANCE the landing-damage model uses, so
// the "this will hurt" preview matches what an actual landing would deal.
export function fallingReadout(ctx: SimContext, e: Entity): string {
  const ground = groundHeight(e.pos.x, e.pos.z, ctx.cfg.seed);
  if (e.onGround) return 'You are on solid ground.';
  const height = Math.max(0, Math.round(e.pos.y - ground));
  if (e.vy > 0) return `You are airborne and rising — ${height}yd above the ground.`;
  const drop = e.fallStartY - ground;
  const danger =
    drop > FALL_SAFE_DISTANCE
      ? ' Brace for impact — this fall is going to hurt.'
      : ' It should be a safe landing.';
  return `You are falling — ${height}yd above the ground.${danger}`;
}
// Self-only readout of the controlled pet's Growl cooldown and autocast state.
// Distinct from /pet (vitals) and /cooldowns (the player's own ability map,
// which never holds this timer).
export function petTauntReadout(ctx: SimContext, owner: Entity): string {
  return petCommands.petTauntReadout(ctx, owner);
}
// Druid forms park the mana bar in savedMana and run on rage/energy instead
// (entity.ts:126-130). That parked pool has no in-game UI — the bar shows the
// form's resource — so this readout is the only way to see what returns on
// shift-out. Gates on the class's natural resource so non-casters get a clean
// "never applies" rather than a misleading zero.
export function savedManaReadout(meta: PlayerMeta, e: Entity): string {
  if (CLASSES[meta.cls].resourceType !== 'mana') {
    return 'Only mana-using classes park mana; your class never does.';
  }
  if (e.resourceType === 'mana') {
    return 'Your mana is not parked — you are not shapeshifted.';
  }
  if (e.savedMana <= 0) {
    return 'You have no mana parked while shifted.';
  }
  return `You have ${Math.round(e.savedMana)} mana parked while shifted; it returns when you leave your form.`;
}

// One-line description of an entity for the self-only "/target" readout:
// name, level, what it is (player / pet / mob), and current health. A dead
// body reports "dead" instead of a percentage so a lootable corpse reads
// sensibly.
export function targetReadout(t: Entity): string {
  const kind = t.kind === 'player' ? 'player' : t.ownerId !== null ? 'pet' : 'mob';
  const health = t.dead ? 'dead' : `${Math.round((t.hp / t.maxHp) * 100)}% HP`;
  return `Target: ${t.name} (level ${t.level} ${kind}) — ${health}.`;
}
// One-line leveling summary for the /xp readout. At MAX_LEVEL there is no
// "next level" so we avoid the percent/remaining math (xpForLevel is 0 there).
export function xpReadout(meta: PlayerMeta, level: number): string {
  if (level >= MAX_LEVEL) return `Level ${MAX_LEVEL} — maximum level reached.`;
  const need = xpForLevel(level);
  const have = Math.max(0, Math.min(meta.xp, need));
  const pct = Math.floor((have / need) * 100);
  const fmt = (n: number) => n.toLocaleString('en-US');
  return `Level ${level} — ${fmt(have)}/${fmt(need)} XP (${pct}%), ${fmt(need - have)} to go.`;
}
// Render the /gold readout. An empty purse gets flavor text rather than the
// bare "You have 0c." that formatMoney would otherwise produce.
export function goldReadout(copper: number): string {
  if (copper <= 0) return 'Your purse is empty.';
  return `You have ${formatMoney(copper)}.`;
}
// Self-only readout for "/buffs": summarise the auras currently on the
// entity. Auras carry no buff/debuff flag, only an AuraKind and a `remaining`
// time in seconds; toggles (stances, forms, stealth) use a 3600s sentinel
// duration rather than Infinity, so a raw "(3600s)" reads poorly.
export function buffsReadout(e: Entity): string {
  if (e.auras.length === 0) return 'You have no active effects.';
  const parts = e.auras.map((a) => auraLabel(a));
  return `Active effects (${e.auras.length}): ${parts.join(', ')}.`;
}

// Render one aura for the /buffs list, e.g. "Rend (4s)". `remaining` is a
// float, so Math.ceil keeps a still-active 0.3s remainder showing as "(1s)".
function auraLabel(a: Aura): string {
  return `${a.name} (${Math.ceil(a.remaining)}s)`;
}
// Self-only readout for "/cooldowns": summarise the abilities currently on
// cooldown for this entity, soonest-ready first.
//
// `e.cooldowns` is a Map<abilityId, remainingSeconds> — entries exist ONLY
// while an ability is cooling down (updateTimers deletes them at <= 0), so an
// empty map means everything is ready. Resolve the display name via
// ABILITIES[id]?.name (fall back to the raw id if an ability is ever missing
// from the table). `remaining` is a float, so Math.ceil keeps a 0.3s
// remainder showing as "(1s)", matching how /buffs renders aura timers.
//
export function cooldownsReadout(e: Entity): string {
  if (e.cooldowns.size === 0) return 'No abilities are on cooldown.';
  const parts = [...e.cooldowns]
    .sort((a, b) => a[1] - b[1])
    .map(([id, remaining]) => `${ABILITIES[id]?.name ?? id} (${Math.ceil(remaining)}s)`);
  return `Abilities on cooldown (${parts.length}): ${parts.join(', ')}.`;
}
// Self-only readout of the active quest log: one entry per tracked quest with
// per-objective progress. questLog only ever holds 'active'/'ready' quests
// (turn-in deletes the entry), so iterating it gives exactly what to show.
export function questReadout(meta: PlayerMeta): string {
  const lines: string[] = [];
  for (const [qid, qp] of meta.questLog) {
    const quest = QUESTS[qid];
    if (!quest) continue;
    const objs = quest.objectives
      .map((o, i) => `${o.label} ${Math.min(qp.counts[i] ?? 0, o.count)}/${o.count}`)
      .join(', ');
    const tag = qp.state === 'ready' ? ' (ready)' : '';
    lines.push(`${quest.name}${tag} — ${objs}`);
  }
  if (lines.length === 0) return 'Your quest log is empty.';
  return `Quest log (${lines.length}): ${lines.join(' | ')}.`;
}
// Self-only readout of equipped items, walked in a fixed slot order so the
// line is stable and empty slots are visible (the point of a gear check).
export function gearReadout(meta: PlayerMeta): string {
  const slots: [EquipSlot, string][] = [
    ['mainhand', 'Main Hand'],
    ['helmet', 'Helmet'],
    ['shoulder', 'Shoulder'],
    ['chest', 'Chest'],
    ['waist', 'Waist'],
    ['legs', 'Legs'],
    ['gloves', 'Gloves'],
    ['feet', 'Feet'],
  ];
  let worn = 0;
  const parts = slots.map(([slot, label]) => {
    const itemId = meta.equipment[slot];
    if (!itemId) return `${label}: (empty)`;
    worn++;
    return `${label}: ${ITEMS[itemId]?.name ?? itemId}`;
  });
  if (worn === 0) return 'You have nothing equipped.';
  return `Equipped (${worn}/${slots.length}): ${parts.join(', ')}.`;
}
export function abilitiesReadout(meta: PlayerMeta, e: Entity): string {
  const known = abilitiesKnownAt(meta.cls, e.level);
  if (known.length === 0) return 'You have not learned any abilities yet.';
  const list = known.map((k) => `${k.def.name} (Rank ${k.rank})`).join(', ');
  return `Spellbook (${known.length}): ${list}.`;
}
// Self-only readout of the player's active pet: name, level, beast family,
// and current health. Reads live pet state via petOf() so it stays accurate
// regardless of how the pet was acquired (tame, summon).
export function petReadout(ctx: SimContext, owner: Entity): string {
  return petCommands.petReadout(ctx, owner);
}
// Build the self-only "/session" line from this session's RewardCounters.
// Counters are reset each boot (freshCounters), so this is always per-session.
// Format kills/deaths first, then a damage clause, then XP — using
// toLocaleString('en-US') for thousands separators on the large numbers.
export function sessionReadout(meta: PlayerMeta): string {
  const c = meta.counters;
  const n = (v: number) => v.toLocaleString('en-US');
  const plural = (v: number, word: string) => `${n(v)} ${word}${v === 1 ? '' : 's'}`;
  return (
    `Session: ${plural(c.kills, 'kill')}, ${plural(c.deaths, 'death')}. ` +
    `Damage dealt ${n(c.damageDealt)}, taken ${n(c.damageTaken)}. ` +
    `XP gained ${n(c.xpGained)}.`
  );
}
/** Self-only readout of the threat table on the player's current target,
 *  highest first, as a percentage of the current threat leader. */
export function threatReadout(ctx: SimContext, self: Entity): string {
  const t = self.targetId !== null ? ctx.entities.get(self.targetId) : undefined;
  if (!t || t.hp <= 0) return 'You have no target.';
  if (t.kind !== 'mob') return `Threat is only tracked on enemies; ${t.name} is not one.`;
  const entries = threatEntries(t, 10);
  if (entries.length === 0) return `Nobody has any threat on ${t.name}.`;
  const top = entries[0][1] || 1;
  const parts = entries.map(([id, v], i) => {
    const pct = Math.round((v / top) * 100);
    const you = id === self.id ? ' (you)' : '';
    const lead = i === 0 ? ' [leader]' : '';
    return `${threatName(ctx, id)}${you} ${pct}%${lead}`;
  });
  return `Threat on ${t.name} (${entries.length}): ${parts.join(', ')}.`;
}

/** Display name for a threat-table source: a player by pid, else the entity
 *  (pet/mob) name, else a placeholder for sources that have despawned. */
function threatName(ctx: SimContext, id: number): string {
  const meta = ctx.players.get(id);
  if (meta) return meta.name;
  return ctx.entities.get(id)?.name || 'Unknown';
}
// One scannable entry per nearby entity: name, what it is, and how far.
// Pets are mobs with a non-null ownerId; players have no level prefix.
function nearbyLabel(e: Entity, d: number): string {
  const yd = `${Math.round(d)}yd`;
  if (e.kind === 'player') return `${e.name} (player, ${yd})`;
  const kind = e.kind === 'mob' && e.ownerId !== null ? 'pet' : e.kind;
  return `${e.name} (Lvl ${e.level} ${kind}, ${yd})`;
}

// Self-only readout of living entities within NEARBY_RANGE of `self`,
// nearest first. Reads only live Entity state (pos/kind/level/hp), so it
// never desyncs and adds no persisted fields.
export function nearbyReadout(ctx: SimContext, self: Entity): string {
  const found: { e: Entity; d: number }[] = [];
  for (const e of ctx.entities.values()) {
    if (e.id === self.id || e.kind === 'object' || e.hp <= 0) continue;
    const d = dist2d(self.pos, e.pos);
    if (d <= NEARBY_RANGE) found.push({ e, d });
  }
  if (found.length === 0) return 'Nothing is nearby.';
  found.sort((a, b) => a.d - b.d);
  const shown = found.slice(0, NEARBY_MAX);
  const labels = shown.map(({ e, d }) => nearbyLabel(e, d));
  const more = found.length - shown.length;
  if (more > 0) labels.push(`(+${more} more)`);
  return `Nearby (${found.length}): ${labels.join(', ')}.`;
}
// Distance from the player to their current target. Reads only live Entity
// state (targetId + positions), so it needs no new fields and works online
// for free. The in-melee hint compares the RAW distance to MELEE_RANGE — the
// same threshold the swing-resolution code uses — while the displayed yards
// are rounded, so the hint stays truthful even when rounding lands on 5yd.
export function rangeReadout(ctx: SimContext, self: Entity): string {
  if (self.targetId === null) return 'You have no target.';
  const t = ctx.entities.get(self.targetId);
  if (!t) return 'You have no target.';
  const d = dist2d(self.pos, t.pos);
  const reach = d <= MELEE_RANGE ? 'in melee range' : 'out of melee range';
  return `Your target ${t.name} is ${Math.round(d)}yd away (${reach}).`;
}
// Reads the live cast-bar state (no stored fields): castingAbility holds an
// ability id or the FISHING_CAST_ID sentinel, channeling distinguishes a
// channel from a normal cast. Times are fractional seconds, so toFixed(1)
// stays truthful rather than rounding a 2.5s cast to "3s".
export function castingReadout(e: Entity): string {
  if (!e.castingAbility) return 'You are not casting anything.';
  const remaining = e.castRemaining.toFixed(1);
  const total = e.castTotal.toFixed(1);
  if (e.castingAbility === FISHING_CAST_ID) {
    return `You are fishing — ${remaining}s of ${total}s remaining.`;
  }
  const name = ABILITIES[e.castingAbility]?.name ?? e.castingAbility;
  const verb = e.channeling ? 'Channeling' : 'Casting';
  return `${verb} ${name} — ${remaining}s of ${total}s remaining.`;
}
// Self-only readout of what the player is currently eating/drinking. Food and
// drink occupy separate slots and tick concurrently, each on its own remaining
// timer, so both are reported with their own restore rate and time left.
export function consumableReadout(e: Entity): string {
  const parts: string[] = [];
  for (const c of [e.eating, e.drinking]) {
    if (!c) continue;
    const name = ITEMS[c.itemId]?.name ?? c.itemId;
    const restores: string[] = [];
    if (c.hpPer2s > 0) restores.push(`+${c.hpPer2s} HP/2s`);
    if (c.manaPer2s > 0) restores.push(`+${c.manaPer2s} mana/2s`);
    restores.push(`${Math.ceil(c.remaining)}s left`);
    const verb = c.kind === 'food' ? 'eating' : 'drinking';
    parts.push(`${verb} ${name} (${restores.join(', ')})`);
  }
  if (parts.length === 0) return 'You are not eating or drinking.';
  return `You are ${parts.join(' and ')}.`;
}
// Self-only readout of the shared combat-potion cooldown (#103). Distinct from
// /cooldowns, which reads the per-ability Entity.cooldowns map and never shows
// this separate 60s potion timer. potionCooldownUntil is an absolute sim-time
// deadline, so the remaining time is computed against ctx.time.
export function potionReadout(ctx: SimContext, e: Entity): string {
  const remaining = e.potionCooldownUntil - ctx.time;
  if (remaining <= 0) return 'Combat potion is ready to use.';
  return `Combat potion on cooldown — ready in ${Math.ceil(remaining)}s.`;
}
// Self-only readout of the ability armed to fire on the next melee swing
// (Heroic Strike / Raptor Strike / Maul). Distinct from /casting (active
// cast bar) and /cooldowns (recharge timers): an on-swing ability is neither
// casting nor on cooldown, just waiting for the swing — and it silently
// fizzles if the resource can't be paid when the swing lands (see swing
// resolution), so the readout flags that case up front.
export function queuedReadout(ctx: SimContext, e: Entity): string {
  if (!e.queuedOnSwing) return 'You have no ability queued for your next swing.';
  const queued = ctx.resolvedAbility(e.queuedOnSwing, e.id);
  const name = queued?.def.name ?? e.queuedOnSwing;
  if (!queued) return `${name} is queued for your next melee swing.`;
  const res = e.resourceType ?? 'resource';
  const have = Math.floor(e.resource);
  if (e.resource >= queued.cost) {
    return `${name} is queued for your next melee swing (costs ${queued.cost} ${res}; you have ${have}).`;
  }
  return `${name} is queued for your next melee swing, but you cannot afford it (costs ${queued.cost} ${res}; you have ${have}) — it will fizzle.`;
}

// Self-only readout for "/talents": the player's specialization and how their
// talent points are split across the Class tree and the chosen spec tree.
// Points are derived live from level (talentPointsAtLevel), so the total stays
// correct after a level-up even if the allocation hasn't been touched since.
export function talentsReadout(meta: PlayerMeta, e: Entity): string {
  const ct = talentsFor(meta.cls);
  if (!ct) return 'Your class has no talent tree yet.';
  const total = talentPointsAtLevel(e.level);
  if (total <= 0)
    return `You have not unlocked talents yet — they begin at level ${FIRST_TALENT_LEVEL}.`;
  const spent = pointsSpent(meta.talents);
  // Split spent points by tree (cold path: walk the allocation once on demand).
  const byId = new Map(ct.nodes.map((n) => [n.id, n] as const));
  let classPts = 0;
  let specPts = 0;
  for (const id in meta.talents.ranks) {
    const node = byId.get(id);
    if (!node) continue;
    if (node.tree === 'class') classPts += meta.talents.ranks[id];
    else specPts += meta.talents.ranks[id];
  }
  const specName = meta.talents.spec
    ? (ct.specs.find((s) => s.id === meta.talents.spec)?.name ?? meta.talents.spec)
    : null;
  const head = specName ?? 'no specialization';
  const breakdown = specName ? `Class ${classPts}, ${specName} ${specPts}` : `Class ${classPts}`;
  const unspent = total - spent;
  const tail = unspent > 0 ? ` ${unspent} unspent.` : '';
  return `Talents: ${head} — ${spent}/${total} points spent (${breakdown}).${tail}`;
}
