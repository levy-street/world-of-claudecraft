// The journal's hit index (src/ui/hud/journal/journal_hit_icons.ts): every damage
// label a journal mechanic names is real sim text, every dealer is a real mob,
// no dealer maps one label to two icons, and the encounters' own damage calls
// are covered: every Smith's Heart name-table label the fights deal resolves,
// and every literal label a dungeon boss deals resolves, unless it is listed
// below with the reason no journal row owns it.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SMITH_HEART_MOBS } from '../src/sim/content/smith_heart';
import { MOBS } from '../src/sim/data';
import { MORTHEN_SOUL_TEMPLATE } from '../src/sim/encounters/hollow_crypt/morthen_ids';
import { BREATH_GUARDIAN, BREATH_NAMES } from '../src/sim/encounters/smith_heart/breath_ids';
import { ISLE_NAMES } from '../src/sim/encounters/smith_heart/breath_isle_ids';
import { COUNCIL_GUARDIAN, COUNCIL_NAMES } from '../src/sim/encounters/smith_heart/council_ids';
import { ELEMENT_NAMES } from '../src/sim/encounters/smith_heart/final_elements_ids';
import { FINAL_BOSS, FINAL_NAMES } from '../src/sim/encounters/smith_heart/final_ids';
import {
  FINAL_ADD_MOBS,
  FINAL_PHASE_NAMES,
} from '../src/sim/encounters/smith_heart/final_phase_ids';
import { HARD_ENRAGE_NAMES } from '../src/sim/encounters/smith_heart/hard_enrage_ids';
import { HEAT_GUARDIAN, HEAT_NAMES } from '../src/sim/encounters/smith_heart/heat_ids';
import { QUENCH_GUARDIAN, QUENCH_NAMES } from '../src/sim/encounters/smith_heart/quench_ids';
import { JOURNAL_INSTANCES } from '../src/ui/hud/journal/journal_catalog';
import {
  buildJournalHitIndex,
  type JournalHitIndex,
  journalHitIconId,
  journalHitIconIn,
  journalHitIndex,
} from '../src/ui/hud/journal/journal_hit_icons';
import { abilityIconRecipe, hasExplicitAbilityIcon } from '../src/ui/icons';

/** Fight objects (not mob templates) that deal a page's hits. */
const OBJECT_DEALERS: ReadonlySet<string> = new Set([MORTHEN_SOUL_TEMPLATE]);

const ROOT = join(__dirname, '..');
const SIM = join(ROOT, 'src', 'sim');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return name.endsWith('.ts') ? [full] : [];
  });
}

const SIM_TEXT = walk(SIM)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

/** Every (page bodies, mechanic) pair the journal shows, on both tiers. */
function journalHits(): { instance: string; iconId: string; label: string; dealers: string[] }[] {
  const out: { instance: string; iconId: string; label: string; dealers: string[] }[] = [];
  for (const instance of JOURNAL_INSTANCES) {
    for (const bossKey of instance.source.bossKeys) {
      for (const tier of ['normal', 'heroic'] as const) {
        const view = instance.source.view(bossKey, tier);
        const dealers = [...(view.members ?? [view.mobId]), ...(view.hitSources ?? [])];
        for (const phase of view.phases)
          for (const m of phase.mechanics)
            for (const label of m.hits ?? [])
              out.push({ instance: instance.id, iconId: m.iconId, label, dealers });
      }
    }
  }
  return out;
}

/** The call arguments of every `fn(` in `src`, parens and strings aware. */
function callArgs(src: string, fn: string): string[][] {
  const out: string[][] = [];
  const re = new RegExp(`(?<![\\w.])${fn.replace('.', '\\.')}\\(`, 'g');
  let m: RegExpExecArray | null = re.exec(src);
  while (m) {
    if (!/function\s*$/.test(src.slice(Math.max(0, m.index - 9), m.index))) {
      const args: string[] = [];
      let depth = 0;
      let cur = '';
      let quote: string | null = null;
      for (let i = m.index + m[0].length; i < src.length; i++) {
        const c = src[i];
        if (quote) {
          cur += c;
          if (c === quote && src[i - 1] !== '\\') quote = null;
          continue;
        }
        if (c === "'" || c === '"' || c === '`') {
          quote = c;
          cur += c;
          continue;
        }
        if (c === '(' || c === '[' || c === '{') depth++;
        if (c === ')' || c === ']' || c === '}') {
          if (depth === 0) {
            args.push(cur.trim());
            break;
          }
          depth--;
        }
        if (c === ',' && depth === 0) {
          args.push(cur.trim());
          cur = '';
          continue;
        }
        cur += c;
      }
      out.push(args);
    }
    m = re.exec(src);
  }
  return out;
}

const literal = (arg: string | undefined): string | null => {
  const m = arg?.match(/^(['"])(.*)\1$/);
  return m ? m[2].replace(/\\'/g, "'") : null;
};

/** Labels a dealer set reaches in an index (any of the dealers). */
function resolvesAny(index: JournalHitIndex, label: string, dealers: readonly string[]): boolean {
  return dealers.some((d) => journalHitIconIn(index, label, d) !== null);
}

function instanceIndex(id: string): { index: JournalHitIndex; dealers: string[] } {
  const instance = JOURNAL_INSTANCES.find((i) => i.id === id);
  if (!instance) throw new Error(`no journal instance ${id}`);
  const { index } = buildJournalHitIndex([instance.source]);
  return { index, dealers: [...index.keys()] };
}

describe('journal hit index: the data is sound', () => {
  it('maps no dealer and label to two different icons', () => {
    const { conflicts } = buildJournalHitIndex(JOURNAL_INSTANCES.map((i) => i.source));
    expect(conflicts).toEqual([]);
  });

  it('names only labels the sim really deals (a quoted string in src/sim)', () => {
    const missing = journalHits()
      .map((h) => h.label)
      .filter((label) => !SIM_TEXT.includes(`'${label}'`) && !SIM_TEXT.includes(`"${label}"`));
    expect([...new Set(missing)]).toEqual([]);
  });

  it('names only real mob templates as dealers, and icons with a recipe', () => {
    const hits = journalHits();
    const dealers = new Set(hits.flatMap((h) => h.dealers));
    expect([...dealers].filter((d) => !MOBS[d] && !OBJECT_DEALERS.has(d))).toEqual([]);
    expect(
      [...new Set(hits.map((h) => h.iconId))].filter((i) => !hasExplicitAbilityIcon(i)),
    ).toEqual([]);
  });

  it('draws every journal icon id as its own picture (no two ids share a recipe)', () => {
    const ids = new Set<string>();
    for (const instance of JOURNAL_INSTANCES)
      for (const bossKey of instance.source.bossKeys)
        for (const tier of ['normal', 'heroic'] as const) {
          const view = instance.source.view(bossKey, tier);
          for (const phase of view.phases) for (const m of phase.mechanics) ids.add(m.iconId);
          for (const choice of view.choices ?? []) ids.add(choice.iconId);
        }
    const byRecipe = new Map<string, string[]>();
    for (const id of ids) {
      const recipe = JSON.stringify(abilityIconRecipe(id));
      byRecipe.set(recipe, [...(byRecipe.get(recipe) ?? []), id]);
    }
    expect([...byRecipe.values()].filter((same) => same.length > 1)).toEqual([]);
  });

  it('covers every journal instance that deals damage', () => {
    const withHits = new Set(journalHits().map((h) => h.instance));
    for (const instance of JOURNAL_INSTANCES)
      expect(withHits.has(instance.id), instance.id).toBe(true);
  });
});

describe('journal hit index: lookups', () => {
  it('scopes a label to the page whose body dealt it', () => {
    // Stone Thrum is the council's pillar pulse and Ashgrand's Hammer-star
    // volley: two pages, two icons.
    expect(journalHitIconId(COUNCIL_NAMES.risenPulse, COUNCIL_GUARDIAN)).toBe(
      'dgn_heart_stone_thrum',
    );
    expect(journalHitIconId(FINAL_NAMES.thrum, FINAL_BOSS)).toBe('dgn_heart_wake_stone');
    // Cinder Trail: Ignazhar's Wellkeepers, Ashgrand's Splinter of the Heat.
    expect(journalHitIconId(HEAT_NAMES.trail, HEAT_GUARDIAN)).toBe('dgn_heart_wellkeeper');
    expect(journalHitIconId(FINAL_PHASE_NAMES.trail, FINAL_BOSS)).toBe('dgn_heart_splinter_heat');
  });

  it('reads an add listed in hitSources as its page', () => {
    expect(journalHitIconId(FINAL_PHASE_NAMES.shear, FINAL_ADD_MOBS.hammer)).toBe(
      'dgn_heart_shearing_blow',
    );
    expect(journalHitIconId('Venom Spit', 'mere_hydra_head_left')).toBe('dgn_temple_venom_spit');
    expect(journalHitIconId('Cinder Breath', 'sanctum_drakonid')).toBe('dgn_sanctum_brood');
  });

  it('never lends a boss icon to another dealer or a missing one', () => {
    // a player's own Reaping Arc, a rift mob's Venom, an unknown dealer
    expect(journalHitIconId('Reaping Arc', 'warrior')).toBeNull();
    expect(journalHitIconId('Venom', 'rift_spider')).toBeNull();
    expect(journalHitIconId(HEAT_NAMES.wheel, null)).toBeNull();
    expect(journalHitIconId(HEAT_NAMES.wheel, FINAL_BOSS)).toBeNull();
    expect(journalHitIconId(null, HEAT_GUARDIAN)).toBeNull();
    expect(journalHitIconId('Attack', HEAT_GUARDIAN)).toBeNull();
  });

  it('is built once and reused', () => {
    expect(journalHitIndex()).toBe(journalHitIndex());
  });
});

// ---- coverage of the encounters' own damage calls -----------------------------

const HEART_TABLES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  BREATH_NAMES,
  ISLE_NAMES,
  COUNCIL_NAMES,
  ELEMENT_NAMES,
  FINAL_NAMES,
  FINAL_PHASE_NAMES,
  HARD_ENRAGE_NAMES,
  HEAT_NAMES,
  QUENCH_NAMES,
};

/** Smith's Heart damage helpers: the call and its label's argument index. */
const HEART_DAMAGE_CALLS: readonly [string, number][] = [
  ['ctx.dealDamage', 5],
  ['fireHit', 3],
  ['frostHit', 3],
  ['hit', 3],
  ['addHit', 4],
  ['finishFall', 2],
];

/** Smith's Heart labels the fights deal that no journal row owns, and why. */
const HEART_UNOWNED: Readonly<Record<string, string>> = {
  [COUNCIL_NAMES.rubble]: "a fallen pillar's rubble patch: the journal has no row for it",
  [HEAT_NAMES.wellFire]: 'standing in the wellspring itself: the journal has no row for it',
  [FINAL_PHASE_NAMES.anvilEnd]: "the hidden phase's end (Mythic, outside the journal)",
  [FINAL_PHASE_NAMES.falling]: 'a fall off the Anvil (no dealer)',
};

describe("journal hit index: every Smith's Heart damage name resolves", () => {
  const dir = join(SIM, 'encounters', 'smith_heart');
  const labels = new Set<string>();
  for (const file of walk(dir)) {
    const src = readFileSync(file, 'utf8');
    // `FINAL_PHASE_NAMES as N` style aliases
    const alias = new Map<string, string>();
    for (const m of src.matchAll(/\b([A-Z_]+_NAMES) as (\w+)/g)) alias.set(m[2], m[1]);
    for (const [fn, at] of HEART_DAMAGE_CALLS) {
      for (const args of callArgs(src, fn)) {
        const arg = args[at] ?? '';
        for (const m of arg.matchAll(/\b([A-Z_]+_NAMES|[A-Z])\.(\w+)/g)) {
          const table = HEART_TABLES[alias.get(m[1]) ?? m[1]];
          const value = table?.[m[2]];
          if (typeof value === 'string') labels.add(value);
        }
      }
    }
  }
  const { index, dealers } = instanceIndex('smith_heart');

  it('finds the fights damage calls (the scan is live)', () => {
    expect(labels.size).toBeGreaterThan(60);
    expect(labels.has(HEAT_NAMES.wheel)).toBe(true);
    expect(labels.has(FINAL_PHASE_NAMES.fury)).toBe(true);
  });

  for (const label of [...labels].sort()) {
    it(`${label}`, () => {
      if (HEART_UNOWNED[label]) {
        expect(resolvesAny(index, label, dealers)).toBe(false);
        return;
      }
      expect(resolvesAny(index, label, dealers), label).toBe(true);
    });
  }

  it("resolves the bosses' template swings and kits on their own page", () => {
    const own: [string, string | undefined, string][] = [
      [
        COUNCIL_GUARDIAN,
        SMITH_HEART_MOBS[COUNCIL_GUARDIAN]?.arcCleave?.name,
        'dgn_heart_hammerfall',
      ],
      [
        QUENCH_GUARDIAN,
        SMITH_HEART_MOBS[QUENCH_GUARDIAN]?.arcCleave?.name,
        'heart_quench_tempered',
      ],
      [FINAL_BOSS, SMITH_HEART_MOBS[FINAL_BOSS]?.arcCleave?.name, 'dgn_heart_forge_fist'],
      [HEAT_GUARDIAN, SMITH_HEART_MOBS[HEAT_GUARDIAN]?.stackPoison?.name, 'dgn_heart_cinder_grip'],
      [
        BREATH_GUARDIAN,
        SMITH_HEART_MOBS[BREATH_GUARDIAN]?.trashKit?.line?.name,
        'dgn_heart_storm_lance',
      ],
      [
        BREATH_GUARDIAN,
        SMITH_HEART_MOBS[BREATH_GUARDIAN]?.trashKit?.wingGust?.name,
        'dgn_heart_summit_roar',
      ],
      [
        FINAL_ADD_MOBS.hammer,
        SMITH_HEART_MOBS[FINAL_ADD_MOBS.hammer]?.stackPoison?.name,
        'dgn_heart_mounting_weight',
      ],
    ];
    for (const [dealer, label, icon] of own) {
      expect(label, `${dealer} template label`).toBeTypeOf('string');
      expect(journalHitIconId(label, dealer), `${dealer} ${label}`).toBe(icon);
    }
  });
});

/** Dungeon labels no journal row owns, and why. */
const DUNGEON_UNOWNED: Readonly<Record<string, string>> = {
  'Wyrmcall Pyre': "the Knellwyrm's arrival blast after Morthen: no row of its own",
  Echo: "Selthe's Heroic echo of either Chorus or Solo: one label, two rows",
};

describe('journal hit index: every literal dungeon boss label resolves', () => {
  const DUNGEONS = [
    'drowned_temple',
    'gravewyrm_sanctum',
    'hollow_crypt',
    'sunken_bastion',
    'wildheart_basin',
  ] as const;
  const catalogIds = new Map(
    JOURNAL_INSTANCES.filter((i) => i.kind === 'dungeon').map((i) => [i.id, i.id]),
  );
  for (const dir of DUNGEONS) {
    const labels = new Set<string>();
    for (const file of walk(join(SIM, 'encounters', dir))) {
      for (const args of callArgs(readFileSync(file, 'utf8'), 'ctx.dealDamage')) {
        const label = literal(args[5]);
        if (label) labels.add(label);
      }
    }
    it(`${dir}: its encounter deals literal labels (the scan is live)`, () => {
      expect(labels.size).toBeGreaterThan(5);
    });
    for (const label of [...labels].sort()) {
      it(`${dir}: ${label}`, () => {
        const ids = [...catalogIds.keys()];
        const owned = ids.some((id) => {
          const { index, dealers } = instanceIndex(id);
          return resolvesAny(index, label, dealers);
        });
        expect(owned, label).toBe(DUNGEON_UNOWNED[label] === undefined);
      });
    }
  }
});
