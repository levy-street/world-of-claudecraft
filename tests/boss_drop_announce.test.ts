import { afterEach, describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { announceBossDrops, bossDropAnnouncementText } from '../src/sim/loot/boss_drop_announce';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';
import { tEntity } from '../src/ui/entity_i18n';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { localizeServerText } from '../src/ui/server_i18n';
import { localizeSimText, tSim } from '../src/ui/sim_i18n';

// Boss drop printout (Discord feature request "Make boss drops publicly visible
// to all raid members under Master Loot"): a party boss kill prints every shared
// drop to every party member the moment the loot is rolled, under any loot
// method, so a master looter cannot keep a drop quiet by never opening the corpse.

type LootEvent = Extract<SimEvent, { type: 'loot' }>;
type Harness = {
  dealDamage: (
    src: Entity,
    tgt: Entity,
    amount: number,
    crit: boolean,
    school: string,
    abilityId: string | null,
    outcome: string,
  ) => void;
  rebucket: (e: Entity) => void;
};

const BOSS = 'gorrak';
const DROP_RE = / dropped \[\[i:[A-Za-z0-9_]+\]\]\.$/;

function place(sim: Sim, pid: number, x: number, z: number) {
  const p = sim.entities.get(pid)!;
  p.pos = sim.groundPos(x, z);
  p.prevPos = { ...p.pos };
  (sim as unknown as Harness).rebucket(p);
}

function dropLines(sim: Sim): LootEvent[] {
  return sim.events.filter(
    (e): e is LootEvent => e.type === 'loot' && DROP_RE.test((e as LootEvent).text),
  );
}

// Leader + two members; the third stands far outside loot range, to prove the
// printout reaches the whole party rather than only the tap-credited set.
function partyKill(
  templateId: string,
  opts: { master?: boolean; solo?: boolean; raid?: boolean; leavingTapper?: boolean } = {},
) {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
  const a = sim.playerId;
  const members = [a];
  if (!opts.solo) {
    const b = sim.addPlayer('mage', 'Bert');
    const c = sim.addPlayer('priest', 'Cora');
    for (const p of [b, c]) {
      sim.partyInvite(p, a);
      sim.partyAccept(p);
    }
    members.push(b, c);
    place(sim, b, 21, 20);
    place(sim, c, 900, 900);
    if (opts.raid) {
      // A raid needs a full party of five to convert, then fills a second
      // subgroup: the printout must reach both subgroups.
      for (const [k, name] of ['Dara', 'Eli', 'Fenn', 'Gale', 'Hob'].entries()) {
        if (k === 2) sim.convertPartyToRaid(a);
        const p = sim.addPlayer('rogue', name);
        sim.partyInvite(p, a);
        sim.partyAccept(p);
        members.push(p);
        place(sim, p, 22, 20);
      }
    }
  }
  place(sim, a, 20, 20);
  // A non-party bystander standing on the corpse must never see the printout.
  const bystander = sim.addPlayer('hunter', 'Ivo');
  place(sim, bystander, 20, 21);
  if (opts.master) sim.setPartyLootMaster(true, 0, 'uncommon', a);
  const template = MOBS[templateId];
  const mob = createMob(990701, template, template.maxLevel, sim.groundPos(20, 22));
  sim.entities.set(mob.id, mob);
  (sim as unknown as Harness).rebucket(mob);
  sim.events.length = 0;
  if (opts.leavingTapper) {
    // handleDeath's fallback: the bystander holds the tap but is mid-logout, so
    // kill credit (and the loot) falls to the party member who lands the blow.
    mob.tappedById = bystander;
    sim.meta(bystander)!.leaving = true;
  }
  const killer = sim.entities.get(a)!;
  (sim as unknown as Harness).dealDamage(killer, mob, mob.hp + 100, false, 'physical', null, 'hit');
  return { sim, mob, members, bystander };
}

describe('boss drop printout', () => {
  it('fixture: the boss is flagged and drops at least one shared item', () => {
    expect(MOBS[BOSS]?.boss).toBe(true);
    const { mob } = partyKill(BOSS, { master: true });
    expect(mob.dead).toBe(true);
    expect(mob.loot?.items.some((slot) => !slot.personalFor)).toBe(true);
  });

  it('prints every shared drop to every party member at the kill under master loot', () => {
    const { sim, mob, members } = partyKill(BOSS, { master: true });
    const shared = mob.loot!.items.filter((slot) => !slot.personalFor);
    const lines = dropLines(sim);
    // One line per shared drop per member, including the far-away one.
    expect(lines.length).toBe(shared.length * members.length);
    for (const pid of members) {
      const mine = lines.filter((e) => e.pid === pid);
      expect(mine.map((e) => e.text)).toEqual(
        shared.map((slot) => bossDropAnnouncementText('Gorrak the Ruthless', slot.itemId)),
      );
      expect(mine.map((e) => e.itemId)).toEqual(shared.map((slot) => slot.itemId));
    }
    // Silent: a multi-drop kill must not ring one loot cue per line per member.
    expect(lines.every((e) => e.silent === true)).toBe(true);
    // The fixture really is under master loot, and nobody opened the corpse:
    // the printout does not wait on the master looter.
    expect(sim.partyOf(sim.playerId)?.lootStrategies.master.enabled).toBe(true);
    expect(mob.loot!.items.length).toBe(shared.length);
  });

  it('never reaches a player outside the party, even one standing on the corpse', () => {
    const { sim, bystander } = partyKill(BOSS, { master: true });
    expect(dropLines(sim).length).toBeGreaterThan(0);
    expect(dropLines(sim).filter((e) => e.pid === bystander)).toEqual([]);
  });

  it('lists only shared slots and links the public view of each exact copy', () => {
    const { sim, mob, members } = partyKill(BOSS, { master: true });
    // Re-roll the corpse by hand: a signed copy carrying a private custody field,
    // a personal quest slot, and a plain shared item.
    mob.loot = {
      copper: 0,
      items: [
        { itemId: 'bandit_bandana', count: 1, instance: { signer: 'Smith', craftedRecipeId: 'x' } },
        { itemId: 'oiled_boots', count: 1, personalFor: [members[1]] },
        { itemId: 'quilted_trousers', count: 1 },
      ],
    };
    sim.events.length = 0;
    const ctx = (sim as unknown as { ctx: Parameters<typeof announceBossDrops>[0] }).ctx;
    const rngBefore = JSON.stringify(ctx.rng);
    announceBossDrops(ctx, mob, sim.playerId);
    // Draws no rng: a boss-kill replay stays byte-identical.
    expect(JSON.stringify(ctx.rng)).toBe(rngBefore);
    for (const pid of members) {
      const mine = dropLines(sim).filter((e) => e.pid === pid);
      // The personal slot is skipped for everyone, its owner included.
      expect(mine.map((e) => e.itemId)).toEqual(['bandit_bandana', 'quilted_trousers']);
      // The public projection only: the signer survives, custody fields do not.
      expect(mine[0].instance).toEqual({ signer: 'Smith' });
      expect(mine[1].instance).toBeUndefined();
    }
  });

  it('follows the kill-credit party, not the raw tap, and skips item-less corpses', () => {
    const { sim, mob, members, bystander } = partyKill(BOSS, { master: true });
    const ctx = (sim as unknown as { ctx: Parameters<typeof announceBossDrops>[0] }).ctx;
    const shared = mob.loot!.items.filter((slot) => !slot.personalFor);
    // handleDeath's leaving-tapper fallback: the tap still names someone else,
    // but credit (and the loot) went to the party's killer.
    mob.tappedById = bystander;
    sim.events.length = 0;
    announceBossDrops(ctx, mob, sim.playerId);
    expect(dropLines(sim).length).toBe(shared.length * members.length);
    expect(dropLines(sim).filter((e) => e.pid === bystander)).toEqual([]);
    // Credit held by an ungrouped player: nobody to tell.
    sim.events.length = 0;
    announceBossDrops(ctx, mob, bystander);
    expect(dropLines(sim)).toEqual([]);
    // Copper only: no item lines.
    mob.loot = { copper: 500, items: [] };
    announceBossDrops(ctx, mob, sim.playerId);
    expect(dropLines(sim)).toEqual([]);
  });

  it('follows the kill credit end to end when the tapper is mid-logout', () => {
    const { sim, mob, members, bystander } = partyKill(BOSS, { master: true, leavingTapper: true });
    expect(mob.dead).toBe(true);
    expect(mob.tappedById).toBe(bystander);
    const shared = mob.loot!.items.filter((slot) => !slot.personalFor);
    expect(shared.length).toBeGreaterThan(0);
    const lines = dropLines(sim);
    expect(lines.length).toBe(shared.length * members.length);
    expect(lines.filter((e) => e.pid === bystander)).toEqual([]);
  });

  it('reaches every member of a two-subgroup raid under master loot', () => {
    const { sim, mob, members } = partyKill(BOSS, { master: true, raid: true });
    const party = sim.partyOf(sim.playerId)!;
    expect(party.raid).toBe(true);
    expect([...party.members].sort()).toEqual([...members].sort());
    expect(new Set(party.raidGroups.values()).size).toBe(2);
    const shared = mob.loot!.items.filter((slot) => !slot.personalFor);
    const lines = dropLines(sim);
    for (const pid of members)
      expect(lines.filter((e) => e.pid === pid).length).toBe(shared.length);
  });

  it('prints under the default group loot method too', () => {
    const { sim, mob, members } = partyKill(BOSS);
    expect(sim.partyOf(sim.playerId)?.lootStrategies.master.enabled).toBe(false);
    const shared = mob.loot!.items.filter((slot) => !slot.personalFor);
    expect(shared.length).toBeGreaterThan(0);
    expect(dropLines(sim).length).toBe(shared.length * members.length);
  });

  it('stays quiet for a solo boss kill', () => {
    const { sim, mob } = partyKill(BOSS, { solo: true });
    expect(mob.loot!.items.length).toBeGreaterThan(0);
    expect(dropLines(sim)).toEqual([]);
  });

  it('stays quiet for a non-boss party kill with shared drops', () => {
    // Same loot table, only the boss flag differs: the flag alone gates it.
    const template = MOBS[BOSS];
    template.boss = false;
    try {
      const { sim, mob } = partyKill(BOSS, { master: true });
      expect(mob.loot!.items.some((slot) => !slot.personalFor)).toBe(true);
      expect(dropLines(sim)).toEqual([]);
    } finally {
      template.boss = true;
    }
  });
});

describe('boss drop printout localization', () => {
  afterEach(() => setLanguage('en'));

  it('re-renders the sim line through the client matcher with the item token intact', () => {
    const text = bossDropAnnouncementText('Gorrak the Ruthless', 'bandit_bandana');
    expect(text).toBe('Gorrak the Ruthless dropped [[i:bandit_bandana]].');
    // English locale: the rule rebuilds the same sentence and keeps the token
    // for the chat link renderer.
    expect(localizeSimText(text)).toBe(text);
    // Near misses match no rule at all (null), so the pin above is the new rule.
    expect(localizeSimText('Gorrak the Ruthless dropped [[i:bad-id]].')).toBeNull();
    expect(localizeSimText('Gorrak the Ruthless dropped bandit_bandana.')).toBeNull();
  });

  it('localizes the boss name through the real hud chain in another locale', async () => {
    await ensureLocaleLoaded('zh_CN');
    setLanguage('zh_CN');
    const text = bossDropAnnouncementText('Gorrak the Ruthless', 'bandit_bandana');
    // localizeLootText tries localizeServerText first: it must not claim the line.
    expect(localizeServerText(text)).toBeNull();
    const boss = tEntity({ kind: 'mob', id: BOSS, field: 'name' });
    expect(boss).not.toBe('Gorrak the Ruthless');
    // The new rule wins (not a broader earlier one): the boss name localizes and
    // the item token survives for the chat link renderer.
    expect(localizeSimText(text)).toBe(
      tSim('loot.bossDrop', { boss, item: '[[i:bandit_bandana]]' }),
    );
    expect(localizeSimText(text)).toContain(boss);
    expect(localizeSimText(text)).toContain('[[i:bandit_bandana]]');
  });
});
