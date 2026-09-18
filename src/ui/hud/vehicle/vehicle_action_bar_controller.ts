import { forgeChooseSlot, forgeControlsActive } from '../../../game/forge_controls';
import type { GamepadKind } from '../../../game/gamepad_map';
import { gliderControlsActive } from '../../../game/glider_controls';
import { sfx } from '../../../game/sfx';
import {
  type ShadowControlWorld,
  shadowChooseSlot,
  shadowControlsActive,
} from '../../../game/shadow_controls';
import { CANNON_TACTICS } from '../../../sim/content/cannon_encounter';
import { GLIDER_QUEST_ID } from '../../../sim/content/world_quest_glider';
import { cannonEndlessRound } from '../../../sim/minigames/cannon_endless';
import { TICK_RATE } from '../../../sim/types';
import type { IWorldVehicles } from '../../../world_api/vehicles';
import { vehicleStationDisplayName } from '../../entity_display_core';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import { iconDataUrl } from '../../icons';
import type { PainterHostWriters } from '../../painter_host';
import { ActionBarPainter, type ActionBarSlotElements } from '../action_bar/action_bar_painter';
import { CannonFeedbackCursor } from './cannon_feedback_core';
import { cannonTacticsHint } from './cannon_tactics_view';
import { ForgeActionBarController, type ForgeBarWorld } from './forge_action_bar_controller';
import { createGliderActionBarView, gliderBoostDescription } from './glider_action_bar_view';
import { ShadowActionBarController } from './shadow_action_bar_controller';
import { createVehicleActionBarView } from './vehicle_action_bar_view';
import { vehicleActionTooltip } from './vehicle_action_tooltip';
import { VEHICLE_ACTION_SLOTS, VehicleAimCore } from './vehicle_aim_core';

interface VehicleBarDeps {
  world: IWorldVehicles &
    Partial<ShadowControlWorld & ForgeBarWorld> & {
      boostWorldQuestGlider?(): void;
    };
  writers: PainterHostWriters;
  keyLabel(slot: number): string;
  padKind?(): GamepadKind;
  consumePeek(): boolean;
  clearReticle?(): void;
  presentation?: {
    setGroundAimReticle(value: null): void;
    addShake(amount: number): void;
  };
  attachTooltip(element: HTMLElement, html: () => string): void;
  cancelOnEnter: readonly { cancel(): void }[];
  /** Flight bar Climb/Dive slots: a held pointer pins the glider pitch (+1 climb,
   *  -1 dive) until release; 0 hands control back to the camera. */
  gliderPitchHold?(value: -1 | 0 | 1): void;
}

/** Flight bar slot layout: 0 boost, 1 climb, 2 dive (see glider_action_bar_view). */
export const GLIDER_PITCH_SLOTS: Readonly<Record<number, -1 | 1>> = Object.freeze({ 1: 1, 2: -1 });
/** A tap (click or hotkey) nudges the pitch for this long instead of latching. */
export const GLIDER_PITCH_TAP_MS = 250;

export class VehicleActionBarController {
  readonly aim: VehicleAimCore;
  private readonly root = document.createElement('section');
  private readonly title = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly gauge = document.createElement('div');
  private readonly fill = document.createElement('div');
  private readonly integrity = document.createElement('span');
  private readonly hint = document.createElement('div');
  private readonly exit = document.createElement('button');
  private readonly feedback = new CannonFeedbackCursor();
  private readonly view = createVehicleActionBarView();
  private readonly gliderView = createGliderActionBarView();
  private readonly actionButtons: HTMLElement[] = [];
  private readonly painter: ActionBarPainter;
  private mounted = false;
  private gliderMode: boolean | null = null;
  private readonly shadow: ShadowActionBarController | null;
  private readonly forge: ForgeActionBarController | null;

  constructor(private readonly deps: VehicleBarDeps) {
    this.shadow =
      deps.world.shadowWorldQuestAction &&
      deps.world.worldQuestLog &&
      deps.world.player &&
      deps.world.entities
        ? new ShadowActionBarController(
            deps.world as ShadowControlWorld,
            deps.writers,
            deps.keyLabel,
            deps.cancelOnEnter,
            deps.attachTooltip,
            deps.consumePeek,
            deps.padKind,
          )
        : null;
    this.forge =
      deps.world.worldQuestLog && deps.world.player && deps.world.pickUpObject
        ? new ForgeActionBarController(
            deps.world as ForgeBarWorld,
            deps.writers,
            deps.keyLabel,
            deps.cancelOnEnter,
            deps.attachTooltip,
            deps.consumePeek,
            deps.padKind,
          )
        : null;
    this.aim = new VehicleAimCore(deps.world, () => {
      deps.clearReticle?.();
      deps.presentation?.setGroundAimReticle(null);
    });
    this.root.className = 'vehicle-bar';
    this.root.id = 'vehicle-action-bar';
    this.title.className = 'vehicle-bar-title';
    this.status.className = 'vehicle-bar-status';
    this.gauge.className = 'vehicle-integrity';
    this.fill.className = 'vehicle-integrity-fill';
    this.integrity.className = 'vehicle-integrity-text';
    this.hint.className = 'vehicle-bar-hint';
    this.exit.className = 'vehicle-exit';
    this.exit.type = 'button';
    deps.writers.setAttr(this.status, 'role', 'status');
    this.gauge.tabIndex = 0;
    deps.attachTooltip(this.gauge, () =>
      esc(
        t('hudChrome.vehicle.medalRules', {
          goldIntegrity: formatNumber(CANNON_TACTICS.goldIntegrity / 100, { style: 'percent' }),
          goldAccuracy: formatNumber(CANNON_TACTICS.goldAccuracy, { style: 'percent' }),
          silverIntegrity: formatNumber(CANNON_TACTICS.silverIntegrity / 100, { style: 'percent' }),
          silverAccuracy: formatNumber(CANNON_TACTICS.silverAccuracy, { style: 'percent' }),
        }),
      ),
    );
    for (const key of ['meteor', 'impact_metal', 'flamestrike']) sfx.preload(key);
    this.exit.addEventListener('click', () => deps.world.leaveVehicle());
    const bar = document.createElement('div');
    bar.className = 'vehicle-action-slots';
    const slots: ActionBarSlotElements[] = VEHICLE_ACTION_SLOTS.map((_, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'action-btn vehicle-action';
      this.actionButtons.push(btn);
      const label = document.createElement('span');
      const countEl = document.createElement('span');
      const keybindEl = document.createElement('span');
      const cdOverlay = document.createElement('span');
      const cdText = document.createElement('span');
      const rechargeOverlay = document.createElement('span');
      label.className = 'icon-label';
      keybindEl.className = 'keybind';
      cdOverlay.className = 'cd-overlay';
      cdText.className = 'cdtext';
      rechargeOverlay.className = 'recharge-overlay';
      btn.append(label, countEl, keybindEl, cdOverlay, cdText, rechargeOverlay);
      btn.addEventListener('click', () => {
        if (!deps.consumePeek()) this.chooseSlot(index);
      });
      const pitch = GLIDER_PITCH_SLOTS[index];
      if (pitch !== undefined) {
        // Hold-to-pitch: pointer down pins the pitch, any release lets go. The
        // click above still fires on release and turns into a short tap nudge,
        // which is what a keyboard or pad press gets too.
        btn.addEventListener('pointerdown', (event) => {
          if (!this.gliderActive()) return;
          event.preventDefault();
          this.holdPitch(pitch);
        });
        for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const)
          btn.addEventListener(type, () => this.holdPitch(0));
      }
      deps.attachTooltip(btn, () =>
        this.gliderActive()
          ? esc(gliderBoostDescription())
          : vehicleActionTooltip(VEHICLE_ACTION_SLOTS[index]),
      );
      bar.append(btn);
      return { btn, label, countEl, keybindEl, cdOverlay, cdText, rechargeOverlay };
    });
    this.gauge.append(this.fill, this.integrity);
    this.root.append(this.title, this.status, this.gauge, bar, this.exit, this.hint);
    this.painter = new ActionBarPainter(
      deps.writers,
      { container: bar, slots },
      (key) => `url(${iconDataUrl('ability', key, 56)})`,
    );
    deps.writers.setDisplay(this.root, 'none');
    document.getElementById('ui')?.append(this.root);
  }

  private pitchHeld: -1 | 0 | 1 = 0;
  private pitchTap: ReturnType<typeof setTimeout> | null = null;

  private holdPitch(value: -1 | 0 | 1): void {
    if (this.pitchTap) {
      clearTimeout(this.pitchTap);
      this.pitchTap = null;
    }
    if (this.pitchHeld === value) return;
    this.pitchHeld = value;
    this.deps.gliderPitchHold?.(value);
  }

  /** Test-only window into the held pitch. */
  get heldGliderPitch(): -1 | 0 | 1 {
    return this.pitchHeld;
  }

  chooseSlot(slot: number): void {
    if (this.gliderActive()) {
      const glider = this.deps.world.worldQuestLog?.get(GLIDER_QUEST_ID)?.glider;
      if (glider?.phase !== 'flying') return;
      if (slot === 0 && (glider.boostReadyTick ?? 0) <= glider.tick)
        this.deps.world.boostWorldQuestGlider?.();
      const pitch = GLIDER_PITCH_SLOTS[slot];
      if (pitch !== undefined) {
        // A tap that arrives while the pointer is still held changes nothing; a
        // bare tap nudges the pitch and lets go on its own.
        if (this.pitchHeld !== 0) return;
        this.holdPitch(pitch);
        this.pitchTap = setTimeout(() => {
          this.pitchTap = null;
          this.holdPitch(0);
        }, GLIDER_PITCH_TAP_MS);
      }
      return;
    }
    if (this.shadow && shadowControlsActive(this.deps.world as ShadowControlWorld)) {
      shadowChooseSlot(this.deps.world as ShadowControlWorld, slot);
      return;
    }
    if (this.forge && forgeControlsActive(this.deps.world)) {
      forgeChooseSlot(this.deps.world as ForgeBarWorld, slot);
      return;
    }
    const action = VEHICLE_ACTION_SLOTS[slot];
    if (action) this.aim.begin(action, slot);
  }

  update(): void {
    this.shadow?.update();
    this.forge?.update();
    const session = this.deps.world.vehicleSession;
    const writers = this.deps.writers;
    const gliderActive = this.gliderActive();
    const active = !!session || gliderActive;
    const cues = this.feedback.consume(session);
    let shot = false,
      explosion = false,
      impact = false;
    for (const cue of cues) {
      if (cue.kind === 'shot') shot = true;
      if (cue.kind === 'barrel') explosion = true;
      if (cue.kind === 'armor' || cue.kind === 'impact') impact = true;
    }
    if (shot) sfx.playUi('meteor', { gain: 0.5 });
    if (explosion) sfx.playUi('flamestrike', { gain: 0.5 });
    if (impact) sfx.playUi('impact_metal', { gain: 0.5 });
    if (active !== this.mounted) {
      this.mounted = active;
      this.aim.cancel();
      if (active) for (const controller of this.deps.cancelOnEnter) controller.cancel();
      writers.toggleClass(document.body, 'operating-vehicle', active);
      writers.setDisplay(this.root, active ? 'grid' : 'none');
    }
    if (active && this.gliderMode !== gliderActive) {
      this.gliderMode = gliderActive;
      writers.toggleClass(this.root, 'glider-action-bar', gliderActive);
      for (const element of [this.gauge, this.exit, this.hint])
        writers.setDisplay(element, gliderActive ? 'none' : '');
      // Flight keeps three slots (boost, climb, dive); any further vehicle slot hides.
      for (let i = 1; i < this.actionButtons.length; i++)
        writers.setDisplay(
          this.actionButtons[i],
          gliderActive && GLIDER_PITCH_SLOTS[i] === undefined ? 'none' : '',
        );
      if (!gliderActive) this.holdPitch(0);
    }
    if (!active && this.pitchHeld !== 0) this.holdPitch(0);
    if (gliderActive) {
      const glider = this.deps.world.worldQuestLog!.get(GLIDER_QUEST_ID)!.glider!;
      writers.setText(this.title, t('questUi.worldQuest.glider.title'));
      writers.setText(this.status, t('questUi.worldQuest.glider.boost'));
      this.painter.paint(this.gliderView.tick(glider, (slot) => this.deps.keyLabel(slot)));
      return;
    }
    if (!session) return;
    const encounter = session.encounter;
    writers.setText(this.title, vehicleStationDisplayName(session.stationId));
    writers.setText(this.exit, t('hudChrome.vehicle.exit'));
    writers.setAttr(this.gauge, 'role', 'meter');
    writers.setAttr(this.gauge, 'aria-label', t('hudChrome.vehicle.integrity'));
    writers.setAttr(this.gauge, 'aria-valuemin', '0');
    writers.setAttr(this.gauge, 'aria-valuemax', '100');
    writers.setAttr(this.gauge, 'aria-valuenow', String(encounter.integrity));
    writers.setStyleProp(this.fill, '--vehicle-integrity', String(encounter.integrity / 100));
    writers.toggleClass(this.gauge, 'low-integrity', encounter.integrity < 25);
    writers.setText(this.integrity, formatNumber(encounter.integrity / 100, { style: 'percent' }));
    writers.setText(
      this.status,
      encounter.phase === 'wave'
        ? encounter.endless
          ? t('hudChrome.vehicle.endlessWave', {
              wave: formatNumber(encounter.wave + 1),
              round: formatNumber(cannonEndlessRound(encounter)),
            })
          : t('hudChrome.vehicle.wave', {
              wave: formatNumber(encounter.wave + 1),
              total: formatNumber(3),
            })
        : t('hudChrome.vehicle.countdown', {
            seconds: formatNumber(
              Math.ceil((encounter.phaseUntilTick - encounter.tick) / TICK_RATE),
            ),
          }),
    );
    writers.setText(
      this.hint,
      this.aim.isActive() ? t('hudChrome.vehicle.aim') : cannonTacticsHint(encounter),
    );
    this.painter.paint(this.view.tick(session, this.aim.activeSlot(), this.deps.keyLabel));
  }

  /** Action guards read session state without constructing the bar's DOM. */
  private gliderActive(): boolean {
    const worldQuestLog = this.deps.world.worldQuestLog;
    return !!worldQuestLog && gliderControlsActive({ worldQuestLog });
  }

  static blocksPlayerActions(
    world: Pick<IWorldVehicles, 'vehicleSession'> &
      Partial<Pick<ShadowControlWorld, 'worldQuestLog'>>,
  ): boolean {
    const worldQuestLog = world.worldQuestLog;
    return (
      !!world.vehicleSession ||
      (!!worldQuestLog &&
        (gliderControlsActive({ worldQuestLog }) ||
          shadowControlsActive({ worldQuestLog }) ||
          forgeControlsActive({ worldQuestLog })))
    );
  }

  get blocksPlayerActions(): boolean {
    return VehicleActionBarController.blocksPlayerActions(this.deps.world);
  }
}
