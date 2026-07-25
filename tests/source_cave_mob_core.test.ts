// Source Cave contributor-mob display resolution (src/ui/source_cave_mob_core.ts):
// the shared detection condition the target frame (hud.ts) gates its
// verbatim-name/rank branch on, plus a real end-to-end proof that a
// hostile-looking GitHub login renders in the target frame as inert text,
// never interpreted as markup.

import { describe, expect, it } from 'vitest';
import { sourceCaveMobRankForTemplate } from '../src/sim/source_cave';
import { sourceCaveOrigin } from '../src/sim/source_cave/runtime';
import type { Entity } from '../src/sim/types';
import { makeWriterFacet } from '../src/ui/painter_host';
import { isSourceCaveMobEntity, sourceCaveMobRank } from '../src/ui/source_cave_mob_core';
import { type UnitFrameDescriptor, unitFrameView } from '../src/ui/unit_frame';
import { type UnitFrameElements, UnitFramePainter } from '../src/ui/unit_frame_painter';
import type { IWorld } from '../src/world_api';
import type { SourceCaveInfo } from '../src/world_api/dungeons';

// A real in-band x (slot 0's instance origin), so isSourceCavePos is exercised
// against the actual reserved delve sub-band, not a hand-picked magic number.
const CAVE_X = sourceCaveOrigin(0).x;

function mob(over: Partial<Entity> = {}): Entity {
  return {
    id: 5,
    kind: 'mob',
    templateId: 'source_cave_someone',
    name: 'someone',
    level: 22,
    ownerId: null,
    pos: { x: CAVE_X, y: 0, z: 0 },
    ...over,
  } as unknown as Entity;
}

function worldWithRoster(mobs: SourceCaveInfo['mobs']): IWorld {
  const info: SourceCaveInfo = {
    moduleCount: 1,
    modules: ['reliquary_finale'],
    mobs,
    totalMobs: mobs.length,
    killed: 0,
    cleared: false,
    sealState: 'idle',
    playersInsideSeal: 0,
    playersInInstance: 0,
    activeWave: 0,
    totalWaves: 0,
  };
  return { sourceCaveInfo: () => info } as unknown as IWorld;
}

describe('isSourceCaveMobEntity', () => {
  it('is true for a mob standing in the reserved cave delve sub-band', () => {
    expect(isSourceCaveMobEntity(mob())).toBe(true);
  });

  it('is false for a mob elsewhere in the world (including a real delve)', () => {
    expect(isSourceCaveMobEntity(mob({ pos: { x: 0, y: 0, z: 0 } }))).toBe(false);
    expect(isSourceCaveMobEntity(mob({ pos: { x: 4800, y: 0, z: 0 } }))).toBe(false); // real delve 0
  });

  it('is false for a non-mob entity even at a cave x (players/npcs never verbatim)', () => {
    expect(isSourceCaveMobEntity(mob({ kind: 'player' }))).toBe(false);
    expect(isSourceCaveMobEntity(mob({ kind: 'npc' }))).toBe(false);
  });

  it('is false for an owned pet standing in the cave x-band (pets are never contributor mobs)', () => {
    expect(isSourceCaveMobEntity(mob({ ownerId: 7 }))).toBe(false);
  });
});

describe('sourceCaveMobRank', () => {
  it('reads elite/boss from the roster projection, correlated by template login', () => {
    const roster: SourceCaveInfo['mobs'] = [
      { login: 'someone', elite: false, boss: true, combatant: true },
      { login: 'another', elite: true, boss: false, combatant: true },
    ];
    const world = worldWithRoster(roster);
    expect(sourceCaveMobRankForTemplate('source_cave_someone', roster)).toEqual({
      elite: false,
      boss: true,
    });
    expect(
      sourceCaveMobRank(mob({ templateId: 'source_cave_someone', name: 'Custom One' }), world),
    ).toEqual({
      elite: false,
      boss: true,
    });
    expect(
      sourceCaveMobRank(mob({ templateId: 'source_cave_another', name: 'Custom Two' }), world),
    ).toEqual({
      elite: true,
      boss: false,
    });
  });

  it('caches immutable rank data per world instead of rebuilding it every target-frame update', () => {
    let reads = 0;
    const base = worldWithRoster([{ login: 'someone', elite: true, boss: false, combatant: true }]);
    const world = {
      sourceCaveInfo: () => {
        reads++;
        return base.sourceCaveInfo();
      },
    } as unknown as IWorld;
    const entity = mob();

    expect(sourceCaveMobRank(entity, world)).toEqual({ elite: true, boss: false });
    expect(sourceCaveMobRank(entity, world)).toEqual({ elite: true, boss: false });
    expect(reads).toBe(1);
  });

  it('reads as plain (non-elite, non-boss) when the roster has no matching login', () => {
    const world = worldWithRoster([
      { login: 'someone-else', elite: true, boss: true, combatant: true },
    ]);
    expect(sourceCaveMobRank(mob({ name: 'someone' }), world)).toEqual({
      elite: false,
      boss: false,
    });
  });

  it('reads as plain when the cave info itself is null (no throw)', () => {
    const world = { sourceCaveInfo: () => null } as unknown as IWorld;
    expect(sourceCaveMobRank(mob(), world)).toEqual({ elite: false, boss: false });
  });

  it('does not cache a null pre-boot projection before the roster arrives', () => {
    const roster = [{ login: 'someone', elite: true, boss: false, combatant: true }];
    let info: SourceCaveInfo | null = null;
    let reads = 0;
    const world = {
      sourceCaveInfo: () => {
        reads++;
        return info;
      },
    } as unknown as IWorld;
    const entity = mob();

    expect(sourceCaveMobRank(entity, world)).toEqual({ elite: false, boss: false });
    info = worldWithRoster(roster).sourceCaveInfo();
    expect(sourceCaveMobRank(entity, world)).toEqual({ elite: true, boss: false });
    expect(sourceCaveMobRank(entity, world)).toEqual({ elite: true, boss: false });
    expect(reads).toBe(2);
  });
});

// A minimal, hand-rolled DOM element (tests/CLAUDE.md: no jsdom): models exactly
// the .textContent / .style / .innerHTML contract the real writer facet and the
// browser both honor, so this is a genuine proof of DOM-safety, not a mock of it.
// Setting .textContent NEVER parses its argument as markup; reading .innerHTML
// back reflects the escaped entities a real browser would produce, so an actual
// <script>/<img> tag structure never exists in the tree.
class FakeElement {
  style: Record<string, string> = {};
  classList = { toggle: (_cls: string, _on?: boolean): void => {} };
  private text = '';
  get textContent(): string {
    return this.text;
  }
  set textContent(v: string) {
    this.text = v;
  }
  get innerHTML(): string {
    return this.text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

function fakeEl(): HTMLElement {
  return new FakeElement() as unknown as HTMLElement;
}

describe('target frame: a hostile-looking cave-mob login renders as inert text', () => {
  it('paints the verbatim login as textContent, never as parsed markup', () => {
    // A GitHub login is normally alnum/hyphen, but the target frame must stay
    // safe even for an adversarial value (defense in depth, not a login-format
    // assumption): angle brackets AND a quote, the classic injection probe.
    const hostileLogin = `<img src=x onerror=alert(1)>"><script>alert(2)</script>`;
    const target = mob({ name: hostileLogin });
    expect(isSourceCaveMobEntity(target)).toBe(true);

    const nameEl = new FakeElement();
    const elements: UnitFrameElements = {
      frame: fakeEl(),
      level: fakeEl(),
      hpFill: fakeEl(),
      hpText: fakeEl(),
      absorb: fakeEl(),
      name: nameEl as unknown as HTMLElement,
      resource: { container: fakeEl(), fill: fakeEl(), text: fakeEl() },
    };
    const writers = makeWriterFacet(
      new Map(),
      new Map(),
      new Map(),
      new Map(),
      () => {},
      () => {},
    );
    const painter = new UnitFramePainter(writers, elements, {
      shownDisplay: 'flex',
      stateClasses: true,
    });
    const desc: UnitFrameDescriptor = {
      present: true,
      hpFrac: 1,
      hpText: '100 / 100',
      resourceKind: 'none',
      resFrac: 0,
      resText: '',
      levelText: String(target.level),
      // This is exactly what hud.ts's entityDisplayName/verbatim branch feeds
      // unitFrameView for a cave mob target: the raw entity.name, untouched.
      name: target.name,
      portraitKey: String(target.id),
      absorb: null,
      dead: false,
      outOfRange: false,
    };
    painter.paint(unitFrameView(desc));

    // The exact raw string survived, byte for byte (no stripping/escaping in JS-land).
    expect(nameEl.textContent).toBe(hostileLogin);
    // And it was NEVER interpreted as markup: reading it back as HTML shows only
    // escaped entities, never a real <script>/<img> tag.
    expect(nameEl.innerHTML).not.toContain('<script>');
    expect(nameEl.innerHTML).not.toContain('<img');
    expect(nameEl.innerHTML).toContain('&lt;script&gt;');
    expect(nameEl.innerHTML).toContain('&lt;img');
  });
});
