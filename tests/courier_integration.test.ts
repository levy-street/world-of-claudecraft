import { describe, expect, it } from 'vitest';
import { CLASSES } from '../src/sim/content/classes';
import { courierSlotFingerprint } from '../src/sim/courier';
import { BUILTIN_WORLD, QUESTS } from '../src/sim/data';
import { perfectMembershipArmour } from '../src/sim/membership_armour_progression';
import {
  bagOwnedMounts,
  mountOwned,
  ownedMounts,
  summonMountItem,
  updateMountTransition,
} from '../src/sim/mounts';
import { interactNpcForQuests } from '../src/sim/quest_npc_interaction';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Aura, PlayerClass } from '../src/sim/types';

const world = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {
    bursar_fernando: BUILTIN_WORLD.npcs.bursar_fernando,
    [QUESTS.q_prof_intro.giverNpcId]: BUILTIN_WORLD.npcs[QUESTS.q_prof_intro.giverNpcId],
  },
  groundObjects: [],
};
const makeSim = () => new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true, world });

describe('courier live simulation integration', () => {
  it('keeps a mount owned and ridden while its reins travel to and from the bank', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Rider');
    const meta = sim.players.get(pid)!;
    const player = sim.entities.get(pid)!;
    const ctx = (sim as unknown as { ctx: SimContext }).ctx;
    const banker = sim.entities.get(ctx.bankerIds[0])!;
    banker.pos.x = player.pos.x + 17.5;
    banker.pos.z = player.pos.z;
    sim.setMembership(pid, 60);
    meta.ridingTrained = true;
    sim.addItem('reins_valorsteed', 1, pid);
    summonMountItem(ctx, pid, 'valorsteed');
    for (let i = 0; i < 32; i++) updateMountTransition(ctx, player, false);
    expect(player.mountKey).toBe('valorsteed');
    sim.castAbility('courier', pid);
    const index = meta.inventory.findIndex((s) => s.itemId === 'reins_valorsteed');
    sim.courierDispatch(
      {
        deposits: [{ index, fingerprint: courierSlotFingerprint(meta.inventory[index]) }],
        withdrawals: [],
      },
      pid,
    );
    expect(meta.courier?.cargo[0].itemId).toBe('reins_valorsteed');
    expect(mountOwned(meta, 'valorsteed')).toBe(true);
    expect(ownedMounts(meta)).toContain('valorsteed');
    expect(bagOwnedMounts(meta.inventory)).not.toContain('valorsteed');
    for (let i = 0; i < 42; i++) {
      sim.tick();
      expect(player.mountKey).toBe('valorsteed');
    }
    expect(meta.courier?.phase).toBe('ready');
    const bankIndex = meta.bank.inventory.findIndex((s) => s.itemId === 'reins_valorsteed');
    sim.courierDispatch(
      {
        deposits: [],
        withdrawals: [
          { index: bankIndex, fingerprint: courierSlotFingerprint(meta.bank.inventory[bankIndex]) },
        ],
      },
      pid,
    );
    for (let i = 0; i < 21; i++) sim.tick();
    expect(meta.courier?.phase).toBe('returning');
    expect(meta.courier?.cargo[0].itemId).toBe('reins_valorsteed');
    expect(mountOwned(meta, 'valorsteed')).toBe(true);
    expect(ownedMounts(meta)).toContain('valorsteed');
    expect(bagOwnedMounts(meta.inventory)).not.toContain('valorsteed');
    for (let i = 0; i < 21; i++) {
      sim.tick();
      expect(player.mountKey).toBe('valorsteed');
    }
    expect(sim.countItem('reins_valorsteed', pid)).toBe(1);
    expect(bagOwnedMounts(meta.inventory)).toContain('valorsteed');
  });
  it('quest acceptance and giver recovery never duplicate a starter tool in courier custody', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Member');
    const meta = sim.players.get(pid)!;
    const player = sim.entities.get(pid)!;
    const giver = [...sim.entities.values()].find(
      (e) => e.templateId === QUESTS.q_prof_intro.giverNpcId,
    )!;
    player.pos = { ...giver.pos };
    player.prevPos = { ...giver.pos };
    sim.setMembership(pid, 60);
    sim.acceptQuest('q_prof_intro', pid);
    expect(sim.countItem('copper_mining_pick', pid)).toBe(1);
    sim.castAbility('courier', pid);
    const index = meta.inventory.findIndex((s) => s.itemId === 'copper_mining_pick');
    sim.courierDispatch(
      {
        deposits: [{ index, fingerprint: courierSlotFingerprint(meta.inventory[index]) }],
        withdrawals: [],
      },
      pid,
    );
    expect(meta.courier?.cargo[0].itemId).toBe('copper_mining_pick');
    sim.abandonQuest('q_prof_intro', pid);
    sim.acceptQuest('q_prof_intro', pid);
    expect(meta.questLog.has('q_prof_intro')).toBe(true);
    expect(sim.countItem('copper_mining_pick', pid)).toBe(0);
    interactNpcForQuests((sim as unknown as { ctx: SimContext }).ctx, giver, meta);
    expect(sim.countItem('copper_mining_pick', pid)).toBe(0);
    expect(meta.courier!.cargo.filter((s) => s.itemId === 'copper_mining_pick')).toHaveLength(1);
  });
  it.each(Object.keys(CLASSES) as PlayerClass[])(
    'grants an action-bar spell for %s, opens only its owner and removes it on expiry',
    (cls) => {
      const sim = makeSim();
      const pid = sim.addPlayer(cls, 'Member');
      const other = sim.addPlayer('warrior', 'Other');
      const meta = sim.players.get(pid)!;
      expect(meta.known.some((k) => k.def.id === 'courier')).toBe(false);
      sim.setMembership(pid, 0.1);
      const slot = meta.known.findIndex((k) => k.def.id === 'courier');
      expect(slot).toBeGreaterThanOrEqual(0);
      sim.events = [];
      sim.castAbilityBySlot(slot, pid);
      expect(sim.courierInfoFor(pid)?.phase).toBe('ready');
      expect(sim.courierInfoFor(other)).toBeNull();
      expect(sim.events.filter((e) => e.type === 'courier')).toEqual([
        { type: 'courier', playerId: pid, pid },
      ]);
      sim.tick();
      sim.tick();
      expect(meta.known.some((k) => k.def.id === 'courier')).toBe(false);
      sim.events = [];
      sim.castAbility('courier', pid);
      expect(sim.events.some((e) => e.type === 'courier')).toBe(false);
      expect(sim.courierInfoFor(pid)?.active).toBe(false);
      sim.setMembership(pid, 30);
      expect(meta.known.filter((k) => k.def.id === 'courier')).toHaveLength(1);
      sim.castAbility('courier', pid);
      expect(sim.events.some((e) => e.type === 'courier' && e.pid === pid)).toBe(true);
    },
  );

  it('honours dead, controlled, busy and global-cooldown cast guards', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('mage', 'Member');
    const player = sim.entities.get(pid)!;
    sim.setMembership(pid, 30);
    player.dead = true;
    sim.castAbility('courier', pid);
    expect(sim.courierInfoFor(pid)).toBeNull();
    player.dead = false;
    player.auras.push({ kind: 'stun' } as Aura);
    sim.castAbility('courier', pid);
    expect(sim.courierInfoFor(pid)).toBeNull();
    player.auras = [];
    player.castingAbility = 'fireball';
    player.castRemaining = 2;
    sim.castAbility('courier', pid);
    expect(sim.courierInfoFor(pid)).toBeNull();
    player.castingAbility = null;
    player.castRemaining = 0;
    player.gcdRemaining = 1;
    sim.castAbility('courier', pid);
    expect(sim.courierInfoFor(pid)).toBeNull();
    player.gcdRemaining = 0;
    sim.castAbility('courier', pid);
    expect(sim.courierInfoFor(pid)?.phase).toBe('ready');
  });

  it('perfects level-20 armour while in transit, persists it and never duplicates a claim', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Member');
    const meta = sim.players.get(pid)!;
    sim.setMembership(pid, 60);
    sim.setPlayerLevel(19, pid);
    sim.castAbility('courier', pid);
    const index = meta.inventory.findIndex((s) => s.itemId === 'membership_helmet');
    sim.courierDispatch(
      {
        deposits: [{ index, fingerprint: courierSlotFingerprint(meta.inventory[index]) }],
        withdrawals: [],
      },
      pid,
    );
    expect(meta.courier?.phase).toBe('outbound');
    expect(meta.courier?.cargo[0].instance?.perfected).not.toBe(true);
    const before = meta.courier!.revision;
    sim.setPlayerLevel(20, pid);
    expect(meta.courier?.cargo[0].instance?.perfected).toBe(true);
    expect(meta.courier?.revision).toBe(before + 1);
    const wireRevision = meta.wireRev;
    perfectMembershipArmour(meta, 20);
    expect(meta.courier?.revision).toBe(before + 1);
    expect(meta.wireRev).toBe(wireRevision);
    sim.claimMembershipArmour(pid);
    const copies = [...meta.inventory, ...meta.bank.inventory, ...meta.courier!.cargo].filter(
      (s) => s.itemId === 'membership_helmet',
    );
    expect(copies).toHaveLength(1);
    const saved = sim.serializeCharacter(pid)!;
    expect(saved.courier?.cargo[0].instance?.perfected).toBe(true);
    const restored = makeSim();
    const next = restored.addPlayer('warrior', 'Restored', { state: saved });
    expect(restored.players.get(next)?.courier?.cargo).toEqual(meta.courier!.cargo);
    expect(restored.players.get(next)?.courier?.phase).toBe('outbound');
    expect(restored.membershipActiveFor(next)).toBe(false);
  });
});
