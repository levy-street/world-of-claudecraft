import { describe, expect, it } from 'vitest';
import { gmToolsHost } from '../server/gm_tools_host';
import type { ModerationSession } from '../server/moderation_service';
import { Sim } from '../src/sim/sim';

function staff(pid: number, permissions: string[], isAdmin = true): ModerationSession {
  return {
    pid,
    accountId: pid,
    characterId: pid,
    name: `Staff${pid}`,
    isAdmin,
    adminPermissions: new Set(permissions),
  };
}

describe('GM tool host watch recipients', () => {
  it('recognizes roster replacement and terminal teardown by actor identity', () => {
    const actor = staff(1, ['moderation.spectate']);
    const sessions = new Map([[actor.pid, actor]]);
    const sim = new Sim({ seed: 7, playerClass: 'mage', noPlayer: true });
    const host = gmToolsHost(sim, sessions, () => {});
    expect(host.isCurrentSession(actor)).toBe(true);
    const replacement = { ...actor };
    sessions.set(actor.pid, replacement);
    expect(host.isCurrentSession(actor)).toBe(false);
    expect(host.isCurrentSession(replacement)).toBe(true);
    replacement.left = true;
    expect(host.isCurrentSession(replacement)).toBe(false);
    sessions.delete(actor.pid);
    expect(host.isCurrentSession(actor)).toBe(false);
  });

  it('restricts private watch notices to current authenticated moderation staff', () => {
    const actor = staff(1, ['moderation.act']);
    const spectator = staff(2, ['moderation.spectate']);
    const motd = staff(3, ['realm.motd']);
    const reader = staff(4, ['moderation.read']);
    const nonAdmin = staff(5, ['moderation.act'], false);
    const sessions = new Map([actor, spectator, motd, reader, nonAdmin].map((s) => [s.pid, s]));
    const sim = new Sim({ seed: 7, playerClass: 'mage', noPlayer: true });
    const host = gmToolsHost(sim, sessions, () => {});
    expect(host.onlineStaff()).toEqual([actor, spectator]);

    actor.adminPermissions = new Set(['realm.motd']);
    spectator.isAdmin = false;
    motd.adminPermissions = new Set(['moderation.spectate']);
    expect(host.onlineStaff()).toEqual([motd]);
  });
});
