// ClientWorld-vs-Sim parity for the target frame. The target frame is
// an INSTANCE of the unit_frame family: it adds no new core, so this drives
// the PURE cores the target instance depends on (unitFrameView for the frame,
// castBarState for the cast bar) plus the inline combo-pip selection with BOTH a
// Sim-shaped and a faithfully ClientWorld-mirror-shaped target entity.
//
// The mirror is faithful to src/net/online.ts: the wire (server/game.ts WireAura) now
// carries the aura magnitude and school, so ClientWorld reconstructs the absorb aura with
// its real `value` (and non-physical school). The absorb SHIELD overlay therefore derives
// ONLINE exactly as offline; there is no longer a target-frame divergence. This test asserts:
//   - the wire-carried frame fields (hp/level/name/resource) render identically,
//   - the absorb shield fraction matches across hosts (the value is wired now),
//   - the cast bar (remaining/fill/label) and the combo-pip count match across hosts,
// so a field the target frame reads renders identically online and offline.

import { describe, expect, it } from 'vitest';
import { castBarState } from '../src/render/cast_bar';
import type { Aura, Entity } from '../src/sim/types';
import { titledNameDecoration } from '../src/ui/deed_i18n';
import { type UnitFrameDescriptor, unitFrameView } from '../src/ui/unit_frame';

const BOSS_SKULL_GLYPH = '☠';

function shield(value: number): Aura {
  return {
    id: 'power_word_shield',
    name: 'Power Word: Shield',
    kind: 'absorb',
    remaining: 30,
    duration: 30,
    value,
    sourceId: 1,
    school: 'holy',
  };
}

// The gameplay fields the target frame reads. The Sim entity carries the live values;
// the ClientWorld mirror carries the same fields EXCEPT the absorb aura value (zeroed).
interface TargetState {
  id: number;
  kind: Entity['kind'];
  hp: number;
  maxHp: number;
  level: number;
  dead: boolean;
  boss: boolean;
  hostile: boolean;
  displayName: string;
  auras: Aura[];
  castingAbility: string;
  castTotal: number;
  castRemaining: number;
  channeling: boolean;
  resourceType: 'mana' | 'rage' | 'energy' | null;
  resource: number;
  maxResource: number;
  // Book of Deeds display title: a deed id on the identity wire (players
  // only; null/absent for mobs, and online.ts mirrors it verbatim).
  title: string | null;
}

const GAMEPLAY: TargetState = {
  id: 5,
  kind: 'mob',
  hp: 420,
  maxHp: 600,
  level: 62,
  dead: false,
  boss: true,
  hostile: true,
  displayName: 'Nythraxis',
  auras: [shield(90)],
  castingAbility: 'deathless_rage',
  castTotal: 4,
  castRemaining: 1.5,
  channeling: false,
  // The wire now carries rtype/res/mres for any entity that HAS a resource
  // (server/game.ts dynamicFields; online.ts decodes them), so the target's
  // power bar derives identically across hosts. Nythraxis is a caster.
  resourceType: 'mana',
  resource: 350,
  maxResource: 500,
  title: null,
};

// Build a Sim-shaped entity: the offline core's live fields plus Sim-only extras
// (world position, threat) the derivations must not read.
function simTarget(over: Partial<TargetState> = {}): Entity {
  const s = { ...GAMEPLAY, ...over };
  return {
    ...s,
    pos: { x: 12, z: 34 },
    vel: { x: 0, z: 0 },
    threat: new Map(),
  } as unknown as Entity;
}

// Build a ClientWorld-mirror-shaped entity, FAITHFUL to src/net/online.ts: same gameplay
// fields, the aura magnitude/school now survive the wire (so the absorb value is preserved,
// not zeroed), and the mirror carries its own net-bookkeeping extras the derivations ignore.
function clientTarget(over: Partial<TargetState> = {}): Entity {
  const s = { ...GAMEPLAY, ...over };
  return {
    ...s,
    netUpdatedAtTick: 9821,
    interpAlpha: 0.5,
    lastWireSeq: 77,
  } as unknown as Entity;
}

// Mirror the hud target call-site descriptor mapping (no behavior of its own; the
// point is that BOTH hosts feed the SAME mapping and the wired fields land identically).
function targetDescriptor(e: Entity): UnitFrameDescriptor {
  const t = e as unknown as TargetState;
  const titleDecoration = titledNameDecoration(t.title ?? null);
  return {
    present: true,
    hpFrac: t.hp / Math.max(1, t.maxHp),
    hpText: t.dead ? 'Dead' : `${t.hp} / ${t.maxHp}`,
    resourceKind: t.dead || !t.resourceType ? 'none' : t.resourceType,
    resFrac: t.dead || !t.resourceType ? 0 : t.resource / Math.max(1, t.maxResource),
    resText: t.dead || !t.resourceType ? '' : `${Math.round(t.resource)} / ${t.maxResource}`,
    levelText: t.boss ? BOSS_SKULL_GLYPH : String(t.level),
    name: t.displayName,
    titlePre: titleDecoration.pre,
    titlePost: titleDecoration.post,
    portraitKey: String(t.id),
    absorb: t.dead ? null : { hp: t.hp, maxHp: t.maxHp, auras: t.auras },
    dead: false,
    outOfRange: false,
  };
}

// The hostile/friendly name color the call site writes via setStyleProp; a pure
// function of the wire-mirrored `hostile` field (so it is parity-safe by construction).
function targetNameColor(e: Entity): string {
  return (e as unknown as TargetState).hostile ? 'var(--color-hostile)' : 'var(--color-friendly)';
}

// Combo points are character-bound (retail-style): the pips moved to the PLAYER
// frame and light straight from the wire-mirrored `comboPoints` self field, so
// there is no per-target pip selection left in the target frame to diverge.

describe('target frame: Sim-vs-ClientWorld parity', () => {
  it('renders the wire-carried frame fields identically across hosts', () => {
    const fromSim = unitFrameView(targetDescriptor(simTarget()));
    const fromClient = unitFrameView(targetDescriptor(clientTarget()));
    // Every field the frame reads survives the wire now (including the absorb overlay), so
    // the whole view is identical across hosts.
    expect(fromClient).toEqual(fromSim);
    expect(fromSim.levelText).toBe(BOSS_SKULL_GLYPH); // boss skull, not a number
    expect(fromSim.resClass).toBe('mana'); // a caster target shows its power bar
    expect(fromSim.resText).toBe('350 / 500');
    // A resource-less beast (rtype null) turns every type class off: the bar hides.
    expect(
      unitFrameView(targetDescriptor(simTarget({ resourceType: null, resource: 0 }))).resClass,
    ).toBe('none');
    // the hostile name color is a pure function of the mirrored `hostile` field:
    expect(targetNameColor(simTarget())).toBe(targetNameColor(clientTarget()));
    expect(targetNameColor(simTarget())).toBe('var(--color-hostile)');
  });

  it('renders the absorb shield identically across hosts (the value is wired now)', () => {
    // The wire carries the absorb value (server/game.ts) and online.ts decodes it, so the
    // shield segment derives online exactly as offline: no target-frame divergence.
    const fromSim = unitFrameView(targetDescriptor(simTarget()));
    const fromClient = unitFrameView(targetDescriptor(clientTarget()));
    expect(fromSim.absorbFrac).toBeCloseTo((420 + 90) / 600); // 0.85, the shield...
    expect(fromClient.absorbFrac).toBeCloseTo((420 + 90) / 600); // ...identical online
  });

  it('a dead target renders identically across hosts (no shield, hidden cast)', () => {
    // A dead target passes absorb:null on both hosts, so the absorb does NOT diverge.
    const fromSim = unitFrameView(targetDescriptor(simTarget({ dead: true, hp: 0 })));
    const fromClient = unitFrameView(targetDescriptor(clientTarget({ dead: true, hp: 0 })));
    expect(fromSim).toEqual(fromClient);
    expect(fromSim.absorbFrac).toBe(0);
    // castBarState hides for a dead unit on both hosts.
    expect(castBarState(simTarget({ dead: true }))).toEqual(
      castBarState(clientTarget({ dead: true })),
    );
    expect(castBarState(simTarget({ dead: true })).visible).toBe(false);
  });

  it('a titled player target renders the same decoration across hosts; untitled stays empty', () => {
    // The title rides the identity wire as a deed id (only when non-null);
    // both hosts resolve the SAME pattern-key decoration client-side.
    const over: Partial<TargetState> = {
      kind: 'player',
      boss: false,
      hostile: false,
      displayName: 'Hilda',
      title: 'prog_veteran',
    };
    const fromSim = unitFrameView(targetDescriptor(simTarget(over)));
    const fromClient = unitFrameView(targetDescriptor(clientTarget(over)));
    expect(fromClient).toEqual(fromSim);
    expect(fromSim.titlePre).toBe('');
    expect(fromSim.titlePost).toBe(' [Veteran]');
    // Untitled (every mob, and a player with no selection): both decorations empty.
    const plain = unitFrameView(targetDescriptor(simTarget()));
    expect(plain.titlePre).toBe('');
    expect(plain.titlePost).toBe('');
    // A stale/content-drifted id degrades to untitled on both hosts, never text.
    const stale = { ...over, title: 'removed_deed' };
    expect(unitFrameView(targetDescriptor(simTarget(stale))).titlePost).toBe('');
    expect(unitFrameView(targetDescriptor(clientTarget(stale))).titlePost).toBe('');
  });

  it('the target cast bar (remaining + fill + label) matches across hosts', () => {
    // castingAbility/castTotal/castRemaining/channeling ARE wired, so the cast bar is
    // identical across hosts (the cast path is independent of the aura magnitude).
    const fromSim = castBarState(simTarget());
    const fromClient = castBarState(clientTarget());
    expect(fromSim).toEqual(fromClient);
    expect(fromSim.visible).toBe(true);
    expect(fromSim.label).toBe('deathless_rage'); // target shows the raw id
    // hardcast fill = 1 - remaining/total = 1 - 1.5/4 = 0.625; same on both hosts.
    expect(fromSim.fill).toBeCloseTo(0.625);
    expect(simTarget().castRemaining).toBe(clientTarget().castRemaining);
  });
});
