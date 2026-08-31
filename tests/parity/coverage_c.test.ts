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
import { MOBS } from '../../src/sim/data';
import { RIFT_IMPAIRED_FUSE_CAP } from '../../src/sim/mob/rift_escape_window';
import { RIFT_S_ZONE_TEMPO } from '../../src/sim/rift/ranks';
import { record } from './record';
import { type Ev, entities, run } from './run_scenarios';
import { SCENARIOS } from './scenarios';

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

  it('bank_round_trip: both banker-counter stores actually move (the re-mint guard)', () => {
    // The golden is what UPDATE_PARITY regenerates wholesale, so a silently
    // broken recipe (a moved banker failing the proximity gate, every vault op
    // refusing) would mint a no-op arm with nothing red. Pin the final state
    // both stores must reach; the numbers are the scenario's own arithmetic
    // (71000 - 20000 - 50000 = 1000 copper; 10 ore deposited 6 then 2 back,
    // then the step-12 sweep re-stocks the carried 6; the whole 4-stack of
    // logs; the bank ladder's first 500-copper rung; and the sweep takes the
    // 5 wolf_fang the bank arm returned to the bags, wolf_fang being a recipe
    // reagent the honest material set admits).
    const rec = run('bank_round_trip');
    const pid = rec.notes.pid as number;
    // biome-ignore lint/suspicious/noExplicitAny: the recorder exposes the raw Sim
    const meta = (rec.sim as any).players.get(pid);
    expect(meta.vault.upgrades).toBe(2);
    expect(meta.vault.stock).toEqual({ ashwood_log: 4, copper_ore: 10, wolf_fang: 5 });
    expect(meta.copper).toBe(1000);
    expect(meta.bank.purchasedSlots).toBe(6);
    // The bank's ITEM arm nets to zero in the counters above (5 wolf_fang in,
    // 5 back out), so pin it directly: the bank ends empty, and the fangs the
    // withdraw returned to the bags are the SAME five the step-12 sweep then
    // stocked (the vault literal above), or a silently no-op'd
    // deposit/withdraw pair could still mint a green golden.
    expect(meta.bank.inventory).toEqual([]);
    // The sweep's OWN no-op arms: the dagger added beside it survives in the
    // bags (gear is not a material), the starting bread stays (a consumable is
    // not a material), and no carried material remains at all. NOTE: this pin
    // does NOT discriminate the sweep's iteration direction (every eligible
    // slot is fully consumed here, so ascending and descending end alike);
    // the direction guard is the slot-identity assertion in
    // tests/materials_vault.test.ts ('fills each material only to its
    // headroom, descending by slot index').
    // biome-ignore lint/suspicious/noExplicitAny: raw Sim inventory slots
    const carried = meta.inventory.map((s: any) => [s.itemId, s.count]);
    expect(carried).toEqual([
      ['baked_bread', 5],
      ['rusty_dagger', 1],
    ]);
  });

  it('bank_materials_satchel: a socketed satchel splits the pools, one gate answers twice', () => {
    // The re-mint guard for the ONE scenario in this suite that carries a
    // materials-only bag. Every other scenario runs with empty sockets, where
    // general = 16 / materials = 0 and the pool math is arithmetically the old
    // flat scalar, so a silently broken recipe here (the equip refusing, both
    // withdrawals refusing, both succeeding) would mint a golden that still
    // proves nothing about the two-pool mechanic and nothing would be red.
    //
    // The two discriminating instants are the SAME withdrawal of the SAME bank
    // slot, answered differently: refused while the general pool is full, then
    // allowed once materials-first packing parks the carried materials in the
    // materials pool. Everything below is the scenario's own arithmetic against
    // absolute literals, never a value read back out of bag_pools.ts.
    const scenario = SCENARIOS.find((s) => s.name === 'bank_materials_satchel');
    expect(scenario, 'no bank_materials_satchel scenario').toBeTruthy();
    const { trace, rec } = record(scenario!);
    const pid = rec.notes.pid as number;
    // biome-ignore lint/suspicious/noExplicitAny: the recorder exposes the raw Sim
    const meta = (rec.sim as any).players.get(pid);

    // The socket took, through the real equipBag path: without it there is no
    // materials pool at all and every assertion below degenerates.
    expect(meta.bags).toEqual(['foragers_haversack', null, null, null]);

    // biome-ignore lint/suspicious/noExplicitAny: sampled frames are plain JSON
    const at = (label: string): any => {
      const frame = trace.frames.find((f) => f.label === label);
      expect(frame, `missing the ${label} checkpoint frame`).toBeTruthy();
      return frame?.players?.[0];
    };
    // biome-ignore lint/suspicious/noExplicitAny: sampled inventory slots
    const rows = (sample: any): [string, number][] =>
      // biome-ignore lint/suspicious/noExplicitAny: sampled inventory slots
      (sample.inventory ?? []).map((s: any) => [s.itemId, s.count]);

    // The two setup instants checkpoint 1 stands on, pinned directly rather than
    // inferred from the refusal: the general pool really is packed to its 16-slot
    // budget before the material crosses back, and that withdrawal really did land
    // the whole 20-unit stack in satchel-only headroom (a partial move or a split
    // stack would still leave the bank empty and the refusal intact).
    expect(at('general-pool-full').inventory).toHaveLength(16);
    const withdrawn = at('material-withdrawn-into-satchel-headroom');
    expect(rows(withdrawn)).toContainEqual(['copper_ore', 20]);

    // Checkpoint 1, the flat-scalar discriminator. The general pool is full at
    // 16 non-material slots (5 loaves in one, 15 daggers in fifteen) and the
    // material withdrawal already landed in satchel headroom for a 17th slot.
    // 17 carried against a summed budget of 28 (16 base + 12 satchel) leaves 11
    // slots of FLAT headroom, so a flat scalar moves the dagger here. It must
    // still be in the bank.
    const refused = at('non-material-refused-with-flat-headroom');
    expect(refused.inventory).toHaveLength(17);
    expect(rows(refused).filter(([id]) => id === 'rusty_dagger')).toHaveLength(15);
    expect(refused.bank.inventory).toEqual([{ itemId: 'rusty_dagger', count: 1 }]);
    // Exactly one refusal in the whole run: the step-5 withdrawal. A second one
    // would mean an arm meant to succeed did not.
    const ev = rec.allEvents as Ev[];
    const full = ev.filter((e) => e.type === 'error' && e.text === 'Your bags are full.');
    expect(full).toHaveLength(1);

    // Checkpoint 2, the allocation-order discriminator. 3 non-material slots
    // and 13 material slots is 16 carried, exactly the general budget, so a
    // general-first packing leaves zero general headroom and refuses again.
    // Materials-first puts 12 material slots in the materials pool and spills
    // one, so the general pool holds 4 of 16 and the same withdrawal now moves.
    const overfilled = at('materials-pool-overfilled');
    expect(overfilled.inventory).toHaveLength(16);
    expect(rows(overfilled).filter(([id]) => id === 'copper_ore')).toHaveLength(13);
    expect(rows(overfilled).filter(([id]) => id !== 'copper_ore')).toEqual([
      ['baked_bread', 5],
      ['rusty_dagger', 1],
      ['rusty_dagger', 1],
    ]);
    // The bank emptied, so the retry moved the very slot the refusal left.
    expect(meta.bank.inventory).toEqual([]);
    // biome-ignore lint/suspicious/noExplicitAny: raw Sim inventory slots
    const carried = meta.inventory.map((s: any) => [s.itemId, s.count]);
    expect(carried).toHaveLength(17);
    expect(carried.filter(([id]: [string, number]) => id === 'rusty_dagger')).toHaveLength(3);
    expect(carried.filter(([id]: [string, number]) => id === 'copper_ore')).toEqual(
      Array.from({ length: 13 }, () => ['copper_ore', 20]),
    );

    // Draw-free end to end, and that is the whole trace, not just these
    // checkpoints: equipBag, both deposits, all three withdrawals, the discard
    // and the grants are pure slot arithmetic, the bank is the same, and the
    // two-tick world tail draws nothing either, so the trace draws NOTHING
    // anywhere. The loop's one tooth: a pool change that starts drawing rng
    // moves a checkpoint off zero and goes red.
    for (const label of [
      'satchel-socketed',
      'deposited-material-and-gear',
      'general-pool-full',
      'material-withdrawn-into-satchel-headroom',
      'non-material-refused-with-flat-headroom',
      'materials-pool-overfilled',
      'gear-withdrawn-after-materials-first-packing',
    ]) {
      const frame = trace.frames.find((f) => f.label === label);
      expect(frame?.rng.draws, `${label} drew rng`).toBe(0);
    }
    // The whole-trace totals once, so no draw can hide between the checkpoints
    // or in the tail: zero draws, and the digest still sitting at the untouched
    // FNV-1a offset basis with nothing folded into it.
    expect(trace.draws).toBe(0);
    expect(trace.drawDigest).toBe('811c9dc5');
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

  it('supported_elevation_line_of_sight: heals across the stall jump and denies airborne cover sight', () => {
    const rec = run('supported_elevation_line_of_sight');
    const events = rec.allEvents as Ev[];
    const healerId = rec.notes.healerId as number;
    const allyId = rec.notes.allyId as number;

    const starts = events.filter(
      (event) =>
        event.type === 'castStart' &&
        event.entityId === healerId &&
        event.ability === 'lesser_heal',
    );
    expect(starts).toHaveLength(2);
    const heals = events.filter(
      (event) =>
        event.type === 'heal2' &&
        event.sourceId === healerId &&
        event.targetId === allyId &&
        event.ability === 'Whispered Prayer',
    );
    expect(heals).toHaveLength(2);
    const lineOfSightErrors = events.filter(
      (event) => event.type === 'error' && event.text === 'Line of sight.',
    );
    expect(lineOfSightErrors).toHaveLength(1);
  });

  it('ignivar_raid_tuning: pins live Heroic rays, final Brands, and wipe cooldown recovery', () => {
    const rec = run('ignivar_raid_tuning');
    const notes = rec.notes as Record<string, unknown>;
    const events = rec.allEvents as Ev[];

    expect(notes.rayHpAfterHit).toBe(500);
    expect(notes.rayHpAfterAdjacentTick).toBe(500);
    expect(notes.brandedPlayerIds as number[]).toHaveLength(3);
    expect(notes.attemptParticipantIds as number[]).toHaveLength(4);
    expect(notes.longCooldownReset).toBe(true);
    expect(notes.encounterReset).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'damage' && event.ability === 'Revolving Inferno' && event.amount === 500,
      ),
    ).toBe(true);
  });

  it('varkhul_raid_tuning: excludes visitors, pins Heroic Forgestorm, and scopes wipe recovery', () => {
    const rec = run('varkhul_raid_tuning');
    const notes = rec.notes as Record<string, unknown>;

    expect(notes.prePullParticipantIds).toEqual([]);
    expect(notes.pullParticipantIds as number[]).toHaveLength(1);
    expect(notes.forgestormHpAfterImpact).toBe(200);
    expect(notes.forgestormDamageSeen).toBe(true);
    expect(notes.visitorCooldownRetained).toBe(true);
    expect(notes.raiderCooldownReset).toBe(true);
    expect(notes.encounterReset).toBe(true);
  });
});
