import { formatDuration } from './duration';
import { parseModerationChatCommand } from './moderation_commands';

export interface ModerationSession {
  pid: number;
  accountId: number;
  characterId: number;
  isAdmin: boolean;
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
}

export interface ModerationAudit {
  recordAction(input: {
    action: 'kick' | 'kill';
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

export class ModerationService<TSession extends ModerationSession> {
  constructor(
    private readonly host: ModerationHost<TSession>,
    private readonly audit: ModerationAudit,
  ) {}

  // True means the text belonged to this command family, including rejected
  // commands. The caller must not continue through ordinary chat routing.
  handleChatCommand(actor: TSession, text: string): boolean {
    const command = parseModerationChatCommand(text);
    if (!command) return false;
    // Defense in depth: the live caller already gates on isAdmin, but moderation is
    // a sensitive API, so refuse non-admins here too. Swallow (return true) rather
    // than let a rejected "/kick ..." leak into ordinary chat.
    if (!actor.isAdmin) return true;
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
        this.host.exitSpectate(actor);
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
      .catch((err) => console.error('failed to audit in-game kick:', err));
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
      .catch((err) => console.error('failed to audit in-game kill:', err));
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
      .catch((err) => console.error('failed to mute in-game:', err));
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
      .catch((err) => console.error('failed to ban in-game:', err));
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
      .catch((err) => console.error('failed to suspend in-game:', err));
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
      .catch((err) => console.error('failed to force-rename in-game:', err));
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
    if (target.pid === actor.pid || target.isAdmin) {
      this.host.notice(actor, "You can't moderate that player.");
      return;
    }
    this.host.enterSpectate(actor, target);
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
