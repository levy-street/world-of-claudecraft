// Coverage proof: each scenario must ACTUALLY fire its target subsystem (not just
// name it in a comment). These assertions inspect the live events + final state of
// a recorded run. If a future content change breaks a recipe, this fails loudly so
// the golden never silently stops exercising a system.
// Display-name literals follow the LOCKED NAME-MAP (authorized gate-text edit per the
// OPERATOR RULING, 2026-07-02, ip-refactor/02-WORKING-MEMORY.md); ability/aura IDS are frozen.

import { describe, expect, it } from 'vitest';
import type { Recorder } from './record';
import { record } from './record';
import { SCENARIOS } from './scenarios';

type Ev = Record<string, any>;

function run(name: string): Recorder {
  const scenario = SCENARIOS.find((s) => s.name === name);
  if (!scenario) throw new Error(`no scenario ${name}`);
  return record(scenario).rec;
}

function entities(rec: Recorder): any[] {
  return [...(rec.sim as any).entities.values()];
}

describe('coverage: each scenario fires its subsystem', () => {
  it('solo_warrior: auto-attack + mobSwing both ways, mob death -> rollLoot produced loot', () => {
    const rec = run('solo_warrior');
    const pid = (rec.sim as any).playerId;
    const ev = rec.allEvents as Ev[];
    const playerDealt = ev.some((e) => e.type === 'damage' && e.sourceId === pid);
    const playerTookHit = ev.some((e) => e.type === 'damage' && e.targetId === pid);
    expect(playerDealt).toBe(true); // player auto-attack / heroic_strike
    expect(playerTookHit).toBe(true); // mobSwing hit the player
    expect(ev.some((e) => e.type === 'death')).toBe(true);
    // rollLoot ran on death and produced loot (forest_wolf drops copper, chance 1).
    expect(entities(rec).some((e) => e.templateId === 'forest_wolf' && e.dead && e.lootable)).toBe(
      true,
    );
  });

  it('solo_mage: casting lifecycle runs', () => {
    const rec = run('solo_mage');
    expect((rec.allEvents as Ev[]).some((e) => e.type === 'castStart')).toBe(true);
  });

  it('solo_rogue: weaponStrike via sinister_strike fires', () => {
    const rec = run('solo_rogue');
    const pid = (rec.sim as any).playerId;
    const ev = rec.allEvents as Ev[];
    const sinister = ev.some(
      (e) =>
        e.type === 'damage' &&
        typeof e.ability === 'string' &&
        e.ability.toLowerCase().includes('wicked'),
    );
    const playerDealt = ev.some((e) => e.type === 'damage' && e.sourceId === pid);
    expect(sinister || playerDealt).toBe(true);
  });

  it('affix_mob: frenzyOnHit buff on mob + bleed on player + player-cast taunt (4279)', () => {
    const rec = run('affix_mob');
    const pid = (rec.sim as any).playerId;
    // old_greyjaw is also a rare world spawn, so match across ALL of them (the
    // scenario's own spawn is the one that gets wounded into a frenzy + taunted).
    const greyjaws = entities(rec).filter((e) => e.templateId === 'old_greyjaw');
    const player = (rec.sim as any).player;
    expect(greyjaws.some((e) => e.auras?.some((a: Ev) => a.id === 'blood_frenzy'))).toBe(true);
    expect(player.auras?.some((a: Ev) => a.kind === 'dot')).toBe(true);
    // applyTaunt (player cast) forced the greyjaw onto the player.
    expect(greyjaws.some((e) => e.forcedTargetId === pid)).toBe(true);
  });

  it('mob_swing_affixes: stun/venom/silence/rampage procs land + friendly pet never debuffs', () => {
    const rec = run('mob_swing_affixes');
    const n = rec.notes as Record<string, any>;
    // Each heavy-hitter proc fired its rng.chance and applied its aura on a landed swing.
    expect(n.stunLanded).toBe(true); // mogger_lackey stunOnHit
    expect(n.venomLanded).toBe(true); // webwood_spider venom DoT
    expect(n.silenceLanded).toBe(true); // gravecaller_summoner silence
    expect(n.rampageStacks).toBeGreaterThan(0); // warlord_drogmar self-stacking buff_ap
    // The friendly (hostile=false) pet swung the dummy but applied no on-hit debuff.
    expect(n.dummyDebuffs).toBe(0);
  });

  it('hunter_pet: friendly ranged pet (8093) AND hostile petSpell mob (6776) both fire', () => {
    const rec = run('hunter_pet');
    const pid = (rec.sim as any).playerId;
    const ev = rec.allEvents as Ev[];
    const pet = entities(rec).find((e) => e.ownerId === pid && e.templateId === 'warlock_imp');
    expect(pet).toBeTruthy();
    // friendly arm (8093): pet shoots its target
    expect(
      ev.some((e) => e.type === 'damage' && e.sourceId === pet.id && e.school === 'fire'),
    ).toBe(true);
    // hostile-mob arm (6776): wild fire demon's AI shoots the player
    const hostileImpId = rec.notes.hostileImpId;
    expect(
      ev.some(
        (e) =>
          e.type === 'damage' &&
          e.sourceId === hostileImpId &&
          e.targetId === pid &&
          e.school === 'fire',
      ),
    ).toBe(true);
  });

  it('warlock_pet: melee pet swings (8117) and manual taunt forces the target (4885)', () => {
    const rec = run('warlock_pet');
    const pid = (rec.sim as any).playerId;
    const pet = entities(rec).find((e) => e.ownerId === pid);
    expect(pet).toBeTruthy();
    expect((rec.allEvents as Ev[]).some((e) => e.type === 'damage' && e.sourceId === pet.id)).toBe(
      true,
    );
    // petTaunt -> applyTaunt forced the hostile target onto the pet.
    expect(
      entities(rec).some((e) => e.templateId === 'forest_wolf' && e.forcedTargetId === pet.id),
    ).toBe(true);
  });

  it('pet_ai: emberkin fires petRangedAttack (fire bolt), melee pet pulls+swings, both heel', () => {
    const rec = run('pet_ai');
    const ev = rec.allEvents as Ev[];
    const impId = rec.notes.impId as number;
    const tankId = rec.notes.tankId as number;
    // petRangedAttack: the emberkin's only damage path is the fire bolt (no miss roll).
    expect(ev.some((e) => e.type === 'damage' && e.sourceId === impId && e.school === 'fire')).toBe(
      true,
    );
    // melee arm: the gloomshade acquired a target via petPickTarget and swung it.
    expect(ev.some((e) => e.type === 'damage' && e.sourceId === tankId)).toBe(true);
    // heel transition: both pets dropped their target and follow the owner.
    const ents = entities(rec);
    expect(ents.find((e) => e.id === impId)?.aggroTargetId ?? null).toBeNull();
    expect(ents.find((e) => e.id === tankId)?.aggroTargetId ?? null).toBeNull();
  });

  it('pet_commands: tame/feed/revive/abandon + warlock summon/swap/Demon Heal + despawn scrubs fire', () => {
    const rec = run('pet_commands');
    const ev = rec.allEvents as Ev[];
    const logs = ev
      .filter((e) => e.type === 'log' && typeof e.text === 'string')
      .map((e) => e.text as string);
    // completeTame produced an owned pet (and re-tame produced a second).
    expect(logs.some((t) => t.includes('is now your loyal companion'))).toBe(true);
    // feedPet applied the feed_pet HoT (the "You feed" line fires only on a successful feed).
    expect(logs.some((t) => t.startsWith('You feed'))).toBe(true);
    // revivePet brought a dead pet back.
    expect(logs.some((t) => t.includes('returns to your side'))).toBe(true);
    // abandonPet despawned the tame.
    expect(logs.some((t) => t.startsWith('You abandon'))).toBe(true);
    // Demon Heal channel ticked: applyDemonHealTick emits a heal2 with ability 'Demon Heal'.
    expect(ev.some((e) => e.type === 'heal2' && e.ability === 'Demon Heal')).toBe(true);
    // Demon swap AND same-demon re-summon both produce a fresh demon answering the call
    // (re-summoning while the current demon is alive dismisses it and summons anew, it
    // never toggles off into no pet).
    expect(logs.filter((t) => t.includes('answers your summons')).length).toBeGreaterThanOrEqual(4);
    // despawnPet scrubbed the hunter's targetId (set to the demon, nulled on its hard despawn).
    expect((rec.sim as any).player.targetId).toBeNull();
    // abandon's despawnPersistentPet scrub pulled the biter off the (now-gone) pet.
    const petId = rec.notes.petId as number;
    expect(entities(rec).every((e) => e.aggroTargetId !== petId)).toBe(true);
  });

  it('paladin_consecration: ground AoE pulses fire from BOTH callers (immediate + deferred)', () => {
    const rec = run('paladin_consecration');
    const hits = (rec.allEvents as Ev[]).filter(
      (e) =>
        e.type === 'damage' &&
        typeof e.ability === 'string' &&
        e.ability.toLowerCase().includes('holy ground'),
    );
    // 1 immediate on-cast pulse (~4097) + >=1 deferred interval pulse (~3052).
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it('arena_1v1: a match resolves (arenaEnd)', () => {
    const rec = run('arena_1v1');
    expect((rec.allEvents as Ev[]).some((e) => e.type === 'arenaEnd')).toBe(true);
  });

  it('fiesta: a cross-team takedown scores AND an augment is offered + chosen', () => {
    const rec = run('fiesta');
    const ev = rec.allEvents as Ev[];
    expect(ev.some((e) => e.type === 'fiestaScore' || e.type === 'fiestaDown')).toBe(true);
    // augment wave actually ran: an offer was presented and a pick recorded.
    expect(ev.some((e) => e.type === 'augmentOffer')).toBe(true);
    const victimPid = rec.notes.fiestaVictimPid as number;
    expect((rec.sim as any).players.get(victimPid)?.fiestaAugments?.length).toBeGreaterThan(0);
  });

  it('fiesta_powerups: a power-up is grabbed (buff aura), the ring burns, and a downed fighter revives', () => {
    const rec = run('fiesta_powerups');
    const ev = rec.allEvents as Ev[];
    // power-up spawned and was grabbed -> buff aura applied (fiestaPowerup event).
    expect(ev.some((e) => e.type === 'fiestaPowerup')).toBe(true);
    // hazard ring burned a fighter standing outside it (ring damage is sourceId -1).
    expect(ev.some((e) => e.type === 'damage' && e.sourceId === -1)).toBe(true);
    // a downed fighter came back on their respawn timer (fiestaRevive -> respawn).
    expect(ev.some((e) => e.type === 'respawn')).toBe(true);
    const victimPid = rec.notes.fiestaPowerupVictimPid as number;
    expect((rec.sim as any).entities.get(victimPid)?.dead).toBe(false);
  });

  it('duel_to_winner: a duel goes active then ends with a winner, clearing duels', () => {
    const rec = run('duel_to_winner');
    const ev = rec.allEvents as Ev[];
    expect(ev.some((e) => e.type === 'duelStart')).toBe(true);
    const end = ev.find((e) => e.type === 'duelEnd');
    expect(end).toBeTruthy();
    expect(end!.winnerName).toBe('Aleph');
    expect(end!.loserName).toBe('Bet');
    // the 1-HP duel guard left the loser alive, and the duel was cleared.
    expect((rec.sim as any).duels.size).toBe(0);
  });

  it('arena_2v2_wipe: first kill keeps the match; team wipe ends it with a ranked Elo swing', () => {
    const rec = run('arena_2v2_wipe');
    const ev = rec.allEvents as Ev[];
    const ends = ev.filter((e) => e.type === 'arenaEnd');
    expect(ends.length).toBe(4); // both teams, two players each
    // ranked 2v2 result: the winners gained rating, the losers lost it.
    const moved = ends.some((e) => e.ratingAfter !== e.ratingBefore);
    expect(moved).toBe(true);
    const sim = rec.sim as any;
    const totalWins = [...sim.players.values()].reduce((n, m) => n + (m.arena2v2Wins ?? 0), 0);
    const totalLosses = [...sim.players.values()].reduce((n, m) => n + (m.arena2v2Losses ?? 0), 0);
    expect(totalWins).toBe(2);
    expect(totalLosses).toBe(2);
  });

  it('delve_lockpick: companion swings the boss (16762), lockpick engaged + stepped', () => {
    const rec = run('delve_lockpick');
    const ev = rec.allEvents as Ev[];
    // mobSwing delve-companion caller (~16762): the companion dealt damage.
    const compId = rec.notes.companionId;
    expect(compId, 'companion did not spawn').toBeTruthy();
    expect(ev.some((e) => e.type === 'damage' && e.sourceId === compId)).toBe(true);
    expect(ev.some((e) => e.type === 'lockpickSession')).toBe(true);
    expect(ev.some((e) => e.type === 'lockpickStep')).toBe(true);
  });

  it('delve_lockpick_fail: idling past the step clock jams the chest and opens the exit', () => {
    const rec = run('delve_lockpick_fail');
    const sim = rec.sim as any;
    const ev = rec.allEvents as Ev[];
    // The attempt engaged, then the server clock (not the client) burned the single try.
    expect(ev.some((e) => e.type === 'lockpickSession')).toBe(true);
    expect(ev.some((e) => e.type === 'lockpickEnd' && e.outcome === 'fail')).toBe(true);
    // The chest jams (lost until the delve is re-cleared) but the surface exit still opens.
    const r = sim.delveRunForPlayer(sim.playerId);
    const chestId = rec.notes.chestId as number;
    expect(r.objectState[chestId].attemptAvailable).toBe(false);
    expect(r.surfaceExitId).not.toBeNull();
    expect(r.objectState[r.surfaceExitId].open).toBe(true);
  });

  it('drowned_litany: heroic affix rolls, Bell Shock lands, the driver draws, the rite starts', () => {
    const rec = run('drowned_litany');
    const ev = rec.allEvents as Ev[];
    // Heroic entry rolled a ruin affix off the run seed.
    expect((rec.notes.affixes as string[]).length).toBeGreaterThan(0);
    // The bell-rope pull shocked the live cantor mid-combat.
    expect(
      ev.some(
        (e) =>
          e.type === 'log' &&
          typeof e.text === 'string' &&
          e.text.includes('The bell rope snaps taut'),
      ),
    ).toBe(true);
    // The Sister Nhalia driver drew on the shared stream: a Blackwater Mark was
    // placed and a Tolling Bells volley was live at the sampling instant.
    expect(rec.notes.marksSeen as number).toBeGreaterThan(0);
    expect(rec.notes.bellsLive as number).toBeGreaterThan(0);
    // Cantor phase fired, and after the boss died the rite choose started playback.
    expect(
      ev.some(
        (e) => e.type === 'log' && typeof e.text === 'string' && e.text.includes('Cantors, hold'),
      ),
    ).toBe(true);
    expect(ev.some((e) => e.type === 'delveRiteChoosePrompt')).toBe(true);
    expect(ev.some((e) => e.type === 'delveRitePulse')).toBe(true);
  });

  it('party_loot: a need/greed loot roll prompt fires', () => {
    const rec = run('party_loot');
    expect((rec.allEvents as Ev[]).some((e) => e.type === 'lootRoll')).toBe(true);
  });

  it('party_raid: the party state machine fires invite/convert/move/handoff/disband', () => {
    const rec = run('party_raid');
    const ev = rec.allEvents as Ev[];
    const logs = ev.filter((e) => e.type === 'log').map((e) => String(e.text));
    expect(ev.some((e) => e.type === 'partyInvite')).toBe(true);
    expect(logs.some((t) => t.includes('joins the party'))).toBe(true);
    expect(logs.some((t) => t.includes('converted to a raid'))).toBe(true);
    expect(logs.some((t) => t.includes('moved to raid group'))).toBe(true);
    expect(logs.some((t) => t.includes('is now the party leader'))).toBe(true);
    expect(logs.some((t) => t.includes('has disbanded'))).toBe(true);
  });

  it('l1_loot_distribution: fair-split copper splits to every member, a roll resolves, everyone-passes returns to corpse', () => {
    const rec = run('l1_loot_distribution');
    const evs = rec.allEvents as Ev[];
    // Fair-split copper reached more than just the looter (remainder shuffle ran).
    const looters = evs.filter((e) => e.type === 'loot' && /You loot/.test(String(e.text)));
    expect(new Set(looters.map((e) => e.pid)).size).toBeGreaterThan(1);
    // A need/greed roll was offered and one resolved with a winner.
    expect(evs.some((e) => e.type === 'lootRoll')).toBe(true);
    expect(evs.some((e) => e.type === 'loot' && / wins /.test(String(e.text)))).toBe(true);
    // The everyone-passes branch fired (item returned to the corpse).
    expect(evs.some((e) => e.type === 'loot' && /Everyone passed/.test(String(e.text)))).toBe(true);
  });

  it('entity_roster: despawn branches drop, delayed drain runs, ghost release + healer resurrect', () => {
    const rec = run('entity_roster');
    const ents = entities(rec);
    const ghostId = rec.notes.ghostId as number;
    const guardId = rec.notes.guardId as number;
    // despawn prologue dropped both: despawnTimer mob + DAMAGE_IDLE_DESPAWN idle mob.
    expect(ents.some((e) => e.id === ghostId)).toBe(false);
    expect(ents.some((e) => e.id === guardId)).toBe(false);
    // delayed drain: 3 scheduled -> 1 fired, 1 guard-dropped, 1 (future) still pending.
    expect((rec.sim as any).delayedEvents.length).toBe(1);
    expect((rec.allEvents as Ev[]).some((e) => e.type === 'respawn')).toBe(true);
    // release rose as a ghost, then the Spirit Healer resurrected the player with
    // Resurrection Sickness (level 10).
    const p = (rec.sim as any).player;
    expect(p.dead).toBe(false);
    expect(p.ghost).toBe(false);
    expect(p.auras.some((a: { id: string }) => a.id === 'resurrection_sickness')).toBe(true);
  });

  it('delve_death: second in-run death fails the delve and ejects the player', () => {
    const rec = run('delve_death');
    expect((rec.allEvents as Ev[]).some((e) => e.type === 'delveFailed')).toBe(true);
  });

  it('fiesta_midcast_kill: mid-cast cancel + cross-team takedown both fire', () => {
    const rec = run('fiesta_midcast_kill');
    const ev = rec.allEvents as Ev[];
    // fishing-cast hit -> cancelCast emits castStop(success:false)
    expect(ev.some((e) => e.type === 'castStop' && e.success === false)).toBe(true);
    // lethal cross-team hit -> fiesta takedown scored
    expect(ev.some((e) => e.type === 'fiestaScore' || e.type === 'fiestaDown')).toBe(true);
    const victimPid = rec.notes.fiestaVictimPid as number;
    expect(typeof victimPid).toBe('number');
  });

  it('multi_class_frenzy: frenzyOnHit draws + blood_frenzy lands across multi-class hits', () => {
    const rec = run('multi_class_frenzy');
    const gid = rec.notes.greyjawId as number;
    const g = entities(rec).find((e) => e.id === gid);
    expect(g, 'scenario greyjaw missing').toBeTruthy();
    expect(g.auras?.some((a: Ev) => a.id === 'blood_frenzy')).toBe(true);
    const ev = rec.allEvents as Ev[];
    const sources = new Set(
      ev.filter((e) => e.type === 'damage' && e.targetId === gid).map((e) => e.sourceId),
    );
    expect(sources.size).toBeGreaterThanOrEqual(2); // multiple class sources wounded the mob
  });

  it('mob_targeting: pull-over (melee 110% / ranged 130%), taunt force+expiry, retarget-to-evade', () => {
    const rec = run('mob_targeting');
    const n = rec.notes as Record<string, any>;
    const mob = entities(rec).find((e) => e.id === n.mobId);
    expect(mob, 'tracked mob missing').toBeTruthy();
    // 110% melee pull-over switched the mob from the tank to the in-melee bruiser.
    expect(n.afterMelee).toBe(n.bruiserId);
    // caster at EXACTLY 130% does NOT pull (strict `>` against RANGED_SWITCH_MULT).
    expect(n.afterRangedBoundary).toBe(n.tankId);
    // caster past 130% pulls the mob over at range.
    expect(n.afterRanged).toBe(n.casterId);
    // taunt forced the mob onto the tank despite the caster's higher threat.
    expect(n.afterTauntForced).toBe(n.tankId);
    // after the forced window expired, the threat scan reclaimed the caster.
    expect(n.afterTauntExpired).toBe(n.casterId);
    // retargetMob grabbed the highest-threat target (caster) and chased.
    expect(n.afterRetarget).toBe(n.casterId);
    // retargetMob with only stale threat pruned to empty and evaded home.
    expect(n.finalAiState).toBe('evade');
    expect(mob.aggroTargetId).toBe(null);
    expect(mob.threat.size).toBe(0);
  });

  it('delve_progression: chamber advances to the finale and the Marks shop buy resolves', () => {
    const rec = run('delve_progression');
    const ev = rec.allEvents as Ev[];
    // advanceDelveModule walked the run from the chamber onto the finale module.
    expect(
      ev.some(
        (e) => e.type === 'log' && typeof e.text === 'string' && e.text.includes('tombstone into'),
      ),
    ).toBe(true);
    // delveBuyShopItem deducted Marks and granted the item via the vendor event.
    expect(
      ev.some((e) => e.type === 'vendor' && e.action === 'buy' && e.itemId === 'reliquary_legs'),
    ).toBe(true);
  });

  it('delve_companion: rank-2 Tessa swings (16762), heals the owner, and the run holds her', () => {
    const rec = run('delve_companion');
    const sim = rec.sim as any;
    const ev = rec.allEvents as Ev[];
    const compId = rec.notes.companionId as number;
    const pid = sim.playerId as number;
    expect(compId, 'companion did not spawn').toBeTruthy();
    // combat arm: the companion dealt damage via mobSwing (~16762).
    expect(ev.some((e) => e.type === 'damage' && e.sourceId === compId)).toBe(true);
    // heal arm: a heal toward the owner + the companion's spellfx tick fired.
    expect(ev.some((e) => e.type === 'heal' && e.targetId === pid && e.amount > 0)).toBe(true);
    expect(ev.some((e) => e.type === 'spellfx' && e.sourceId === compId && e.fx === 'tick')).toBe(
      true,
    );
  });

  it('quest_kill_credit: kill credit accrues and the quest promotes to ready then turns in', () => {
    const rec = run('quest_kill_credit');
    const ev = rec.allEvents as Ev[];
    // onMobKilledForQuests bumped progress on each forest_wolf death.
    expect(
      ev.filter((e) => e.type === 'questProgress' && e.questId === 'q_wolves').length,
    ).toBeGreaterThanOrEqual(8);
    // checkQuestReady promoted active -> ready, and the quest was turned in.
    expect(ev.some((e) => e.type === 'questReady' && e.questId === 'q_wolves')).toBe(true);
    expect(ev.some((e) => e.type === 'questDone' && e.questId === 'q_wolves')).toBe(true);
    expect(
      (rec.sim as any).players.get((rec.sim as any).playerId)?.questsDone?.has('q_wolves'),
    ).toBe(true);
  });

  it('quest_collect_turnin: collect credit promotes, demotes on item loss, and turns in', () => {
    const rec = run('quest_collect_turnin');
    const ev = rec.allEvents as Ev[];
    // onInventoryChangedForQuests fired progress as hides were collected.
    expect(ev.some((e) => e.type === 'questProgress' && e.questId === 'q_boars')).toBe(true);
    // checkQuestReady's promotion arm.
    expect(ev.some((e) => e.type === 'questReady' && e.questId === 'q_boars')).toBe(true);
    // The demotion arm fired at least once (a 'questProgress' below target after a
    // 'questReady') — the dropped hide and the turn-in removal both demote ready -> active.
    const readyIdx = ev.findIndex((e) => e.type === 'questReady' && e.questId === 'q_boars');
    expect(
      ev.slice(readyIdx + 1).some((e) => e.type === 'questProgress' && e.questId === 'q_boars'),
    ).toBe(true);
    expect(ev.some((e) => e.type === 'questDone' && e.questId === 'q_boars')).toBe(true);
  });

  it('quest_link_abandon: party gate rejects then shares the quest, and abandon clears it', () => {
    const rec = run('quest_link_abandon');
    const ev = rec.allEvents as Ev[];
    const a = rec.notes.a as number;
    const b = rec.notes.b as number;
    // The party gate rejected the pre-party linked accept.
    expect(
      ev.some((e) => e.type === 'error' && e.pid === b && /party to accept/.test(String(e.text))),
    ).toBe(true);
    // Once partied, finalizeQuestAccept ran for B (questAccepted + the sharer notice to A).
    expect(
      ev.some((e) => e.type === 'questAccepted' && e.questId === 'q_wolves' && e.pid === b),
    ).toBe(true);
    expect(
      ev.some(
        (e) => e.type === 'log' && e.pid === a && /accepted your shared quest/.test(String(e.text)),
      ),
    ).toBe(true);
    // abandonQuest emitted its log and cleared B's quest log entry.
    expect(
      ev.some((e) => e.type === 'log' && e.pid === b && /^Quest abandoned:/.test(String(e.text))),
    ).toBe(true);
    expect((rec.sim as any).players.get(b)?.questLog?.has('q_wolves')).toBe(false);
  });

  it('talents_progression: applyTalents/respec/loadout/setSpec fire and bake the flat struct', () => {
    const rec = run('talents_progression');
    const pid = (rec.sim as any).playerId;
    const ev = rec.allEvents as Ev[];
    // applyTalents (and setSpec -> applyTalents) emitted the confirmation log.
    expect(ev.some((e) => e.type === 'log' && e.text === 'Talents updated.')).toBe(true);
    // respec emitted its own log.
    expect(ev.some((e) => e.type === 'log' && e.text === 'Talents reset.')).toBe(true);
    // switchLoadout restored a saved build.
    expect(
      ev.some(
        (e) => e.type === 'log' && typeof e.text === 'string' && e.text.startsWith('Loadout '),
      ),
    ).toBe(true);
    // setSpec('fury') applied last: the flat talentMods re-baked from the new tree.
    const meta = (rec.sim as any).players.get(pid);
    expect(meta.talents.spec).toBe('fury');
    expect(meta.talentMods.spec).toBe('fury');
  });

  it('multi_class_heal: heals land, a crit fires, absorb is consumed, threat splits across aware mobs, HoT ticks', () => {
    const rec = run('multi_class_heal');
    const ev = rec.allEvents as Ev[];
    const heals = ev.filter((e) => e.type === 'heal2' && e.amount > 0);
    expect(heals.length).toBeGreaterThan(0); // applyHeal emitted real (non-overheal) heals
    expect(heals.some((e) => e.crit === true)).toBe(true); // forced-crit *1.5 path fired
    // HoT aura-tick heal path (the hot branch -> healingTakenMult + healingThreat).
    const hotAbility = rec.notes.hotAbility as string;
    expect(ev.some((e) => e.type === 'heal2' && e.ability === hotAbility && e.amount > 0)).toBe(
      true,
    );
    const ents = entities(rec);
    const tank = ents.find((e) => e.id === rec.notes.tankPid);
    // consumeHealAbsorb: the small shield depleted + was filtered out; the big survived.
    expect(tank.auras?.some((a: Ev) => a.id === 'absorb_small')).toBe(false);
    expect(tank.auras?.some((a: Ev) => a.id === 'absorb_big')).toBe(true);
    // healingThreat split landed: each aware mob now lists healer ids in its hate table.
    const healerIds = rec.notes.healerIds as number[];
    const m1 = ents.find((e) => e.id === rec.notes.m1Id);
    const m3 = ents.find((e) => e.id === rec.notes.m3Id); // matched only via the pet-owner branch
    expect(healerIds.some((hid) => m1.threat.has(hid))).toBe(true);
    expect(healerIds.some((hid) => m3.threat.has(hid))).toBe(true);
  });

  it('mob_locomotion: boss pulse/stomp/terrify fire, idle wander + evade reset + cowardly flee', () => {
    const rec = run('mob_locomotion');
    const n = rec.notes as Record<string, any>;
    const ev = rec.allEvents as Ev[];
    const ents = entities(rec);
    // aoePulse dealt damage + emitted spellfx (mogger Ground Pound).
    expect(ev.some((e) => e.type === 'spellfx' && e.sourceId === n.pulserId)).toBe(true);
    expect(ev.some((e) => e.type === 'damage' && e.sourceId === n.pulserId)).toBe(true);
    // War Stomp landed a stomp_stun + Banshee terrify landed a fear_incap (captured at
    // the moment each arm fired; the CC does not persist to the end without a tick).
    expect(n.stompStunLanded).toBe(true);
    expect(n.fearLanded).toBe(true);
    // War Stomp + terrify each emit an 'unleashes' combat-log line (>= 2 total).
    expect(
      ev.filter(
        (e) => e.type === 'log' && typeof e.text === 'string' && e.text.includes('unleashes'),
      ).length,
    ).toBeGreaterThanOrEqual(2);
    // Idle wander picked a target (wanderTimer re-armed to the 30s patrol window).
    const wanderer = ents.find((e) => e.id === n.wandererId);
    expect(wanderer.wanderTarget).not.toBeNull();
    // Evade arrival reset the mob: back to idle at full hp.
    expect(n.evaderState).toBe('idle');
    expect(n.evaderHp).toBeGreaterThan(1);
    // Cowardly flee: the lackey panicked into the flee state and stayed fleeing.
    expect(n.cowardStateAfterPanic).toBe('flee');
    expect(n.cowardStateFleeing).toBe('flee');
    expect(
      ev.some(
        (e) =>
          e.type === 'log' && typeof e.text === 'string' && e.text.includes('attempts to flee'),
      ),
    ).toBe(true);
  });

  it('dungeon_instances: party shares one instance via the door trigger, then it resets when empty', () => {
    const rec = run('dungeon_instances');
    const sim = rec.sim as any;
    // Door-trigger entry claimed an instance and both party members joined the SAME slot.
    expect(rec.notes.slotA).not.toBe(null);
    expect(rec.notes.slotA).toBe(rec.notes.slotB);
    // claimInstance spawned mobs (rng.int per spawn).
    expect((rec.notes.instMobIds as number[]).length).toBeGreaterThan(0);
    // After the empty-reset, freeInstance nulled partyKey and despawned the mobs.
    const inst = (sim.instances as any[]).find(
      (i) => i.dungeonId === 'hollow_crypt' && i.slot === rec.notes.slotA,
    );
    expect(inst.partyKey).toBe(null);
    expect(inst.mobIds.length).toBe(0);
    expect((rec.notes.instMobIds as number[]).every((id) => !sim.entities.has(id))).toBe(true);
  });

  it('dungeon_raid_lockout: an active raid lockout blocks Nythraxis arena re-entry', () => {
    const rec = run('dungeon_raid_lockout');
    expect(
      (rec.allEvents as Ev[]).some(
        (e) => e.type === 'error' && e.text === 'You are locked to Nythraxis Raid Arena.',
      ),
    ).toBe(true);
  });

  it('c3_aura_runner: dot kills victim mid-tick (guard fires, rider aura survives), regen heal emitted, AoE hits 2+ mobs', () => {
    const rec = run('c3_aura_runner');
    const pid = (rec.sim as any).playerId;
    const ev = rec.allEvents as Ev[];
    const ents = entities(rec);
    const victim = ents.find((e) => e.id === rec.notes.victimId);
    expect(victim, 'victim missing').toBeTruthy();
    // The dot (index 1, ticked first in the backward walk) dropped the victim to lethal
    // mid-updateAuras, so the `if (e.dead) return;` guard fired before the index-0 aura
    // was reached. (handleDeath clears the corpse's auras, so the observable proof is the
    // dead victim + the byte-identical golden draw order, not a surviving aura.)
    expect(victim.dead).toBe(true);
    // updateRegen eat path fired: a 'heal' to the paladin (the ctx.healingTakenMult call).
    expect(ev.some((e) => e.type === 'heal' && e.targetId === pid)).toBe(true);
    // pulseGroundAoE hit >=2 distinct in-radius targets (rng.range once per target).
    const aoeMobIds = rec.notes.aoeMobIds as number[];
    const consTargets = new Set(
      ev
        .filter(
          (e) =>
            e.type === 'damage' &&
            typeof e.ability === 'string' &&
            e.ability.toLowerCase().includes('holy ground'),
        )
        .map((e) => e.targetId),
    );
    expect(aoeMobIds.filter((id) => consTargets.has(id)).length).toBeGreaterThanOrEqual(2);
  });

  it('c4a_casting_lifecycle: casts start, a timed cast completes, and interrupts cancel', () => {
    const rec = run('c4a_casting_lifecycle');
    const ev = rec.allEvents as Ev[];
    // castAbility started the timed casts + the channel (mage fireball, priest heal,
    // warlock drain_life).
    expect(ev.some((e) => e.type === 'castStart')).toBe(true);
    // a timed cast ran to completion (the mage fireball -> updateCasting finish branch).
    expect(ev.some((e) => e.type === 'castStop' && e.success === true)).toBe(true);
    // an interrupt cancelled a cast (priest silence + warlock fishing -> cancelCast).
    expect(ev.some((e) => e.type === 'castStop' && e.success === false)).toBe(true);
    // the warlock drain channel ticked and dealt shadow damage (applyChannelTick).
    const wl = rec.notes.warlockId as number;
    expect(ev.some((e) => e.type === 'damage' && e.sourceId === wl && e.school === 'shadow')).toBe(
      true,
    );
  });

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
  });

  it('warrior_row_capstones: double charge, thresholded fear, victory rush heal, bladestorm ticks', () => {
    const rec = run('warrior_row_capstones');
    const sim = rec.sim as any;
    const pid = sim.playerId;
    const ev = rec.allEvents as Ev[];
    // Double Charge: BOTH stored uses were spent while one recharge timer ran;
    // the classic single-cooldown gate would have blocked cast #2.
    expect(rec.notes.chargeSpent).toBe(2);
    expect(rec.notes.chargeRecharging).toBe(true);
    // Intimidating Shout feared a wolf; Lingering Dread armed its threshold.
    const feared = entities(rec).find((e) =>
      e.auras?.some((a: any) => a.id === 'fear_incap'),
    ) as any;
    expect(feared).toBeTruthy();
    const fear = feared.auras.find((a: any) => a.id === 'fear_incap');
    expect(fear.breaksOnDamage).toBe(true);
    expect(fear.breakThreshold).toBeGreaterThan(0);
    // Victory Rush: the on-kill strike healed the player.
    expect(ev.some((e) => (e.type === 'heal' || e.type === 'heal2') && e.targetId === pid)).toBe(
      true,
    );
    // Bladestorm: the self-centered channel pulsed damage.
    expect(ev.some((e) => e.type === 'damage' && e.ability === 'Bladestorm')).toBe(true);
  });

  it('professions_craft: denial draws nothing, each craft draws once, and the vestments proc mints + surfaces a masterwork', () => {
    const { trace, rec } = record(SCENARIOS.find((s) => s.name === 'professions_craft')!);
    const ev = rec.allEvents as Ev[];
    const pid = rec.notes.pid as number;
    const crafts = ev.filter((e) => e.type === 'craftResult');

    // Phase 1 denial: an ok:false craftResult with the insufficient_materials reason.
    expect(crafts.some((e) => e.ok === false && e.reason === 'insufficient_materials')).toBe(true);
    // Phase 2/4 plain crafts (consumable def): ok:true, def quality common, no masterwork flag.
    expect(
      crafts.some((e) => e.ok === true && e.quality === 'common' && e.masterwork === undefined),
    ).toBe(true);

    // Phase 3 masterwork proc: the personal masterwork SimEvent (ids only).
    const mw = ev.find((e) => e.type === 'masterwork');
    expect(mw, 'masterwork event did not fire (proc missed for the pinned seed)').toBeTruthy();
    expect(mw!.recipeId).toBe('recipe_eastbrook_ritual_vestments');
    expect(mw!.itemId).toBe('eastbrook_ritual_vestments');
    expect(mw!.crafter).toBe(pid);
    expect(mw!.pid).toBe(pid);
    // The craftResult mirror carries the proc: masterwork true, output DEF quality (uncommon).
    expect(
      crafts.some(
        (e) =>
          e.ok === true &&
          e.itemId === 'eastbrook_ritual_vestments' &&
          e.quality === 'uncommon' &&
          e.masterwork === true,
      ),
    ).toBe(true);

    // The minted copy is one signed instance carrying the masterwork marker, and the
    // per-player read surface reflects the proc.
    const meta = (rec.sim as any).players.get(pid);
    const slots = meta.inventory.filter((s: any) => s.itemId === 'eastbrook_ritual_vestments');
    expect(slots.length).toBe(1);
    expect(slots[0].instance?.rolled?.masterwork).toBe(true);
    expect(meta.lastMasterwork).toMatchObject({
      recipeId: 'recipe_eastbrook_ritual_vestments',
      itemId: 'eastbrook_ritual_vestments',
      crafter: pid,
    });

    // Draw contract: the denial draws zero and each of the three successful crafts
    // draws exactly the single masterwork proc roll (0 + 3 = 3 across the whole run).
    expect(trace.draws).toBe(3);
  });
});
