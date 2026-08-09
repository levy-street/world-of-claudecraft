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
import { ITEMS } from '../../src/sim/data';
import { resolveFarmHarvest } from '../../src/sim/professions/farming';
import { record } from './record';
import { type Ev, entities, run } from './run_scenarios';
import { FARM_TONIC_WINNER_YIELD_SEED, SCENARIOS } from './scenarios';

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

  it('c4b_effect_dispatch: runEffects fans across sunder/aoe/finisher/judgement/fear/groundAoE/summon/form', () => {
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
    // paladin judgement: a holy damage from the paladin (the Seal unleashed).
    const paladin = rec.notes.paladinId as number;
    expect(
      ev.some((e) => e.type === 'damage' && e.sourceId === paladin && e.school === 'holy'),
    ).toBe(true);
    // paladin consecration: a ground AoE was pushed (on-cast pulse path).
    expect((rec.sim as any).groundAoEs.length).toBeGreaterThanOrEqual(1);
    // warlock fear: the incapacitate aura landed on the warlock's mob (fear-angle draw).
    const warlockMob = ents.find((e) => e.id === rec.notes.warlockMobId);
    expect(warlockMob?.auras?.some((a: Ev) => a.kind === 'incapacitate')).toBe(true);
    // warlock summon_imp: a pet now belongs to the warlock (summonDemon -> summonPet).
    expect(ents.some((e) => e.ownerId === rec.notes.warlockId)).toBe(true);
    // druid form switch: the LAST form (cat) is active and bear was stripped.
    const druid = ents.find((e) => e.id === rec.notes.druidId);
    expect(druid?.auras?.some((a: Ev) => a.kind === 'form_cat')).toBe(true);
    expect(druid?.auras?.some((a: Ev) => a.kind === 'form_bear')).toBe(false);
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
    expect(trace.draws).toBe(3);
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

  it('farming_session: plants draw two each, only the tier-3 harvest draws one (the seed-back roll)', () => {
    const { trace, rec } = record(SCENARIOS.find((s) => s.name === 'farming_session')!);
    const ev = rec.allEvents as Ev[];
    const pid = (rec.sim as any).playerId as number;
    const meta = (rec.sim as any).players.get(pid);

    // All four plants landed, in drive order, and each started the flavor
    // cast. The second one is the load-bearing half of the busy gate (it only
    // lands because the drive waits out the first cast); the third is the
    // knobbed plant on the freed bed; the fourth is the tier-3 barley at the
    // Thornpeak patch.
    expect(ev.filter((e) => e.type === 'farmPlanted').map((e) => e.bedId)).toEqual([
      'bed_eastbrook_1',
      'bed_eastbrook_2',
      'bed_eastbrook_1',
      'bed_thornpeak_1',
    ]);
    expect(
      ev.filter((e) => e.type === 'castStart' && e.ability === 'farming'),
      'every plant started the FARMING_CAST_ID flavor cast',
    ).toHaveLength(4);

    // THE DRAW LEDGER, the point of this scenario. rng.draws is cumulative
    // from drive start: two draws per plant (the contiguous survival + yield
    // seed pre-roll), EXACTLY one at the tier-3 harvest (the seed-back roll),
    // and NOTHING anywhere else. Growth windows, tier-1 harvests (toniced
    // included), and the husk trade all sit at the count of the beat before
    // them; harvested-t3 sitting at planted-t3 + 1 is the seed-back clause.
    const drawsAt = (label: string): number => {
      const frame = trace.frames.find((f) => f.label === label);
      expect(frame, `missing the ${label} checkpoint frame`).toBeTruthy();
      return frame?.rng.draws ?? -1;
    };
    expect(drawsAt('planted-first')).toBe(2);
    expect(drawsAt('planted')).toBe(4);
    expect(drawsAt('grown')).toBe(4);
    expect(drawsAt('harvested')).toBe(4);
    expect(drawsAt('planted-knobbed')).toBe(6);
    expect(drawsAt('harvested-toniced')).toBe(6);
    expect(drawsAt('husks-converted')).toBe(6);
    expect(drawsAt('planted-t3')).toBe(8);
    expect(drawsAt('harvested-t3')).toBe(9);
    expect(trace.draws).toBe(9);

    // The knobbed plant really stored all three paid flags (farmPlanted is
    // knob-free on the wire, so the drive stashes the stored plot's flags).
    expect(rec.notes.knobbedFlags).toEqual({ compost: true, watch: true, tonic: true });

    // The first survived plot paid produce expanded from its stored yield
    // seed: the guaranteed three-pick floor, with no pick upgrading at
    // proficiency 0 (the fine chance there is 0.02), so BOTH fine fields stay
    // absent and the common harvest keeps the pre-field wire shape. No
    // seedBackCount either: tier 1 never rolls (the omit-zero doctrine).
    const harvested = ev.filter((e) => e.type === 'farmHarvested');
    expect(harvested).toHaveLength(3);
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
    expect(withered).toHaveLength(1);
    expect(withered[0].bedId).toBe('bed_eastbrook_2');
    expect(withered[0].count).toBe(2);
    expect('seedBackCount' in withered[0]).toBe(false);

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
    // above: seedBackCount 1 (the one-seed band) is the recorded truth of the
    // committed farming_session golden, so it moves only with a deliberate
    // re-record, never silently. The tolerant toContain([0, 1, 2]) shape this
    // replaces would have let the grant half of the beat go vacuous (a
    // seed-back that stopped paying still satisfied it). The bag consistency
    // arm stays: the event's count must equal the highland_barley_seed bag
    // delta (the drive granted 1 seed and the plant spent it, so the final
    // bag IS the seed-back), and the base/fine grants must match their bags
    // the same way.
    const countOf = (itemId: string): number =>
      meta.inventory
        .filter((s: any) => s.itemId === itemId)
        .reduce((n: number, s: any) => n + (s.count ?? 1), 0);
    const barleyEv = harvested[2];
    expect(barleyEv.bedId).toBe('bed_thornpeak_1');
    expect(barleyEv.cropId).toBe('highland_barley');
    const seedBack = (barleyEv.seedBackCount as number | undefined) ?? 0;
    expect(seedBack).toBe(1);
    expect(countOf('highland_barley_seed')).toBe(seedBack);
    expect(countOf(barleyEv.itemId)).toBe(barleyEv.count);
    if (barleyEv.fineItemId !== undefined) {
      expect(countOf(barleyEv.fineItemId)).toBe(barleyEv.fineCount);
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
    // husk batch became the compost back in the bag (1 granted - 1 paid + 1
    // converted), the tonic was consumed, and every seed pouch is empty
    // except the seed-back. Both eastbrook beds and the thornpeak bed are
    // free again (one visit takes the plot out on either outcome).
    expect(countOf('vale_wheat')).toBe(3 + toniced.count);
    expect(countOf('withered_husks')).toBe(0);
    expect(countOf('vale_wheat_seed')).toBe(0);
    expect(countOf('compost')).toBe(1);
    expect(countOf('growth_tonic')).toBe(0);
    expect(meta.farmPlots.size).toBe(0);

    // The gathering-grant drain across the whole session: +1 at proficiency
    // 0 from the first harvest, +1 at 1 from the toniced harvest (drained
    // before the drive's proficiency write of 75), then the barley harvest's
    // 0.02 at 75 (tier 3 teaches past 75) lands on the tail ticks.
    expect(meta.gatheringProficiency.farming).toBeCloseTo(75.02, 10);
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
});
