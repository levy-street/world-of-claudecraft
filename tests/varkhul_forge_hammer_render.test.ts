import { describe, expect, it, vi } from 'vitest';
import { VISUALS } from '../src/render/characters/manifest';
import {
  dispatchVarkhulForgeHammerAttack,
  routeVarkhulForgeHammer,
  VARKHUL_ANVIL_SPARK_DELAY_SECONDS,
  VARKHUL_ANVIL_SPARK_HEIGHT,
  VARKHUL_FORGING_IMPACT_CLIP_SECONDS,
  VARKHUL_FORGING_STRIKE_TIMESCALE,
  varkhulAnvilSparkPlan,
  varkhulForgeHammerAttackPlan,
} from '../src/render/varkhul_forge_hammer';
import { VARKHUL_FORGE_HAMMER_ABILITY_ID } from '../src/sim/encounters/varkhul';
import { groundHeight } from '../src/sim/world';

describe('Varkhul forge hammer render plan', () => {
  it('starts the authored swing only for the positional hammer impact', () => {
    expect(
      varkhulForgeHammerAttackPlan({
        ability: VARKHUL_FORGE_HAMMER_ABILITY_ID,
        sourceId: 42,
        fx: 'burst',
      }),
    ).toEqual({ entityId: 42, abilityId: "Forgefather's Hammer" });
    expect(
      varkhulForgeHammerAttackPlan({ ability: 'Forge Meltdown', sourceId: 42, fx: 'burst' }),
    ).toBeNull();
    expect(
      varkhulForgeHammerAttackPlan({
        ability: VARKHUL_FORGE_HAMMER_ABILITY_ID,
        sourceId: undefined,
        fx: 'burst',
      }),
    ).toBeNull();

    const triggerAttack = vi.fn();
    expect(
      dispatchVarkhulForgeHammerAttack(
        { ability: VARKHUL_FORGE_HAMMER_ABILITY_ID, sourceId: 42, fx: 'burst' },
        triggerAttack,
      ),
    ).toBe(true);
    expect(triggerAttack).toHaveBeenCalledOnce();
    expect(triggerAttack).toHaveBeenCalledWith(42, "Forgefather's Hammer");
    expect(
      dispatchVarkhulForgeHammerAttack(
        { ability: 'Forge Meltdown', sourceId: 42, fx: 'burst' },
        triggerAttack,
      ),
    ).toBe(false);
    expect(triggerAttack).toHaveBeenCalledOnce();
  });

  it("routes the Anvil's Decree strike, gated on fx kind, and nothing else", () => {
    // decree strike: the forge 'nova'; its meteors share the ability id but
    // emit 'meteorImpact' and must NOT retrigger the swing
    expect(
      varkhulForgeHammerAttackPlan({ ability: "Anvil's Decree", sourceId: 7, fx: 'nova' }),
    ).toEqual({ entityId: 7, abilityId: "Anvil's Decree" });
    expect(
      varkhulForgeHammerAttackPlan({ ability: "Anvil's Decree", sourceId: 7, fx: 'meteorImpact' }),
    ).toBeNull();
    // the Sweep release is deliberately unrouted: its whole windup is a Slam
    // cast clip (castByAbility), so a release one-shot would double-swing
    expect(
      varkhulForgeHammerAttackPlan({ ability: "Forgefather's Sweep", sourceId: 7, fx: 'burst' }),
    ).toBeNull();
    // hammer impact under the wrong fx kind stays silent
    expect(
      varkhulForgeHammerAttackPlan({
        ability: VARKHUL_FORGE_HAMMER_ABILITY_ID,
        sourceId: 7,
        fx: 'nova',
      }),
    ).toBeNull();
  });

  it('schedules anvil sparks for the hammer CONTACT moment, not the event', () => {
    // The delay waits out the clip's raise-and-fall: the measured contact
    // frame divided by the played rate. Both strikes are hammer blows on the
    // anvil, so both spark; the decree's meteors (same ability id, different
    // fx) must not.
    expect(VARKHUL_ANVIL_SPARK_DELAY_SECONDS).toBeCloseTo(
      VARKHUL_FORGING_IMPACT_CLIP_SECONDS / VARKHUL_FORGING_STRIKE_TIMESCALE,
      8,
    );
    expect(VARKHUL_ANVIL_SPARK_DELAY_SECONDS).toBeGreaterThan(0.5);
    expect(VARKHUL_ANVIL_SPARK_DELAY_SECONDS).toBeLessThan(1.2);
    expect(
      varkhulAnvilSparkPlan({
        ability: VARKHUL_FORGE_HAMMER_ABILITY_ID,
        sourceId: 42,
        fx: 'burst',
        x: 10,
        z: -4,
      }),
    ).toEqual({ x: 10, z: -4, delaySeconds: VARKHUL_ANVIL_SPARK_DELAY_SECONDS });
    expect(
      varkhulAnvilSparkPlan({ ability: "Anvil's Decree", sourceId: 7, fx: 'nova', x: 1, z: 2 }),
    ).toEqual({ x: 1, z: 2, delaySeconds: VARKHUL_ANVIL_SPARK_DELAY_SECONDS });
    expect(
      varkhulAnvilSparkPlan({
        ability: "Anvil's Decree",
        sourceId: 7,
        fx: 'meteorImpact',
        x: 1,
        z: 2,
      }),
    ).toBeNull();
  });

  it('routes one renderer call into the swing plus a delayed spark burst at anvil-top height', () => {
    const triggerAttack = vi.fn();
    const burstLater = vi.fn();
    const seed = 4242;
    expect(
      routeVarkhulForgeHammer(
        { ability: VARKHUL_FORGE_HAMMER_ABILITY_ID, sourceId: 42, fx: 'burst', x: 10, z: -4 },
        { burstLater },
        seed,
        triggerAttack,
      ),
    ).toBe(true);
    expect(triggerAttack).toHaveBeenCalledWith(42, VARKHUL_FORGE_HAMMER_ABILITY_ID);
    // 'physical' school on purpose: the burst pool renders non-fire schools as
    // spark showers in the warm steel color, the read a hammer on metal wants
    expect(burstLater).toHaveBeenCalledWith(
      VARKHUL_ANVIL_SPARK_DELAY_SECONDS,
      10,
      groundHeight(10, -4, seed) + VARKHUL_ANVIL_SPARK_HEIGHT,
      -4,
      'physical',
      16,
      0.9,
    );
    // a non-strike event neither swings nor sparks
    expect(
      routeVarkhulForgeHammer(
        { ability: 'Forge Meltdown', sourceId: 42, fx: 'burst', x: 0, z: 0 },
        { burstLater },
        seed,
        triggerAttack,
      ),
    ).toBe(false);
    expect(burstLater).toHaveBeenCalledOnce();
    expect(triggerAttack).toHaveBeenCalledOnce();
  });

  it('keeps the manifest strike rows on the one shared Forging timescale', () => {
    // The spark delay divides by this rate, so the clip rows and the delay
    // must come from the same constant or the contact moment drifts.
    const clips = VISUALS.mob_varkhul_forgefather.clips;
    expect(clips.attackTimeScaleByAbility?.[VARKHUL_FORGE_HAMMER_ABILITY_ID]).toBe(
      VARKHUL_FORGING_STRIKE_TIMESCALE,
    );
    expect(clips.attackTimeScaleByAbility?.["Anvil's Decree"]).toBe(
      VARKHUL_FORGING_STRIKE_TIMESCALE,
    );
    expect(clips.castTimeScaleByAbility?.["Anvil's Decree"]).toBe(VARKHUL_FORGING_STRIKE_TIMESCALE);
  });
});
