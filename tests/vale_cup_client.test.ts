import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { computeTalentModifiers, emptyAllocation } from '../src/sim/content/talents';
import { SPORT_KITS } from '../src/sim/content/vale_cup';
import { abilitiesKnownAt } from '../src/sim/data';
import type { CupInfo } from '../src/world_api';

// ---------------------------------------------------------------------------
// IWorldValeCup online-client coverage (docs/prd/vale-cup.md):
//  - the `vcup` self delta guard (absent keeps prior, explicit null clears),
//  - the sport-known rebuild off the heavy `sport` self field (the wire trap:
//    known is DERIVED client-side, so the role must ride the wire and resolve
//    through the ONE shared resolveSportKit),
//  - the three queue command sends and the practice no-op.
// ---------------------------------------------------------------------------

// A ClientWorld without the WebSocket plumbing, to drive applySnapshot and the
// cmd() send path directly (mirrors tests/snapshots.test.ts `bareClient`).
function bareClient(pid: number): { client: ClientWorld; sent: any[] } {
  const c: any = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'warrior' };
  c.entities = new Map();
  c.playerId = pid;
  c.ownPlayerId = pid;
  c.ownPlayerClass = 'warrior';
  c.spectating = null;
  c.moveInput = {};
  c.inventory = [];
  c.vendorBuyback = [];
  c.equipment = {};
  c.accountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  c.copper = 0;
  c.xp = 0;
  c.known = [];
  c.questLog = new Map();
  c.questsDone = new Set();
  c.pendingQuestCommands = new Map();
  c.partyInfo = null;
  c.tradeInfo = null;
  c.duelInfo = null;
  c.cupInfo = null;
  c.sportRole = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.missingSince = new Map();
  c.pendingFacingDelta = 0;
  c.connected = true;
  c.eventQueue = [];
  c.mouselookFacing = null;
  c.lastInputSentAt = 0;
  c.lastInputSig = '';
  c.inputSeq = 0;
  c.pendingInputSeqSentAt = new Map();
  c.ackedInputSeq = 0;
  c.inputEchoSamples = [];
  c.spectateFacingPending = false;
  c.pendingSpectateFacing = null;
  const sent: any[] = [];
  c.ws = { readyState: 1, send: (s: string) => sent.push(JSON.parse(s)) };
  return { client: c as ClientWorld, sent };
}

// A minimal self record (identity + vitals), extended per test.
function selfRecord(pid: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: pid,
    k: 'player',
    tid: 'warrior',
    nm: 'Booter',
    lv: 10,
    x: 0,
    y: 0,
    z: 0,
    f: 0,
    hp: 100,
    mhp: 100,
    res: 0,
    mres: 100,
    rtype: 'rage',
    ...extra,
  };
}

function apply(client: ClientWorld, self: Record<string, unknown>): void {
  (client as any).applySnapshot({ t: 'snap', ents: [], self });
}

function sampleCup(): CupInfo {
  return {
    standing: { wins: 3, losses: 1, draws: 0 },
    queued: true,
    bracket: 3,
    nation: 'vale',
    role: 'striker',
    position: 1,
    queueSizes: { 1: 0, 2: 0, 3: 2, 4: 0, 5: 0 },
    deserterFor: 0,
    match: null,
    spectate: null,
    betRecord: { wins: 0, losses: 0, net: 0 },
    live: null,
    board: [{ name: 'Booter', wins: 3 }],
    guildBoard: [{ name: 'Wheat Kings', wins: 2, losses: 1 }],
    myGuild: 'Wheat Kings',
    guildStanding: { wins: 2, losses: 1 },
    practicing: [],
  };
}

describe('vcup self delta guard (absent keeps prior, null clears)', () => {
  it('mirrors s.vcup onto cupInfo and keeps the prior mirror when omitted', () => {
    const { client } = bareClient(1);
    const cup = sampleCup();
    apply(client, selfRecord(1, { vcup: cup }));
    expect(client.cupInfo).toEqual(cup);

    // delta-omitted snapshot: the prior mirror survives, by reference
    const ref = client.cupInfo;
    apply(client, selfRecord(1));
    expect(client.cupInfo).toBe(ref);
  });

  it('clears cupInfo on an explicit null (the arena pass-through semantics)', () => {
    const { client } = bareClient(1);
    apply(client, selfRecord(1, { vcup: sampleCup() }));
    expect(client.cupInfo).not.toBeNull();
    apply(client, selfRecord(1, { vcup: null }));
    expect(client.cupInfo).toBeNull();
  });
});

describe('sport-known rebuild (the wire trap)', () => {
  const classKnownIds = abilitiesKnownAt(
    'warrior',
    10,
    computeTalentModifiers('warrior', emptyAllocation()),
  ).map((k) => k.def.id);

  it('resolves the role kit via the shared resolver while s.sport carries a role', () => {
    const { client } = bareClient(1);
    apply(client, selfRecord(1));
    expect(client.known.map((k) => k.def.id)).toEqual(classKnownIds);

    apply(client, selfRecord(1, { sport: { role: 'keeper' } }));
    expect(client.known.map((k) => k.def.id)).toEqual([...SPORT_KITS.keeper]);
    // sport moves are flat rank-1, cost-0 records (no talent scaling online)
    for (const k of client.known) {
      expect(k.rank).toBe(1);
      expect(k.cost).toBe(0);
    }
  });

  it('keeps the sport kit across sport-omitted snapshots (delta guard)', () => {
    const { client } = bareClient(1);
    apply(client, selfRecord(1, { sport: { role: 'striker' } }));
    apply(client, selfRecord(1)); // no `sport` key: the mirrored role survives
    expect(client.known.map((k) => k.def.id)).toEqual([...SPORT_KITS.striker]);
  });

  it('returns to the class/level/talent derivation on an explicit sport null', () => {
    const { client } = bareClient(1);
    apply(client, selfRecord(1, { sport: { role: 'keeper' } }));
    expect(client.known.map((k) => k.def.id)).toEqual([...SPORT_KITS.keeper]);

    apply(client, selfRecord(1, { sport: null }));
    expect(client.known.map((k) => k.def.id)).toEqual(classKnownIds);
  });
});

describe('IWorldValeCup command sends', () => {
  it('vcupQueueJoin sends vcup_queue with bracket, nation, role, and guild flag', () => {
    const { client, sent } = bareClient(1);
    client.vcupQueueJoin(3, 'vale', 'striker', true);
    expect(sent).toEqual([
      { t: 'cmd', cmd: 'vcup_queue', bracket: 3, nation: 'vale', role: 'striker', guild: true },
    ]);
  });

  it('vcupQueueLeave sends vcup_leave', () => {
    const { client, sent } = bareClient(1);
    client.vcupQueueLeave();
    expect(sent).toEqual([{ t: 'cmd', cmd: 'vcup_leave' }]);
  });

  it('vcupSetRole sends vcup_role with the role', () => {
    const { client, sent } = bareClient(1);
    client.vcupSetRole('keeper');
    expect(sent).toEqual([{ t: 'cmd', cmd: 'vcup_role', role: 'keeper' }]);
  });

  it('vcupPracticeStart sends vcup_practice with the bracket (parallel instanced practice)', () => {
    const { client, sent } = bareClient(1);
    client.vcupPracticeStart(3);
    expect(sent).toEqual([{ t: 'cmd', cmd: 'vcup_practice', bracket: 3 }]);
  });
});
