// The CLIENT half of the operator-applied Cheater mark (src/sim/moderation/):
// the `chm` wire mirror, and the presentation the mark's own aura earns once it
// crosses onto a client (localized name, dedicated icon, debuff-bar placement,
// and the two independent reasons a player cannot right-click it away).
//
// The sim half lives in tests/cheater_mark.test.ts; nothing here re-pins it.

import { describe, expect, it, vi } from 'vitest';

// Mock the db layer so no Postgres is needed; only the wire encoding is under
// test (the hoisted-mock idiom in tests/CLAUDE.md, "Server tests").
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  setAccountWeaponSkinLoadout: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
    weaponSkinIds: [],
    weaponSkinLoadout: {},
  })),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { wireEntity } from '../server/game';
import { isDebuffAura } from '../src/sim/aura_classify';
import { isCancelableAura } from '../src/sim/combat/aura_cancel';
import { CHEATER_MARK_AURA_ID, cheaterMarkAura } from '../src/sim/moderation';
import { Sim } from '../src/sim/sim';
import { auraDisplayNameForHud } from '../src/ui/aura_display_name';
import { createAuraIconResolver } from '../src/ui/aura_icon_view';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import {
  auraIconRecipe,
  hasAbilityIconIdentity,
  hasAuraRecipe,
  isUnknownIconRecipe,
} from '../src/ui/icons';
import { localizeSimAuraName } from '../src/ui/sim_i18n';
import { bareClient } from './helpers/bare_client';

// A value no other wire field carries (durations here are round numbers), so the
// "no budget on the identity record" assertion below cannot pass by coincidence.
const MARK_SECONDS = 4217;

// setCheaterMark is the one entry point that applies a mark (the offline Sim
// never calls it), so build the marked entity through it rather than
// hand-stamping the flag: the encode under test must see the entity a real
// sanction produces, its aura included.
function markedPlayerSim(seconds = MARK_SECONDS): Sim {
  const sim = new Sim({ seed: 7, playerClass: 'warrior' });
  sim.setCheaterMark(seconds);
  return sim;
}

describe('the Cheater mark over the wire', () => {
  it('mirrors the mark onto another player client through the real encoder', () => {
    const sim = markedPlayerSim();
    const e = sim.player;
    expect(e.cheaterMark).toBe(true);

    const wire = wireEntity(e);
    // The wire key IS the protocol: `chm`, encoded as the sparse 1 and never a
    // duration, because a nearby client only has to decide WHETHER to draw the
    // tag.
    expect(wire.chm).toBe(1);
    // What the next assertion pins is the SHAPE of the identity record, not
    // privacy: the budget rides the aura array and nothing else, so the identity
    // fields every entity in interest scope re-sends stay one flag wide. The
    // countdown itself is ordinary visible aura state, exactly like any other
    // debuff timer (wireAura ships `rem` for every aura it sends, to every
    // client that can see the wearer), and that is by design: a public sanction
    // with a public clock. Were that ever to become a privacy requirement, the
    // fix is filtering the aura to the wearer server-side, not this assertion.
    const identityOnly: Record<string, unknown> = { ...wire };
    delete identityOnly.auras;
    expect(JSON.stringify(identityOnly)).not.toContain(String(MARK_SECONDS));

    // A DIFFERENT player's client seeing this player in the world.
    const client = bareClient(e.id + 1000);
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot({
      t: 'snap',
      ents: [wire],
    });
    expect(client.entities.get(e.id)?.cheaterMark).toBe(true);
  });

  it('leaves an unmarked player unbranded, with no key on the wire at all', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior' });
    const e = sim.player;

    const wire = wireEntity(e);
    // Absent, not `chm: 0`: an unmarked player's identity record must be
    // byte-unchanged by this feature, or every entity on screen pays for it.
    expect(wire).not.toHaveProperty('chm');

    const client = bareClient(e.id + 1000);
    (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot({
      t: 'snap',
      ents: [wire],
    });
    expect(client.entities.get(e.id)?.cheaterMark).toBe(false);
  });

  it('CLEARS a mirrored mark when the lifted sanction re-sends the identity record', () => {
    // The regression this closes: a decode written as `if (w.chm) e.cheaterMark
    // = true` brands a player forever, because a lifted mark ships an identity
    // record with the key ABSENT rather than a `chm: 0`.
    const sim = markedPlayerSim();
    const e = sim.player;
    const client = bareClient(e.id + 1000);
    const apply = (s: unknown) =>
      (client as unknown as { applySnapshot(s: unknown): void }).applySnapshot(s);

    apply({ t: 'snap', ents: [wireEntity(e)] });
    expect(client.entities.get(e.id)?.cheaterMark).toBe(true);

    // A lift leaves the flag ABSENT, never false (the sim core's
    // absent-when-empty rule), so the identity record ships with no chm key
    // and the mirror's clear-on-absent arm is what un-brands the client copy.
    sim.setCheaterMark(0);
    expect(e.cheaterMark).toBeUndefined();
    apply({ t: 'snap', ents: [wireEntity(e)] });
    expect(client.entities.get(e.id)?.cheaterMark).toBe(false);
  });
});

describe('the Cheater mark aura reaches the client as a named, iconned debuff', () => {
  const aura = cheaterMarkAura({ secondsRemaining: MARK_SECONDS }, 1);

  it('localizes the aura name instead of shipping raw English to every locale', async () => {
    // The silent-failure shape this closes: localizeSimAuraName returns null for
    // an unregistered name and every caller falls back to the raw English, so an
    // absent AURA_NAME_KEY row ships "Marked as a Cheater" in all 21 locales with
    // nothing red.
    setLanguage('en');
    // Identity round-trip in English, not just non-null: the matcher's EN value
    // must EQUAL the aura's authored name, or the row points at a stale string.
    expect(localizeSimAuraName(aura.name)).toBe(aura.name);

    for (const lang of ['zh_CN', 'ja_JP', 'ru_RU'] as const) {
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      const localized = localizeSimAuraName(aura.name);
      expect(localized, `no aura matcher row resolved for ${lang}`).not.toBeNull();
      // The HUD's own resolver, not just the matcher: this is the call the
      // buff/debuff strip and the combat log actually make. The bogus ability
      // name is the teeth: auraDisplayNameForHud prefers the matcher and only
      // then falls back, so passing something the assertion would notice proves
      // the matcher arm is the one answering.
      expect(auraDisplayNameForHud(aura.name, 'NOT-THE-AURA-NAME')).toBe(localized);
    }
    setLanguage('en');
  });

  it('carries a dedicated icon rather than the generic utility fallback', () => {
    const resolve = createAuraIconResolver(hasAbilityIconIdentity, hasAuraRecipe);
    // A recipe keyed by the AURA ID makes the resolver pass the id straight
    // through; without one it degraded to `aura_cheater_mark`, which no recipe
    // matched, so a SANCTION wore the parchment/gold "utility buff" art.
    expect(hasAuraRecipe(CHEATER_MARK_AURA_ID)).toBe(true);
    expect(resolve({ id: aura.id, kind: aura.kind })).toBe(CHEATER_MARK_AURA_ID);
    expect(resolve({ id: aura.id, kind: aura.kind })).not.toBe(`aura_${aura.kind}`);
    expect(isUnknownIconRecipe(auraIconRecipe(CHEATER_MARK_AURA_ID))).toBe(false);
  });

  it('sorts into the debuff bar and is not right-click cancellable', () => {
    // Two INDEPENDENT reasons, both asserted: the kind is in the harmful set, and
    // the aura is undispellable. Losing either one alone must not make a
    // sanction sheddable.
    expect(isDebuffAura(aura.kind, aura.value)).toBe(true);
    expect(aura.undispellable).toBe(true);
    expect(isCancelableAura(aura)).toBe(false);
    // Undispellable alone still refuses, with the debuff classification removed.
    expect(isCancelableAura({ ...aura, kind: 'buff_sta', value: 0 })).toBe(false);
  });

  it('reports a countdown the debuff bar can read, seeded from the played budget', () => {
    expect(aura.remaining).toBe(MARK_SECONDS);
    expect(aura.duration).toBe(MARK_SECONDS);
  });
});
