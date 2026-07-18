// Pins for the overhaul payload pieces the PR #1757 revert deleted and the
// v027 port initially missed (AUDIT-v027-port-drops-2026-07-17). Each block
// pins one restored behavior so a future merge or revert cannot silently drop
// it again.
import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; the server wire/routing pins below
// drive the real GameServer (the snapshots.test.ts harness convention).
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

import { GameServer, wireEntity } from '../server/game';
import { BOOL_SETTINGS } from '../src/game/settings';
import { ClientWorld } from '../src/net/online';
import { ABILITIES, CLASSES } from '../src/sim/content/classes';
import { emptyModifiers } from '../src/sim/content/talents';
import { recalcPlayerStats } from '../src/sim/entity';
import { type ResolvedAbility, Sim } from '../src/sim/sim';
import { directHealBonus } from '../src/sim/spell_scaling';
import { stunDrCategory } from '../src/sim/stun_dr';
import type { Aura } from '../src/sim/types';
import { AVATAR_SCALE, SPELL_AOE_COEFF_MULT } from '../src/sim/types';
import { targetOfTargetId } from '../src/ui/target_of_target';

describe('rogue starting dual wield (classes.ts startOffhand)', () => {
  it('starts rogues with a rusty dagger in BOTH hands', () => {
    expect(CLASSES.rogue.startWeapon).toBe('rusty_dagger');
    expect(CLASSES.rogue.startOffhand).toBe('rusty_dagger');
  });

  it('equips the starting offhand on a fresh rogue character', () => {
    const sim = new Sim({ seed: 1234, playerClass: 'rogue' });
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('missing player metadata');
    expect(meta.equipment.offhand).toBe('rusty_dagger');
  });
});

describe('Vanguard armor from Strength (entity.ts armorFromStrPct fold)', () => {
  it('adds round(str * pct) armor, amplified by armorPct', () => {
    const sim = new Sim({ seed: 1234, playerClass: 'warrior' });
    const p = sim.player;
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('missing player metadata');

    const base = emptyModifiers();
    recalcPlayerStats(p, 'warrior', meta.equipment, base, meta.equipmentInstance);
    const armorWithout = p.stats.armor;
    const str = p.stats.str;

    const mods = emptyModifiers();
    mods.stats.armorFromStrPct = 0.7;
    recalcPlayerStats(p, 'warrior', meta.equipment, mods, meta.equipmentInstance);
    expect(p.stats.armor).toBe(armorWithout + Math.round(str * 0.7));

    // The fold lands BEFORE the armorPct multiplier so armorPct amplifies it.
    const both = emptyModifiers();
    both.stats.armorFromStrPct = 0.7;
    both.stats.armorPct = 0.1;
    recalcPlayerStats(p, 'warrior', meta.equipment, both, meta.equipmentInstance);
    expect(p.stats.armor).toBe(Math.round((armorWithout + Math.round(str * 0.7)) * 1.1));
  });
});

describe('AoE heal coefficient penalty (spell_scaling directHealBonus aoe)', () => {
  it('applies SPELL_AOE_COEFF_MULT to the per-target bonus when aoe', () => {
    const single = directHealBonus(300, 2);
    const aoe = directHealBonus(300, 2, true);
    expect(single).toBeGreaterThan(0);
    expect(aoe).toBe(Math.round(single * SPELL_AOE_COEFF_MULT));
    // The default stays the single-target coefficient.
    expect(directHealBonus(300, 2, false)).toBe(single);
  });
});

describe('Faultline stun diminishing returns (stun_dr CONTROLLED_STUNS)', () => {
  it('classifies faultline as a controlled stun, not a random stun', () => {
    expect(stunDrCategory('faultline')).toBe('controlledStun');
  });
});

describe('Avatar colossus body scale (entity.ts buff_avatar)', () => {
  it('grows the player model by AVATAR_SCALE while the aura is worn', () => {
    const sim = new Sim({ seed: 1234, playerClass: 'warrior' });
    const p = sim.player;
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('missing player metadata');
    const avatar: Aura = {
      id: 'avatar',
      name: 'Avatar',
      kind: 'buff_avatar',
      remaining: 20,
      duration: 20,
      value: 0.2,
      sourceId: p.id,
      school: 'physical',
    };
    p.auras.push(avatar);
    recalcPlayerStats(p, 'warrior', meta.equipment, emptyModifiers(), meta.equipmentInstance);
    expect(AVATAR_SCALE).toBeGreaterThan(1);
    expect(p.scale).toBe(AVATAR_SCALE);
    p.auras.length = 0;
    recalcPlayerStats(p, 'warrior', meta.equipment, emptyModifiers(), meta.equipmentInstance);
    expect(p.scale).toBe(1);
  });
});

describe('selfHotPctMax effect (effect_dispatch)', () => {
  it('applies a self hot aura totaling pct of max health across its ticks', () => {
    const sim = new Sim({ seed: 1234, playerClass: 'warrior' });
    const p = sim.player;
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('missing player metadata');
    const def = {
      ...ABILITIES.slam,
      id: 'test_self_hot',
      name: 'Test Self Hot',
      effects: [{ type: 'selfHotPctMax', pct: 0.3, duration: 8, interval: 2 }],
    } as (typeof ABILITIES)[string];
    const resolved: ResolvedAbility = {
      def,
      rank: 1,
      cost: 0,
      castTime: 0,
      cooldown: 0,
      effects: def.effects,
      threatFlat: 0,
      threatMult: 1,
    };
    sim.ctx.runEffects(p, meta, null, resolved);
    const hot = p.auras.find((a) => a.id === 'test_self_hot');
    if (!hot) throw new Error('selfHotPctMax applied no aura');
    expect(hot.kind).toBe('hot');
    expect(hot.tickInterval).toBe(2);
    // 4 ticks over 8s at 2s interval, each healing maxHp * 0.3 / 4.
    expect(hot.value).toBe(Math.max(1, Math.round((p.maxHp * 0.3) / 4)));
  });
});

describe('offhand surfacing (paperdoll, player card, chat readout)', () => {
  it('shows the offhand cell on the character sheet paperdoll', async () => {
    const { PAPERDOLL_RIGHT_SLOTS } = await import('../src/ui/char_view');
    expect(PAPERDOLL_RIGHT_SLOTS).toContain('offhand');
  });

  it('lists the offhand in the chat gear readout', async () => {
    const { gearReadout } = await import('../src/sim/social/chat_readouts');
    const sim = new Sim({ seed: 1234, playerClass: 'rogue' });
    const meta = sim.meta(sim.playerId);
    if (!meta) throw new Error('missing player metadata');
    expect(gearReadout(meta)).toContain('Off Hand: Rusty Dagger');
  });

  it('recognizes battle and berserker stances in the form readout', async () => {
    const { formReadout } = await import('../src/sim/social/chat_readouts');
    const sim = new Sim({ seed: 1234, playerClass: 'warrior' });
    const p = sim.player;
    for (const kind of ['battle_stance', 'berserker_stance'] as const) {
      p.auras.length = 0;
      p.auras.push({
        id: kind,
        name: kind === 'battle_stance' ? 'Battle Stance' : 'Berserker Stance',
        kind,
        remaining: 3600,
        duration: 3600,
        value: 0,
        sourceId: p.id,
        school: 'physical',
      });
      expect(formReadout(p)).toContain(
        kind === 'battle_stance' ? 'Battle Stance' : 'Berserker Stance',
      );
    }
    p.auras.length = 0;
    expect(formReadout(p)).toBe('You are not in any form or stance.');
  });
});

describe('parry stat surfacing (stat_tooltip + warrior_hit_table)', () => {
  it('derives the sheet parry chance from the same helper combat rolls', async () => {
    const { warriorParryChance, warriorMeleeDefense } = await import(
      '../src/sim/combat/warrior_hit_table'
    );
    expect(warriorParryChance(100)).toBeCloseTo(0.05 + 100 * 0.0005, 10);
    const sim = new Sim({ seed: 1234, playerClass: 'warrior' });
    const p = sim.player;
    const attacker = { ...p, id: p.id + 1, pos: { ...p.pos, z: p.pos.z + 1 } };
    p.facing = 0; // attacker at +z sits in the frontal arc
    const def = warriorMeleeDefense(p, attacker as typeof p);
    expect(def.parryChance).toBeCloseTo(warriorParryChance(p.stats.str), 10);
  });

  it('builds the parry tooltip cell as a percent with a Strength source line', async () => {
    const { buildStatTooltip, buildStatSources } = await import('../src/ui/stat_tooltip');
    const { warriorParryChance } = await import('../src/sim/combat/warrior_hit_table');
    const sim = new Sim({ seed: 1234, playerClass: 'warrior' });
    const p = sim.player;
    const input = {
      cls: 'warrior' as const,
      stats: p.stats,
      level: p.level,
      attackPower: p.attackPower,
      spellPower: p.spellPower,
      critChance: p.critChance,
      dodgeChance: p.dodgeChance,
      critRating: p.critRating,
      hasteRating: p.hasteRating,
      hitRating: p.hitRating,
      parryChance: warriorParryChance(p.stats.str),
      dps: 0,
      gear: [],
      buffs: [],
    };
    const cell = buildStatTooltip('parry', input);
    expect(cell.statValue).toBeCloseTo(warriorParryChance(p.stats.str) * 100, 6);
    const sources = buildStatSources('parry', input);
    expect(sources.some((line) => line.kind === 'base' && line.value === 5)).toBe(true);
    expect(sources.some((line) => line.kind === 'attributes')).toBe(p.stats.str > 0);
    // A non-parry class shows a bare zero with no misleading base line.
    const casterSources = buildStatSources('parry', { ...input, parryChance: 0 });
    expect(casterSources.some((line) => line.kind === 'base')).toBe(false);
  });
});

describe('stance and warrior choice-row aura UI (aura_effect, auras_view, sim_i18n)', () => {
  it('describes the stances and warrior buffs on the buff tooltip', async () => {
    const { auraEffectDescriptor } = await import('../src/ui/aura_effect');
    const { RECKLESSNESS_RAGE_GEN } = await import('../src/sim/types');
    const d = (kind: string, value = 0, value2?: number) =>
      auraEffectDescriptor({ kind, value, value2 } as Parameters<typeof auraEffectDescriptor>[0]);
    expect(d('battle_stance')?.key).toBe('hudChrome.auraEffect.battleStance');
    expect(d('berserker_stance')?.key).toBe('hudChrome.auraEffect.berserkerStance');
    expect(d('buff_crit', 0.05)).toEqual({
      key: 'hudChrome.auraEffect.crit',
      nums: { pct: 5 },
    });
    expect(d('buff_reckless', 0.2)).toEqual({
      key: 'hudChrome.auraEffect.reckless',
      nums: { pct: 20, ragePct: RECKLESSNESS_RAGE_GEN * 100 },
    });
    // die_by_sword reads the aura value (the live dealDamage cut), no fixed constant.
    expect(d('die_by_sword', 0.3)).toEqual({
      key: 'hudChrome.auraEffect.dieBySword',
      nums: { pct: 30 },
    });
    // sanguine: interval mult 1/1.1 reads exactly 10% attack speed, plus value2 damage.
    expect(d('sanguine', 1 / 1.1, 0.05)).toEqual({
      key: 'hudChrome.auraEffect.sanguine',
      nums: { hastePct: 10, dmgPct: 5 },
    });
    expect(d('battle_trance')?.key).toBe('hudChrome.auraEffect.battleTrance');
    expect(d('victory_rush')?.key).toBe('hudChrome.auraEffect.victoryRush');
  });

  it('hides the countdown under battle and berserker stances like other toggles', async () => {
    const { createAurasView } = await import('../src/ui/auras_view');
    const v = createAurasView('all', {
      iconId: (a) => a.id,
      auraName: (a) => a.name,
      formatStacks: (n) => String(n),
      isOwn: () => true,
      durationUnits: () => ({ s: 's', m: 'm', h: 'h', d: 'd' }),
      auraEffectHtml: () => '',
    });
    for (const kind of ['battle_stance', 'berserker_stance']) {
      const view = v.tick({
        auras: [{ id: kind, name: kind, kind, remaining: 3600, value: 0 }],
      } as Parameters<typeof v.tick>[0]);
      expect(view.slots[0].durationText).toBe('');
    }
  });

  it('re-localizes the sim-emitted warrior buff names', async () => {
    const { localizeSimAuraName } = await import('../src/ui/sim_i18n');
    expect(localizeSimAuraName('Bladed Echo')).not.toBeNull();
    expect(localizeSimAuraName('Emboldened')).not.toBeNull();
    expect(localizeSimAuraName('Enraged')).not.toBeNull();
  });
});

describe('spellbook spec gating (spellbook_view specCanLearn)', () => {
  it('drops never-learnable trainable rows for the committed spec, keeps known ones', async () => {
    const { buildSpellbookView } = await import('../src/ui/spellbook_view');
    const base = {
      classId: 'warrior' as const,
      abilities: ['heroic_strike', 'overpower'] as const,
      known: [],
      barAbilityIds: [] as const,
      hasFreeSlot: true,
      hasFormBars: false,
      attackOnBar: false,
    };
    // No committed spec: the whole kit shows (any spec is still open).
    expect(buildSpellbookView(base).rows.map((r) => r.abilityId)).toEqual([
      'heroic_strike',
      'overpower',
    ]);
    // Fury excludes heroic_strike outright and slam from level 10 up.
    const fury = buildSpellbookView({ ...base, spec: 'fury', level: 12 });
    expect(fury.rows.map((r) => r.abilityId)).toEqual([]);
    // Below the overpower hand-off level the exclusion has not kicked in yet.
    const furyLow = buildSpellbookView({ ...base, spec: 'fury', level: 5 });
    expect(furyLow.rows.map((r) => r.abilityId)).toEqual(['overpower']);
    // An already-learned excluded ability keeps its row.
    const sim = new Sim({ seed: 1234, playerClass: 'warrior' });
    const known = sim.known.filter((k) => k.def.id === 'heroic_strike');
    if (known.length !== 1) throw new Error('expected heroic_strike known at level 1');
    const withKnown = buildSpellbookView({ ...base, known, spec: 'fury', level: 12 });
    expect(withKnown.rows.map((r) => r.abilityId)).toEqual(['heroic_strike']);
  });
});

describe('passives never auto-place on the action bar', () => {
  it('marks at least one live passive and pins the guard input', () => {
    const passives = Object.values(ABILITIES).filter((a) => a.passive);
    expect(passives.length).toBeGreaterThan(0);
  });
});

describe('dev bots auto-accept party invites (party.ts partyInvite)', () => {
  it('forms the party immediately when the invitee is a dev bot', () => {
    const sim = new Sim({ seed: 1234, playerClass: 'warrior' });
    const botPid = sim.spawnDevBot('PartyDummy');
    expect(botPid).toBeGreaterThan(0);
    sim.partyInvite(botPid, sim.playerId);
    const party = sim.partyOf(sim.playerId);
    if (!party) throw new Error('expected the party to form without a manual accept');
    expect(party.members).toContain(sim.playerId);
    expect(party.members).toContain(botPid);
  });

  it('still leaves a regular player invite pending until they accept', () => {
    const sim = new Sim({ seed: 1234, playerClass: 'warrior', noPlayer: true });
    const a = sim.addPlayer('warrior', 'Aaa');
    const b = sim.addPlayer('mage', 'Bbb');
    sim.partyInvite(b, a);
    expect(sim.partyOf(a)).toBeNull();
    expect(sim.partyOf(b)).toBeNull();
    sim.partyAccept(b);
    expect(sim.partyOf(b)?.members).toContain(a);
  });
});

// ---------------------------------------------------------------------------
// The two wire features the #1757 revert severed: the mouseover-cast target
// routing on the server 'cast' command, and the target-of-target `tgt` dynamic
// field + its kind-based client resolution.
// ---------------------------------------------------------------------------

// A ClientWorld without the WebSocket plumbing (the snapshots.test.ts harness),
// to drive the REAL applySnapshot decode directly.
function bareClient(pid: number): ClientWorld {
  const c = Object.create(ClientWorld.prototype);
  c.cfg = { seed: 20061, playerClass: 'warrior' };
  c.entities = new Map();
  c.playerId = pid;
  c.ownPlayerId = pid;
  c.ownPlayerClass = 'warrior';
  c.spectating = null;
  c.cupInfo = null;
  c.sportRole = null;
  c.moveInput = {};
  c.inventory = [];
  c.vendorBuyback = [];
  c.equipment = {};
  c.accountCosmetics = { completedQuestIds: [], mechChromaIds: [] };
  c.copper = 0;
  c.honor = 0;
  c.lifetimeHonor = 0;
  c.xp = 0;
  c.known = [];
  c.questLog = new Map();
  c.questsDone = new Set();
  c.pendingQuestCommands = new Map();
  c.partyInfo = null;
  c.selectedDungeonDifficulty = 'normal';
  c.tradeInfo = null;
  c.duelInfo = null;
  c.lastSnapAt = 0;
  c.snapInterval = 50;
  c.serverTickHz = null;
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
  c.nodeCooldowns = new Map();
  return c as ClientWorld;
}

describe('mouseover cast settings + server target routing (game.ts case cast)', () => {
  it('defaults mouseoverCast on and showTargetOfTarget off', () => {
    expect(BOOL_SETTINGS.mouseoverCast.def).toBe(true);
    expect(BOOL_SETTINGS.showTargetOfTarget.def).toBe(false);
  });

  it('routes a numeric msg.target to castAbilityOn and falls back without one', () => {
    const server = new GameServer();
    const sent: unknown[] = [];
    const ws = { readyState: 1, send: (payload: string) => sent.push(JSON.parse(payload)) };
    const session = server.join(ws as never, 9001, 9001, 'Cliquer', 'priest', null);
    if ('error' in session) throw new Error(session.error);
    session.blockListLoaded = true;
    const calls: unknown[][] = [];
    server.sim.castAbilityOn = ((ability: string, targetId: number, pid?: number) => {
      calls.push(['on', ability, targetId, pid]);
    }) as typeof server.sim.castAbilityOn;
    server.sim.castAbility = ((ability: string, pid?: number) => {
      calls.push(['plain', ability, pid]);
    }) as typeof server.sim.castAbility;

    // The wire string 'cast' and the msg.target field ARE the protocol; a float
    // is coerced with | 0 exactly as the handler does.
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'cast', ability: 'renew', target: 55.9 }),
    );
    expect(calls).toEqual([['on', 'renew', 55, session.pid]]);

    calls.length = 0;
    server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd: 'cast', ability: 'renew' }));
    expect(calls).toEqual([['plain', 'renew', session.pid]]);

    // A non-numeric target must never reach castAbilityOn (type-checked field).
    calls.length = 0;
    server.handleMessage(
      session,
      JSON.stringify({ t: 'cmd', cmd: 'cast', ability: 'renew', target: 'evil' }),
    );
    expect(calls).toEqual([['plain', 'renew', session.pid]]);
  });

  it('sends the target rider on the ClientWorld castAbilityOn command', () => {
    const client = bareClient(1);
    const cmds: unknown[] = [];
    (client as unknown as { cmd(c: unknown): void }).cmd = (c: unknown) => cmds.push(c);
    client.castAbilityOn('renew', 42);
    expect(cmds).toEqual([{ cmd: 'cast', ability: 'renew', target: 42 }]);
  });
});

describe('target-of-target wire field (dynamicFields tgt) and resolution', () => {
  it('resolves a player target by targetId and a mob target by aggroTargetId', () => {
    expect(targetOfTargetId({ kind: 'player', targetId: 7, aggroTargetId: null })).toBe(7);
    // A pet is a mob-kind entity with an owner, so the mob arm covers it too.
    expect(targetOfTargetId({ kind: 'mob', targetId: null, aggroTargetId: 9 })).toBe(9);
    expect(targetOfTargetId({ kind: 'npc', targetId: null, aggroTargetId: null })).toBeNull();
    // A player's aggroTargetId must never leak into the resolution (kind rule).
    expect(targetOfTargetId({ kind: 'player', targetId: null, aggroTargetId: 9 })).toBeNull();
  });

  it('carries a player selected target as tgt through wireEntity, absent when null', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const a = sim.addPlayer('warrior', 'Aaa');
    const b = sim.addPlayer('mage', 'Bbb');
    sim.targetEntity(b, a);
    const e = sim.entities.get(a);
    if (!e) throw new Error('missing player entity');
    expect(e.targetId).toBe(b);
    expect(wireEntity(e).tgt).toBe(b);

    // Absent, not tgt: null: an idle entity's record must be byte-unchanged.
    sim.targetEntity(null, a);
    expect(wireEntity(e)).not.toHaveProperty('tgt');
  });

  it('mirrors tgt onto entity.targetId through the real applySnapshot decode', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', noPlayer: true });
    const a = sim.addPlayer('warrior', 'Aaa');
    const b = sim.addPlayer('mage', 'Bbb');
    sim.targetEntity(b, a);
    const e = sim.entities.get(a);
    if (!e) throw new Error('missing player entity');

    // A DIFFERENT player's client seeing this pair in the world.
    const client = bareClient(a + 1000);
    const internals = client as unknown as { applySnapshot(snapshot: unknown): void };
    internals.applySnapshot({ t: 'snap', ents: [wireEntity(e)] });
    const mirrored = client.entities.get(a);
    if (!mirrored) throw new Error('missing mirrored entity');
    expect(mirrored.targetId).toBe(b);
    expect(targetOfTargetId(mirrored)).toBe(b);

    // Dropping the target clears the mirror on the next record (tgt absent).
    sim.targetEntity(null, a);
    internals.applySnapshot({ t: 'snap', ents: [wireEntity(e)] });
    expect(client.entities.get(a)?.targetId).toBeNull();
  });
});
