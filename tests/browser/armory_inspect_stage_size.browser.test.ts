import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import type { PreviewAppearance } from '../../src/render/characters/preview_appearance';
import { MOUNT_SKIN_IDS } from '../../src/sim/content/mount_skins';
import { WEAPON_SKIN_LIST } from '../../src/sim/content/weapon_skins';
import { ArmoryInspect, armoryPreviewParkingSize } from '../../src/ui/armory_inspect';
import { MountInspect } from '../../src/ui/mount_inspect_controller';
import { mountInspectRow } from '../../src/ui/mount_inspect_view';
import type { ArmorySkinRow } from '../../src/ui/woc_store_view';
import { cleanup } from './_harness';

// The inspect stage (.armory-inspect-stage, shared by the store Armory and the
// mount-skin inspect panel) must not take its size from its preview canvas.
// Both previews (src/render/armory_preview.ts, src/render/mount_preview.ts)
// size their drawing buffer from the stage's client box (setSize(w, h, false)
// writes width/height attributes of w*dpr x h*dpr) on every ResizeObserver
// tick that changes it. The stage sits in an auto grid row over only a
// min-height floor, so an in-flow canvas lets that buffer feed back into the
// row on any pixel ratio above 1. The overlays mount on <body>, outside the
// #ui zoom, so the UI Scale must not matter either.

// The GL previews are stubbed: this pins the CSS box, not the renderer. The
// try-on body counts as resident, so the Armory mounts its stage on the first
// open instead of waiting for the streamed character assets.
const handle = {
  setActive: () => undefined,
  setAppearance: () => undefined,
  setSkin: () => undefined,
  setMount: () => undefined,
  setMode: () => undefined,
  setScene: () => undefined,
  dispose: () => undefined,
};
vi.mock('../../src/render/armory_preview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/render/armory_preview')>()),
  armoryPreviewReady: () => true,
  createArmoryPreview: () => handle,
}));
vi.mock('../../src/render/mount_preview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/render/mount_preview')>()),
  createMountPreview: () => handle,
}));

const APPEARANCE: PreviewAppearance = {
  cls: 'warrior',
  skin: 0,
  skinCatalog: 'class',
  mainhandItemId: 'worn_sword',
  offhandItemId: null,
  weaponSkinId: null,
};

const opened: { close(): void }[] = [];

afterEach(() => {
  for (const panel of opened.splice(0)) panel.close();
  cleanup();
  document.body.className = '';
  for (const prop of ['--ui-scale', '--app-vw', '--app-vh']) {
    document.documentElement.style.removeProperty(prop);
  }
});

function setViewportVars(uiScale: number): void {
  const style = document.documentElement.style;
  style.setProperty('--ui-scale', String(uiScale));
  style.setProperty('--app-vw', `${window.innerWidth}px`);
  style.setProperty('--app-vh', `${window.innerHeight}px`);
}

function openArmory(): void {
  const skin = WEAPON_SKIN_LIST[0];
  const row: ArmorySkinRow = {
    skin,
    art: '',
    costClaudium: 500,
    purchasable: true,
    owned: false,
    applied: false,
    canApplyNow: false,
    affordable: true,
    shortfall: null,
    eligibleClasses: ['warrior'],
  };
  const inspect = new ArmoryInspect({
    appearance: () => APPEARANCE,
    requestBuy: () => undefined,
    applySkin: () => undefined,
    detachSkin: () => undefined,
  });
  inspect.open(row);
  opened.push({ close: () => inspect.destroy() });
}

function openMount(): void {
  const inspect = new MountInspect({
    appearance: () => APPEARANCE,
    row: (skinId) =>
      mountInspectRow(
        skinId,
        { costClaudium: 1200, purchasable: true, owned: false },
        { ownedMountSkinIds: [], wornMountSkinId: null, ownsAnyMount: true },
      ),
    requestBuy: () => undefined,
    wear: () => undefined,
    takeOff: () => undefined,
  });
  inspect.open(MOUNT_SKIN_IDS[0]);
  opened.push(inspect);
}

function openStage(panel: 'armory' | 'mount'): { stage: HTMLElement; canvas: HTMLCanvasElement } {
  if (panel === 'armory') openArmory();
  else openMount();
  const stage = document.querySelector<HTMLElement>(
    '.armory-inspect-overlay .armory-inspect-stage',
  );
  const canvas = stage?.querySelector('canvas');
  if (!stage || !canvas) throw new Error(`${panel} inspect stage was not mounted`);
  return { stage, canvas };
}

// What the previews' resize does to the canvas at a given dpr.
function syncBuffer(stage: HTMLElement, canvas: HTMLCanvasElement, dpr: number): void {
  canvas.width = Math.floor(stage.clientWidth * dpr);
  canvas.height = Math.floor(stage.clientHeight * dpr);
}

describe('inspect stage sizing', () => {
  it.each([
    // Desktop.
    { panel: 'armory', width: 1280, height: 900, touch: false, uiScale: 1, dpr: 1 },
    { panel: 'armory', width: 1280, height: 900, touch: false, uiScale: 1.25, dpr: 2 },
    { panel: 'mount', width: 1280, height: 900, touch: false, uiScale: 1, dpr: 1.25 },
    { panel: 'mount', width: 1280, height: 900, touch: false, uiScale: 0.8, dpr: 2 },
    // Short desktop (the dialog max-height clamp).
    { panel: 'armory', width: 1280, height: 560, touch: false, uiScale: 1.1, dpr: 1.5 },
    // Landscape touch (a full-height dialog, no stage floor).
    { panel: 'armory', width: 844, height: 390, touch: true, uiScale: 1, dpr: 3 },
    { panel: 'mount', width: 844, height: 390, touch: true, uiScale: 1, dpr: 2 },
  ] as const)(
    'keeps the $panel stage fixed at $width x $height (touch $touch), ui scale $uiScale, dpr $dpr',
    async ({ panel, width, height, touch, uiScale, dpr }) => {
      await page.viewport(width, height);
      if (touch) document.body.className = 'mobile-touch game-active';
      setViewportVars(uiScale);
      const { stage, canvas } = openStage(panel);
      const initial = { w: stage.clientWidth, h: stage.clientHeight };
      expect(initial.h).toBeGreaterThan(0);

      // Many sync rounds, as the ResizeObserver would drive them.
      for (let i = 0; i < 40; i++) syncBuffer(stage, canvas, dpr);
      expect({ w: stage.clientWidth, h: stage.clientHeight }).toEqual(initial);

      // A buffer far larger than the stage still never moves it.
      canvas.width = 4000;
      canvas.height = 4000;
      expect({ w: stage.clientWidth, h: stage.clientHeight }).toEqual(initial);

      // The canvas paints the stage box exactly, whatever its buffer size.
      const stageRect = stage.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      expect(canvasRect.width).toBeCloseTo(stageRect.width, 0);
      expect(canvasRect.height).toBeCloseTo(stageRect.height, 0);
    },
  );

  // The Armory renderer is built in an off-screen parking host sized by
  // armoryPreviewParkingSize, so the first card click must open the stage at
  // exactly that size or every composer target resizes on that click. The
  // first skin's codex is shorter than the stage, so its row height comes from
  // the stage alone.
  it.each([
    { width: 1280, height: 900, touch: false },
    { width: 900, height: 700, touch: false },
    { width: 1280, height: 450, touch: false },
    { width: 844, height: 390, touch: true },
  ])(
    'opens the Armory stage at its parked size at $width x $height (touch $touch)',
    async ({ width, height, touch }) => {
      await page.viewport(width, height);
      if (touch) document.body.className = 'mobile-touch game-active';
      setViewportVars(1);
      const { stage } = openStage('armory');
      const parked = armoryPreviewParkingSize(width, height, touch);
      expect(stage.clientHeight).toBe(parked.height);
      expect(Math.abs(stage.clientWidth - parked.width)).toBeLessThanOrEqual(1);
    },
  );

  // The mount panel builds its renderer in place, so it keeps the plain 380px
  // floor rather than the Armory's parked-size clamp.
  it('keeps the mount stage on its 380px floor on a tall desktop', async () => {
    await page.viewport(1280, 900);
    setViewportVars(1);
    const { stage } = openStage('mount');
    expect(stage.clientHeight).toBe(380);
  });

  // The out-of-flow canvas must not cover the scene and mode toggles drawn
  // over it: a press on a toggle reaches the toggle.
  it.each(['armory', 'mount'] as const)(
    'keeps the %s stage toggles above the canvas',
    async (panel) => {
      await page.viewport(1280, 900);
      setViewportVars(1);
      const { stage } = openStage(panel);
      const buttons = stage.querySelectorAll<HTMLButtonElement>('.armory-inspect-controls button');
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons) {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        expect(hit === button || button.contains(hit)).toBe(true);
      }
    },
  );
});
