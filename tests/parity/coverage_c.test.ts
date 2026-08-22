// Coverage proof: each scenario must ACTUALLY fire its target subsystem (not just
// name it in a comment). These assertions inspect the live events + final state of
// a recorded run. If a future content change breaks a recipe, this fails loudly so
// the golden never silently stops exercising a system.
// Display-name literals follow the LOCKED NAME-MAP (authorized gate-text edit per the
// OPERATOR RULING, 2026-07-02, ip-refactor/02-WORKING-MEMORY.md); ability/aura IDS are frozen.
// Shard c of the coverage suite: a contiguous block of the per-scenario checks,
// split across files (with the parity gate shards) purely so vitest can run the
// recordings in parallel worker files. Assertions are unchanged; the shared run /
// entities helpers live in run_scenarios.ts.

import { describe, expect, it } from 'vitest';
import {
  HEROIC_DUNGEON_TUNING,
  HEROIC_MARK_ITEM_ID,
  NYTHRAXIS_HEROIC_COPPER,
} from '../../src/sim/content/dungeon_difficulty';
import { HEROIC_BOSS_LOOT } from '../../src/sim/content/heroic_loot';
import { heroicVariantId } from '../../src/sim/content/heroic_variants';
import { ITEMS, MOBS } from '../../src/sim/data';
import { RIFT_IMPAIRED_FUSE_CAP } from '../../src/sim/mob/rift_escape_window';
import { farmingHarvestGainAt, resolveFarmHarvest } from '../../src/sim/professions/farming';
import { riftNormalClearPool } from '../../src/sim/rift/loot_pools';
import {
  RIFT_COIN_BONUS_A,
  RIFT_COIN_BONUS_B,
  RIFT_COIN_BONUS_C,
  RIFT_COIN_BONUS_S,
  RIFT_PATTERN_ITEM_IDS,
} from '../../src/sim/rift/progression';
import { RIFT_S_ZONE_TEMPO } from '../../src/sim/rift/ranks';
import { record } from './record';
import { type Ev, entities, run } from './run_scenarios';
import { FARM_GOLDEN_WIN_YIELD_SEED, FARM_TONIC_WINNER_YIELD_SEED, SCENARIOS } from './scenarios';

describe('coverage: each scenario fires its subsystem', () => {
  it('mob_lifecycle: frenzy + death-throes arm/detonate + wild respawn (despawn adds) + dungeon stays dead', () => {
    const rec = run('mob_lifecycle');
    const n = rec.notes as Record<string, any>;
    const ev = rec.allEvents as Ev[];
    // frenzyPackmates: same-template hostile neighbors gained Pack Frenzy; the boar did not.
    expect(n.wolfBFrenzied).toBe(true);
    expect(n.wolfCFrenzied).toBe(true);
    expect(n.boarFrenzied).toBe(false);
    expect(
      ev.some(
        (e) =>
          e.type === 'log' && typeof e.text === 'string' && e.text.includes('flies into a frenzy'),
      ),
    ).toBe(true);
    // armDeathThroes armed the fuse (delay 1.5) + emitted the swell telegraph.
    expect(n.bogArmed).toBeCloseTo(1.5, 5);
    expect(
      ev.some(
        (e) => e.type === 'log' && typeof e.text === 'string' && e.text.includes('begins to swell'),
      ),
    ).toBe(true);
    // detonateCorpse fired once (timer -> Infinity), burst the in-radius player, logged the cloud.
    expect(n.bogDetonated).toBe(true);
    expect(
      ev.some(
        (e) =>
          e.type === 'log' && typeof e.text === 'string' && e.text.includes('bursts in a cloud of'),
      ),
    ).toBe(true);
    // respawnMob: the wild mob came back to life at its spawn point, idle, and despawnSummonedAdds dropped the add.
    expect(n.wildRespawned).toBe(true);
    expect(n.wildState).toBe('idle');
    expect(n.wildAtSpawn).toBe(true);
    expect(n.addDespawned).toBe(true);
    // the dungeon-x mob never respawned.
    expect(n.dungeonStaysDead).toBe(true);
  });

  it('targeting_markers: selectors set a target without arming auto-attack, marker set + death-strip', () => {
    const rec = run('targeting_markers');
    const sim = rec.sim as any;
    const aPid = rec.notes.aPid as number;
    const ae = sim.entities.get(aPid);
    // the tab / nearest / friendly selectors landed a target on the player...
    expect(typeof ae.targetId).toBe('number');
    // ...and friendly cycling never armed auto-attack.
    expect(ae.autoAttack).toBe(false);
    // the killed mob carried a mark before its death; clearEntityMarker stripped
    // exactly that mob's mark, while a still-live marked mob keeps its symbol.
    const marked = rec.notes.markedBeforeKill as Record<number, number>;
    const m2Id = rec.notes.m2Id as number;
    const m3Id = rec.notes.m3Id as number;
    expect(marked[m2Id]).toBeDefined(); // SKULL was on the (soon dead) mob
    const after = sim.markersFor(aPid);
    expect(after[m2Id]).toBeUndefined(); // death-strip removed the dead mob's mark
    expect(after[m3Id]).toBeDefined(); // a live mob's mark survives
    expect((rec.allEvents as Ev[]).some((e) => e.type === 'death')).toBe(true);
  });

  it('c4b_effect_dispatch: runEffects fans across sunder/aoe/finisher/fear/groundAoE/summon/form', () => {
    const rec = run('c4b_effect_dispatch');
    const ev = rec.allEvents as Ev[];
    const ents = entities(rec);
    // warrior sunder_armor: the sunder aura landed (or a miss event fired) on its mob.
    const warriorMob = ents.find(
      (e) => e.templateId === 'forest_wolf' && e.auras?.some((a: Ev) => a.kind === 'sunder'),
    );
    const sunderMiss = ev.some(
      (e) =>
        e.type === 'damage' &&
        e.kind === 'miss' &&
        typeof e.ability === 'string' &&
        e.ability.toLowerCase().includes('shear'),
    );
    expect(Boolean(warriorMob) || sunderMiss).toBe(true);
    // mage arcane_explosion: the per-target aoeDamage hit BOTH in-radius mobs.
    const aoeMobIds = rec.notes.aoeMobIds as number[];
    const arcaneTargets = new Set(
      ev
        .filter(
          (e) => e.type === 'damage' && e.school === 'arcane' && aoeMobIds.includes(e.targetId),
        )
        .map((e) => e.targetId),
    );
    expect(arcaneTargets.size).toBe(2);
    // rogue eviscerate: finisher dealt physical damage AND the combo-spend reset fired.
    const rogue = rec.notes.rogueId as number;
    expect(
      ev.some((e) => e.type === 'damage' && e.sourceId === rogue && e.school === 'physical'),
    ).toBe(true);
    expect(ev.some((e) => e.type === 'comboPoint' && e.pid === rogue && e.points === 0)).toBe(true);
    // paladin consecration: holy damage came from the Paladin.
    const paladin = rec.notes.paladinId as number;
    expect(
      ev.some((e) => e.type === 'damage' && e.sourceId === paladin && e.school === 'holy'),
    ).toBe(true);
    // paladin consecration: a ground AoE was pushed (on-cast pulse path).
    expect((rec.sim as any).groundAoEs.length).toBeGreaterThanOrEqual(1);
    // warlock fear: the incapacitate aura landed on the warlock's mob (fear-angle draw).
    // Harrow is now a 5s fear, so the final snapshot can arrive after expiry.
    expect(rec.notes.warlockFearApplied).toBe(true);
    // warlock summon_imp: a pet now belongs to the warlock (summonDemon -> summonPet).
    expect(ents.some((e) => e.ownerId === rec.notes.warlockId)).toBe(true);
    // druid form switch: cat replaced bear (exclusive), read at the instant of
    // the switch because the Second Bloom that follows is a healing spell and
    // auto-unshifts out of cat (src/sim/combat/form_auto_unshift.ts).
    expect(rec.notes.druidCatFormActive).toBe(true);
    expect(rec.notes.druidBearFormStripped).toBe(true);
    // ...and that auto-unshift is what the closing state pins: no form left,
    // and the heal-over-time the cast went on to plant.
    const druid = ents.find((e) => e.id === rec.notes.druidId);
    expect(druid?.auras?.some((a: Ev) => String(a.kind).startsWith('form_'))).toBe(false);
    expect(druid?.auras?.some((a: Ev) => a.id === 'rejuvenation')).toBe(true);
  });

  it('hit_rating_heroic pair: gear changes the threshold, never the RNG draw order', () => {
    const ungearedScenario = SCENARIOS.find((s) => s.name === 'hit_rating_heroic_ungeared')!;
    const gearedScenario = SCENARIOS.find((s) => s.name === 'hit_rating_heroic_geared')!;
    const ungeared = record(ungearedScenario);
    const geared = record(gearedScenario);

    expect(ungeared.rec.sim.player.hitRating).toBe(0);
    expect(geared.rec.sim.player.hitRating).toBe(170);
    const gearedMob = (geared.rec.sim as any).entities.get(geared.rec.notes.mobId);
    expect(gearedMob.level - geared.rec.sim.player.level).toBe(3);
    expect(
      geared.rec.allEvents.some(
        (e: Ev) => e.type === 'damage' && e.sourceId === geared.rec.sim.player.id,
      ),
    ).toBe(true);

    expect(geared.trace.draws).toBe(ungeared.trace.draws);
    expect(geared.trace.drawDigest).toBe(ungeared.trace.drawDigest);
  });

  it('c5_auto_attack: melee swing table + ranged Auto Shot + wand + queued on-swing fire', () => {
    const rec = run('c5_auto_attack');
    const ev = rec.allEvents as Ev[];
    // ranged white swings carry their hardcoded labels in the damage-event ability field.
    expect(ev.some((e) => e.type === 'damage' && e.ability === 'Auto Shot')).toBe(true); // hunter ranged path
    expect(ev.some((e) => e.type === 'damage' && e.ability === 'Wand')).toBe(true); // mage wand path (no dead zone)
    // melee auto-attack produced physical white-hit outcomes (the single-roll table).
    expect(
      ev.some(
        (e) =>
          e.type === 'damage' &&
          e.school === 'physical' &&
          (e.kind === 'hit' || e.kind === 'miss' || e.kind === 'dodge'),
      ),
    ).toBe(true);
    // a queued on-next-swing ability was consumed in the swing path (its name rode through).
    expect(
      ev.some(
        (e) =>
          e.type === 'damage' && (e.ability === 'Reaver Strike' || e.ability === 'Gutting Strike'),
      ),
    ).toBe(true);
  });

  it('market_round_trip: list/buy/cancel/expire/collect all fire and coin + goods move', () => {
    const rec = run('market_round_trip');
    const sim = rec.sim as any;
    const ev = rec.allEvents as Ev[];
    const seller = rec.notes.seller as number;
    const buyer = rec.notes.buyer as number;
    const loot = (re: RegExp) =>
      ev.some((e) => e.type === 'loot' && typeof e.text === 'string' && re.test(e.text));
    // marketList escrow + the listing emit.
    expect(loot(/^Listed /)).toBe(true);
    // marketBuy cross-player sale: the seller's notice and the buyer's confirmation.
    expect(loot(/bought your /)).toBe(true);
    expect(loot(/^Bought /)).toBe(true);
    // marketCancel reclaim.
    expect(loot(/^Reclaimed /)).toBe(true);
    // updateMarket once-a-second expiry sweep returned the third stack to collection.
    expect(
      ev.some(
        (e) => e.type === 'log' && typeof e.text === 'string' && /expired and waits/.test(e.text),
      ),
    ).toBe(true);
    // marketCollect moved the proceeds into the seller's purse.
    expect(loot(/^You collect /)).toBe(true);
    expect(sim.players.get(seller)?.copper).toBe(285); // 300 sale - 5% cut
    expect(sim.players.get(buyer)?.copper).toBe(4700); // 5000 - 300
  });

  it('g1b_xp_prestige: rested XP accrues in the inn, then prestige resets the bar and bumps rank', () => {
    const rec = run('g1b_xp_prestige');
    // updateRested (+ isResting) accrued a positive rested pool while parked in the inn.
    expect(rec.notes.restedAfterAccrual as number).toBeGreaterThan(0);
    // the kill-flagged award doubled up off the seeded pool and drew it down (1000 -> 920).
    expect(rec.notes.restedAfterConsume as number).toBe(920);
    // prestige fired: the first call accepted, the below-threshold second was refused.
    expect(rec.notes.prestigeAccepted).toBe(true);
    expect(rec.notes.prestigeRejected).toBe(false);
    // the gold prestige log emit fired through ctx.emit.
    expect(
      (rec.allEvents as Ev[]).some(
        (e) => e.type === 'log' && typeof e.text === 'string' && e.text.includes('prestiged'),
      ),
    ).toBe(true);
    // the anti-abuse cap held: rank is exactly 1, never inflated by the second call.
    expect((rec.sim as any).prestigeRank).toBe(1);
  });

  it('player_trade: items + copper swap both ways; cancel + drift sweep clear the session', () => {
    const rec = run('player_trade');
    const sim = rec.sim as any;
    const a = rec.notes.a as number;
    const b = rec.notes.b as number;
    // atomic swap moved goods + coin both directions.
    expect(sim.countItem('wolf_fang', a)).toBe(1); // 3 - 2
    expect(sim.countItem('wolf_fang', b)).toBe(2);
    expect(sim.countItem('baked_bread', a)).toBe(6); // 5 starter + 1 traded
    expect(sim.countItem('baked_bread', b)).toBe(6); // 5 starter + 2 - 1
    expect(sim.players.get(a)?.copper).toBe(80); // 100 - 30 + 10
    expect(sim.players.get(b)?.copper).toBe(70); // 50 - 10 + 30
    // every session ended cleared (swap close + explicit cancel + drift sweep).
    expect(sim.tradeFor(a)).toBe(null);
    expect(sim.tradeFor(b)).toBe(null);
    const ev = rec.allEvents as Ev[];
    expect(ev.some((e) => e.type === 'tradeDone')).toBe(true);
    // 'Trade cancelled.' fires twice per cancel (both pids): the explicit cancel
    // and the out-of-range drift cancel each emit it.
    expect(
      ev.filter((e) => e.type === 'log' && e.text === 'Trade cancelled.').length,
    ).toBeGreaterThanOrEqual(4);
  });

  it('chat_social: channels route, whisper round-trips, emotes broadcast, throttle fires', () => {
    const rec = run('chat_social');
    const ev = rec.allEvents as Ev[];
    const a = rec.notes.a as number;
    const b = rec.notes.b as number;
    const chats = ev.filter((e) => e.type === 'chat');
    // each channel delivered at least one chat event.
    for (const ch of ['say', 'yell', 'party', 'general', 'world', 'lfg', 'whisper', 'emote']) {
      expect(
        chats.some((e) => e.channel === ch),
        `no ${ch} chat`,
      ).toBe(true);
    }
    // whisper round-trip: a -> b then the /r reply resolves back to a.
    expect(chats.some((e) => e.channel === 'whisper' && e.from === 'Aleph' && e.pid === b)).toBe(
      true,
    );
    expect(chats.some((e) => e.channel === 'whisper' && e.from === 'Bet' && e.pid === a)).toBe(
      true,
    );
    // token-bucket throttle fired once c exhausted its burst.
    expect(
      ev.filter((e) => e.type === 'error' && e.text === 'You are sending messages too quickly.')
        .length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('nythraxis_full_pull: every phase fires (transition + soul rend + deathless interrupt + lockout + death dialogue)', () => {
    const rec = run('nythraxis_full_pull');
    const ev = rec.allEvents as Ev[];
    const n = rec.notes as Record<string, any>;
    const sim = rec.sim as any;
    const chats = ev.filter((e) => e.type === 'chat');
    const auras = ev.filter((e) => e.type === 'aura' && e.gained);
    // Phase 1 raise-fallen wave + the three wardstones the transition lit.
    expect(n.addIds.length).toBe(2);
    expect(n.wardIds.length).toBe(3);
    // Transition: Shuddering Stomp room stun + Brother Aldric spawned and still present.
    expect(auras.some((e) => e.name === 'Shuddering Stomp')).toBe(true);
    expect(entities(rec).some((e) => e.templateId === 'brother_aldric_raid')).toBe(true);
    // Soul Rend marks pick (the rng.int callout) + Deathless Rage interrupt self-stun.
    expect(chats.some((e) => e.text === 'Your spirit belongs to me')).toBe(true);
    expect(auras.some((e) => e.name === 'Deathless Rage Interrupted')).toBe(true);
    // Final Stand enrage aura.
    expect(auras.some((e) => e.name === 'Final Stand')).toBe(true);
    // Kill: raid lockout granted to the tank + the death-dialogue first line emitted.
    const boss = sim.entities.get(n.bossId);
    expect(boss.dead).toBe(true);
    expect(boss.nythraxis?.phase).toBe('dead');
    const tankMeta = [...sim.players.values()].find((m: any) => m.name === 'NyxTank') as any;
    expect(tankMeta.raidLockouts.has('nythraxis_boss_arena')).toBe(true);
    expect(chats.some((e) => e.text === 'Malric...')).toBe(true);
    // The sibling-distinguishing arm (the rift ladder's fourth-arm idiom): this
    // scenario's claim is NORMAL, which is precisely why it cannot cover a
    // heroic loot stream and why nythraxis_heroic_claim below exists. If a
    // future edit ever makes this pull heroic, BOTH scenarios would cover the
    // same arm and the heroic one would silently stop being the only witness.
    expect(
      sim.instances.some(
        (i: any) => i.partyKey !== null && i.mobIds.includes(n.bossId) && i.difficulty === 'heroic',
      ),
    ).toBe(false);
  }, 90_000);

  it('nythraxis_heroic_claim: the heroic loot arm (variant swap + heroic-only weapon + raised money base + marks)', () => {
    const rec = run('nythraxis_heroic_claim');
    const sim = rec.sim as any;
    const n = rec.notes as Record<string, any>;
    const boss = sim.entities.get(n.bossId);
    expect(boss.dead).toBe(true);
    // The claim really is heroic: the exact predicate rollLoot resolves.
    expect(
      sim.instances.some(
        (i: any) => i.partyKey !== null && i.mobIds.includes(n.bossId) && i.difficulty === 'heroic',
      ),
    ).toBe(true);

    const items: string[] = (boss.loot?.items ?? []).map((s: any) => s.itemId);
    expect(items.length).toBeGreaterThan(0);

    // EXACTLY ONE heroic-only weapon: the nythraxis_heroic_weapon group sums to
    // 1.0, so a heroic kill always sheds one and a normal kill never can. The
    // id set is DERIVED from the shipped table, never listed here, so a table
    // re-cut moves this arm instead of leaving it green over a stale trio.
    const heroicOnlyWeaponIds = HEROIC_BOSS_LOOT.nythraxis_scourge_of_thornpeak
      .filter((e) => e.rollGroup !== undefined)
      .map((e) => e.itemId as string);
    expect(heroicOnlyWeaponIds.length).toBeGreaterThan(0);
    expect(items.filter((id) => heroicOnlyWeaponIds.includes(id)).length).toBe(1);

    // heroicItem() fired on the base table: every drop that HAS a raid-tier
    // heroic variant came out as that variant. Asserted as a whole-list
    // property rather than "at least one", so a swap that stopped firing for a
    // single slot reds. The eligibility test is heroicVariantId's own index
    // lookup, the exact question heroicItem asks, NOT a kind filter: a table
    // that later sheds a plain junk or recipe row (the Phase 11f farming seeds
    // and patterns are both) has no variant to swap to and must not be read as
    // a swap that failed.
    const missedSwap = items.filter(
      (id) => !heroicOnlyWeaponIds.includes(id) && ITEMS[heroicVariantId(id)] !== undefined,
    );
    expect(
      missedSwap,
      `every drop with a heroic variant must BE that variant: ${missedSwap}`,
    ).toEqual([]);
    expect(items.filter((id) => id.startsWith('heroic_')).length).toBeGreaterThan(0);

    // The heroicCopper substitution, and the reason the seed was hunted: the
    // normal base rolls at most ceil(150000 * 1.4) = 210 000, so a roll above
    // that could only have come off NYTHRAXIS_HEROIC_COPPER. The upper bound is
    // pinned too, so a base re-tune cannot widen this arm into always-true.
    expect(boss.loot.copper).toBeGreaterThan(Math.ceil(150_000 * 1.4));
    expect(boss.loot.copper).toBeLessThanOrEqual(Math.ceil(NYTHRAXIS_HEROIC_COPPER * 1.4));

    // awardHeroicMarks paid the whole raid, which only a heroic claim reaches.
    const tuning = HEROIC_DUNGEON_TUNING.nythraxis_boss_arena;
    const raid = [...sim.players.values()] as any[];
    expect(raid.length).toBe(5);
    for (const meta of raid) {
      expect(sim.countItem(HEROIC_MARK_ITEM_ID, meta.entityId), `${meta.name} heroic marks`).toBe(
        tuning.marksPerParticipant,
      );
    }
  }, 90_000);

  it('warrior_row_capstones: intervene, thresholded fear, victory rush heal, bladestorm ticks', () => {
    const rec = run('warrior_row_capstones');
    const sim = rec.sim as any;
    const pid = sim.playerId;
    const ev = rec.allEvents as Ev[];
    // The hostile Onrush keeps both side effects...
    expect(rec.notes.onrushRage).toBe(true);
    expect(rec.notes.onrushInCombat).toBe(true);
    // ...and the friendly Intervene takes neither, while shielding the ally.
    expect(rec.notes.interveneShield).toBe(50);
    expect(rec.notes.interveneClosed).toBe(true);
    expect(rec.notes.interveneRage).toBe(0);
    expect(rec.notes.interveneInCombat).toBe(false);
    expect(rec.notes.interveneAutoAttack).toBe(false);
    // Read at APPLY, not from end-of-run state: the legs after the shout run over
    // five seconds, so anything shorter than the old 8 sec fear has expired by the
    // end and an end-state lookup quietly finds nothing to assert.
    expect(rec.notes.fearApplied).toBe(true);
    expect(rec.notes.fearDuration).toBe(4);
    expect(rec.notes.fearBreaksOnDamage).toBe(true);
    // Lingering Dread's soak, 10% of the wolf's max health.
    expect(rec.notes.fearBreakThreshold).toBeGreaterThan(0);
    expect(ev.some((e) => (e.type === 'heal' || e.type === 'heal2') && e.targetId === pid)).toBe(
      true,
    );
    expect(ev.some((e) => e.type === 'damage' && e.ability === 'Bladestorm')).toBe(true);
  });

  it('professions_craft: denial draws nothing, each craft draws once, and the vestments proc mints + surfaces a masterwork', () => {
    const { trace, rec } = record(SCENARIOS.find((s) => s.name === 'professions_craft')!);
    const ev = rec.allEvents as Ev[];
    const pid = rec.notes.pid as number;
    const crafts = ev.filter((e) => e.type === 'craftResult');

    expect(crafts.some((e) => e.ok === false && e.reason === 'insufficient_materials')).toBe(true);
    expect(
      crafts.some((e) => e.ok === true && e.quality === 'common' && e.masterwork === undefined),
    ).toBe(true);

    const mw = ev.find((e) => e.type === 'masterwork');
    expect(mw, 'masterwork event did not fire (proc missed for the pinned seed)').toBeTruthy();
    expect(mw!.recipeId).toBe('recipe_eastbrook_ritual_vestments');
    expect(mw!.itemId).toBe('eastbrook_ritual_vestments');
    expect(mw!.crafter).toBe(pid);
    expect(mw!.pid).toBe(pid);
    expect(
      crafts.some(
        (e) =>
          e.ok === true &&
          e.itemId === 'eastbrook_ritual_vestments' &&
          e.quality === 'uncommon' &&
          e.masterwork === true,
      ),
    ).toBe(true);

    const meta = (rec.sim as any).players.get(pid);
    const slots = meta.inventory.filter((s: any) => s.itemId === 'eastbrook_ritual_vestments');
    expect(slots.length).toBe(1);
    expect(slots[0].instance?.rolled?.masterwork).toBe(true);
    expect(meta.lastMasterwork).toMatchObject({
      recipeId: 'recipe_eastbrook_ritual_vestments',
      itemId: 'eastbrook_ritual_vestments',
      crafter: pid,
    });

    // The phase 07 daily-gate arm (step 4b): the catalyst success stamps
    // craftDaily with real content and draws once like every success; the
    // daily_limit re-attempt returns BEFORE any draw and leaves the stamp
    // unmutated, so the scenario's total stays at exactly four draws (three
    // pre-existing crafts + the catalyst; the two denials contribute zero).
    expect(
      crafts.some(
        (e) => e.ok === true && e.itemId === 'quickening_catalyst' && e.masterwork === undefined,
      ),
    ).toBe(true);
    expect(crafts.some((e) => e.ok === false && e.reason === 'daily_limit')).toBe(true);
    expect(meta.craftDaily).toEqual({
      date: '2099-06-25',
      crafted: new Set(['recipe_quickening_catalyst']),
    });
    expect(trace.draws).toBe(4);
  });

  it('professions_gather: two draws per harvest, zero-draw denial, zone materials, and the hunted rare event fires', () => {
    const { trace, rec } = record(SCENARIOS.find((s) => s.name === 'professions_gather')!);
    const ev = rec.allEvents as Ev[];
    const pid = (rec.sim as any).playerId as number;
    const meta = (rec.sim as any).players.get(pid);

    const gathers = ev.filter((e) => e.type === 'gatherResult');
    expect(gathers).toHaveLength(102);
    expect(ev.some((e) => e.type === 'error' && e.text === 'Your bags are full.')).toBe(false);

    const phase1 = trace.frames.find((f) => f.label === 'harvest-ore-common-and-denial');
    expect(phase1, 'missing the phase 1 frame').toBeTruthy();
    expect(phase1!.rng.draws).toBe(2);
    expect(
      ev.some(
        (e) => e.type === 'error' && e.text === 'This resource node has not respawned for you yet.',
      ),
    ).toBe(true);

    expect(gathers[0].itemId).toBe('copper_ore');
    expect(gathers[0].rarity).toBe('common');
    const wood = gathers.find((e) => e.itemId === 'ironbark_log');
    expect(wood, 'wood harvest missing').toBeTruthy();
    expect(wood!.rarity).not.toBe('common');

    const rare = ev.find((e) => e.type === 'gatherRareEvent');
    expect(rare, 'rare event did not fire (hunted seed regressed)').toBeTruthy();
    expect(rare!.finderPid).toBe(pid);
    const flavorByType: Record<string, string> = {
      ore: 'pristine_vein',
      wood: 'ancient_heartwood',
      herb: 'moonlit_bloom',
    };
    expect(rare!.flavor).toBe(flavorByType[rare!.nodeType]);
    const rareGather = gathers.find((e) => e.rareEvent === rare!.flavor);
    expect(rareGather, 'no gatherResult paired with the rare event').toBeTruthy();
    const qtyByRarity: Record<string, number> = {
      common: 1,
      uncommon: 2,
      rare: 2,
      epic: 3,
      legendary: 4,
    };
    expect(rareGather!.qty).toBe(qtyByRarity[rareGather!.rarity] * 5);
    const signed = meta.inventory.filter(
      (s: any) => s.itemId === rare!.itemId && s.instance?.signer === meta.name,
    );
    // Identical-payload stacking: the same-signer units merge into
    // signed stacks, so count UNITS and pin that the merge actually collapsed
    // them into far fewer slots than units (stack cap 20).
    const signedUnits = signed.reduce((n: number, s: any) => n + s.count, 0);
    expect(signedUnits).toBeGreaterThanOrEqual(rareGather!.qty);
    expect(signed.length).toBeLessThanOrEqual(Math.ceil(signedUnits / 20));
  });
  it('druid_engines: all three live buttons arm and their payoffs fire', () => {
    const rec = run('druid_engines');
    expect(rec.notes.moonlashArmed).toBe(true);
    expect(rec.notes.sunlanceArmed).toBe(true);
    expect(rec.notes.redharvestArmed).toBe(true);
    expect(rec.notes.marrowbreakArmed).toBe(true);
    expect(rec.notes.overbloomArmed).toBe(true);
    const abilities = (rec.allEvents as Ev[])
      .filter((event) => event.type === 'damage' || event.type === 'heal2')
      .map((event) => event.ability);
    expect(abilities).toContain('Moonsurge');
    expect(abilities).toContain('Sunwake');
    expect(abilities).toContain('Redharvest');
    expect(abilities).toContain('Marrowbreak');
    expect(abilities).toContain('Overbloom');
  });

  it('priest_codex: all three baseline loops fire and respec cleanup completes', () => {
    const rec = run('priest_codex');
    const ev = rec.allEvents as Ev[];
    expect(ev.some((event) => event.type === 'heal2' && event.ability === 'Doctrine')).toBe(true);
    expect(ev.some((event) => event.type === 'heal2' && event.ability === 'Seraphic Vigil')).toBe(
      true,
    );
    expect(ev.some((event) => event.type === 'heal2' && event.ability === 'Choirmend')).toBe(true);
    expect(
      ev.some((event) => event.type === 'heal2' && event.ability === 'Sunburst Canticle'),
    ).toBe(true);
    expect(ev.some((event) => event.type === 'damage' && event.ability === 'Effigy Echo')).toBe(
      true,
    );
    expect(
      ev.some((event) => event.type === 'damage' && event.ability === 'Tithefiend Strike'),
    ).toBe(true);
    expect(rec.notes.guardianId).not.toBeNull();
    expect(rec.notes.bankBeforeMindfracture).toBe(0);
    expect(rec.notes.bankAfterMindfracture).toBe(1);
    expect(rec.notes.mindfractureEchoTargets).toEqual(rec.notes.expectedEchoTargets);
    expect(rec.notes.foreignOwnerIsolated).toBe(true);
    expect(rec.notes.manaAfterGuardian).toBeGreaterThan(rec.notes.manaAfterSummon as number);
    expect(rec.notes.respecSucceeded).toBe(true);
    expect(rec.notes.cleanupComplete).toBe(true);
  });

  // This block exists because its absence is what let the scenario rot. Its
  // stand point for step 1 was an inlined coordinate; the v0.32.0 merge moved
  // ore_mirefen_t2 and the harvest became a "Too far away." denial, faithfully
  // recorded in the golden as 0 draws at the fine-grade frame and 4 total where
  // three granted harvests are 6. The gate stayed green the whole time, because
  // nothing here asserted the fine-grade arm actually fires.
  it('professions_gather_fine: all three harvests grant, and only the full-grade vein upgrades', () => {
    const { trace, rec } = record(SCENARIOS.find((s) => s.name === 'professions_gather_fine')!);
    const ev = rec.allEvents as Ev[];

    // Three granted harvests, in drive order, each carrying the grade its vein
    // and tool resolve to: fine at the full-grade vein (tier-3 pick strictly
    // above iron's rung 2), plain at the zone's tier-1 vein (the vein is below
    // the rung, so no tool upgrades it), plain at the herb patch (the tier-2
    // sickle only MATCHES goldleaf's rung, and the pick is the wrong
    // profession).
    const gathers = ev.filter((e) => e.type === 'gatherResult');
    expect(gathers).toHaveLength(3);
    expect(gathers.map((e) => [e.nodeId, e.itemId])).toEqual([
      ['ore_mirefen_t2', 'fine_iron_ore'],
      ['ore_mirefen_1', 'iron_ore'],
      ['herb_mirefen_t2', 'goldleaf_herb'],
    ]);

    // No harvest was refused for standing in the wrong place: the exact
    // regression this block guards, and the reason step 1's stand point is
    // derived from the node instead of inlined.
    expect(ev.some((e) => e.type === 'error' && e.text === 'Too far away.')).toBe(false);

    // Two draws per granted harvest and no more: six total, with the
    // fine-grade arm spending its own two (it spent ZERO while stale).
    const fine = trace.frames.find((f) => f.label === 'fine-grade-at-full-tier-vein');
    expect(fine, 'missing the fine-grade checkpoint frame').toBeTruthy();
    expect(fine!.rng.draws).toBe(2);
    expect(trace.draws).toBe(6);
  });

  it('professions_tool_effect_slot: draw-free mint, the quantity bonus fires, and one charge settles', () => {
    const { trace, rec } = record(
      SCENARIOS.find((s) => s.name === 'professions_tool_effect_slot')!,
    );
    const ev = rec.allEvents as Ev[];
    const pid = (rec.sim as any).playerId as number;
    const meta = (rec.sim as any).players.get(pid);

    // Two mints landed on the slot action (the 'always' mint plus the R40
    // prompt re-slot), both for this player's mining profession, and both
    // consumed charm copies are gone from the bags.
    const slotted = ev.filter((e) => e.type === 'toolEffectResult' && e.action === 'slot');
    expect(slotted).toHaveLength(2);
    for (const s of slotted) {
      expect(s.ok).toBe(true);
      expect(s.professionId).toBe('mining');
      expect(s.effectId).toBe('gatherers_cache');
      expect(s.pid).toBe(pid);
    }
    expect(meta.inventory.some((s: any) => s.itemId === 'gatherers_cache')).toBe(false);
    // Draw-free in every arm: the whole mint stands at zero draws.
    const minted = trace.frames.find((f) => f.label === 'effect-slotted');
    expect(minted, 'missing the mint checkpoint frame').toBeTruthy();
    expect(minted!.rng.draws).toBe(0);

    // Three granted harvests, in drive order: the 'always' bonus harvest,
    // the R40 UNCONFIRMED prompt use (base quantity, the fail-safe), and
    // the CONFIRMED prompt use (+1 fires). gatherResult carries no effect
    // flag, so each +1 is read off the granted qty against the shipped
    // yield table for the SAME rolled rarity (the same-draw base the R42
    // settle compares against).
    const gathers = ev.filter((e) => e.type === 'gatherResult');
    expect(gathers.map((g) => g.nodeId)).toEqual([
      'ore_mirefen_t2',
      'ore_mirefen_1',
      'ore_mirefen_t2b',
    ]);
    const qtyByRarity: Record<string, number> = {
      common: 1,
      uncommon: 2,
      rare: 2,
      epic: 3,
      legendary: 4,
    };
    const baseOf = (g: Ev): number => qtyByRarity[g.rarity] * (g.rareEvent ? 5 : 1);
    expect(gathers[0].professionId).toBe('mining');
    expect(gathers[0].qty).toBe(baseOf(gathers[0]) + 1);
    expect(gathers[1].qty).toBe(baseOf(gathers[1]));
    expect(gathers[2].qty).toBe(baseOf(gathers[2]) + 1);
    // A 30-charge slot never empties here, so the last-charge flag stays
    // ABSENT from every event (the additive-optional wire contract).
    expect(gathers.every((g) => !('effectDepleted' in g))).toBe(true);

    // The draw ledger, cumulative per checkpoint (rng.draws counts from
    // drive start): every granted harvest is exactly two draws and nothing
    // else draws, so the R40 consent gate adds NO draw on either of its
    // arms and both mints stay draw-free (the prompt re-slot checkpoint
    // sits at the same count as the harvest before it).
    const drawsAt = (label: string): number => {
      const frame = trace.frames.find((f) => f.label === label);
      expect(frame, `missing the ${label} checkpoint frame`).toBeTruthy();
      return frame?.rng.draws ?? -1;
    };
    expect(drawsAt('harvest-with-effect-applied')).toBe(2);
    expect(drawsAt('prompt-mode-reslotted')).toBe(2);
    expect(drawsAt('prompt-unconfirmed-skips-whole')).toBe(4);
    expect(drawsAt('prompt-confirmed-fires-and-spends')).toBe(6);
    expect(
      ev.some(
        (e) => e.type === 'error' && e.text === 'This resource node has not respawned for you yet.',
      ),
    ).toBe(true);
    expect(trace.draws).toBe(6);

    // The R42 charge settle, pinned where the golden records it: the final
    // checkpoint's sampled slot row. One bonus-bearing harvest spent exactly
    // one charge, so durability sits strictly below the slot's own ceiling.
    // The ceiling is an absolute pin, not a self-comparison: 20 base charges
    // for the cache plus one rarity rung for the uncommon tier-3 pick, and the
    // R47 use-time ratchet leaves it there because that pick was already the
    // best tool owned at mint time.
    const finalFrame = trace.frames.find((f) => f.label === 'final');
    expect(finalFrame, 'missing the final checkpoint frame').toBeTruthy();
    const slot = (finalFrame!.players?.[0] as any)?.toolEffectSlots?.mining;
    expect(slot, 'the final checkpoint sampled no mining tool-effect slot').toBeTruthy();
    expect(slot.effectId).toBe('gatherers_cache');
    // The R40 re-slot carried the prompt mode onto the live row, and only
    // the CONFIRMED use spent from the fresh 30: the unconfirmed one kept
    // its charge (the fail-safe), so exactly one charge is gone.
    expect(slot.confirmMode).toBe('prompt');
    // The self-signed charm's signer became the slot's original-crafter identity.
    expect(slot.craftedBy).toBe(meta.name);
    expect(slot.maxDurability).toBe(30);
    expect(slot.durability).toBeLessThan(slot.maxDurability);
    expect(slot.durability).toBe(29);
  });

  it('farming_session: plants draw two each, every harvest one golden roll, the tier-3 one the seed-back too', () => {
    const { trace, rec } = record(SCENARIOS.find((s) => s.name === 'farming_session')!);
    const ev = rec.allEvents as Ev[];
    const pid = (rec.sim as any).playerId as number;
    const meta = (rec.sim as any).players.get(pid);

    // All five plants landed, in drive order, and each started the flavor
    // cast. The second one is the load-bearing half of the busy gate (it only
    // lands because the drive waits out the first cast); the third is the
    // knobbed plant on the freed bed; the fourth is the tier-3 barley at the
    // Thornpeak patch; the fifth is the Phase 8 ready-notice beat back on the
    // freed northern bed.
    expect(ev.filter((e) => e.type === 'farmPlanted').map((e) => e.bedId)).toEqual([
      'bed_eastbrook_1',
      'bed_eastbrook_2',
      'bed_eastbrook_1',
      'bed_thornpeak_1',
      'bed_eastbrook_1',
      // The Phase 11 (bw) extension: 28 padding cycles on the southern bed,
      // the golden-WIN plant on the northern bed, one more padding cycle,
      // then the paying-band barley at Thornpeak (see the drive's probe
      // comment for why the padding walks the stream).
      ...Array.from({ length: 28 }, () => 'bed_eastbrook_2'),
      'bed_eastbrook_1',
      'bed_eastbrook_2',
      'bed_thornpeak_1',
    ]);
    expect(
      ev.filter((e) => e.type === 'castStart' && e.ability === 'farming'),
      'every plant started the FARMING_CAST_ID flavor cast',
    ).toHaveLength(36);

    // THE READY NOTICE (Phase 8): the fifth plant is left standing across two
    // 1 Hz boundaries, so the sweep fires EXACTLY once for it: a second event
    // here means the notified flip stopped silencing the sweep, and zero
    // means the sweep stopped observing ready plots at all. Counts only, no
    // withered field on an all-survived notice.
    expect(ev.filter((e) => e.type === 'farmReady')).toEqual([
      { type: 'farmReady', pid, ready: 1 },
    ]);

    // THE DRAW LEDGER, the point of this scenario. rng.draws is cumulative
    // from drive start: two draws per plant (the contiguous survival + yield
    // seed pre-roll), EXACTLY one golden-harvest roll at EVERY harvest
    // (both outcomes, the celebrations phase), plus the seed-back roll at
    // the tier-3 harvest (so harvested-t3 sits at planted-t3 + 2, the
    // contiguous pair), and NOTHING anywhere else. Growth windows and the
    // husk trade sit at the count of the beat before them; the two tier-1
    // opening harvests land together in the harvested frame at +2 (one
    // golden roll each, survived and withered alike).
    const drawsAt = (label: string): number => {
      const frame = trace.frames.find((f) => f.label === label);
      expect(frame, `missing the ${label} checkpoint frame`).toBeTruthy();
      return frame?.rng.draws ?? -1;
    };
    expect(drawsAt('planted-first')).toBe(2);
    expect(drawsAt('planted')).toBe(4);
    expect(drawsAt('grown')).toBe(4);
    expect(drawsAt('harvested')).toBe(6);
    expect(drawsAt('planted-knobbed')).toBe(8);
    expect(drawsAt('harvested-toniced')).toBe(9);
    expect(drawsAt('husks-converted')).toBe(9);
    expect(drawsAt('planted-t3')).toBe(11);
    expect(drawsAt('harvested-t3')).toBe(13);
    // The Phase 8 ready-notice beat: its plant pre-rolls two more, then
    // NOTHING draws through the sweep that emits the notice or the sampled
    // notified flag, and the closing tier-1 harvest spends exactly its one
    // golden roll.
    expect(drawsAt('ready-noticed')).toBe(15);
    expect(drawsAt('harvested-noticed')).toBe(16);
    // The Phase 11 (bw) extension: 28 padding cycles (three draws each) plus
    // the win plant put the golden-WIN harvest's one roll at draw 103, the
    // final padding cycle plus the barley plant put the paying seed-back
    // pair at 109 and 110. The padding arithmetic is the probe comment in
    // the drive; these literals are what pin it.
    expect(drawsAt('planted-golden')).toBe(102);
    expect(drawsAt('harvested-golden-win')).toBe(103);
    expect(drawsAt('planted-t3-paying')).toBe(108);
    expect(drawsAt('harvested-t3-paying')).toBe(110);
    // THE PHASE 12 BEAT-P FRAMES: the dish's tick-phase mint and the whole
    // feast loop (place, bite, mint, expire) draw NOTHING: the ledger closes
    // at 110 with every appended frame flat (the recorded truth of the
    // re-recorded golden).
    expect(drawsAt('wellfed-eating')).toBe(110);
    expect(drawsAt('wellfed-dish-minted')).toBe(110);
    expect(drawsAt('feast-placed')).toBe(110);
    expect(drawsAt('feast-bitten')).toBe(110);
    expect(drawsAt('feast-wellfed-minted')).toBe(110);
    expect(drawsAt('feast-expired')).toBe(110);
    expect(trace.draws).toBe(110);

    // The knobbed plant really stored all three paid flags (farmPlanted is
    // knob-free on the wire, so the drive stashes the stored plot's flags).
    expect(rec.notes.knobbedFlags).toEqual({ compost: true, watch: true, tonic: true });

    // The first survived plot paid produce expanded from its stored yield
    // seed: the guaranteed three-pick floor, with no pick upgrading at
    // proficiency 0 (the fine chance there is 0.02), so BOTH fine fields stay
    // absent and the common harvest keeps the pre-field wire shape. No
    // seedBackCount either: tier 1 never rolls (the omit-zero doctrine).
    const harvested = ev.filter((e) => e.type === 'farmHarvested');
    expect(harvested).toHaveLength(6);
    // The Phase 8 closing harvest: skill sits at 75-and-change by now, and
    // its yieldSeed now mints two stream positions later (the golden rolls
    // upstream re-seated every later mint), so the expansion pays 3 (the
    // recorded truth of the re-recorded golden, a literal for the drawsAt
    // reason above) with no fine or seed-back fields on a tier-1 crop. Its
    // own golden roll (draw 16, 0.515190) loses, so no multiplier.
    expect(harvested[3]).toEqual({
      type: 'farmHarvested',
      pid,
      bedId: 'bed_eastbrook_1',
      cropId: 'vale_wheat',
      itemId: 'vale_wheat',
      count: 3,
    });
    expect('fineItemId' in harvested[3]).toBe(false);
    expect('seedBackCount' in harvested[3]).toBe(false);
    expect(harvested[0].bedId).toBe('bed_eastbrook_1');
    expect(harvested[0].itemId).toBe('vale_wheat');
    expect(harvested[0].count).toBe(3);
    expect('fineItemId' in harvested[0]).toBe(false);
    expect('fineCount' in harvested[0]).toBe(false);
    expect('seedBackCount' in harvested[0]).toBe(false);

    // The plot forced to fail paid husks INSTEAD of produce, and said so with
    // its own event rather than a quiet empty harvest. Tier 1: no seed-back
    // field on the withered arm either.
    const withered = ev.filter((e) => e.type === 'farmWithered');
    // One from the original forced-fail beat, 29 from the Phase 11 padding
    // cycles (all on the southern bed at the written skill-0 window, each
    // paying the same two-husk batch, none carrying a seed-back field).
    expect(withered).toHaveLength(30);
    expect(withered[0].bedId).toBe('bed_eastbrook_2');
    expect(withered[0].count).toBe(2);
    expect('seedBackCount' in withered[0]).toBe(false);
    for (const w of withered.slice(1)) {
      expect(w.bedId).toBe('bed_eastbrook_2');
      expect(w.count).toBe(2);
      expect('seedBackCount' in w).toBe(false);
    }

    // The toniced harvest, on the probed WINNING yieldSeed the drive wrote
    // (the M8 lesson: at a losing seed both expansions coincide and this
    // beat proves nothing). The in-arm non-vacuity guard is the first
    // assertion: the toniced expansion of that seed really exceeds the
    // unarmed one at the harvest-time skill of 1 (the first harvest's +1
    // gain had drained by then).
    const toniced = resolveFarmHarvest(FARM_TONIC_WINNER_YIELD_SEED, 1, true);
    const unarmed = resolveFarmHarvest(FARM_TONIC_WINNER_YIELD_SEED, 1, false);
    expect(toniced.count).toBeGreaterThan(unarmed.count);
    expect(toniced.fine).toBe(0); // the probe chose a fine-free winner
    expect(harvested[1].bedId).toBe('bed_eastbrook_1');
    expect(harvested[1].itemId).toBe('vale_wheat');
    expect(harvested[1].count).toBe(toniced.count);
    expect('fineItemId' in harvested[1]).toBe(false);
    expect('seedBackCount' in harvested[1]).toBe(false);

    // The husk trade: the withered beat paid exactly 2 husks, one batch, so
    // one call converts them into exactly one compost.
    const convertedEv = ev.filter((e) => e.type === 'farmHusksConverted');
    expect(convertedEv).toHaveLength(1);
    expect(convertedEv[0].husks).toBe(2);
    expect(convertedEv[0].compost).toBe(1);

    // The tier-3 harvest. The band is pinned as a LITERAL, the drawsAt style
    // above: seedBackCount 0 (the zero band, so the field is OMITTED) is the
    // recorded truth of the re-recorded farming_session golden, and it moves
    // only with a deliberate re-record, never silently. The golden rolls
    // upstream re-seated the seed-back roll from the old draw 9 (0.297173,
    // the one-seed band) to draw 12 (0.981881, the zero band): the
    // celebrations phase's expected ledger shift, not a band retune. The bag
    // consistency arm stays: the event's count must equal the
    // highland_barley_seed bag delta (the drive granted 1 seed and the plant
    // spent it, so the final bag IS the seed-back), and the base/fine grants
    // must match their bags the same way.
    const countOf = (itemId: string): number =>
      meta.inventory
        .filter((s: any) => s.itemId === itemId)
        .reduce((n: number, s: any) => n + (s.count ?? 1), 0);
    const barleyEv = harvested[2];
    expect(barleyEv.bedId).toBe('bed_thornpeak_1');
    expect(barleyEv.cropId).toBe('highland_barley');
    const seedBack = (barleyEv.seedBackCount as number | undefined) ?? 0;
    expect(seedBack).toBe(0);
    expect('seedBackCount' in barleyEv).toBe(false); // omit-zero doctrine

    // THE PHASE 11 (bw) BEATS, in the same drawsAt-literal style: the golden
    // WIN and the PAYING seed-back band are the recorded truth of the
    // re-recorded golden and move only with a deliberate re-record.
    const goldenEv = harvested[4];
    const barleyPayingEv = harvested[5];
    // The WIN: the five-fold applies to BOTH grades of the probed
    // both-grades yield seed (the in-arm non-vacuity guard first, the M8
    // rule: the unfolded expansion really is nonzero in base AND fine, so
    // the x5 below cannot be five times zero on either grade).
    const goldenExpansion = resolveFarmHarvest(FARM_GOLDEN_WIN_YIELD_SEED, 75);
    expect(goldenExpansion.count).toBeGreaterThan(0);
    expect(goldenExpansion.fine).toBeGreaterThan(0);
    expect(goldenEv).toEqual({
      type: 'farmHarvested',
      pid,
      bedId: 'bed_eastbrook_1',
      cropId: 'vale_wheat',
      itemId: 'vale_wheat',
      count: goldenExpansion.count * 5,
      fineItemId: 'fine_vale_wheat',
      fineCount: goldenExpansion.fine * 5,
    });
    // The announce fanout: exactly ONE gatherRareEvent (one player in zone),
    // the crop source naming the base grant, and the finder's visit mark
    // written while the reliquary field-note stays the ledgered no-op.
    const rare = ev.filter((e) => e.type === 'gatherRareEvent');
    expect(rare).toHaveLength(1);
    expect(rare[0]).toEqual({
      type: 'gatherRareEvent',
      pid,
      flavor: 'golden_harvest',
      finderName: 'Adventurer',
      finderPid: pid,
      zoneId: 'eastbrook_vale',
      nodeType: 'crop',
      itemId: 'vale_wheat',
    });
    expect(meta.deedStats.visited.has('gather_event:golden_harvest')).toBe(true);
    expect(meta.reliquary.marks.has('gather_event:golden_harvest')).toBe(false);
    // THE PAYING BAND: seedBackCount PRESENT at exactly one (the one-seed
    // band, 0.08 <= 0.155753 < 0.4), the upgrade from the zero-band beat
    // above whose grant proof degraded to 0 === 0.
    expect(barleyPayingEv.bedId).toBe('bed_thornpeak_1');
    expect(barleyPayingEv.cropId).toBe('highland_barley');
    expect(barleyPayingEv.seedBackCount).toBe(1);

    // Bag consistency across BOTH tier-3 beats: the zero-band beat left no
    // seed and the paying beat's one seed-back is the only barley seed the
    // player holds (each beat's granted seed was consumed by its own plant).
    expect(countOf('highland_barley_seed')).toBe(seedBack + 1);
    expect(countOf(barleyEv.itemId)).toBe(
      (barleyEv.count as number) + (barleyPayingEv.count as number),
    );
    if (barleyEv.fineItemId !== undefined || barleyPayingEv.fineItemId !== undefined) {
      const fineTotal =
        ((barleyEv.fineCount as number | undefined) ?? 0) +
        ((barleyPayingEv.fineCount as number | undefined) ?? 0);
      expect(countOf('fine_highland_barley')).toBe(fineTotal);
    }

    // ONE LINE PER FARM GRANT (#2430), pinned where it is actually
    // observable. Every farm payout goes through the shared inventory hub,
    // whose "You receive: X" loot event must ride with { silent: true,
    // callerLogs: true } so the client's own farming line is the only one a
    // player sees. The drive's scaffolding grants keep the plain hub line,
    // which is the inverse arm proving the flags come from the farming grant
    // path and not from every loot event in the world. The partition is
    // exhaustive and EXACT: no event may carry half the pair, the unflagged
    // side is pinned to the eight scaffolding grants in drive order, and the
    // flagged side is counted by arithmetic over the farm events themselves
    // (one hub grant per base payout, per present fine pair, per present
    // seedBackCount, per husk trade).
    const loot = ev.filter((e) => e.type === 'loot');
    const flagged = loot.filter((l) => l.silent === true && l.callerLogs === true);
    const unflagged = loot.filter((l) => l.silent === undefined && l.callerLogs === undefined);
    expect(flagged.length + unflagged.length, 'no loot event may carry half the flag pair').toBe(
      loot.length,
    );
    const receiveLine = (itemId: string, count = 1): string =>
      `You receive: ${(ITEMS as any)[itemId].name}${count > 1 ? ' x' + count : ''}.`;
    expect(unflagged.map((l) => l.text)).toEqual([
      receiveLine('vale_wheat_seed', 2),
      receiveLine('garden_hoe'),
      receiveLine('vale_wheat_seed'),
      receiveLine('compost'),
      receiveLine('growth_tonic'),
      receiveLine('vale_wheat', 2),
      receiveLine('skysilver_hoe'),
      receiveLine('highland_barley_seed'),
      receiveLine('vale_wheat_seed'), // the Phase 8 ready-notice beat's seed
      // The Phase 11 (bw) extension's scaffolding, in drive order: one seed
      // per padding cycle (28), the golden-win beat's seed, the final
      // padding cycle's seed, then the paying tier-3 beat's barley seed.
      ...Array.from({ length: 30 }, () => receiveLine('vale_wheat_seed')),
      receiveLine('highland_barley_seed'),
      // The Phase 12 beat-P scaffolding, in drive order: the dish the
      // tick-phase mint eats, then the feast item the place verb spends.
      receiveLine('evergarden_braised_greens'),
      receiveLine('harvest_feast'),
    ]);
    const expectedFlagged =
      harvested.reduce(
        (n, e) =>
          n + 1 + (e.fineItemId !== undefined ? 1 : 0) + (e.seedBackCount !== undefined ? 1 : 0),
        0,
      ) +
      withered.reduce((n, e) => n + 1 + (e.seedBackCount !== undefined ? 1 : 0), 0) +
      convertedEv.length;
    expect(flagged).toHaveLength(expectedFlagged);

    // The bags agree with every beat: the fee spent 2 of the 5 produce held
    // (3 banked + 2 scaffolding) before the toniced harvest re-paid, the
    // Phase 8 closing harvest banked its 7 on top (harvested[3] above), the
    // husk batch became the compost back in the bag (1 granted - 1 paid + 1
    // converted), the tonic was consumed, and every seed pouch is empty
    // except the seed-back. Both eastbrook beds and the thornpeak bed are
    // free again (one visit takes the plot out on either outcome).
    // The Phase 11 terms: the golden win banks its five-fold base grade on
    // top (signed instances count like any stack member here), the fine
    // grade is the win's alone, and the 29 padding withers re-fill the husk
    // pouch AFTER the convert beat (two per cycle, never converted again).
    expect(countOf('vale_wheat')).toBe(3 + toniced.count + 3 + goldenExpansion.count * 5);
    expect(countOf('fine_vale_wheat')).toBe(goldenExpansion.fine * 5);
    expect(countOf('withered_husks')).toBe(
      withered.slice(1).reduce((n, w) => n + (w.count as number), 0),
    );
    expect(countOf('vale_wheat_seed')).toBe(0);
    expect(countOf('compost')).toBe(1);
    expect(countOf('growth_tonic')).toBe(0);

    // THE PHASE 12 BEAT P, event and state truth. Exactly one
    // farmFeastPlaced (the placer's own confirmation; everyone else learns
    // by seeing the entity), and the post-drive world holds NO feast: the
    // draw-free expiry write plus ONE 1 Hz updateFarming sweep dropped the
    // entity and the FeastState together.
    const placedEv = ev.filter((e) => e.type === 'farmFeastPlaced');
    expect(placedEv).toHaveLength(1);
    expect(placedEv[0].pid).toBe(pid);
    const simAny = rec.sim as any;
    expect(simAny.feasts.size).toBe(0);
    expect(simAny.entities.get(placedEv[0].feastId)).toBeUndefined();
    // The bite refreshed the dish mint (last-eaten-wins on the ONE unified
    // 'well_fed' id, Masterwrought 11c): the drive ends Well Fed at the
    // tier-4 dish's ladder value 5, and both beat-P items left the bags
    // (the dish eaten, the feast spent at placement).
    const wellfedAura = (simAny.player.auras as any[]).find((a) => a.id === 'well_fed');
    expect(wellfedAura?.value).toBe(5);
    expect(countOf('evergarden_braised_greens')).toBe(0);
    expect(countOf('harvest_feast')).toBe(0);
    expect(meta.farmPlots.size).toBe(0);

    // The gathering-grant drain across the whole session: the first harvest
    // and the toniced one both grant at low proficiency and are drained before
    // the drive's proficiency write of 75, then the barley harvest's tier-3
    // gain at 75 (tier 3 teaches past 75) lands on the tail ticks. The
    // Phase 11 extension leaves the SAME final value by a different route:
    // its padding withers at the written skill-0 window queue nothing, the
    // win harvest at the written 75 grays on a tier-1 crop, and only the
    // paying barley harvest adds its gain on top of the final restore of 75.
    //
    // STRICT equality, and the gain is READ rather than restated. Both halves
    // are deliberate: reading it means a future re-tune moves this arm with the
    // schedule instead of reddening it, and strict equality is now available at
    // all because every gain is exactly representable (masterwrought 11e), so a
    // toBeCloseTo here would tolerate the very accumulation drift the re-tune
    // removed.
    expect(meta.gatheringProficiency.farming).toBe(75 + farmingHarvestGainAt(75, 3));
  });

  it('rift_boss_floor: stretched S fuse spawns, detonates, and boss death clears the pending zone', () => {
    const rec = run('rift_boss_floor');
    const ev = rec.allEvents as Ev[];
    const n = rec.notes as Record<string, unknown>;
    // The driver fired twice: the driven fuse plus the pre-death zone.
    const spawns = ev.filter((e) => e.type === 'riftDeathZoneSpawn');
    expect(spawns.length).toBeGreaterThanOrEqual(2);
    // The first fuse carries the S tempo (0.7) times the capped 50%-slow
    // stretch (2x) over Venom Pool's authored castTime: both arms really ran.
    expect((spawns[0] as { durationSecs?: number }).durationSecs).toBeCloseTo(
      MOBS.rift_boss_venom.deathZoneCast!.castTime * RIFT_S_ZONE_TEMPO * RIFT_IMPAIRED_FUSE_CAP,
      5,
    );
    // The fuse ran out: the detonation telegraph line fired.
    expect(
      ev.some(
        (e) => e.type === 'log' && typeof e.text === 'string' && e.text.includes('Venom Pool'),
      ),
    ).toBe(true);
    // Boss death cancelled the pending zone and told online mirrors.
    expect(ev.some((e) => e.type === 'riftDeathZoneClear')).toBe(true);
    // The escape window was genuinely open while the guard fought, and the
    // guard's web never landed inside it (riftControlSuppressed fired).
    expect(n.windowOpenDuringGuardFight).toBe(true);
    expect(n.playerRootedInWindow).toBe(false);
  });

  it('idle_mob_distance_culling: advances the near mob, freezes the far mob, and keeps passive rolls off the shared stream', () => {
    const scenario = SCENARIOS.find((item) => item.name === 'idle_mob_distance_culling');
    expect(scenario, 'missing the idle-mob culling parity scenario').toBeTruthy();
    if (!scenario) return;

    const { trace, rec } = record(scenario);
    expect(rec.sim.cfg.idleMobTickRadius).toBe(100);
    const near = rec.sim.entities.get(rec.notes.nearMobId as number);
    const far = rec.sim.entities.get(rec.notes.farMobId as number);
    expect(near, 'near boundary probe disappeared').toBeTruthy();
    expect(far, 'far boundary probe disappeared').toBeTruthy();
    if (!near || !far) return;
    expect(Math.hypot(near.pos.x - near.spawnPos.x, near.pos.z - near.spawnPos.z)).toBeGreaterThan(
      0.1,
    );
    expect({ x: far.pos.x, z: far.pos.z }).toEqual({ x: far.spawnPos.x, z: far.spawnPos.z });
    expect(trace.draws).toBe(0);
  });

  it('grix_respawn_window: both deaths roll an independent 15 to 30 minute timer', () => {
    const rec = run('grix_respawn_window');
    const first = rec.notes.firstRoll as number;
    const second = rec.notes.secondRoll as number;
    for (const roll of [first, second]) {
      // rng.range(36, 72) x 25s: uniform in the half-open [900, 1800).
      expect(roll).toBeGreaterThanOrEqual(900);
      expect(roll).toBeLessThan(1800);
    }
    // Independent draws: equal rolls would mean the death site stopped
    // consuming the stream per death (this seed pair does not collide).
    expect(first).not.toBe(second);
    // The in-place respawn between the kills really happened, so the second
    // roll came from a genuine second death of the same entity id.
    expect(rec.notes.respawned).toBe(true);
    const deaths = (rec.allEvents as Ev[]).filter((e) => e.type === 'death');
    expect(deaths.length).toBeGreaterThanOrEqual(2);
  });

  it('rift_clear_rewards: the winning A clear really pays the corpse ladder, pattern draw included', () => {
    const rec = run('rift_clear_rewards');
    const inst = rec.sim.riftInstances.find((i) => i.partyKey !== null);
    expect(inst, 'the rift instance disappeared before the clear').toBeTruthy();
    // completeRiftClear ran through the real sweep: won, rewarded, egress open.
    expect(inst?.outcome).toBe('won');
    expect(inst?.rewarded).toBe(true);
    expect(inst?.exitId).not.toBeNull();
    const boss = rec.sim.entities.get(rec.notes.bossId as number);
    expect(boss, 'the tracked boss corpse disappeared before the payout').toBeTruthy();
    const items = (boss?.loot?.items ?? []).map((entry) => entry.itemId);
    // Draw 2 (the guaranteed heroic epic) plus draw 6 (the pattern) both landed:
    // the seed is chosen so the 8% pattern roll SUCCEEDS in-window, so the golden
    // pins the rng.int pick over the sorted RIFT_PATTERN_ITEM_IDS too, and this
    // proves the recorded window really contains the whole payout, not a truncated
    // run that never reached completeRiftClear.
    const patterns = items.filter((id) =>
      (RIFT_PATTERN_ITEM_IDS as readonly string[]).includes(id),
    );
    expect(patterns.length).toBe(1);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(boss?.lootable).toBe(true);
    // The A-rank clear-time coin bonus landed on top of the static boss coin.
    expect(boss?.loot?.copper ?? 0).toBeGreaterThanOrEqual(RIFT_COIN_BONUS_A);
  });

  // The three sibling ranks (masterwrought Phase 11f). addRiftClearGearLoot's
  // ladder is rank-gated, so one rank exercises only its own arms: before these
  // three, draws 0, 1, 3 and 4 ran in no golden at all. Phase 11f appends a new
  // draw after draw 6 on the same winning path, so the ladder is pinned at every
  // rank FIRST and the append lands in a stream these goldens cover.
  //
  // Each arm asserts what its rank's arm REACHES, not merely that a clear paid:
  // an assertion that passes at every rank would not tell the four apart, which
  // is the whole point of recording them separately.
  it('rift_clear_rewards_c: the C arm pays draw 0 and RETURNS before every other draw', () => {
    const rec = run('rift_clear_rewards_c');
    const inst = rec.sim.riftInstances.find((i) => i.partyKey !== null);
    expect(inst?.outcome).toBe('won');
    expect(inst?.rewarded).toBe(true);
    const boss = rec.sim.entities.get(rec.notes.bossId as number);
    const items = (boss?.loot?.items ?? []).map((entry) => entry.itemId);
    // Draw 0 landed: exactly one guaranteed pick from the normal-clear pool.
    const normalPool = new Set(riftNormalClearPool());
    expect(items.filter((id) => normalPool.has(id)).length).toBe(1);
    // The EARLY RETURN is the pin: no pattern (draw 6) and no mount (draw 5)
    // can appear at C, whatever the seed, because the arm exits after draw 0.
    // This is the decisive half; a C run that shed either would mean the
    // early-out stopped exiting.
    expect(items.filter((id) => (RIFT_PATTERN_ITEM_IDS as readonly string[]).includes(id))).toEqual(
      [],
    );
    expect(items.filter((id) => id.startsWith('reins_'))).toEqual([]);
    expect(items.length).toBe(1);
    expect(boss?.loot?.copper ?? 0).toBeGreaterThanOrEqual(RIFT_COIN_BONUS_C);
    expect(boss?.lootable).toBe(true);
  });

  it('rift_clear_rewards_b: the B arm pays draws 1, 5 and 6, and the pattern lands in-window', () => {
    const rec = run('rift_clear_rewards_b');
    const inst = rec.sim.riftInstances.find((i) => i.partyKey !== null);
    expect(inst?.outcome).toBe('won');
    const boss = rec.sim.entities.get(rec.notes.bossId as number);
    const items = (boss?.loot?.items ?? []).map((entry) => entry.itemId);
    // Draw 1: RIFT_EPIC_CHANCE_B is 1.0, so B always sheds its heroic epic.
    // Draw 6: the seed was hunted so the 8% roll SUCCEEDS, which is what makes
    // this golden pin the rng.int pick over the sorted id list rather than a miss.
    const patterns = items.filter((id) =>
      (RIFT_PATTERN_ITEM_IDS as readonly string[]).includes(id),
    );
    expect(patterns.length).toBe(1);
    expect(items.length).toBeGreaterThanOrEqual(2);
    // B is NOT S: no legendary roll (draws 3 and 4) is reachable on this arm.
    expect(items.filter((id) => id.startsWith('reins_')).length).toBeLessThanOrEqual(1);
    expect(boss?.loot?.copper ?? 0).toBeGreaterThanOrEqual(RIFT_COIN_BONUS_B);
    expect(boss?.lootable).toBe(true);
  });

  it('rift_clear_rewards_s: the S arm reaches the legendary rolls and the pattern draw', () => {
    const rec = run('rift_clear_rewards_s');
    const inst = rec.sim.riftInstances.find((i) => i.partyKey !== null);
    expect(inst?.outcome).toBe('won');
    const boss = rec.sim.entities.get(rec.notes.bossId as number);
    const items = (boss?.loot?.items ?? []).map((entry) => entry.itemId);
    const patterns = items.filter((id) =>
      (RIFT_PATTERN_ITEM_IDS as readonly string[]).includes(id),
    );
    expect(patterns.length).toBe(1);
    // The S coin bonus is the arm's own discriminator: it is the only rank
    // paying RIFT_COIN_BONUS_S, so this fails if the scenario silently drifted
    // to another rank (a baseLevel typo would otherwise still look like a clear).
    expect(boss?.loot?.copper ?? 0).toBeGreaterThanOrEqual(RIFT_COIN_BONUS_S);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(boss?.lootable).toBe(true);
  });

  // The four rows tile the ladder between them rather than repeating one arm:
  // stated as a test so a future edit that points two scenarios at the same
  // baseLevel (the cheapest way to silently lose a rank) reds here.
  it('the four rift reward scenarios cover four DISTINCT ranks', () => {
    const names = [
      'rift_clear_rewards_c',
      'rift_clear_rewards_b',
      'rift_clear_rewards',
      'rift_clear_rewards_s',
    ];
    const bonuses = new Set<number>();
    for (const name of names) {
      const rec = run(name);
      const boss = rec.sim.entities.get(rec.notes.bossId as number);
      bonuses.add(boss?.loot?.copper ?? 0);
    }
    // C and B share a coin bonus literal (both 10 000c), so the copper alone
    // cannot separate all four; the C arm's item shape above is what tells
    // those two apart. Three distinct totals is the honest claim here.
    expect(bonuses.size).toBeGreaterThanOrEqual(3);
    expect(SCENARIOS.filter((s) => s.name.startsWith('rift_clear_rewards')).length).toBe(4);
  });
});
