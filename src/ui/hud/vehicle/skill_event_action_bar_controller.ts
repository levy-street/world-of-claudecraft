// The hourly skill event bar (src/sim/pvp/skill_events.ts): the event's kit
// verbs and the one class ability you kept, in the vehicle-bar family at the
// bottom of the screen, plus the keepsake picker. Composed by the vehicle bar
// controller like the cloak and forge bars, so the Hud's slot routing and its
// player-action block cover it with no new Hud wiring.
//
// Shown once you have joined: during the warning it offers only the picker;
// while the event runs it shows the kit, hides the normal bars
// (body.skill-event-kit) and routes keys 1 to 5 here.

import {
  type SkillEventControlWorld,
  skillEventChooseSlot,
  skillEventControlsActive,
} from '../../../game/skill_event_controls';
import { ABILITIES } from '../../../sim/content/classes';
import {
  BANKSHOT_BOLT_COOLDOWN,
  BANKSHOT_BRACE_COOLDOWN,
  BANKSHOT_BRACE_WINDOW,
  BANKSHOT_DASH_COOLDOWN,
  BANKSHOT_DASH_DISTANCE,
  BANKSHOT_MAX_BOUNCES,
} from '../../../sim/pvp/skill_event_bankshot';
import {
  COMMON_HAND_DIRECT_SHARE,
  COMMON_HAND_HEAL_SHARE,
  COMMON_HAND_PERIODIC_SHARE,
  COMMON_HAND_SHIELD_SHARE,
} from '../../../sim/pvp/skill_event_common_hand';
import {
  FOOTPRINTS_HUSH,
  FOOTPRINTS_HUSH_COOLDOWN,
  FOOTPRINTS_PEBBLE_COOLDOWN,
  FOOTPRINTS_PEBBLE_LENGTH,
  FOOTPRINTS_REVEAL,
  FOOTPRINTS_SWEEP_RANGE,
} from '../../../sim/pvp/skill_event_footprints';
import {
  RIPOSTE_FEINT_COOLDOWN,
  RIPOSTE_GUARD_MAX,
  RIPOSTE_LUNGE_RANGE,
  RIPOSTE_LUNGE_WINDUP,
  RIPOSTE_OPEN_AFTER_GUARD,
  RIPOSTE_PASSIVE_LIMIT,
  RIPOSTE_PERFECT_WINDOW,
  RIPOSTE_SIDESTEP_COOLDOWN,
  RIPOSTE_SIDESTEP_DISTANCE,
  RIPOSTE_STAGGER,
} from '../../../sim/pvp/skill_event_riposte';
import {
  TONGUES_CHANT,
  TONGUES_CIRCLE,
  TONGUES_RITES_TO_WIN,
  TONGUES_SEVER_COOLDOWN,
  TONGUES_SEVER_WINDUP,
  TONGUES_SHOVE_COOLDOWN,
  TONGUES_SHOVE_DISTANCE,
  TONGUES_SILENCE,
} from '../../../sim/pvp/skill_event_tongues';
import { abilityDisplayName } from '../../ability_display_name';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import type { TranslationKey } from '../../i18n.catalog';
import { iconDataUrl } from '../../icons';
import type { PainterHostWriters } from '../../painter_host';
import { ActionBarPainter, type ActionBarSlotElements } from '../action_bar/action_bar_painter';
import {
  createSkillEventBarView,
  SKILL_EVENT_BAR_SLOTS,
  SKILL_EVENT_VERB_TIPS,
} from './skill_event_action_bar_view';

export type SkillEventBarWorld = SkillEventControlWorld &
  Pick<import('../../../world_api').IWorld, 'skillEventPickKeepsake' | 'known'>;

const EVENT_NAME_KEYS: Readonly<Record<string, TranslationKey>> = {
  riposte: 'hud.skillEvent.names.riposte',
  footprints: 'hud.skillEvent.names.footprints',
  tongues: 'hud.skillEvent.names.tongues',
  bankshot: 'hud.skillEvent.names.bankshot',
  common_hand: 'hud.skillEvent.names.common_hand',
};

const STANCE_KEYS: Readonly<Record<string, TranslationKey>> = {
  lunge: 'hud.skillEvent.stance.lunge',
  guard: 'hud.skillEvent.stance.guard',
  open: 'hud.skillEvent.stance.open',
  chant: 'hud.skillEvent.stance.chant',
  sever: 'hud.skillEvent.stance.sever',
  silenced: 'hud.skillEvent.stance.silenced',
  brace: 'hud.skillEvent.stance.brace',
  hand: 'hud.skillEvent.stance.hand',
};

const GOAL_KEYS: Readonly<Record<string, TranslationKey>> = {
  riposte: 'hud.skillEvent.goals.riposte',
  footprints: 'hud.skillEvent.goals.footprints',
  tongues: 'hud.skillEvent.goals.tongues',
  bankshot: 'hud.skillEvent.goals.bankshot',
  common_hand: 'hud.skillEvent.goals.common_hand',
};

/** The live numbers the verb tooltips quote (docs/design/tooltip-writing.md). */
const SKILL_EVENT_TIP_VALUES = {
  windup: RIPOSTE_LUNGE_WINDUP,
  range: RIPOSTE_LUNGE_RANGE,
  max: RIPOSTE_GUARD_MAX,
  perfect: RIPOSTE_PERFECT_WINDOW,
  stagger: RIPOSTE_STAGGER,
  open: RIPOSTE_OPEN_AFTER_GUARD,
  passive: RIPOSTE_PASSIVE_LIMIT,
  feintCd: RIPOSTE_FEINT_COOLDOWN,
  distance: RIPOSTE_SIDESTEP_DISTANCE,
  sidestepCd: RIPOSTE_SIDESTEP_COOLDOWN,
  sweepRange: FOOTPRINTS_SWEEP_RANGE,
  reveal: FOOTPRINTS_REVEAL,
  hush: FOOTPRINTS_HUSH,
  hushCd: FOOTPRINTS_HUSH_COOLDOWN,
  pebble: FOOTPRINTS_PEBBLE_LENGTH,
  pebbleCd: FOOTPRINTS_PEBBLE_COOLDOWN,
  chant: TONGUES_CHANT,
  circle: TONGUES_CIRCLE,
  goal: TONGUES_RITES_TO_WIN,
  severWindup: TONGUES_SEVER_WINDUP,
  severCd: TONGUES_SEVER_COOLDOWN,
  silence: TONGUES_SILENCE,
  shove: TONGUES_SHOVE_DISTANCE,
  shoveCd: TONGUES_SHOVE_COOLDOWN,
  bounces: BANKSHOT_MAX_BOUNCES,
  boltCd: BANKSHOT_BOLT_COOLDOWN,
  braceWindow: BANKSHOT_BRACE_WINDOW,
  braceCd: BANKSHOT_BRACE_COOLDOWN,
  dash: BANKSHOT_DASH_DISTANCE,
  dashCd: BANKSHOT_DASH_COOLDOWN,
};

const MAX_CHOICES = 12;

/** The Common Hand's four kinds, in bar order (skill_event_common_hand.ts). */
const HAND_KIND_KEYS: readonly TranslationKey[] = [
  'hud.skillEvent.handKinds.attack',
  'hud.skillEvent.handKinds.control',
  'hud.skillEvent.handKinds.defensive',
  'hud.skillEvent.handKinds.movement',
];

export class SkillEventActionBarController {
  private readonly root = document.createElement('section');
  private readonly title = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly hint = document.createElement('div');
  private readonly picker = document.createElement('div');
  private readonly pickerTitle = document.createElement('div');
  private readonly choiceRow = document.createElement('div');
  private readonly choiceButtons: HTMLButtonElement[] = [];
  private readonly slotButtons: HTMLElement[] = [];
  private readonly view = createSkillEventBarView();
  private readonly painter: ActionBarPainter;
  private kitActive = false;
  private choiceSignature = '';

  constructor(
    private readonly world: SkillEventBarWorld,
    private readonly writers: PainterHostWriters,
    private readonly keyLabel: (slot: number) => string,
    private readonly cancelOnEnter: readonly { cancel(): void }[],
    attachTooltip: (element: HTMLElement, html: () => string) => void,
    consumePeek: () => boolean,
  ) {
    this.root.id = 'skill-event-bar';
    this.root.className = 'vehicle-bar skill-event-bar';
    this.title.className = 'vehicle-bar-title';
    this.status.className = 'vehicle-bar-status';
    this.hint.className = 'vehicle-bar-hint';
    this.picker.className = 'skill-event-picker';
    this.pickerTitle.className = 'skill-event-picker-title';
    this.choiceRow.className = 'skill-event-choices';
    this.picker.append(this.pickerTitle, this.choiceRow);
    writers.setAttr(this.status, 'role', 'status');
    const bar = document.createElement('div');
    bar.className = 'vehicle-action-slots';
    const slots: ActionBarSlotElements[] = [];
    for (let index = 0; index < SKILL_EVENT_BAR_SLOTS; index++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'action-btn vehicle-action ui-socket';
      const label = document.createElement('span'),
        countEl = document.createElement('span'),
        keybindEl = document.createElement('span'),
        cdOverlay = document.createElement('span'),
        cdText = document.createElement('span'),
        rechargeOverlay = document.createElement('span');
      label.className = 'icon-label ui-socket-art';
      countEl.className = 'item-count ui-socket-count';
      keybindEl.className = 'keybind ui-socket-key';
      cdOverlay.className = 'cd-overlay ui-socket-cd';
      cdText.className = 'cdtext ui-socket-cd-text';
      rechargeOverlay.className = 'recharge-overlay';
      btn.append(label, countEl, keybindEl, cdOverlay, cdText, rechargeOverlay);
      btn.addEventListener('click', () => {
        if (!consumePeek()) skillEventChooseSlot(this.world, index);
      });
      attachTooltip(btn, () => this.slotTooltip(index));
      bar.append(btn);
      this.slotButtons.push(btn);
      slots.push({ btn, label, countEl, keybindEl, cdOverlay, cdText, rechargeOverlay });
    }
    this.painter = new ActionBarPainter(
      writers,
      { container: bar, slots },
      (key) => `url(${iconDataUrl('ability', key, 56)})`,
    );
    for (let i = 0; i < MAX_CHOICES; i++) {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.className = 'skill-event-choice ui-socket';
      choice.addEventListener('click', () => {
        const id = choice.dataset.ability;
        if (id && !choice.dataset.preview) this.world.skillEventPickKeepsake(id);
      });
      attachTooltip(choice, () => esc(this.abilityName(choice.dataset.ability ?? '')));
      this.choiceRow.append(choice);
      this.choiceButtons.push(choice);
    }
    this.root.append(this.title, this.status, bar, this.picker, this.hint);
    writers.setDisplay(this.root, 'none');
    document.getElementById('ui')?.append(this.root);
  }

  private abilityName(id: string): string {
    const def = this.world.known.find((k) => k.def.id === id)?.def ?? ABILITIES[id];
    return def ? abilityDisplayName(def) : '';
  }

  private slotTooltip(index: number): string {
    const kit = this.world.skillEventInfo?.kit;
    const verb = kit?.verbs[index];
    const dealt = this.world.skillEventInfo?.hand?.current[index];
    if (verb && dealt) {
      // The Common Hand: the dealt ability, its kind, and the equal-for-all rule.
      return esc(
        t('hud.skillEvent.handTip', {
          name: this.abilityName(dealt),
          kind: t(HAND_KIND_KEYS[index] ?? HAND_KIND_KEYS[0]),
          direct: formatNumber(COMMON_HAND_DIRECT_SHARE * 100),
          periodic: formatNumber(COMMON_HAND_PERIODIC_SHARE * 100),
          heal: formatNumber(COMMON_HAND_HEAL_SHARE * 100),
          shield: formatNumber(COMMON_HAND_SHIELD_SHARE * 100),
        }),
      );
    }
    if (verb) {
      const tip = SKILL_EVENT_VERB_TIPS[verb.id];
      return tip ? esc(t(tip, SKILL_EVENT_TIP_VALUES)) : '';
    }
    if (kit && index === kit.verbs.length) {
      return esc(
        kit.keepsake
          ? t('hud.skillEvent.keepsakeTip', { name: this.abilityName(kit.keepsake) })
          : t('hud.skillEvent.keepsakeEmpty'),
      );
    }
    return '';
  }

  update(): void {
    const info = this.world.skillEventInfo;
    const kit = info?.kit ?? null;
    const shown = !!info && !!kit && kit.verbs.length > 0 && !this.world.player.dead;
    this.writers.setDisplay(this.root, shown ? 'grid' : 'none');
    const kitActive = shown && skillEventControlsActive(this.world);
    if (kitActive !== this.kitActive) {
      this.kitActive = kitActive;
      if (kitActive) for (const controller of this.cancelOnEnter) controller.cancel();
    }
    this.writers.toggleClass(document.body, 'skill-event-kit', kitActive);
    if (!shown || !info || !kit) return;
    this.writers.setText(this.title, t(EVENT_NAME_KEYS[info.kind]));
    const stance = this.world.player.eventStance;
    this.writers.setText(
      this.status,
      info.phase === 'warning'
        ? t('hud.skillEvent.startsIn', { minutes: info.minutesLeft })
        : stance
          ? t(STANCE_KEYS[stance])
          : info.kind === 'footprints'
            ? t(this.world.player.eventUnseen ? 'hud.skillEvent.unseen' : 'hud.skillEvent.seen')
            : info.hand
              ? t('hud.skillEvent.bellIn', { seconds: formatNumber(info.hand.bellIn) })
              : t('hud.skillEvent.ready'),
    );
    // A scoring event's tally rides the goal line (Rite of Tongues: Rites done).
    const score = info.score;
    this.writers.toggleClass(this.root, 'has-score', !!score);
    this.writers.toggleClass(this.root, 'is-open', stance === 'open');
    this.writers.toggleClass(this.root, 'is-warning', info.phase === 'warning');
    this.writers.setText(
      this.hint,
      score
        ? t(info.kind === 'common_hand' ? 'hud.skillEvent.scoreKills' : 'hud.skillEvent.score', {
            count: formatNumber(score.yours),
            goal: formatNumber(score.toWin),
            best: formatNumber(score.best),
          })
        : t(GOAL_KEYS[info.kind]),
    );
    const keepsakeCd = kit.keepsake ? (this.world.player.cooldowns.get(kit.keepsake) ?? 0) : 0;
    this.painter.paint(this.view.tick(info, keepsakeCd, (slot) => this.keyLabel(slot)));
    for (let i = 0; i < this.slotButtons.length; i++) {
      const used = i < kit.verbs.length || (i === kit.verbs.length && !!kit.keepsake);
      this.writers.setDisplay(this.slotButtons[i], used ? '' : 'none');
    }
    // The Common Hand shows the next hand in the picker's place before the bell.
    const next = kit.keepsake !== null ? (info.hand?.next ?? null) : null;
    this.paintPicker(kit.keepsake, next ?? kit.choices, next !== null);
  }

  private paintPicker(keepsake: string | null, choices: readonly string[], preview = false): void {
    const open = (keepsake === null || preview) && choices.length > 0;
    this.writers.setDisplay(this.picker, open ? '' : 'none');
    this.writers.toggleClass(this.picker, 'is-preview', preview);
    if (!open) return;
    this.writers.setText(
      this.pickerTitle,
      preview ? t('hud.skillEvent.nextHand') : t('hud.skillEvent.pickTitle'),
    );
    const signature = `${preview ? 'next:' : ''}${choices.join(',')}`;
    if (signature === this.choiceSignature) return;
    this.choiceSignature = signature;
    for (let i = 0; i < this.choiceButtons.length; i++) {
      const btn = this.choiceButtons[i];
      const id = choices[i];
      if (!id) {
        this.writers.setDisplay(btn, 'none');
        continue;
      }
      btn.dataset.ability = id;
      btn.dataset.preview = preview ? '1' : '';
      this.writers.setStyleProp(btn, 'background-image', `url(${iconDataUrl('ability', id, 56)})`);
      this.writers.setAttr(btn, 'aria-label', this.abilityName(id));
      this.writers.setDisplay(btn, '');
    }
  }
}
