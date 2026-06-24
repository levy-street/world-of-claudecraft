import { describe, expect, it } from 'vitest';
import {
  abilitiesKnownAt,
  CLASSES,
  CRYPT_SPAWNS,
  DUNGEON_X_THRESHOLD,
  dungeonAt,
  instanceOrigin,
  MOBS,
} from '../src/sim/data';
import { type Party, Sim } from '../src/sim/sim';
import { ALL_CLASSES, dist2d, type Entity, MAX_LEVEL } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import type { PartyMemberInfo } from '../src/world_api';

function makeWorld() {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

function mustEntity(sim: Sim, pid: number): Entity {
  const entity = sim.entities.get(pid);
  if (!entity) throw new Error(`missing entity ${pid}`);
  return entity;
}

function mustParty(sim: Sim, pid: number): Party {
  const party = sim.partyOf(pid);
  if (!party) throw new Error(`missing party for ${pid}`);
  return party;
}

function mustPartyMember(sim: Sim, pid: number): PartyMemberInfo {
  const member = sim.partyInfo?.members.find((m) => m.pid === pid);
  if (!member) throw new Error(`missing party member ${pid}`);
  return member;
}

function teleport(sim: Sim, pid: number, x: number, z: number) {
  const e = mustEntity(sim, pid);
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
}

function face(sim: Sim, pid: number, targetId: number) {
  const e = mustEntity(sim, pid);
  const t = mustEntity(sim, targetId);
  e.facing = Math.atan2(t.pos.x - e.pos.x, t.pos.z - e.pos.z);
}

function fillPartyToFive(sim: Sim, leader: number): number[] {
  const added: number[] = [];
  while ((sim.partyOf(leader)?.members.length ?? 1) < 5) {
    const pid = sim.addPlayer('priest', `RaidFill${added.length}`);
    sim.partyInvite(pid, leader);
    sim.partyAccept(pid);
    added.push(pid);
  }
  return added;
}

function nearestMob(
  sim: Sim,
  templateId: string,
  from: { x: number; z: number } = { x: 0, z: 0 },
): Entity {
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const e of sim.entities.values()) {
    if (e.kind !== 'mob' || e.dead || e.templateId !== templateId) continue;
    const d = Math.hypot(e.pos.x - from.x, e.pos.z - from.z);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) throw new Error(`missing mob ${templateId}`);
  return best;
}

describe('nine classes', () => {
  it('every class spawns with a working kit and stats', () => {
    for (const cls of ALL_CLASSES) {
      const sim = new Sim({ seed: 42, playerClass: cls });
      const p = sim.player;
      expect(p.maxHp).toBeGreaterThan(30);
      expect(sim.known.length).toBeGreaterThan(0);
      // Expanded kits can exceed the 12 action-bar slots; overflow remains
      // available from the spellbook and can be dragged onto the bar.
      expect(CLASSES[cls].abilities.length).toBeGreaterThan(0);
      // the full kit resolves at MAX_LEVEL; the 10-20 band still has things to learn
      const kit = abilitiesKnownAt(cls, MAX_LEVEL);
      expect(kit.length).toBe(CLASSES[cls].abilities.length);
      expect(abilitiesKnownAt(cls, 10).length).toBeLessThan(kit.length);
      // every class's core kit keeps scaling: something reaches rank 3+ by 20
      expect(kit.some((k) => k.rank >= 3)).toBe(true);
      // resource type sane
      if (cls === 'warrior') expect(p.resourceType).toBe('rage');
      else if (cls === 'rogue') expect(p.resourceType).toBe('energy');
      else expect(p.resourceType).toBe('mana');
    }
  });

  it('priest heals and shields', () => {
    const sim = new Sim({ seed: 42, playerClass: 'priest' });
    const p = sim.player;
    sim.setPlayerLevel(6);
    p.hp = 30;
    sim.castAbility('lesser_heal');
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(p.hp).toBeGreaterThan(30);
    // PW:S absorbs damage
    sim.castAbility('power_word_shield');
    sim.tick();
    expect(p.auras.some((a) => a.kind === 'absorb')).toBe(true);
    const hpBefore = p.hp;
    sim.dealDamage(null, p, 20, false, 'physical', 'test', 'hit');
    expect(p.hp).toBe(hpBefore); // fully soaked
  });

  it('friendly target spells can affect selected players', () => {
    const sim = makeWorld();
    const priestId = sim.addPlayer('priest', 'Healer');
    const priest = mustEntity(sim, priestId);
    const allyId = sim.addPlayer('warrior', 'Ally');
    const ally = mustEntity(sim, allyId);
    teleport(sim, priestId, ally.pos.x + 5, ally.pos.z);
    sim.setPlayerLevel(6, priestId);
    priest.resource = priest.maxResource;
    ally.hp = 20;

    sim.targetEntity(ally.id, priestId);
    sim.castAbility('lesser_heal', priestId);
    for (let i = 0; i < 20 * 3; i++) sim.tick();
    expect(ally.hp).toBeGreaterThan(20);

    for (let i = 0; i < 25; i++) sim.tick();
    sim.castAbility('power_word_shield', priestId);
    sim.tick();
    expect(ally.auras.some((a) => a.kind === 'absorb')).toBe(true);
  });

  it('renew ticks healing over time', () => {
    const sim = new Sim({ seed: 42, playerClass: 'priest' });
    sim.setPlayerLevel(8);
    const p = sim.player;
    p.hp = 20;
    sim.castAbility('renew');
    for (let i = 0; i < 20 * 7; i++) sim.tick();
    expect(p.hp).toBeGreaterThan(30);
  });

  it('paladin seal empowers swings and judgement consumes it', () => {
    const sim = new Sim({ seed: 42, playerClass: 'paladin' });
    sim.setPlayerLevel(4);
    const p = sim.player;
    sim.castAbility('seal_of_righteousness');
    sim.tick();
    expect(p.auras.some((a) => a.kind === 'imbue')).toBe(true);
    const wolf = nearestMob(sim, 'forest_wolf');
    teleport(sim, p.id, wolf.pos.x + 3, wolf.pos.z);
    sim.targetEntity(wolf.id);
    face(sim, p.id, wolf.id);
    p.resource = p.maxResource;
    // wait out gcd then judge
    for (let i = 0; i < 35; i++) sim.tick();
    // Judgement's spell hit is an RNG roll (capped at 99%), so a single cast can
    // miss on some world seeds and deal no damage. Re-seal and retry until it
    // lands, so this checks the mechanic (judgement hits and consumes the seal)
    // rather than a lucky roll — robust to RNG-stream shifts from new content.
    let landed = false;
    for (let attempt = 0; attempt < 25 && !landed; attempt++) {
      if (!p.auras.some((a) => a.kind === 'imbue')) {
        sim.castAbility('seal_of_righteousness');
        sim.tick();
      }
      p.gcdRemaining = 0;
      p.cooldowns.delete('judgement');
      p.resource = p.maxResource;
      face(sim, p.id, wolf.id);
      const dealtBefore = sim.counters.damageDealt;
      sim.castAbility('judgement');
      sim.tick();
      landed = sim.counters.damageDealt > dealtBefore;
    }
    expect(landed).toBe(true); // judgement connected and dealt damage
    expect(p.auras.some((a) => a.kind === 'imbue')).toBe(false); // consumed
  });

  it('warlock life taps and drains life', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warlock' });
    sim.setPlayerLevel(10);
    const p = sim.player;
    p.resource = 10;
    const hpBefore = p.hp;
    sim.castAbility('life_tap');
    sim.tick();
    expect(p.hp).toBe(hpBefore - 30);
    expect(p.resource).toBe(40);
    // drain life channel heals
    const wolf = nearestMob(sim, 'forest_wolf');
    teleport(sim, p.id, wolf.pos.x + 10, wolf.pos.z);
    sim.targetEntity(wolf.id);
    face(sim, p.id, wolf.id);
    p.hp = 30;
    p.resource = p.maxResource;
    for (let i = 0; i < 35; i++) sim.tick();
    face(sim, p.id, wolf.id);
    sim.castAbility('drain_life');
    for (let i = 0; i < 20 * 6 && p.castingAbility; i++) sim.tick();
    expect(p.hp).toBeGreaterThan(30);
  });

  it('hunter kills with ranged auto shot from distance', () => {
    const sim = new Sim({ seed: 42, playerClass: 'hunter' });
    const p = sim.player;
    const wolf = nearestMob(sim, 'forest_wolf');
    p.maxHp = 500;
    p.hp = 500;
    wolf.hp = 60;
    teleport(sim, p.id, wolf.pos.x + 35, wolf.pos.z);
    sim.targetEntity(wolf.id);
    face(sim, p.id, wolf.id);
    sim.startAutoAttack();
    let killed = false;
    let autoShots = 0;
    for (let i = 0; i < 20 * 60 && !killed; i++) {
      face(sim, p.id, wolf.id);
      const events = sim.tick();
      for (const ev of events) {
        if (ev.type === 'damage' && ev.ability === 'Auto Shot' && ev.kind === 'hit') autoShots++;
        if (ev.type === 'death' && ev.entityId === wolf.id) killed = true;
      }
    }
    expect(killed).toBe(true);
    expect(autoShots).toBeGreaterThan(0); // ranged shots landed before melee
  });

  it('lightning shield zaps attackers (thorns)', () => {
    const sim = new Sim({ seed: 42, playerClass: 'shaman' });
    sim.setPlayerLevel(8);
    const p = sim.player;
    sim.castAbility('lightning_shield');
    sim.tick();
    const wolf = nearestMob(sim, 'forest_wolf');
    // The level-based miss curve means a L1-2 wolf almost never lands a hit on an L8
    // player, so match its level to the player to actually exercise the reflect.
    wolf.level = p.level;
    teleport(sim, p.id, wolf.pos.x + 2, wolf.pos.z);
    const wolfHpBefore = wolf.hp;
    let zapped = false;
    for (let i = 0; i < 20 * 15 && !zapped; i++) {
      sim.tick();
      if (wolf.hp < wolfHpBefore) zapped = true;
    }
    expect(zapped).toBe(true);
  });

  it('druid bear form toggles and raises armor', () => {
    const sim = new Sim({ seed: 42, playerClass: 'druid' });
    sim.setPlayerLevel(10);
    const p = sim.player;
    const armorBefore = p.stats.armor;
    sim.castAbility('bear_form');
    sim.tick();
    expect(p.auras.some((a) => a.kind === 'form_bear')).toBe(true);
    expect(p.stats.armor).toBeGreaterThan(armorBefore * 1.4);
    for (let i = 0; i < 35; i++) sim.tick();
    sim.castAbility('bear_form');
    sim.tick();
    expect(p.auras.some((a) => a.kind === 'form_bear')).toBe(false);
    expect(p.stats.armor).toBe(armorBefore);
  });
});

describe('elite mobs', () => {
  it('elites scale like vanilla elites (~2.3x hp, 1.5x damage, 2x xp)', () => {
    const sim = makeWorld();
    const pid = sim.addPlayer('warrior', 'Tank');
    sim.enterCrypt(pid);
    const origin = instanceOrigin(0, 0);
    const shambler = nearestMob(sim, 'crypt_shambler', origin);
    expect(shambler).toBeTruthy();
    const t = MOBS.crypt_shambler;
    const normalHp = t.hpBase + t.hpPerLevel * (shambler.level - 1);
    expect(shambler.maxHp).toBe(Math.round(normalHp * 2.3));
    const normalDmg = t.dmgBase + t.dmgPerLevel * (shambler.level - 1);
    expect(shambler.weapon.max).toBe(Math.round(normalDmg * 1.5 * 1.25));
  });
});

describe('parties', () => {
  function makeDuo(): { sim: Sim; a: number; b: number } {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    return { sim, a, b };
  }

  it('invite/accept forms a party; leave disbands at 1', () => {
    const { sim, a, b } = makeDuo();
    expect(sim.partyOf(a)?.members).toEqual([a, b]);
    expect(sim.partyOf(a)?.leader).toBe(a);
    sim.partyLeave(b);
    expect(sim.partyOf(a)).toBe(null);
    expect(sim.partyOf(b)).toBe(null);
  });

  it('does not replace a pending party invite', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    sim.partyInvite(b, a);
    sim.partyInvite(b, c);
    sim.partyAccept(b);
    expect(sim.partyOf(a)?.members).toEqual([a, b]);
    expect(sim.partyOf(c)).toBe(null);
  });

  it('allows a new party invite after decline or expiry', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    sim.partyInvite(b, a);
    sim.partyDecline(b);
    sim.partyInvite(b, c);
    sim.partyAccept(b);
    expect(sim.partyOf(c)?.members).toEqual([c, b]);
    expect(sim.partyOf(a)).toBe(null);

    const d = sim.addPlayer('mage', 'Dalet');
    const e = sim.addPlayer('warrior', 'Heh');
    sim.partyInvite(d, a);
    for (let i = 0; i < 20 * 31; i++) sim.tick();
    sim.partyInvite(d, e);
    sim.partyAccept(d);
    expect(sim.partyOf(e)?.members).toEqual([e, d]);
    expect(sim.partyOf(a)).toBe(null);
  });

  it('refuses to accept an invite while already in a party', () => {
    // A player can become a party leader (by inviting someone who accepts)
    // while still holding an unconsumed incoming invite — inviting someone
    // never consumes the inviter's own pending invite. Accepting that stale
    // invite must NOT leave the player a member of two parties at once.
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const c = sim.addPlayer('rogue', 'Gimel');
    const d = sim.addPlayer('mage', 'Dalet');
    // C invites A while A is solo (stored, unaccepted).
    sim.partyInvite(a, c);
    // A forms a party of its own by inviting D, who accepts. A is now leader.
    sim.partyInvite(d, a);
    sim.partyAccept(d);
    expect(sim.partyOf(a)?.leader).toBe(a);
    const ownParty = sim.partyOf(a)?.id;
    // A now accepts C's stale invite — this must be rejected.
    sim.partyAccept(a);
    // A stays in its own party only; no second membership is created.
    expect(sim.partyOf(a)?.id).toBe(ownParty);
    expect(sim.partyOf(c)?.members.includes(a) ?? false).toBe(false);
    expect(sim.partyOf(a)?.members).toEqual([a, d]);
  });

  it('partyInfo reports per-member combat state for the UI badges', () => {
    const { sim, b } = makeDuo();
    // out of combat by default
    const before = mustPartyMember(sim, b);
    expect(before.inCombat).toBe(0);
    // engaging a member flips its flag in the next info read
    mustEntity(sim, b).inCombat = true;
    const after = mustPartyMember(sim, b);
    expect(after.inCombat).toBe(1);
    // and the dead flag stays independent of combat
    expect(after.dead).toBe(0);
  });

  it('partyInfo carries member position so the minimap can place them', () => {
    const { sim, b } = makeDuo();
    teleport(sim, b, 17, -23);
    const info = mustPartyMember(sim, b);
    expect(info.x).toBeCloseTo(17, 3);
    expect(info.z).toBeCloseTo(-23, 3);
  });

  it('converts a party to a two-group raid with a ten player cap', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    const pids = Array.from({ length: 10 }, (_, i) => sim.addPlayer('priest', `Raid${i}`));
    for (const pid of pids.slice(0, 3)) {
      sim.partyInvite(pid, leader);
      sim.partyAccept(pid);
    }
    sim.convertPartyToRaid(leader);
    expect(sim.partyOf(leader)?.raid).toBe(false);
    sim.partyInvite(pids[3], leader);
    sim.partyAccept(pids[3]);
    sim.convertPartyToRaid(leader);
    for (const pid of pids.slice(4, 9)) {
      sim.partyInvite(pid, leader);
      sim.partyAccept(pid);
    }
    const party = mustParty(sim, leader);
    expect(party.raid).toBe(true);
    expect(party.members).toHaveLength(10);
    expect(party.members.filter((pid) => party.raidGroups.get(pid) === 1)).toHaveLength(5);
    expect(party.members.filter((pid) => party.raidGroups.get(pid) === 2)).toHaveLength(5);

    sim.partyInvite(pids[9], leader);
    sim.partyAccept(pids[9]);
    expect(sim.partyOf(pids[9])).toBeNull();
    expect(party.members).toHaveLength(10);
  });

  it('only the raid leader can move members between raid groups', () => {
    const { sim, a, b } = makeDuo();
    const [c] = fillPartyToFive(sim, a);
    sim.convertPartyToRaid(a);
    sim.moveRaidMember(c, 2, b);
    expect(sim.partyOf(a)?.raidGroups.get(c)).toBe(1);
    sim.moveRaidMember(c, 2, a);
    expect(sim.partyOf(a)?.raidGroups.get(c)).toBe(2);
    expect(sim.partyInfo?.raid).toBe(true);
    expect(sim.partyInfo?.members.find((m) => m.pid === c)?.group).toBe(2);
  });

  it('lets the raid leader convert a small raid (<= 5) back to a party', () => {
    const { sim, a, b } = makeDuo();
    const members = fillPartyToFive(sim, a);
    sim.convertPartyToRaid(a);
    expect(sim.partyOf(a)?.raid).toBe(true);

    // only the leader may demote
    sim.convertRaidToParty(b);
    expect(sim.partyOf(a)?.raid).toBe(true);

    sim.convertRaidToParty(a);
    const party = mustParty(sim, a);
    expect(party.raid).toBe(false);
    expect(party.raidGroups.size).toBe(0);
    // membership is preserved; the group is intact, just no longer a raid
    expect(party.members).toHaveLength(5);
    expect(sim.partyInfo?.raid).toBe(false);

    // converting again when it is no longer a raid is a no-op (already a party)
    sim.convertRaidToParty(a);
    expect(sim.partyOf(a)?.raid).toBe(false);
    void members;
  });

  it('refuses to demote a raid larger than one party (> 5 members)', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'BigLeader');
    const pids = Array.from({ length: 9 }, (_, i) => sim.addPlayer('priest', `Big${i}`));
    fillPartyToFive(sim, leader);
    sim.convertPartyToRaid(leader);
    for (const pid of pids.slice(0, 5)) {
      sim.partyInvite(pid, leader);
      sim.partyAccept(pid);
    }
    const party = mustParty(sim, leader);
    expect(party.members.length).toBeGreaterThan(5);
    sim.convertRaidToParty(leader);
    expect(party.raid).toBe(true);
  });

  it('blocks raid groups from standard dungeons while requiring raid groups for Nythraxis entry', () => {
    const sim = makeWorld();
    const leader = sim.addPlayer('warrior', 'Leader');
    sim.players.get(leader)?.questsDone.add('q_nythraxis_bound_guardian');
    sim.enterDungeon('nythraxis_boss_arena', leader);
    expect(sim.entities.get(leader)?.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);

    fillPartyToFive(sim, leader);
    sim.convertPartyToRaid(leader);
    sim.enterDungeon('sunken_bastion', leader);
    expect(sim.entities.get(leader)?.pos.x).toBeLessThan(DUNGEON_X_THRESHOLD);
    sim.enterDungeon('nythraxis_boss_arena', leader);
    expect(dungeonAt(mustEntity(sim, leader).pos.x)?.id).toBe('nythraxis_boss_arena');
  });

  it('party members share kill xp with the group bonus and quest credit', () => {
    const { sim, a, b } = makeDuo();
    // both accept the wolf quest
    teleport(sim, a, 4, 4);
    teleport(sim, b, 4, 5);
    sim.acceptQuest('q_wolves', a);
    sim.acceptQuest('q_wolves', b);
    const wolf = nearestMob(sim, 'forest_wolf');
    wolf.hp = 1;
    teleport(sim, a, wolf.pos.x + 2, wolf.pos.z);
    teleport(sim, b, wolf.pos.x - 2, wolf.pos.z);
    sim.targetEntity(wolf.id, a);
    face(sim, a, wolf.id);
    sim.startAutoAttack(a);
    for (let i = 0; i < 20 * 20 && !wolf.dead; i++) {
      face(sim, a, wolf.id);
      sim.tick();
    }
    expect(wolf.dead).toBe(true);
    const metaA = sim.meta(a)!;
    const metaB = sim.meta(b)!;
    // both got xp (half of solo, with 1.166 duo bonus applied)
    expect(metaA.xp).toBeGreaterThan(0);
    expect(metaB.xp).toBeGreaterThan(0);
    expect(metaA.xp).toBe(Math.round((50 * 1.166) / 2));
    // both got quest credit
    expect(metaA.questLog.get('q_wolves')?.counts[0]).toBe(1);
    expect(metaB.questLog.get('q_wolves')?.counts[0]).toBe(1);
  });

  it("party members may loot each other's tapped kills and split copper", () => {
    const { sim, a, b } = makeDuo();
    const wolf = nearestMob(sim, 'forest_wolf');
    wolf.hp = 1;
    teleport(sim, a, wolf.pos.x + 2, wolf.pos.z);
    teleport(sim, b, wolf.pos.x - 2, wolf.pos.z);
    sim.targetEntity(wolf.id, a);
    face(sim, a, wolf.id);
    sim.startAutoAttack(a);
    for (let i = 0; i < 20 * 20 && !wolf.dead; i++) {
      face(sim, a, wolf.id);
      sim.tick();
    }
    expect(wolf.lootable).toBe(true);
    const copper = wolf.loot?.copper;
    const aBefore = sim.meta(a)?.copper ?? 0;
    const bBefore = sim.meta(b)?.copper ?? 0;
    sim.lootCorpse(wolf.id, b);
    const aGain = (sim.meta(a)?.copper ?? 0) - aBefore;
    const bGain = (sim.meta(b)?.copper ?? 0) - bBefore;
    expect(aGain + bGain).toBe(copper);
    expect(Math.abs(aGain - bGain)).toBeLessThanOrEqual(1);
  });

  it('non-party members cannot loot tapped kills', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const c = sim.addPlayer('rogue', 'Gimel');
    const wolf = nearestMob(sim, 'forest_wolf');
    wolf.hp = 1;
    teleport(sim, a, wolf.pos.x + 2, wolf.pos.z);
    teleport(sim, c, wolf.pos.x - 2, wolf.pos.z);
    sim.targetEntity(wolf.id, a);
    face(sim, a, wolf.id);
    sim.startAutoAttack(a);
    for (let i = 0; i < 20 * 20 && !wolf.dead; i++) {
      face(sim, a, wolf.id);
      sim.tick();
    }
    sim.lootCorpse(wolf.id, c);
    expect(sim.meta(c)?.copper).toBe(0);
    expect(wolf.lootable).toBe(true);
  });
});

describe('duels', () => {
  it('full duel flow: challenge, countdown, fight to 1hp, winner declared', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    sim.duelRequest(b, a);
    sim.duelAccept(b);
    expect(sim.duelFor(a)?.state).toBe('countdown');
    // players can't hit each other during countdown
    sim.targetEntity(b, a);
    face(sim, a, b);
    sim.startAutoAttack(a);
    expect(sim.entities.get(a)?.autoAttack).toBe(false); // rejected: not hostile yet
    for (let i = 0; i < 20 * 4; i++) sim.tick();
    expect(sim.duelFor(a)?.state).toBe('active');
    // now combat works
    const eb = sim.entities.get(b)!;
    eb.hp = 10; // hasten the end
    sim.startAutoAttack(a);
    expect(sim.entities.get(a)?.autoAttack).toBe(true);
    let ended = false;
    let winnerEvent: any = null;
    for (let i = 0; i < 20 * 30 && !ended; i++) {
      face(sim, a, b);
      const events = sim.tick();
      const end = events.find((e) => e.type === 'duelEnd');
      if (end) {
        ended = true;
        winnerEvent = end;
      }
    }
    expect(ended).toBe(true);
    expect(winnerEvent.winnerName).toBe('Aleph');
    expect(eb.hp).toBeGreaterThanOrEqual(1); // nobody dies in a duel
    expect(eb.dead).toBe(false);
    expect(sim.duelFor(a)).toBe(null);
  });

  it('does not replace a pending duel challenge', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    teleport(sim, c, 6, -40);
    sim.duelRequest(b, a);
    sim.duelRequest(b, c);
    sim.duelAccept(b);
    expect(sim.duelFor(a)?.a).toBe(a);
    expect(sim.duelFor(a)?.b).toBe(b);
    expect(sim.duelFor(c)).toBe(null);
  });

  it('blocks other social invites until a pending duel is answered or expires', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    teleport(sim, c, 6, -40);
    sim.duelRequest(b, a);
    sim.partyInvite(b, c);
    sim.duelDecline(b);
    sim.partyInvite(b, c);
    sim.partyAccept(b);
    expect(sim.partyOf(c)?.members).toEqual([c, b]);
    expect(sim.duelFor(a)).toBe(null);

    const d = sim.addPlayer('priest', 'Dalet');
    teleport(sim, d, 9, -40);
    sim.duelRequest(d, a);
    for (let i = 0; i < 20 * 31; i++) sim.tick();
    sim.partyInvite(d, c);
    sim.partyAccept(d);
    expect(sim.partyOf(c)?.members).toContain(d);
  });
});

describe('trading', () => {
  it('atomic trade of items and copper', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    sim.addItem('wolf_fang', 3, a);
    sim.meta(a)!.copper = 100;
    sim.meta(b)!.copper = 50;
    sim.addItem('baked_bread', 1, b);

    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    expect(sim.tradeFor(a)).toBeTruthy();
    sim.tradeSetOffer([{ itemId: 'wolf_fang', count: 2 }], 30, a);
    sim.tradeSetOffer([{ itemId: 'baked_bread', count: 1 }], 10, b);
    sim.tradeConfirm(a);
    expect(sim.tradeFor(a)).toBeTruthy(); // not done until both confirm
    sim.tradeConfirm(b);
    expect(sim.tradeFor(a)).toBe(null);
    expect(sim.countItem('wolf_fang', a)).toBe(1);
    expect(sim.countItem('wolf_fang', b)).toBe(2);
    expect(sim.countItem('baked_bread', a)).toBe(1);
    expect(sim.countItem('baked_bread', b)).toBe(0);
    expect(sim.meta(a)?.copper).toBe(100 - 30 + 10);
    expect(sim.meta(b)?.copper).toBe(50 - 10 + 30);
  });

  it('does not replace a pending trade request', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    teleport(sim, c, 6, -40);
    sim.tradeRequest(b, a);
    sim.tradeRequest(b, c);
    sim.tradeAccept(b);
    expect(sim.tradeFor(a)).toBeTruthy();
    expect(sim.tradeFor(c)).toBe(null);
  });

  it('trade cancels when players walk apart', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    expect(sim.tradeFor(a)).toBeTruthy();
    teleport(sim, b, 40, -40);
    sim.tick();
    expect(sim.tradeFor(a)).toBe(null);
  });

  it('duplicate offer slots cannot duplicate items', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    sim.addItem('wolf_fang', 5, a);
    sim.meta(a)!.copper = 100;
    sim.meta(b)!.copper = 50;
    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    // exploit attempt: 6 duplicate slots, each individually covered by the bags
    const dup = Array.from({ length: 6 }, () => ({ itemId: 'wolf_fang', count: 5 }));
    sim.tradeSetOffer(dup, 0, a);
    // the merged total (30) exceeds the bags (5), so the offer must be rejected
    expect(sim.tradeFor(a)?.offerA.items.length).toBe(0);
    sim.tradeConfirm(a);
    sim.tradeConfirm(b);
    expect(sim.tradeFor(a)).toBe(null);
    expect(sim.countItem('wolf_fang', a)).toBe(5);
    expect(sim.countItem('wolf_fang', b)).toBe(0);
    expect(sim.countItem('wolf_fang', a) + sim.countItem('wolf_fang', b)).toBe(5);
    expect(sim.meta(a)?.copper).toBe(100);
    expect(sim.meta(b)?.copper).toBe(50);
  });

  it('malformed offer slots are rejected, not crashed or duplicated', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    sim.addItem('wolf_fang', 5, a);
    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    // garbage straight off the wire: null slot, non-numeric and non-finite counts
    const junk = [
      null,
      { itemId: 'wolf_fang', count: 'lots' },
      { itemId: 'wolf_fang', count: NaN },
      { itemId: 'wolf_fang', count: Infinity },
      { count: 3 },
      { itemId: 'wolf_fang', count: 2 },
    ] as any;
    // must not throw, and only the one valid slot survives
    expect(() => sim.tradeSetOffer(junk, 0, a)).not.toThrow();
    expect(sim.tradeFor(a)?.offerA.items).toEqual([{ itemId: 'wolf_fang', count: 2 }]);
    sim.tradeConfirm(a);
    sim.tradeConfirm(b);
    expect(sim.tradeFor(a)).toBe(null);
    // no NaN corruption: totals are conserved
    expect(sim.countItem('wolf_fang', a)).toBe(3);
    expect(sim.countItem('wolf_fang', b)).toBe(2);
  });

  it('duplicate slots within the bags merge and trade normally', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    sim.addItem('wolf_fang', 5, a);
    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    // two slots of 2 totals 4, within the 5 held — merged into one slot of 4
    sim.tradeSetOffer(
      [
        { itemId: 'wolf_fang', count: 2 },
        { itemId: 'wolf_fang', count: 2 },
      ],
      0,
      a,
    );
    expect(sim.tradeFor(a)?.offerA.items).toEqual([{ itemId: 'wolf_fang', count: 4 }]);
    sim.tradeConfirm(a);
    sim.tradeConfirm(b);
    expect(sim.tradeFor(a)).toBe(null);
    expect(sim.countItem('wolf_fang', a)).toBe(1);
    expect(sim.countItem('wolf_fang', b)).toBe(4);
  });

  it('quest items cannot be traded', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    sim.addItem('boar_hide', 2, a);
    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    sim.tradeSetOffer([{ itemId: 'boar_hide', count: 2 }], 0, a);
    expect(sim.tradeFor(a)?.offerA.items.length).toBe(0);
  });

  it('mech chroma plates can be traded directly', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('mage', 'Bet');
    teleport(sim, a, 0, -40);
    teleport(sim, b, 3, -40);
    sim.addItem('vanguard_chrome_armor_plate', 1, a);

    sim.tradeRequest(b, a);
    sim.tradeAccept(b);
    sim.tradeSetOffer([{ itemId: 'vanguard_chrome_armor_plate', count: 1 }], 0, a);
    sim.tradeConfirm(a);
    sim.tradeConfirm(b);

    expect(sim.tradeFor(a)).toBe(null);
    expect(sim.countItem('vanguard_chrome_armor_plate', a)).toBe(0);
    expect(sim.countItem('vanguard_chrome_armor_plate', b)).toBe(1);
  });
});

describe('the Hollow Crypt', () => {
  it('party members enter the same instance; strangers get their own', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    const b = sim.addPlayer('priest', 'Bet');
    const c = sim.addPlayer('rogue', 'Gimel');
    sim.partyInvite(b, a);
    sim.partyAccept(b);
    for (const pid of [a, b, c]) teleport(sim, pid, 80, 88);
    sim.enterCrypt(a);
    sim.enterCrypt(b);
    sim.enterCrypt(c);
    const ea = sim.entities.get(a)!;
    const eb = sim.entities.get(b)!;
    const ec = sim.entities.get(c)!;
    expect(sim.instanceSlotAt(ea.pos)).toBe(sim.instanceSlotAt(eb.pos));
    expect(sim.instanceSlotAt(ec.pos)).not.toBe(sim.instanceSlotAt(ea.pos));
    // elites spawned in each claimed instance
    const slotA = sim.instanceSlotAt(ea.pos)!;
    const originA = instanceOrigin(0, slotA);
    const bossA = nearestMob(sim, 'morthen', originA);
    expect(bossA).toBeTruthy();
    expect(Math.abs(bossA.pos.x - originA.x)).toBeLessThan(50);
    expect(sim.instances.filter((i) => i.partyKey !== null).length).toBe(2);
    // exit returns to the chapel door
    sim.leaveCrypt(a);
    expect(ea.pos.x).toBeLessThan(200);
  });

  it('crypt has the full spawn set and Morthen pulses in combat', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, 80, 88);
    sim.enterCrypt(a);
    const slot = sim.instanceSlotAt(mustEntity(sim, a).pos) ?? 0;
    const origin = instanceOrigin(0, slot);
    const cryptMobs = [...sim.entities.values()].filter(
      (e) =>
        e.kind === 'mob' &&
        Math.abs(e.pos.x - origin.x) < 120 &&
        Math.abs(e.pos.z - origin.z) < 250,
    );
    expect(cryptMobs.length).toBe(CRYPT_SPAWNS.length);
    // walk the player onto the boss: pulse should hit within ~12s
    const boss = nearestMob(sim, 'morthen', origin);
    const ea = sim.entities.get(a)!;
    sim.setPlayerLevel(10, a);
    ea.hp = ea.maxHp;
    teleport(sim, a, boss.pos.x + 2, boss.pos.z);
    sim.targetEntity(boss.id, a);
    face(sim, a, boss.id);
    sim.startAutoAttack(a);
    let pulsed = false;
    for (let i = 0; i < 20 * 25 && !pulsed; i++) {
      face(sim, a, boss.id);
      const events = sim.tick();
      if (
        events.some((e) => e.type === 'damage' && e.ability === 'Shadow Pulse' && e.targetId === a)
      )
        pulsed = true;
      if (ea.dead) break;
    }
    expect(pulsed).toBe(true);
  });

  it('the storyline chain gates the dungeon quest', () => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior' });
    expect(sim.questState('q_whispers')).toBe('unavailable'); // needs q_bones
    expect(sim.questState('q_rite')).toBe('unavailable');
    expect(sim.questState('q_hollow')).toBe('unavailable');
    sim.questsDone.add('q_bones');
    expect(sim.questState('q_whispers')).toBe('available');
    sim.questsDone.add('q_whispers');
    expect(sim.questState('q_rite')).toBe('available');
    sim.questsDone.add('q_rite');
    expect(sim.questState('q_hollow')).toBe('available');
  });
});

describe('the new dungeons', () => {
  it('the Sunken Bastion and Gravewyrm Sanctum are enterable with full spawn sets', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, 45, 511);
    sim.enterDungeon('sunken_bastion', a);
    const ea = sim.entities.get(a)!;
    expect(ea.pos.x).toBeGreaterThan(1400); // index-1 band
    const slot = sim.instanceSlotAt(ea.pos)!;
    const origin = instanceOrigin(1, slot);
    const vael = nearestMob(sim, 'vael_the_mistcaller', origin);
    expect(vael).toBeTruthy();
    sim.leaveDungeon(a);
    expect(dist2d(ea.pos, { x: 45, y: 0, z: 515 })).toBeLessThan(10);

    teleport(sim, a, 0, 876);
    sim.enterDungeon('gravewyrm_sanctum', a);
    expect(ea.pos.x).toBeGreaterThan(2000); // index-2 band
    const slot2 = sim.instanceSlotAt(ea.pos)!;
    const origin2 = instanceOrigin(2, slot2);
    const korzul = nearestMob(sim, 'korzul_the_gravewyrm', origin2);
    expect(korzul).toBeTruthy();
    expect(korzul.level).toBe(20);
    sim.leaveDungeon(a);
    expect(dist2d(ea.pos, { x: 0, y: 0, z: 880 })).toBeLessThan(10);
  });

  it('Velkhar summons add waves at hp thresholds and Korgath enrages below 30%', () => {
    const sim = makeWorld();
    const a = sim.addPlayer('warrior', 'Aleph');
    teleport(sim, a, 0, 876);
    sim.enterDungeon('gravewyrm_sanctum', a);
    const ea = sim.entities.get(a)!;
    const origin = instanceOrigin(2, sim.instanceSlotAt(ea.pos)!);

    // Velkhar: drop below 66% then 33% -> two waves of 3 raised_bonewalker
    const velkhar = nearestMob(sim, 'grand_necromancer_velkhar', origin);
    expect(velkhar).toBeTruthy();
    const addsNear = () =>
      [...sim.entities.values()].filter(
        (e) =>
          e.kind === 'mob' &&
          !e.dead &&
          e.templateId === 'raised_bonewalker' &&
          Math.abs(e.pos.x - origin.x) < 120,
      ).length;
    expect(addsNear()).toBe(0);
    velkhar.inCombat = true;
    velkhar.hp = Math.floor(velkhar.maxHp * 0.6);
    sim.tick();
    expect(addsNear()).toBe(3);
    velkhar.hp = Math.floor(velkhar.maxHp * 0.3);
    sim.tick();
    expect(addsNear()).toBe(6);

    // Korgath: enrage flag flips once below 30% and boosts swing damage
    const korgath = nearestMob(sim, 'korgath_the_bound', origin);
    expect(korgath).toBeTruthy();
    expect(korgath.enraged).toBe(false);
    korgath.inCombat = true;
    korgath.hp = Math.floor(korgath.maxHp * 0.25);
    sim.tick();
    expect(korgath.enraged).toBe(true);
  });
});
