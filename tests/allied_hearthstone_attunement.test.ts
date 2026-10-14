// Allied Hearthstone attunement (Discord bug report "Allied Hearthstone not
// working as intended?"): binding the stone must not spend its teleport,
// the binding must survive a save round trip, and the quartermaster route the
// not-attuned error names must actually attune.

import { describe, expect, it } from 'vitest';
import { dispatchWorldQuestWire } from '../server/quest_command_wire';
import { applyFactionSelfWire } from '../src/net/faction_snapshot_wire';
import { FACTION_HUB_LANDINGS } from '../src/sim/content/faction_vendors';
import { type FactionId, sanitizeAlliedHearthstoneAttunement } from '../src/sim/factions';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

const WICKHARBOR = { x: 420, z: 360 };

function hearthSim(seed = 4401): Sim {
  const sim = new Sim({ seed, playerClass: 'mage', autoEquip: false });
  sim.addItem('allied_hearthstone', 1);
  sim.drainEvents();
  return sim;
}

function placeAt(sim: Sim, x: number, z: number): void {
  sim.player.pos = sim.ctx.groundPos(x, z);
  sim.player.prevPos = { ...sim.player.pos };
  sim.ctx.rebucket(sim.player);
}

function npcByTemplate(sim: Sim, templateId: string): Entity {
  for (const e of sim.entities.values()) if (e.templateId === templateId) return e;
  throw new Error(`missing npc ${templateId}`);
}

function texts(events: readonly SimEvent[]): string[] {
  return events.flatMap((e) => ('text' in e && typeof e.text === 'string' ? [e.text] : []));
}

function runTicks(sim: Sim, n: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < n; i++) out.push(...sim.tick());
  return out;
}

describe('Allied Hearthstone attunement', () => {
  it('binding by use in an allied hub costs no cast and no cooldown', () => {
    const sim = hearthSim();
    const meta = sim.meta(sim.playerId)!;
    const hub = FACTION_HUB_LANDINGS.automatons;
    placeAt(sim, hub.x + 5, hub.z + 5);

    const revBefore = meta.wireRev;
    sim.useItem('allied_hearthstone');
    expect(texts(sim.drainEvents())).toContain(
      'Your Allied Hearthstone is now attuned to Wyrmwatch.',
    );
    expect(meta.alliedHearthstoneAttunement).toBe('automatons');
    // The bump is what makes the server's owner gate re-send the `ahs` key.
    expect(meta.wireRev).toBeGreaterThan(revBefore);
    // The bind is the whole action: no 10 s cast toward the hub the player
    // already stands in, and no 15 min cooldown on the teleport they bought.
    expect(sim.player.castingAbility).toBeNull();
    expect(meta.alliedHearthstoneReadyAt ?? 0).toBe(0);
    expect(sim.player.cooldowns.has('allied_hearthstone')).toBe(false);

    // The reporter's next step: travel away and use it. It must take them home.
    placeAt(sim, WICKHARBOR.x, WICKHARBOR.z);
    sim.useItem('allied_hearthstone');
    expect(texts(sim.drainEvents()).some((t) => t.includes('not ready'))).toBe(false);
    expect(sim.player.castingAbility).toBe('allied_hearthstone');
    const after = texts(runTicks(sim, 201));
    expect(after).toContain('The hearthstone transports you to Wyrmwatch.');
    expect(Math.hypot(sim.player.pos.x - hub.x, sim.player.pos.z - hub.z)).toBeLessThan(1);
    expect(meta.alliedHearthstoneReadyAt).toBeGreaterThan(sim.time);
  });

  it('a use in a hub while already attuned elsewhere still teleports to the bound hub', () => {
    const sim = hearthSim();
    const meta = sim.meta(sim.playerId)!;
    meta.alliedHearthstoneAttunement = 'church_order';
    const wyrmwatch = FACTION_HUB_LANDINGS.automatons;
    placeAt(sim, wyrmwatch.x, wyrmwatch.z);
    sim.useItem('allied_hearthstone');
    expect(meta.alliedHearthstoneAttunement).toBe('church_order');
    expect(sim.player.castingAbility).toBe('allied_hearthstone');
  });

  it('keeps the attunement through serializeCharacter and addPlayer', () => {
    const sim = hearthSim();
    const meta = sim.meta(sim.playerId)!;
    meta.alliedHearthstoneAttunement = 'rift_watch';
    const state = sim.serializeCharacter(sim.playerId);
    if (!state) throw new Error('missing state');
    expect(state.worldQuests?.alliedHearthstone).toBe('rift_watch');

    const restored = new Sim({ seed: 4402, playerClass: 'mage', noPlayer: true });
    const pid = restored.addPlayer('mage', 'Binder', { state });
    expect(restored.meta(pid)?.alliedHearthstoneAttunement).toBe('rift_watch');
    expect(restored.serializeCharacter(pid)?.worldQuests?.alliedHearthstone).toBe('rift_watch');
  });

  it('loads a pre-feature save unbound and keeps an unbound save free of the key', () => {
    const sim = hearthSim();
    const state = sim.serializeCharacter(sim.playerId);
    if (!state) throw new Error('missing state');
    // An unbound character adds nothing to the save (no key, no empty blob).
    expect(JSON.stringify(state)).not.toContain('alliedHearthstone');
    // A save written before the field existed, with and without a worldQuests blob.
    for (const legacy of [
      { ...state, worldQuests: undefined },
      { ...state, worldQuests: { cycle: '', progress: [] } },
      { ...state, worldQuests: { cycle: '', progress: [], alliedHearthstone: 'south_reach' } },
    ]) {
      const restored = new Sim({ seed: 4403, playerClass: 'mage', noPlayer: true });
      const pid = restored.addPlayer('mage', 'Legacy', { state: legacy });
      expect(restored.meta(pid)?.alliedHearthstoneAttunement).toBeUndefined();
    }
  });

  it('writes nothing for an unbound stone and drops an unknown saved hub', () => {
    const sim = hearthSim();
    expect(sim.serializeCharacter(sim.playerId)?.worldQuests?.alliedHearthstone).toBeUndefined();
    expect(sanitizeAlliedHearthstoneAttunement('automatons')).toBe('automatons');
    expect(sanitizeAlliedHearthstoneAttunement('south_reach')).toBeUndefined();
    expect(sanitizeAlliedHearthstoneAttunement(7)).toBeUndefined();
    expect(sanitizeAlliedHearthstoneAttunement(undefined)).toBeUndefined();
  });

  it('a faction quartermaster re-attunes the stone to its hub', () => {
    const sim = hearthSim();
    const meta = sim.meta(sim.playerId)!;
    meta.alliedHearthstoneAttunement = 'church_order';
    const tobrin = npcByTemplate(sim, 'npc_automaton_quartermaster');
    placeAt(sim, tobrin.pos.x + 2, tobrin.pos.z);

    const revBefore = meta.wireRev;
    sim.attuneAlliedHearthstone(tobrin.id);
    expect(meta.alliedHearthstoneAttunement).toBe('automatons');
    expect(meta.wireRev).toBeGreaterThan(revBefore);
    expect(texts(sim.drainEvents())).toContain(
      'Your Allied Hearthstone is now attuned to Wyrmwatch.',
    );
    expect(sim.alliedHearthstoneAttunement).toBe('automatons');
    expect(sim.player.castingAbility).toBeNull();
  });

  it('a rebind to the hub already bound is a silent no-op, and the dead cannot bind', () => {
    const sim = hearthSim();
    const meta = sim.meta(sim.playerId)!;
    meta.alliedHearthstoneAttunement = 'automatons';
    const tobrin = npcByTemplate(sim, 'npc_automaton_quartermaster');
    placeAt(sim, tobrin.pos.x + 2, tobrin.pos.z);
    sim.drainEvents();
    const revBefore = meta.wireRev;
    sim.attuneAlliedHearthstone(tobrin.id);
    expect(meta.wireRev).toBe(revBefore);
    expect(texts(sim.drainEvents())).toEqual([]);

    meta.alliedHearthstoneAttunement = undefined;
    sim.player.dead = true;
    sim.attuneAlliedHearthstone(tobrin.id);
    expect(texts(sim.drainEvents())).toContain("You can't do that while dead.");
    expect(meta.alliedHearthstoneAttunement).toBeUndefined();
  });

  it('refuses the quartermaster attune out of range, at a non-quartermaster, or without the stone', () => {
    const sim = hearthSim();
    const meta = sim.meta(sim.playerId)!;
    const tobrin = npcByTemplate(sim, 'npc_automaton_quartermaster');
    const sela = npcByTemplate(sim, 'quartermaster_sela');

    placeAt(sim, tobrin.pos.x + 40, tobrin.pos.z);
    sim.attuneAlliedHearthstone(tobrin.id);
    expect(texts(sim.drainEvents())).toContain('Too far away.');
    expect(meta.alliedHearthstoneAttunement).toBeUndefined();

    placeAt(sim, sela.pos.x + 1, sela.pos.z);
    sim.attuneAlliedHearthstone(sela.id);
    expect(meta.alliedHearthstoneAttunement).toBeUndefined();

    sim.removeItem('allied_hearthstone', 1);
    placeAt(sim, tobrin.pos.x + 2, tobrin.pos.z);
    sim.drainEvents();
    sim.attuneAlliedHearthstone(tobrin.id);
    expect(texts(sim.drainEvents())).toContain("You don't have that item.");
    expect(meta.alliedHearthstoneAttunement).toBeUndefined();
  });

  it('routes the online command through the world-quest wire family', () => {
    const sim = hearthSim();
    const tobrin = npcByTemplate(sim, 'npc_automaton_quartermaster');
    placeAt(sim, tobrin.pos.x + 2, tobrin.pos.z);
    dispatchWorldQuestWire(
      sim,
      { cmd: 'allied_hearthstone_attune', npcId: tobrin.id },
      sim.playerId,
    );
    expect(sim.meta(sim.playerId)?.alliedHearthstoneAttunement).toBe('automatons');
    // A malformed id never reaches the sim.
    sim.meta(sim.playerId)!.alliedHearthstoneAttunement = undefined;
    dispatchWorldQuestWire(sim, { cmd: 'allied_hearthstone_attune', npcId: 'x' }, sim.playerId);
    expect(sim.meta(sim.playerId)?.alliedHearthstoneAttunement).toBeUndefined();
  });

  it('mirrors the attunement from the ahs self key on the client', () => {
    const target: { alliedHearthstoneAttunement?: FactionId | null } = {};
    applyFactionSelfWire(target, { ahs: 'automatons' });
    expect(target.alliedHearthstoneAttunement).toBe('automatons');
    applyFactionSelfWire(target, {});
    expect(target.alliedHearthstoneAttunement).toBe('automatons');
    applyFactionSelfWire(target, { ahs: null });
    expect(target.alliedHearthstoneAttunement).toBeNull();
    applyFactionSelfWire(target, { ahs: 'south_reach' });
    expect(target.alliedHearthstoneAttunement).toBeNull();
  });
});
