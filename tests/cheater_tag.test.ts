// @vitest-environment happy-dom

// The player-visible "< Cheater >" tag: the shared label core (src/ui/cheater_tag.ts)
// and BOTH surfaces that render it, the overhead nameplate and the HUD target
// frame. The two are pinned together on purpose: a tag that appears over a
// player's head but not on the frame you clicked them with reads as a client bug
// rather than as a sanction, and that drift is exactly what discord_role_tag.ts
// exists to prevent for its own tag.
//
// The wire mirror and the countdown debuff live in tests/cheater_mark_client.test.ts.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NameplateCanvasState } from '../src/render/nameplate_canvas';
import { NameplatePainter } from '../src/render/nameplate_painter';
import type { EntityView } from '../src/render/renderer';
import type { Entity } from '../src/sim/types';
import { CHEATER_TAG_KEY, cheaterTagLabel } from '../src/ui/cheater_tag';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import type { PainterHostWriters } from '../src/ui/painter_host';
import { type UnitFrameDescriptor, unitFrameView } from '../src/ui/unit_frame';
import { type UnitFrameElements, UnitFramePainter } from '../src/ui/unit_frame_painter';
import type { IWorld } from '../src/world_api';

const VIEWPORT = { width: 1280, height: 720 };
// The five non-Latin locales the M16 rule requires a wordy new English value to
// ship fills for in the same change.
const NON_LATIN = ['zh_CN', 'zh_TW', 'ja_JP', 'ko_KR', 'ru_RU'] as const;

// --- the shared label core -------------------------------------------------

describe('cheaterTagLabel', () => {
  it('brands a marked PLAYER and nobody else', () => {
    setLanguage('en');
    const english = t(CHEATER_TAG_KEY);
    expect(english).toBe('< Cheater >');

    expect(cheaterTagLabel({ kind: 'player', cheaterMark: true })).toBe(english);
    // Every non-branding arm, one per dimension: unmarked, explicitly false,
    // absent subject, and a NON-player carrying the flag. The last one is the
    // load-bearing case: `chm` is an account sanction, so a regressed or hostile
    // server that stamps it on a mob must brand nothing rather than put a
    // moderation verdict over a wolf's head where no operator can lift it.
    expect(cheaterTagLabel({ kind: 'player' })).toBe('');
    expect(cheaterTagLabel({ kind: 'player', cheaterMark: false })).toBe('');
    expect(cheaterTagLabel({ kind: 'mob', cheaterMark: true })).toBe('');
    expect(cheaterTagLabel({ kind: 'npc', cheaterMark: true })).toBe('');
    expect(cheaterTagLabel(null)).toBe('');
    expect(cheaterTagLabel(undefined)).toBe('');
  });

  it('resolves the tag through the catalog in every non-Latin locale (M16)', async () => {
    setLanguage('en');
    const english = t(CHEATER_TAG_KEY);
    for (const lang of NON_LATIN) {
      await ensureLocaleLoaded(lang);
      setLanguage(lang);
      const localized = cheaterTagLabel({ kind: 'player', cheaterMark: true });
      expect(localized, `${lang} still shows the English tag`).not.toBe(english);
      expect(localized, `${lang} resolved nothing`).not.toBe('');
    }
    setLanguage('en');
  });
});

// --- surface 1: the overhead nameplate -------------------------------------

function fakeContext(): CanvasRenderingContext2D {
  const noop = vi.fn();
  return {
    setTransform: noop,
    scale: noop,
    translate: noop,
    clearRect: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    rect: noop,
    clip: noop,
    fill: noop,
    stroke: noop,
    drawImage: noop,
    fillText: noop,
    strokeText: noop,
    measureText: (text: string) => ({
      width: text.length * 7,
      actualBoundingBoxLeft: (text.length * 7) / 2,
      actualBoundingBoxRight: (text.length * 7) / 2,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 3,
    }),
  } as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext());
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,raid');
});

function entity(over: Partial<Entity> & { id: number }): Entity {
  return {
    kind: 'player',
    name: 'Suspect',
    templateId: 'warrior',
    pos: { x: 0, y: 0, z: 0 },
    scale: 1,
    level: 10,
    hp: 100,
    maxHp: 100,
    dead: false,
    lootable: false,
    hostile: false,
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
    ...over,
  } as unknown as Entity;
}

function view(): EntityView {
  const group = new THREE.Group();
  group.position.set(0, 0, 0);
  return { group, height: 2, mountLift: 0 } as EntityView;
}

interface PainterStateAccess {
  states: Map<number, NameplateCanvasState>;
}

function stateOf(painter: NameplatePainter, id: number): NameplateCanvasState {
  const state = (painter as unknown as PainterStateAccess).states.get(id);
  if (!state) throw new Error(`Missing nameplate state for ${id}`);
  return state;
}

function nameplateHarness(targets: Entity[]): NameplatePainter {
  const me = entity({ id: 1, name: 'Me', pos: { x: 0, y: 0, z: 3 } as Entity['pos'] });
  const views = new Map<number, EntityView>();
  for (const target of targets) views.set(target.id, view());
  const camera = new THREE.PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, 0.1, 500);
  camera.position.set(0, 3, 12);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld(true);
  const entities = new Map<number, Entity>([[me.id, me]]);
  for (const target of targets) entities.set(target.id, target);
  const world = {
    player: me,
    entities,
    markerFor: () => null,
    questState: () => 'available',
  } as unknown as IWorld;
  return new NameplatePainter({
    views,
    camera,
    world,
    layer: document.createElement('div'),
    getViewport: () => VIEWPORT,
    getDevicePixelRatio: () => 1,
    showNameplates: () => true,
    showDevBadges: () => true,
    showOwnNameplate: () => false,
    showPlayerNameplates: () => true,
    isHostilePlayer: () => false,
  });
}

describe('the Cheater tag on the overhead nameplate', () => {
  it('follows a live mark on and off without disturbing the AI chip or the title', () => {
    setLanguage('en');
    const target = entity({ id: 2, title: 'prog_veteran', aiAccount: true });
    const painter = nameplateHarness([target]);
    painter.update(true);
    const state = stateOf(painter, 2);
    expect(state.cheaterLabel).toBe('');
    const titleBefore = state.title;
    expect(titleBefore).not.toBe('');

    target.cheaterMark = true;
    painter.update(true);
    expect(state.cheaterLabel).toBe(t(CHEATER_TAG_KEY));
    // The three name-line decorations are independent: branding a player must
    // neither consume nor clobber their AI chip or their chosen title.
    expect(state.aiLabel).toBe('[AI]');
    expect(state.title).toBe(titleBefore);

    // The lift path.
    target.cheaterMark = false;
    painter.update(true);
    expect(state.cheaterLabel).toBe('');
  });

  it('clears a branded plate when the entity id is reused by a non-player', () => {
    // The reset arm specifically: resolveContent's top-of-method reset is the
    // ONLY thing that clears the label for an entity that no longer reaches the
    // player branch (a mob/npc/object returns early). Without it, the retained
    // per-id state leaks a moderation verdict onto whatever reuses that id.
    setLanguage('en');
    const target = entity({ id: 2, cheaterMark: true });
    const painter = nameplateHarness([target]);
    painter.update(true);
    const state = stateOf(painter, 2);
    expect(state.cheaterLabel).toBe(t(CHEATER_TAG_KEY));

    const reused = target as unknown as { kind: string; templateId: string; hostile: boolean };
    reused.kind = 'mob';
    reused.templateId = 'wolf';
    reused.hostile = true;
    painter.update(true);
    expect(state.cheaterLabel).toBe('');
  });

  it('never brands a mob, an NPC, or a world object plate', () => {
    setLanguage('en');
    const mob = entity({ id: 3, kind: 'mob', templateId: 'wolf', hostile: true });
    const npc = entity({ id: 4, kind: 'npc', templateId: 'marshal_redbrook' });
    const object = entity({ id: 5, kind: 'object', templateId: 'delve_locked_chest' });
    for (const e of [mob, npc, object]) (e as { cheaterMark?: boolean }).cheaterMark = true;
    const painter = nameplateHarness([mob, npc, object]);
    painter.update(true);
    for (const e of [mob, npc, object]) expect(stateOf(painter, e.id).cheaterLabel).toBe('');
  });
});

// --- surface 2: the HUD target frame ---------------------------------------

const FRAME = { tag: 'frame' } as unknown as HTMLElement;
const NAME = { tag: 'name' } as unknown as HTMLElement;
const LEVEL = { tag: 'level' } as unknown as HTMLElement;
const HP_FILL = { tag: 'hpFill' } as unknown as HTMLElement;
const CHEATER = { tag: 'cheaterTag' } as unknown as HTMLElement;
const TITLE_PRE = { tag: 'titlePre' } as unknown as HTMLElement;

const TARGET_ELEMENTS: UnitFrameElements = {
  frame: FRAME,
  name: NAME,
  level: LEVEL,
  hpFill: HP_FILL,
  cheaterTag: CHEATER,
  titlePre: TITLE_PRE,
};

function descriptor(over: Partial<UnitFrameDescriptor> = {}): UnitFrameDescriptor {
  return {
    present: true,
    hpFrac: 1,
    hpText: '100 / 100',
    resourceKind: 'none',
    resFrac: 0,
    resText: '',
    levelText: '10',
    name: 'Suspect',
    portraitKey: '2',
    absorb: null,
    dead: false,
    outOfRange: false,
    ...over,
  };
}

function recordingFacet() {
  const texts: Array<[HTMLElement, string]> = [];
  const noop = () => {};
  const writers: PainterHostWriters = {
    setText: (el, text) => {
      texts.push([el, text]);
    },
    setDisplay: noop,
    setTransform: noop,
    setWidth: noop,
    setStyleProp: noop,
    toggleClass: noop,
    setAttr: noop,
  };
  return { texts, writers };
}

describe('the Cheater tag on the HUD target frame', () => {
  it('passes the pre-localized tag through the core and defaults it to empty', () => {
    expect(unitFrameView(descriptor({ cheaterTag: '< Cheater >' })).cheaterTag).toBe('< Cheater >');
    // Absent on the descriptor (an instance with no tag surface) and the whole
    // hidden view both collapse to '', never to undefined: the painter writes
    // this string straight into a span.
    expect(unitFrameView(descriptor()).cheaterTag).toBe('');
    expect(unitFrameView(descriptor({ present: false })).cheaterTag).toBe('');
  });

  it('writes the tag into its OWN span through the elided writers', () => {
    const { texts, writers } = recordingFacet();
    const painter = new UnitFramePainter(writers, TARGET_ELEMENTS, { shownDisplay: 'flex' });

    painter.paint(unitFrameView(descriptor({ cheaterTag: '< Cheater >', titlePre: 'Veteran ' })));
    // Its own element, not folded into the title span: a sanction and a chosen
    // title must clear independently.
    expect(texts).toContainEqual([CHEATER, '< Cheater >']);
    expect(texts).toContainEqual([TITLE_PRE, 'Veteran ']);
    expect(texts).not.toContainEqual([TITLE_PRE, '< Cheater >']);

    texts.length = 0;
    painter.paint(unitFrameView(descriptor({ titlePre: 'Veteran ' })));
    expect(texts).toContainEqual([CHEATER, '']);
  });

  it('pays zero writes on an instance with no tag surface', () => {
    const { texts, writers } = recordingFacet();
    const bare: UnitFrameElements = { frame: FRAME, name: NAME, level: LEVEL, hpFill: HP_FILL };
    const painter = new UnitFramePainter(writers, bare, { shownDisplay: 'flex' });
    painter.paint(unitFrameView(descriptor({ cheaterTag: '< Cheater >' })));
    expect(texts.some(([el]) => el === CHEATER)).toBe(false);
  });
});

// --- the two surfaces stay one tag -----------------------------------------

// The rel arg must stay a VARIABLE under happy-dom (its web transform rewrites
// a literal new URL(..., import.meta.url) to an http URL readFileSync rejects).
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('both Cheater-tag surfaces resolve through the shared label', () => {
  // The drift this closes is silent: either surface could grow its own inline
  // t('hudChrome.nameplate.cheaterTag') and stay green, and then a change to the
  // player-gate or the key would move one surface and not the other. The same
  // source-pin idiom tests/nameplate_ai_tag.test.ts uses for the guild writer.

  it('neither surface reaches for the catalog key itself', () => {
    for (const rel of ['../src/render/nameplate_painter.ts', '../src/ui/hud.ts']) {
      const src = read(rel);
      expect(src, `${rel} must resolve the tag through cheaterTagLabel`).toContain(
        'cheaterTagLabel(',
      );
      expect(src, `${rel} inlines the tag key instead of using the shared label`).not.toContain(
        'nameplate.cheaterTag',
      );
    }
  });
});

describe('both Cheater-tag surfaces brand in the same red', () => {
  // The colour is duplicated by necessity: the overhead plate strokes it onto a
  // canvas from a TS style record, the target frame colours a span from a CSS
  // custom property, and neither host can read the other's value. What held them
  // together was a comment on each side, which no recolour has to obey. Pin the
  // equality instead, the idiom tests/ctx_menu_picker_sizing.test.ts uses for
  // --color-stat-bonus against QUALITY_COLOR.uncommon: a retheme now has to move
  // both literals or red here.
  const HEX = /#[0-9a-fA-F]{3,8}/;

  const captured = (source: string, re: RegExp, what: string): string => {
    const m = source.match(re);
    expect(m, `${what} not found`).not.toBeNull();
    return String(m?.[1]).toLowerCase();
  };

  it('pins the nameplate CHEATER_STYLE fill equal to the --color-cheater-tag token', () => {
    // Take the whole style record first, then its fill, so the pin survives a
    // field reorder inside the record and can never drift onto a NEIGHBOURING
    // style's fill (the block ends at the first line-initial `};`).
    const style = captured(
      read('../src/render/nameplate_canvas.ts'),
      /(const CHEATER_STYLE: TextSpriteStyle = \{[\s\S]*?\n\};)/,
      'the CHEATER_STYLE record in src/render/nameplate_canvas.ts',
    );
    const plate = captured(
      style,
      new RegExp(`fill: '(${HEX.source})'`),
      'CHEATER_STYLE.fill in src/render/nameplate_canvas.ts',
    );
    const token = captured(
      read('../src/styles/tokens.css'),
      new RegExp(`--color-cheater-tag:\\s*(${HEX.source})\\s*;`),
      '--color-cheater-tag in src/styles/tokens.css',
    );
    expect(plate, 'the plate and the frame must brand a player the same red').toBe(token);
  });

  it('colours the frame span FROM that token, so the equality is not vacuous', () => {
    // The other half of the pin: without it the frame side could grow a literal
    // of its own and the equality above would govern nothing it paints.
    const rule = read('../src/styles/hud.css').match(/\.uf-name \.uf-cheater\s*\{[^}]*\}/)?.[0];
    expect(rule, 'the .uf-name .uf-cheater rule is missing from src/styles/hud.css').toBeTruthy();
    expect(rule).toContain('var(--color-cheater-tag)');
    expect(rule, 'the frame tag reads the token, never a second literal').not.toMatch(HEX);
  });
});
