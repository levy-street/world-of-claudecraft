// The Discord status store notifies EVERY listener. It held a single callback
// once, so the Social window's strip registering at Hud construction silently
// replaced the boot hook that keeps the Discord entries and an open panel in
// sync (review round on the menu consolidation).
import { describe, expect, it, vi } from 'vitest';
import {
  onDiscordStatusChange,
  setDiscordInviteUrl,
  setDiscordPresence,
  setDiscordStatus,
  setDiscordUiEnabled,
} from '../src/ui/discord_status';

describe('discord status listeners', () => {
  it('notifies every registered listener on each change, until it unsubscribes', () => {
    const boot = vi.fn();
    const strip = vi.fn();
    const offBoot = onDiscordStatusChange(boot);
    const offStrip = onDiscordStatusChange(strip);
    setDiscordStatus(null);
    expect([boot.mock.calls.length, strip.mock.calls.length]).toEqual([1, 1]);
    setDiscordPresence(null);
    expect([boot.mock.calls.length, strip.mock.calls.length]).toEqual([2, 2]);
    setDiscordUiEnabled(true);
    setDiscordInviteUrl('https://discord.example/invite');
    expect(boot.mock.calls.length).toBe(strip.mock.calls.length);
    expect(boot.mock.calls.length).toBeGreaterThanOrEqual(3);
    const before = boot.mock.calls.length;
    offStrip();
    setDiscordStatus(null);
    expect([boot.mock.calls.length, strip.mock.calls.length]).toEqual([before + 1, before]);
    offBoot();
    setDiscordStatus(null);
    expect(boot.mock.calls.length).toBe(before + 1);
  });
});
