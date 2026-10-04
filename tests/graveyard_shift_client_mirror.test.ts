// The online client mirrors a Graveyard Shift the way the offline Sim runs it:
// the known list is Morthen's kit while the identity aura is on (so the bar
// shows it with its tooltips and its Dread costs), and the action bar is read
// only, in step with the offline Sim's actionBarReadOnly.
import { describe, expect, it, vi } from 'vitest';
import {
  buildClientAbilityPresentation,
  clientActionBarReadOnly,
} from '../src/net/ability_presentation';
import { ClientWorld } from '../src/net/online';
import { emptyAllocation } from '../src/sim/content/talents';
import { MORTHEN_KIT } from '../src/sim/graveyard_shift/kit';
import { morthenIdentityAura } from '../src/sim/graveyard_shift/morthen_identity';
import type { Aura } from '../src/sim/types';

const KIT_IDS = MORTHEN_KIT.map((def) => def.id);
const state = () => ({
  talents: emptyAllocation(),
  loadouts: [],
  activeLoadout: -1,
  equipment: {},
  questsDone: new Set<string>(),
});

describe('the client ability presentation', () => {
  it('knows the kit alone while the identity is on, the class kit otherwise', () => {
    const morthen = { level: 10, auras: [morthenIdentityAura(1)] as Aura[] };
    const plain = { level: 10, auras: [] as Aura[] };
    const on = buildClientAbilityPresentation('warrior', morthen, state(), null, []);
    expect(on.known.map((k) => k.def.id)).toEqual(KIT_IDS);
    const off = buildClientAbilityPresentation('warrior', plain, state(), null, []);
    expect(off.known.map((k) => k.def.id)).not.toContain(KIT_IDS[0]);
    expect(off.known.length).toBeGreaterThan(0);
  });

  it('keeps the bar read only while spectating or while Morthen, never otherwise', () => {
    const morthen = { auras: [morthenIdentityAura(1)] as Aura[] };
    const plain = { auras: [] as Aura[] };
    expect(clientActionBarReadOnly(null, false, plain)).toBe(false);
    expect(clientActionBarReadOnly(null, false, morthen)).toBe(true);
    expect(clientActionBarReadOnly('Someone', false, plain)).toBe(true);
    expect(clientActionBarReadOnly(null, true, plain)).toBe(true);
  });
});

describe('a ClientWorld fed a Morthen self snapshot', () => {
  function snapshotClient(): any {
    const client: any = Object.create(ClientWorld.prototype);
    client.talents = emptyAllocation();
    client.loadouts = [];
    client.activeLoadout = -1;
    client.cmd = vi.fn();
    client.cfg = { seed: 20061, playerClass: 'warrior' };
    client.entities = new Map();
    client.playerId = 1;
    client.moveInput = {};
    client.inventory = [];
    client.equipment = {};
    client.copper = 0;
    client.xp = 0;
    client.known = [];
    client.questLog = new Map();
    client.questsDone = new Set();
    client.lastSnapAt = 0;
    client.snapInterval = 50;
    client.pendingFacingDelta = 0;
    client.connected = true;
    client.eventQueue = [];
    client.mouselookFacing = null;
    client.spectating = null;
    return client;
  }

  const identityWire = {
    id: 'gshift_morthen_identity',
    name: 'Morthen the Gravecaller',
    kind: 'form_morthen',
    rem: 3600,
    dur: 3600,
    perm: 1,
    und: 1,
  };

  it('shows the kit with resolved costs and freezes the bar', () => {
    const client = snapshotClient();
    client.applySnapshot({
      t: 'snap',
      tick: 1,
      time: 0,
      ents: [],
      self: {
        id: 1,
        k: 'player',
        tid: 'warrior',
        nm: 'Ari',
        lv: 10,
        x: 0,
        y: 0,
        z: 0,
        f: 0,
        hp: 2620,
        mhp: 2620,
        res: 40,
        mres: 100,
        rtype: 'dread',
        xp: 0,
        copper: 0,
        inv: [],
        equip: {},
        qlog: [],
        auras: [identityWire],
      },
    });
    expect(client.known.map((k: { def: { id: string } }) => k.def.id)).toEqual(KIT_IDS);
    const pulse = client.resolvedAbility('gshift_shadow_pulse');
    expect(pulse?.def.id).toBe('gshift_shadow_pulse');
    expect(client.actionBarReadOnly).toBe(true);
  });
});
