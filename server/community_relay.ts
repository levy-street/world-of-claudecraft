// In-game community posts that cross to Discord: the typed "!" relay commands
// (lfg / wts / recruit / event / help) and the Groups window's one-click listing
// adverts. Owns both per-ACCOUNT cooldown books, so switching characters never
// resets a cooldown. The game loop supplies the sim reads, the in-world
// broadcast, and the General chat route (mute, hard-word and quota gates stay
// in server/game.ts); nothing here touches sockets or the database.
import { DUNGEONS, zoneAt } from '../src/sim/data';
import { parseRelayCommand, relayCommandById } from '../src/sim/discord_relay';
import { FinderAdvertCooldowns, type FinderAdvertTarget } from '../src/sim/social/finder_advert';
import type { Entity } from '../src/sim/types';
import type { DungeonFinderInfo } from '../src/world_api/dungeon_finder';
import { enqueueRelay } from './discord_relay';
import { REALM, REALM_PUBLIC_ORIGIN } from './realm';

export const RELAY_COOLDOWN_MS = 8_000; // min gap between a player's "!" community posts

export interface RelaySender {
  accountId: number;
  pid: number;
  name: string;
}

export interface CommunityRelayDeps {
  entity(pid: number): Entity | undefined;
  broadcastSystem(text: string): void;
  error(sender: RelaySender, text: string): void;
  nowMs?(): number;
}

export class CommunityRelay {
  private readonly relayCooldown = new Map<number, number>(); // accountId -> last "!" post (ms)
  private readonly adverts = new FinderAdvertCooldowns(); // accountId, wall-clock seconds

  constructor(private readonly deps: CommunityRelayDeps) {}

  private now(): number {
    return this.deps.nowMs?.() ?? Date.now();
  }

  // Intercept a leading "!" community command in chat (lfg/wts/...): broadcast it
  // in-world and hand it to the bot for Discord cross-post. Returns true when it
  // consumed the line (so it is not sent as normal chat).
  handleRelayCommand(session: RelaySender, text: string): boolean {
    const parsed = parseRelayCommand(text);
    if (!parsed) return false; // unknown "!word" -> treat as normal chat
    const now = this.now();
    if (now - (this.relayCooldown.get(session.accountId) ?? 0) < RELAY_COOLDOWN_MS) return true;
    this.relayCooldown.set(session.accountId, now);
    const { command, message } = parsed;
    // In-game: a system broadcast everyone sees (variable-routed; S3 guard skips it).
    this.deps.broadcastSystem(`[${command.tag}] ${session.name}: ${message || command.label}`);
    // Out-of-game: hand off to the bot, which posts a rich embed with a Respond button.
    this.enqueue(session, command.id, message);
    return true;
  }

  /** The personal finder snapshot with this account's advert cooldowns stamped in. */
  withAdvertCooldowns(info: DungeonFinderInfo | null, accountId: number): DungeonFinderInfo | null {
    return info && { ...info, advert: this.adverts.view(accountId, this.now() / 1000, true) };
  }

  /**
   * Post the leader's sim-built "LFM - ..." line. `gates.allowed` is the
   * typed-chat mute and hard-word gate, applied to BOTH targets (false = refused,
   * nothing spent). General goes through `gates.postGeneral`, which calls
   * `delivered` only once the line actually reaches General (an async quota
   * refusal spends no cooldown); Discord hands the line to the bot as an LFG post.
   */
  advertise(
    session: RelaySender,
    target: FinderAdvertTarget,
    text: string | undefined,
    gates: {
      allowed(text: string): boolean;
      postGeneral(text: string, delivered: () => void): void;
    },
  ): void {
    if (!text) {
      this.deps.error(session, 'You do not lead a group listing.');
      return;
    }
    if (this.adverts.remaining(session.accountId, target, this.now() / 1000) > 0) {
      this.deps.error(session, 'You posted your group recently. Please wait before posting again.');
      return;
    }
    if (!gates.allowed(text)) return;
    const spend = () => this.adverts.use(session.accountId, target, this.now() / 1000);
    if (target === 'general') gates.postGeneral(text, spend);
    else if (this.enqueue(session, 'lfg', text)) spend();
  }

  private enqueue(session: RelaySender, commandId: string, message: string): boolean {
    const command = relayCommandById(commandId);
    if (!command) return false;
    const e = this.deps.entity(session.pid);
    const cls = e ? e.templateId.charAt(0).toUpperCase() + e.templateId.slice(1) : '';
    const zone = e
      ? e.dungeonId
        ? (DUNGEONS[e.dungeonId]?.name ?? e.dungeonId)
        : zoneAt(e.pos.x, e.pos.z).name
      : REALM;
    enqueueRelay({
      commandId: command.id,
      tag: command.tag,
      label: command.label,
      color: command.color,
      accountId: session.accountId,
      characterName: session.name,
      level: e?.level ?? 1,
      className: cls,
      realm: REALM,
      zone,
      message,
      profileUrl: REALM_PUBLIC_ORIGIN
        ? `${REALM_PUBLIC_ORIGIN}/c/${encodeURIComponent(session.name)}`
        : null,
    });
    return true;
  }
}
