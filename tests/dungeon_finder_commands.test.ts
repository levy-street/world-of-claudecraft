import { describe, expect, it, vi } from 'vitest';
import { dispatchDungeonFinderCommand } from '../server/dungeon_finder_commands';
import type { Sim } from '../src/sim/sim';
import { bareClient } from './helpers/bare_client';

describe('expedition wire commands', () => {
  it('enforces the existing chat policy before publishing a group note', () => {
    const configure = vi.fn();
    const allowNote = vi.fn(() => false);
    dispatchDungeonFinderCommand(
      { dungeonFinderExpeditionConfigure: configure } as unknown as Sim,
      7,
      {
        cmd: 'df_expedition_configure',
        settings: { kind: 'details', details: { purpose: 'clear', note: 'Blocked note' } },
      },
      allowNote,
    );
    expect(allowNote).toHaveBeenCalledWith('Blocked note');
    expect(configure).not.toHaveBeenCalled();
  });
  it('sends typed expedition settings and always dispatches as the authenticated player', () => {
    const client = bareClient(7);
    const cmd = vi.fn();
    Object.assign(client, { cmd });
    client.dungeonFinderExpeditionConfigure({ kind: 'available', enabled: true, roles: ['dps'] });
    expect(cmd).toHaveBeenCalledWith({
      cmd: 'df_expedition_configure',
      settings: { kind: 'available', enabled: true, roles: ['dps'] },
    });
    const configure = vi.fn();
    dispatchDungeonFinderCommand(
      { dungeonFinderExpeditionConfigure: configure } as unknown as Sim,
      7,
      {
        cmd: 'df_expedition_configure',
        pid: 99,
        settings: { kind: 'reward', id: 'silver', buy: true, balance: 99999 },
      },
    );
    expect(configure).toHaveBeenCalledWith({ kind: 'reward', id: 'silver', buy: true }, 7);
  });
  it.each([
    null,
    { kind: 'details', details: { purpose: 'admin', note: '' } },
    { kind: 'details', details: { purpose: 'clear', note: 'x'.repeat(121) } },
    { kind: 'available', enabled: 'true', roles: ['dps'] },
    { kind: 'available', enabled: true, roles: ['admin'] },
    { kind: 'reward', id: 'paid_skin', buy: true },
    { kind: 'reward', id: 'gold', buy: 'yes' },
    { kind: 'cancel_application', listingId: 0 },
    { kind: 'cancel_application', listingId: -1 },
    { kind: 'cancel_application', listingId: 1.5 },
    { kind: 'cancel_application', listingId: '1' },
    { kind: 'cancel_application', listingId: Infinity },
    { kind: 'cancel_application', listingId: NaN },
  ])('drops malformed settings %j before entering Sim', (settings) => {
    const configure = vi.fn();
    dispatchDungeonFinderCommand(
      { dungeonFinderExpeditionConfigure: configure } as unknown as Sim,
      7,
      { cmd: 'df_expedition_configure', settings },
    );
    expect(configure).not.toHaveBeenCalled();
  });
  it('cancels one listing through the existing command as the authenticated player', () => {
    const client = bareClient(7);
    const cmd = vi.fn();
    Object.assign(client, { cmd });
    client.dungeonFinderExpeditionConfigure({ kind: 'cancel_application', listingId: 13 });
    expect(cmd).toHaveBeenCalledWith({
      cmd: 'df_expedition_configure',
      settings: { kind: 'cancel_application', listingId: 13 },
    });
    const configure = vi.fn();
    dispatchDungeonFinderCommand(
      { dungeonFinderExpeditionConfigure: configure } as unknown as Sim,
      7,
      {
        cmd: 'df_expedition_configure',
        pid: 99,
        settings: { kind: 'cancel_application', listingId: 13, applicantPid: 99 },
      },
    );
    expect(configure).toHaveBeenCalledExactlyOnceWith(
      { kind: 'cancel_application', listingId: 13 },
      7,
    );
  });
  it('sends no instance target for publication or travel and exactly one role for applications', () => {
    const client = bareClient(7);
    const cmd = vi.fn();
    Object.assign(client, { cmd });
    client.dungeonFinderExpeditionOpen();
    client.dungeonFinderExpeditionTravel();
    client.dungeonFinderExpeditionApply(13, 'healer');
    expect(cmd.mock.calls).toEqual([
      [{ cmd: 'df_expedition_open' }],
      [{ cmd: 'df_expedition_travel' }],
      [{ cmd: 'df_expedition_apply', listing: 13, role: 'healer' }],
    ]);
  });

  it('uses the authenticated pid and discards arbitrary client claim or destination fields', () => {
    const open = vi.fn();
    const travel = vi.fn();
    const apply = vi.fn();
    const sim = {
      dungeonFinderExpeditionOpen: open,
      dungeonFinderExpeditionTravel: travel,
      dungeonFinderExpeditionApply: apply,
    } as unknown as Sim;
    dispatchDungeonFinderCommand(sim, 7, { cmd: 'df_expedition_open', pid: 99, exitId: 10 });
    dispatchDungeonFinderCommand(sim, 7, {
      cmd: 'df_expedition_travel',
      pid: 99,
      dungeon: 'other',
      x: 1,
    });
    dispatchDungeonFinderCommand(sim, 7, {
      cmd: 'df_expedition_apply',
      listing: 13,
      role: 'healer',
      pid: 99,
    });
    expect(open).toHaveBeenCalledExactlyOnceWith(7);
    expect(travel).toHaveBeenCalledExactlyOnceWith(7);
    expect(apply).toHaveBeenCalledExactlyOnceWith(13, 'healer', 7);
  });

  it.each([
    { listing: NaN, role: 'dps' },
    { listing: Infinity, role: 'dps' },
    { listing: -1, role: 'dps' },
    { listing: 1.5, role: 'dps' },
    { listing: 0, role: 'dps' },
    { listing: 1, role: 'admin' },
    { listing: 1, role: ['dps'] },
    { listing: '1', role: 'dps' },
  ])('refuses malformed expedition applications %j', (fields) => {
    const apply = vi.fn();
    dispatchDungeonFinderCommand({ dungeonFinderExpeditionApply: apply } as unknown as Sim, 7, {
      cmd: 'df_expedition_apply',
      ...fields,
    });
    expect(apply).not.toHaveBeenCalled();
  });
});
