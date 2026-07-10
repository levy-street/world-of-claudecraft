// Player chat plumbing (G2/W5), extracted verbatim from the Sim monolith behind
// SimContext. This module owns the slash-command + channel chat() ROUTER (W5) and
// the self-contained chat HELPERS it dispatches to: the token-bucket throttle, the
// dev-chat cheats, whisper name resolution, the emote broadcaster, the /join /leave
// channel handler, and the /help + /inspect readouts. The ~40 `*Readout` formatters
// the router fans into live in the sibling social/chat_readouts.ts. The chat token +
// channel-subscription state stays Sim-owned (live ctx views: `chatTokens`,
// `channelSubs`); the router/helpers reach it through the same seam. `Sim.chat` is now
// a one-line delegate into chat() here, preserving its widened `pid?` + SentChat | null.
//
// This is a MOVE: statements, branches, regexes, dispatch order, and iteration order
// are byte-identical to the pre-move methods. The only rng draw in the whole router is
// the /roll `ctx.rng.int(lo, hi)`; the readouts draw nothing. Player emit literals stay
// at the emit site (the S3 i18n guard scans this file + chat_readouts.ts).

import { type AssistCandidate, resolveAssist } from '../assist';
import { GATHERING_PROFESSIONS } from '../content/professions';
import { CLASSES, ITEMS, zoneAt } from '../data';
import { graveyardReadout } from '../entity_roster';
import { isGatheringProfessionId, queueGatheringGrant } from '../professions/gathering';
import {
  type AwayStatus,
  JOINABLE_CHANNELS,
  type JoinableChannel,
  MAX_CHAT_MESSAGE_LEN,
  type PlayerMeta,
  SAY_RANGE,
  type SentChat,
} from '../sim';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity, MAX_LEVEL, type OverheadEmoteId, YELL_RANGE } from '../types';
import * as readouts from './chat_readouts';

const CHAT_BURST = 8; // messages a player may send back-to-back...
const CHAT_REFILL = 2; // ...then this many more per second (caps spam amplifiers)
const OVERHEAD_EMOTE_DURATION = 3.2;

// Predefined social emotes. Each entry maps a command (and its aliases) to the
// third-person action text shown to everyone in /say range. `solo` is used with
// no target; `target` (when present) is used when the emote names another
// player and contains a `%t` placeholder for that player's name. The actor's
// own name is rendered separately by the client, so these strings start at the
// verb (e.g. "Aleph" + " waves.").
interface EmoteDef {
  solo: string;
  target?: string;
}
const EMOTES: Record<string, EmoteDef> = {
  wave: { solo: 'waves.', target: 'waves at %t.' },
  bow: { solo: 'bows.', target: 'bows before %t.' },
  cheer: { solo: 'cheers!', target: 'cheers at %t!' },
  dance: { solo: 'bursts into dance.', target: 'dances with %t.' },
  laugh: { solo: 'laughs.', target: 'laughs at %t.' },
  cry: { solo: 'cries.', target: "cries on %t's shoulder." },
  salute: { solo: 'salutes.', target: 'salutes %t.' },
  thank: { solo: 'thanks everyone.', target: 'thanks %t.' },
  clap: { solo: 'applauds. Bravo!', target: 'applauds %t. Bravo!' },
  greet: { solo: 'greets everyone with a hearty hello.', target: 'greets %t with a hearty hello.' },
  roar: { solo: 'lets out a mighty roar.', target: 'roars at %t.' },
  sigh: { solo: 'sighs.', target: 'sighs at %t.' },
  kneel: { solo: 'kneels down.', target: 'kneels before %t.' },
  point: { solo: 'points.', target: 'points at %t.' },
  flex: { solo: 'flexes.', target: 'flexes at %t.' },
  cower: { solo: 'cowers in fear.', target: 'cowers in fear at the sight of %t.' },
};
// Command aliases → canonical emote key above.
const EMOTE_ALIASES: Record<string, string> = {
  hi: 'greet',
  hello: 'greet',
  thanks: 'thank',
  applaud: 'clap',
};
// /assist resolves a named player only if they are within interest range (you can see
// them) OR in your party/raid (you coordinate with them across the whole map). This
// mirrors the server's ~120yd snapshot scope so /assist never reaches a stranger on the
// far side of the world. Party/raid members are always included, regardless of distance.
const ASSIST_RANGE = 120;

// The slash-command + channel chat ROUTER (W5). Dispatches, in this exact order,
// the presence/readout/whisper/channel/emote/say-yell commands; the only rng draw
// is /roll's `ctx.rng.int(lo, hi)`. `Sim.chat` is a one-line delegate to this.
export function chat(ctx: SimContext, text: string, pid?: number): SentChat | null {
  const r = ctx.resolve(pid);
  if (!r) return null;
  const raw = text.trim().slice(0, MAX_CHAT_MESSAGE_LEN);
  if (!raw) return null;
  if (!chatAllowed(ctx, r.meta.entityId)) {
    ctx.error(r.meta.entityId, 'You are sending messages too quickly.');
    return null;
  }

  // "/afk [message]" / "/dnd [message]": set a presence status. Repeating
  // the same command with no message toggles it off. While away, anyone who
  // whispers you gets an auto-reply; /dnd also withholds the whisper itself.
  const awaym = /^\/(afk|dnd)(?:\s+([\s\S]+))?$/i.exec(raw);
  if (awaym) {
    const mode = awaym[1].toLowerCase() as AwayStatus['mode'];
    const custom = awaym[2]?.trim();
    if (r.meta.away?.mode === mode && !custom) {
      r.meta.away = null;
      ctx.emit({
        type: 'log',
        text:
          mode === 'afk'
            ? 'You are no longer Away From Keyboard.'
            : 'You have left Do Not Disturb mode.',
        color: '#ffd100',
        pid: r.meta.entityId,
      });
    } else {
      const message = custom || (mode === 'afk' ? 'Away From Keyboard' : 'Do Not Disturb');
      r.meta.away = { mode, message };
      ctx.emit({
        type: 'log',
        text:
          mode === 'afk'
            ? `You are now Away From Keyboard: ${message}`
            : `You are now in Do Not Disturb mode: ${message}`,
        color: '#ffd100',
        pid: r.meta.entityId,
      });
    }
    return null;
  }

  // Any other chat means you're back: clear a lingering away status.
  if (r.meta.away) {
    r.meta.away = null;
    ctx.emit({
      type: 'log',
      text: 'You are no longer marked as away.',
      color: '#ffd100',
      pid: r.meta.entityId,
    });
  }

  // "/party" (no message) is a self-only roster readout; "/party <msg>"
  // and "/p <msg>" stay party chat (the trailing \s in that branch below).
  if (/^\/(party|group|grp)\s*$/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.partyReadout(ctx, r.meta.entityId));
    return null;
  }

  if (ctx.devCommands) {
    // null means "handled, nothing to broadcast": returning it here is what
    // keeps a dev command from falling through to the unknown-command error.
    const devHandled = handleDevChat(ctx, raw, r.meta.entityId);
    if (devHandled !== undefined) return devHandled;
  }

  if (/^\/who(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, 'The /who roster is available in online play.');
    return null;
  }

  // "/talents" (aliases "/talent", "/spec"): self-only readout of the
  // player's specialization and how their talent points are spent. Returns
  // null (unlogged); no server interceptor, so it works online for free.
  if (/^\/(?:talents|talent|spec)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.talentsReadout(r.meta, r.e));
    return null;
  }

  // "/help" (or "/?" / "/commands") lists the available chat commands as a
  // system notice to the asker only. Like /who, it produces no chat message,
  // so it works identically offline and online without server wiring.
  if (/^\/(?:help|commands|\?)(?:\s|$)/i.test(raw)) {
    for (const line of helpLines()) ctx.error(r.meta.entityId, line);
    return null;
  }

  // "/roll", "/roll N", "/roll M-N": a classic random roll for loot disputes
  // and social play. Rolled through the deterministic sim RNG so it is
  // server-authoritative (clients can't fake a result) and identical offline.
  const rollm = /^\/roll(?:\s+(\d+)(?:\s*-\s*(\d+))?)?\s*$/i.exec(raw);
  if (rollm) {
    let lo = 1,
      hi = 100;
    if (rollm[1] !== undefined) {
      const n = parseInt(rollm[1], 10);
      if (rollm[2] !== undefined) {
        lo = n;
        hi = parseInt(rollm[2], 10);
      } else {
        hi = n;
      }
    }
    const MAX_ROLL = 1_000_000;
    if (lo < 1 || hi > MAX_ROLL || lo > hi) {
      ctx.error(
        r.meta.entityId,
        `Invalid roll range. Use /roll, /roll N, or /roll M-N (1-${MAX_ROLL}).`,
      );
      return null;
    }
    const result = ctx.rng.int(lo, hi);
    const text = `${result} (${lo}-${hi})`;
    const party = ctx.partyOf(r.meta.entityId);
    if (party) {
      for (const mPid of party.members) {
        ctx.emit({
          type: 'chat',
          fromPid: r.meta.entityId,
          from: r.meta.name,
          text,
          channel: 'roll',
          pid: mPid,
        });
      }
    } else {
      for (const meta of ctx.players.values()) {
        const e = ctx.entities.get(meta.entityId);
        if (!e || dist2d(r.e.pos, e.pos) > SAY_RANGE) continue;
        ctx.emit({
          type: 'chat',
          fromPid: r.meta.entityId,
          from: r.meta.name,
          text,
          channel: 'roll',
          pid: meta.entityId,
        });
      }
    }
    return null;
  }

  // "/r message": reply to the last player who whispered us. Rewrite it to
  // the "/w <name> message" form so delivery, the echo, and case-matching
  // all stay in the single whisper handler below.
  const rm = /^\/r(?:eply)?\s+([\s\S]+)$/i.exec(raw);
  let line = raw;
  if (rm) {
    const replyTo = r.meta.lastWhisperFrom;
    if (!replyTo) {
      ctx.error(r.meta.entityId, 'You have no one to reply to.');
      return null;
    }
    line = `/w ${replyTo} ${rm[1]}`;
  }

  // "/inspect name": self-only readout of another online player's level,
  // class, and health. The first cross-player readout; a classic-style Inspect.
  const im = /^\/(?:inspect|ins|examine)(?:\s+([\s\S]+))?$/i.exec(raw);
  if (im) {
    const targetName = (im[1] ?? '').trim();
    if (!targetName) {
      ctx.error(r.meta.entityId, 'Inspect whom? Usage: /inspect <name>.');
      return null;
    }
    // resolve by name with the same exact-then-unambiguous-CI rule as /w
    let target: PlayerMeta | null = null;
    const ciMatches: PlayerMeta[] = [];
    const wanted = targetName.toLowerCase();
    for (const meta of ctx.players.values()) {
      if (meta.name === targetName) {
        target = meta;
        break;
      }
      if (meta.name.toLowerCase() === wanted) ciMatches.push(meta);
    }
    if (!target) {
      if (ciMatches.length === 1) target = ciMatches[0];
      else if (ciMatches.length > 1) {
        ctx.error(
          r.meta.entityId,
          `Several players match '${targetName}'. Use exact capitalization.`,
        );
        return null;
      }
    }
    const te = target ? ctx.entities.get(target.entityId) : null;
    if (!target || !te) {
      ctx.error(r.meta.entityId, `There is no player named '${targetName}' online.`);
      return null;
    }
    ctx.error(r.meta.entityId, inspectReadout(target, te));
    return null;
  }

  // "/invite name": invite a player to your party by name, regardless of
  // distance (party invites have no proximity check, unlike trade/duel). Name
  // resolution mirrors /inspect (exact, then unambiguous case-insensitive); all
  // party validation is delegated to partyInvite. (No "/inv" alias: that is
  // /inventory.)
  const invm = /^\/invite(?:\s+([\s\S]+))?$/i.exec(raw);
  if (invm) {
    const targetName = (invm[1] ?? '').trim();
    if (!targetName) {
      ctx.error(r.meta.entityId, 'Invite whom? Usage: /invite <name>.');
      return null;
    }
    let target: PlayerMeta | null = null;
    const ciMatches: PlayerMeta[] = [];
    const wanted = targetName.toLowerCase();
    for (const meta of ctx.players.values()) {
      if (meta.name === targetName) {
        target = meta;
        break;
      }
      if (meta.name.toLowerCase() === wanted) ciMatches.push(meta);
    }
    if (!target) {
      if (ciMatches.length === 1) target = ciMatches[0];
      else if (ciMatches.length > 1) {
        ctx.error(
          r.meta.entityId,
          `Several players match '${targetName}'. Use exact capitalization.`,
        );
        return null;
      }
    }
    if (!target) {
      ctx.error(r.meta.entityId, `There is no player named '${targetName}' online.`);
      return null;
    }
    ctx.partyInvite(target.entityId, r.meta.entityId);
    return null;
  }

  // "/unfollow" stops an active follow
  if (/^\/unfollow(?:\s|$)/i.test(raw)) {
    if (r.e.followTargetId === null) ctx.error(r.meta.entityId, 'You are not following anyone.');
    else ctx.stopFollow(r.e, 'You stop following.');
    return null;
  }

  // "/follow [name]" trails another player; with no name it follows the
  // current target. Movement, combat, casting, re-targeting, or the leader
  // moving out of range all end it (see updateFollowMovement).
  const fm = /^\/follow(?:\s+([\s\S]+))?$/i.exec(raw);
  if (fm) {
    if (r.e.inCombat) {
      ctx.error(r.meta.entityId, "You can't start following while in combat.");
      return null;
    }
    let target: PlayerMeta | null = null;
    const nameArg = (fm[1] ?? '').trim();
    if (nameArg) {
      const wanted = nameArg.toLowerCase();
      const ci: PlayerMeta[] = [];
      for (const meta of ctx.players.values()) {
        if (meta.name === nameArg) {
          target = meta;
          break;
        }
        if (meta.name.toLowerCase() === wanted) ci.push(meta);
      }
      if (!target) {
        if (ci.length === 1) target = ci[0];
        else if (ci.length > 1) {
          ctx.error(
            r.meta.entityId,
            `Several players match '${nameArg}'. Use exact capitalization.`,
          );
          return null;
        }
      }
      if (!target) {
        ctx.error(r.meta.entityId, `There is no player named '${nameArg}' online.`);
        return null;
      }
    } else {
      const cur = r.e.targetId !== null ? ctx.players.get(r.e.targetId) : undefined;
      if (!cur) {
        ctx.error(r.meta.entityId, 'Target a player to follow, or use /follow <name>.');
        return null;
      }
      target = cur;
    }
    if (target.entityId === r.meta.entityId) {
      ctx.error(r.meta.entityId, "You can't follow yourself.");
      return null;
    }
    r.e.followTargetId = target.entityId;
    ctx.error(r.meta.entityId, `Now following ${target.name}.`);
    return null;
  }

  // "/assist [name]" targets whatever the named player is targeting (group-play /
  // multiboxing target-matching). With no name it assists the player you currently
  // have targeted. Resolution lives in the pure resolveAssist() core.
  const am = /^\/(?:assist|as)(?:\s+([\s\S]+))?$/i.exec(raw);
  if (am) {
    // Scope the candidate roster the way the server scopes a snapshot: players within
    // interest range of the caster, PLUS the caster's party/raid members by name no
    // matter how far they have roamed. Classic /assist only resolves a unit you could
    // know about, never an arbitrary stranger across the map.
    const assistParty = ctx.partyOf(r.meta.entityId);
    const candidates: AssistCandidate[] = [];
    for (const meta of ctx.players.values()) {
      const ent = ctx.entities.get(meta.entityId);
      const inParty = assistParty ? assistParty.members.includes(meta.entityId) : false;
      const inRange = ent ? dist2d(r.e.pos, ent.pos) <= ASSIST_RANGE : false;
      if (meta.entityId !== r.meta.entityId && !inParty && !inRange) continue;
      candidates.push({
        entityId: meta.entityId,
        name: meta.name,
        targetId: ent ? ent.targetId : null,
      });
    }
    const res = resolveAssist(candidates, r.meta.entityId, am[1] ?? '');
    if (res.kind === 'error') {
      ctx.error(r.meta.entityId, res.message);
      return null;
    }
    ctx.targetEntity(res.targetId, pid);
    ctx.error(r.meta.entityId, `Assisting ${res.leaderName}.`);
    return null;
  }

  // "/played": report how long this character has been in the world this
  // session. Self-only informational line, like /who's reply.
  if (/^\/played(?:\s|$)/i.test(raw)) {
    const secs = Math.max(0, Math.floor(ctx.time - r.meta.joinedAt));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const parts: string[] = [];
    if (h) parts.push(`${h}h`);
    if (h || m) parts.push(`${m}m`);
    parts.push(`${s}s`);
    ctx.error(r.meta.entityId, `Time played this session: ${parts.join(' ')}.`);
    return null;
  }

  // "/playtime": report this character's LIFETIME played time, accumulated
  // across every session and persisted server-side (see PlayerMeta.
  // totalPlayedSeconds + serializeCharacter). Unlike /played (session-only,
  // resets on relog), this figure only ever grows while the character is
  // actually in the world.
  if (/^\/playtime(?:\s|$)/i.test(raw)) {
    const secs = Math.max(0, Math.floor(r.meta.totalPlayedSeconds + (ctx.time - r.meta.joinedAt)));
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const parts: string[] = [];
    if (d) parts.push(`${d}d`);
    if (d || h) parts.push(`${h}h`);
    if (d || h || m) parts.push(`${m}m`);
    parts.push(`${s}s`);
    ctx.error(r.meta.entityId, `Total time played: ${parts.join(' ')}.`);
    return null;
  }

  // Self-only readouts: emit a private system line and never become chat.
  if (/^\/(?:where|loc|zone)(?:\s|$)/i.test(raw)) {
    const zone = zoneAt(r.e.pos.z);
    const [lo, hi] = zone.levelRange;
    ctx.error(
      r.meta.entityId,
      `You are in ${zone.name} (levels ${lo}–${hi}) at (${Math.floor(r.e.pos.x)}, ${Math.floor(r.e.pos.z)}).`,
    );
    return null;
  }
  if (/^\/(?:target|tar)(?:\s|$)/i.test(raw)) {
    const tid = r.e.targetId;
    const t = tid !== null ? (ctx.entities.get(tid) ?? null) : null;
    if (!t) ctx.error(r.meta.entityId, 'You have no target.');
    else ctx.error(r.meta.entityId, readouts.targetReadout(t));
    return null;
  }
  if (/^\/(?:xp|exp|experience)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.xpReadout(r.meta, r.e.level));
    return null;
  }
  if (/^\/(?:gold|money|coins)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.goldReadout(r.meta.copper));
    return null;
  }
  if (/^\/(?:stats|st|sheet)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.statsReadout(r.meta, r.e));
    return null;
  }
  if (/^\/(?:buffs?|auras)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.buffsReadout(r.e));
    return null;
  }
  if (/^\/(?:cooldowns?|cds?)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.cooldownsReadout(r.e));
    return null;
  }
  if (/^\/(?:bags|inv|inventory)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.bagsReadout(r.meta));
    return null;
  }
  if (/^\/(?:quests?|ql)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.questReadout(r.meta));
    return null;
  }
  if (/^\/(?:gear|equip|equipment)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.gearReadout(r.meta));
    return null;
  }
  if (/^\/(?:abilities|spells|spellbook)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.abilitiesReadout(r.meta, r.e));
    return null;
  }
  if (/^\/(?:pet|pets|companion)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.petReadout(ctx, r.e));
    return null;
  }
  if (/^\/(?:session|sess|sessionstats)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.sessionReadout(r.meta));
    return null;
  }
  if (/^\/(?:threat|aggro)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.threatReadout(ctx, r.e));
    return null;
  }
  if (/^\/(?:zones|zonelist|worldmap)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.zonesReadout(r.e.pos.z));
    return null;
  }
  if (/^\/(?:nearby|near|around)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.nearbyReadout(ctx, r.e));
    return null;
  }
  if (/^\/(?:arena|pvp|rating)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.arenaReadout(r.meta));
    return null;
  }
  if (/^\/(?:range|dist|distance)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.rangeReadout(ctx, r.e));
    return null;
  }
  if (/^\/(?:buyback|bb|repurchase)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.buybackReadout(r.meta));
    return null;
  }
  if (/^\/(?:combo|cp|combopoints)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.comboReadout(r.e));
    return null;
  }
  if (/^\/(?:combat|cb|incombat)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.combatReadout(r.e));
    return null;
  }
  if (/^\/(?:graveyard|gy|spirithealer)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, graveyardReadout(r.e));
    return null;
  }
  const dungeonDifficulty = /^\/(?:dungeons|dungeon|instances)\s+(normal|heroic)$/i.exec(raw);
  if (dungeonDifficulty) {
    ctx.setDungeonDifficulty(
      dungeonDifficulty[1].toLowerCase() as 'normal' | 'heroic',
      r.meta.entityId,
    );
    return null;
  }
  if (/^\/(?:dungeons|dungeon|instances)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.dungeonsReadout());
    ctx.error(
      r.meta.entityId,
      ctx.dungeonDifficulty(r.meta.entityId) === 'heroic'
        ? 'Dungeon difficulty: Heroic. Use /dungeon normal to change it.'
        : 'Dungeon difficulty: Normal. Use /dungeon heroic to change it.',
    );
    return null;
  }
  if (/^\/(?:consider|con|difficulty)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.considerReadout(ctx, r.e));
    return null;
  }
  if (/^\/(?:pois|poi|landmarks)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.poisReadout(r.e));
    return null;
  }
  if (/^\/(?:completed|questsdone|qdone)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.completedReadout(r.meta));
    return null;
  }
  if (/^\/(?:listings|mylistings|auctions)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.listingsReadout(ctx, r.meta));
    return null;
  }
  if (/^\/(?:targetbuffs|debuffs|tb)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.targetBuffsReadout(ctx, r.e));
    return null;
  }
  if (/^\/(?:casting|cast|castbar)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.castingReadout(r.e));
    return null;
  }
  if (/^\/(?:speed|movespeed|ms)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.speedReadout(ctx, r.e));
    return null;
  }
  if (/^\/(?:attack|autoattack|aa)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.attackReadout(ctx, r.e, r.meta));
    return null;
  }
  if (/^\/(consumable|consumables|eat|drink)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.consumableReadout(r.e));
    return null;
  }
  if (/^\/(?:potion|potioncd|pot)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.potionReadout(ctx, r.e));
    return null;
  }
  if (/^\/(?:overpower|op|overpowered)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.overpowerReadout(ctx, r.e, r.meta));
    return null;
  }
  if (/^\/(form|stance|shapeshift)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.formReadout(r.e));
    return null;
  }
  if (/^\/(?:manaregen|regen|5sr)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.manaRegenReadout(r.e));
    return null;
  }
  if (/^\/(?:falling|jump|airborne)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.fallingReadout(ctx, r.e));
    return null;
  }
  if (/^\/(?:pettaunt|petgrowl|growl)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.petTauntReadout(ctx, r.e));
    return null;
  }
  if (/^\/(queued|onswing|swingqueue)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.queuedReadout(ctx, r.e));
    return null;
  }
  if (/^\/(?:savedmana|parkedmana|sm)(?:\s|$)/i.test(raw)) {
    ctx.error(r.meta.entityId, readouts.savedManaReadout(r.meta, r.e));
    return null;
  }

  // "/w name message": private whisper to an online player. Match against
  // `line` so a "/r" reply (rewritten to the /w form above) flows through the
  // same longest-online-name resolver.
  const wm = /^\/(?:w|whisper|t|tell)\s+([\s\S]+)$/i.exec(line);
  if (wm) {
    const resolved = resolveWhisperTarget(ctx, wm[1]);
    if (!resolved) return null;
    if ('error' in resolved) {
      ctx.error(r.meta.entityId, resolved.error);
      return null;
    }
    const { target, message: msg } = resolved;
    if (target.entityId === r.meta.entityId) {
      ctx.error(r.meta.entityId, 'You mutter to yourself. Nobody hears it.');
      return null;
    }
    if (target.away) {
      const label = target.away.mode === 'afk' ? 'Away From Keyboard' : 'Do Not Disturb';
      ctx.emit({
        type: 'log',
        text: `${target.name} is ${label}: ${target.away.message}`,
        color: '#ffd100',
        pid: r.meta.entityId,
      });
      if (target.away.mode === 'dnd') {
        // Withhold the whisper, but still echo the sender's own line so they
        // see what they tried to send.
        ctx.emit({
          type: 'chat',
          fromPid: r.meta.entityId,
          from: r.meta.name,
          to: target.name,
          text: msg,
          channel: 'whisper',
          pid: r.meta.entityId,
        });
        return { channel: 'whisper', message: msg };
      }
    }
    // classic-style "/r": the recipient's reply target is whoever last
    // whispered them, so record it on the target (not the sender).
    target.lastWhisperFrom = r.meta.name;
    // The recipient's copy of the whisper. A dev bot ("/dev bot") has no owning
    // client to deliver it to, and offline the single client renders every event
    // regardless of pid, so this copy would show as a duplicate of the sender's own
    // line. Skip it for a bot: you still get your echo below plus the bot's reply.
    if (!target.isDevBot)
      ctx.emit({
        type: 'chat',
        fromPid: r.meta.entityId,
        from: r.meta.name,
        text: msg,
        channel: 'whisper',
        pid: target.entityId,
      });
    ctx.emit({
      type: 'chat',
      fromPid: r.meta.entityId,
      from: r.meta.name,
      to: target.name,
      text: msg,
      channel: 'whisper',
      pid: r.meta.entityId,
    });
    if (target.isDevBot) {
      // A dev test dummy ("/dev bot") answers, so a whisper to it lands back in your
      // chat (and whisper tab), letting you test both directions offline; your /r now
      // targets it. English content via a var: whisper bodies are player content the
      // client shows verbatim inside its own localized template.
      r.meta.lastWhisperFrom = target.name;
      const reply = `Hi ${r.meta.name}! You whispered me: "${msg}"`;
      ctx.emit({
        type: 'chat',
        fromPid: target.entityId,
        from: target.name,
        text: reply,
        channel: 'whisper',
        pid: r.meta.entityId,
      });
    }
    return { channel: 'whisper', message: msg, target: target.name };
  }

  // "/p message" goes to the party channel
  if (/^\/p(arty)?\s/i.test(raw)) {
    const clean = raw.replace(/^\/p(arty)?\s+/i, '').trim();
    if (!clean) return null;
    const party = ctx.partyOf(r.meta.entityId);
    if (!party) {
      ctx.error(r.meta.entityId, 'You are not in a party.');
      return null;
    }
    for (const mPid of party.members) {
      ctx.emit({
        type: 'chat',
        fromPid: r.meta.entityId,
        from: r.meta.name,
        text: clean,
        channel: 'party',
        pid: mPid,
      });
    }
    return { channel: 'party', message: clean };
  }

  // "/g message": world-wide general channel (no pid = broadcast to all)
  if (/^\/g(eneral)?\s/i.test(raw)) {
    const clean = raw.replace(/^\/g(eneral)?\s+/i, '').trim();
    if (!clean) return null;
    ctx.emit({
      type: 'chat',
      fromPid: r.meta.entityId,
      from: r.meta.name,
      text: clean,
      channel: 'general',
    });
    return { channel: 'general', message: clean };
  }

  // "/join <channel>" / "/leave <channel>": opt-in global channels
  const jm = /^\/(join|leave)\b\s*(\S*)\s*$/i.exec(raw);
  if (jm) {
    handleChannelMembership(
      ctx,
      r.meta,
      jm[1].toLowerCase() as 'join' | 'leave',
      jm[2].toLowerCase(),
    );
    return null;
  }

  // "/world message" / "/lfg message": talk in an opt-in channel; only
  // players who have /join-ed it hear the message (the sender included)
  const cm = /^\/(world|lfg)\s+([\s\S]+)$/i.exec(raw);
  if (cm) {
    const channel = cm[1].toLowerCase() as JoinableChannel;
    const clean = cm[2].trim();
    if (!clean) return null;
    const mine = ctx.channelSubs.get(r.meta.entityId);
    if (!mine?.has(channel)) {
      ctx.error(
        r.meta.entityId,
        `You are not in the ${channel} channel. Type /join ${channel} first.`,
      );
      return null;
    }
    for (const [subPid, set] of ctx.channelSubs) {
      if (set.has(channel) && ctx.players.has(subPid)) {
        ctx.emit({
          type: 'chat',
          fromPid: r.meta.entityId,
          from: r.meta.name,
          text: clean,
          channel,
          pid: subPid,
        });
      }
    }
    return { channel, message: clean };
  }

  // "/me <action>": freeform third-person action text, e.g.
  // "/me ponders the void" → "Aleph ponders the void". Emotes never become
  // the player's sticky chat channel, so this returns null on success.
  const meMatch = /^\/(?:me|emote|e)\s+([\s\S]+)$/i.exec(raw);
  if (meMatch) {
    const action = meMatch[1].trim();
    if (action) broadcastEmote(ctx, r.meta, r.e, action);
    return null;
  }

  // "/sit", "/stand": a real seated POSE (rest on a bench, or up in the Vale
  // Cup grandstands, which are walkable tiers). Sitting clears the moment you
  // move, cast, or take a hit (those paths call standUp), so /stand is only for
  // standing back up in place. Rides the existing `sitting` wire bit, so it works
  // the same online and offline; no chat text, so nothing to localize.
  const poseMatch = /^\/(sit|stand)\s*$/i.exec(raw);
  if (poseMatch) {
    if (poseMatch[1].toLowerCase() === 'sit') {
      if (!r.e.dead) r.e.sitting = true;
    } else {
      ctx.standUp(r.e);
    }
    return null;
  }

  // "/wave", "/dance [name]": predefined social emotes. An optional name
  // targets an online player (in range or not); unknown names fall back to
  // the untargeted form, matching the classic-MMO convention.
  const emMatch = /^\/([a-z]+)(?:\s+(\S+))?\s*$/i.exec(raw);
  if (emMatch) {
    const key = EMOTE_ALIASES[emMatch[1].toLowerCase()] ?? emMatch[1].toLowerCase();
    const def = EMOTES[key];
    if (def) {
      const targetName = emMatch[2];
      let text = def.solo;
      if (targetName && def.target) {
        const t = findPlayerByName(ctx, targetName);
        if (t) text = def.target.replace('%t', t.name === r.meta.name ? 'themselves' : t.name);
      }
      broadcastEmote(ctx, r.meta, r.e, text);
      return null;
    }
  }

  // bare text and "/s" are local say; "/y" carries further: both are
  // delivered per-player by range and carry the speaker for chat bubbles
  let channel: 'say' | 'yell' = 'say';
  let clean = raw;
  if (/^\/y(ell)?\s/i.test(raw)) {
    channel = 'yell';
    clean = raw.replace(/^\/y(ell)?\s+/i, '').trim();
  } else if (/^\/s(ay)?\s/i.test(raw)) {
    clean = raw.replace(/^\/s(ay)?\s+/i, '').trim();
  } else if (raw.startsWith('/')) {
    ctx.error(r.meta.entityId, `Unknown command: ${raw.split(' ')[0]}. Type /help for a list.`);
    return null;
  }
  if (!clean) return null;
  const range = channel === 'yell' ? YELL_RANGE : SAY_RANGE;
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || dist2d(r.e.pos, e.pos) > range) continue;
    ctx.emit({
      type: 'chat',
      fromPid: r.meta.entityId,
      from: r.meta.name,
      text: clean,
      channel,
      entityId: r.e.id,
      pid: meta.entityId,
    });
  }
  return { channel, message: clean };
}

// Token-bucket throttle: returns false (and notifies the player once) when
// they are out of chat tokens. Keeps /g and /w from being spam amplifiers.
export function chatAllowed(ctx: SimContext, pid: number): boolean {
  let b = ctx.chatTokens.get(pid);
  if (!b) {
    b = { tokens: CHAT_BURST, at: ctx.time };
    ctx.chatTokens.set(pid, b);
  }
  b.tokens = Math.min(CHAT_BURST, b.tokens + (ctx.time - b.at) * CHAT_REFILL);
  b.at = ctx.time;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

// Dev chat cheats: only when Sim.devCommands is enabled (offline local play
// or online server with ALLOW_DEV_COMMANDS=1). Returns null when handled
// (no channel message), or undefined when not a dev command.
export function handleDevChat(
  ctx: SimContext,
  raw: string,
  pid: number,
): SentChat | null | undefined {
  const levelM = /^\/(?:dev\s+level|devlevel)\s+(\d+)\s*$/i.exec(raw);
  if (levelM) {
    const level = Number(levelM[1]);
    ctx.setPlayerLevel(level, pid);
    ctx.emit({
      type: 'log',
      text: `[dev] Level set to ${Math.max(1, Math.min(MAX_LEVEL, level))}.`,
      pid,
    });
    return null;
  }
  const tpM = /^\/(?:dev\s+tp|devtp)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$/i.exec(raw);
  if (tpM) {
    const e = ctx.entities.get(pid);
    if (e) {
      const p = ctx.groundPos(Number(tpM[1]), Number(tpM[2]));
      e.pos = p;
      e.prevPos = { ...p };
      ctx.grid.update(e);
      ctx.playerGrid.update(e);
      ctx.emit({
        type: 'log',
        text: `[dev] Teleported to ${p.x.toFixed(1)}, ${p.z.toFixed(1)}.`,
        pid,
      });
    }
    return null;
  }
  const giveM = /^\/(?:dev\s+give|devgive)\s+(\S+)(?:\s+(\d+))?\s*$/i.exec(raw);
  if (giveM) {
    const itemId = giveM[1];
    const count = Math.max(1, Math.min(20, Number(giveM[2] ?? 1)));
    if (!ITEMS[itemId]) {
      ctx.error(pid, `[dev] Unknown item '${itemId}'.`);
      return null;
    }
    ctx.addItem(itemId, count, pid);
    return null;
  }
  const goldM = /^\/(?:dev\s+gold|devgold)\s+(\d+)\s*$/i.exec(raw);
  if (goldM) {
    const gold = Math.max(1, Math.min(100000, Number(goldM[1])));
    const meta = ctx.players.get(pid);
    if (meta) {
      meta.copper += gold * 10000;
      ctx.emit({ type: 'log', text: `[dev] Added ${gold}g to your purse.`, pid });
    }
    return null;
  }
  const questM = /^\/(?:dev\s+quest|devquest)\s+(\S+)\s*$/i.exec(raw);
  if (questM) {
    ctx.completeQuestForDev(questM[1], pid);
    return null;
  }
  const questAllM = /^\/(?:dev\s+(?:quests|questall)|devquestall)\s*$/i.exec(raw);
  if (questAllM) {
    ctx.completeCurrentQuestsForDev(pid);
    return null;
  }
  const gatherM = /^\/(?:dev\s+gather|devgather)\s+(\S+)(?:\s+(\d+))?\s*$/i.exec(raw);
  if (gatherM) {
    const professionId = gatherM[1].toLowerCase();
    const amount = Math.max(1, Math.min(100, Number(gatherM[2] ?? 1)));
    if (!isGatheringProfessionId(professionId)) {
      ctx.error(
        pid,
        `[dev] Unknown gathering profession '${professionId}'. Options: ${Object.keys(GATHERING_PROFESSIONS).join(', ')}.`,
      );
      return null;
    }
    const meta = ctx.players.get(pid);
    if (meta) queueGatheringGrant(meta, professionId, amount);
    return null;
  }
  const botM = /^\/(?:dev\s+bot|devbot)\s+(\S+)\s*$/i.exec(raw);
  if (botM) {
    const botName = botM[1];
    const botPid = ctx.spawnDevBot(botName);
    // Dev-only English diagnostics, routed through vars so they read as dev-channel
    // text (like the other /dev feedback) rather than localizable UI copy.
    const okText = `[dev] Spawned ${botName}. Whisper it: /w ${botName} hi (or right-click its name).`;
    const failText = `[dev] Could not spawn '${botName}' (name blank or already in use).`;
    if (botPid < 0) ctx.error(pid, failText);
    else ctx.emit({ type: 'log', text: okText, pid });
    return null;
  }
  if (/^\/(?:dev\s+(?:kill|die|suicide)|devkill)\s*$/i.test(raw)) {
    // [dev] Instant self-kill for testing the death/ghost loop: routes through the real
    // death teardown (handleDeath), so the death overlay, corpse, and The Keeper's Toll
    // persistence all behave exactly as a combat death.
    const e = ctx.entities.get(pid);
    if (e && !e.dead) ctx.handleDeath(e, null);
    return null;
  }
  if (/^\/dev(?:\s|$)/i.test(raw)) {
    ctx.error(
      pid,
      'Dev commands: /dev level N, /dev tp X Z, /dev give itemId [count], /dev gold N, /dev quest questId, /dev quests, /dev gather professionId [amount], /dev bot name, /dev kill',
    );
    return null;
  }
  return undefined;
}

export function whisperMessageForName(
  rest: string,
  name: string,
  exactCase: boolean,
): string | null {
  const input = exactCase ? rest : rest.toLowerCase();
  const prefix = exactCase ? name : name.toLowerCase();
  if (!input.startsWith(prefix)) return null;
  const next = rest.charAt(name.length);
  if (!next || !/\s/.test(next)) return null;
  const message = rest.slice(name.length).trim();
  return message ? message : null;
}

export function resolveWhisperTarget(
  ctx: SimContext,
  rest: string,
): { target: PlayerMeta; message: string } | { error: string } | null {
  const trimmed = rest.trim();
  if (!trimmed) return null;
  const matches: { target: PlayerMeta; message: string; exactCase: boolean }[] = [];
  for (const target of ctx.players.values()) {
    const exactMessage = whisperMessageForName(trimmed, target.name, true);
    if (exactMessage !== null) {
      matches.push({ target, message: exactMessage, exactCase: true });
      continue;
    }
    const insensitiveMessage = whisperMessageForName(trimmed, target.name, false);
    if (insensitiveMessage !== null)
      matches.push({ target, message: insensitiveMessage, exactCase: false });
  }
  matches.sort((a, b) => b.target.name.length - a.target.name.length);
  const longestLength = matches[0]?.target.name.length ?? 0;
  const longest = matches.filter((m) => m.target.name.length === longestLength);
  const exact = longest.filter((m) => m.exactCase);
  if (exact.length > 0) return exact[0];
  if (longest.length === 1) return longest[0];
  const typedName = trimmed.split(/\s+/, 1)[0] ?? trimmed;
  if (longest.length > 1)
    return { error: `Several players match '${typedName}'. Use exact capitalization.` };
  return { error: `There is no player named '${typedName}' online.` };
}

// Resolve a player by name the same way whispers do: an exact-case match
// wins outright, otherwise a case-insensitive match is used only when it is
// unambiguous.
export function findPlayerByName(ctx: SimContext, name: string): PlayerMeta | null {
  const wanted = name.toLowerCase();
  const ci: PlayerMeta[] = [];
  for (const meta of ctx.players.values()) {
    if (meta.name === name) return meta;
    if (meta.name.toLowerCase() === wanted) ci.push(meta);
  }
  return ci.length === 1 ? ci[0] : null;
}

// Send a third-person emote to every player within /say range (including the
// actor). `from` carries the actor's name so the client can render it as a
// clickable name; `text` is the action predicate (e.g. "waves at Bet.").
export function broadcastEmote(
  ctx: SimContext,
  actor: PlayerMeta,
  actorEntity: Entity,
  text: string,
): void {
  const body = text.slice(0, MAX_CHAT_MESSAGE_LEN);
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (!e || dist2d(actorEntity.pos, e.pos) > SAY_RANGE) continue;
    ctx.emit({
      type: 'chat',
      fromPid: actor.entityId,
      from: actor.name,
      text: body,
      channel: 'emote',
      entityId: actorEntity.id,
      pid: meta.entityId,
    });
  }
}

export function playEmote(ctx: SimContext, emoteId: OverheadEmoteId, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  r.e.overheadEmoteId = emoteId;
  r.e.overheadEmoteUntil = ctx.time + OVERHEAD_EMOTE_DURATION;
  r.e.overheadEmoteSeq += 1;
}

// Lines shown by the "/help" command, one system notice per entry. Keep this
// in sync with the commands handled in chat() above.
export function helpLines(): string[] {
  return [
    'Chat channels: /s say, /y yell, /general, /p party, /world, /lfg.',
    'Whisper a player with /w <name> <message>, reply with /r.',
    'Other commands: /join <world|lfg>, /roll, /invite <name>, /inspect <name>, /follow <name>, /unfollow, /assist <name>, /afk, /dnd, /who.',
    'Character readouts: /played, /playtime, /xp, /gold, /stats, /bags, /gear, /abilities, /buffs, /cooldowns, /quest, /completed.',
    'World readouts: /where, /zones, /nearby, /pois, /graveyard, /dungeons, /arena, /session, /listings, /buyback.',
    'Combat readouts: /target, /targetbuffs, /range, /attack, /casting, /combat, /threat, /consider, /combo, /overpower.',
    'State readouts: /pet, /pettaunt, /speed, /consumable, /potion, /form, /manaregen, /falling, /queued, /savedmana.',
  ];
}

// One-line readout for /inspect: another player's level, class, and health.
export function inspectReadout(target: PlayerMeta, e: Entity): string {
  const cls = CLASSES[target.cls]?.name ?? target.cls;
  const hp = e.hp <= 0 ? 'dead' : `${Math.round(Math.max(0, Math.min(1, e.hp / e.maxHp)) * 100)}%`;
  return `${target.name}: Level ${e.level} ${cls}: HP ${hp}.`;
}

// Handles /join and /leave for the opt-in global channels.
export function handleChannelMembership(
  ctx: SimContext,
  meta: PlayerMeta,
  action: 'join' | 'leave',
  arg: string,
): void {
  const pid = meta.entityId;
  if (!arg) {
    ctx.error(pid, `Usage: /${action} <channel>. Channels: ${JOINABLE_CHANNELS.join(', ')}.`);
    return;
  }
  if (arg === 'general') {
    ctx.error(pid, 'The General channel is always on - just use /general.');
    return;
  }
  if (!JOINABLE_CHANNELS.includes(arg as JoinableChannel)) {
    ctx.error(
      pid,
      `There is no channel named '${arg}'. Channels: ${JOINABLE_CHANNELS.join(', ')}.`,
    );
    return;
  }
  const channel = arg as JoinableChannel;
  let set = ctx.channelSubs.get(pid);
  if (action === 'join') {
    if (!set) {
      set = new Set();
      ctx.channelSubs.set(pid, set);
    }
    if (set.has(channel)) {
      ctx.error(pid, `You are already in the ${channel} channel.`);
      return;
    }
    set.add(channel);
    ctx.notice(pid, `Joined the ${channel} channel. Type /${channel} <message> to talk.`);
  } else {
    if (!set?.has(channel)) {
      ctx.error(pid, `You are not in the ${channel} channel.`);
      return;
    }
    set.delete(channel);
    if (set.size === 0) ctx.channelSubs.delete(pid);
    ctx.notice(pid, `Left the ${channel} channel.`);
  }
}
