import { describe, expect, it, vi } from 'vitest';
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
describe('battlefieldExperienceTrickle (#1149, self-observation)', () => {
  it('grants the trickle to the signer craft when the observer is the signer and rarity is rare+', () => {
    const skills = emptyCraftSkills();
    const amount = battlefieldExperienceTrickle(skills, {
      itemId: 'minor_healing_potion', // recipe_minor_healing_potion -> alchemy
      instance: { signer: 'Aria', rolled: { quality: 'rare' } },
      observerName: 'Aria',
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
      });
      expect(amount).toBe(0);
      expect(skills.alchemy).toBe(0);
    }
  });

  it('grants zero for an unrolled or absent instance (never signed)', () => {
    const skills = emptyCraftSkills();
    expect(
      battlefieldExperienceTrickle(skills, {
        itemId: 'minor_healing_potion',
        instance: undefined,
        observerName: 'Aria',
      }),
    ).toBe(0);
    expect(
      battlefieldExperienceTrickle(skills, {
        itemId: 'minor_healing_potion',
        instance: { signer: 'Aria' }, // no rolled quality at all
        observerName: 'Aria',
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
    });
    expect(amount).toBe(0);
  });

  it('only ever touches the one craft it credits, never any other craft on the ring', () => {
    const skills = emptyCraftSkills();
    battlefieldExperienceTrickle(skills, {
      itemId: 'minor_healing_potion',
      instance: { signer: 'Aria', rolled: { quality: 'rare' } },
      observerName: 'Aria',
    });
    for (const [craftId, value] of Object.entries(skills)) {
      if (craftId === 'alchemy') expect(value).toBe(BATTLEFIELD_XP_TRICKLE);
      else expect(value).toBe(0);
    }
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
    });

    expect(gainSpy).not.toHaveBeenCalled();
    gainSpy.mockRestore();
  });
});

// End-to-end wiring through the real potion-drunk tracked event (items.ts
// useItem), the one hook this PR wires (self-observation only): a
// rare-or-better self-signed potion drunk by its own crafter trickles into
// that craft's skill; a plain potion drunk by anyone changes nothing.
describe('Battlefield Experience wired into potion-drunk (#1149)', () => {
  it('a self-signed rare potion drunk by its own signer trickles alchemy skill', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
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

  it('a plain (unsigned) potion drunk grants no Battlefield Experience trickle', () => {
    const sim = makeSim();
    const pid = sim.playerId;
    const meta = (sim as any).players.get(pid);
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
    });
    expect(firstAmount).toBe(BATTLEFIELD_XP_TRICKLE);

    // Simulate a later re-craft: the same physical instance is now signed by
    // a different player (Bram), who happens to also be the one using it.
    const otherSkills = emptyCraftSkills();
    const secondAmount = battlefieldExperienceTrickle(otherSkills, {
      itemId: 'minor_healing_potion',
      instance: { signer: 'Bram', rolled: { quality: 'rare' } },
      observerName: 'Bram',
    });
    expect(secondAmount).toBe(BATTLEFIELD_XP_TRICKLE);

    // Aria's original craft skill (a separate player's counter) is untouched
    // by Bram's later re-sign and re-observation.
    expect(skills.alchemy).toBe(BATTLEFIELD_XP_TRICKLE);
    expect(otherSkills.alchemy).toBe(BATTLEFIELD_XP_TRICKLE);
  });
});
