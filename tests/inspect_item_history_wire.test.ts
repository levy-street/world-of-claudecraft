// The worn tracked copies' public history on the inspect wire
// (docs/design/item-tracking.md): the terse `eqh` identity key built by
// server/equipped_history_wire.ts, spliced into the cached identity JSON
// (server/entity_wire_cache.ts splicedIdentityJson), and folded into the
// client's Entity.equippedInstances mirror by src/net/equipped_instances_wire.ts.
// A non-holder reads publicProvenanceView only: never the copy's guid, never a
// character id, never the parent guid. The eqi allowlist itself is unchanged
// (its own pins live in item_instance_transfer / enchant_apply_view /
// legendary_regalia tests), so the history rides BESIDE it.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
}));

import { splicedIdentityJson } from '../server/entity_wire_cache';
import { equippedHistoryJson, equippedHistoryWire } from '../server/equipped_history_wire';
import { type ClientSession, GameServer } from '../server/game';
import { decodeEquippedInstancesWire } from '../src/net/equipped_instances_wire';
import type { Entity, ItemInstancePayload, ItemProvenance } from '../src/sim/types';
import { bareClient } from './helpers/bare_client';

const GUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const PARENT = '9b2e7c1a-5d34-4f6e-8a1b-2c3d4e5f6071';
const FULL: ItemProvenance = {
  at: 1_700_000_000_000,
  by: 'Alice',
  byId: 11,
  source: 'mob:forest_wolf',
  zone: 'eastbrook',
  derivedFrom: PARENT,
  owners: [{ at: 1_700_000_100_000, by: 'Bob', byId: 22 }],
  transfers: 1,
};
const PUBLIC: ItemProvenance = {
  at: 1_700_000_000_000,
  by: 'Alice',
  source: 'mob:forest_wolf',
  zone: 'eastbrook',
  owners: [{ at: 1_700_000_100_000, by: 'Bob' }],
  transfers: 1,
};

type Worn = Entity['equippedInstances'];

describe('equippedHistoryWire: the public projection per worn tracked copy', () => {
  it('ships publicProvenanceView per tracked slot and nothing for untracked ones', () => {
    const worn: Worn = {
      chest: { guid: GUID, provenance: FULL, signer: 'Alice' },
      legs: { signer: 'Carl' },
    };
    const wire = equippedHistoryWire(worn);
    expect(wire).toEqual({ chest: PUBLIC });
    const json = JSON.stringify(wire);
    expect(json).not.toContain(GUID);
    expect(json).not.toContain(PARENT);
    expect(json).not.toContain('byId');
    expect(json).not.toContain('derivedFrom');
    // A fresh copy, never an alias of the live mirror's chain.
    expect(wire?.chest.owners).not.toBe(FULL.owners);
  });

  it('is null (the key stays sparse) when nothing worn is tracked', () => {
    expect(equippedHistoryWire({})).toBeNull();
    expect(equippedHistoryWire({ chest: { signer: 'A' } })).toBeNull();
    expect(equippedHistoryJson({ equippedInstances: { chest: { signer: 'A' } } })).toBeNull();
  });
});

describe('equippedHistoryJson: built and serialized once per worn set', () => {
  it('returns the same string for the same mirror and for a recalc clone of it', () => {
    const e = { equippedInstances: { chest: { guid: GUID, provenance: FULL } } as Worn };
    const first = equippedHistoryJson(e);
    expect(first).toBe(JSON.stringify({ chest: PUBLIC }));
    expect(equippedHistoryJson(e)).toBe(first);
    // recalcPlayerStats replaces the mirror with a deep clone: same content,
    // so the SAME string comes back and the identity diff stays quiet.
    e.equippedInstances = structuredClone(e.equippedInstances);
    expect(equippedHistoryJson(e)).toBe(first);
  });

  it('re-mints when the worn copy changes hands or another copy is worn', () => {
    const e = { equippedInstances: { chest: { guid: GUID, provenance: FULL } } as Worn };
    const first = equippedHistoryJson(e);
    const moved: ItemProvenance = {
      ...FULL,
      owners: [...(FULL.owners ?? []), { at: 1_700_000_200_000, by: 'Cara', byId: 33 }],
      transfers: 2,
    };
    e.equippedInstances = { chest: { guid: GUID, provenance: moved } };
    const second = equippedHistoryJson(e);
    expect(second).not.toBe(first);
    expect(JSON.parse(second ?? 'null').chest.owners.map((o: { by: string }) => o.by)).toEqual([
      'Bob',
      'Cara',
    ]);
    e.equippedInstances = {};
    expect(equippedHistoryJson(e)).toBeNull();
  });
});

describe('splicedIdentityJson', () => {
  it('splices the look and the worn history only when present', () => {
    expect(splicedIdentityJson('{"k":"player"}', null, null)).toBe('{"k":"player"}');
    expect(JSON.parse(splicedIdentityJson('{"k":"player"}', '{"a":1}', '{"chest":{}}'))).toEqual({
      k: 'player',
      app: { a: 1 },
      eqh: { chest: {} },
    });
    expect(JSON.parse(splicedIdentityJson('{}', null, '{"x":1}'))).toEqual({ eqh: { x: 1 } });
  });
});

describe('decodeEquippedInstancesWire: the client mirror', () => {
  it('folds eqh into the eqi slots and gives an eqh-only copy its own slot', () => {
    const eqi = { chest: { signer: 'Alice' }, legs: { enchant: 'ench_stat_str' } };
    const out = decodeEquippedInstancesWire(eqi, { chest: PUBLIC, head: PUBLIC });
    expect(out).toEqual({
      chest: { signer: 'Alice', provenance: PUBLIC },
      legs: { enchant: 'ench_stat_str' },
      head: { provenance: PUBLIC },
    });
    // Deep-cloned, never aliasing the parsed wire record.
    expect(out.chest).not.toBe(eqi.chest);
  });

  it('re-projects a record that carries private fields and drops a malformed one', () => {
    const out = decodeEquippedInstancesWire(undefined, {
      chest: FULL,
      legs: { at: 'yesterday', by: 'X', source: 'world' },
      head: 'not a record',
    });
    expect(out).toEqual({ chest: { provenance: PUBLIC } });
    expect(JSON.stringify(out)).not.toContain('byId');
    expect(JSON.stringify(out)).not.toContain(PARENT);
  });

  it('resets to empty when both keys are absent, and never touches the prototype', () => {
    expect(decodeEquippedInstancesWire(undefined, undefined)).toEqual({});
    const hostile = JSON.parse(`{"__proto__":${JSON.stringify(PUBLIC)}}`);
    const out = decodeEquippedInstancesWire(undefined, hostile) as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.hasOwn(out, '__proto__')).toBe(true);
  });
});

// The liveness half over a REAL GameServer broadcast into a REAL
// ClientWorld.applySnapshot (the inspect_instances.test.ts harness).
const ITEM_ID = 'eastbrook_ritual_vestments';

interface FakeClient {
  sent: any[];
  raw: string[];
  ws: any;
}

function fakeWs(): FakeClient {
  const sent: any[] = [];
  const raw: string[] = [];
  return {
    sent,
    raw,
    ws: {
      readyState: 1,
      send: (payload: string) => {
        raw.push(payload);
        sent.push(JSON.parse(payload));
      },
    },
  };
}

function lastSnap(sent: any[]): any {
  for (let i = sent.length - 1; i >= 0; i--) if (sent[i].t === 'snap') return sent[i];
  return null;
}

function joinServer(server: GameServer, fc: FakeClient, id: number, name: string): ClientSession {
  const session = server.join(fc.ws, id, id, name, 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  return session;
}

function broadcast(server: GameServer): void {
  (server as any).broadcastSnapshots();
}

function cmd(server: GameServer, session: ClientSession, msg: Record<string, unknown>): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', ...msg }));
}

describe('eqh over a real server broadcast (liveness, not shape)', () => {
  it('ships the public history of a worn tracked copy to an inspector, never the guid', () => {
    const server = new GameServer();
    const fcA = fakeWs();
    const a = joinServer(server, fcA, 1, 'Wearer');
    const fcB = fakeWs();
    const b = joinServer(server, fcB, 2, 'Watcher');
    broadcast(server);

    // An epic-rolled copy of a one-per-slot def is tracked: the hub mints a
    // guid and an origin record carrying the wearer's character id.
    server.sim.addItemInstance(ITEM_ID, { rolled: { quality: 'epic' } }, a.pid);
    const meta = server.sim.ctx.resolve(a.pid)?.meta;
    const bagged = meta?.inventory.find((s) => s.itemId === ITEM_ID)?.instance;
    expect(bagged?.guid).toMatch(/^[0-9a-f]{8}-/);
    expect(bagged?.provenance?.byId).toBe(1);
    const guid = bagged?.guid as string;
    cmd(server, a, { cmd: 'equip', item: ITEM_ID });
    fcB.sent.length = 0;
    fcB.raw.length = 0;
    server.sim.tick();
    broadcast(server);

    const snap = lastSnap(fcB.sent);
    const rec = snap?.ents.find((r: any) => r.id === a.pid);
    expect(rec?.k).toBe('player');
    // eqi is unchanged by tracking: the public trim, no identity fields.
    expect(rec?.eqi).toEqual({ chest: { rolled: { quality: 'epic' } } });
    expect(rec?.eqh?.chest).toEqual({
      at: bagged?.provenance?.at,
      by: 'Wearer',
      source: bagged?.provenance?.source,
      ...(bagged?.provenance?.zone !== undefined && { zone: bagged.provenance.zone }),
    });
    for (const frame of fcB.raw) {
      expect(frame).not.toContain(guid);
      expect(frame).not.toContain('"byId"');
      expect(frame).not.toContain('derivedFrom');
    }

    // The inspecting client's mirror carries the public record on the slot.
    const client = bareClient(b.pid);
    (client as any).applySnapshot(snap);
    const mirrored = client.entities.get(a.pid)?.equippedInstances?.chest as ItemInstancePayload;
    expect(mirrored.provenance).toEqual(rec.eqh.chest);
    expect(mirrored.guid).toBeUndefined();

    // A stat recalc swaps the mirror object for a clone: no identity churn,
    // so the next tick re-sends a LITE record (no k, no eqh).
    const wearer = server.sim.entities.get(a.pid) as Entity;
    wearer.equippedInstances = structuredClone(wearer.equippedInstances);
    fcB.sent.length = 0;
    server.sim.tick();
    broadcast(server);
    const lite = lastSnap(fcB.sent)?.ents.find((r: any) => r.id === a.pid);
    expect(lite?.k).toBeUndefined();
    expect(lite?.eqh).toBeUndefined();

    // Unequip: the full record re-sends without eqh and the mirror resets.
    cmd(server, a, { cmd: 'unequip_item', slot: 'chest' });
    fcB.sent.length = 0;
    server.sim.tick();
    broadcast(server);
    const bare = lastSnap(fcB.sent)?.ents.find((r: any) => r.id === a.pid);
    expect(bare?.k).toBe('player');
    expect(bare?.eqh).toBeUndefined();
    (client as any).applySnapshot(lastSnap(fcB.sent));
    expect(client.entities.get(a.pid)?.equippedInstances).toEqual({});
  });
});
