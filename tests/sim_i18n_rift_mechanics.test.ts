// Rift mechanic names must reach the player LOCALIZED.
//
// src/sim/content/rift/mobs.ts authors a display name on every trash affix and
// every boss headline mechanic, and the sim splices that raw English straight
// into three player surfaces: the buff/debuff bar and the aura gain/fade log
// (auraDisplayNameForHud), the "{mob} unleashes {mechanic}!" bark
// (locBossMechanic), and the damage source label on the combat log, the floating
// text and the meters (abilityDisplayNameFromSource). All three end at
// localizeSimAuraName, which falls back to the RAW ENGLISH for a name it does not
// know, and nothing else in the tree measures that fallback.
//
// The whole rift kit shipped that way: of the 56 names its templates surface,
// only the four it REUSES from older content (Thunderclap, Howling Gale, Seismic
// Stomp, Soulrot) had a matcher row, so 52 mechanic names rendered English in the
// 20 non-English locales.
//
// This file DERIVES the set from RIFT_MOBS instead of listing it, so a newly
// authored rift mechanic reds here until it has a row in sim_i18n.ts. The two
// exemptions below are not skips: each one proves the name is covered on the
// surface it actually reaches.

import { describe, expect, it } from 'vitest';
import { RIFT_MOBS } from '../src/sim/content/rift/mobs';
import { createMob } from '../src/sim/entity';
import { runMobSwingAffixes } from '../src/sim/mob/mob_swing';
import { Sim } from '../src/sim/sim';
import type { Entity, MobTemplate } from '../src/sim/types';
import { castDisplayName } from '../src/ui/cast_display_name';
import { setLanguage, type TranslationKey, t } from '../src/ui/i18n';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

/** Every MobTemplate field a rift template names today, with the player surface
 *  that name reaches. A field missing from this table (or from EXEMPT_FIELDS)
 *  fails the classification test below: that is the arm that makes a newly
 *  authored mechanic land on somebody's desk instead of shipping English. */
const SURFACED_FIELDS: Readonly<Record<string, string>> = {
  // On-hit affix auras applied to the player (src/sim/mob/mob_swing.ts).
  chillOnHit: 'slow aura',
  frostbite: 'frost dot aura',
  cinder: 'fire dot aura',
  smolder: 'fire dot aura',
  venom: 'nature dot aura',
  ensnare: 'root aura (applyRootAura)',
  bleed: 'physical dot aura',
  manaBurn: 'aura event on the drain',
  arcaneRot: 'arcane dot aura',
  dread: 'fear aura',
  concuss: 'stun aura',
  corrode: 'armor-shred aura event',
  stunOnHit: 'stun aura',
  soulrot: 'shadow dot aura',
  stackPoison: 'stacking dot aura event',
  healAbsorb: 'heal-absorb aura',
  spellVuln: 'spell-vulnerability aura',
  rampage: 'stacking self-buff aura on the mob',
  // Timed boss runners (src/sim/mob/locomotion.ts).
  aoeSlow: 'anti-kite snare aura',
  stoneskin: 'absorb aura + the unleashes bark',
  terrify: 'fear aura + the unleashes bark',
  stomp: 'stun aura + the unleashes bark + the damage source label',
  aoePulse: 'damage source label',
  bigCast: 'the unleashes bark + the damage source label',
  // The knockback bark (src/sim/mob/mob_swing.ts).
  knockback: 'the unleashes bark',
  // The cleave splash label (src/sim/mob/mob_swing.ts).
  cleave: 'damage source label',
};

/** Named fields whose name the player never reads through the aura matcher.
 *  Each is proved below rather than trusted: an exemption nobody checks is how
 *  an unlocalized surface hides. */
const EXEMPT_FIELDS: Readonly<Record<string, string>> = {
  // MobTemplate.lifeleech.name is declared optional and never read: the leech
  // arm emits a heal on the mob and no named aura. Proved by the real swing
  // path below.
  lifeleech: 'the name is never read by the sim',
  // The lethal-zone pair is localized by castId through the ability catalog
  // (abilityUi.cast.<castId>, resolved by castDisplayName on the target cast
  // bar); the driver never reads def.name. Proved against the catalog below.
  deathZoneCast: 'localized as abilityUi.cast.<castId>',
  deathZoneStrike: 'localized as abilityUi.cast.<castId>',
};

type NamedRow = { id: string; field: string; name: string };

/** Walk every rift template for object-valued fields carrying a string `name`,
 *  one level of nesting included (engageShout.wardWhelps is authored that way on
 *  non-rift templates, and a rift template adopting it must not slip the scan). */
function riftNamedRows(): NamedRow[] {
  const rows: NamedRow[] = [];
  for (const [id, tmpl] of Object.entries(RIFT_MOBS)) {
    for (const [field, v] of Object.entries(tmpl as unknown as Record<string, unknown>)) {
      if (field === 'name' || field === 'id') continue;
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const n = (v as { name?: unknown }).name;
      if (typeof n === 'string') rows.push({ id, field, name: n });
      for (const [f2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (!v2 || typeof v2 !== 'object' || Array.isArray(v2)) continue;
        const n2 = (v2 as { name?: unknown }).name;
        if (typeof n2 === 'string') rows.push({ id, field: `${field}.${f2}`, name: n2 });
      }
    }
  }
  return rows;
}

describe('rift mechanic names are localized', () => {
  it('the scan really sees the rift kit (floors + the names the audit named)', () => {
    // Vacuity floor: the assertions below are `for (const row of rows)`, so a
    // scan that walked nothing would pass every one of them. These floors sit
    // just under the real counts, so a renamed content export or a template
    // shape change collapses the scan loudly instead of quietly.
    const rows = riftNamedRows();
    expect(rows.length, 'named mechanic rows scanned off RIFT_MOBS').toBeGreaterThanOrEqual(75);
    expect(Object.keys(RIFT_MOBS).length, 'rift templates scanned').toBeGreaterThanOrEqual(25);
    const names = new Set(rows.map((r) => r.name));
    // The four the Phase 18 audit named by hand, plus one per surface family.
    for (const named of [
      'Pitsteel Sweep',
      'Hoof of Ruin',
      'Wing Buffet',
      'Pitfire Ring',
      'Rimebite',
      'Rain of Brimstone',
      "Warlord's Bellow",
    ])
      expect(names.has(named), `the scan lost '${named}'`).toBe(true);
  });

  it('every named mechanic field is classified as surfaced or exempt', () => {
    const unclassified = [
      ...new Set(
        riftNamedRows()
          .map((r) => r.field)
          .filter((f) => !(f in SURFACED_FIELDS) && !(f in EXEMPT_FIELDS)),
      ),
    ];
    expect(
      unclassified,
      `rift templates name a mechanic field this file does not classify: ${unclassified.join(', ')}. ` +
        'Add it to SURFACED_FIELDS (and give the name a matcher row in src/ui/sim_i18n.ts) ' +
        'or to EXEMPT_FIELDS with a proof.',
    ).toEqual([]);
  });

  it('every surfaced rift mechanic name resolves through the aura matcher', () => {
    // The English round-trip, not merely "not null": a row whose value drifted
    // away from the authored name still resolves, and then every locale renders
    // a mechanic the player never sees on their screen. Same shape as the elixir
    // and wellFed pins in tests/localization_fixes.test.ts. Those pins pin the
    // language first, and so does this one: the round-trip compares against the
    // AUTHORED English, so an ambient locale left set by an earlier import would
    // judge every row against a translation instead.
    setLanguage('en');
    const misses: string[] = [];
    for (const row of riftNamedRows()) {
      if (row.field in EXEMPT_FIELDS) continue;
      const got = localizeSimAuraName(row.name);
      if (got === null) misses.push(`${row.id}.${row.field}: no matcher row for '${row.name}'`);
      else if (got !== row.name)
        misses.push(`${row.id}.${row.field}: '${row.name}' resolves to '${got}' in en`);
    }
    expect(misses, `unlocalized rift mechanic names:\n${misses.join('\n')}`).toEqual([]);
  });

  it('the matcher predicate discriminates (an unregistered name still returns null)', () => {
    // The assertion above passes trivially if localizeSimAuraName answered
    // non-null for everything. It does not: a name one byte off the authored one
    // is exactly the drift the round-trip is there to catch.
    setLanguage('en');
    expect(localizeSimAuraName('Pitsteel Sweep')).toBe('Pitsteel Sweep');
    expect(localizeSimAuraName('Pitsteel Sweeep')).toBeNull();
    expect(localizeSimAuraName('Hoof of ruin')).toBeNull();
  });
});

describe('the rift matcher exemptions are earned', () => {
  it('every lethal-zone name is the ability catalog English for its castId', () => {
    // deathZoneCast/deathZoneStrike names never reach localizeSimAuraName: the
    // driver (src/sim/mob/locomotion.ts runDeathZoneDriver) reads castId, and the
    // target cast bar resolves it through abilityUi.cast.<castId>. That only
    // holds while the two sides agree byte for byte, so pin them against each
    // other: rename the mechanic in content and this reds.
    let checked = 0;
    for (const tmpl of Object.values(RIFT_MOBS) as MobTemplate[]) {
      for (const def of [tmpl.deathZoneCast, tmpl.deathZoneStrike]) {
        if (!def) continue;
        checked++;
        const key = `abilityUi.cast.${def.castId}` as TranslationKey;
        expect(t(key), `${def.castId} catalog English`).toBe(def.name);
        expect(castDisplayName(def.castId), `${def.castId} cast bar label`).not.toBe(def.castId);
      }
    }
    // Eight rift bosses carry the A-rank and S-rank zones.
    expect(checked, 'lethal-zone definitions checked').toBe(16);
  });

  it('the sim never surfaces lifeleech.name (the real swing path emits no such name)', () => {
    // Run the actual affix cascade rather than reading the source: the dread
    // stalker's lifeleech is authored 'Siphon', and if the leech arm ever grows
    // an aura or a bark the name has to join the matcher.
    const sim = new Sim({ seed: 4242, playerClass: 'warrior', autoEquip: true });
    const p = sim.player as Entity;
    const tmpl = RIFT_MOBS.rift_dread_stalker;
    expect(tmpl?.lifeleech?.name, 'fixture: the dread stalker still leeches by name').toBe(
      'Siphon',
    );
    const mob = createMob(
      (sim as unknown as { nextId: number }).nextId++,
      tmpl,
      20,
      sim.groundPos(p.pos.x, p.pos.z + 3),
    );
    mob.hostile = true;
    mob.hp = Math.max(1, Math.round(mob.maxHp / 2));
    sim.addEntity(mob);
    const events: unknown[] = [];
    sim.ctx.emit = (e: unknown) => {
      events.push(e);
    };
    runMobSwingAffixes(sim.ctx, mob, p, { dealt: 200, crit: false, rawDmg: 200 });
    // Non-vacuity: the leech really fired on this swing, so "no Siphon anywhere"
    // is a statement about a code path that ran, not one that was skipped.
    const healed = events.some((e) => {
      const ev = e as { type?: string; targetId?: number; amount?: number };
      return ev.type === 'heal' && ev.targetId === mob.id && (ev.amount ?? 0) > 0;
    });
    expect(healed, 'fixture: the lifeleech heal did not fire, so the check proves nothing').toBe(
      true,
    );
    const leaked = events.filter((e) => JSON.stringify(e).includes('Siphon'));
    expect(leaked, `lifeleech.name reached a player event: ${JSON.stringify(leaked)}`).toEqual([]);
    expect(
      mob.auras.some((a) => a.name === 'Siphon') || p.auras.some((a) => a.name === 'Siphon'),
      'lifeleech.name became an aura',
    ).toBe(false);
  });
});
