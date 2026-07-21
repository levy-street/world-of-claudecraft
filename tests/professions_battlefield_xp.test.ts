import { describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../src/sim/data';
import {
  BATTLEFIELD_XP_TRICKLE,
  battlefieldExperienceTrickle,
} from '../src/sim/professions/battlefield_xp';
import { emptyCraftSkills } from '../src/sim/professions/wheel';
import { Sim } from '../src/sim/sim';

function makeSim(seed = 42) {
  return new Sim({ seed, playerClass: 'warrior', autoEquip: false });
}

// #1149 Battlefield Experience: self-observation (the wielder is also the
// crafter) trickle, the "simplest, implement/test first" slice per the
// issue's own spec. No radius/party logic is exercised or expected here.
// Every case below sets observerActiveArchetype to 'alchemy' (the craft
// minor_healing_potion's recipe belongs to) unless it is specifically
// exercising the #1149/#1205 active-specialty gate itself.
describe('battlefieldExperienceTrickle (#1149, self-observation)', () => {
  it('grants the trickle to the signer craft when the observer is the signer and rarity is rare+', () => {
    // Pinned to a literal so a re-tune of the trickle amount cannot pass
    // silently (every other assertion in this file compares against the
    // imported constant, which alone would never redden on a value change).
    expect(BATTLEFIELD_XP_TRICKLE).toBe(0.25);
    const skills = emptyCraftSkills();
    const amount = battlefieldExperienceTrickle(skills, {
      itemId: 'minor_healing_potion', // recipe_minor_healing_potion -> alchemy
      instance: { signer: 'Aria', rolled: { quality: 'rare' } },
      observerName: 'Aria',
      observerActiveArchetype: 'alchemy',
    });
    expect(amount).toBe(BATTLEFIELD_XP_TRICKLE);
    expect(skills.alchemy).toBe(BATTLEFIELD_XP_TRICKLE);
  });

  it('epic and legendary also qualify (rare-or-better, not rare-exactly)', () => {
    for (const quality of ['epic', 'legendary'] as const) {
      const skills = emptyCraftSkills();
      const amount = battlefieldExperienceTrickle(skills, {
        itemId: 'minor_healing_potion',
        instance: { signer: 'Aria', rolled: { quality } },
        observerName: 'Aria',
        observerActiveArchetype: 'alchemy',
      });
      expect(amount).toBe(BATTLEFIELD_XP_TRICKLE);
      expect(skills.alchemy).toBe(BATTLEFIELD_XP_TRICKLE);
    }
  });

  it('grants zero for common and uncommon instances (the rare-tier gate), before any attribution work', () => {
    for (const quality of ['common', 'uncommon'] as const) {
      const skills = emptyCraftSkills();
      const amount = battlefieldExperienceTrickle(skills, {
        itemId: 'minor_healing_potion',
        instance: { signer: 'Aria', rolled: { quality } },
        observerName: 'Aria',
        observerActiveArchetype: 'alchemy',
      });
      expect(amount).toBe(0);
      expect(skills.alchemy).toBe(0);
    }
  });

  it('grants zero for an absent instance, or a signed one whose def-quality fallback reads common', () => {
    const skills = emptyCraftSkills();
    expect(
      battlefieldExperienceTrickle(skills, {
        itemId: 'minor_healing_potion',
        instance: undefined,
        observerName: 'Aria',
        observerActiveArchetype: 'alchemy',
      }),
    ).toBe(0);
    expect(
      battlefieldExperienceTrickle(skills, {
        // No rolled.quality at all (the Phase 2 crafted shape): the rarity
        // gate falls back to the item def's static quality, common here.
        itemId: 'minor_healing_potion',
        instance: { signer: 'Aria' },
        observerName: 'Aria',
        observerActiveArchetype: 'alchemy',
      }),
    ).toBe(0);
    expect(skills.alchemy).toBe(0);
  });

  it('grants zero when the observer is not the signer (no party/bystander logic in this PR)', () => {
    const skills = emptyCraftSkills();
    const amount = battlefieldExperienceTrickle(skills, {
      itemId: 'minor_healing_potion',
      instance: { signer: 'Someone Else', rolled: { quality: 'rare' } },
      observerName: 'Aria',
      observerActiveArchetype: 'alchemy',
    });
    expect(amount).toBe(0);
    expect(skills.alchemy).toBe(0);
  });

  it('grants zero when the item was not produced by any known recipe (no craft to attribute to)', () => {
    const skills = emptyCraftSkills();
    const amount = battlefieldExperienceTrickle(skills, {
      itemId: 'not_a_real_item',
      instance: { signer: 'Aria', rolled: { quality: 'rare' } },
      observerName: 'Aria',
      observerActiveArchetype: 'alchemy',
    });
    expect(amount).toBe(0);
  });

  it('only ever touches the one craft it credits, never any other craft on the ring', () => {
    const skills = emptyCraftSkills();
    battlefieldExperienceTrickle(skills, {
      itemId: 'minor_healing_potion',
      instance: { signer: 'Aria', rolled: { quality: 'rare' } },
      observerName: 'Aria',
      observerActiveArchetype: 'alchemy',
    });
    for (const [craftId, value] of Object.entries(skills)) {
      if (craftId === 'alchemy') expect(value).toBe(BATTLEFIELD_XP_TRICKLE);
      else expect(value).toBe(0);
    }
  });
});

// Phase 2 (Professions 2.0 masterwork model): deterministic crafts sign a
// rare-plus-DEF output WITHOUT writing rolled.quality, so the trickle's
// rarity gate falls back to the item def's static quality when the instance
// carries none, and a legacy instance's own rolled.quality wins whenever it
// is present, in BOTH directions. No shipped COMMON_RECIPES output has a
// rare-plus def today, so the rare-def arm temporarily re-points the potion's
// def quality (content-driven read, same mutate-and-restore idiom
// tests/professions_perks.test.ts uses on PERK_THRESHOLDS).
describe('battlefieldExperienceTrickle def-quality fallback (Phase 2)', () => {
  it('a new crafted rare-def instance (signer only, no rolled.quality) still triggers the trickle', () => {
    const def = ITEMS.minor_healing_potion;
    const originalQuality = def.quality;
    def.quality = 'rare';
    try {
      const skills = emptyCraftSkills();
      const amount = battlefieldExperienceTrickle(skills, {
        itemId: 'minor_healing_potion',
        // The exact Phase 2 crafted rare-def shape: signer, no rolled at all.
        instance: { signer: 'Aria' },
        observerName: 'Aria',
        observerActiveArchetype: 'alchemy',
      });
      expect(amount).toBe(BATTLEFIELD_XP_TRICKLE);
      expect(skills.alchemy).toBe(BATTLEFIELD_XP_TRICKLE);
    } finally {
      def.quality = originalQuality;
    }
  });

  it('a legacy instance rolled rare still triggers on a common-def item (rolled wins upward)', () => {
    // The def is common (pinned here so a content re-tune reddens this test
    // instead of silently flipping which arm it exercises): only the legacy
    // rolled.quality read can pass the gate.
    expect(ITEMS.minor_healing_potion.quality).toBe('common');
    const skills = emptyCraftSkills();
    const amount = battlefieldExperienceTrickle(skills, {
      itemId: 'minor_healing_potion',
      instance: { signer: 'Aria', rolled: { quality: 'rare' } },
      observerName: 'Aria',
      observerActiveArchetype: 'alchemy',
    });
    expect(amount).toBe(BATTLEFIELD_XP_TRICKLE);
    expect(skills.alchemy).toBe(BATTLEFIELD_XP_TRICKLE);
  });

  it('a legacy instance rolled common grants nothing on a rare-def item (rolled wins downward too)', () => {
    // Precedence pin: the instance's own legacy rolled.quality is the exact
    // read whenever present, even when the def fallback would be HIGHER. A
    // regression that switched to max(rolled, def) would pass every other
    // case in this file but fail here.
    const def = ITEMS.minor_healing_potion;
    const originalQuality = def.quality;
    def.quality = 'rare';
    try {
      const skills = emptyCraftSkills();
      const amount = battlefieldExperienceTrickle(skills, {
        itemId: 'minor_healing_potion',
        instance: { signer: 'Aria', rolled: { quality: 'common' } },
        observerName: 'Aria',
        observerActiveArchetype: 'alchemy',
      });
      expect(amount).toBe(0);
      expect(skills.alchemy).toBe(0);
    } finally {
      def.quality = originalQuality;
    }
  });

  it('end to end: a signer-only rare-def potion drunk by its signer trickles through useItem', () => {
    const def = ITEMS.minor_healing_potion;
    const originalQuality = def.quality;
    def.quality = 'rare';
    try {
      const sim = makeSim();
      const pid = sim.playerId;
      const meta = (sim as any).players.get(pid);
      meta.archetype.activeArchetype = 'alchemy';
      // The Phase 2 crafted grant shape (crafting.ts signs rare-plus-def
      // outputs with { signer } alone, never rolled.quality).
      sim.addItemInstance('minor_healing_potion', { signer: meta.name }, pid);
      const entity = (sim as any).entities.get(pid);
      entity.hp = 1;

      sim.useItem('minor_healing_potion', pid);

      expect(meta.craftSkills.alchemy).toBe(BATTLEFIELD_XP_TRICKLE);
    } finally {
      def.quality = originalQuality;
    }
  });
});

// #1149/#1205: the manifesto's "active specialty only" anti alt/breadth
// lever, a BINARY gate (unlike the three-tier common/rare/unlimited
// archetype.ts craftCeiling ordinary crafting composes): the trickle only
// ever fires when the recipe's craft IS the observer's currently-active
// archetype.
describe('battlefieldExperienceTrickle active-specialty gate (#1149/#1205)', () => {
  it('grants zero before any archetype has ever been chosen (observerActiveArchetype null)', () => {
    const skills = emptyCraftSkills();
    const amount = battlefieldExperienceTrickle(skills, {
      itemId: 'minor_healing_potion',
      instance: { signer: 'Aria', rolled: { quality: 'rare' } },
      observerName: 'Aria',
      observerActiveArchetype: null,
    });
    expect(amount).toBe(0);
    expect(skills.alchemy).toBe(0);
  });

  it('grants zero when the recipe craft is a DIFFERENT active archetype (an alt breadth build)', () => {
    const skills = emptyCraftSkills();
    const amount = battlefieldExperienceTrickle(skills, {
      itemId: 'minor_healing_potion', // -> alchemy
      instance: { signer: 'Aria', rolled: { quality: 'rare' } },
      observerName: 'Aria',
      observerActiveArchetype: 'weaponcrafting', // not alchemy
    });
    expect(amount).toBe(0);
    expect(skills.alchemy).toBe(0);
  });

  it('grants zero when the recipe craft is only the observer HOBBY, not their active archetype', () => {
    const skills = emptyCraftSkills();
    // The narrower binary gate never falls back to the three-tier hobby
    // ceiling: a hobby craft is not "the" specialty.
    const amount = battlefieldExperienceTrickle(skills, {
      itemId: 'minor_healing_potion', // -> alchemy
      instance: { signer: 'Aria', rolled: { quality: 'rare' } },
      observerName: 'Aria',
      observerActiveArchetype: 'enchanting', // alchemy's opposite on CRAFT_RING
    });
    expect(amount).toBe(0);
    expect(skills.alchemy).toBe(0);
  });

  // #1638 review: #1129's active archetype is an adjacent PAIR (the two
  // majors), so this gate must check both, not just the title-quest craft.
  it('grants the trickle when the recipe craft is the SECOND (paired) major, not just the title craft', () => {
    const skills = emptyCraftSkills();
    const amount = battlefieldExperienceTrickle(skills, {
      itemId: 'minor_healing_potion', // -> alchemy
      instance: { signer: 'Aria', rolled: { quality: 'rare' } },
      observerName: 'Aria',
      observerActiveArchetype: 'engineering', // title craft is the OTHER major
      observerPairedMajor: 'alchemy', // alchemy is the second major, adjacent to engineering
    });
    expect(amount).toBe(BATTLEFIELD_XP_TRICKLE);
    expect(skills.alchemy).toBe(BATTLEFIELD_XP_TRICKLE);
  });
});

// The issue's own guidance: assert the handler's only skill-mutating call is
// the shared add-skill primitive, never a drain/subtract primitive. This is a
// stronger guarantee than a magnitude-only assertion (which a future bug
// could still satisfy by draining then re-adding a larger amount).
describe('battlefieldExperienceTrickle additive-only guarantee (#1149)', () => {
  it('mutates skill only via the wheel gainCraftSkill primitive', async () => {
    const wheel = await import('../src/sim/professions/wheel');
    const gainSpy = vi.spyOn(wheel, 'gainCraftSkill');
    const skills = emptyCraftSkills();

    battlefieldExperienceTrickle(skills, {
      itemId: 'minor_healing_potion',
      instance: { signer: 'Aria', rolled: { quality: 'rare' } },
      observerName: 'Aria',
      observerActiveArchetype: 'alchemy',
    });

    expect(gainSpy).toHaveBeenCalledTimes(1);
    expect(gainSpy).toHaveBeenCalledWith(skills, 'alchemy', BATTLEFIELD_XP_TRICKLE);
    // Positive amount only: this call can never be a drain (gainCraftSkill
    // itself is additive-only, see wheel.ts, but this asserts the CALL this
    // module makes was never negative).
    expect(gainSpy.mock.calls[0][2]).toBeGreaterThan(0);
    gainSpy.mockRestore();
  });

  it('makes no mutating call at all when the rare-tier gate rejects the observation', async () => {
    const wheel = await import('../src/sim/professions/wheel');
    const gainSpy = vi.spyOn(wheel, 'gainCraftSkill');
    const skills = emptyCraftSkills();

    battlefieldExperienceTrickle(skills, {
      itemId: 'minor_healing_potion',
      instance: { signer: 'Aria', rolled: { quality: 'uncommon' } },
      observerName: 'Aria',
      observerActiveArchetype: 'alchemy',
    });

    expect(gainSpy).not.toHaveBeenCalled();
    gainSpy.mockRestore();
  });

  it('makes no mutating call at all when the active-specialty gate rejects the observation', async () => {
    const wheel = await import('../src/sim/professions/wheel');
    const gainSpy = vi.spyOn(wheel, 'gainCraftSkill');
    const skills = emptyCraftSkills();

    battlefieldExperienceTrickle(skills, {
      itemId: 'minor_healing_potion',
      instance: { signer: 'Aria', rolled: { quality: 'rare' } },
      observerName: 'Aria',
      observerActiveArchetype: null,
    });

    expect(gainSpy).not.toHaveBeenCalled();
    gainSpy.mockRestore();
  });
});

// End-to-end wiring through the real potion-drunk tracked event (items.ts
// useItem), the one hook this PR wires (self-observation only): a
// rare-or-better self-signed potion drunk by its own crafter, WHO HAS
// ALCHEMY AS THEIR ACTIVE ARCHETYPE, trickles into that craft's skill; a
// plain potion, a non-signer, or a signer without alchemy as their active
// archetype all change nothing.
describe('Battlefield Experience wired into potion-drunk (#1149)', () => {
  it('a self-signed rare potion drunk by its own signer, with alchemy as their active archetype, trickles alchemy skill', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    meta.archetype.activeArchetype = 'alchemy';
    sim.addItemInstance(
      'minor_healing_potion',
      { signer: meta.name, rolled: { quality: 'rare' } },
      pid,
    );
    const entity = (sim as any).entities.get(pid);
    entity.hp = 1; // ensure the potion has something to restore so useItem does not deny

    sim.useItem('minor_healing_potion', pid);

    expect(meta.craftSkills.alchemy).toBe(BATTLEFIELD_XP_TRICKLE);
  });

  it('a self-signed rare potion drunk by its own signer grants nothing without alchemy as the active archetype', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    expect(meta.archetype.activeArchetype).toBeNull(); // fresh character, no archetype chosen
    sim.addItemInstance(
      'minor_healing_potion',
      { signer: meta.name, rolled: { quality: 'rare' } },
      pid,
    );
    const entity = (sim as any).entities.get(pid);
    entity.hp = 1;

    sim.useItem('minor_healing_potion', pid);

    expect(meta.craftSkills.alchemy).toBe(0);
  });

  it('a plain (unsigned) potion drunk grants no Battlefield Experience trickle', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    meta.archetype.activeArchetype = 'alchemy';
    sim.addItem('minor_healing_potion', 1, pid);
    const entity = (sim as any).entities.get(pid);
    entity.hp = 1;

    sim.useItem('minor_healing_potion', pid);

    expect(meta.craftSkills.alchemy).toBe(0);
  });

  it('a rare potion signed by someone ELSE grants no trickle when drunk by a different player', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    meta.archetype.activeArchetype = 'alchemy';
    sim.addItemInstance(
      'minor_healing_potion',
      { signer: 'Someone Else', rolled: { quality: 'rare' } },
      pid,
    );
    const entity = (sim as any).entities.get(pid);
    entity.hp = 1;

    sim.useItem('minor_healing_potion', pid);

    expect(meta.craftSkills.alchemy).toBe(0);
  });

  // PR #1281 review (High): credit must follow the ACTUALLY-CONSUMED copy,
  // not just any self-signed instance sitting in the bag. addItemInstance
  // appends new slots to the end of `inventory`, while removeItem consumes
  // from the end backward; a signed instance added EARLY (so it sits at a
  // low index) must never be credited when a LATER plain stack (higher
  // index) is what actually gets drunk and removed.
  it('does not credit a stale signed instance when the copy actually drunk is a later, unsigned stack', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
    meta.archetype.activeArchetype = 'alchemy';
    // Signed rare copy added first (earlier slot).
    sim.addItemInstance(
      'minor_healing_potion',
      { signer: meta.name, rolled: { quality: 'rare' } },
      pid,
    );
    // Plain copies picked up afterward (later slot, own stack since instanced
    // slots never merge with fungible stacks).
    sim.addItem('minor_healing_potion', 2, pid);
    const entity = (sim as any).entities.get(pid);
    entity.hp = 1;

    sim.useItem('minor_healing_potion', pid);

    // The drunk copy was the plain one: no trickle, and the signed instance
    // must still be sitting untouched in the bag.
    expect(meta.craftSkills.alchemy).toBe(0);
    expect(sim.countItem('minor_healing_potion', pid)).toBe(2); // 1 signed + 1 plain left
    const remainingSigned = meta.inventory.find(
      (s: any) => s.itemId === 'minor_healing_potion' && s.instance?.signer === meta.name,
    );
    expect(remainingSigned).toBeDefined();
  });
});

// #1149's re-craft/re-sign requirement: "the original crafter benefits most
// on later improving that same item" falls out for free from signer-based
// attribution, since a re-craft simply re-signs the instance with the new
// crafter's name. No separate tracking table exists or is needed.
describe('re-signed instance credits the NEW signer (#1149)', () => {
  it('crediting follows signer: an instance re-signed by a different crafter credits them, not the original', () => {
    const skills = emptyCraftSkills();
    const firstAmount = battlefieldExperienceTrickle(skills, {
      itemId: 'minor_healing_potion',
      instance: { signer: 'Aria', rolled: { quality: 'rare' } },
      observerName: 'Aria',
      observerActiveArchetype: 'alchemy',
    });
    expect(firstAmount).toBe(BATTLEFIELD_XP_TRICKLE);

    // Simulate a later re-craft: the same physical instance is now signed by
    // a different player (Bram), who happens to also be the one using it.
    const otherSkills = emptyCraftSkills();
    const secondAmount = battlefieldExperienceTrickle(otherSkills, {
      itemId: 'minor_healing_potion',
      instance: { signer: 'Bram', rolled: { quality: 'rare' } },
      observerName: 'Bram',
      observerActiveArchetype: 'alchemy',
    });
    expect(secondAmount).toBe(BATTLEFIELD_XP_TRICKLE);

    // Aria's original craft skill (a separate player's counter) is untouched
    // by Bram's later re-sign and re-observation.
    expect(skills.alchemy).toBe(BATTLEFIELD_XP_TRICKLE);
    expect(otherSkills.alchemy).toBe(BATTLEFIELD_XP_TRICKLE);
  });
});
