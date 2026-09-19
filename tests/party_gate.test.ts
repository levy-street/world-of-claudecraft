// The party gates (src/sim/party_gate.ts), cast through the real castAbility
// path and clicked through the real pickUpObject interact.

import { describe, expect, it } from 'vitest';
import {
  GRAND_PORTAL_DURATION,
  GRAND_PORTAL_OBJECT_ITEM_ID,
  GRAND_TELEPORT_COOLDOWN,
  GRAND_TELEPORT_LEARN_LEVEL,
  grandTeleportDestination,
  RUNE_OF_PASSAGE_ITEM_ID,
} from '../src/sim/content/grand_teleports';
import {
  HELLGATE_ABILITY_ID,
  HELLGATE_BLEED_AURA_ID,
  HELLGATE_DURATION,
  HELLGATE_FINAL_QUEST_ID,
  HELLGATE_OBJECT_ITEM_ID,
} from '../src/sim/content/hellgate';
import { ABILITIES, arenaOrigin } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, SimEvent } from '../src/sim/types';
import { localizeSimText } from '../src/ui/sim_i18n';

const PORTAL_ID = 'grand_teleport_highwatch';
const RUNE = RUNE_OF_PASSAGE_ITEM_ID;

const ctx = (sim: Sim): SimContext => (sim as unknown as { ctx: SimContext }).ctx;

function entity(sim: Sim, id: number): Entity {
  const found = sim.entities.get(id);
  if (!found) throw new Error(`Missing test entity ${id}`);
  return found;
}

function gates(sim: Sim, objectItemId: string): Entity[] {
  return [...sim.entities.values()].filter(
    (e) => e.kind === 'object' && e.objectItemId === objectItemId && e.partyGate !== undefined,
  );
}

function texts(sim: Sim, kind: 'error' | 'log', pid: number, events = sim.events): string[] {
  return events
    .filter(
      (e): e is Extract<SimEvent, { type: 'error' | 'log' }> => e.type === kind && e.pid === pid,
    )
    .map((e) => e.text);
}

function ticks(sim: Sim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.tick());
  return out;
}

function known(sim: Sim, pid: number): Set<string> {
  const meta = sim.meta(pid);
  if (!meta) throw new Error('missing meta');
  return new Set(meta.known.map((k) => k.def.id));
}

function learnQuest(sim: Sim, pid: number, questId: string): void {
  const meta = sim.meta(pid);
  if (!meta) throw new Error('missing meta');
  meta.questsDone.add(questId);
  ctx(sim).refreshKnownAbilities(meta, false);
}

function world(cls: 'mage' | 'warlock', seed: number) {
  const sim = new Sim({ seed, playerClass: cls, noPlayer: true });
  const casterId = sim.addPlayer(cls, 'Caster');
  const allyId = sim.addPlayer('warrior', 'Companion');
  const strangerId = sim.addPlayer('rogue', 'Stranger');
  sim.setPlayerLevel(GRAND_TELEPORT_LEARN_LEVEL, casterId);
  sim.partyInvite(allyId, casterId);
  sim.partyAccept(allyId);
  if (cls === 'warlock') learnQuest(sim, casterId, HELLGATE_FINAL_QUEST_ID);
  const caster = entity(sim, casterId);
  caster.resource = caster.maxResource;
  sim.events.length = 0;
  return { sim, casterId, allyId, strangerId, caster };
}

function openPortal(sim: Sim, mageId: number, runes = 1): Entity {
  sim.addItem(RUNE, runes, mageId);
  sim.castAbility(PORTAL_ID, mageId);
  ticks(sim, 20 * 11);
  const [portal] = gates(sim, GRAND_PORTAL_OBJECT_ITEM_ID);
  if (!portal) throw new Error('Missing test Grand Portal');
  return portal;
}

function openGate(sim: Sim, ownerId: number): Entity {
  sim.castAbility(HELLGATE_ABILITY_ID, ownerId);
  ticks(sim, 20 * 11);
  const [gate] = gates(sim, HELLGATE_OBJECT_ITEM_ID);
  if (!gate) throw new Error('Missing test Hellgate');
  return gate;
}

describe('Grand Teleport (mage party gate to Highwatch)', () => {
  it('is one ordinary level 20 mage spell: no quest gate, no tome, a 20 min cooldown', () => {
    const def = ABILITIES[PORTAL_ID];
    expect(def.class).toBe('mage');
    expect(def.learnLevel).toBe(GRAND_TELEPORT_LEARN_LEVEL);
    expect(def.requiresQuest).toBeUndefined();
    expect(def.cooldown).toBe(GRAND_TELEPORT_COOLDOWN);
    expect(def.reagent).toEqual({ itemId: RUNE, count: 1 });
    expect(Object.keys(ABILITIES).filter((id) => id.startsWith('grand_teleport_'))).toEqual([
      PORTAL_ID,
    ]);
    const sim = new Sim({ seed: 7, playerClass: 'mage', noPlayer: true });
    const pid = sim.addPlayer('mage', 'Apprentice');
    sim.setPlayerLevel(GRAND_TELEPORT_LEARN_LEVEL - 1, pid);
    expect(known(sim, pid).has(PORTAL_ID)).toBe(false);
    sim.setPlayerLevel(GRAND_TELEPORT_LEARN_LEVEL, pid);
    expect(known(sim, pid).has(PORTAL_ID)).toBe(true);
  });

  it('refuses without a Rune of Passage, consumes one at completion, and opens a party-gated portal', () => {
    const { sim, casterId, allyId, caster } = world('mage', 7);
    sim.castAbility(PORTAL_ID, casterId);
    expect(caster.castingAbility).toBeNull();
    expect(texts(sim, 'error', casterId)).toContain('You do not have the required reagent.');

    sim.addItem(RUNE, 2, casterId);
    sim.castAbility(PORTAL_ID, casterId);
    expect(caster.castingAbility).toBe(PORTAL_ID);
    expect(sim.countItem(RUNE, casterId)).toBe(2); // spent with the mana at completion
    ticks(sim, 20 * 11);
    expect(sim.countItem(RUNE, casterId)).toBe(1);
    expect(caster.cooldowns.get(PORTAL_ID) ?? 0).toBeGreaterThan(GRAND_TELEPORT_COOLDOWN - 15);

    const [portal] = gates(sim, GRAND_PORTAL_OBJECT_ITEM_ID);
    expect(portal.name).toBe('Grand Portal');
    expect(localizeSimText(portal.name)).not.toBeNull(); // never a bare English label
    expect(portal.templateId).toBe('grand_portal');
    expect(portal.partyGate).toEqual({
      ownerId: casterId,
      partyId: 1,
      eligiblePlayerIds: [casterId, allyId],
      destination: 'highwatch',
    });
    expect(portal.despawnTimer).toBeGreaterThan(GRAND_PORTAL_DURATION - 2);
  });

  it('refuses at completion when the rune left the bags mid-cast, without arming the cooldown', () => {
    const { sim, casterId, caster } = world('mage', 7);
    sim.addItem(RUNE, 1, casterId);
    sim.castAbility(PORTAL_ID, casterId);
    ticks(sim, 20 * 5);
    sim.removeItem(RUNE, 1, casterId);
    const emitted = ticks(sim, 20 * 6);
    expect(caster.castingAbility).toBeNull();
    expect(gates(sim, GRAND_PORTAL_OBJECT_ITEM_ID)).toHaveLength(0);
    expect(texts(sim, 'error', casterId, emitted)).toContain(
      'You do not have the required reagent.',
    );
    expect(caster.cooldowns.has(PORTAL_ID)).toBe(false);
  });

  it('hands the rune and the cooldown back when the summon cannot land', () => {
    const { sim, casterId, caster } = world('mage', 7);
    sim.addItem(RUNE, 1, casterId);
    const effect = ABILITIES[PORTAL_ID].effects[0];
    if (effect.type !== 'summonGrandPortal') throw new Error('unexpected effect shape');
    const real = effect.destination;
    // The one summon failure a test can force without crowding a hub.
    effect.destination = 'nowhere';
    try {
      sim.castAbility(PORTAL_ID, casterId);
      const emitted = ticks(sim, 20 * 11);
      expect(gates(sim, GRAND_PORTAL_OBJECT_ITEM_ID)).toHaveLength(0);
      expect(texts(sim, 'error', casterId, emitted)).toContain('There is not enough room here.');
      expect(sim.countItem(RUNE, casterId)).toBe(1);
      expect(caster.cooldowns.has(PORTAL_ID)).toBe(false);
    } finally {
      effect.destination = real;
    }
  });

  it('carries an eligible group member to the Highwatch landing and refuses a stranger or combat', () => {
    const { sim, casterId, allyId, strangerId, caster } = world('mage', 7);
    const portal = openPortal(sim, casterId);
    const landing = grandTeleportDestination('highwatch')?.landing;
    if (!landing) throw new Error('missing destination');

    sim.events.length = 0;
    expect(sim.pickUpObject(portal.id, strangerId)).toBe(true);
    expect(texts(sim, 'error', strangerId)).toContain('That ally is not in your group.');
    const stranger = entity(sim, strangerId);
    expect(Math.hypot(stranger.pos.x - landing.x, stranger.pos.z - landing.z)).toBeGreaterThan(50);

    sim.events.length = 0;
    expect(sim.pickUpObject(portal.id, allyId)).toBe(true);
    const ally = entity(sim, allyId);
    expect(ally.pos.x).toBeCloseTo(landing.x, 5);
    expect(ally.pos.z).toBeCloseTo(landing.z, 5);
    expect(texts(sim, 'log', allyId)).toContain('You step through the portal to Highwatch.');

    caster.inCombat = true;
    sim.events.length = 0;
    expect(sim.pickUpObject(portal.id, casterId)).toBe(true);
    expect(texts(sim, 'error', casterId)).toContain("You can't do that while in combat.");
  }, 60_000);

  it('replaces the same mage previous portal, outlives the mage, and expires on its timer', () => {
    const { sim, casterId, caster } = world('mage', 7);
    const first = openPortal(sim, casterId, 2);
    caster.cooldowns.clear();
    caster.resource = caster.maxResource;
    sim.castAbility(PORTAL_ID, casterId);
    ticks(sim, 20 * 11);
    const live = gates(sim, GRAND_PORTAL_OBJECT_ITEM_ID);
    expect(live).toHaveLength(1);
    expect(live[0].id).not.toBe(first.id);
    // The group keeps the exit after the caster dies.
    ctx(sim).handleDeath(caster, null);
    ticks(sim, 2);
    expect(gates(sim, GRAND_PORTAL_OBJECT_ITEM_ID)).toHaveLength(1);
    // The authored 5 minute timer, shortened so the suite stays quick.
    live[0].despawnTimer = 1;
    ticks(sim, 20 * 2);
    expect(gates(sim, GRAND_PORTAL_OBJECT_ITEM_ID)).toHaveLength(0);
  }, 60_000);
});

describe('Hellgate (warlock party gate)', () => {
  it('is gated on the pact final quest, not on level alone', () => {
    const sim = new Sim({ seed: 11, playerClass: 'warlock', noPlayer: true });
    const pid = sim.addPlayer('warlock', 'Unpacted');
    sim.setPlayerLevel(20, pid);
    expect(known(sim, pid).has(HELLGATE_ABILITY_ID)).toBe(false);
    learnQuest(sim, pid, HELLGATE_FINAL_QUEST_ID);
    expect(known(sim, pid).has(HELLGATE_ABILITY_ID)).toBe(true);
  });

  it('opens a gate with the toll aura, which bleeds 1% per second, stops regen, and floors at 1 hp', () => {
    const { sim, casterId, allyId, caster } = world('warlock', 11);
    const gate = openGate(sim, casterId);
    expect(gate.name).toBe('Hellgate');
    expect(gate.templateId).toBe('hellgate');
    expect(gate.partyGate).toEqual({
      ownerId: casterId,
      partyId: 1,
      eligiblePlayerIds: [casterId, allyId],
    });
    const toll = caster.auras.find((a) => a.id === HELLGATE_BLEED_AURA_ID);
    expect(toll).toMatchObject({ kind: 'dot', noRegen: true, sourceId: casterId });
    expect(toll?.value).toBe(Math.max(1, Math.round(caster.maxHp * 0.01)));

    // Out of combat, below full: natural regen would normally refill this.
    caster.hp = Math.floor(caster.maxHp * 0.5);
    const before = caster.hp;
    ticks(sim, 20 * 10);
    expect(caster.inCombat).toBe(false);
    const expectedLoss = Math.round(caster.maxHp * 0.01) * 10;
    expect(before - caster.hp).toBeGreaterThanOrEqual(expectedLoss - 2);
    expect(before - caster.hp).toBeLessThanOrEqual(expectedLoss + 2);

    caster.hp = 3;
    ticks(sim, 20 * 10);
    expect(caster.hp).toBe(1);
    expect(caster.dead).toBe(false);
  }, 60_000);

  it('leaves every OTHER self-sourced dot on the real damage path: Bad Air still kills', () => {
    // Bad Air (delves/runs.ts) is a self-sourced dot too; sized to the health
    // pool so regen between ticks cannot mask the lethal path.
    const { sim, casterId, caster } = world('warlock', 11);
    ctx(sim).applyAura(caster, {
      id: 'bad_air',
      name: 'Bad Air',
      kind: 'dot',
      school: 'nature',
      remaining: 4,
      duration: 4,
      value: caster.maxHp,
      tickInterval: 2,
      tickTimer: 2,
      sourceId: casterId,
    });
    caster.hp = 2;
    ticks(sim, 20 * 3);
    expect(caster.dead).toBe(true);
  });

  it('pulls the targeted group member to the gate and refuses everyone else', () => {
    const { sim, casterId, allyId, strangerId, caster } = world('warlock', 11);
    const gate = openGate(sim, casterId);
    const ally = entity(sim, allyId);
    const refuse = (targetId: number | null, message: string) => {
      sim.events.length = 0;
      caster.targetId = targetId;
      expect(sim.pickUpObject(gate.id, casterId)).toBe(true);
      expect(texts(sim, 'error', casterId)).toContain(message);
    };

    sim.events.length = 0;
    expect(sim.pickUpObject(gate.id, allyId)).toBe(true);
    expect(texts(sim, 'error', allyId)).toContain(
      'Only the warlock who opened the gate can use it.',
    );
    ally.pos = ctx(sim).groundPos(ally.pos.x + 40, ally.pos.z + 40);
    refuse(null, 'Target a group member to summon them.');
    refuse(strangerId, 'Target a group member to summon them.');

    sim.events.length = 0;
    caster.targetId = allyId;
    expect(sim.pickUpObject(gate.id, casterId)).toBe(true);
    expect(ally.pos.x).toBeCloseTo(gate.pos.x, 5);
    expect(ally.pos.z).toBeCloseTo(gate.pos.z, 5);
    expect(texts(sim, 'log', allyId)).toContain('You are pulled through the Hellgate.');

    // Dead, or standing on an instanced plane (the arena): not summonable.
    ally.dead = true;
    refuse(allyId, 'That ally cannot be summoned from where they are.');
    ally.dead = false;
    const pit = arenaOrigin(0);
    ally.pos = { x: pit.x, y: ally.pos.y, z: pit.z };
    refuse(allyId, 'That ally cannot be summoned from where they are.');
    expect(ally.pos.x).toBeCloseTo(pit.x, 5);

    // A late joiner of the group can be pulled.
    sim.partyInvite(strangerId, casterId);
    sim.partyAccept(strangerId);
    expect(gate.partyGate?.eligiblePlayerIds).toContain(strangerId);
    caster.targetId = strangerId;
    expect(sim.pickUpObject(gate.id, casterId)).toBe(true);
    expect(entity(sim, strangerId).pos.x).toBeCloseTo(gate.pos.x, 5);
  }, 60_000);

  it('lasts its duration and the toll ends with it, or early when the warlock dies', () => {
    const { sim, casterId, caster } = world('warlock', 11);
    const gate = openGate(sim, casterId);
    const toll = caster.auras.find((a) => a.id === HELLGATE_BLEED_AURA_ID);
    if (!toll) throw new Error('missing toll');
    // Wind the shared 99 s clock to its last seconds, then let both lapse.
    expect(gate.despawnTimer).toBeGreaterThan(HELLGATE_DURATION - 2);
    expect(toll.duration).toBe(HELLGATE_DURATION);
    const skip = HELLGATE_DURATION - 5;
    gate.despawnTimer = (gate.despawnTimer ?? 0) - skip;
    toll.remaining -= skip;
    ticks(sim, 20 * 3);
    expect(gates(sim, HELLGATE_OBJECT_ITEM_ID)).toHaveLength(1);
    expect(caster.auras.some((a) => a.id === HELLGATE_BLEED_AURA_ID)).toBe(true);
    ticks(sim, 20 * 4);
    expect(gates(sim, HELLGATE_OBJECT_ITEM_ID)).toHaveLength(0);
    expect(caster.auras.some((a) => a.id === HELLGATE_BLEED_AURA_ID)).toBe(false);

    caster.cooldowns.clear();
    caster.resource = caster.maxResource;
    openGate(sim, casterId);
    ctx(sim).handleDeath(caster, null);
    sim.tick();
    expect(gates(sim, HELLGATE_OBJECT_ITEM_ID)).toHaveLength(0);
    expect(caster.auras.some((a) => a.id === HELLGATE_BLEED_AURA_ID)).toBe(false);
  }, 60_000);
});
