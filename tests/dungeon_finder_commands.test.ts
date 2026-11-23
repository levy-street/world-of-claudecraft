// server/dungeon_finder_commands.ts: the nine df_* frame guards, moved whole
// out of server/game.ts. Each frame either reaches its sim method with exactly
// the validated payload or is dropped whole (no partial laundering).

import { describe, expect, it, vi } from 'vitest';
import { dispatchDungeonFinderCommand } from '../server/dungeon_finder_commands';
import type { Sim } from '../src/sim/sim';

function fakeSim() {
  return {
    dungeonFinderSetRoles: vi.fn(),
    dungeonFinderQueueJoin: vi.fn(),
    dungeonFinderQueueLeave: vi.fn(),
    dungeonFinderRespond: vi.fn(),
    dungeonFinderListingCreate: vi.fn(),
    dungeonFinderListingClose: vi.fn(),
    dungeonFinderApply: vi.fn(),
    dungeonFinderApplyCancel: vi.fn(),
    dungeonFinderApplicationRespond: vi.fn(),
  };
}

const run = (sim: ReturnType<typeof fakeSim>, msg: Record<string, unknown>) =>
  dispatchDungeonFinderCommand(sim as unknown as Sim, 7, msg);

describe('dispatchDungeonFinderCommand', () => {
  it('passes valid frames through with the sender', () => {
    const sim = fakeSim();
    run(sim, { cmd: 'df_roles', roles: ['tank', 'healer'] });
    expect(sim.dungeonFinderSetRoles).toHaveBeenCalledWith(['tank', 'healer'], 7);
    run(sim, { cmd: 'df_queue', activities: ['drowned_temple'] });
    expect(sim.dungeonFinderQueueJoin).toHaveBeenCalledWith(['drowned_temple'], 7);
    run(sim, { cmd: 'df_queue_leave' });
    expect(sim.dungeonFinderQueueLeave).toHaveBeenCalledWith(7);
    run(sim, { cmd: 'df_proposal', accept: true });
    expect(sim.dungeonFinderRespond).toHaveBeenCalledWith(true, 7);
    run(sim, { cmd: 'df_list_close' });
    expect(sim.dungeonFinderListingClose).toHaveBeenCalledWith(7);
    run(sim, { cmd: 'df_apply', listing: 12 });
    expect(sim.dungeonFinderApply).toHaveBeenCalledWith(12, 7);
    run(sim, { cmd: 'df_apply_cancel' });
    expect(sim.dungeonFinderApplyCancel).toHaveBeenCalledWith(7);
    run(sim, { cmd: 'df_app_respond', applicant: 3, accept: 'yes' });
    expect(sim.dungeonFinderApplicationRespond).toHaveBeenCalledWith(3, false, 7);
  });

  it('drops a frame whole when any field fails its guard', () => {
    const sim = fakeSim();
    run(sim, { cmd: 'df_roles', roles: ['tank', 'healer', 'damage', 'tank'] });
    run(sim, { cmd: 'df_roles', roles: ['tank', 'wizard'] });
    run(sim, { cmd: 'df_queue', activities: Array.from({ length: 17 }, () => 'x') });
    run(sim, { cmd: 'df_queue', activities: ['ok', 3] });
    run(sim, { cmd: 'df_list_create', activity: 'x'.repeat(65), tags: [] });
    run(sim, { cmd: 'df_list_create', activity: 'ok', tags: 'nope' });
    run(sim, { cmd: 'df_apply', listing: Number.NaN });
    run(sim, { cmd: 'df_app_respond', applicant: 'x' });
    expect(sim.dungeonFinderSetRoles).not.toHaveBeenCalled();
    expect(sim.dungeonFinderQueueJoin).not.toHaveBeenCalled();
    expect(sim.dungeonFinderListingCreate).not.toHaveBeenCalled();
    expect(sim.dungeonFinderApply).not.toHaveBeenCalled();
    expect(sim.dungeonFinderApplicationRespond).not.toHaveBeenCalled();
  });
});

import { bareClient } from './helpers/bare_client';

describe('expedition wire commands', () => {
  it('passes the host note policy to authoritative details admission', () => {
    const configure = vi.fn();
    const allowNote = vi.fn(() => false);
    dispatchDungeonFinderCommand(
      {
        dungeonFinderExpeditionConfigure: configure,
      } as unknown as Sim,
      7,
      {
        cmd: 'df_expedition_configure',
        settings: { kind: 'details', details: { purpose: 'clear', note: 'Blocked note' } },
      },
      allowNote,
    );
    expect(configure).toHaveBeenCalledExactlyOnceWith(
      { kind: 'details', details: { purpose: 'clear', note: 'Blocked note' } },
      7,
      allowNote,
    );
    expect(allowNote).not.toHaveBeenCalled();
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
