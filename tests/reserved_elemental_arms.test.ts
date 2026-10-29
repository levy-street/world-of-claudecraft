// The four elemental weapon appearances (Hearthbrand, Squallcrest, the Rimelight Staff and the
// Duskwick Staff) are RESERVED as loot for a future raid: once sold at Lantern Hall's
// quartermaster, they are now obtainable nowhere (content/weapon_skins.ts earnedFrom
// 'future_raid'). This pins both halves of that: no player-visible source offers them (the
// guild stock, the Claudium Armory list, the Reliquary, the wiki content), a forged buy is
// refused, and the assets the raid will hand out stay whole (records, grip family, VFX row,
// swing trail, GLB, Armory card and bag preview) so the raid only has to add a drop.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buyGuildCosmeticWire } from '../server/quest_command_wire';
import { KAYKIT_WEAPON_ACCESSORY } from '../src/render/characters/assets';
import { weaponSkinSwingTrail } from '../src/render/weapon_skin_trail_core';
import { WEAPON_VFX } from '../src/render/weapon_vfx';
import {
  GUILD_QUARTERMASTER_STOCK,
  LANTERN_SEAL_ITEM_ID,
} from '../src/sim/content/guild_contracts';
import {
  GUILD_QUARTERMASTER_NPC_ID,
  HIGHWATCH_GUILD_ENTITY_IDS,
} from '../src/sim/content/highwatch_guild';
import { RELIQUARY_PAGES } from '../src/sim/content/reliquary';
import {
  RESERVED_WEAPON_SKIN_IDS,
  STORE_WEAPON_SKIN_LIST,
  WEAPON_SKINS,
} from '../src/sim/content/weapon_skins';
import { type GuildAccountPort, guildOfferResolves } from '../src/sim/guild_quartermaster';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { armorySkinStrings } from '../src/ui/i18n.catalog/armory';

const ROOT = join(__dirname, '..');

/** Skin id, its held model, its weapon type and its display name. */
const ARMS = [
  { skin: 'hearthbrand_sword', model: 'hearthbrand', type: 'sword', name: 'Hearthbrand' },
  { skin: 'squallcrest_sword', model: 'squallcrest', type: 'sword', name: 'Squallcrest' },
  { skin: 'rimelight_staff', model: 'rimelight_staff', type: 'staff', name: 'Rimelight Staff' },
  { skin: 'duskwick_staff', model: 'duskwick_staff', type: 'staff', name: 'Duskwick Staff' },
] as const;

function atGarrick(seals: number) {
  const s = new Sim({ seed: 7, playerClass: 'mage' });
  s.resetDay = '2026-10-13';
  const pid = s.player.id;
  const npc = s.entities.get(HIGHWATCH_GUILD_ENTITY_IDS[GUILD_QUARTERMASTER_NPC_ID]);
  if (!npc) throw new Error('no quartermaster');
  s.player.pos = { x: npc.pos.x + 2, y: npc.pos.y, z: npc.pos.z };
  if (seals > 0) s.ctx.addItem(LANTERN_SEAL_ITEM_ID, seals, pid);
  const guildEvents = (): SimEvent[] =>
    s.tick().filter((e: SimEvent) => e.type.startsWith('guildCosmetic'));
  const sealsLeft = () => s.ctx.players.get(pid)?.lanternSeals ?? 0;
  return { s, pid, guildEvents, sealsLeft };
}

describe('the catalog records', () => {
  it('keeps the four as epic skins reserved for a future raid', () => {
    expect([...RESERVED_WEAPON_SKIN_IDS]).toEqual(ARMS.map((a) => a.skin));
    for (const arm of ARMS) {
      expect(WEAPON_SKINS[arm.skin]).toEqual({
        id: arm.skin,
        collection: 'lantern_hall',
        rarity: 'epic',
        weaponType: arm.type,
        model: arm.model,
        season: 1,
        earnedFrom: 'future_raid',
      });
      expect(armorySkinStrings[arm.skin].name).toBe(arm.name);
      // the look is a look: every lore line says so
      expect(armorySkinStrings[arm.skin].lore, arm.skin).toMatch(/only a look\.$/);
    }
  });
});

describe('no player-visible source offers them', () => {
  it("is not on Garrick's stock, which sells only titles, the guild's sword and its horse", () => {
    // the offer ids ride the wire, so literals
    expect(GUILD_QUARTERMASTER_STOCK.map((o) => o.id)).toEqual([
      'title_writ_runner',
      'title_hallsworn',
      'title_of_lantern_hall',
      'weapon_skin_lantern_hall_sword',
      'mount_lantern_hall_destrier',
    ]);
    for (const offer of GUILD_QUARTERMASTER_STOCK) {
      if (offer.kind !== 'weaponSkin') continue;
      expect(WEAPON_SKINS[offer.skinId]?.earnedFrom, offer.id).toBe('lantern_hall');
    }
  });

  it('is not in the Claudium Armory list', () => {
    for (const arm of ARMS) {
      expect(
        STORE_WEAPON_SKIN_LIST.some((s) => s.id === arm.skin),
        arm.skin,
      ).toBe(false);
    }
  });

  it('has no Reliquary row on any page', () => {
    const reserved = new Set<string>(RESERVED_WEAPON_SKIN_IDS);
    for (const page of RELIQUARY_PAGES) {
      for (const relic of page.relics) {
        if (relic.kind !== 'weapon_skin') continue;
        expect(reserved.has(relic.skinId), `${page.id}: ${relic.skinId}`).toBe(false);
      }
    }
  });

  it('is absent from the generated wiki content', () => {
    const wiki = readFileSync(join(ROOT, 'src', 'guide', 'content.generated.ts'), 'utf8');
    for (const arm of ARMS) expect(wiki, arm.name).not.toContain(`"${arm.name}"`);
  });
});

describe('a forged buy', () => {
  it('never resolves a weapon-skin offer for a reserved skin, even if one were stocked', () => {
    for (const arm of ARMS) {
      expect(
        guildOfferResolves({
          id: `weapon_skin_${arm.skin}`,
          kind: 'weaponSkin',
          skinId: arm.skin,
          seals: 20,
        }),
        arm.skin,
      ).toBe(false);
    }
    // the guild's own blade still resolves
    expect(
      guildOfferResolves({
        id: 'weapon_skin_lantern_hall_sword',
        kind: 'weaponSkin',
        skinId: 'lantern_hall_sword',
        seals: 20,
      }),
    ).toBe(true);
  });

  it('refuses an old elemental offer id offline and keeps every seal', () => {
    const { s, guildEvents, sealsLeft } = atGarrick(30);
    // an id off the stock is dropped silently, like any unknown offer
    s.buyGuildCosmetic('weapon_skin_duskwick_staff');
    expect(guildEvents()).toEqual([]);
    expect(sealsLeft()).toBe(30);
    expect(s.accountCosmetics.weaponSkinIds).not.toContain('duskwick_staff');
  });

  it("refuses one through the server session's port and grants nothing", () => {
    const { s, pid, guildEvents, sealsLeft } = atGarrick(40);
    const granted: string[] = [];
    const port: GuildAccountPort = {
      ownsWeaponSkin: (id) => granted.includes(id),
      grantWeaponSkin: (id) => {
        granted.push(id);
        return true;
      },
    };
    buyGuildCosmeticWire(
      s,
      { cmd: 'guild_buy_cosmetic', offer: 'weapon_skin_rimelight_staff' } as never,
      pid,
      port,
    );
    expect(guildEvents()).toEqual([]);
    expect(granted).toEqual([]);
    expect(sealsLeft()).toBe(40);
  });
});

describe('the kept assets the raid will hand out', () => {
  it('holds each in its own grip family and carries an epic VFX row and a swing trail', () => {
    for (const arm of ARMS) {
      expect(KAYKIT_WEAPON_ACCESSORY[arm.model], arm.model).toBe(
        arm.type === 'staff' ? 'VAR_STAFF' : 'VAR_SWORD',
      );
      const spec = WEAPON_VFX[arm.model];
      expect(spec?.tier, arm.model).toBe('epic');
      expect(spec.name).toBe(arm.name);
      expect(spec.type).toBe(arm.type);
      expect(weaponSkinSwingTrail(arm.skin, 'melee'), arm.skin).not.toBeNull();
    }
  });

  it('gives each element its signature effect', () => {
    const kinds = (model: string) => WEAPON_VFX[model].fx.map((c) => c.kind);
    // the storm blade crackles; nothing else in the catalog needs arcs
    expect(kinds('squallcrest')).toContain('arcs');
    expect(kinds('squallcrest')).toContain('aurora');
    // the dusk-flame's smoke is drawn over the scene so it can darken it
    const smoke = WEAPON_VFX.duskwick_staff.fx.find(
      (c) => c.kind === 'drift' && c.blend === 'smoke',
    );
    expect(smoke).toBeDefined();
    // each glow window is the element's own hue: fire warm, sea and frost blue, dusk violet
    expect(WEAPON_VFX.hearthbrand.emissive?.hue).toEqual([8, 52]);
    expect(WEAPON_VFX.squallcrest.emissive?.hue).toEqual([180, 215]);
    expect(WEAPON_VFX.rimelight_staff.emissive?.hue).toEqual([175, 215]);
    expect(WEAPON_VFX.duskwick_staff.emissive?.hue).toEqual([260, 300]);
  });

  it('ships the GLB at its grip family height, the Armory card and the bag preview', () => {
    for (const arm of ARMS) {
      const glb = join(ROOT, 'public', 'models', 'weapons', `${arm.model}.glb`);
      expect(existsSync(glb), glb).toBe(true);
      const buf = readFileSync(glb);
      const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
      let lo = Infinity;
      let hi = -Infinity;
      for (const mesh of json.meshes)
        for (const prim of mesh.primitives) {
          const acc = json.accessors[prim.attributes.POSITION];
          lo = Math.min(lo, acc.min[1]);
          hi = Math.max(hi, acc.max[1]);
        }
      // grip at the origin; a sword under VAR_SWORD's 2.0 clamp (give or take its pommel ring),
      // a staff under VAR_STAFF's 2.4
      expect(lo, arm.model).toBeLessThan(0);
      expect(hi - lo, arm.model).toBeLessThanOrEqual(arm.type === 'staff' ? 2.4 : 2.05);
      expect(hi - lo, arm.model).toBeGreaterThan(arm.type === 'staff' ? 2.2 : 1.9);
      expect(existsSync(join(ROOT, 'public', 'ui', 'store', 'armory', `${arm.skin}.webp`))).toBe(
        true,
      );
      expect(existsSync(join(ROOT, 'public', 'ui', 'weapons', `${arm.model}.jpg`))).toBe(true);
    }
  });
});
