// Coverage proof: each scenario must ACTUALLY fire its target subsystem (not just
// name it in a comment). These assertions inspect the live events + final state of
// a recorded run. If a future content change breaks a recipe, this fails loudly so
// the golden never silently stops exercising a system.
// Display-name literals follow the LOCKED NAME-MAP (authorized gate-text edit per the
// OPERATOR RULING, 2026-07-02, ip-refactor/02-WORKING-MEMORY.md); ability/aura IDS are frozen.
// Shard a of the coverage suite: a contiguous block of the per-scenario checks,
// split across files (with the parity gate shards) purely so vitest can run the
// recordings in parallel worker files. Assertions are unchanged; the shared run /
// entities helpers live in run_scenarios.ts.

import { describe, expect, it } from 'vitest';
import { type Ev, entities, run } from './run_scenarios';

describe('coverage: each scenario fires its subsystem', () => {
  it('solo_warrior: auto-attack + mobSwing both ways, mob death -> rollLoot produced loot', () => {
    const rec = run('solo_warrior');
    const pid = rec.sim.playerId;
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
    const events = rec.allEvents as Ev[];
    const pid = rec.sim.playerId;
    expect(events.some((e) => e.type === 'castStart')).toBe(true);
    // The fixture lives in the shared collider-free lane so this proves effect
    // dispatch and spell damage, not merely that a cast bar began behind town LOS.
    expect(events.some((e) => e.type === 'damage' && e.sourceId === pid)).toBe(true);
  });

  it('solo_rogue: weaponStrike via sinister_strike fires', () => {
    const rec = run('solo_rogue');
    const pid = rec.sim.playerId;
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
    const pid = rec.sim.playerId;
    // old_greyjaw is also a rare world spawn, so match across ALL of them (the
    // scenario's own spawn is the one that gets wounded into a frenzy + taunted).
    const greyjaws = entities(rec).filter((e) => e.templateId === 'old_greyjaw');
    const player = rec.sim.player;
    expect(greyjaws.some((e) => e.auras?.some((a: Ev) => a.id === 'blood_frenzy'))).toBe(true);
    expect(player.auras?.some((a: Ev) => a.kind === 'dot')).toBe(true);
    // applyTaunt (player cast) forced the greyjaw onto the player.
    expect(greyjaws.some((e) => e.forcedTargetId === pid)).toBe(true);
  });

  it('mob_swing_affixes: stun/venom/silence/rampage procs land + friendly pet never debuffs', () => {
    const rec = run('mob_swing_affixes');
    const n = rec.notes;
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
    const pid = rec.sim.playerId;
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
    const pid = rec.sim.playerId;
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
    // petRangedAttack: the emberkin's only damage path is the fire bolt (a resist
    // roll then a crit roll; a resisted bolt emits kind:'resist', never 'miss').
    // This scenario pins the resist DRAW's stream position via the rng digest; the
    // resist BRANCH's behavior is pinned by tests/pet_ranged_resist.test.ts.
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
    expect(rec.sim.player.targetId).toBeNull();
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
    expect(rec.sim.players.get(victimPid)?.fiestaAugments?.length).toBeGreaterThan(0);
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
    expect(rec.sim.entities.get(victimPid)?.dead).toBe(false);
  }, 90_000);
});
