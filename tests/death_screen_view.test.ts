import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { handleDeath } from '../src/sim/combat/damage';
import { Sim } from '../src/sim/sim';
import { CORPSE_REZ_RANGE } from '../src/sim/spirit';
import type { Entity } from '../src/sim/types';
import {
  createDeathScreenInputHold,
  createDeathScreenView,
  DEATH_SCREEN_INPUT_HOLD_MS,
  type DeathScreenView,
  deathScreenInputReady,
  deathScreenViewInto,
  GHOST_CORPSE_REZ_RANGE,
  holdDeathScreenInput,
  noteReleaseOverlayShown,
} from '../src/ui/death_screen_view';
import { assertAllocationStable } from './util/alloc_probe';

type DeathFields = Pick<Entity, 'dead' | 'ghost' | 'pos' | 'corpsePos'>;

const at = (x: number, z: number, y = 0) => ({ x, y, z });

function deathScreenView(
  player: DeathFields,
  inArenaMatch: boolean,
  inBattlegroundMatch: boolean,
): DeathScreenView {
  return deathScreenViewInto(createDeathScreenView(), player, inArenaMatch, inBattlegroundMatch);
}

// The online mirror carries exactly these four fields (dead/ghost from the wire
// entity, corpsePos from the self snapshot), so a plain object is the ClientWorld shape.
function mirrored(fields: DeathFields): DeathFields {
  return {
    dead: fields.dead,
    ghost: fields.ghost,
    pos: { ...fields.pos },
    corpsePos: fields.corpsePos,
  };
}

describe('deathScreenView', () => {
  it('shows nothing while alive', () => {
    const view = deathScreenView(
      { dead: false, ghost: false, pos: at(0, 0), corpsePos: null },
      false,
      false,
    );
    expect(view).toEqual({
      spiritMode: false,
      releaseOverlay: false,
      ghostHint: false,
      ghostPrompt: false,
    });
  });

  it('shows the Release overlay on a fresh corpse, except in an arena match', () => {
    const corpse = { dead: true, ghost: false, pos: at(0, 0), corpsePos: null };
    expect(deathScreenView(corpse, false, false).releaseOverlay).toBe(true);
    expect(deathScreenView(corpse, false, true).releaseOverlay).toBe(true);
    expect(deathScreenView(corpse, true, false).releaseOverlay).toBe(false);
    expect(deathScreenView(corpse, false, false).spiritMode).toBe(false);
  });

  it('gives a ghost the hint line and the corpse prompt only within reach of its body', () => {
    const near = {
      dead: true,
      ghost: true,
      pos: at(GHOST_CORPSE_REZ_RANGE, 0),
      corpsePos: at(0, 0),
    };
    const far = { ...near, pos: at(GHOST_CORPSE_REZ_RANGE + 0.5, 0) };
    expect(deathScreenView(near, false, false)).toEqual({
      spiritMode: true,
      releaseOverlay: false,
      ghostHint: true,
      ghostPrompt: true,
    });
    expect(deathScreenView(far, false, false).ghostPrompt).toBe(false);
    expect(deathScreenView(far, false, false).ghostHint).toBe(true);
  });

  it('mirrors the sim corpse range and measures it on the ground plane', () => {
    expect(GHOST_CORPSE_REZ_RANGE).toBe(CORPSE_REZ_RANGE);
    const below = { dead: true, ghost: true, pos: at(0, 0, 40), corpsePos: at(0, 0, 0) };
    expect(deathScreenView(below, false, false).ghostPrompt).toBe(true);
  });

  it('shows the hint but no corpse prompt to a ghost whose corpse position has not arrived yet', () => {
    // Online, the ghost flag rides the wire entity while corpsePos rides the self
    // snapshot, so a ghost can briefly mirror with no corpse position.
    const ghost = { dead: true, ghost: true, pos: at(0, 0), corpsePos: null };
    expect(deathScreenView(ghost, false, false)).toEqual({
      spiritMode: true,
      releaseOverlay: false,
      ghostHint: true,
      ghostPrompt: false,
    });
  });

  it('keeps an arena ghost out of the Release overlay', () => {
    const ghost = { dead: true, ghost: true, pos: at(0, 0), corpsePos: at(0, 0) };
    expect(deathScreenView(ghost, true, false)).toEqual({
      spiritMode: true,
      releaseOverlay: false,
      ghostHint: true,
      ghostPrompt: true,
    });
  });

  it('rewrites one caller-owned view in place, frame after frame', () => {
    const view = createDeathScreenView();
    const corpse = { dead: true, ghost: false, pos: at(0, 0), corpsePos: null };
    expect(() =>
      assertAllocationStable(() => deathScreenViewInto(view, corpse, false, false)),
    ).not.toThrow();
    expect(deathScreenViewInto(view, corpse, false, false)).toBe(view);
    expect(view.releaseOverlay).toBe(true);
    deathScreenViewInto(view, { ...corpse, dead: false }, false, false);
    expect(view.releaseOverlay).toBe(false);
  });

  it('keeps a battleground ghost on the wave: greyscale, but no hint and no corpse prompt', () => {
    const ghost = { dead: true, ghost: true, pos: at(0, 0), corpsePos: at(0, 0) };
    expect(deathScreenView(ghost, false, true)).toEqual({
      spiritMode: true,
      releaseOverlay: false,
      ghostHint: false,
      ghostPrompt: false,
    });
  });

  it('reads an offline Sim player and its online mirror the same way through death, release and the corpse run', () => {
    const sim = new Sim({ seed: 7, playerClass: 'warrior', autoEquip: true });
    const p = sim.player;
    const both = () => [
      deathScreenView(p, false, false),
      deathScreenView(mirrored(p), false, false),
    ];

    for (const view of both()) expect(view.releaseOverlay).toBe(false);

    handleDeath(sim.ctx, p, null, null);
    for (const view of both()) {
      expect(view.releaseOverlay).toBe(true);
      expect(view.spiritMode).toBe(false);
    }

    sim.releaseSpirit();
    expect(p.corpsePos).toBeTruthy();
    for (const view of both()) {
      expect(view.releaseOverlay).toBe(false);
      expect(view.spiritMode).toBe(true);
      expect(view.ghostHint).toBe(true);
    }

    p.pos = { ...(p.corpsePos as Entity['pos']) };
    for (const view of both()) expect(view.ghostPrompt).toBe(true);
  });
});

describe('the Release input hold', () => {
  it('ignores presses until the hold has elapsed after the overlay opens', () => {
    const hold = createDeathScreenInputHold();
    expect(deathScreenInputReady(hold, 1000)).toBe(true);

    noteReleaseOverlayShown(hold, true, 1000);
    expect(deathScreenInputReady(hold, 1000)).toBe(false);
    expect(deathScreenInputReady(hold, 1000 + DEATH_SCREEN_INPUT_HOLD_MS - 1)).toBe(false);
    expect(deathScreenInputReady(hold, 1000 + DEATH_SCREEN_INPUT_HOLD_MS)).toBe(true);
  });

  it('starts the hold on the opening frame only, not on every frame the overlay stays up', () => {
    const hold = createDeathScreenInputHold();
    noteReleaseOverlayShown(hold, true, 1000);
    noteReleaseOverlayShown(hold, true, 1400);
    noteReleaseOverlayShown(hold, true, 1499);
    expect(deathScreenInputReady(hold, 1000 + DEATH_SCREEN_INPUT_HOLD_MS)).toBe(true);
  });

  it('holds again when the overlay closes and reopens', () => {
    const hold = createDeathScreenInputHold();
    noteReleaseOverlayShown(hold, true, 1000);
    noteReleaseOverlayShown(hold, false, 3000);
    noteReleaseOverlayShown(hold, true, 5000);
    expect(deathScreenInputReady(hold, 5000 + DEATH_SCREEN_INPUT_HOLD_MS - 1)).toBe(false);
    expect(deathScreenInputReady(hold, 5000 + DEATH_SCREEN_INPUT_HOLD_MS)).toBe(true);
  });

  it('holds again on a second death while the overlay never closed', () => {
    const hold = createDeathScreenInputHold();
    noteReleaseOverlayShown(hold, true, 1000);
    noteReleaseOverlayShown(hold, true, 4000);
    expect(deathScreenInputReady(hold, 4000)).toBe(true);

    holdDeathScreenInput(hold, 4000);
    expect(deathScreenInputReady(hold, 4000 + DEATH_SCREEN_INPUT_HOLD_MS - 1)).toBe(false);
    expect(deathScreenInputReady(hold, 4000 + DEATH_SCREEN_INPUT_HOLD_MS)).toBe(true);
  });

  it('keeps the later of the death and the opening when both happen', () => {
    const hold = createDeathScreenInputHold();
    holdDeathScreenInput(hold, 1000);
    noteReleaseOverlayShown(hold, true, 1080);
    expect(deathScreenInputReady(hold, 1000 + DEATH_SCREEN_INPUT_HOLD_MS)).toBe(false);
    expect(deathScreenInputReady(hold, 1080 + DEATH_SCREEN_INPUT_HOLD_MS)).toBe(true);

    const reversed = createDeathScreenInputHold();
    noteReleaseOverlayShown(reversed, true, 1000);
    holdDeathScreenInput(reversed, 1080);
    expect(deathScreenInputReady(reversed, 1000 + DEATH_SCREEN_INPUT_HOLD_MS)).toBe(false);
    expect(deathScreenInputReady(reversed, 1080 + DEATH_SCREEN_INPUT_HOLD_MS)).toBe(true);
  });
});

describe('the HUD wiring of the Release input hold', () => {
  const hudTs = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8').replace(
    /\s+/g,
    ' ',
  );

  it('checks the hold in the Release handler before releasing', () => {
    const handler = hudTs.slice(
      hudTs.indexOf('bindTouchTap(this.releaseSpiritBtnEl, () => {'),
      hudTs.indexOf('this.sim.releaseSpirit();'),
    );
    expect(handler).toContain(
      'if (!deathScreenInputReady(this.deathScreenInput, performance.now())) return;',
    );
  });

  it('starts the hold when the overlay opens and on every own death', () => {
    expect(hudTs).toContain(
      'noteReleaseOverlayShown(this.deathScreenInput, death.releaseOverlay, now);',
    );
    const deathCase = hudTs.slice(hudTs.indexOf("case 'playerDeath': {"));
    expect(deathCase.slice(0, deathCase.indexOf('break;'))).toContain(
      'holdDeathScreenInput(this.deathScreenInput, now);',
    );
  });
});
