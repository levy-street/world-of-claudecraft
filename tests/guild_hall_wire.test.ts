// Lantern Hall on the wire: the quartermaster's buy verb from ClientWorld through the server's
// validator to the authoritative Sim (server/quest_command_wire.ts buyGuildCosmeticWire), and
// the ClientWorld mirror of the `gcon` self key (src/net/guild_hall_wire_state.ts).
import { describe, expect, it, vi } from 'vitest';
import {
  buyGuildCosmeticWire,
  dispatchWorldQuestWire,
  isWorldQuestWireCommand,
} from '../server/quest_command_wire';
import { GUILD_QUARTERMASTER_STOCK } from '../src/sim/content/guild_contracts';
import { guildContractsForWeek } from '../src/sim/guild_contracts';
import type { Sim } from '../src/sim/sim';
import { COMMAND_NAMES } from '../src/world_api';
import { bareClient } from './helpers/bare_client';

describe('the quartermaster purchase on the wire', () => {
  it('sends the literal command and reaches the Sim only with a sane offer id', () => {
    expect(COMMAND_NAMES).toContain('guild_buy_cosmetic');
    expect(isWorldQuestWireCommand('guild_buy_cosmetic')).toBe(true);
    // the offer ids ride the wire, so they are pinned to literals
    expect(GUILD_QUARTERMASTER_STOCK.map((o) => o.id)).toEqual([
      'title_writ_runner',
      'title_hallsworn',
      'title_of_lantern_hall',
      'weapon_skin_lantern_hall_sword',
      'mount_lantern_hall_destrier',
    ]);
    const client = bareClient(7);
    const send = vi.fn();
    Object.assign(client, { cmd: send });
    client.buyGuildCosmetic('title_hallsworn');
    expect(send).toHaveBeenCalledExactlyOnceWith({
      cmd: 'guild_buy_cosmetic',
      offer: 'title_hallsworn',
    });
    const buy = vi.fn();
    const sim = { buyGuildCosmetic: buy } as unknown as Sim;
    // the server threads the acting session's account port through to the sim
    const port = { ownsWeaponSkin: () => false, grantWeaponSkin: () => true };
    dispatchWorldQuestWire(sim, send.mock.calls[0][0], 7, port);
    expect(buy).toHaveBeenCalledExactlyOnceWith('title_hallsworn', 7, port);
    for (const offer of [undefined, null, 3, {}, ['title_hallsworn'], 'x'.repeat(65)])
      buyGuildCosmeticWire(sim, { cmd: 'guild_buy_cosmetic', offer } as never, 7);
    expect(buy).toHaveBeenCalledTimes(1);
    // the longest id the validator still passes
    buyGuildCosmeticWire(sim, { cmd: 'guild_buy_cosmetic', offer: 'y'.repeat(64) } as never, 7);
    expect(buy).toHaveBeenLastCalledWith('y'.repeat(64), 7, undefined);
  });
});

describe('the ClientWorld mirror of the board', () => {
  it('decodes gcon when present, keeps the mirror when absent, and clears on reset', () => {
    const client = bareClient(7);
    const offered = guildContractsForWeek('wk_5').map((c) => c.id);
    expect(client.guildContracts).toEqual({ week: '', offered: [], done: [], lifetime: 0 });
    client.applyQuestSelfSnapshot({
      gcon: { week: 'wk_5', offered, done: [offered[2]], lifetime: 3 },
    } as never);
    expect(client.guildContracts).toEqual({
      week: 'wk_5',
      offered,
      done: [offered[2]],
      lifetime: 3,
    });
    // a delta without the key leaves the mirror as it was
    client.applyQuestSelfSnapshot({} as never);
    expect(client.guildContracts.done).toEqual([offered[2]]);
    // a malformed record is the empty board, never a half-read one
    client.applyQuestSelfSnapshot({ gcon: 'nope' } as never);
    expect(client.guildContracts).toEqual({ week: '', offered: [], done: [], lifetime: 0 });
    client.applyQuestSelfSnapshot({
      gcon: { week: 7, offered, done: [], lifetime: 'many' },
    } as never);
    expect(client.guildContracts).toEqual({ week: '', offered, done: [], lifetime: 0 });
    client.applyQuestSelfSnapshot({
      gcon: { week: 'wk_5', offered, done: [], lifetime: 1 },
    } as never);
    expect(client.guildContracts.lifetime).toBe(1);
    // a reconnect clears it
    client.resetQuestWorldWireState();
    expect(client.guildContracts).toEqual({ week: '', offered: [], done: [], lifetime: 0 });
  });
});
