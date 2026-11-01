// Lantern Hall's war horse and sword appearance, sold by the guild quartermaster for Lantern
// Seals (src/sim/guild_quartermaster.ts, content/guild_contracts.ts): the catalog records, the
// purchase rules (range, owned, seals, riding, bags), the grant-before-spend ordering on both
// the offline host and the server's per-session ledger, and the purchase surviving a save.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { persistSkin } = vi.hoisted(() => ({ persistSkin: vi.fn() }));
vi.mock('../server/db', () => ({
  grantAccountMountSkins: vi.fn(),
  grantAccountWeaponSkins: persistSkin,
  grantAccountMechChroma: vi.fn(),
  markAccountQuestComplete: vi.fn(),
  setAccountWeaponSkinLoadout: vi.fn(),
}));

import { EMPTY_LIVE_ACCOUNT_COSMETICS } from '../server/account_cosmetics_live';
import { AccountCosmeticsService } from '../server/account_cosmetics_service';
import { buyGuildCosmeticWire, dispatchWorldQuestWire } from '../server/quest_command_wire';
import {
  GUILD_QUARTERMASTER_STOCK,
  GUILD_QUARTERMASTER_STOCK_BY_ID,
  LANTERN_HALL_DESTRIER_REINS_ID,
  LANTERN_HALL_DESTRIER_SEALS,
  LANTERN_HALL_SWORD_SEALS,
  LANTERN_HALL_SWORD_SKIN_ID,
  LANTERN_SEAL_ITEM_ID,
} from '../src/sim/content/guild_contracts';
import {
  GUILD_QUARTERMASTER_NPC_ID,
  HIGHWATCH_GUILD_ENTITY_IDS,
} from '../src/sim/content/highwatch_guild';
import { MOUNTS } from '../src/sim/content/mounts';
import { STORE_WEAPON_SKIN_LIST, WEAPON_SKINS } from '../src/sim/content/weapon_skins';
import { ITEMS } from '../src/sim/data';
import type { GuildAccountPort } from '../src/sim/guild_quartermaster';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';

const HORSE = 'mount_lantern_hall_destrier';
const SWORD = 'weapon_skin_lantern_hall_sword';

afterEach(() => {
  persistSkin.mockReset();
});

/** A sim with the primary standing at the quartermaster, riding-trained, with `seals`. */
function atGarrick(seals: number, ridingTrained = true) {
  const s = new Sim({ seed: 7, playerClass: 'warrior' });
  s.resetDay = '2026-10-13';
  const pid = s.player.id;
  const meta = s.players.get(pid);
  if (!meta) throw new Error('no meta');
  meta.ridingTrained = ridingTrained;
  const npc = s.entities.get(HIGHWATCH_GUILD_ENTITY_IDS[GUILD_QUARTERMASTER_NPC_ID]);
  if (!npc) throw new Error('no quartermaster');
  s.player.pos = { x: npc.pos.x + 2, y: npc.pos.y, z: npc.pos.z };
  if (seals > 0) s.ctx.addItem(LANTERN_SEAL_ITEM_ID, seals, pid);
  const guildEvents = (): SimEvent[] =>
    s.tick().filter((e: SimEvent) => e.type.startsWith('guildCosmetic'));
  const sealsLeft = () => s.ctx.players.get(pid)?.lanternSeals ?? 0;
  return { s, pid, meta, guildEvents, sealsLeft };
}

describe('the catalog records', () => {
  it('stocks the horse at 40 seals and the sword at 20, both after the titles', () => {
    expect(LANTERN_HALL_DESTRIER_SEALS).toBe(40);
    expect(LANTERN_HALL_SWORD_SEALS).toBe(20);
    // the sword is the one weapon row, the horse closes
    const ids = GUILD_QUARTERMASTER_STOCK.map((o) => o.id);
    expect(ids.slice(3, 4)).toEqual([SWORD]);
    expect(ids.at(-1)).toBe(HORSE);
    expect(GUILD_QUARTERMASTER_STOCK_BY_ID[HORSE]).toEqual({
      id: HORSE,
      kind: 'mount',
      itemId: LANTERN_HALL_DESTRIER_REINS_ID,
      seals: 40,
    });
    expect(GUILD_QUARTERMASTER_STOCK_BY_ID[SWORD]).toEqual({
      id: SWORD,
      kind: 'weaponSkin',
      skinId: LANTERN_HALL_SWORD_SKIN_ID,
      seals: 20,
    });
  });

  it('the horse is a ground special in the heroic-drop tier, and its reins follow the mount policy', () => {
    expect(MOUNTS.lantern_hall_destrier).toEqual({
      key: 'lantern_hall_destrier',
      name: 'Lantern Hall Destrier',
      rarity: 'uncommon',
    });
    const reins = ITEMS[LANTERN_HALL_DESTRIER_REINS_ID];
    expect(reins).toMatchObject({
      kind: 'mount',
      mount: 'lantern_hall_destrier',
      quality: 'uncommon',
      noVendorSell: true,
      noDiscard: true,
      sellValue: 0,
    });
    // no coin price anywhere: the seals are the only way in
    expect(reins.buyValue).toBeUndefined();
    expect(reins.soulbound).toBeFalsy();
  });

  it('the sword is an earned rare sword skin the Claudium store never lists', () => {
    expect(WEAPON_SKINS[LANTERN_HALL_SWORD_SKIN_ID]).toEqual({
      id: 'lantern_hall_sword',
      collection: 'lantern_hall',
      rarity: 'rare',
      weaponType: 'sword',
      model: 'lantern_hall_sword',
      season: 1,
      earnedFrom: 'lantern_hall',
    });
    expect(STORE_WEAPON_SKIN_LIST.some((s) => s.id === LANTERN_HALL_SWORD_SKIN_ID)).toBe(false);
    // the store skips five: the guild's earned blade and four arms reserved for a future raid
    expect(STORE_WEAPON_SKIN_LIST.length).toBe(Object.keys(WEAPON_SKINS).length - 5);
  });
});

describe('buying the horse', () => {
  it('refuses short of seals, then grants the reins and takes exactly 40', () => {
    const { s, pid, guildEvents, sealsLeft } = atGarrick(39);
    s.buyGuildCosmetic(HORSE);
    expect(guildEvents()).toEqual([
      expect.objectContaining({ type: 'guildCosmeticRefused', offerId: HORSE, reason: 'seals' }),
    ]);
    expect(sealsLeft()).toBe(39);
    s.ctx.addItem(LANTERN_SEAL_ITEM_ID, 3, pid);
    s.buyGuildCosmetic(HORSE);
    expect(guildEvents()).toEqual([
      expect.objectContaining({ type: 'guildCosmeticBought', offerId: HORSE }),
    ]);
    expect(sealsLeft()).toBe(2);
    expect(s.ctx.countItem(LANTERN_HALL_DESTRIER_REINS_ID, pid)).toBe(1);
    expect(s.ownedMounts()).toContain('lantern_hall_destrier');
  });

  it('refuses a second horse as owned and keeps the seals', () => {
    const { s, guildEvents, sealsLeft } = atGarrick(80);
    s.buyGuildCosmetic(HORSE);
    guildEvents();
    s.buyGuildCosmetic(HORSE);
    expect(guildEvents()).toEqual([
      expect.objectContaining({ type: 'guildCosmeticRefused', reason: 'owned' }),
    ]);
    expect(sealsLeft()).toBe(40);
  });

  it('refuses a rider who cannot ride yet, and full bags, without taking a seal', () => {
    const untrained = atGarrick(40, false);
    untrained.s.buyGuildCosmetic(HORSE);
    expect(untrained.guildEvents()).toEqual([
      expect.objectContaining({ type: 'guildCosmeticRefused', reason: 'riding' }),
    ]);
    expect(untrained.sealsLeft()).toBe(40);

    const full = atGarrick(40);
    vi.spyOn(full.s.ctx, 'canAddItem').mockReturnValue(false);
    full.s.buyGuildCosmetic(HORSE);
    expect(full.guildEvents()).toEqual([
      expect.objectContaining({ type: 'guildCosmeticRefused', reason: 'bags' }),
    ]);
    expect(full.sealsLeft()).toBe(40);
    expect(full.s.ctx.countItem(LANTERN_HALL_DESTRIER_REINS_ID, full.pid)).toBe(0);
  });

  it('keeps the horse across a save: the reins ride the character state', () => {
    const { s, pid } = atGarrick(40);
    s.buyGuildCosmetic(HORSE);
    s.tick();
    const saved = JSON.parse(JSON.stringify(s.serializeCharacter(pid)));
    const fresh = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: false });
    const restored = fresh.addPlayer('warrior', 'Restored', { state: saved, characterId: 9 });
    const meta = fresh.players.get(restored);
    if (!meta) throw new Error('no restored meta');
    expect(fresh.ctx.countItem(LANTERN_HALL_DESTRIER_REINS_ID, restored)).toBe(1);
    expect(fresh.ctx.players.get(restored)?.lanternSeals ?? 0).toBe(0);
  });
});

describe('buying the sword offline', () => {
  it("grants the skin to the Sim's own account mirror, takes 20, then refuses it as owned", () => {
    const { s, guildEvents, sealsLeft } = atGarrick(45);
    expect(s.accountCosmetics.weaponSkinIds).not.toContain(LANTERN_HALL_SWORD_SKIN_ID);
    const before = s.accountCosmetics;
    s.buyGuildCosmetic(SWORD);
    expect(guildEvents()).toEqual([
      expect.objectContaining({ type: 'guildCosmeticBought', offerId: SWORD }),
    ]);
    expect(s.accountCosmetics.weaponSkinIds).toContain(LANTERN_HALL_SWORD_SKIN_ID);
    // replaced whole, never mutated in place, so consumers diff by identity
    expect(s.accountCosmetics).not.toBe(before);
    expect(sealsLeft()).toBe(25);
    s.buyGuildCosmetic(SWORD);
    expect(guildEvents()).toEqual([
      expect.objectContaining({ type: 'guildCosmeticRefused', reason: 'owned' }),
    ]);
    expect(sealsLeft()).toBe(25);
  });
});

describe('the account port decides the sword on a server', () => {
  it('reads ownership from the port, not the realm-wide mirror, and spends only after a grant', () => {
    const { s, pid, guildEvents, sealsLeft } = atGarrick(40);
    // the realm-wide mirror says owned; the session's ledger says not: the session wins
    s.accountCosmetics = {
      ...s.accountCosmetics,
      weaponSkinIds: [LANTERN_HALL_SWORD_SKIN_ID],
    };
    const granted: string[] = [];
    const port: GuildAccountPort = {
      ownsWeaponSkin: (id) => granted.includes(id),
      grantWeaponSkin: (id) => {
        granted.push(id);
        return true;
      },
    };
    buyGuildCosmeticWire(s, { cmd: 'guild_buy_cosmetic', offer: SWORD } as never, pid, port);
    expect(guildEvents()).toEqual([
      expect.objectContaining({ type: 'guildCosmeticBought', offerId: SWORD }),
    ]);
    expect(granted).toEqual([LANTERN_HALL_SWORD_SKIN_ID]);
    expect(sealsLeft()).toBe(20);
    // the dispatcher threads the same port through
    dispatchWorldQuestWire(s, { cmd: 'guild_buy_cosmetic', offer: SWORD } as never, pid, port);
    expect(guildEvents()).toEqual([
      expect.objectContaining({ type: 'guildCosmeticRefused', reason: 'owned' }),
    ]);
    expect(sealsLeft()).toBe(20);
  });

  it("the server hands the quartermaster the ACTING session's ledger, never the sim mirror", () => {
    // a wire-layer default would fall back to the realm-wide ctx.accountCosmetics
    const game = readFileSync(join(__dirname, '..', 'server', 'game.ts'), 'utf8');
    expect(game).toMatch(
      /this\.cosmetics\.ledger\(session, \(offer\) => \{\s*void this\.guildWeapons\.start\(session, offer\);\s*\}\)/,
    );
  });

  it('keeps every seal when the grant fails', () => {
    const { s, pid, guildEvents, sealsLeft } = atGarrick(40);
    const port: GuildAccountPort = { ownsWeaponSkin: () => false, grantWeaponSkin: () => false };
    s.buyGuildCosmetic(SWORD, pid, port);
    expect(guildEvents()).toEqual([]);
    expect(sealsLeft()).toBe(40);
  });

  it('refuses synchronous account grants without the atomic purchase coordinator', async () => {
    persistSkin.mockResolvedValue({
      ...EMPTY_LIVE_ACCOUNT_COSMETICS,
      weaponSkinIds: [LANTERN_HALL_SWORD_SKIN_ID],
    });
    const sessions = [1, 2].map((pid) => ({
      pid,
      accountId: 7,
      accountCosmetics: { ...EMPTY_LIVE_ACCOUNT_COSMETICS, weaponSkinIds: [] as string[] },
    }));
    const service = new AccountCosmeticsService({
      sim: () =>
        ({ meta: () => null, entities: new Map(), setWeaponSkinLoadout: vi.fn() }) as never,
      sessions: () => sessions,
      resyncQuests: vi.fn(),
    });
    service.remember(7, sessions[0].accountCosmetics);
    const port = service.ledger(sessions[0]);
    expect(port.ownsWeaponSkin(LANTERN_HALL_SWORD_SKIN_ID)).toBe(false);
    expect(port.grantWeaponSkin('not_a_skin')).toBe(false);
    expect(persistSkin).not.toHaveBeenCalled();
    expect(port.grantWeaponSkin(LANTERN_HALL_SWORD_SKIN_ID)).toBe(false);
    // Ownership cannot precede the transaction that saves its character seal charge.
    expect(sessions.map((x) => x.accountCosmetics.weaponSkinIds)).toEqual([[], []]);
    expect(service.ledger(sessions[1]).ownsWeaponSkin(LANTERN_HALL_SWORD_SKIN_ID)).toBe(false);
    expect(persistSkin).not.toHaveBeenCalled();
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(sessions[0].accountCosmetics.weaponSkinIds).toEqual([]);
  });
});
