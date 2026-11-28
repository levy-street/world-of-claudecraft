// The Smith's Heart raid journal (src/ui/boss_journal/raids/smith_heart.ts):
// complete, localized, and true to the live encounter tuning. The generic
// checks mirror tests/boss_journal_view.test.ts (every line resolves on both
// tiers, cast names, kicks, heroic marks, icons); the facts block pins the
// numbers against the encounters' own exported tuning, resolved per tier the
// way the aura tooltips resolve them (src/ui/heart_tier_damage.ts).

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { BREATH_DIFFICULTY, BREATH_GUARDIAN } from '../src/sim/encounters/smith_heart/breath_ids';
import {
  COUNCIL_DIFFICULTY,
  COUNCIL_GUARDIAN,
  COUNCIL_SEAM_SINGER,
  COUNCIL_TUNING,
} from '../src/sim/encounters/smith_heart/council_ids';
import { FINAL_BOSS, FINAL_DIFFICULTY } from '../src/sim/encounters/smith_heart/final_ids';
import {
  HARD_ENRAGE_SECONDS,
  type HeartEnrageBoss,
} from '../src/sim/encounters/smith_heart/hard_enrage_ids';
import {
  HEAT_DIFFICULTY,
  HEAT_GUARDIAN,
  HEAT_TUNING,
} from '../src/sim/encounters/smith_heart/heat_ids';
import {
  QUENCH_DIFFICULTY,
  QUENCH_GUARDIAN,
  QUENCH_TUNING,
} from '../src/sim/encounters/smith_heart/quench_ids';
import { HEART_TANK_BUSTERS } from '../src/sim/encounters/smith_heart/tank_buster_ids';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../src/sim/mob/healer_channel';
import { formattedJournalValues } from '../src/ui/boss_journal/journal_sections';
import {
  dungeonJournalBossView,
  dungeonJournalSource,
  type JournalBossView,
  type JournalDifficulty,
  type JournalMechanic,
} from '../src/ui/boss_journal/journal_view';
import { SMITH_HEART_JOURNAL } from '../src/ui/boss_journal/raids/smith_heart';
import { tierValue } from '../src/ui/heart_tier_damage';
import { hasTranslation, type TranslationKey, t } from '../src/ui/i18n';
import { hasExplicitAbilityIcon } from '../src/ui/icons';

const TIERS: readonly JournalDifficulty[] = ['normal', 'heroic'];
const PLACEHOLDER = /\{[a-zA-Z0-9_]+\}/;
const DASHES = /[\u2013\u2014]/;
const SOURCE = dungeonJournalSource(SMITH_HEART_JOURNAL, 'raid');

/** The bosses' hard-enrage keys, in route order. */
const ENRAGE_BOSS: Readonly<Record<string, HeartEnrageBoss>> = {
  [COUNCIL_GUARDIAN]: 'council',
  [BREATH_GUARDIAN]: 'breath',
  [QUENCH_GUARDIAN]: 'quench',
  [HEAT_GUARDIAN]: 'heat',
  [FINAL_BOSS]: 'final',
};

function rendered(
  key: TranslationKey,
  values?: Readonly<Record<string, number>>,
  percent?: readonly string[],
): string {
  return t(key, formattedJournalValues(values, percent));
}

function expectText(
  label: string,
  key: TranslationKey,
  values?: Readonly<Record<string, number>>,
  percent?: readonly string[],
): void {
  expect(hasTranslation(key, 'en'), `${label}: missing catalog key ${key}`).toBe(true);
  const text = rendered(key, values, percent);
  expect(text, `${label}: ${key} leaves a placeholder unfilled`).not.toMatch(PLACEHOLDER);
  expect(text, `${label}: ${key} carries an en or em dash`).not.toMatch(DASHES);
  expect(text.trim().length, `${label}: ${key} is empty`).toBeGreaterThan(0);
}

function view(mobId: string, tier: JournalDifficulty): JournalBossView {
  return SOURCE.view(mobId, tier);
}

function mechanic(mobId: string, tier: JournalDifficulty, id: string): JournalMechanic {
  const found = view(mobId, tier)
    .phases.flatMap((p) => p.mechanics)
    .find((m) => m.id === id);
  if (!found) throw new Error(`${mobId} ${tier}: no mechanic ${id}`);
  return found;
}

function maybeMechanic(
  mobId: string,
  tier: JournalDifficulty,
  id: string,
): JournalMechanic | undefined {
  return view(mobId, tier)
    .phases.flatMap((p) => p.mechanics)
    .find((m) => m.id === id);
}

describe("the Smith's Heart journal", () => {
  it('lists the five encounters in route order, the council with both members', () => {
    expect(SOURCE.id).toBe('smith_heart');
    expect(SOURCE.kind).toBe('raid');
    expect(SOURCE.bossKeys).toEqual([
      COUNCIL_GUARDIAN,
      BREATH_GUARDIAN,
      QUENCH_GUARDIAN,
      HEAT_GUARDIAN,
      FINAL_BOSS,
    ]);
    const council = view(COUNCIL_GUARDIAN, 'normal');
    expect(council.members).toEqual([COUNCIL_GUARDIAN, COUNCIL_SEAM_SINGER]);
    // Six bodies over five pages, every one a real template.
    const bodies = SMITH_HEART_JOURNAL.bosses.flatMap((b) => b.members ?? [b.mobId]);
    expect(bodies).toHaveLength(6);
    for (const id of bodies) expect(MOBS[id], id).toBeDefined();
    expect(
      SMITH_HEART_JOURNAL.bosses.filter((b) => b.rank === 'final').map((b) => b.mobId),
    ).toEqual([FINAL_BOSS]);
    for (const boss of SMITH_HEART_JOURNAL.bosses.slice(1)) expect(boss.members).toBeUndefined();
  });

  it('resolves every line on both tiers with no missing key, placeholder or dash', () => {
    for (const boss of SMITH_HEART_JOURNAL.bosses) {
      for (const tier of TIERS) {
        const v = dungeonJournalBossView(boss, tier);
        const label = `${boss.mobId} ${tier}`;
        expectText(label, v.overviewKey, v.overviewValues, v.overviewPercentValues);
        expect(v.phases.length).toBeGreaterThan(0);
        for (const phase of v.phases) {
          expectText(label, phase.nameKey);
          expectText(label, phase.summaryKey, phase.values, phase.percentValues);
          for (const m of phase.mechanics) {
            expectText(`${label} ${m.id}`, m.nameKey, m.values, m.percentValues);
            expectText(`${label} ${m.id}`, m.summaryKey, m.values, m.percentValues);
            expectText(`${label} ${m.id}`, m.responseKey, m.values, m.percentValues);
            expect(m.roles.length, `${m.id} roles`).toBeGreaterThan(0);
            expect(hasExplicitAbilityIcon(m.iconId), `${m.iconId} recipe`).toBe(true);
          }
        }
        expect(v.tips?.map((tip) => tip.role)).toEqual(['tank', 'healer', 'damage']);
        for (const tip of v.tips ?? []) expectText(label, tip.key, tip.values, tip.percentValues);
        for (const note of v.heroicNotes ?? []) {
          expectText(label, note.key, note.values, note.percentValues);
        }
        expect((v.heroicNotes ?? []).length > 0).toBe(tier === 'heroic');
      }
    }
  });

  it('names every cast-bar mechanic as its cast bar and flags kicks truthfully', () => {
    let casts = 0;
    let kicks = 0;
    for (const boss of SMITH_HEART_JOURNAL.bosses) {
      for (const phase of boss.phases) {
        for (const m of phase.mechanics) {
          const kickable = m.castId
            ? Object.hasOwn(SCRIPTED_INTERRUPTIBLE_CHANNELS, m.castId)
            : false;
          if (m.castId) {
            casts++;
            const castKey = `abilityUi.cast.${m.castId}` as TranslationKey;
            expect(hasTranslation(castKey, 'en'), castKey).toBe(true);
            expect(m.nameKey, `${m.id} must read its cast bar name`).toBe(castKey);
          }
          if (kickable) kicks++;
          expect(m.flags?.includes('interruptible') ?? false, `${m.id} interruptible`).toBe(
            kickable,
          );
        }
      }
    }
    // The Singer's three, the Gale Mender's Mending Gale, the Splinter's Rime Toll.
    expect(kicks).toBe(5);
    expect(casts).toBeGreaterThan(20);
  });

  it('hides heroic-only mechanics on Normal and marks every tier difference on Heroic', () => {
    for (const boss of SMITH_HEART_JOURNAL.bosses) {
      const normal = dungeonJournalBossView(boss, 'normal');
      const heroic = dungeonJournalBossView(boss, 'heroic');
      const normalIds = normal.phases.flatMap((p) => p.mechanics.map((m) => m.id));
      const heroicMechanics = heroic.phases.flatMap((p) => p.mechanics);
      for (const phase of boss.phases) {
        for (const m of phase.mechanics) {
          const shown = heroicMechanics.find((h) => h.id === m.id);
          expect(shown, `${m.id} on heroic`).toBeDefined();
          if (m.availability === 'heroic') {
            expect(normalIds).not.toContain(m.id);
            expect(shown?.marks).toEqual(['heroicOnly']);
          } else {
            expect(normalIds).toContain(m.id);
          }
        }
      }
      for (const m of normal.phases.flatMap((p) => p.mechanics)) expect(m.marks).toBeUndefined();
    }
  });

  it('puts Forge-Fury on every Heroic page at its own timer, and never on Normal', () => {
    for (const mobId of SOURCE.bossKeys) {
      const boss = ENRAGE_BOSS[mobId];
      expect(HARD_ENRAGE_SECONDS[boss].normal).toBeNull();
      expect(view(mobId, 'normal').phases.map((p) => p.id)).not.toContain('forge-fury');
      expect(maybeMechanic(mobId, 'normal', 'forge-fury')).toBeUndefined();
      const fury = mechanic(mobId, 'heroic', 'forge-fury');
      expect(fury.marks).toEqual(['heroicOnly']);
      expect(fury.flags).toContain('deadly');
      expect(fury.values?.minutes).toBe((HARD_ENRAGE_SECONDS[boss].heroic ?? 0) / 60);
    }
  });

  it('covers every tank buster and every soak of the raid', () => {
    const ids = SMITH_HEART_JOURNAL.bosses.flatMap((b) =>
      b.phases.flatMap((p) => p.mechanics.map((m) => m.id)),
    );
    const BUSTER_MECHANIC: Readonly<Record<string, string>> = {
      weight: 'hammers-weight',
      blow: 'bellows-blow',
      thunder: 'thunder-lash',
      tempering: 'tempering-strike',
      strike: 'elemental-strike',
      shear: 'shearing-blow',
      brand: 'wellspring-brand',
    };
    for (const b of HEART_TANK_BUSTERS) {
      expect(BUSTER_MECHANIC[b.key], `buster ${b.key} mapped`).toBeDefined();
      expect(ids).toContain(BUSTER_MECHANIC[b.key]);
    }
    // The three soaks wearing the shared soak marker.
    for (const id of ['falling-rock', 'thunders-cradle', 'weight-of-the-anvil']) {
      expect(ids).toContain(id);
    }
  });
});

describe("the Smith's Heart journal's numbers are the live tuning", () => {
  it("resolves Mountain's Wrath in the fight's two steps, lethal on Heroic", () => {
    for (const tier of TIERS) {
      const row = COUNCIL_DIFFICULTY[tier];
      const w = mechanic(COUNCIL_GUARDIAN, tier, 'mountains-wrath');
      const resolve = (v: number) => tierValue(tierValue(v, row.punishMult), row.wrathMult);
      expect(w.values?.min).toBe(resolve(COUNCIL_TUNING.wrathMin));
      expect(w.values?.max).toBe(resolve(COUNCIL_TUNING.wrathMax));
      expect(w.values?.limit).toBe(row.pillarLimit);
      expect(w.compare?.[tier]).toEqual({ min: w.values?.min, max: w.values?.max });
    }
    // The design's lethal Heroic Wrath (council_ids.ts wrathMult): the known 3,465.
    expect(mechanic(COUNCIL_GUARDIAN, 'heroic', 'mountains-wrath').values?.min).toBe(3465);
    expect(
      rendered(
        mechanic(COUNCIL_GUARDIAN, 'heroic', 'mountains-wrath').summaryKey,
        mechanic(COUNCIL_GUARDIAN, 'heroic', 'mountains-wrath').values,
      ),
    ).toContain('3,465');
  });

  it("states Grieving Fury's heal, damage and haste per tier", () => {
    for (const tier of TIERS) {
      const f = mechanic(COUNCIL_GUARDIAN, tier, 'grieving-fury');
      expect(f.values?.heal).toBe(COUNCIL_DIFFICULTY[tier].furyHealPct);
      expect(f.values?.haste).toBe(COUNCIL_DIFFICULTY[tier].furyHaste);
      expect(f.values?.arrive).toBe(COUNCIL_TUNING.furyArrive);
    }
    const heroicText = rendered(
      mechanic(COUNCIL_GUARDIAN, 'heroic', 'grieving-fury').summaryKey,
      mechanic(COUNCIL_GUARDIAN, 'heroic', 'grieving-fury').values,
      mechanic(COUNCIL_GUARDIAN, 'heroic', 'grieving-fury').percentValues,
    );
    expect(heroicText).toContain(`${Math.round(COUNCIL_DIFFICULTY.heroic.furyHealPct * 100)}%`);
    // Heroic's survivor takes the second jobs too (inheritSecond): its own text.
    expect(COUNCIL_DIFFICULTY.heroic.inheritSecond).toBe(true);
    expect(mechanic(COUNCIL_GUARDIAN, 'heroic', 'inherited').summaryKey).not.toBe(
      mechanic(COUNCIL_GUARDIAN, 'normal', 'inherited').summaryKey,
    );
  });

  it("resolves the Breath's Thunder's Cradle and Bellows Blow per tier", () => {
    for (const tier of TIERS) {
      const row = BREATH_DIFFICULTY[tier];
      const c = mechanic(BREATH_GUARDIAN, tier, 'thunders-cradle');
      expect(c.values?.total).toBe(tierValue(row.cradleTotal, row.punishMult));
      expect(c.values?.soakers).toBe(row.cradleSoakers);
      expect(c.values?.count).toBe(row.cradleCount);
      const b = mechanic(BREATH_GUARDIAN, tier, 'bellows-blow');
      expect(b.values?.swap).toBe(row.blowSwap);
      expect(b.values?.ruin).toBe(row.blowThrow.length - 1);
    }
    // Normal's blow never throws off the Cornice; Heroic's ruinous one does.
    expect(BREATH_DIFFICULTY.normal.blowSafe).toBe(true);
    expect(rendered(mechanic(BREATH_GUARDIAN, 'normal', 'bellows-blow').summaryKey)).toContain(
      'never throws the tank off',
    );
    expect(maybeMechanic(BREATH_GUARDIAN, 'normal', 'knotted-gale')).toBeUndefined();
    expect(mechanic(BREATH_GUARDIAN, 'heroic', 'knotted-gale').marks).toEqual(['heroicOnly']);
  });

  it('resolves the Quench shatter through its own factor', () => {
    for (const tier of TIERS) {
      const row = QUENCH_DIFFICULTY[tier];
      const f = mechanic(QUENCH_GUARDIAN, tier, 'encased-in-rime');
      expect(f.values?.max).toBe(
        tierValue(QUENCH_TUNING.shatterMax, row.damageMult * row.shatterMult),
      );
      expect(f.values?.radius).toBe(row.splashR);
      const temper = mechanic(QUENCH_GUARDIAN, tier, 'tempering-strike');
      expect(temper.values?.swap).toBe(row.temperSwap);
      expect(temper.values?.most).toBe(row.temperMax);
    }
  });

  it("carries the Heat's newest rules: Wellspring Brand, the held grip, Normal's Wellspawn", () => {
    for (const tier of TIERS) {
      const row = HEAT_DIFFICULTY[tier];
      const brand = mechanic(HEAT_GUARDIAN, tier, 'wellspring-brand');
      expect(brand.values?.every).toBe(row.brand.every);
      expect(brand.values?.lead).toBe(row.brand.lead);
      expect(brand.values?.min).toBe(tierValue(HEAT_TUNING.brandMin, row.damageMult));
      expect(brand.values?.max).toBe(tierValue(HEAT_TUNING.brandMax, row.damageMult));
      expect(mechanic(HEAT_GUARDIAN, tier, 'cinder-grip').values?.per).toBe(row.gripPerTick);
      expect(mechanic(HEAT_GUARDIAN, tier, 'wellspawn').values?.spawn).toBe(
        row.overflowAdds[0].spawn,
      );
    }
    // The grip holds while the guardian is sunk (heat_grip.ts holdGrip).
    expect(rendered(mechanic(HEAT_GUARDIAN, 'normal', 'cinder-grip').summaryKey)).toContain(
      'neither burn nor run down',
    );
    // Normal: two slower Wellspawn in the first overflow only.
    expect(HEAT_DIFFICULTY.normal.overflowAdds[1].spawn).toBe(0);
    expect(HEAT_DIFFICULTY.normal.spawnSpeedMult).toBeLessThan(1);
    const normalSpawn = mechanic(HEAT_GUARDIAN, 'normal', 'wellspawn');
    const text = rendered(normalSpawn.summaryKey, normalSpawn.values, normalSpawn.percentValues);
    expect(text).toContain('first overflow only');
    expect(text).toContain(`${HEAT_DIFFICULTY.normal.overflowAdds[0].spawn} Wellspawn`);
    expect(maybeMechanic(HEAT_GUARDIAN, 'normal', 'live-coal')).toBeUndefined();
    expect(maybeMechanic(HEAT_GUARDIAN, 'normal', 'wellkeepers')).toBeUndefined();
  });

  it("resolves the final boss's Weight of the Anvil at the punishment factor", () => {
    for (const tier of TIERS) {
      const row = FINAL_DIFFICULTY[tier];
      const a = mechanic(FINAL_BOSS, tier, 'weight-of-the-anvil');
      expect(a.values?.total).toBe(Math.round(row.anvilTotal * row.punishMult));
      expect(a.values?.every).toBe(row.anvilEvery);
      expect(a.values?.missMin).toBe(tierValue(row.anvilMissMin, row.punishMult));
    }
    expect(maybeMechanic(FINAL_BOSS, 'normal', 'vein-shock')).toBeUndefined();
    expect(mechanic(FINAL_BOSS, 'heroic', 'vein-shock').marks).toEqual(['heroicOnly']);
  });
});
