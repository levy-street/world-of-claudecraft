// Coverage proof: each scenario must ACTUALLY fire its target subsystem (not just
// name it in a comment). These assertions inspect the live events + final state of
// a recorded run. If a future content change breaks a recipe, this fails loudly so
// the golden never silently stops exercising a system.
// Display-name literals follow the LOCKED NAME-MAP (authorized gate-text edit per the
// OPERATOR RULING, 2026-07-02, ip-refactor/02-WORKING-MEMORY.md); ability/aura IDS are frozen.
// Shard b of the coverage suite: a contiguous block of the per-scenario checks,
// split across files (with the parity gate shards) purely so vitest can run the
// recordings in parallel worker files. Assertions are unchanged; the shared run /
// entities helpers live in run_scenarios.ts.

import { describe, expect, it } from 'vitest';
// record + SCENARIOS are for the master_loot check, which records directly rather
// than through run(): the per-frame DRAW COUNT is what that scenario pins.
import { record } from './record';
import { type Ev, entities, run } from './run_scenarios';
import { SCENARIOS } from './scenarios';

describe('coverage: each scenario fires its subsystem', () => {
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

  it('master_loot: looter-only prompt, both direct-grant arms, subset conversion, and the tie-break draw', () => {
    const scenario = SCENARIOS.find((s) => s.name === 'master_loot');
    if (!scenario) throw new Error('no scenario master_loot');
    // Recorded directly (not via run()) because the per-frame draw COUNT, not just
    // the event stream, is what this scenario exists to pin.
    const { trace, rec } = record(scenario);
    const sim = rec.sim as any;
    const evs = rec.allEvents as Ev[];
    const { a, b, c, d } = rec.notes.pids as Record<string, number>;
    const rollIds = rec.notes.rollIds as number[];
    const text = (e: Ev) => String(e.text);

    // The leader-only switch fired both of its message arms, each to the whole
    // party: enabling master loot, then moving the threshold down onto the drop.
    const byPid = (pids: number[]) => [...pids].sort((x, y) => x - y);
    const logsSaying = (re: RegExp) =>
      byPid(evs.filter((e) => e.type === 'log' && re.test(text(e))).map((e) => e.pid as number));
    expect(logsSaying(/^Loot method set to Master Loot\. Master Looter: Aaa\.$/)).toEqual(
      byPid([a, b, c, d]),
    );
    expect(logsSaying(/^Loot threshold set to uncommon\.$/)).toEqual(byPid([a, b, c, d]));

    // Three threshold-meeting drops each opened a curate-phase master roll, and
    // the prompt went to the master looter ALONE (never to a candidate).
    const prompts = evs.filter((e) => e.type === 'masterLoot');
    expect(rollIds.length).toBe(3);
    expect(prompts.length).toBe(3);
    expect([...new Set(prompts.map((e) => e.pid))]).toEqual([a]);
    // Every prompt's roster, not just the first: a candidate set that went wrong on
    // only the second or third drop would hide behind a first-member-only check.
    for (const prompt of prompts) {
      expect(prompt.candidates.map((cand: { pid: number }) => cand.pid)).toEqual([a, b, c, d]);
    }

    // Arms 1 + 2: two direct grants, announced PER GRANTEE to all four members
    // exactly once. Naming the grantee is what makes this decisive: a plain count
    // of 8 assign lines survives both a redistribution of the two grants and a
    // duplicate pid printed twice to half the party.
    const assignedTo = (name: string) =>
      byPid(
        evs
          .filter(
            (e) =>
              e.type === 'loot' && text(e) === `Aaa assigned [[i:greyjaw_hide_boots]] to ${name}.`,
          )
          .map((e) => e.pid as number),
      );
    expect(assignedTo('Bbb')).toEqual(byPid([a, b, c, d]));
    expect(assignedTo('Ccc')).toEqual(byPid([a, b, c, d]));
    expect(evs.filter((e) => e.type === 'loot' && / assigned /.test(text(e))).length).toBe(8);
    // Where the three copies ended up, per player rather than in aggregate: a sum
    // plus a max is satisfied by a materially wrong distribution (both grants to c
    // with b winning the contest reads identically), so pin each holder.
    const held = (pid: number) => sim.countItem('greyjaw_hide_boots', pid) as number;
    expect(held(a)).toBe(0); // the master looter assigned all three away
    expect(held(b)).toBe(2); // direct grant + the contest win below
    expect(held(c)).toBe(1); // direct grant only
    expect(held(d)).toBe(0); // rolled below the tie, so won nothing
    // The deduped assignment never reopened as a roll.
    expect(evs.some((e) => e.type === 'lootRoll' && e.rollId === rollIds[1])).toBe(false);

    // Arm 3: the conversion prompted exactly the assigned SUBSET, not every
    // candidate (the master looter a was not among the targets).
    const converted = evs.filter((e) => e.type === 'lootRoll' && e.rollId === rollIds[2]);
    expect(converted.map((e) => e.pid).sort((x, y) => x - y)).toEqual([b, c, d]);

    // The three need rolls TIED at the top, which is the only thing that makes
    // resolveLootRoll draw its tie-break int. Pinned to the literal numbers the
    // scenario comment documents, so that when a future stream change dissolves
    // the tie the failure names the seed's actual rolls instead of just reporting
    // that some count moved.
    const needRolls = evs
      .filter((e) => e.type === 'loot' && e.pid === a && /^Need Roll - /.test(text(e)))
      .map((e) => Number(/^Need Roll - (\d+)/.exec(text(e))?.[1]));
    // Re-seeded 1091 -> 1326 by the v0.32.0 base merge: the tie SHAPE is preserved
    // (the same two rollers level at the same 97), only the third roll and the
    // tie-break's winner moved, because this branch's content shifts the shared rng
    // and not master-loot logic itself.
    expect(needRolls).toEqual([97, 97, 85]); // b and c tie at the top, d below
    // The tie-break picked b, and that outcome is the one observable effect of the
    // master-loot-only draw, so it is pinned by name and by winning roll. WHICH of
    // the tied rollers wins is the rng's call and may move with the seed; that a
    // named one of them wins exactly once per party member is the claim.
    expect(
      evs.filter(
        (e) =>
          e.type === 'loot' && text(e) === `Bbb wins [[i:greyjaw_hide_boots]] (${needRolls[1]})`,
      ).length,
    ).toBe(4); // announced once to each party member

    // The golden's draw-order log across an assignment and a resolution: opening
    // the rolls and all three assignments draw NOTHING, and the resolution draws
    // exactly four (one int(1,100) per need submit + the tie-break int).
    const frame = (label: string) => {
      const f = trace.frames.find((fr) => fr.label === label);
      if (!f) throw new Error(`no frame ${label}`);
      return f;
    };
    // Absolute, not just relative: setup draws nothing at all and the whole
    // scenario spends exactly the four master-loot draws, which is the property
    // that makes this scenario a near-pure instrument for the slice. A delta-only
    // check would not notice setup or the trailing ticks starting to draw.
    expect(frame('master-rolls-open').rng.draws).toBe(0);
    expect(trace.draws).toBe(4);
    expect(frame('assigned-converted').rng.draws - frame('master-rolls-open').rng.draws).toBe(0);
    expect(frame('roll-resolved').rng.draws - frame('assigned-converted').rng.draws).toBe(4);
    // The two refused curate-phase votes bailed before any draw...
    expect(frame('curate-phase-vote-refused').rng.draws).toBe(0);
    // ...and, the half the draw log cannot see, neither was RECORDED. A guard that
    // admitted a vote but drew nothing (a 'pass', or a 'need' whose draw moved)
    // leaves draws, digests and every sampled field identical, because
    // convertMasterRollToNeedGreed wipes `choices` moments later and
    // pendingLootRolls is never sampled. This is the only assertion that sees it.
    expect(rec.notes.refusedChoiceCount).toBe(0);
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
    // 'questReady'): the dropped hide and the turn-in removal both demote ready -> active.
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
    // The terrify tank exemption: the boss's current aggro target never fears.
    expect(n.tankFearLanded).toBe(false);
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
});
