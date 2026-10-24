import { describe, expect, it, vi } from 'vitest';
import { dispatchDungeonFinderCommand } from '../server/dungeon_finder_commands';
import type { Sim } from '../src/sim/sim';
import { bareClient } from './helpers/bare_client';

const settings = {
  kind: 'recruit' as const,
  activityId: 'hollow_crypt_normal',
  role: 'tank' as const,
  details: { purpose: 'first_time' as const, note: 'Learning together' },
};
describe('compact recruitment command validation', () => {
  it('uses the existing configure transport and authenticated actor with only validated fields', () => {
    const client = bareClient(7);
    const cmd = vi.fn();
    Object.assign(client, { cmd });
    client.dungeonFinderExpeditionConfigure(settings);
    expect(cmd).toHaveBeenCalledExactlyOnceWith({ cmd: 'df_expedition_configure', settings });
    const configure = vi.fn();
    dispatchDungeonFinderCommand(
      { dungeonFinderExpeditionConfigure: configure } as unknown as Sim,
      7,
      {
        cmd: 'df_expedition_configure',
        pid: 99,
        settings: {
          ...settings,
          leaderPid: 99,
          tags: ['admin'],
          details: { ...settings.details, exitId: 5 },
        },
      },
    );
    expect(configure).toHaveBeenCalledExactlyOnceWith(settings, 7);
  });

  it('applies the existing note moderation policy before entering Sim', () => {
    const configure = vi.fn();
    const allowNote = vi.fn(() => false);
    dispatchDungeonFinderCommand(
      { dungeonFinderExpeditionConfigure: configure } as unknown as Sim,
      7,
      { cmd: 'df_expedition_configure', settings },
      allowNote,
    );
    expect(allowNote).toHaveBeenCalledExactlyOnceWith('Learning together');
    expect(configure).not.toHaveBeenCalled();
  });

  it.each([
    { ...settings, activityId: '' },
    { ...settings, activityId: 'x'.repeat(65) },
    { ...settings, activityId: 12 },
    { ...settings, role: ['tank'] },
    { ...settings, role: 'admin' },
    { ...settings, details: null },
    { ...settings, details: { purpose: 'admin', note: '' } },
    { ...settings, details: { purpose: 'clear', note: 'x'.repeat(121) } },
    { ...settings, details: { purpose: 'clear', note: 'a\nb' } },
  ])('drops malformed recruitment %j before moderation or simulation', (value) => {
    const configure = vi.fn();
    const allowNote = vi.fn(() => true);
    dispatchDungeonFinderCommand(
      { dungeonFinderExpeditionConfigure: configure } as unknown as Sim,
      7,
      { cmd: 'df_expedition_configure', settings: value },
      allowNote,
    );
    expect(configure).not.toHaveBeenCalled();
    expect(allowNote).not.toHaveBeenCalled();
  });
});
