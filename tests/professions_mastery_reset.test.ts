// THE ONE-TIME MASTERY SKILL RESET, with the keep ledger. A character
// loaded WITHOUT the CharacterState masteryResetApplied flag has craftSkills
// and gatheringProficiency zeroed exactly once at load-time normalize
// (professions/mastery_reset.ts), then the flag serializes as literal true
// forever. Everything else on the sheet is KEPT and pinned row by row below.
// The transient mail-phase notice books the authored mastery_reset_notice
// letter exactly once, and the parity sampler must see ZERO new PlayerMeta
// fields (the flag is CharacterState-only by design).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEEDS } from '../src/sim/content/deeds';
import { MASTERY_RESET_LETTER } from '../src/sim/content/letters';
import { CRAFT_RING, GATHERING_PROFESSION_IDS } from '../src/sim/content/professions';
import { markDeedsDirty } from '../src/sim/deeds';
import { applyMasteryReset, MASTERY_RESET_LETTER_ID } from '../src/sim/professions/mastery_reset';
import { proficiencyBandFor } from '../src/sim/professions/proficiency_bands';
import { isSpecialized, tierCapability } from '../src/sim/professions/wheel';
import { type CharacterState, Sim } from '../src/sim/sim';
import { samplePlayerMeta } from './parity/trace';

const makeSim = (seed = 42) => new Sim({ seed, playerClass: 'warrior', noPlayer: true });

function metaOf(sim: Sim, pid: number) {
  // biome-ignore lint/suspicious/noExplicitAny: test reaches into sim internals
  return (sim as any).players.get(pid);
}

function moveToMailbox(sim: Sim, pid: number): void {
  const box = sim.entities.get(sim.postOffice.mailboxIds[0]);
  const p = sim.entities.get(pid);
  if (!box || !p) throw new Error('missing mailbox or player');
  p.pos = { ...box.pos };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
}

// A rich pre-curve save frozen by hand: NO masteryResetApplied flag, nonzero
// skills in BOTH maps, and one of everything the keep ledger pins. Deep-copied
// per test so no load can mutate the shared fixture.
const RESET_SAVE = {
  level: 15,
  xp: 1234,
  copper: 98765,
  hp: 100,
  resource: 0,
  pos: { x: 0, z: 150 },
  facing: 0,
  equipment: {},
  inventory: [
    { itemId: 'roasted_boar', count: 2 },
    { itemId: 'thorium_mining_pick', count: 1 },
  ],
  bank: { inventory: [{ itemId: 'roasted_boar', count: 1 }], purchasedSlots: 0, bonusSlots: 0 },
  questLog: [{ questId: 'q_wolves', counts: [3], state: 'active' }],
  questsDone: ['q_greyjaw'],
  craftSkills: { armorcrafting: 80, enchanting: 10 },
  gatheringProficiency: { mining: 100, fishing: 30 },
  knownRecipes: ['recipe_tough_jerky'],
  recipesGrandfathered: true,
  archetype: {
    activeArchetype: 'armorcrafting',
    pairedMajor: 'weaponcrafting',
    hobbyCraft: 'tailoring',
    attunedPairs: ['weaponcrafting+armorcrafting'],
    switchCount: 2,
    amendsProgress: 0,
  },
  mailWelcomed: true,
  guildLetterSent: true,
  delveMarks: 3,
  // A REAL pre-curve character with these skills has also earned the
  // first-time deeds below (prog_first_harvest and exp_first_ore are
  // gathering-threshold triggers at amount 1, so omitting them would make
  // the re-crossing arm grant them spuriously).
  deeds: {
    prog_craft_specialist: '2026-01-01',
    prog_mining_100: '2026-01-02',
    prog_first_craft: '2026-01-01',
    prog_first_harvest: '2026-01-01',
    exp_first_ore: '2026-01-01',
  },
  renown: 20,
} as unknown as CharacterState;

function resetSave(): CharacterState {
  return JSON.parse(JSON.stringify(RESET_SAVE)) as CharacterState;
}

describe('applyMasteryReset (pure, in place)', () => {
  it('zeroes every CRAFT_RING craft id and every gathering profession id', () => {
    const craftSkills: Record<string, number> = {};
    for (const craft of CRAFT_RING) craftSkills[craft.id] = 33;
    const gathering: Record<string, number> = {};
    for (const id of GATHERING_PROFESSION_IDS) gathering[id] = 44;
    applyMasteryReset(craftSkills, gathering);
    for (const craft of CRAFT_RING) expect(craftSkills[craft.id], craft.id).toBe(0);
    for (const id of GATHERING_PROFESSION_IDS) expect(gathering[id], id).toBe(0);
  });

  it('pins MASTERY_RESET_LETTER_ID to the authored letter id', () => {
    expect(MASTERY_RESET_LETTER_ID).toBe('mastery_reset_notice');
    expect(MASTERY_RESET_LETTER.letterId).toBe(MASTERY_RESET_LETTER_ID);
  });

  it('the letter id is registered in the LETTER_IDS table of world_entity_i18n.ts', () => {
    // LETTER_IDS is a module-private const, so pin it by source scan (the
    // professions_trend.test.ts precedent for the guild trend letters).
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/ui/world_entity_i18n.ts'), 'utf8');
    const start = src.indexOf('const LETTER_IDS = [');
    expect(start, 'the LETTER_IDS declaration should exist').toBeGreaterThan(-1);
    const end = src.indexOf('] as const;', start);
    expect(src.slice(start, end)).toContain(`'${MASTERY_RESET_LETTER_ID}'`);
  });

  it('the letter is registered in the entity_i18n LETTERS_BY_ID runtime registry', () => {
    // The SECOND ui letter registry (the tEntity runtime source); also
    // module-private, so the same source-scan idiom pins the literal entry.
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/ui/entity_i18n.ts'), 'utf8');
    const start = src.indexOf('const LETTERS_BY_ID: Record<string, LetterDef> = {');
    expect(start, 'the LETTERS_BY_ID declaration should exist').toBeGreaterThan(-1);
    const end = src.indexOf('};', start);
    expect(src.slice(start, end)).toContain(
      '[MASTERY_RESET_LETTER.letterId]: MASTERY_RESET_LETTER',
    );
  });
});

describe('the reset fires at load-time normalize', () => {
  it('zeroes both maps on a pre-curve save', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Reset', { state: resetSave() });
    const meta = metaOf(sim, pid);
    for (const craft of CRAFT_RING) expect(meta.craftSkills[craft.id], craft.id).toBe(0);
    for (const id of GATHERING_PROFESSION_IDS) expect(meta.gatheringProficiency[id], id).toBe(0);
  });

  it('the skill-proof deed retro inferences read the RESET values (no join grant)', () => {
    // deeds.test.ts pins the flag-true arm (skills survive, inferences fire);
    // this is the pre-curve arm: the reset runs BEFORE the join retro sweep,
    // so a pre-curve save without the deeds gets no skill-proof grant.
    const s = resetSave();
    // biome-ignore lint/suspicious/noExplicitAny: fixture shaping
    delete (s as any).deeds;
    // biome-ignore lint/suspicious/noExplicitAny: fixture shaping
    delete (s as any).renown;
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'NoProof', { state: s });
    const meta = metaOf(sim, pid);
    for (const id of [
      'prog_first_craft',
      'prog_first_harvest',
      'exp_first_ore',
      'prog_craft_specialist',
      'prog_mining_100',
    ]) {
      expect(meta.deedsEarned.has(id), id).toBe(false);
    }
  });

  it('zeroes gathering carried only under the legacy professions key', () => {
    const s = resetSave();
    // biome-ignore lint/suspicious/noExplicitAny: legacy save shape under test
    delete (s as any).gatheringProficiency;
    // biome-ignore lint/suspicious/noExplicitAny: legacy save shape under test
    (s as any).professions = { mining: 60, herbalism: 10 };
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Legacy', { state: s });
    const meta = metaOf(sim, pid);
    for (const id of GATHERING_PROFESSION_IDS) expect(meta.gatheringProficiency[id], id).toBe(0);
    for (const craft of CRAFT_RING) expect(meta.craftSkills[craft.id], craft.id).toBe(0);
  });
});

describe('the keep ledger (one decisive pin per row)', () => {
  const sim = makeSim();
  const pid = sim.addPlayer('warrior', 'Keeper', { state: resetSave() });
  const meta = metaOf(sim, pid);

  it('inventory items KEPT', () => {
    expect(meta.inventory.find((s: { itemId: string }) => s.itemId === 'roasted_boar')?.count).toBe(
      2,
    );
  });
  it('tools (inventory instances) KEPT', () => {
    expect(
      meta.inventory.find((s: { itemId: string }) => s.itemId === 'thorium_mining_pick')?.count,
    ).toBe(1);
  });
  it('bank KEPT', () => {
    expect(meta.bank.inventory).toEqual([{ itemId: 'roasted_boar', count: 1 }]);
  });
  it('copper KEPT', () => {
    expect(meta.copper).toBe(98765);
  });
  it('knownRecipes KEPT', () => {
    expect(meta.knownRecipes.has('recipe_tough_jerky')).toBe(true);
  });
  it('recipesGrandfathered KEPT', () => {
    expect(meta.recipesGrandfathered).toBe(true);
  });
  it('attunedPairs and switch history KEPT', () => {
    expect(meta.archetype.attunedPairs).toEqual(['weaponcrafting+armorcrafting']);
    expect(meta.archetype.switchCount).toBe(2);
    expect(meta.archetype.activeArchetype).toBe('armorcrafting');
  });
  it('hobbyCraft KEPT', () => {
    expect(meta.archetype.hobbyCraft).toBe('tailoring');
  });
  it('deeds and renown KEPT', () => {
    expect(meta.deedsEarned.get('prog_craft_specialist')).toBe('2026-01-01');
    expect(meta.deedsEarned.get('prog_mining_100')).toBe('2026-01-02');
    expect(meta.renown).toBeGreaterThanOrEqual(20);
  });
  it('level and XP KEPT', () => {
    expect(sim.entities.get(pid)?.level).toBe(15);
    expect(meta.xp).toBe(1234);
  });
  it('quest state KEPT', () => {
    expect(meta.questLog.get('q_wolves')?.counts).toEqual([3]);
    expect(meta.questsDone.has('q_greyjaw')).toBe(true);
  });
  it('mail state KEPT (no second welcome letter)', () => {
    expect(meta.mailWelcomed).toBe(true);
    expect(meta.guildLetterSent).toBe(true);
    expect(sim.mailUnreadFor(pid)).toBe(0);
  });
  it('craftSkills RESET', () => {
    expect(meta.craftSkills.armorcrafting).toBe(0);
    expect(meta.craftSkills.enchanting).toBe(0);
  });
  it('gatheringProficiency RESET', () => {
    expect(meta.gatheringProficiency.mining).toBe(0);
    expect(meta.gatheringProficiency.fishing).toBe(0);
  });
  it('perk activation and tier capability DERIVED as fresh-character values', () => {
    // armorcrafting was 80 (specialized, tier 3 capable) before the reset:
    // both reads recompute from the zeroed map, never from stored state.
    expect(isSpecialized(meta.craftSkills, 'armorcrafting')).toBe(false);
    expect(tierCapability(meta.craftSkills, 'armorcrafting')).toBe(0);
    // mining was 100 (band 1) before the reset.
    expect(proficiencyBandFor(meta.gatheringProficiency.mining)).toBe(0);
  });
});

describe('one-shot: the flag serializes literal true and never re-fires', () => {
  it('round-trips true, and regained skills survive relog, restart, and a later deploy', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Once', { state: resetSave() });
    const blob = sim.serializeCharacter(pid);
    if (!blob) throw new Error('serializeCharacter returned null');
    expect(blob.masteryResetApplied).toBe(true);
    // The blob never carries the transient notice flag.
    expect('pendingMasteryResetNotice' in blob).toBe(false);
    // Regain skill post-reset, then reload THAT blob (relog / restart): no
    // second zeroing.
    blob.craftSkills = { ...blob.craftSkills, armorcrafting: 40 };
    blob.gatheringProficiency = { ...blob.gatheringProficiency, mining: 25 };
    // biome-ignore lint/suspicious/noExplicitAny: the legacy dual-write mirror
    (blob as any).professions = { ...(blob as any).professions, mining: 25 };
    const sim2 = makeSim(43);
    const pid2 = sim2.addPlayer('warrior', 'Once', { state: blob });
    const meta2 = metaOf(sim2, pid2);
    expect(meta2.craftSkills.armorcrafting).toBe(40);
    expect(meta2.gatheringProficiency.mining).toBe(25);
    expect(meta2.pendingMasteryResetNotice).toBe(false);
    // A second serialize + load (the NEXT deploy) still never re-zeroes.
    const blob2 = sim2.serializeCharacter(pid2);
    if (!blob2) throw new Error('serializeCharacter returned null');
    expect(blob2.masteryResetApplied).toBe(true);
    const sim3 = makeSim(44);
    const pid3 = sim3.addPlayer('warrior', 'Once', { state: blob2 });
    expect(metaOf(sim3, pid3).craftSkills.armorcrafting).toBe(40);
    expect(metaOf(sim3, pid3).gatheringProficiency.mining).toBe(25);
  });

  it('ROLLBACK CAVEAT pinned: a flag-stripping round trip re-fires the reset', () => {
    // Pre-reset serialize knows no masteryResetApplied key, so a rollback
    // window strips it and the re-upgrade re-fires the reset, zeroing the
    // skills regained during the window. This is the ACCEPTED destructive
    // arm of the mailWelcomed flag class (release-notes item); this pin
    // makes the acceptance conscious, per the rollback-pin
    // precedent.
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Rolled', { state: resetSave() });
    const blob = sim.serializeCharacter(pid);
    if (!blob) throw new Error('serializeCharacter returned null');
    blob.craftSkills = { ...blob.craftSkills, armorcrafting: 40 };
    // biome-ignore lint/performance/noDelete: modeling the pre-reset blob shape
    delete blob.masteryResetApplied;
    const sim2 = makeSim(43);
    const pid2 = sim2.addPlayer('warrior', 'Rolled', { state: blob });
    expect(metaOf(sim2, pid2).craftSkills.armorcrafting).toBe(0);
    expect(metaOf(sim2, pid2).pendingMasteryResetNotice).toBe(true);
  });
});

describe('the mail-phase notice letter', () => {
  it('arrives exactly once, on the first tick after the reset load', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Notice', { state: resetSave() });
    expect(sim.mailUnreadFor(pid)).toBe(0);
    sim.tick();
    expect(sim.mailUnreadFor(pid)).toBe(1);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(sim.mailUnreadFor(pid)).toBe(1);
    moveToMailbox(sim, pid);
    const info = sim.mailInfoFor(pid);
    const notices = info?.messages.filter((m) => m.letterId === MASTERY_RESET_LETTER_ID) ?? [];
    expect(notices).toHaveLength(1);
  });

  it('a reloaded flag-true character gets no letter at all', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Notice', { state: resetSave() });
    sim.tick();
    const blob = sim.serializeCharacter(pid);
    if (!blob) throw new Error('serializeCharacter returned null');
    const sim2 = makeSim(43);
    const pid2 = sim2.addPlayer('warrior', 'Notice', { state: blob });
    for (let i = 0; i < 40; i++) sim2.tick();
    expect(sim2.mailUnreadFor(pid2)).toBe(0);
  });

  it('a new character gets no reset and no notice (construction path)', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Fresh');
    const meta = metaOf(sim, pid);
    expect(meta.pendingMasteryResetNotice).toBe(false);
    for (let i = 0; i < 40; i++) sim.tick();
    moveToMailbox(sim, pid);
    const info = sim.mailInfoFor(pid);
    expect(info?.messages.some((m) => m.letterId === MASTERY_RESET_LETTER_ID)).toBe(false);
    // The welcome letter alone.
    expect(sim.mailUnreadFor(pid)).toBe(1);
  });
});

describe('re-crossing the 75/100 thresholds after the reset', () => {
  it('no duplicate deed grant, no renown change beyond the NEW mid-ladder rung, no second guild trend letter', () => {
    // No archetype (so the guild trend sweep is live for this character) but
    // guildLetterSent already true, both threshold deeds already earned.
    const s = resetSave();
    // biome-ignore lint/suspicious/noExplicitAny: fixture shaping
    delete (s as any).archetype;
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Recross', { state: s });
    const meta = metaOf(sim, pid);
    sim.tick(); // drains the one reset notice letter
    const renownBefore = meta.renown;
    const unreadBefore = sim.mailUnreadFor(pid);
    // Climb back over both thresholds the character had already crossed.
    sim.gainCraftSkill(pid, 'armorcrafting', 80);
    meta.gatheringProficiency.mining = 100;
    // biome-ignore lint/suspicious/noExplicitAny: test reaches the ctx seam
    markDeedsDirty((sim as any).ctx, pid);
    for (let i = 0; i < 45; i++) sim.tick(); // deed eval + the 1 Hz mail sweeps
    expect(meta.deedsEarned.get('prog_craft_specialist')).toBe('2026-01-01');
    expect(meta.deedsEarned.get('prog_mining_100')).toBe('2026-01-02');
    // The newer mid-ladder rung (prog_armorcrafting_50) did not exist when
    // this pre-curve save was frozen, so the re-climb legitimately earns it
    // FRESH here (renown 5): the reset zeroed the skills BEFORE the join retro
    // sweep, so no join-time grant fired either (the arm two tests up). The
    // already-earned deeds above are the no-duplicate half of the pin.
    expect(meta.deedsEarned.has('prog_armorcrafting_50')).toBe(true);
    expect(meta.renown).toBe(renownBefore + DEEDS.prog_armorcrafting_50.renown);
    expect(meta.guildLetterSent).toBe(true);
    expect(sim.mailUnreadFor(pid)).toBe(unreadBefore);
  });

  it('re-climbing to the raised mastery cap (125) after the reset double-grants NOTHING', () => {
    // A save that already earned the full armorcrafting deed ladder (the 50
    // rung, the Specialist, and the Grandmaster cap deed) loses the SKILLS to
    // the one-time reset but keeps the deeds; re-climbing to 125 must leave
    // every stamp and the renown total byte-identical (grantDeed idempotence
    // driven through the live evaluator, not asserted on the function).
    const s = resetSave();
    // biome-ignore lint/suspicious/noExplicitAny: fixture shaping
    delete (s as any).archetype;
    // biome-ignore lint/suspicious/noExplicitAny: fixture shaping
    (s as any).deeds.prog_armorcrafting_50 = '2026-01-03';
    // biome-ignore lint/suspicious/noExplicitAny: fixture shaping
    (s as any).deeds.prog_grandmaster_armorcrafting = '2026-01-04';
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'CapRecross', { state: s });
    const meta = metaOf(sim, pid);
    sim.tick(); // drains the one reset notice letter
    expect(meta.craftSkills.armorcrafting).toBe(0); // the reset really fired
    const renownBefore = meta.renown;
    sim.gainCraftSkill(pid, 'armorcrafting', 125);
    // biome-ignore lint/suspicious/noExplicitAny: test reaches the ctx seam
    markDeedsDirty((sim as any).ctx, pid);
    for (let i = 0; i < 45; i++) sim.tick();
    // Stamps unchanged: the fixture sentinels survive the whole re-climb.
    expect(meta.deedsEarned.get('prog_armorcrafting_50')).toBe('2026-01-03');
    expect(meta.deedsEarned.get('prog_craft_specialist')).toBe('2026-01-01');
    expect(meta.deedsEarned.get('prog_grandmaster_armorcrafting')).toBe('2026-01-04');
    expect(meta.renown).toBe(renownBefore);
  });

  it('positive control: a never-earned Grandmaster deed IS granted fresh on the 125 re-climb', () => {
    // Identical fixture minus the Grandmaster stamp: the same climb in the
    // same idiom grants it fresh with a new stamp and pays its renown, so the
    // unchanged pins above are demonstrably not vacuous.
    const s = resetSave();
    // biome-ignore lint/suspicious/noExplicitAny: fixture shaping
    delete (s as any).archetype;
    // biome-ignore lint/suspicious/noExplicitAny: fixture shaping
    (s as any).deeds.prog_armorcrafting_50 = '2026-01-03';
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'CapFresh', { state: s });
    const meta = metaOf(sim, pid);
    sim.tick();
    expect(meta.deedsEarned.has('prog_grandmaster_armorcrafting')).toBe(false);
    const renownBefore = meta.renown;
    sim.gainCraftSkill(pid, 'armorcrafting', 125);
    // biome-ignore lint/suspicious/noExplicitAny: test reaches the ctx seam
    markDeedsDirty((sim as any).ctx, pid);
    for (let i = 0; i < 45; i++) sim.tick();
    expect(meta.deedsEarned.has('prog_grandmaster_armorcrafting')).toBe(true);
    expect(meta.deedsEarned.get('prog_grandmaster_armorcrafting')).not.toBe('2026-01-04');
    expect(meta.renown).toBe(renownBefore + DEEDS.prog_grandmaster_armorcrafting.renown);
  });

  it('positive control: the deed eval DOES fire on the climb for a never-earned deed', () => {
    // Same climb as above, but prog_mining_100 was never earned by this
    // character: the re-cross must grant it fresh. This is the arm that
    // proves the no-duplicate pins above are not vacuous (the deed sweep
    // demonstrably ran against the climbed skills in this exact idiom).
    const s = resetSave();
    // biome-ignore lint/suspicious/noExplicitAny: fixture shaping
    delete (s as any).archetype;
    // biome-ignore lint/suspicious/noExplicitAny: fixture shaping
    delete (s as any).deeds.prog_mining_100;
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'FreshCross', { state: s });
    const meta = metaOf(sim, pid);
    sim.tick();
    expect(meta.deedsEarned.has('prog_mining_100')).toBe(false);
    const renownBefore = meta.renown;
    meta.gatheringProficiency.mining = 100;
    // biome-ignore lint/suspicious/noExplicitAny: test reaches the ctx seam
    markDeedsDirty((sim as any).ctx, pid);
    for (let i = 0; i < 45; i++) sim.tick();
    expect(meta.deedsEarned.has('prog_mining_100')).toBe(true);
    // A FRESH grant, not the fixture sentinel, and it pays renown.
    expect(meta.deedsEarned.get('prog_mining_100')).not.toBe('2026-01-02');
    expect(meta.renown).toBeGreaterThan(renownBefore);
  });
});

describe('parity: zero new sampled PlayerMeta fields', () => {
  it('samplePlayerMeta(fresh meta) contains neither reset key', () => {
    const sim = makeSim();
    const pid = sim.addPlayer('warrior', 'Sampled');
    const sample = samplePlayerMeta(metaOf(sim, pid)) as Record<string, unknown>;
    expect(Object.keys(sample)).not.toContain('pendingMasteryResetNotice');
    expect(Object.keys(sample)).not.toContain('masteryResetApplied');
  });
});
