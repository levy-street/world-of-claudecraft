import { formatDuration } from './duration';
import { logger } from './http/logger';
import { parseModerationChatCommand } from './moderation_commands';
import type { InGameModerationAction } from './moderation_db';
import type { StaffWatchEntry } from './staff_watchlist_db';

export interface ModerationSession {
  pid: number;
  accountId: number;
  characterId: number;
  isAdmin: boolean;
  // Expanded admin permission set, snapshotted at WS join (like isAdmin). The
  // commands this service handles require 'moderation.act' or
  // 'moderation.spectate' (see requiredCommandPermission).
  adminPermissions: ReadonlySet<string>;
  name: string;
}

export interface ModerationHost<TSession extends ModerationSession> {
  sessionByName(name: string): TSession | null;
  notice(session: TSession, text: string): void;
  systemNotice(session: TSession, text: string): void;
  kick(session: TSession): void;
  muteLive(accountId: number, untilISO: string, reason: string): void;
  disconnect(accountId: number, reason: string): void;
  killEntity(entityId: number): void;
  enterSpectate(moderator: TSession, target: TSession): void;
  exitSpectate(moderator: TSession): void;
  enterJailVisit(moderator: TSession): void;
  exitJailVisit(moderator: TSession): void;
  isJailed(session: TSession): boolean;
  jail(moderator: TSession, target: TSession, minutes: number): void;
  unjail(moderator: TSession, target: TSession): void;
  // GM presence (/visible on|off, src/sim/gm_presence.ts). Session-only.
  isGmHidden(session: TSession): boolean;
  setGmHidden(session: TSession, hidden: boolean): void;
  // Every online session on this realm that may run moderation commands (the
  // GMs a watched login pings).
  onlineStaff(): TSession[];
  // One line to every session on this realm (/announce).
  announce(fromName: string, text: string): void;
}

// The persistent staff watchlist (server/staff_watchlist_db.ts), keyed by
// account so a watched player is caught on any character.
export interface ModerationWatchlist {
  findCharacter(name: string): Promise<{ accountId: number; characterName: string } | null>;
  add(input: {
    accountId: number;
    characterName: string;
    note: string | null;
    addedByAccountId: number;
  }): Promise<void>;
  remove(accountId: number): Promise<boolean>;
  forAccount(accountId: number): Promise<StaffWatchEntry | null>;
  list(): Promise<{ entries: StaffWatchEntry[]; total: number }>;
}

export interface ModerationAudit {
  recordAction(input: {
    action: InGameModerationAction;
    accountId: number;
    adminAccountId: number;
    reason: string;
  }): Promise<void>;
  mute(input: {
    accountId: number;
    adminAccountId: number;
    reason: string;
    expiresAt: string;
  }): Promise<void>;
  ban(input: { accountId: number; adminAccountId: number; reason: string }): Promise<void>;
  suspend(input: {
    accountId: number;
    adminAccountId: number;
    reason: string;
    expiresAt: string;
  }): Promise<void>;
  forceRename(input: {
    characterId: number;
    adminAccountId: number;
    reason: string;
  }): Promise<{ accountId: number }>;
}

const BAN_MESSAGE = 'This account has been banned.';
const SUSPEND_MESSAGE = 'This account is suspended.';
const RENAME_MESSAGE = 'A moderator requires one of your characters to be renamed.';
const NO_PERMISSION_MESSAGE = "You don't have permission to do that.";
const JAIL_REASON = 'Jailed by in-game moderator command';
const UNJAIL_REASON = 'Released by in-game moderator command';
const SPECTATE_REASON = 'Spectated via in-game moderator command';
const UNSPECTATE_REASON = 'Stopped spectating via in-game moderator command';
const INVISIBLE_REASON = 'Went invisible via in-game GM command';
const VISIBLE_REASON = 'Became visible via in-game GM command';
const WATCH_REASON = 'Watched via in-game GM command';
const UNWATCH_REASON = 'Unwatched via in-game GM command';

type ModerationCommandKind = NonNullable<ReturnType<typeof parseModerationChatCommand>>['kind'];

// Observation (spectating, and going invisible to observe) rides
// moderation.spectate; everything that touches another account or the whole
// realm needs moderation.act.
function requiredCommandPermission(kind: ModerationCommandKind): string {
  return kind === 'spectate' || kind === 'unspectate' || kind === 'visible'
    ? 'moderation.spectate'
    : 'moderation.act';
}

// Dispatch-site gate: whether this session may even attempt a moderation chat
// command. A session with neither permission falls through to ordinary chat,
// exactly like a non-staff player (its "/kick x" broadcasts as plain text).
export function canAttemptModerationCommands(session: ModerationSession): boolean {
  return (
    session.adminPermissions.has('moderation.act') ||
    session.adminPermissions.has('moderation.spectate')
  );
}

export class ModerationService<TSession extends ModerationSession> {
  constructor(
    private readonly host: ModerationHost<TSession>,
    private readonly watchlist: ModerationWatchlist,
    private readonly audit: ModerationAudit,
  ) {}

  // Spectate state changes are audit-gated (the audit write must resolve
  // before the live effect applies), but a moderator can issue /spectate,
  // /unspectate, or a target switch again before that write resolves. Track
  // the most recently issued spectate-family command per moderator so a
  // stale audit completion never applies enterSpectate/exitSpectate after a
  // newer command already changed the moderator's intent.
  private readonly spectateOpSeq = new Map<number, number>();

  private nextSpectateOp(actor: TSession): number {
    const seq = (this.spectateOpSeq.get(actor.pid) ?? 0) + 1;
    this.spectateOpSeq.set(actor.pid, seq);
    return seq;
  }

  private isCurrentSpectateOp(actor: TSession, op: number): boolean {
    return this.spectateOpSeq.get(actor.pid) === op;
  }

  // The same stale-completion guard for /visible: a quick "off" then "on" must
  // never land in reverse order because the first audit write was slower.
  private readonly visibleOpSeq = new Map<number, number>();

  // True means the text belonged to this command family, including rejected
  // commands. The caller must not continue through ordinary chat routing.
  handleChatCommand(actor: TSession, text: string): boolean {
    const command = parseModerationChatCommand(text);
    if (!command) return false;
    // Defense in depth: the live caller already gates on the moderation
    // permissions, but moderation is a sensitive API, so refuse non-staff here
    // too. Swallow (return true) rather than let a rejected "/kick ..." leak
    // into ordinary chat.
    if (!actor.isAdmin) return true;
    // Staff without the command's permission (e.g. a spectate-only role trying
    // /ban) get an explicit refusal instead of a silent swallow.
    if (!actor.adminPermissions.has(requiredCommandPermission(command.kind))) {
      this.host.notice(actor, NO_PERMISSION_MESSAGE);
      return true;
    }
    switch (command.kind) {
      case 'kick':
        this.kick(actor, command.name, command.reason);
        break;
      case 'kill':
        this.killTarget(actor, command.name, command.reason);
        break;
      case 'forcerename':
        this.forceRename(actor, command.name, command.reason);
        break;
      case 'mute':
        this.mute(actor, command.name, command.minutes, command.reason);
        break;
      case 'ban':
        this.ban(actor, command.name, command.reason);
        break;
      case 'suspend':
        this.suspend(actor, command.name, command.minutes, command.reason);
        break;
      case 'spectate':
        this.spectate(actor, command.name);
        break;
      case 'unspectate':
        this.unspectate(actor);
        break;
      case 'jail':
        this.jail(actor, command.name, command.minutes, command.reason, command.malformed);
        break;
      case 'unjail':
        this.unjail(actor, command.name, command.malformed);
        break;
      case 'visible':
        this.visible(actor, command.on);
        break;
      case 'watch':
        if (command.list) this.listWatches(actor);
        else this.watch(actor, command.name, command.note);
        break;
      case 'unwatch':
        this.unwatch(actor, command.name);
        break;
      case 'announce':
        this.announce(actor, command.text);
        break;
    }
    return true;
  }

  private kick(actor: TSession, name: string | null, reason: string): void {
    const target = this.resolveNamedTarget(actor, name);
    if (!target) return;
    void this.audit
      .recordAction({
        action: 'kick',
        accountId: target.accountId,
        adminAccountId: actor.accountId,
        reason,
      })
      .then(() => {
        this.host.kick(target);
        this.host.systemNotice(actor, `Kicked ${target.name}.`);
      })
      .catch((err) => logger.error({ err }, 'failed to audit in-game kick'));
  }

  private killTarget(actor: TSession, name: string | null, reason: string): void {
    const target = this.resolveNamedTarget(actor, name);
    if (!target) return;
    void this.audit
      .recordAction({
        action: 'kill',
        accountId: target.accountId,
        adminAccountId: actor.accountId,
        reason,
      })
      .then(() => {
        this.host.killEntity(target.pid);
        this.host.systemNotice(actor, `Killed ${target.name}.`);
      })
      .catch((err) => logger.error({ err }, 'failed to audit in-game kill'));
  }

  private mute(actor: TSession, name: string | null, minutes: number | null, reason: string): void {
    if (name === null || minutes === null) {
      this.host.notice(actor, 'Usage: /mute "<name>" <minutes> [reason]');
      return;
    }
    const target = this.resolveNamedTarget(actor, name);
    if (!target) return;
    const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
    void this.audit
      .mute({ accountId: target.accountId, adminAccountId: actor.accountId, reason, expiresAt })
      .then(() => {
        this.host.muteLive(target.accountId, expiresAt, reason);
        this.host.systemNotice(actor, `Muted ${target.name} for ${formatDuration(minutes * 60)}.`);
      })
      .catch((err) => logger.error({ err }, 'failed to mute in-game'));
  }

  private ban(actor: TSession, name: string | null, reason: string): void {
    const target = this.resolveNamedTarget(actor, name);
    if (!target) return;
    void this.audit
      .ban({ accountId: target.accountId, adminAccountId: actor.accountId, reason })
      .then(() => {
        this.host.disconnect(target.accountId, BAN_MESSAGE);
        this.host.systemNotice(actor, `Banned ${target.name}.`);
      })
      .catch((err) => logger.error({ err }, 'failed to ban in-game'));
  }

  private suspend(
    actor: TSession,
    name: string | null,
    minutes: number | null,
    reason: string,
  ): void {
    if (name === null || minutes === null) {
      this.host.notice(actor, 'Usage: /suspend "<name>" <minutes> [reason]');
      return;
    }
    const target = this.resolveNamedTarget(actor, name);
    if (!target) return;
    const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
    void this.audit
      .suspend({ accountId: target.accountId, adminAccountId: actor.accountId, reason, expiresAt })
      .then(() => {
        this.host.disconnect(target.accountId, SUSPEND_MESSAGE);
        this.host.systemNotice(
          actor,
          `Suspended ${target.name} for ${formatDuration(minutes * 60)}.`,
        );
      })
      .catch((err) => logger.error({ err }, 'failed to suspend in-game'));
  }

  private forceRename(actor: TSession, name: string | null, reason: string): void {
    const target = this.resolveNamedTarget(actor, name);
    if (!target) return;
    void this.audit
      .forceRename({
        characterId: target.characterId,
        adminAccountId: actor.accountId,
        reason,
      })
      .then(() => {
        this.host.disconnect(target.accountId, RENAME_MESSAGE);
        this.host.systemNotice(actor, `Required ${target.name} to rename.`);
      })
      .catch((err) => logger.error({ err }, 'failed to force-rename in-game'));
  }

  private spectate(actor: TSession, name: string | null): void {
    if (!name) {
      this.host.notice(actor, 'Usage: /spectate <name>');
      return;
    }
    const target = this.host.sessionByName(name);
    if (!target) {
      this.host.notice(actor, `No online player named '${name}'.`);
      return;
    }
    // Spectating is read-only observation, never a sanction, so staff may
    // watch other staff (the sanction commands keep their staff guard in
    // resolveNamedTarget). Watching your own account stays refused, and the
    // account check (not the session) also covers a second character of the
    // actor's account that is online at the same time.
    if (target.accountId === actor.accountId) {
      this.host.notice(actor, "You can't moderate that player.");
      return;
    }
    const op = this.nextSpectateOp(actor);
    void this.audit
      .recordAction({
        action: 'spectate',
        accountId: target.accountId,
        adminAccountId: actor.accountId,
        reason: SPECTATE_REASON,
      })
      .then(() => {
        // A later /spectate, /unspectate, or target switch already
        // superseded this command while the audit write was in flight:
        // applying it now would silently reorder the moderator's commands.
        if (!this.isCurrentSpectateOp(actor, op)) return;
        this.host.enterSpectate(actor, target);
      })
      .catch((err) => logger.error({ err }, 'failed to audit in-game spectate'));
  }

  // Unlike spectate (which targets a named player), exiting always ends the
  // ACTOR's own spectate session: the service holds no state on who they were
  // watching, so the audit row is recorded against the actor's own account
  // rather than a resolved target.
  private unspectate(actor: TSession): void {
    const op = this.nextSpectateOp(actor);
    void this.audit
      .recordAction({
        action: 'unspectate',
        accountId: actor.accountId,
        adminAccountId: actor.accountId,
        reason: UNSPECTATE_REASON,
      })
      .then(() => {
        if (!this.isCurrentSpectateOp(actor, op)) return;
        this.host.exitSpectate(actor);
      })
      .catch((err) => logger.error({ err }, 'failed to audit in-game unspectate'));
  }

  // Jailing always carries an explicit sentence: /jail "<name>" <minutes>
  // [reason]. The bare /jail is the moderator's own visit; there is no
  // indefinite form (early release is /unjail).
  private jail(
    actor: TSession,
    name: string | null,
    minutes: number | null,
    reason: string | null,
    malformed: boolean,
  ): void {
    if (malformed) {
      this.host.notice(actor, 'Usage: /jail ["<name>" <minutes> [reason]]');
      return;
    }
    if (!name) {
      this.host.enterJailVisit(actor);
      return;
    }
    if (minutes === null) return; // unreachable: the parser rejects a name without minutes
    const target = this.resolveNamedTarget(actor, name);
    if (!target) return;
    if (this.host.isJailed(target)) {
      this.host.notice(actor, `${target.name} is already jailed.`);
      return;
    }
    void this.audit
      .recordAction({
        action: 'jail',
        accountId: target.accountId,
        adminAccountId: actor.accountId,
        reason: `${reason ?? JAIL_REASON} (${formatDuration(minutes * 60)})`,
      })
      .then(() => {
        this.host.jail(actor, target, minutes);
        this.host.systemNotice(actor, `Jailed ${target.name} for ${formatDuration(minutes * 60)}.`);
      })
      .catch((err) => logger.error({ err }, 'failed to audit in-game jail'));
  }

  private unjail(actor: TSession, name: string | null, malformed: boolean): void {
    if (malformed) {
      this.host.notice(actor, 'Usage: /unjail ["<name>"]');
      return;
    }
    if (!name) {
      this.host.exitJailVisit(actor);
      return;
    }
    const target = this.resolveNamedTarget(actor, name);
    if (!target) return;
    if (!this.host.isJailed(target)) {
      this.host.notice(actor, `${target.name} is not jailed.`);
      return;
    }
    void this.audit
      .recordAction({
        action: 'unjail',
        accountId: target.accountId,
        adminAccountId: actor.accountId,
        reason: UNJAIL_REASON,
      })
      .then(() => {
        this.host.unjail(actor, target);
        this.host.systemNotice(actor, `Released ${target.name} from jail.`);
      })
      .catch((err) => logger.error({ err }, 'failed to audit in-game unjail'));
  }

  // /visible off hides the GM from every player and mob (src/sim/gm_presence.ts);
  // /visible on returns them. Audited against the GM's own account.
  private visible(actor: TSession, on: boolean | null): void {
    if (on === null) {
      this.host.notice(actor, 'Usage: /visible on|off');
      return;
    }
    if (this.host.isGmHidden(actor) === !on) {
      this.host.notice(actor, on ? 'You are already visible.' : 'You are already invisible.');
      return;
    }
    const op = (this.visibleOpSeq.get(actor.pid) ?? 0) + 1;
    this.visibleOpSeq.set(actor.pid, op);
    void this.audit
      .recordAction({
        action: on ? 'gm_visible' : 'gm_invisible',
        accountId: actor.accountId,
        adminAccountId: actor.accountId,
        reason: on ? VISIBLE_REASON : INVISIBLE_REASON,
      })
      .then(() => {
        if (this.visibleOpSeq.get(actor.pid) !== op) return;
        this.host.setGmHidden(actor, !on);
        this.host.systemNotice(
          actor,
          on
            ? 'You are now visible.'
            : 'You are now invisible. Players and creatures can no longer see or target you.',
        );
      })
      .catch((err) => logger.error({ err }, 'failed to audit in-game visibility'));
  }

  // /watch "<name>" [note]. The player is usually offline, so the name resolves
  // through the database (this realm's characters), not the live sessions.
  private watch(actor: TSession, name: string | null, note: string | null): void {
    if (name === null) {
      this.host.notice(actor, 'Usage: /watch ["<name>" [note]]');
      return;
    }
    void this.watchlist
      .findCharacter(name)
      .then(async (target) => {
        if (!target) {
          this.host.notice(actor, `No character named '${name}'.`);
          return;
        }
        if (target.accountId === actor.accountId || this.host.sessionByName(name)?.isAdmin) {
          this.host.notice(actor, "You can't moderate that player.");
          return;
        }
        await this.audit.recordAction({
          action: 'watch',
          accountId: target.accountId,
          adminAccountId: actor.accountId,
          reason: note ?? WATCH_REASON,
        });
        await this.watchlist.add({
          accountId: target.accountId,
          characterName: target.characterName,
          note,
          addedByAccountId: actor.accountId,
        });
        this.host.systemNotice(actor, `Added ${target.characterName} to the watchlist.`);
      })
      .catch((err) => logger.error({ err }, 'failed to add in-game watch'));
  }

  private unwatch(actor: TSession, name: string | null): void {
    if (name === null) {
      this.host.notice(actor, 'Usage: /unwatch "<name>"');
      return;
    }
    void this.watchlist
      .findCharacter(name)
      .then(async (target) => {
        if (!target) {
          this.host.notice(actor, `No character named '${name}'.`);
          return;
        }
        if (!(await this.watchlist.forAccount(target.accountId))) {
          this.host.notice(actor, `${target.characterName} is not on the watchlist.`);
          return;
        }
        await this.audit.recordAction({
          action: 'unwatch',
          accountId: target.accountId,
          adminAccountId: actor.accountId,
          reason: UNWATCH_REASON,
        });
        await this.watchlist.remove(target.accountId);
        this.host.systemNotice(actor, `Removed ${target.characterName} from the watchlist.`);
      })
      .catch((err) => logger.error({ err }, 'failed to remove in-game watch'));
  }

  // Bare /watch: the newest entries, one chat line each.
  private listWatches(actor: TSession): void {
    void this.watchlist
      .list()
      .then(({ entries, total }) => {
        if (total === 0) {
          this.host.notice(actor, 'The watchlist is empty.');
          return;
        }
        this.host.systemNotice(actor, `Watchlist (${total}):`);
        for (const entry of entries) {
          this.host.systemNotice(
            actor,
            entry.note
              ? `Watched: ${entry.characterName} (${entry.note})`
              : `Watched: ${entry.characterName}`,
          );
        }
        if (total > entries.length) {
          this.host.systemNotice(actor, `...and ${total - entries.length} more.`);
        }
      })
      .catch((err) => logger.error({ err }, 'failed to list in-game watches'));
  }

  // Called by the game after a player joins. Pings every GM online on this
  // realm when the account is watched; staff logins are never pinged. The
  // staff roster is read before AND after the lookup: before, to skip the
  // query when nobody could be pinged; after, so a GM who logged out while it
  // ran is not addressed and one who just arrived is.
  async notifyWatchedLogin(player: TSession): Promise<void> {
    if (player.isAdmin) return;
    if (!this.host.onlineStaff().some((staff) => staff.pid !== player.pid)) return;
    let entry: StaffWatchEntry | null;
    try {
      entry = await this.watchlist.forAccount(player.accountId);
    } catch (err) {
      logger.error({ err }, 'failed to read the staff watchlist on login');
      return;
    }
    if (!entry) return;
    const sameName = entry.characterName.toLowerCase() === player.name.toLowerCase();
    const headline = sameName
      ? `Watchlist: ${player.name} just logged in.`
      : `Watchlist: ${player.name} just logged in (watched as ${entry.characterName}).`;
    for (const staff of this.host.onlineStaff()) {
      if (staff.pid === player.pid) continue;
      this.host.systemNotice(staff, headline);
      if (entry.note) this.host.systemNotice(staff, `Watch note: ${entry.note}`);
    }
  }

  // /announce <text>: one line to everyone on this realm, signed with the GM's
  // name so players can tell a real staff broadcast from a con. The text is the
  // audit reason, recorded against the GM's own account.
  private announce(actor: TSession, text: string | null): void {
    if (text === null) {
      this.host.notice(actor, 'Usage: /announce <message>');
      return;
    }
    void this.audit
      .recordAction({
        action: 'announce',
        accountId: actor.accountId,
        adminAccountId: actor.accountId,
        reason: text,
      })
      .then(() => this.host.announce(actor.name, text))
      .catch((err) => logger.error({ err }, 'failed to audit in-game announce'));
  }

  private resolveNamedTarget(actor: TSession, name: string | null): TSession | null {
    if (name === null) {
      this.host.notice(actor, 'Enclose the character name in double quotes.');
      return null;
    }
    const target = this.host.sessionByName(name);
    if (!target) {
      this.host.notice(actor, `No online player named '${name}'.`);
      return null;
    }
    if (target.pid === actor.pid || target.isAdmin) {
      this.host.notice(actor, "You can't moderate that player.");
      return null;
    }
    return target;
  }
}
