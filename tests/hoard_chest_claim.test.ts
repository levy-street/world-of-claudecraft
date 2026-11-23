// The Buried Hoard reward chest on the ONLINE path, where the reward waits for a
// durable outcome before the chest may open (hoard_reward_chest.ts pendingSave).
// Live report: a guild group finished a hoard, the "Press F to claim spoils"
// prompt floated over an empty floor and F answered "Nothing to interact with":
// the chest stayed sealed (unlootable, so the renderer hides it and the press
// finds nothing) because the host never confirmed the outcome. The host's
// outcome write refused every clear with a guest (tests/server/
// vault_rewards_db.test.ts pins that SQL). These cases walk the sim half of the
// same path the server drives: a real map and portal, the real kill, the
// outcome the host would commit (fed through the real ledger validation), the
// confirmation, then every entrant's own press through the client's nearby
// scan, the renderer's visibility rule and the server's claim.
import { describe, expect, it } from 'vitest';
import { createVaultRewardsDb } from '../server/vault_rewards_db';
import { resolveNearbyInteractionCandidate } from '../src/game/nearby_interaction_core';
import { delveInteractableVisible } from '../src/render/delve_interactable_visibility_core';
import {
  TREASURE_MAP_ITEM_IDS,
  TREASURE_SITES_BY_ID,
  type TreasureMapRarity,
} from '../src/sim/content/treasure_maps';
import { riftInstanceOrigin } from '../src/sim/data';
import { DEV_HOARD_DESTINATIONS, devHoardDestination } from '../src/sim/dev/hoard_travel';
import {
  confirmHoardRewardChest,
  confirmHoardRewardClaim,
  HOARD_REWARD_CHEST_TEMPLATE,
} from '../src/sim/rift/hoard_reward_chest';
import { grantHoardReward } from '../src/sim/rift/hoard_reward_grant';
import { RIFT_RANK_BASE_LEVEL } from '../src/sim/rift/ranks';
import { generateRiftFloor, riftLiftAt } from '../src/sim/rift/rift_gen';
import type { RiftInstance } from '../src/sim/rift/types';
import { Sim } from '../src/sim/sim';
import type { Entity, PlayerClass, SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

type Pending = Extract<SimEvent, { type: 'treasureVaultOutcomePending' }>;

/** What the server's reward host does with the sim's two vault events, minus
 *  Postgres: validate and "commit" the outcome through the real ledger code, then
 *  open the chest; pay a requested claim exactly as the direct-claim host does. */
class RewardHost {
  readonly outcomes: Pending[] = [];
  readonly grants = new Map<number, number>();
  private readonly db = createVaultRewardsDb(fakeLedgerPool(), 'ChestClaimRealm');

  constructor(private readonly sim: Sim) {}

  async pump(events: readonly SimEvent[]): Promise<void> {
    for (const event of events) {
      if (event.type === 'treasureVaultOutcomePending') {
        this.outcomes.push(event);
        await this.db.commitVaultOutcome({
          attemptId: event.attemptId,
          ownerCharacterId: event.ownerCharacterId,
          claims: event.claims.map((claim) => ({ ...claim, mailDueAt: new Date(0) })),
        });
        confirmHoardRewardChest(this.sim.ctx, event.attemptId);
      } else if (event.type === 'treasureVaultClaimRequested' && event.pid !== undefined) {
        const outcome = this.outcomes.find((o) => o.attemptId === event.attemptId);
        const claim = outcome?.claims.find((c) => c.characterId === event.characterId);
        const inst = this.sim.riftInstances.find((i) => i.vault?.attemptId === event.attemptId);
        if (!outcome || !claim || !inst?.vault) throw new Error('claim without an outcome');
        const granted = grantHoardReward(this.sim.ctx, event.pid, inst.vault.rarity, {
          items: claim.items,
          copper: claim.copper,
          capped: claim.items.length === 0 && claim.copper === 0,
        });
        expect(granted).toBe(true);
        this.grants.set(event.characterId, (this.grants.get(event.characterId) ?? 0) + 1);
        confirmHoardRewardClaim(this.sim.ctx, event.attemptId, event.pid);
      }
    }
  }

  async tick(ticks = 1): Promise<void> {
    for (let i = 0; i < ticks; i++) await this.pump(this.sim.tick());
    await this.pump(this.sim.drainEvents());
  }
}

/** A pool that answers the outcome transaction the way an empty ledger does. */
function fakeLedgerPool() {
  const client = {
    async query(text: string) {
      if (/INSERT INTO vault_reward_outcomes/.test(text)) return { rowCount: 1, rows: [{}] };
      if (/SELECT existing_payouts/.test(text))
        return { rowCount: 1, rows: [{ existing_payouts: 0 }] };
      return { rowCount: 0, rows: [] };
    },
    release() {},
  };
  return {
    async connect() {
      return client;
    },
    async query() {
      return { rowCount: 0, rows: [] };
    },
  } as unknown as Parameters<typeof createVaultRewardsDb>[0];
}

let nextCharacterId = 9100;

function joinPlayer(sim: Sim, cls: PlayerClass, name: string): number {
  const pid = sim.addPlayer(cls, name, { characterId: nextCharacterId++ });
  sim.setPlayerLevel(20, pid);
  return pid;
}

/** Read a real map, dig on its X (an online portal: attempt id, owner snapshot),
 *  then point that portal at the room `boss` holds for `rarity`. */
function openHoard(boss: string, rarity: TreasureMapRarity, partySize = 1) {
  const sim = new Sim({ seed: 4242, playerClass: 'warrior', autoEquip: true, devCommands: true });
  sim.cfg.vaultOpenNeedsSave = false;
  sim.cfg.vaultRewardNeedsSave = true;
  const owner = sim.playerId;
  sim.meta(owner)!.characterId = nextCharacterId++;
  sim.setPlayerLevel(20, owner);
  const members = [owner];
  const classes: PlayerClass[] = ['hunter', 'warlock', 'priest', 'mage'];
  for (let i = 1; i < partySize; i++) {
    const pid = joinPlayer(sim, classes[i - 1], `Member${i}`);
    sim.partyInvite(pid, owner);
    sim.partyAccept(pid);
    members.push(pid);
  }
  const itemId = TREASURE_MAP_ITEM_IDS[rarity];
  sim.addItem(itemId, 1);
  sim.useItem(itemId);
  const site = TREASURE_SITES_BY_ID[sim.meta(owner)!.treasureMap!.siteId];
  for (const pid of members) {
    const e = sim.entities.get(pid)!;
    e.pos = {
      x: site.x + 2,
      y: terrainHeight(site.x + 2, site.z - 2, sim.cfg.seed),
      z: site.z - 2,
    };
  }
  sim.useItem(itemId);
  const portal = [...sim.entities.values()].find(
    (e) =>
      e.vaultAttemptId !== undefined && e.vaultOwnerCharacterId === sim.meta(owner)!.characterId,
  );
  if (!portal) throw new Error('no portal');
  const destination = devHoardDestination(boss, rarity);
  if (!destination) throw new Error(`no ${rarity} ${boss} hoard`);
  portal.riftSeed = destination.seed;
  portal.riftBaseLevel = RIFT_RANK_BASE_LEVEL[destination.tier];
  sim.drainEvents();
  const host = new RewardHost(sim);
  return { sim, host, owner, members, portal };
}

function enter(sim: Sim, portal: Entity, pid: number): void {
  sim.enterRift(portal.riftSeed!, portal.riftBaseLevel!, pid, undefined, portal);
}

function runOf(sim: Sim, portal: Entity): RiftInstance {
  const inst = sim.riftInstances.find(
    (i) => i.partyKey !== null && i.vault?.attemptId === portal.vaultAttemptId,
  );
  if (!inst) throw new Error('no run');
  return inst;
}

/** Kill every mob of the room through the ordinary death path, boss last. */
async function clear(sim: Sim, host: RewardHost, inst: RiftInstance, killer: number) {
  const player = sim.entities.get(killer)!;
  for (const id of [...inst.mobIds]) {
    const mob = sim.entities.get(id);
    if (mob && !mob.dead && id !== inst.bossId) sim.ctx.handleDeath(mob, player);
  }
  const boss = inst.bossId === null ? undefined : sim.entities.get(inst.bossId);
  if (!boss) throw new Error('no boss');
  sim.ctx.handleDeath(boss, player);
  await host.tick(45);
  const chestId = inst.vault?.chest?.entityId;
  const chest = chestId === undefined ? undefined : sim.entities.get(chestId);
  if (!chest) throw new Error('no chest');
  return chest;
}

/** One entrant walks up and presses F: what their client sees and sends. */
async function pressF(sim: Sim, host: RewardHost, pid: number, chest: Entity) {
  const player = sim.entities.get(pid)!;
  player.pos = { x: chest.pos.x, y: chest.pos.y, z: chest.pos.z - 2 };
  const visible = delveInteractableVisible(chest.templateId, chest.lootable);
  const candidate = resolveNearbyInteractionCandidate({
    player,
    playerId: pid,
    entities: sim.entities,
    questLog: sim.meta(pid)!.questLog,
    farmPatches: [],
  });
  const pressed = candidate?.kind === 'object' && candidate.id === chest.id;
  if (pressed) sim.pickUpObject(chest.id, pid);
  await host.tick(2);
  return { visible, pressed };
}

function expectPaidOnce(sim: Sim, host: RewardHost, pids: readonly number[]) {
  for (const pid of pids) {
    expect(host.grants.get(sim.meta(pid)!.characterId!)).toBe(1);
  }
}

describe('the online hoard chest opens for everyone the clear paid', () => {
  const rooms = DEV_HOARD_DESTINATIONS.flatMap((d) =>
    ('cave' in d && d.cave ? (['common', 'rare'] as const) : (['epic', 'legendary'] as const)).map(
      (rarity) => ({ boss: d.boss, rarity }),
    ),
  );

  it('walks every hoard boss room at every map rarity that digs it', () => {
    // The themed eight at epic and legendary, the four cave bosses at common and rare.
    expect(new Set(rooms.map((room) => room.boss)).size).toBe(DEV_HOARD_DESTINATIONS.length);
    expect(new Set(rooms.map((room) => room.rarity))).toEqual(
      new Set(['common', 'rare', 'epic', 'legendary']),
    );
    expect(rooms.length).toBe(DEV_HOARD_DESTINATIONS.length * 2);
  });

  it.each(rooms)('solo, $boss $rarity: visible, pressable, paid once', async ({ boss, rarity }) => {
    const { sim, host, owner, portal } = openHoard(boss, rarity);
    enter(sim, portal, owner);
    const inst = runOf(sim, portal);
    const chest = await clear(sim, host, inst, owner);
    expect(chest.templateId).toBe(HOARD_REWARD_CHEST_TEMPLATE);
    // It stands on the room's own floor (raised tier or not).
    const floor = generateRiftFloor(inst.seed, inst.baseLevel, inst.floorIndex);
    const origin = riftInstanceOrigin(inst.slot, inst.floorIndex);
    expect(chest.pos.y).toBeCloseTo(
      riftLiftAt(floor, chest.pos.x - origin.x, chest.pos.z - origin.z),
      3,
    );
    expect(host.outcomes).toHaveLength(1);
    const before = sim.meta(owner)!.inventory.length + sim.meta(owner)!.copper;
    expect(await pressF(sim, host, owner, chest)).toEqual({ visible: true, pressed: true });
    expectPaidOnce(sim, host, [owner]);
    expect(sim.meta(owner)!.inventory.length + sim.meta(owner)!.copper).toBeGreaterThan(before);
    // A second press pays nothing more.
    await pressF(sim, host, owner, chest);
    expectPaidOnce(sim, host, [owner]);
  });

  it('a party of three that walked in together each open it once', async () => {
    const { sim, host, owner, members, portal } = openHoard('mushroom', 'rare', 3);
    for (const pid of members) enter(sim, portal, pid);
    const inst = runOf(sim, portal);
    const chest = await clear(sim, host, inst, owner);
    expect(host.outcomes[0].claims).toHaveLength(3);
    for (const pid of members)
      expect(await pressF(sim, host, pid, chest)).toEqual({ visible: true, pressed: true });
    expectPaidOnce(sim, host, members);
  });

  it('a member who joined mid-run is paid without changing difficulty', async () => {
    const { sim, host, owner, portal } = openHoard('grask', 'epic');
    enter(sim, portal, owner);
    const inst = runOf(sim, portal);
    const headCount = inst.vault!.headCount;
    const late = joinPlayer(sim, 'mage', 'Latecomer');
    sim.partyInvite(late, owner);
    sim.partyAccept(late);
    enter(sim, portal, late);
    expect(inst.memberIds.has(late)).toBe(true);
    expect(inst.vault!.headCount).toBe(headCount);
    const chest = await clear(sim, host, inst, owner);
    for (const pid of [owner, late])
      expect(await pressF(sim, host, pid, chest)).toEqual({ visible: true, pressed: true });
    expectPaidOnce(sim, host, [owner, late]);
  });

  it('an entrant who stepped out before the kill can walk back in and open it', async () => {
    const { sim, host, owner, members, portal } = openHoard('bat', 'common', 2);
    for (const pid of members) enter(sim, portal, pid);
    const inst = runOf(sim, portal);
    sim.leaveRift(members[1]);
    const chest = await clear(sim, host, inst, owner);
    enter(sim, portal, members[1]);
    for (const pid of members)
      expect(await pressF(sim, host, pid, chest)).toEqual({ visible: true, pressed: true });
    expectPaidOnce(sim, host, members);
  });

  it('a stranger who arrives after the kill is turned away and cannot shut the others out', async () => {
    const { sim, host, owner, portal } = openHoard('deeprake', 'rare');
    enter(sim, portal, owner);
    const inst = runOf(sim, portal);
    const chest = await clear(sim, host, inst, owner);
    const stranger = joinPlayer(sim, 'rogue', 'Stranger');
    sim.partyInvite(stranger, owner);
    sim.partyAccept(stranger);
    enter(sim, portal, stranger);
    expect(inst.memberIds.has(stranger)).toBe(false);
    expect(await pressF(sim, host, owner, chest)).toEqual({ visible: true, pressed: true });
    expectPaidOnce(sim, host, [owner]);
    expect(host.grants.has(sim.meta(stranger)!.characterId!)).toBe(false);
  });

  it('a member who disconnects before opening keeps their share; the rest still open it', async () => {
    const { sim, host, owner, members, portal } = openHoard('chest', 'rare', 3);
    for (const pid of members) enter(sim, portal, pid);
    const inst = runOf(sim, portal);
    const chest = await clear(sim, host, inst, owner);
    const gone = members[2];
    const goneCharacter = sim.meta(gone)!.characterId!;
    sim.removePlayer(gone);
    await host.tick(2);
    // Their frozen claim is still in the outcome the host mails after the delay.
    expect(host.outcomes[0].claims.map((c) => c.characterId)).toContain(goneCharacter);
    for (const pid of members.slice(0, 2))
      expect(await pressF(sim, host, pid, chest)).toEqual({ visible: true, pressed: true });
    expectPaidOnce(sim, host, members.slice(0, 2));
  });

  it('pets in the room change nothing: only players are claimants', async () => {
    const { sim, host, owner, members, portal } = openHoard('mushroom', 'common', 2);
    for (const pid of members) enter(sim, portal, pid);
    const inst = runOf(sim, portal);
    const warlock = members[1];
    sim.ctx.summonPet(sim.entities.get(warlock)!, 'emberkin');
    await host.tick(2);
    expect([...sim.entities.values()].some((e) => e.ownerId === warlock)).toBe(true);
    const chest = await clear(sim, host, inst, owner);
    expect(host.outcomes[0].claims).toHaveLength(2);
    for (const pid of members)
      expect(await pressF(sim, host, pid, chest)).toEqual({ visible: true, pressed: true });
    expectPaidOnce(sim, host, members);
  });

  it('a party of five with a member who died, released and ran back all open it', async () => {
    const { sim, host, owner, members, portal } = openHoard('mushroom', 'rare', 5);
    for (const pid of members) enter(sim, portal, pid);
    const inst = runOf(sim, portal);
    const fallen = members[3];
    const body = sim.entities.get(fallen)!;
    sim.ctx.handleDeath(body, null);
    await host.tick(2);
    sim.releaseSpirit(fallen);
    await host.tick(2);
    expect(inst.memberIds.has(fallen)).toBe(true);
    // The ghost runs back through the portal (a member's corpse run) and is raised.
    enter(sim, portal, fallen);
    sim.revivePlayerAt(fallen, { ...sim.entities.get(fallen)!.pos });
    await host.tick(2);
    expect(sim.entities.get(fallen)!.dead).toBe(false);
    const chest = await clear(sim, host, inst, owner);
    expect(host.outcomes[0].claims).toHaveLength(5);
    for (const pid of members)
      expect(await pressF(sim, host, pid, chest)).toEqual({ visible: true, pressed: true });
    expectPaidOnce(sim, host, members);
  });

  it('a player with full bags still gets their items', async () => {
    const { sim, host, owner, portal } = openHoard('bat', 'rare');
    const meta = sim.meta(owner)!;
    for (let i = 0; i < 200; i++) sim.addItem('rusty_hatchet', 1, owner);
    const before = meta.inventory.reduce((n, slot) => n + slot.count, 0);
    enter(sim, portal, owner);
    const chest = await clear(sim, host, runOf(sim, portal), owner);
    expect(await pressF(sim, host, owner, chest)).toEqual({ visible: true, pressed: true });
    expectPaidOnce(sim, host, [owner]);
    const claim = host.outcomes[0].claims[0];
    const granted = claim.items.reduce((n, item) => n + item.count, 0);
    expect(granted).toBeGreaterThan(0);
    expect(meta.inventory.reduce((n, slot) => n + slot.count, 0)).toBe(before + granted);
  });
});
