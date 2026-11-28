// The journal's cast index (src/ui/hud/journal/journal_cast_icons.ts) and the
// boss cast bar that reads it (src/ui/target_cast_bar.ts): every cast id a journal
// page names resolves for each body that casts it, a cast by a body that is not on
// the page resolves to nothing, no (caster, cast) pair maps to two icons, and the
// target cast bar paints the Smith's Heart painting in its icon slot while every
// other journal's casts keep the slot hidden (their procedural glyphs never reach
// the bar).
import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { MORTHEN_SOUL_TEMPLATE } from '../src/sim/encounters/hollow_crypt/morthen_ids';
import { BREATH_CASTS, BREATH_GUARDIAN } from '../src/sim/encounters/smith_heart/breath_ids';
import { ISLE_CASTS, ISLE_MOBS } from '../src/sim/encounters/smith_heart/breath_isle_ids';
import {
  COUNCIL_CASTS,
  COUNCIL_GUARDIAN,
  COUNCIL_SEAM_SINGER,
} from '../src/sim/encounters/smith_heart/council_ids';
import { FINAL_BOSS, FINAL_CASTS } from '../src/sim/encounters/smith_heart/final_ids';
import {
  FINAL_ADD_MOBS,
  FINAL_PHASE_CASTS,
} from '../src/sim/encounters/smith_heart/final_phase_ids';
import { HEAT_CASTS, HEAT_GUARDIAN } from '../src/sim/encounters/smith_heart/heat_ids';
import type { Entity } from '../src/sim/types';
import { bossAbilityImageUrl } from '../src/ui/boss_ability_art';
import {
  buildJournalCastIndex,
  journalCastArtUrl,
  journalCastIconId,
  journalCastIndex,
} from '../src/ui/hud/journal/journal_cast_icons';
import { JOURNAL_INSTANCES } from '../src/ui/hud/journal/journal_catalog';
import type { PainterHostWriters } from '../src/ui/painter_host';
import { TargetCastBar } from '../src/ui/target_cast_bar';

const TIERS = ['normal', 'heroic'] as const;

/** Every (instance, caster, cast id, icon) the journal shows, on both tiers. */
function journalCasts(): { instance: string; caster: string; castId: string; iconId: string }[] {
  const out: { instance: string; caster: string; castId: string; iconId: string }[] = [];
  for (const instance of JOURNAL_INSTANCES)
    for (const bossKey of instance.source.bossKeys)
      for (const tier of TIERS) {
        const view = instance.source.view(bossKey, tier);
        const casters = [
          ...(view.members ?? [view.mobId]),
          ...(view.hitSources ?? []),
          ...(view.castSources ?? []),
        ];
        for (const phase of view.phases)
          for (const m of phase.mechanics) {
            if (!m.castId) continue;
            for (const caster of casters)
              out.push({ instance: instance.id, caster, castId: m.castId, iconId: m.iconId });
          }
      }
  return out;
}

describe('journal cast index', () => {
  it('maps no (caster, cast) pair to two icons', () => {
    const { conflicts } = buildJournalCastIndex(JOURNAL_INSTANCES.map((i) => i.source));
    expect(conflicts).toEqual([]);
  });

  it('resolves every journal cast for each body that casts it', () => {
    const casts = journalCasts();
    expect(casts.length).toBeGreaterThan(40);
    for (const c of casts)
      expect(journalCastIconId(c.caster, c.castId), `${c.caster} ${c.castId}`).toBe(c.iconId);
  });

  it('names only real mob templates (or the one fight object) as casters', () => {
    const casters = new Set(journalCasts().map((c) => c.caster));
    expect([...casters].filter((c) => !MOBS[c] && c !== MORTHEN_SOUL_TEMPLATE)).toEqual([]);
  });

  it("paints every Smith's Heart cast and no other journal's", () => {
    const casts = journalCasts();
    const heart = casts.filter((c) => c.instance === 'smith_heart');
    expect(heart.length).toBeGreaterThan(20);
    for (const c of heart)
      expect(journalCastArtUrl(c.caster, c.castId), `${c.caster} ${c.castId}`).toBe(
        bossAbilityImageUrl(c.iconId),
      );
    for (const c of heart) expect(bossAbilityImageUrl(c.iconId), c.iconId).not.toBeNull();
    const others = casts.filter((c) => c.instance !== 'smith_heart');
    expect(others.length).toBeGreaterThan(10);
    for (const c of others)
      expect(journalCastArtUrl(c.caster, c.castId), `${c.caster} ${c.castId}`).toBeNull();
  });

  it('reads the isle casters listed in castSources as the Breath page', () => {
    expect(journalCastIconId(ISLE_MOBS.mender, ISLE_CASTS.mending)).toBe('dgn_heart_mending_gale');
    expect(journalCastIconId(ISLE_MOBS.herald, ISLE_CASTS.shove)).toBe('dgn_heart_shoving_gale');
    expect(journalCastIconId(BREATH_GUARDIAN, ISLE_CASTS.nova)).toBe('dgn_heart_skyrend_nova');
  });

  it('reads the Splinters in hitSources as the final page', () => {
    expect(journalCastIconId(FINAL_ADD_MOBS.quench, FINAL_PHASE_CASTS.toll)).toBe(
      'dgn_heart_rime_toll',
    );
    expect(journalCastIconId(FINAL_ADD_MOBS.breath, FINAL_PHASE_CASTS.pounce)).toBe(
      'dgn_heart_gale_pounce',
    );
  });

  it('shares Basalt Fist and Leaping Bolt between the Heat and the final fight', () => {
    expect(journalCastIconId(HEAT_GUARDIAN, HEAT_CASTS.fist)).toBe('dgn_heart_basalt_fist');
    expect(journalCastIconId(FINAL_BOSS, FINAL_CASTS.fist)).toBe('dgn_heart_basalt_fist');
    expect(journalCastIconId(BREATH_GUARDIAN, BREATH_CASTS.fork)).toBe('dgn_heart_leaping_bolt');
    expect(journalCastIconId(FINAL_BOSS, FINAL_CASTS.bolt)).toBe('dgn_heart_leaping_bolt');
  });

  it('never lends a boss icon to another caster or a missing one', () => {
    // a player, a boss of another page, an unknown caster, no cast
    expect(journalCastIconId('warrior', COUNCIL_CASTS.bolt)).toBeNull();
    expect(journalCastIconId(HEAT_GUARDIAN, COUNCIL_CASTS.bolt)).toBeNull();
    expect(journalCastIconId(null, COUNCIL_CASTS.bolt)).toBeNull();
    expect(journalCastIconId(COUNCIL_SEAM_SINGER, null)).toBeNull();
    expect(journalCastIconId(COUNCIL_SEAM_SINGER, 'fireball')).toBeNull();
    expect(journalCastArtUrl('warrior', COUNCIL_CASTS.bolt)).toBeNull();
  });

  it('is built once and reused', () => {
    expect(journalCastIndex()).toBe(journalCastIndex());
  });
});

// ---- the target cast bar ---------------------------------------------------------

type Call = { m: keyof PainterHostWriters; args: unknown[] };

function recordingFacet(): { calls: Call[]; writers: PainterHostWriters } {
  const calls: Call[] = [];
  const rec =
    (m: keyof PainterHostWriters) =>
    (...args: unknown[]): void => {
      calls.push({ m, args });
    };
  return {
    calls,
    writers: {
      setText: rec('setText'),
      setDisplay: rec('setDisplay'),
      setTransform: rec('setTransform'),
      setWidth: rec('setWidth'),
      setStyleProp: rec('setStyleProp'),
      toggleClass: rec('toggleClass'),
      setAttr: rec('setAttr'),
    },
  };
}

function fakeBar(): { bar: HTMLElement; icon: HTMLElement } {
  const parts: Record<string, HTMLElement> = {
    '.fill': { tag: 'fill' } as unknown as HTMLElement,
    '.label': { tag: 'label' } as unknown as HTMLElement,
    '.timer': { tag: 'timer' } as unknown as HTMLElement,
    '.ui-cast-icon': { tag: 'icon' } as unknown as HTMLElement,
  };
  const bar = { tag: 'bar', querySelector: (sel: string) => parts[sel] ?? null };
  return { bar: bar as unknown as HTMLElement, icon: parts['.ui-cast-icon'] };
}

function caster(templateId: string, castingAbility: string | null): Entity {
  return {
    templateId,
    kind: 'mob',
    dead: false,
    castingAbility,
    castTotal: 2,
    castRemaining: 1,
    channeling: false,
  } as unknown as Entity;
}

describe('the target cast bar paints the boss ability icon', () => {
  it("shows the Smith's Heart painting for a boss cast", () => {
    const { calls, writers } = recordingFacet();
    const { bar, icon } = fakeBar();
    new TargetCastBar(writers, bar).paint(caster(COUNCIL_SEAM_SINGER, COUNCIL_CASTS.bolt));
    const onIcon = calls.filter((c) => c.args[0] === icon);
    expect(onIcon).toEqual([
      {
        m: 'setStyleProp',
        args: [icon, 'background-image', 'url("/ui/boss-abilities/dgn_heart_seam_bolt.webp")'],
      },
      { m: 'setAttr', args: [icon, 'hidden', null] },
    ]);
    // the bar, its fill and its label still paint as before
    expect(calls.some((c) => c.m === 'setDisplay' && c.args[0] === bar)).toBe(true);
  });

  it('wears a reused aura painting where the journal does', () => {
    const { calls, writers } = recordingFacet();
    const { bar, icon } = fakeBar();
    new TargetCastBar(writers, bar).paint(caster(COUNCIL_GUARDIAN, COUNCIL_CASTS.weight));
    expect(calls.find((c) => c.args[0] === icon && c.m === 'setStyleProp')?.args[2]).toBe(
      'url("/ui/auras/heart_hammers_weight.webp")',
    );
  });

  it('keeps the slot hidden for a dungeon boss and for a player', () => {
    for (const e of [
      caster('crypt_ossuary_drake', 'crypt_barrowflame_breath'),
      caster('mage', 'fireball'),
    ]) {
      const { calls, writers } = recordingFacet();
      const { bar, icon } = fakeBar();
      new TargetCastBar(writers, bar).paint(e);
      expect(calls.filter((c) => c.args[0] === icon)).toEqual([
        { m: 'setAttr', args: [icon, 'hidden', ''] },
      ]);
    }
  });
});
