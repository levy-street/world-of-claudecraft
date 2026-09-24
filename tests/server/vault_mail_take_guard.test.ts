import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { handleVaultMailTake, VaultMailTakeGuard } from '../../server/vault_mail_take_guard';
import type { Sim } from '../../src/sim/sim';

describe('vault mail take guard', () => {
  it('refuses a fresh join until recovery has restored the durable letter', () => {
    const game = readFileSync(join(process.cwd(), 'server/game.ts'), 'utf8');
    const joinBody = game.split('  join(\n')[1]?.split('    const pid = this.sim.addPlayer(')[0];
    // The recovery rides the composed vault services (server/vault_game_services.ts).
    expect(joinBody).toContain('this.vault.joinError(characterId)');
  });

  it('rechecks the vault fence after each offline mail-send await before escrow', () => {
    const game = readFileSync(join(process.cwd(), 'server/game.ts'), 'utf8');
    const send = game.split("case 'mail_send': {")[1]?.split("case 'mail_take':")[0];
    expect(send).toBeDefined();
    const fence = 'if (this.vault.guard.isLocked(session.characterId)) return;';
    expect(send?.split(fence)).toHaveLength(3);
    expect(send?.indexOf(fence)).toBeGreaterThan(send?.indexOf('.then(async (target) => {') ?? -1);
    expect(send?.lastIndexOf(fence)).toBeGreaterThan(
      send?.indexOf('await this.socialDb.blockedIds') ?? -1,
    );
    expect(send?.lastIndexOf(fence)).toBeLessThan(send?.lastIndexOf('sim.mailSendResolved(') ?? -1);
  });
  it('keeps foreign saves and commands fenced until the matching save commits', () => {
    const guard = new VaultMailTakeGuard();
    expect(guard.begin(7, 70)).toBe(true);
    expect(guard.begin(7, 70)).toBe(false);
    expect(guard.isLocked(7)).toBe(true);
    expect(guard.maySave(7, 70)).toBe(true);
    expect(guard.maySave(7, 71)).toBe(false);
    expect(guard.joinError(7, false)).toMatch(/recovering/);
    expect(guard.joinError(7, true)).toBeNull();
    expect(guard.capture(7, 70, [{ recipientKey: '8' }])).toBeUndefined();
    const captured = guard.capture(7, 70, [{ recipientKey: '7' }]);
    guard.committed(7);
    expect(guard.isLocked(7)).toBe(true);
    guard.committed(7, captured);
    expect(guard.isLocked(7)).toBe(false);
  });

  it('does not let an older save release a later take', () => {
    const guard = new VaultMailTakeGuard();
    guard.begin(7, 70);
    const earlier = guard.capture(7, 70, [{ recipientKey: '7' }]);
    guard.discardIfUnchanged(
      7,
      { copper: 0, items: [], read: true },
      { copper: 0, items: [], read: true },
    );
    guard.begin(7, 70);
    guard.committed(7, earlier);
    expect(guard.isLocked(7)).toBe(true);
  });

  it('wakes pending rewards only after a changed vault letter is durably saved', async () => {
    const guard = new VaultMailTakeGuard();
    const save = vi.fn(async () => true);
    const onSaved = vi.fn();
    const letter = {
      id: 1,
      letterId: 'hoard_vault_reward',
      copper: 12,
      items: [{ itemId: 'thorium_ore', count: 1 }],
      read: false,
    };
    const sim = {
      mailInfoFor: () => ({ messages: [letter] }),
      postOffice: { vaultCustodyRefFor: () => 'vault:test:7:1:7' },
      mailTake: () => {
        letter.copper = 0;
        letter.items = [];
        letter.read = true;
      },
    } as unknown as Pick<Sim, 'mailInfoFor' | 'mailTake' | 'postOffice'>;
    handleVaultMailTake(guard, sim, 7, 70, 1, save, undefined, onSaved);
    expect(save).toHaveBeenCalledOnce();
    expect(guard.isLocked(7)).toBe(true);
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it('reports a fenced-out save while keeping the projected loot locked', async () => {
    const guard = new VaultMailTakeGuard();
    const onFailure = vi.fn();
    const onSaved = vi.fn();
    const letter = { id: 1, letterId: 'hoard_vault_reward', copper: 12, items: [], read: false };
    const sim = {
      mailInfoFor: () => ({ messages: [letter] }),
      postOffice: { vaultCustodyRefFor: () => 'vault:test:7:1:7' },
      mailTake: () => {
        letter.copper = 0;
        letter.read = true;
      },
    } as unknown as Pick<Sim, 'mailInfoFor' | 'mailTake' | 'postOffice'>;
    handleVaultMailTake(guard, sim, 7, 70, 1, async () => false, onFailure, onSaved);
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce());
    expect(onSaved).not.toHaveBeenCalled();
    expect(guard.isLocked(7)).toBe(true);
  });
});
