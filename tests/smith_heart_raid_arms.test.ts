// The Smith's Heart raid arms: one weapon appearance per encounter (Seamcaller for the Hammer
// Council, Squallcrest for the Breath, the Rimelight Staff for the Quench, Hearthbrand for the
// Heat and the Heartmeld Staff, model id duskwick_staff, for the Masterless Strength). The
// achievements step wires the grants; until then they are obtainable nowhere
// (content/weapon_skins.ts earnedFrom 'smiths_heart'). This pins both halves: the data the grant
// step needs (each skin's encounter, resolving to the real boss templates), no player-visible
// source offering them today (the guild stock, the Claudium Armory, the Reliquary, the wiki), a
// forged buy refused, and the assets whole (records, grip family, VFX row with its element's
// signature effect, swing trail, GLB size, Armory card and bag preview).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buyGuildCosmeticWire } from '../server/quest_command_wire';
import { KAYKIT_WEAPON_ACCESSORY, VARIANT_GRIPS } from '../src/render/characters/assets';
import { WEAPON_GRIP_OVERRIDES } from '../src/render/characters/weapon_grip';
import { weaponSkinSwingTrail } from '../src/render/weapon_skin_trail_core';
import { WEAPON_VFX, type WeaponVfxComponent } from '../src/render/weapon_vfx';
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
  SMITH_HEART_COUNCIL,
  SMITH_HEART_FINAL_BOSS,
  SMITH_HEART_GUARDIANS,
  SMITH_HEART_MOBS,
} from '../src/sim/content/smith_heart';
import {
  isGrantableWeaponSkin,
  RESERVED_WEAPON_SKIN_IDS,
  SMITHS_HEART_WEAPON_SKINS,
  type SmithsHeartEncounter,
  STORE_WEAPON_SKIN_LIST,
  WEAPON_SKINS,
} from '../src/sim/content/weapon_skins';
import { type GuildAccountPort, guildOfferResolves } from '../src/sim/guild_quartermaster';
import { Sim } from '../src/sim/sim';
import type { SimEvent } from '../src/sim/types';
import { armoryCollectionStrings, armorySkinStrings } from '../src/ui/i18n.catalog/armory';

const ROOT = join(__dirname, '..');

/** Skin id, its held model, weapon type, rarity, display name and the encounter that awards it,
 *  in encounter order. */
const ARMS = [
  {
    skin: 'seamcaller_maul',
    model: 'seamcaller_maul',
    type: 'mace',
    rarity: 'epic',
    name: 'Seamcaller',
    encounter: 'hammer_council',
  },
  {
    skin: 'squallcrest_sword',
    model: 'squallcrest',
    type: 'sword',
    rarity: 'epic',
    name: 'Squallcrest',
    encounter: 'breath',
  },
  {
    skin: 'rimelight_staff',
    model: 'rimelight_staff',
    type: 'staff',
    rarity: 'epic',
    name: 'Rimelight Staff',
    encounter: 'quench',
  },
  {
    skin: 'hearthbrand_sword',
    model: 'hearthbrand',
    type: 'sword',
    rarity: 'epic',
    name: 'Hearthbrand',
    encounter: 'heat',
  },
  {
    skin: 'duskwick_staff',
    model: 'duskwick_staff',
    type: 'staff',
    rarity: 'legendary',
    name: 'Heartmeld Staff',
    encounter: 'masterless',
  },
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
  const sealsLeft = () => s.ctx.countItem(LANTERN_SEAL_ITEM_ID, pid);
  return { s, pid, guildEvents, sealsLeft };
}

describe('the catalog records', () => {
  it("keeps the five as Smith's Heart skins, one per encounter, ready for the grant step", () => {
    expect([...RESERVED_WEAPON_SKIN_IDS]).toEqual(ARMS.map((a) => a.skin));
    for (const arm of ARMS) {
      expect(WEAPON_SKINS[arm.skin]).toEqual({
        id: arm.skin,
        collection: 'smiths_heart',
        rarity: arm.rarity,
        weaponType: arm.type,
        model: arm.model,
        season: 1,
        earnedFrom: 'smiths_heart',
        raidEncounter: arm.encounter,
      });
      expect(SMITHS_HEART_WEAPON_SKINS[arm.encounter]).toBe(arm.skin);
      expect(armorySkinStrings[arm.skin].name).toBe(arm.name);
      // the look is a look: every lore line says so
      expect(armorySkinStrings[arm.skin].lore, arm.skin).toMatch(/only a look\.$/);
      // and none still names the guild's quartermaster: the raid made them
      expect(armorySkinStrings[arm.skin].lore, arm.skin).not.toMatch(/Garrick|Lantern Hall/);
    }
    expect(Object.keys(SMITHS_HEART_WEAPON_SKINS)).toEqual(ARMS.map((a) => a.encounter));
    expect(armoryCollectionStrings.smiths_heart).toBe("Smith's Heart");
  });

  it('names encounters that resolve to the real boss templates of the raid', () => {
    // literal on purpose: the achievements step keys its grant off these bosses
    const bosses: Record<SmithsHeartEncounter, readonly string[]> = {
      hammer_council: SMITH_HEART_COUNCIL,
      breath: [SMITH_HEART_GUARDIANS.breath],
      quench: [SMITH_HEART_GUARDIANS.quench],
      heat: [SMITH_HEART_GUARDIANS.heat],
      masterless: [SMITH_HEART_FINAL_BOSS],
    };
    expect(bosses).toEqual({
      hammer_council: ['heart_hammer_guardian', 'heart_seam_singer'],
      breath: ['heart_breath_guardian'],
      quench: ['heart_quench_guardian'],
      heat: ['heart_heat_guardian'],
      masterless: ['heart_masterless_strength'],
    });
    for (const ids of Object.values(bosses)) {
      for (const id of ids) expect(SMITH_HEART_MOBS[id], id).toBeDefined();
    }
  });

  it('keeps every raid skin cosmetic: no record field reaches stats, reach or speed', () => {
    for (const arm of ARMS) {
      expect(Object.keys(WEAPON_SKINS[arm.skin]).sort()).toEqual(
        [
          'collection',
          'earnedFrom',
          'id',
          'model',
          'raidEncounter',
          'rarity',
          'season',
          'weaponType',
        ].sort(),
      );
    }
  });
});

describe('no player-visible source offers them yet', () => {
  it("is not on Garrick's stock, which sells only titles, the guild's sword and its horse", () => {
    // the offer ids ride the wire, so literals
    expect(GUILD_QUARTERMASTER_STOCK.map((o) => o.id)).toEqual([
      'title_writ_runner',
      'title_hallsworn',
      'title_of_lantern_hall',
      'weapon_skin_lantern_hall_sword',
      'mount_lantern_hall_destrier',
    ]);
  });

  it('is not in the Claudium Armory list, and nothing may grant one', () => {
    for (const arm of ARMS) {
      expect(
        STORE_WEAPON_SKIN_LIST.some((s) => s.id === arm.skin),
        arm.skin,
      ).toBe(false);
      expect(isGrantableWeaponSkin(arm.skin), arm.skin).toBe(false);
    }
    expect(isGrantableWeaponSkin('lantern_hall_sword')).toBe(true);
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
  it('never resolves a weapon-skin offer for a raid skin, even if one were stocked', () => {
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
  });

  it('refuses an old elemental offer id offline and keeps every seal', () => {
    const { s, guildEvents, sealsLeft } = atGarrick(30);
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
      { cmd: 'guild_buy_cosmetic', offer: 'weapon_skin_seamcaller_maul' } as never,
      pid,
      port,
    );
    expect(guildEvents()).toEqual([]);
    expect(granted).toEqual([]);
    expect(sealsLeft()).toBe(40);
  });
});

describe('the assets the raid hands out', () => {
  it('holds each in its grip family, with a VFX row of its tier and a swing trail', () => {
    const family = { sword: 'VAR_SWORD', staff: 'VAR_STAFF', mace: 'VAR_HAMMER' } as const;
    for (const arm of ARMS) {
      expect(KAYKIT_WEAPON_ACCESSORY[arm.model], arm.model).toBe(family[arm.type]);
      const spec = WEAPON_VFX[arm.model];
      expect(spec?.tier, arm.model).toBe(arm.rarity);
      expect(spec.name).toBe(arm.name);
      expect(spec.type).toBe(arm.type);
      expect(weaponSkinSwingTrail(arm.skin, 'melee'), arm.skin).not.toBeNull();
    }
    // the maul is a two-hander on the one-hand-sized hammer clamp: its scale sets maul length
    expect(WEAPON_GRIP_OVERRIDES.seamcaller_maul).toEqual({ scale: 1.5 });
  });

  it('gives each encounter its signature effect', () => {
    const fx = (model: string) => WEAPON_VFX[model].fx;
    const kinds = (model: string) => fx(model).map((c) => c.kind);
    // the quarry: amber seam-crystals like the crown's (the long faceted shard) orbit the head
    // under a ring of gold runes
    const shards = fx('seamcaller_maul').find((c) => c.kind === 'orbiters');
    expect(shards?.kind === 'orbiters' && shards.shape).toBe('ice');
    expect(shards?.kind === 'orbiters' && shards.seams).toBe(0);
    expect(kinds('seamcaller_maul')).toContain('runeRing');
    // the storm: wind ribbons that streak, lightning, and the storm eye
    const wind = fx('squallcrest').filter((c) => c.kind === 'aurora');
    expect(wind.length).toBe(2);
    for (const ribbon of wind) expect(ribbon.kind === 'aurora' && ribbon.streak).toBeGreaterThan(0);
    expect(kinds('squallcrest')).toContain('arcs');
    expect(kinds('squallcrest')).toContain('vortex');
    // the frost: ice orbiting the crown inside two turning rune rings
    const ice = fx('rimelight_staff').find((c) => c.kind === 'orbiters');
    expect(ice?.kind === 'orbiters' && ice.shape).toBe('ice');
    expect(kinds('rimelight_staff').filter((k) => k === 'runeRing')).toHaveLength(2);
    // the heat: no fire on the edges; embers rise off the blade and circle the guard, and
    // smoke that darkens
    expect(kinds('hearthbrand')).not.toContain('flames');
    expect(kinds('hearthbrand')).toContain('motes');
    expect(fx('hearthbrand').some((c) => c.kind === 'drift' && c.vel[1] > 0)).toBe(true);
    expect(fx('hearthbrand').some((c) => c.kind === 'drift' && c.blend === 'smoke')).toBe(true);
    // the four elements: four gem lights in turn, one slot each, plus each element's own effect
    const gems = fx('duskwick_staff').filter(
      (c): c is Extract<WeaponVfxComponent, { kind: 'coreSprite' }> =>
        c.kind === 'coreSprite' && c.seq !== undefined,
    );
    expect(gems.map((g) => g.seq?.slot)).toEqual([0, 1, 2, 3]);
    for (const gem of gems) expect(gem.seq?.of).toBe(4);
    expect(new Set(gems.map((g) => g.color)).size).toBe(4);
    for (const kind of ['aurora', 'runeRing', 'vortex', 'drift', 'motes'])
      expect(kinds('duskwick_staff'), kind).toContain(kind);
    // and its glow keeps each gem's own colour instead of grading all four to one tint
    expect(WEAPON_VFX.duskwick_staff.emissive?.tintMix).toBeLessThan(0.3);
  });

  it('narrows each glow window to its element', () => {
    expect(WEAPON_VFX.seamcaller_maul.emissive?.hue).toEqual([30, 55]);
    expect(WEAPON_VFX.squallcrest.emissive?.hue).toEqual([180, 215]);
    expect(WEAPON_VFX.rimelight_staff.emissive?.hue).toEqual([175, 215]);
    expect(WEAPON_VFX.hearthbrand.emissive?.hue).toEqual([8, 52]);
    expect(WEAPON_VFX.duskwick_staff.emissive?.hue).toEqual([8, 215]);
  });

  it('ships each GLB at its grip family height, the Armory card and the bag preview', () => {
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
      // grip at the origin; a sword under VAR_SWORD's 2.0 clamp (give or take its pommel), a
      // staff under VAR_STAFF's 2.4, the maul drawn at its scaled hammer clamp
      expect(lo, arm.model).toBeLessThan(0);
      const span = hi - lo;
      if (arm.type === 'mace') {
        const drawn = Math.min(span, VARIANT_GRIPS.VAR_HAMMER.maxHeight * 1.5);
        expect(drawn, arm.model).toBeGreaterThan(2.1);
        expect(drawn, arm.model).toBeLessThan(2.4);
      } else {
        expect(span, arm.model).toBeLessThanOrEqual(arm.type === 'staff' ? 2.4 : 2.05);
        expect(span, arm.model).toBeGreaterThan(arm.type === 'staff' ? 2.2 : 1.9);
      }
      expect(existsSync(join(ROOT, 'public', 'ui', 'store', 'armory', `${arm.skin}.webp`))).toBe(
        true,
      );
      expect(existsSync(join(ROOT, 'public', 'ui', 'weapons', `${arm.model}.jpg`))).toBe(true);
    }
  });
});
