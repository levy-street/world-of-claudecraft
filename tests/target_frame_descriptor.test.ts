// The target frame's descriptor fill (src/ui/target_frame_descriptor.ts), the
// per-paint entity -> unit_frame descriptor mapping MOVED out of hud.ts. Pins the
// byte-faithful mapping the inline block carried (hp/resource text + fractions,
// the classic empty resource rail, the "Dead" readout, title decoration, the
// Cheater tag, the player-gated deed border, the id-keyed portrait gate) plus the
// field this extraction added: the party raid marker the frame now shows.

import { beforeAll, describe, expect, it } from 'vitest';
import type { Entity } from '../src/sim/types';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import { fillTargetFrameDescriptor } from '../src/ui/target_frame_descriptor';
import { type UnitFrameDescriptor, unitFrameView } from '../src/ui/unit_frame';

function entity(over: Partial<Entity> & { id: number }): Entity {
  return {
    kind: 'mob',
    name: 'Thornpeak Ogre',
    templateId: 'ogre',
    pos: { x: 0, y: 0, z: 0 },
    scale: 1,
    level: 16,
    hp: 300,
    maxHp: 600,
    dead: false,
    lootable: false,
    hostile: true,
    ownerId: null,
    guild: '',
    auras: [],
    questIds: [],
    targetId: null,
    aggroTargetId: null,
    comboPoints: 0,
    comboTargetId: null,
    castingAbility: null,
    castTotal: 0,
    castRemaining: 0,
    channeling: false,
    resourceType: null,
    resource: 0,
    maxResource: 0,
    ...over,
  } as unknown as Entity;
}

function blank(): UnitFrameDescriptor {
  return {
    present: false,
    hpFrac: 0,
    hpText: '',
    resourceKind: 'none',
    resFrac: 0,
    resText: '',
    levelText: null,
    name: '',
    portraitKey: '',
    borderSlug: '',
    absorb: null,
    dead: false,
    outOfRange: false,
  };
}

const NO_TITLE = { pre: '', post: '' };

beforeAll(async () => {
  await ensureLocaleLoaded('en');
  setLanguage('en');
});

describe('fillTargetFrameDescriptor', () => {
  it('maps a live mob to the descriptor in place and returns the same object', () => {
    const d = blank();
    const out = fillTargetFrameDescriptor(d, entity({ id: 7 }), NO_TITLE, null);
    expect(out).toBe(d);
    expect(d.present).toBe(true);
    expect(d.hpFrac).toBeCloseTo(0.5);
    expect(d.hpText).toBe('300 / 600');
    expect(d.showAbsorbText).toBe(true);
    expect(d.levelText).toBe('16');
    expect(d.portraitKey).toBe('7');
    expect(d.dead).toBe(false);
    expect(d.outOfRange).toBe(false);
    expect(d.raidMarker).toBeNull();
  });

  it('carries the party raid marker so the frame shows the same symbol as the nameplate', () => {
    const d = fillTargetFrameDescriptor(blank(), entity({ id: 7 }), NO_TITLE, 0);
    expect(d.raidMarker).toBe(0);
    expect(unitFrameView(d).raidMarker).toBe(0);
    // Re-filling the SAME descriptor for an unmarked target clears the stale mark
    // (the descriptor is a reused per-frame buffer, never a fresh object).
    fillTargetFrameDescriptor(d, entity({ id: 7 }), NO_TITLE, null);
    expect(d.raidMarker).toBeNull();
    expect(unitFrameView(d).raidMarker).toBeNull();
  });

  it('maps a ClientWorld-mirror-shaped entity (absent optional fields) the same way', () => {
    // The online mirror leaves offline-only fields undefined rather than null
    // (no resourceType / resource / border / title on a plain mob), so the fill
    // must read through the same branches from either host's entity shape.
    const mirror = {
      id: 9,
      kind: 'mob',
      name: 'Thornpeak Ogre',
      templateId: 'ogre',
      pos: { x: 0, y: 0, z: 0 },
      level: 16,
      hp: 150,
      maxHp: 600,
      dead: false,
      hostile: true,
      ownerId: null,
      auras: [],
    } as unknown as Entity;
    const d = fillTargetFrameDescriptor(blank(), mirror, NO_TITLE, 2);
    expect(d.present).toBe(true);
    expect(d.hpFrac).toBeCloseTo(0.25);
    expect(d.hpText).toBe('150 / 600');
    expect(d.resourceKind).toBe('none');
    expect(d.resFrac).toBe(0);
    expect(d.resText).toBe('');
    expect(d.cheaterTag).toBe('');
    expect(d.borderSlug).toBe('');
    expect(d.portraitKey).toBe('9');
    expect(d.absorb).toBe(mirror);
    expect(d.raidMarker).toBe(2);
    expect(unitFrameView(d).absorbFrac).toBeCloseTo(0.25);
  });

  it('renders the classic EMPTY resource rail for a resource-less target', () => {
    const d = fillTargetFrameDescriptor(blank(), entity({ id: 1 }), NO_TITLE, null);
    expect(d.resourceKind).toBe('none');
    expect(d.resFrac).toBe(0);
    expect(d.resText).toBe('');
  });

  it("shows a caster target's power bar with rounded text", () => {
    const d = fillTargetFrameDescriptor(
      blank(),
      entity({ id: 1, resourceType: 'mana', resource: 79.6, maxResource: 100 }),
      NO_TITLE,
      null,
    );
    expect(d.resourceKind).toBe('mana');
    expect(d.resFrac).toBeCloseTo(0.796);
    expect(d.resText).toBe('80 / 100');
  });

  it('reads Dead with no absorb, no absorb text, and an empty rail for a dead target', () => {
    const d = fillTargetFrameDescriptor(
      blank(),
      entity({ id: 1, dead: true, hp: 0, resourceType: 'mana', resource: 50, maxResource: 100 }),
      NO_TITLE,
      3,
    );
    expect(d.hpText).toBe(t('hud.core.dead'));
    expect(d.showAbsorbText).toBe(false);
    expect(d.absorb).toBeNull();
    expect(d.resourceKind).toBe('none');
    expect(d.resText).toBe('');
    // The marker itself still rides through: the sim clears a dead mob's mark,
    // the fill never second-guesses the seam.
    expect(d.raidMarker).toBe(3);
  });

  it('passes the caller-memoized title decoration through verbatim', () => {
    const d = fillTargetFrameDescriptor(
      blank(),
      entity({ id: 1, kind: 'player' }),
      { pre: 'Sir ', post: '' },
      null,
    );
    expect(d.titlePre).toBe('Sir ');
    expect(d.titlePost).toBe('');
  });

  it('brands only a marked PLAYER with the Cheater tag', () => {
    const marked = fillTargetFrameDescriptor(
      blank(),
      entity({ id: 1, kind: 'player', cheaterMark: true } as Partial<Entity> & { id: number }),
      NO_TITLE,
      null,
    );
    expect(marked.cheaterTag).not.toBe('');
    const mob = fillTargetFrameDescriptor(
      blank(),
      entity({ id: 2, cheaterMark: true } as Partial<Entity> & { id: number }),
      NO_TITLE,
      null,
    );
    expect(mob.cheaterTag).toBe('');
  });

  it('gates the Book of Deeds border on the player kind', () => {
    const player = fillTargetFrameDescriptor(
      blank(),
      entity({ id: 1, kind: 'player', border: 'col_discovery_250' } as Partial<Entity> & {
        id: number;
      }),
      NO_TITLE,
      null,
    );
    expect(player.borderSlug).not.toBe('');
    const mob = fillTargetFrameDescriptor(
      blank(),
      entity({ id: 2, border: 'col_discovery_250' } as Partial<Entity> & { id: number }),
      NO_TITLE,
      null,
    );
    expect(mob.borderSlug).toBe('');
  });
});
