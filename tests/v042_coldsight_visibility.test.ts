// v0.42.0 Coldsight visibility fix: hunter_coldsight_read.ts's three internal
// bookkeeping markers (the Fevered Draw progress counter, the two per-ability
// reserved-cast markers) ride `kind: 'internal_cd'` with an 86400s
// reservation-timeout duration purely so nothing but their own consumer clears
// them (see the module header there), never a real day-long buff. Before the
// fix, createAurasView's fill() only filtered debuffs/temporal_echo, so these
// three rendered as misleading "1d" buffs with an Internal Cooldown tooltip on
// the buff bar AND the target/focus strip. This drives the real
// createAurasView core (the same builder hud.ts uses for buffBarView,
// debuffBarView, and targetAurasView) with the actual marker id literals, so
// a regression here is the exact defect a player would see.
import { describe, expect, it } from 'vitest';
import {
  COLDSIGHT_READ_AURA_ID,
  COLDSIGHT_READ_DURATION_SEC,
} from '../src/sim/combat/hunter_coldsight_read';
import {
  type AuraInput,
  type AuraMode,
  type AurasDeps,
  type AurasEntityInput,
  createAurasView,
} from '../src/ui/auras_view';

const OWN_PLAYER_ID = 7;

// The exact literal marker ids hunter_coldsight_read.ts rides (private consts
// there; restated here as the plain strings a real wire aura would carry, the
// same way the fix's own predicate is exact-id rather than an importable regex).
const FEVERED_DRAW_PROGRESS_ID = 'hunter_coldsight_fevered_draw_progress';
const RESERVED_AIMED_SHOT_ID = 'hunter_coldsight_read_reserved_aimed_shot';
const RESERVED_ARCANE_SHOT_ID = 'hunter_coldsight_read_reserved_arcane_shot';
const INTERNAL_MARKER_IDS = [
  FEVERED_DRAW_PROGRESS_ID,
  RESERVED_AIMED_SHOT_ID,
  RESERVED_ARCANE_SHOT_ID,
];
const RESERVATION_TIMEOUT_SEC = 86_400;

function deps(): AurasDeps {
  return {
    iconId: (a) => a.id,
    auraName: (a) => `name:${a.name}`,
    formatStacks: (n) => String(n),
    isOwn: (a) => a.sourceId === OWN_PLAYER_ID,
    durationUnits: () => ({ s: 's', m: 'm', h: 'h', d: 'd' }),
    auraEffectHtml: () => '',
  };
}

function aura(over: Partial<AuraInput> & { id: string }): AuraInput {
  return {
    name: over.id,
    kind: 'buff_ap',
    remaining: 10,
    duration: 10,
    value: 1,
    sourceId: OWN_PLAYER_ID,
    ...over,
  };
}

function entity(auras: AuraInput[]): AurasEntityInput {
  return { auras };
}

function marker(id: string): AuraInput {
  return aura({
    id,
    kind: 'internal_cd',
    remaining: RESERVATION_TIMEOUT_SEC,
    duration: RESERVATION_TIMEOUT_SEC,
  });
}

// One fixture aura list covering every case the fix must get right: the real
// armed opportunity (must stay, 10s), the three internal markers (must be
// gone), an unrelated internal_cd buff (must stay: no broad kind-wide hide),
// and a lookalike id that is NOT one of the three exact markers despite
// sharing the family's naming style (must stay: exact-id, not prefix match).
function readyPlusMarkers(): AuraInput[] {
  return [
    aura({
      id: COLDSIGHT_READ_AURA_ID,
      kind: 'hunter_coldsight_read',
      remaining: COLDSIGHT_READ_DURATION_SEC,
      duration: COLDSIGHT_READ_DURATION_SEC,
    }),
    marker(FEVERED_DRAW_PROGRESS_ID),
    marker(RESERVED_AIMED_SHOT_ID),
    marker(RESERVED_ARCANE_SHOT_ID),
    // Unrelated internal_cd marker: must never be caught by a broad
    // kind-wide hide (the review explicitly forbids one).
    aura({ id: 'heating_up', kind: 'internal_cd', remaining: 10, duration: 10 }),
    // Lookalike id: same naming family, NOT one of the three exact marker
    // ids (a different reserved ability), so it must render normally. Given
    // a short duration (unlike the real markers' 86400s) so it can never be
    // confused with the "no 1d anywhere" assertion below: this fixture proves
    // exact-id matching, not duration-based filtering.
    aura({
      id: 'hunter_coldsight_read_reserved_multi_shot',
      kind: 'internal_cd',
      remaining: 15,
      duration: 15,
    }),
  ];
}

function keysOf(mode: AuraMode, opts?: { ownFirst?: boolean }): string[] {
  const view = createAurasView(mode, deps(), opts);
  const state = view.tick(entity(readyPlusMarkers()));
  return state.slots.slice(0, state.count).map((s) => s.key);
}

describe('Coldsight Read internal markers never render as auras (v0.42.0)', () => {
  it('the buff bar (mode buffs) excludes all three internal markers, keeps everything else', () => {
    const keys = keysOf('buffs');
    for (const markerId of INTERNAL_MARKER_IDS) expect(keys).not.toContain(markerId);
    expect(keys).toContain(COLDSIGHT_READ_AURA_ID);
    expect(keys).toContain('heating_up');
    expect(keys).toContain('hunter_coldsight_read_reserved_multi_shot');
    // Six fixture auras minus the three real markers = three rendered slots.
    expect(keys).toHaveLength(3);
  });

  it('the target/focus strip (mode all, ownFirst) excludes all three internal markers too', () => {
    const keys = keysOf('all', { ownFirst: true });
    for (const markerId of INTERNAL_MARKER_IDS) expect(keys).not.toContain(markerId);
    expect(keys).toContain(COLDSIGHT_READ_AURA_ID);
    expect(keys).toContain('heating_up');
    expect(keys).toContain('hunter_coldsight_read_reserved_multi_shot');
    expect(keys).toHaveLength(3);
  });

  it('the debuff strip (mode debuffs) is unaffected: none of these fixture auras are debuffs anyway', () => {
    // Every fixture aura here is buff-coded (no allowlisted debuff kind, no
    // negative-value buff_*), so the debuffs mode renders none of them either
    // way; this pins that the marker filter does not accidentally widen what
    // counts as a debuff.
    expect(keysOf('debuffs')).toHaveLength(0);
  });

  it('the real armed opportunity renders with its true 10s duration, never the 86400s reservation window', () => {
    const view = createAurasView('buffs', deps());
    const state = view.tick(entity(readyPlusMarkers()));
    const ready = state.slots.slice(0, state.count).find((s) => s.key === COLDSIGHT_READ_AURA_ID);
    expect(ready).toBeDefined();
    expect(ready?.durationText).toBe('10s');
    expect(ready?.remaining).toBe(COLDSIGHT_READ_DURATION_SEC);
    expect(ready?.duration).toBe(COLDSIGHT_READ_DURATION_SEC);
    // Short-duration priority (aura_overflow_priority.ts `shortDuration`): 10s
    // sits well under SHORT_BUFF_PRIORITY_SEC (60), which is what keeps this
    // buff exempt from losing budget under the low-tier overflow cap before it
    // even reaches that module's separate id allowlist (ALWAYS_VISIBLE_AURA_IDS
    // already lists 'hunter_coldsight_read', unmodified and re-verified by
    // tests/aura_overflow_priority.test.ts).
    expect(ready?.shortDuration).toBe(true);
  });

  it('the kind gate matters: a wire aura reusing a marker id string under a different kind is not treated as internal', () => {
    // Same id string as a real marker, but riding an ordinary buff kind: the
    // fix gates on `kind === 'internal_cd'` as well as the exact id, so this
    // must render (proves the filter is not a bare id string match).
    const lookalikeKindAura = aura({
      id: FEVERED_DRAW_PROGRESS_ID,
      kind: 'buff_ap',
      remaining: 20,
      duration: 20,
    });
    const view = createAurasView('buffs', deps());
    const state = view.tick(entity([lookalikeKindAura]));
    expect(state.count).toBe(1);
    expect(state.slots[0].key).toBe(FEVERED_DRAW_PROGRESS_ID);
    expect(state.slots[0].durationText).toBe('20s');
  });

  it('none of the three internal markers ever produce a 1-day ("1d") duration label anywhere in the fixture', () => {
    for (const mode of ['buffs', 'debuffs', 'all'] as const) {
      const view = createAurasView(mode, deps(), { ownFirst: mode === 'all' });
      const state = view.tick(entity(readyPlusMarkers()));
      for (const slot of state.slots.slice(0, state.count)) {
        expect(slot.durationText).not.toBe('1d');
        expect(INTERNAL_MARKER_IDS).not.toContain(slot.key);
      }
    }
  });
});
