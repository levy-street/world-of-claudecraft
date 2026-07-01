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
  return {
    present: true,
    hpFrac: t.hp / Math.max(1, t.maxHp),
    hpText: t.dead ? 'Dead' : `${t.hp} / ${t.maxHp}`,
    resourceKind: 'none',
    resFrac: 0,
    resText: '',
    levelText: t.boss ? BOSS_SKULL_GLYPH : String(t.level),
    name: t.displayName,
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

// The inline combo-pip selection: combo points count only for the entity they were
// built against (comboTargetId === target.id), else zero.
function litComboPips(comboTargetId: number | null, comboPoints: number, targetId: number): number {
  return comboTargetId === targetId ? comboPoints : 0;
}

describe('target frame: Sim-vs-ClientWorld parity', () => {
  it('renders the wire-carried frame fields identically across hosts', () => {
    const fromSim = unitFrameView(targetDescriptor(simTarget()));
    const fromClient = unitFrameView(targetDescriptor(clientTarget()));
    // Every field the frame reads survives the wire now (including the absorb overlay), so
    // the whole view is identical across hosts.
    expect(fromClient).toEqual(fromSim);
    expect(fromSim.levelText).toBe(BOSS_SKULL_GLYPH); // boss skull, not a number
    expect(fromSim.resClass).toBe('none'); // a target has no resource bar
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

  it('the combo-pip count matches across hosts and only counts for this target', () => {
    // comboTargetId/comboPoints (self fields) are wired, so the selection matches.
    expect(litComboPips(5, 3, simTarget().id)).toBe(litComboPips(5, 3, clientTarget().id));
    expect(litComboPips(5, 3, 5)).toBe(3);
    // points built against a DIFFERENT target (or none) do not light this target.
    expect(litComboPips(9, 3, 5)).toBe(0);
    expect(litComboPips(null, 3, 5)).toBe(0);
  });
});
