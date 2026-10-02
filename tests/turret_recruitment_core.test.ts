// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURRET_SCENARIO_HARD } from '../src/sim/content/fire_and_fly_scenarios';
import type { FireAndFlyRecruitment } from '../src/sim/fire_and_fly_recruitment';
import { createTurretDefense } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { turretSessionView } from '../src/sim/turret_defense_session';
import type { TurretSession, VehicleSession } from '../src/sim/types';
import {
  FireAndFlyRecruitmentWatch,
  fireAndFlyRecruitedBanner,
} from '../src/ui/hud/vehicle/turret_recruitment_core';
import { VehicleActionBarController } from '../src/ui/hud/vehicle/vehicle_action_bar_controller';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';
import type { TurretSessionView } from '../src/world_api/vehicles';

vi.mock('../src/ui/icons', () => ({ iconDataUrl: (_kind: string, key: string) => `/${key}.webp` }));
vi.mock('../src/game/sfx', () => ({
  sfx: {
    preload: vi.fn(),
    playUi: vi.fn(),
    playAt: vi.fn(() => true),
    hasVariants: () => false,
  },
}));

const RECRUITED_BANNER = {
  text: 'Recruited!',
  subtext:
    'Master Gunner Alder: "Welcome to the gate crew, gunner. My missions are open to you now."',
};

beforeEach(() => {
  setLanguage('en');
  document.body.innerHTML = '<div id="ui"></div>';
});

afterEach(() => {
  setLanguage('en');
  document.body.replaceChildren();
  document.body.className = '';
});

describe('the recruitment watch', () => {
  it('fires once, on the frame a seated character turns recruited', () => {
    const watch = new FireAndFlyRecruitmentWatch();
    expect(watch.observe(true, false)).toBe(false);
    expect(watch.observe(true, true)).toBe(true);
    expect(watch.observe(true, true)).toBe(false);
    expect(watch.observe(false, true)).toBe(false);
    expect(watch.observe(true, true)).toBe(false);
  });

  it('stays quiet for a recruit seen already recruited (a login, a reconnect, a new seat)', () => {
    const watch = new FireAndFlyRecruitmentWatch();
    expect(watch.observe(false, false)).toBe(false);
    expect(watch.observe(true, true)).toBe(false);
  });

  it('never fires off the seat, even when the flag lands there', () => {
    const watch = new FireAndFlyRecruitmentWatch();
    expect(watch.observe(true, false)).toBe(false);
    expect(watch.observe(false, false)).toBe(false);
    expect(watch.observe(false, true)).toBe(false);
  });

  it("speaks in Alder's voice, in the player's language", async () => {
    expect(fireAndFlyRecruitedBanner()).toEqual(RECRUITED_BANNER);
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    const banner = fireAndFlyRecruitedBanner();
    expect(banner.text).not.toBe(RECRUITED_BANNER.text);
    expect(banner.subtext).toContain('アルダー');
  });
});

function seat(): TurretSession {
  return {
    kind: 'turret',
    origin: { x: 0, y: 0, z: 0 },
    defense: createTurretDefense(resolveTurretPlan(TURRET_SCENARIO_HARD), { x: 0, z: 0 }, 5, 400),
    priorMountKey: '',
    returnTo: { x: 0, y: 0, z: 0, facing: 0 },
    feedback: [],
    nextFeedbackSeq: 1,
  };
}

function rig(recruitment: FireAndFlyRecruitment) {
  const world = {
    vehicleSession: null as VehicleSession | null,
    turretSession: null as TurretSessionView | null,
    turretClock: null as number | null,
    fireAndFlyRecruitment: recruitment,
    enterVehicle: vi.fn(),
    useVehicleAction: vi.fn(),
    leaveVehicle: vi.fn(),
  };
  const showBanner = vi.fn();
  const bar = new VehicleActionBarController({
    world,
    writers: makeWriterFacet(new Map(), new Map(), new Map(), new Map(), vi.fn(), () => {}),
    keyLabel: (slot) => String(slot + 1),
    consumePeek: () => false,
    cancelOnEnter: [],
    attachTooltip: () => {},
    showBanner,
  });
  return { world, bar, showBanner };
}

describe('the seat HUD', () => {
  it("shows Alder's word once as the Veterans' Test's win recruits the character", () => {
    const recruitment = { trialsWon: 2, recruited: false };
    const { world, bar, showBanner } = rig(recruitment);
    world.turretSession = turretSessionView(seat());
    world.turretClock = 400;
    bar.update();
    expect(showBanner).not.toHaveBeenCalledWith(RECRUITED_BANNER);
    recruitment.trialsWon = 3;
    recruitment.recruited = true;
    bar.update();
    expect(showBanner).toHaveBeenLastCalledWith(RECRUITED_BANNER);
    bar.update();
    bar.update();
    expect(showBanner.mock.calls.filter(([b]) => b.text === 'Recruited!')).toHaveLength(1);
  });

  it('says nothing to a recruit who takes a seat', () => {
    const { world, bar, showBanner } = rig({ trialsWon: 3, recruited: true });
    bar.update();
    world.turretSession = turretSessionView(seat());
    world.turretClock = 400;
    bar.update();
    bar.update();
    expect(showBanner.mock.calls.filter(([b]) => b.text === 'Recruited!')).toHaveLength(0);
  });
});
