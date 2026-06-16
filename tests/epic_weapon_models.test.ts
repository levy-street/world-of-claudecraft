import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { ClientWorld } from '../src/net/online';
import { resolveWeaponAttachments } from '../src/render/characters/weapon_attachments';
import { VISUALS } from '../src/render/characters/manifest';
import { wireEntity } from '../server/game';

describe('epic weapon models', () => {
  it('maps each epic weapon to its custom glb', () => {
    expect(ITEMS.fang_of_korzul.weaponModel).toBe('korzul_dagger');
    expect(ITEMS.staff_of_the_gravewyrm.weaponModel).toBe('gravewyrm_staff');
    expect(ITEMS.wyrmfang_greatblade.weaponModel).toBe('wyrmfang_1handed');
  });

  it('overrides class-default weapon attachments when an epic is equipped', () => {
    const rogue = resolveWeaponAttachments(VISUALS.player_rogue, 'fang_of_korzul');
    expect(rogue).toHaveLength(2);
    expect(rogue.every((a) => a.url === 'models/weapons/korzul_dagger.glb')).toBe(true);

    const mage = resolveWeaponAttachments(VISUALS.player_mage, 'staff_of_the_gravewyrm');
    expect(mage).toHaveLength(1);
    expect(mage[0].url).toBe('models/weapons/gravewyrm_staff.glb');

    const warrior = resolveWeaponAttachments(VISUALS.player_warrior, 'wyrmfang_greatblade');
    expect(warrior[0].url).toBe('models/weapons/wyrmfang_1handed.glb');
  });

  it('keeps class defaults for non-epic gear', () => {
    const warrior = resolveWeaponAttachments(VISUALS.player_warrior, 'worn_sword');
    expect(warrior[0].url).toBe('models/weapons/sword_1handed.glb');
  });

  it('preserves warlock spellbook when swapping the mainhand wand', () => {
    const warlock = resolveWeaponAttachments(VISUALS.player_warlock, 'staff_of_the_gravewyrm');
    expect(warlock).toHaveLength(2);
    expect(warlock[0].url).toBe('models/weapons/gravewyrm_staff.glb');
    expect(warlock[1].gripRef).toBe('Spellbook_open');
  });
});

describe('mainhand wire sync', () => {
  it('mirrors mainhand onto the player entity when equipping offline', () => {
    const sim = new Sim({ seed: 1, playerClass: 'rogue', playerName: 'Epic' });
    sim.addItem('fang_of_korzul', 1);
    sim.equipItem('fang_of_korzul');
    expect(sim.player.mainhand).toBe('fang_of_korzul');
  });

  it('includes mainhand in wire identity when set', () => {
    const sim = new Sim({ seed: 1, playerClass: 'warrior', playerName: 'Wire' });
    sim.addItem('wyrmfang_greatblade', 1);
    sim.equipItem('wyrmfang_greatblade');
    const wire = wireEntity(sim.player);
    expect(wire.mh).toBe('wyrmfang_greatblade');
  });

  it('applies peer mainhand from snapshot identity fields', () => {
    const client: ClientWorld = Object.create(ClientWorld.prototype);
    Object.assign(client, {
      playerId: 1,
      cfg: { seed: 1, playerClass: 'warrior' },
      entities: new Map(),
    });
    client.applySnapshot({
      t: 'snap', tick: 1, time: 0,
      self: { id: 1, k: 'player', tid: 'warrior', nm: 'Self', lv: 10, x: 0, y: 0, z: 0, f: 0, hp: 100, mhp: 100 },
      ents: [{
        id: 42, k: 'player', tid: 'rogue', nm: 'Peer', lv: 20, mh: 'fang_of_korzul',
        x: 5, y: 0, z: 5, f: 0, hp: 100, mhp: 100,
      }],
    });
    expect(client.entities.get(42)?.mainhand).toBe('fang_of_korzul');
  });
});
