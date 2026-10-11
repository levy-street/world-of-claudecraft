import { describe, expect, it } from 'vitest';
import { attuneAlliedHearthstone, DAWN_STANDARD_RADIUS } from '../src/sim/content/faction_rewards';
import { FACTION_HUB_LANDINGS } from '../src/sim/content/faction_vendors';
import { DUNGEON_X_THRESHOLD, ITEMS, MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';

describe('Allied Faction World Quest Rewards & Toys', () => {
  describe('Allied Hearthstone (allied_hearthstone)', () => {
    it('cannot be used while in combat or dead', () => {
      const sim = new Sim({ seed: 101, playerClass: 'paladin', autoEquip: false });
      const meta = sim.meta(sim.playerId)!;
      sim.addItem('allied_hearthstone', 1);
      meta.alliedHearthstoneAttunement = 'church_order';

      // Dead test: useItem returns without teleporting
      sim.player.dead = true;
      const origPos = { ...sim.player.pos };
      sim.drainEvents();
      sim.useItem('allied_hearthstone');
      expect(sim.player.pos.x).toBe(origPos.x);
      expect(sim.player.pos.z).toBe(origPos.z);

      // In combat test: emits error event
      sim.player.dead = false;
      sim.player.inCombat = true;
      sim.drainEvents();
      sim.useItem('allied_hearthstone');
      expect(
        sim
          .drainEvents()
          .some((e) => e.type === 'error' && e.text.includes("can't do that while in combat")),
      ).toBe(true);
    });

    it('attunes to faction hubs and teleports player out of combat on a 15m cooldown', () => {
      const sim = new Sim({ seed: 102, playerClass: 'mage', autoEquip: false });
      const meta = sim.meta(sim.playerId)!;
      sim.addItem('allied_hearthstone', 1);

      // Position player far away from any hub
      sim.player.pos = { x: 50, y: 0, z: 50 };

      // Attune to Church Order (Eastbrook Vale)
      const success = attuneAlliedHearthstone(sim.ctx, sim.player, meta, 'church_order');
      expect(success).toBe(true);
      expect(meta.alliedHearthstoneAttunement).toBe('church_order');

      // Use hearthstone: starts 10-second cast
      sim.drainEvents();
      sim.useItem('allied_hearthstone');
      expect(sim.player.castingAbility).toBe('allied_hearthstone');
      expect(sim.player.castRemaining).toBe(10);

      // Complete the 10-second cast (20 ticks per second = 200 ticks)
      for (let i = 0; i < 201; i++) sim.tick();

      // Check player was teleported to Eastbrook Vale landing
      const eastbrookLanding = FACTION_HUB_LANDINGS.church_order;
      expect(sim.player.pos.x).toBeCloseTo(eastbrookLanding.x, 0.1);
      expect(sim.player.pos.z).toBeCloseTo(eastbrookLanding.z, 0.1);

      // 15-minute cooldown (900 seconds)
      expect(meta.alliedHearthstoneReadyAt).toBeCloseTo(sim.time + 900, 0.1);

      // Subsequent use is refused while on cooldown
      sim.drainEvents();
      sim.useItem('allied_hearthstone');
      expect(
        sim.drainEvents().some((e) => e.type === 'error' && e.text.includes('not ready yet')),
      ).toBe(true);

      // Advance time past cooldown and test movement cancellation
      sim.time += 901;
      sim.useItem('allied_hearthstone');
      expect(sim.player.castingAbility).toBe('allied_hearthstone');
      // Moving cancels cast
      meta.moveInput.forward = true;
      sim.tick();
      expect(sim.player.castingAbility).toBeNull();
      meta.moveInput.forward = false;

      // Attune to Rift Watch (Drifthaven) and successfully finish cast
      attuneAlliedHearthstone(sim.ctx, sim.player, meta, 'rift_watch');
      sim.useItem('allied_hearthstone');
      for (let i = 0; i < 201; i++) sim.tick();

      const riftLanding = FACTION_HUB_LANDINGS.rift_watch;
      expect(sim.player.pos.x).toBeCloseTo(riftLanding.x, 0.1);
      expect(sim.player.pos.z).toBeCloseTo(riftLanding.z, 0.1);
    });
  });

  describe('Allied Vanguard Duffel (allied_vanguard_duffel)', () => {
    it('is a 16-slot unique bag that prevents duplicate purchasing and duplicate equipping', () => {
      const sim = new Sim({ seed: 103, playerClass: 'warrior', autoEquip: false });
      const meta = sim.meta(sim.playerId)!;
      meta.copper = 500_000;
      meta.factions.church_order = 15_000; // Vanguard standing (>= 13k)
      meta.factionCurrencies.church_order = 200; // Tier 4 duffel costs 100 crests

      const def = ITEMS.allied_vanguard_duffel;
      expect(def).toBeDefined();
      expect(def.bagSlots).toBe(16);
      expect(def.unique).toBe(true);

      const qm = [...sim.entities.values()].find(
        (e) => e.templateId === 'npc_church_order_quartermaster',
      )!;
      sim.player.pos.x = qm.pos.x;
      sim.player.pos.z = qm.pos.z;

      // Buy first bag
      sim.buyItem(qm.id, 'allied_vanguard_duffel');
      expect(sim.countItem('allied_vanguard_duffel')).toBe(1);

      // Attempt to buy second bag -> refused due to unique constraint
      sim.drainEvents();
      sim.buyItem(qm.id, 'allied_vanguard_duffel');
      expect(sim.countItem('allied_vanguard_duffel')).toBe(1);
      expect(
        sim
          .drainEvents()
          .some(
            (e) => e.type === 'error' && e.text.includes('You can only carry one of that item.'),
          ),
      ).toBe(true);

      // Equip first bag into slot 0
      sim.equipBag('allied_vanguard_duffel', 0);
      expect(meta.bags[0]).toBe('allied_vanguard_duffel');

      // Even if another bag was added directly to inventory, player cannot equip it into slot 1
      sim.addItem('allied_vanguard_duffel', 1);
      sim.drainEvents();
      sim.equipBag('allied_vanguard_duffel', 1);
      expect(meta.bags[1]).toBeNull();
      expect(
        sim
          .drainEvents()
          .some((e) => e.type === 'error' && e.text.includes('You can only equip one of those.')),
      ).toBe(true);
    });
  });

  describe('Rift Feather Glider (rift_feather_glider)', () => {
    it('grants slow fall aura, clamps downward motion, and cancels on landing or combat', () => {
      const sim = new Sim({ seed: 104, playerClass: 'rogue', autoEquip: false });
      const meta = sim.meta(sim.playerId)!;
      sim.addItem('rift_feather_glider', 1);

      // Using glider grants slow fall aura
      sim.useItem('rift_feather_glider');
      expect(sim.player.auras.some((a) => a.id === 'rift_feather_glider')).toBe(true);
      expect(meta.riftGliderReadyAt).toBe(sim.time + 120);

      // Test physics clamp in player motion
      sim.player.vy = -10; // Rapid fall
      sim.player.pos.y = 100;
      sim.player.onGround = false;
      sim.tick();

      // Downward velocity must be clamped to -2.5 yd/s max fall speed
      expect(sim.player.vy).toBeGreaterThanOrEqual(-2.5);

      // Landing on the ground cancels the glider aura
      sim.player.pos.y = 0;
      sim.player.onGround = true;
      sim.tick();
      expect(sim.player.auras.some((a) => a.id === 'rift_feather_glider')).toBe(false);

      // Combat cancels glider aura
      sim.time += 121;
      sim.player.pos.y = 50;
      sim.player.onGround = false;
      sim.useItem('rift_feather_glider');
      expect(sim.player.auras.some((a) => a.id === 'rift_feather_glider')).toBe(true);

      sim.player.inCombat = true;
      sim.tick();
      expect(sim.player.auras.some((a) => a.id === 'rift_feather_glider')).toBe(false);
    });
  });

  describe('Clockwork Target Dummy (clockwork_target_dummy)', () => {
    it('spawns a 2-min training dummy in the open world, but is rejected in instances/dungeons', () => {
      const sim = new Sim({ seed: 105, playerClass: 'hunter', autoEquip: false });
      const meta = sim.meta(sim.playerId)!;
      sim.addItem('clockwork_target_dummy', 1);

      // In open world, deploy dummy
      sim.player.pos = { x: -200, y: 0, z: 400 };
      sim.useItem('clockwork_target_dummy');

      const dummy = [...sim.entities.values()].find((e) => e.name === 'Clockwork Target Dummy');
      expect(dummy).toBeDefined();
      expect(dummy?.kind).toBe('mob');
      expect(dummy?.hardDespawnTimer).toBe(120);
      expect(meta.targetDummyReadyAt).toBe(sim.time + 300);

      // In dungeon (x > DUNGEON_X_THRESHOLD), must be rejected
      sim.time += 301;
      sim.player.pos.x = DUNGEON_X_THRESHOLD + 500;
      sim.drainEvents();
      sim.useItem('clockwork_target_dummy');
      expect(
        sim.drainEvents().some((e) => e.type === 'error' && e.text.includes('open world')),
      ).toBe(true);
    });
  });

  describe('Dawn Battle Standard (dawn_battle_standard)', () => {
    it('plants standard for 5 min, buffs out-of-combat regen, and grants Blessing of the Dawn after 10s', () => {
      const sim = new Sim({ seed: 106, playerClass: 'priest', autoEquip: false });
      const meta = sim.meta(sim.playerId)!;
      sim.addItem('dawn_battle_standard', 1);

      sim.player.pos = { x: -100, y: 0, z: 200 };
      sim.player.hp = 50;
      sim.player.maxHp = 200;
      sim.player.resource = 50;
      sim.player.maxResource = 200;

      // Plant standard
      sim.useItem('dawn_battle_standard');
      const standard = [...sim.entities.values()].find(
        (e) => e.templateId === 'dawn_battle_standard',
      );
      expect(standard).toBeDefined();
      expect(standard?.hardDespawnTimer).toBe(300);
      expect(meta.dawnStandardReadyAt).toBe(sim.time + 300);

      // 200 ticks = 10.0 seconds (each tick DT = 0.05s; every 40 ticks = 2s regen pulse)
      for (let i = 0; i < 200; i++) {
        sim.tick();
      }

      // Check Blessing of the Dawn was granted (+5 Stamina, 15 min duration)
      const blessing = sim.player.auras.find((a) => a.id === 'blessing_of_the_dawn');
      expect(blessing).toBeDefined();
      expect(blessing?.value).toBe(5);
      expect(blessing?.duration).toBe(900);

      // Moving out of radius resets accumulation
      sim.player.pos = { x: -100 + DAWN_STANDARD_RADIUS + 10, y: 0, z: 200 };
      for (let i = 0; i < 40; i++) {
        sim.tick();
      }
      expect(meta.dawnStandardSeconds).toBe(0);
    });
  });

  describe('Faction Recipes & Consumable Utilities', () => {
    it('crafts and quaffs Elixir of Mana Regeneration (+6 Spirit for 1h)', () => {
      const sim = new Sim({ seed: 107, playerClass: 'mage', autoEquip: false });
      const initialSpi = sim.player.stats.spi;

      sim.addItem('elixir_of_mana_regeneration', 1);
      sim.useItem('elixir_of_mana_regeneration');

      const aura = sim.player.auras.find((a) => a.id === 'elixir_mana_regeneration');
      expect(aura).toBeDefined();
      expect(aura?.value).toBe(6);
      expect(aura?.duration).toBe(3600);
      expect(sim.player.stats.spi).toBe(initialSpi + 6);
    });

    it('quaffs Potion of Invisibility for 6s stealth', () => {
      const sim = new Sim({ seed: 108, playerClass: 'rogue', autoEquip: false });
      sim.addItem('potion_of_invisibility', 1);
      sim.useItem('potion_of_invisibility');

      const aura = sim.player.auras.find((a) => a.id === 'invisibility');
      expect(aura).toBeDefined();
      expect(aura?.kind).toBe('stealth');
      expect(aura?.duration).toBe(6);
    });

    it('applies Reinforced Armor Kit (+12 Armor for 1h)', () => {
      const sim = new Sim({ seed: 109, playerClass: 'warrior', autoEquip: false });
      const initialArmor = sim.player.stats.armor;

      sim.addItem('reinforced_armor_kit', 1);
      sim.useItem('reinforced_armor_kit');

      const aura = sim.player.auras.find((a) => a.id === 'reinforced_armor_patch');
      expect(aura).toBeDefined();
      expect(aura?.value).toBe(12);
      expect(sim.player.stats.armor).toBe(initialArmor + 12);
    });

    it('applies Dense Sharpening Stone to main hand weapon (+6 AP for 30m)', () => {
      const sim = new Sim({ seed: 110, playerClass: 'warrior', autoEquip: false });
      const meta = sim.meta(sim.playerId)!;

      // Unequip weapon to test requirement
      meta.equipment.mainhand = undefined;
      sim.addItem('dense_sharpening_stone', 2);
      sim.drainEvents();
      sim.useItem('dense_sharpening_stone');
      expect(
        sim.drainEvents().some((e) => e.type === 'error' && e.text.includes('main hand weapon')),
      ).toBe(true);

      // Equip weapon and use stone
      sim.addItem('worn_sword', 1);
      sim.equipItemToSlot('worn_sword', 'mainhand');
      expect(meta.equipment.mainhand).toBe('worn_sword');

      const initialAp = sim.player.attackPower;
      sim.useItem('dense_sharpening_stone');
      const aura = sim.player.auras.find((a) => a.id === 'dense_sharpening_stone');
      expect(aura).toBeDefined();
      expect(aura?.value).toBe(6);
      expect(sim.player.attackPower).toBe(initialAp + 6);
    });

    it('detonates Clockwork Shock Bomb dealing nature damage AoE on a 1m cooldown', () => {
      const sim = new Sim({ seed: 111, playerClass: 'warrior', autoEquip: false });
      const meta = sim.meta(sim.playerId)!;
      sim.addItem('clockwork_shock_bomb', 2);

      // Spawn a target dummy in front of player
      sim.player.pos = { x: 0, y: 0, z: 0 };
      sim.player.facing = 0; // Forward is +Z
      const dummy = createMob(sim.nextId++, MOBS.training_dummy, 20, { x: 0, y: 0, z: 5 });
      sim.addEntity(dummy);
      const initialHp = dummy.hp;

      sim.useItem('clockwork_shock_bomb');
      expect(dummy.hp).toBeLessThan(initialHp);
      expect(meta.shockBombReadyAt).toBe(sim.time + 60);

      // Second use within 1 min is on cooldown
      sim.drainEvents();
      sim.useItem('clockwork_shock_bomb');
      expect(
        sim.drainEvents().some((e) => e.type === 'error' && e.text.includes('not ready yet')),
      ).toBe(true);
    });
  });
});
