import { describe, expect, it } from 'vitest';
import { TREASURE_MAP_ITEM_IDS, TREASURE_SITES_BY_ID } from '../src/sim/content/treasure_maps';
import { isRiftPos } from '../src/sim/data';
import { leaveRift, updateRiftInstances, updateRiftTriggers } from '../src/sim/rift/runs';
import { Sim } from '../src/sim/sim';
import { finishVaultAttempt, updateVaultPortals } from '../src/sim/treasure_vault';
import { VAULT_LIFETIME_MS, VAULT_LOOT_LIFETIME_MS } from '../src/sim/vault_lifecycle';

function fixture() {
  let now = 1_000_000;
  const sim = new Sim({
    seed: 4242,
    playerClass: 'warrior',
    autoEquip: false,
    devCommands: true,
    lockoutNowMs: () => now,
  });
  sim.chat('/dev level 20');
  sim.tick();
  const meta = sim.meta(sim.playerId)!;
  meta.characterId = 8001;
  sim.addItem(TREASURE_MAP_ITEM_IDS.rare, 2);
  sim.useItem(TREASURE_MAP_ITEM_IDS.rare);
  const site = TREASURE_SITES_BY_ID[meta.treasureMap!.siteId];
  sim.player.pos = sim.groundPos(site.x + 2, site.z - 2);
  sim.useItem(TREASURE_MAP_ITEM_IDS.rare);
  const portal = [...sim.entities.values()].find((e) => e.vaultAttemptId === '8001:1')!;
  const deadline = now + VAULT_LIFETIME_MS;
  const enter = () => {
    sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, sim.playerId, undefined, portal);
    return sim.riftInstances.find((inst) => inst.vault?.attemptId === '8001:1')!;
  };
  const sweep = () => {
    updateRiftInstances(sim.ctx);
    sim.tickCount = 5;
    updateVaultPortals(sim.ctx);
  };
  return {
    sim,
    meta,
    portal,
    deadline,
    enter,
    sweep,
    setNow: (value: number) => {
      now = value;
    },
  };
}

describe('vault lifetime', () => {
  it('does not unload a killed boss room using time accumulated while empty before the kill', () => {
    const f = fixture();
    f.sim.cfg.vaultRewardNeedsSave = true;
    const inst = f.enter();
    leaveRift(f.sim.ctx, f.sim.playerId);
    inst.emptyFor = 899;
    f.sim.entities.get(inst.bossId!)!.dead = true;
    f.sim.tickCount = 20;
    updateRiftInstances(f.sim.ctx);
    expect(inst.outcome).toBe('won');
    f.sim.tickCount = 40;
    updateRiftInstances(f.sim.ctx);
    expect(inst.partyKey).not.toBeNull();
    expect(f.sim.drainEvents()).toContainEqual(
      expect.objectContaining({ type: 'treasureVaultOutcomePending' }),
    );
  });

  it('preserves rewards for a kill just before expiry and before the next reward sweep', () => {
    const f = fixture();
    f.sim.cfg.vaultRewardNeedsSave = true;
    const inst = f.enter();
    f.setNow(f.deadline - 50);
    f.sim.entities.get(inst.bossId!)!.dead = true;
    f.sim.tickCount = 19;
    updateRiftInstances(f.sim.ctx);
    expect(inst.rewarded).toBe(false);
    f.setNow(f.deadline);
    f.sweep();
    expect(inst.partyKey).toBeNull();
    expect(f.sim.drainEvents()).toContainEqual(
      expect.objectContaining({
        type: 'treasureVaultOutcomePending',
        bossKilledAtMs: f.deadline - 50,
      }),
    );
  });

  it('allows an owner with an outstanding map to help another party member', () => {
    const f = fixture();
    const guest = f.sim.addPlayer('warrior', 'Other owner', { characterId: 8002 });
    f.sim.setPlayerLevel(20, guest);
    f.sim.partyInvite(guest, f.sim.playerId);
    f.sim.partyAccept(guest);
    const guestMeta = f.sim.meta(guest)!;
    guestMeta.vaultAttempt = { ...f.meta.vaultAttempt!, id: '8002:1' };
    f.sim.enterRift(f.portal.riftSeed!, f.portal.riftBaseLevel!, guest, undefined, f.portal);
    expect(isRiftPos(f.sim.entities.get(guest)!.pos.x)).toBe(true);
    expect(guestMeta.vaultAttempt.id).toBe('8002:1');
    leaveRift(f.sim.ctx, guest);
    f.sim.partyLeave(guest);
    const player = f.sim.entities.get(guest)!;
    player.pos = { ...f.portal.pos };
    player.riftReentryGraceUntil = 0;
    updateRiftTriggers(f.sim.ctx, player);
    expect(isRiftPos(player.pos.x)).toBe(false);
  });

  it('evacuates dead players on expiry too', () => {
    const f = fixture();
    const inst = f.enter();
    f.sim.player.dead = true;
    f.sim.player.corpsePos = { ...f.sim.player.pos };
    f.setNow(f.deadline);
    f.sweep();
    expect(isRiftPos(f.sim.player.pos.x)).toBe(false);
    expect(isRiftPos(f.sim.player.corpsePos.x)).toBe(false);
    expect(inst.partyKey).toBeNull();
  });

  it('keeps an unentered portal until six hours, then releases the owner and portal', () => {
    const f = fixture();
    expect(f.meta.vaultAttempt?.expiresAtMs).toBe(f.deadline);
    f.setNow(f.deadline - 1);
    f.sweep();
    expect(f.sim.entities.has(f.portal.id)).toBe(true);
    f.sim.useItem(TREASURE_MAP_ITEM_IDS.rare);
    expect(f.meta.treasureMap).toBeNull();
    f.setNow(f.deadline);
    f.sweep();
    expect(f.sim.entities.has(f.portal.id)).toBe(false);
    expect(f.meta.vaultAttempt).toBeNull();
    f.sim.useItem(TREASURE_MAP_ITEM_IDS.rare);
    expect(f.meta.treasureMap).not.toBeNull();
  });

  it('expires an occupied run, removes its mobs, and returns its player outside', () => {
    const f = fixture();
    const inst = f.enter();
    const mobs = [...inst.mobIds];
    expect(isRiftPos(f.sim.player.pos.x)).toBe(true);
    f.setNow(f.deadline);
    f.sweep();
    expect(inst.partyKey).toBeNull();
    expect(inst.vault).toBeNull();
    expect(isRiftPos(f.sim.player.pos.x)).toBe(false);
    expect(mobs.some((id) => f.sim.entities.has(id))).toBe(false);
    expect(f.meta.vaultAttempt).toBeNull();
  });

  it('unloads an empty room without expiring the attempt or extending its deadline', () => {
    const f = fixture();
    const inst = f.enter();
    leaveRift(f.sim.ctx, inst.memberIds.values().next().value!);
    inst.emptyFor = 999;
    f.sim.tickCount = 20;
    updateRiftInstances(f.sim.ctx);
    expect(inst.partyKey).toBeNull();
    expect(f.meta.vaultAttempt?.expiresAtMs).toBe(f.deadline);
    expect(f.sim.entities.has(f.portal.id)).toBe(true);
    const reopened = f.enter();
    expect(reopened.vault?.expiresAtMs).toBe(f.deadline);
  });

  it('expires fifteen minutes after the kill even with pending rewards and a player inside', () => {
    const f = fixture();
    f.sim.cfg.vaultRewardNeedsSave = true;
    const inst = f.enter();
    const killedAt = 2_000_000;
    f.setNow(killedAt);
    f.sim.entities.get(inst.bossId!)!.dead = true;
    f.sim.tickCount = 20;
    updateRiftInstances(f.sim.ctx);
    const events = f.sim.drainEvents();
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'treasureVaultOutcomePending', bossKilledAtMs: killedAt }),
    );
    expect(f.meta.vaultAttempt?.expiresAtMs).toBe(killedAt + VAULT_LOOT_LIFETIME_MS);
    expect(inst.vault?.chest?.pendingSave).toBe(true);
    f.setNow(killedAt + VAULT_LOOT_LIFETIME_MS - 1);
    f.sweep();
    expect(inst.partyKey).not.toBeNull();
    f.setNow(killedAt + VAULT_LOOT_LIFETIME_MS);
    f.sweep();
    expect(inst.partyKey).toBeNull();
    expect(f.meta.vaultAttempt).toBeNull();
  });

  it('a late kill cannot extend the six-hour maximum, and reward commitment cannot clear early', () => {
    const f = fixture();
    const inst = f.enter();
    const killedAt = f.deadline - 60_000;
    f.setNow(killedAt);
    f.sim.entities.get(inst.bossId!)!.dead = true;
    updateRiftInstances(f.sim.ctx);
    finishVaultAttempt(f.sim.ctx, 8001, '8001:1', killedAt);
    expect(f.meta.vaultAttempt?.expiresAtMs).toBe(f.deadline);
    f.setNow(f.deadline);
    f.sweep();
    expect(f.meta.vaultAttempt).toBeNull();
  });

  it('preserves the absolute deadline through save/load and retires untimed legacy locks', () => {
    const f = fixture();
    const saved = f.sim.serializeCharacter(f.sim.playerId)!;
    const restored = new Sim({
      seed: 4242,
      playerClass: 'warrior',
      noPlayer: true,
      lockoutNowMs: () => f.deadline,
    });
    const pid = restored.addPlayer('warrior', 'Returned', { state: saved, characterId: 8001 });
    restored.tickCount = 5;
    updateVaultPortals(restored.ctx);
    expect(restored.meta(pid)?.vaultAttempt).toBeNull();
    expect(restored.meta(pid)?.vaultAttemptSeq).toBe(1);
    delete saved.worldQuests!.vaultAttempt!.expiresAtMs;
    const legacy = restored.addPlayer('warrior', 'Legacy', { state: saved, characterId: 8001 });
    updateVaultPortals(restored.ctx);
    expect(restored.meta(legacy)?.vaultAttempt).toBeNull();
  });
});
