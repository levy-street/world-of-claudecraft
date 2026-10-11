// The Talking Head panel: an NPC line spoken to the player while the speaker
// is off screen, so a world bubble would be unseen. Portrait, speaker name and
// the line on the strong panel surface, seated at the top of the bottom stack
// above the unit frames. Cold: it paints only when a line arrives or expires.

import { type NpcPortraitSource, npcPortraitSourceFor } from '../../../render/characters/manifest';
import {
  onPortraitsReady,
  onPortraitUpdate,
  portraitsReady,
} from '../../../render/characters/portrait';
import { esc } from '../../esc';
import { t } from '../../i18n';
import {
  type NonPlayerPortraitSubject,
  nonPlayerPortraitSubject,
  nonPlayerPortraitUpdateFrames,
} from '../../nonplayer_portrait_core';
import { crestIdForEntity } from '../../unit_portrait';
import { UnitPortraitPainter } from '../../unit_portrait_painter';
import {
  EMPTY_TALKING_HEAD,
  expireLine,
  showLine,
  type TalkingHeadLine,
  type TalkingHeadModel,
} from './talking_head_core';

const UI_ROOT_ID = 'ui';
export const TALKING_HEAD_ID = 'talking-head';

export class TalkingHeadController {
  private root: HTMLElement | null = null;
  private portraitEl: HTMLCanvasElement | null = null;
  private nameEl: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;
  private portraitFor = '';
  /** What the portrait canvas holds, kept so a capture that lands later repaints it. */
  private portrait: NonPlayerPortraitSubject<NpcPortraitSource['head']> | null = null;
  /** The speaker's face is still owed: its capture is running, or failed. */
  private portraitPending = false;
  private portraitListening = false;
  private model: TalkingHeadModel = EMPTY_TALKING_HEAD;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly portraits = new UnitPortraitPainter();

  constructor(private readonly now: () => number = () => performance.now()) {}

  say(line: TalkingHeadLine): void {
    if (!this.ensureDom()) return;
    this.model = showLine(line, this.now());
    this.paint();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.expire(), this.model.until - this.now());
  }

  hide(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.model = EMPTY_TALKING_HEAD;
    this.paint();
  }

  get current(): TalkingHeadLine | null {
    return this.model.line;
  }

  private expire(): void {
    this.timer = null;
    this.model = expireLine(this.model, this.now());
    this.paint();
  }

  private ensureDom(): boolean {
    if (this.root) return true;
    // The panel is standing HUD chrome in both entries (a movable frame, so it
    // must exist at HUD boot); a headless document without it gets one minted.
    let el = document.getElementById(TALKING_HEAD_ID);
    if (!el) {
      const host = document.getElementById(UI_ROOT_ID);
      if (!host) return false;
      el = document.createElement('div');
      el.id = TALKING_HEAD_ID;
      el.className = 'talking-head ui-panel-strong';
      el.hidden = true;
      el.setAttribute('role', 'status');
      el.setAttribute('aria-label', t('hudChrome.talkingHead.label'));
      el.innerHTML =
        `<div class="portrait-wrap ui-portrait-wrap th-portrait-wrap"><div class="portrait ui-portrait"><canvas class="th-portrait" width="54" height="54"></canvas></div></div>` +
        `<div class="th-body"><div class="th-name ui-h"></div><div class="th-text"></div></div>`;
      host.appendChild(el);
    }
    this.root = el;
    this.portraitEl = el.querySelector<HTMLCanvasElement>('.th-portrait');
    this.nameEl = el.querySelector<HTMLElement>('.th-name');
    this.textEl = el.querySelector<HTMLElement>('.th-text');
    return true;
  }

  private paint(): void {
    const { root, nameEl, textEl, portraitEl } = this;
    if (!root || !nameEl || !textEl || !portraitEl) return;
    const line = this.model.line;
    if (!line) {
      // Clear before hiding: Unlock Interface forces the frame visible, so a
      // line left behind would read as the editing placeholder's content.
      nameEl.textContent = '';
      textEl.textContent = '';
      root.hidden = true;
      this.forgetPortrait(portraitEl);
      return;
    }
    nameEl.textContent = line.speakerName;
    // Player-facing line text arrives already localized; esc keeps it inert.
    textEl.innerHTML = esc(line.text);
    if (this.portraitFor !== line.speakerId) {
      this.portraitFor = line.speakerId;
      this.paintPortrait(portraitEl, line.speakerId);
    } else if (this.portraitPending) {
      // A capture that fails reports nothing, so a face still owed is asked for again
      // with each line (a cold event). A face that has landed is never repainted.
      this.repaintPortrait();
    }
    root.hidden = false;
  }

  private paintPortrait(canvas: HTMLCanvasElement, speakerId: string): void {
    // A headless document hands out no 2D context; the panel still reads.
    if (!canvas.getContext('2d')) return;
    // The speaker is an NPC: the rule every non-player frame shares answers its own
    // face when it wears an authored look, else the NPC crest.
    this.portrait = nonPlayerPortraitSubject(
      { templateId: speakerId, kind: 'npc' },
      npcPortraitSourceFor,
    );
    this.repaintPortrait();
    if (this.portrait.kind === 'face') this.listenForPortrait();
  }

  private repaintPortrait(): void {
    const { portraitEl, portrait } = this;
    if (!portraitEl || !portrait) return;
    const painted = this.portraits.drawNonPlayer(portraitEl, portrait);
    this.portraitPending = portrait.kind === 'face' && !painted;
  }

  /** The panel keeps no speaker once its line is gone, as it keeps no words: Unlock
   *  Interface forces the hidden frame visible, and a face left behind would read as
   *  content. Back to the crest the empty panel has always shown; the next line asks
   *  for its speaker's face again (a cache hit once it has landed). */
  private forgetPortrait(canvas: HTMLCanvasElement): void {
    if (!this.portraitFor) return;
    this.portraitFor = '';
    this.portrait = null;
    this.portraitPending = false;
    if (canvas.getContext('2d')) {
      this.portraits.drawCrest(canvas, crestIdForEntity('npc', undefined));
    }
  }

  /** A face is captured off the frame, so the panel repaints while that face is still
   *  owed: when the capture its speaker waits on lands, and once when portraits first
   *  become paintable (a line can arrive before the character files do, and an ask
   *  made then starts no capture). One listener for the controller's life, acting on
   *  whatever speaker the panel holds now. */
  private listenForPortrait(): void {
    if (this.portraitListening) return;
    this.portraitListening = true;
    // Already paintable: the ask just made started its capture, so only its landing matters.
    if (!portraitsReady()) onPortraitsReady(() => this.repaintPortrait());
    onPortraitUpdate((visualKey, skin, key) => {
      if (
        this.portraitPending &&
        this.portrait &&
        nonPlayerPortraitUpdateFrames(this.portrait, { visualKey, skin, key })
      ) {
        this.repaintPortrait();
      }
    });
  }
}
