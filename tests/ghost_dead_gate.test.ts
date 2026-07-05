// Dead players cannot interact with the world, and logging out preserves the
// death loop (follow-up to the ghost/death loop of src/sim/spirit.ts).
//
// Part A: the interaction/quest command family (interact / lootCorpse /
// pickUpObject / talkToNpc / acceptQuest / turnInQuest, plus the mailbox-open
// path inside interact) refuses a dead player, released ghost or not, with the
// same "You can't do that while dead." error the item family already emits.
// The Spirit Healer stays reachable for a ghost (that is how it takes the
// healer resurrection).
//
// Part B: a character saved dead but UNRELEASED resumes as a released ghost
// (auto-release-on-logout) with the corpse at the death spot and the spirit at
// the graveyard the normal release path picks; old saves without the field and
// alive/released-ghost saves load exactly as before.

import { describe, expect, it } from 'vitest';
import { DUNGEON_X_THRESHOLD, QUESTS, SPIRIT_HEALER_NPC_ID } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { SPIRIT_HEALER_RANGE } from '../src/sim/spirit';
import { dist2d, type Entity, INTERACT_RANGE, type SimEvent } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

type AnyEntity = Entity & Record<string, any>;
type AnySim = Sim & Record<string, any>;

const DEAD_ERROR = "You can't do that while dead.";

const makeSim = (seed = 42): AnySim =>
  new Sim({ seed, playerClass: 'warrior', autoEquip: true }) as AnySim;

function deadErrors(events: SimEvent[]): number {
  return events.filter((ev) => ev.type === 'error' && ev.text === DEAD_ERROR).length;
}

function teleport(sim: AnySim, p: AnyEntity, x: number, z: number): void {
  p.pos = { x, y: terrainHeight(x, z, sim.cfg.seed), z };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
}

// A Spirit Healer NPC within reach of a position (2D).
function healerInRange(sim: AnySim, pos: { x: number; z: number }, range: number): boolean {
  for (const e of sim.entities.values() as IterableIterator<AnyEntity>) {
    if (e.kind !== 'npc' || e.templateId !== SPIRIT_HEALER_NPC_ID) continue;
    if (dist2d(e.pos, { x: pos.x, y: 0, z: pos.z }) <= range) return true;
  }
  return false;
}

// Put the primary player into one of the two dead modes AT ITS CURRENT SPOT:
// an unreleased corpse (dead, not ghost), or a released ghost teleported back
// to the spot (a ghost roams freely, which is what made these paths reachable).
function makeDead(sim: AnySim, mode: 'unreleased' | 'ghost'): AnyEntity {
  const p = sim.player as AnyEntity;
  const spot = { x: p.pos.x, z: p.pos.z };
  p.hp = 0;
  p.dead = true;
  if (mode === 'ghost') {
    sim.releaseSpirit();
    teleport(sim, p, spot.x, spot.z);
  }
  return p;
}

for (const mode of ['unreleased', 'ghost'] as const) {
  describe(`dead-gate: interaction commands refused for a ${mode} dead player`, () => {
    it('interact is refused with the while-dead error', () => {
      const sim = makeSim();
      const p = sim.player as AnyEntity;
      teleport(sim, p, 0, -120); // open ground, no Spirit Healer in reach
      makeDead(sim, mode);
      expect(healerInRange(sim, p.pos, INTERACT_RANGE)).toBe(false);
      sim.drainEvents();
      sim.interact();
      expect(deadErrors(sim.drainEvents())).toBe(1);
    });

    it('interact near a mailbox is refused (the mailbox-open path)', () => {
      const sim = makeSim();
      const p = sim.player as AnyEntity;
      const mailbox = [...sim.entities.values()].find(
        (e: AnyEntity) => e.templateId === 'mailbox',
      ) as AnyEntity;
      expect(mailbox).toBeTruthy();
      teleport(sim, p, mailbox.pos.x + 1, mailbox.pos.z);
      makeDead(sim, mode);
      sim.drainEvents();
      sim.interact();
      const events = sim.drainEvents();
      expect(deadErrors(events)).toBe(1);
      expect(events.some((ev: any) => ev.type === 'mailbox')).toBe(false);
    });

    it('lootCorpse is refused and the loot stays on the corpse', () => {
      const sim = makeSim();
      const p = sim.player as AnyEntity;
      const wolf = [...sim.entities.values()].find((e: AnyEntity) => e.kind === 'mob') as AnyEntity;
      wolf.hp = 0;
      wolf.dead = true;
      wolf.lootable = true;
      wolf.tappedById = sim.playerId;
      wolf.loot = { copper: 0, items: [{ itemId: 'wolf_fang', count: 1 }] };
      teleport(sim, p, wolf.pos.x, wolf.pos.z);
      makeDead(sim, mode);
      sim.drainEvents();
      sim.lootCorpse(wolf.id);
      expect(deadErrors(sim.drainEvents())).toBe(1);
      expect(wolf.loot!.items[0].count).toBe(1); // untouched, still on the corpse
      expect(sim.countItem('wolf_fang')).toBe(0);
    });

    it('pickUpObject is refused and the object stays in the world', () => {
      const sim = makeSim();
      const p = sim.player as AnyEntity;
      const obj = [...sim.entities.values()].find(
        (e: AnyEntity) => e.kind === 'object' && e.lootable && e.objectItemId,
      ) as AnyEntity;
      expect(obj).toBeTruthy();
      teleport(sim, p, obj.pos.x + 1, obj.pos.z);
      makeDead(sim, mode);
      sim.drainEvents();
      sim.pickUpObject(obj.id);
      expect(deadErrors(sim.drainEvents())).toBe(1);
      expect(obj.lootable).toBe(true);
      expect(sim.countItem(obj.objectItemId as string)).toBe(0);
    });

    it('talkToNpc on a quest NPC is refused', () => {
      const sim = makeSim();
      const p = sim.player as AnyEntity;
      const npc = [...sim.entities.values()].find(
        (e: AnyEntity) =>
          e.kind === 'npc' && e.questIds.length > 0 && e.templateId !== SPIRIT_HEALER_NPC_ID,
      ) as AnyEntity;
      expect(npc).toBeTruthy();
      teleport(sim, p, npc.pos.x + 1, npc.pos.z);
      makeDead(sim, mode);
      sim.drainEvents();
      sim.talkToNpc(npc.id);
      const events = sim.drainEvents();
      expect(deadErrors(events)).toBe(1);
      expect(events.some((ev: any) => ev.type === 'questAccepted')).toBe(false);
    });

    it('acceptQuest is refused and nothing lands in the log', () => {
      const sim = makeSim();
      makeDead(sim, mode);
      const questId = Object.keys(QUESTS)[0];
      sim.drainEvents();
      sim.acceptQuest(questId);
      expect(deadErrors(sim.drainEvents())).toBe(1);
      expect(sim.questLog.size).toBe(0);
    });

    it('buyItem is refused like the rest of the vendor family', () => {
      const sim = makeSim();
      const p = sim.player as AnyEntity;
      const vendor = [...sim.entities.values()].find(
        (e: AnyEntity) => e.kind === 'npc' && e.vendorItems.length > 0,
      ) as AnyEntity;
      expect(vendor).toBeTruthy();
      const itemId = vendor.vendorItems[0] as string;
      teleport(sim, p, vendor.pos.x + 1, vendor.pos.z);
      makeDead(sim, mode);
      sim.drainEvents();
      // Starting bags may already hold the vendor's item (a warrior spawns with
      // starter rations, and the first vendor found sells that same food), so
      // pin the refused buy as "count unchanged", not "count zero".
      const before = sim.countItem(itemId);
      sim.buyItem(vendor.id, itemId);
      expect(deadErrors(sim.drainEvents())).toBe(1);
      expect(sim.countItem(itemId)).toBe(before);
    });

    it('turnInQuest is refused and the quest stays ready in the log', () => {
      const sim = makeSim();
      const questId = Object.keys(QUESTS)[0];
      const quest = QUESTS[questId];
      sim.questLog.set(questId, {
        questId,
        counts: quest.objectives.map((o: any) => o.count),
        state: 'ready',
      });
      makeDead(sim, mode);
      sim.drainEvents();
      sim.turnInQuest(questId);
      const events = sim.drainEvents();
      expect(deadErrors(events)).toBe(1);
      expect(events.some((ev: any) => ev.type === 'questDone')).toBe(false);
      expect(sim.questLog.get(questId)?.state).toBe('ready');
    });
  });
}

describe('dead-gate: Spirit Healer exceptions for a ghost', () => {
  it('interact at the graveyard (angel in reach) emits no while-dead error', () => {
    const sim = makeSim();
    const p = sim.player as AnyEntity;
    p.hp = 0;
    p.dead = true;
    sim.releaseSpirit(); // ghost rises at a graveyard, an angel hovering there
    expect(healerInRange(sim, p.pos, INTERACT_RANGE)).toBe(true);
    sim.drainEvents();
    sim.interact();
    expect(deadErrors(sim.drainEvents())).toBe(0);
  });

  it('talkToNpc on the Spirit Healer emits no while-dead error', () => {
    const sim = makeSim();
    const p = sim.player as AnyEntity;
    p.hp = 0;
    p.dead = true;
    sim.releaseSpirit();
    const healer = [...sim.entities.values()].find(
      (e: AnyEntity) =>
        e.kind === 'npc' &&
        e.templateId === SPIRIT_HEALER_NPC_ID &&
        dist2d(e.pos, p.pos) <= INTERACT_RANGE + 2,
    ) as AnyEntity;
    expect(healer).toBeTruthy();
    sim.drainEvents();
    sim.talkToNpc(healer.id);
    expect(deadErrors(sim.drainEvents())).toBe(0);
  });

  it('the healer resurrection itself still works for a ghost', () => {
    const sim = makeSim();
    const p = sim.player as AnyEntity;
    sim.setPlayerLevel(10);
    p.hp = 0;
    p.dead = true;
    sim.releaseSpirit();
    expect(healerInRange(sim, p.pos, SPIRIT_HEALER_RANGE)).toBe(true);
    sim.resurrectAtSpiritHealer();
    expect(p.dead).toBe(false);
    expect(p.ghost).toBe(false);
  });

  it('mailTake is silently refused while dead (no parcels into a corpse)', () => {
    const sim = makeSim();
    const p = sim.player as AnyEntity;
    const meta = sim.players.get(sim.playerId)!;
    const mailbox = [...sim.entities.values()].find(
      (e: AnyEntity) => e.templateId === 'mailbox',
    ) as AnyEntity;
    sim.postOffice.mail.push({
      id: 4242,
      recipientKey: meta.name,
      recipientName: meta.name,
      senderName: 'Postmaster',
      kind: 'system',
      subject: 'Coin',
      body: '',
      copper: 50,
      items: [],
      deliverAt: 0,
      expiresAt: Infinity,
      read: false,
      announced: false,
    });
    teleport(sim, p, mailbox.pos.x + 1, mailbox.pos.z);
    makeDead(sim, 'ghost');
    const before = meta.copper;
    sim.mailTake(4242);
    expect(meta.copper).toBe(before);
    const letter = sim.postOffice.mail.find((m: any) => m.id === 4242)!;
    expect(letter.copper).toBe(50); // still attached
  });
});

describe('auto-release-on-logout: save/load of a dead-unreleased character', () => {
  it('an overworld dead-unreleased save resumes as a released ghost at the graveyard', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    teleport(sim, p, 0, -120); // a known overworld death spot
    p.hp = 0;
    p.dead = true; // died, logged out WITHOUT releasing
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.dead).toBe(true);
    expect(state.ghost).toBe(false);

    // what the normal release path would produce from the same death spot
    sim.releaseSpirit();
    const releasedPos = { x: p.pos.x, z: p.pos.z };

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true }) as AnySim;
    const pid2 = sim2.addPlayer('warrior', 'Reloger', { state });
    const e2 = sim2.entities.get(pid2) as AnyEntity;
    expect(e2.dead).toBe(true);
    expect(e2.ghost).toBe(true);
    // the corpse lies at the death spot
    expect(e2.corpsePos).toBeTruthy();
    expect(dist2d(e2.corpsePos!, { x: 0, y: 0, z: -120 })).toBeLessThan(1);
    // the spirit stands exactly where the normal release path puts it
    expect(Math.abs(e2.pos.x - releasedPos.x)).toBeLessThan(1);
    expect(Math.abs(e2.pos.z - releasedPos.z)).toBeLessThan(1);
    expect(healerInRange(sim2, e2.pos, SPIRIT_HEALER_RANGE)).toBe(true);
    // ghost display pools: full greyed bar
    expect(e2.hp).toBe(e2.maxHp);
  });

  it('a dungeon dead-unreleased save keeps the corpse inside and rises at an outdoor graveyard', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    sim.enterDungeon('hollow_crypt');
    expect(p.pos.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    // die deeper inside the instance
    p.pos = { x: p.pos.x, y: p.pos.y, z: p.pos.z + 30 };
    p.prevPos = { ...p.pos };
    sim.rebucket(p);
    const deathSpot = { x: p.pos.x, z: p.pos.z };
    p.hp = 0;
    p.dead = true;
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.dead).toBe(true);

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true }) as AnySim;
    const pid2 = sim2.addPlayer('warrior', 'Reloger', { state });
    const e2 = sim2.entities.get(pid2) as AnyEntity;
    expect(e2.dead).toBe(true);
    expect(e2.ghost).toBe(true);
    // corpse marked at the death spot inside the instance band
    expect(e2.corpsePos!.x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
    expect(dist2d(e2.corpsePos!, { x: deathSpot.x, y: 0, z: deathSpot.z })).toBeLessThan(1);
    // the spirit rises OUTSIDE, at an overworld graveyard with an angel
    expect(e2.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
    expect(healerInRange(sim2, e2.pos, SPIRIT_HEALER_RANGE)).toBe(true);
  });

  it('an alive save still loads alive and unchanged', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    p.hp = 37;
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.dead).toBe(false);

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true }) as AnySim;
    const pid2 = sim2.addPlayer('warrior', 'Reloger', { state });
    const e2 = sim2.entities.get(pid2) as AnyEntity;
    expect(e2.dead).toBe(false);
    expect(e2.ghost).toBe(false);
    expect(e2.hp).toBe(37);
  });

  it('a released-ghost save still resumes exactly as today (no double release)', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    teleport(sim, p, 0, -120);
    p.hp = 0;
    p.dead = true;
    sim.releaseSpirit();
    const savedGhostPos = { x: p.pos.x, z: p.pos.z };
    const savedCorpse = { ...(p.corpsePos as { x: number; y: number; z: number }) };
    const state = sim.serializeCharacter(sim.playerId)!;
    expect(state.ghost).toBe(true);

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true }) as AnySim;
    const pid2 = sim2.addPlayer('warrior', 'Reloger', { state });
    const e2 = sim2.entities.get(pid2) as AnyEntity;
    expect(e2.dead).toBe(true);
    expect(e2.ghost).toBe(true);
    expect(Math.abs(e2.pos.x - savedGhostPos.x)).toBeLessThan(1);
    expect(Math.abs(e2.pos.z - savedGhostPos.z)).toBeLessThan(1);
    expect(dist2d(e2.corpsePos!, savedCorpse)).toBeLessThan(1);
  });

  it('an old save without the dead field loads alive at 1 hp, exactly as before', () => {
    const sim = makeSim();
    sim.setPlayerLevel(10);
    const p = sim.player as AnyEntity;
    teleport(sim, p, 0, -120);
    p.hp = 0;
    p.dead = true;
    const state = sim.serializeCharacter(sim.playerId)! as any;
    delete state.dead; // simulate a pre-fix save

    const sim2 = new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true }) as AnySim;
    const pid2 = sim2.addPlayer('warrior', 'Reloger', { state });
    const e2 = sim2.entities.get(pid2) as AnyEntity;
    expect(e2.dead).toBe(false);
    expect(e2.ghost).toBe(false);
    expect(e2.hp).toBe(1);
  });
});
