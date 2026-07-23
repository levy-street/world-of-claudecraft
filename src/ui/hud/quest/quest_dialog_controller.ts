import { DELVES, ITEMS, NPCS, QUESTS, questRewardItem } from '../../../sim/data';
import { CHRONICLER_TEMPLATE_IDS } from '../../../sim/deeds';
import { craftsForPairTarget } from '../../../sim/professions/archetype';
import { professionQuestSelectionTargets } from '../../../sim/quests/profession_quest_effects';
import {
  dist2d,
  type Entity,
  type ItemDef,
  isQuestTurnInNpc,
  questObjectiveRequired,
} from '../../../sim/types';
import type { IWorld } from '../../../world_api';
import { archetypeTitleText, craftNameText } from '../../char_window';
import { decorativeArtImg } from '../../decorative_art';
import { markDialogRoot } from '../../dialog_root';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import type { FocusTrapHandle } from '../../focus_manager';
import { t } from '../../i18n';
import { QUALITY_COLOR } from '../../icons';
import { archetypeImageUrl } from '../../profession_art';
import { buildAttunementPreview } from '../../profession_identity_view';
import { svgIcon } from '../../ui_icons';
import { isStationMasterNpc } from '../vendor/train_view';
import { gossipMenuIsEmpty } from './gossip_menu';
import { PROF_INTRO_QUEST_ID, professionIntroHintVisible } from './prof_intro_hint_core';

export interface QuestDialogTextPort {
  npcName(templateId: string): string;
  mobName(templateId: string): string;
  npcTitle(templateId: string): string;
  npcGreeting(templateId: string, playerClass: IWorld['cfg']['playerClass'], name: string): string;
  delveName(delveId: string): string;
  questTitle(questId: string): string;
  questNarrative(questId: string, field: 'text' | 'completion', playerName: string): string;
  objectiveLabel(questId: string, objectiveIndex: number): string;
  number(value: number): string;
  progress(label: string, current: number, total: number): string;
  suggestedPlayers(count?: number): string;
  money(copper: number): string;
}

export interface QuestDialogControllerDeps {
  element: HTMLElement;
  document: Document;
  world(): IWorld;
  now(): number;
  text: QuestDialogTextPort;
  openFocusTrap(root: () => HTMLElement | null): FocusTrapHandle;
  closeTransient(): void;
  hideTooltip(): void;
  itemIcon(item: ItemDef): string;
  itemTooltip(item: ItemDef): string;
  attachTooltip(element: HTMLElement, html: () => string): void;
  openChronicles(): void;
  openVendor(npcId: number): void;
  openHeroicVendor(npcId: number): void;
  openTrain(npcId: number): void;
  openUnbind(npcId: number): void;
  openMarket(): void;
  openDelveBoard(npcId: number): void;
  openValeCup(): void;
  openCardDuel(): void;
  onOpenChange(open: boolean): void;
  voice: {
    play(key: string): void;
    isPlaying(): boolean;
    setDistance(distance: number | null): void;
  };
}

interface ProfessionPreviewContent {
  text: string;
  crestUrl: string | null;
}

/** Owns gossip, quest details, shared quest links, focus, and dialogue voice state. */
export class QuestDialogController {
  private npcId: number | null = null;
  private detailQuestId: string | null = null;
  // The profession-intro hint visibility as of the last gossip render (null =
  // no gossip list currently painted): the one identity-driven row in this
  // dialog, so it is the whole staleness signature refreshIfChanged watches.
  private lastIntroHintVisible: boolean | null = null;
  private trap: FocusTrapHandle | null = null;
  private openedAt = 0;
  private voiceNpcId: number | null = null;
  private openState = false;

  constructor(private readonly deps: QuestDialogControllerDeps) {}

  get isOpen(): boolean {
    return this.openState;
  }

  open(npcId: number): void {
    const world = this.deps.world();
    const npc = world.entities.get(npcId);
    if (npc?.kind !== 'npc') return;
    if (NPCS[npc.templateId]?.banker) {
      world.targetEntity(npc.id);
      world.interact();
      return;
    }
    if ((CHRONICLER_TEMPLATE_IDS as readonly string[]).includes(npc.templateId)) {
      world.targetEntity(npc.id);
      world.interact();
      this.deps.openChronicles();
      return;
    }
    this.beginOpen();
    this.openedAt = this.deps.now();
    this.ensureFocusTrap();
    this.deps.closeTransient();
    this.deps.voice.play(`greeting__${npc.templateId}`);
    this.voiceNpcId = npc.id;
    this.renderGossip(npc);
  }

  openLinked(questId: string, fromPid?: number): void {
    const quest = QUESTS[questId];
    if (!quest) return;
    this.beginOpen();
    this.npcId = null;
    this.ensureFocusTrap();
    this.deps.closeTransient();
    const world = this.deps.world();
    const state = world.questState(questId);
    const inSharerParty =
      fromPid !== undefined &&
      (world.partyInfo?.members.some((member) => member.pid === fromPid) ?? false);
    markDialogRoot(this.deps.element, { labelledBy: 'quest-dialog-title' });
    let html = `<div class="panel-title"><span id="quest-dialog-title">${esc(this.deps.text.questTitle(questId))}${this.deps.text.suggestedPlayers(quest.suggestedPlayers)} <span class="quest-muted">&lt;${esc(t('hudChrome.questShare.dialogTitle'))}&gt;</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('questUi.dialog.close'))}">${svgIcon('close')}</button></div>`;
    if (quest.minLevel) {
      html += `<div class="qd-req">${esc(t('questUi.detail.requiresLevel', { level: this.deps.text.number(quest.minLevel) }))}</div>`;
    }
    html += `<div class="qd-text">${esc(this.deps.text.questNarrative(questId, 'text', world.player.name))}</div>`;
    html += `<div class="qd-sub">${esc(t('questUi.detail.objectives'))}</div>`;
    html += quest.objectives
      .map(
        (objective, index) =>
          `<div class="qd-obj">${esc(this.deps.text.progress(this.deps.text.objectiveLabel(questId, index), 0, objective.count))}</div>`,
      )
      .join('');
    html += this.rewardsHtml(questId);
    this.deps.element.innerHTML = html;
    this.attachRewardTooltip(questId);
    if (inSharerParty && state === 'available') {
      const button = this.makeButton(t('questUi.dialog.accept'));
      button.addEventListener('click', () => {
        if (fromPid === undefined) return;
        this.deps.world().acceptLinkedQuest(questId, fromPid);
        this.close();
      });
      this.deps.element.appendChild(button);
    } else {
      const hint = this.deps.document.createElement('div');
      hint.className = 'qd-req';
      hint.textContent = !inSharerParty
        ? t('hudChrome.questShare.viewOnlyHint')
        : state === 'done'
          ? t('hudChrome.questShare.alreadyDone')
          : state === 'active' || state === 'ready'
            ? t('hudChrome.questShare.alreadyOn')
            : t('hudChrome.questShare.ineligible');
      this.deps.element.appendChild(hint);
    }
    this.bindClose();
    this.showAndFocus();
  }

  close(restoreFocus = true): void {
    this.deps.element.style.display = 'none';
    this.npcId = null;
    this.detailQuestId = null;
    this.lastIntroHintVisible = null;
    this.deps.hideTooltip();
    this.trap?.release(restoreFocus);
    this.trap = null;
    if (this.openState) {
      this.openState = false;
      this.deps.onOpenChange(false);
    }
  }

  refresh(): void {
    if (this.npcId === null || this.deps.element.style.display !== 'block') return;
    const npc = this.deps.world().entities.get(this.npcId);
    if (npc) this.renderGossip(npc);
    else this.close();
  }

  /** Repaint the open gossip list only when the profession-intro hint's
   *  visibility flipped under it: online, the cprof identity mirror can land
   *  AFTER the dialog opened (attunement retires the hint), and no quest
   *  event fires for that edge. The quest-detail view never shows the hint
   *  and is left alone; everything else in the gossip list repaints through
   *  the quest event arms, so an unchanged signature never rebuilds the DOM
   *  (the dialog holds focus-trapped buttons). */
  refreshIfChanged(): void {
    if (this.npcId === null || this.deps.element.style.display !== 'block') return;
    if (this.detailQuestId !== null || this.lastIntroHintVisible === null) return;
    const npc = this.deps.world().entities.get(this.npcId);
    if (!npc) return;
    if (this.introHintVisibleFor(npc) !== this.lastIntroHintVisible) this.refresh();
  }

  relocalize(): void {
    if (this.deps.element.style.display !== 'block' || this.npcId === null) return;
    const npc = this.deps.world().entities.get(this.npcId);
    if (!npc) {
      this.close();
      return;
    }
    if (this.detailQuestId && QUESTS[this.detailQuestId]) {
      this.renderQuestDetail(npc, this.detailQuestId);
    } else {
      this.renderGossip(npc);
    }
  }

  updateVoice(): void {
    if (this.voiceNpcId === null) return;
    if (!this.deps.voice.isPlaying()) {
      this.voiceNpcId = null;
      return;
    }
    const world = this.deps.world();
    const npc = world.entities.get(this.voiceNpcId);
    this.deps.voice.setDistance(npc ? dist2d(world.player.pos, npc.pos) : null);
  }

  updateProximity(): void {
    if (this.npcId === null) return;
    const world = this.deps.world();
    const npc = world.entities.get(this.npcId);
    if (!npc || dist2d(world.player.pos, npc.pos) > 8) this.close();
  }

  clearVoiceSource(): void {
    this.voiceNpcId = null;
  }

  private ensureFocusTrap(): void {
    if (this.deps.element.style.display !== 'block') {
      this.trap = this.deps.openFocusTrap(() => this.deps.element);
    }
  }

  private beginOpen(): void {
    if (this.openState) return;
    this.openState = true;
    this.deps.onOpenChange(true);
  }

  /** The one rule for the intro hint row, shared by the gossip render and the
   *  staleness probe so the two can never drift. */
  private introHintVisibleFor(npc: Entity): boolean {
    const world = this.deps.world();
    return professionIntroHintVisible(
      npc.templateId,
      world.questState(PROF_INTRO_QUEST_ID),
      world.craftingIdentity.attunedPairs.length > 0,
    );
  }

  private renderGossip(npc: Entity, closeIfEmpty = false): void {
    const world = this.deps.world();
    const definition = NPCS[npc.templateId];
    const interesting = npc.questIds.filter((questId) => {
      const state = world.questState(questId);
      return (
        (state === 'available' && QUESTS[questId].giverNpcId === npc.templateId) ||
        (state === 'ready' && isQuestTurnInNpc(QUESTS[questId], npc.templateId))
      );
    });
    const discussionQuests = [...world.questLog.values()]
      .filter((progress) => progress.state === 'active' && npc.questIds.includes(progress.questId))
      .filter((progress) =>
        QUESTS[progress.questId].objectives.some(
          (objective, objectiveIndex) =>
            objective.type === 'interact' &&
            objective.targetNpcId === npc.templateId &&
            progress.counts[objectiveIndex] <
              questObjectiveRequired(QUESTS[progress.questId], progress, objectiveIndex),
        ),
      )
      .map((progress) => progress.questId);
    const hasVendor = npc.vendorItems.length > 0;
    // Station master (Professions 2.0): the resident master of a
    // crafting station (stations content masterNpcId) offers recipe training.
    const hasTraining = isStationMasterNpc(npc.templateId);
    const hasMarket = !!definition?.market;
    const hasHeroicVendor = !!definition?.heroicVendor;
    const hasDelveBoard = Object.values(DELVES).some(
      (delve) => delve.boardNpcId === npc.templateId,
    );
    const hasValeCup = npc.templateId === 'groundskeeper_bram';
    const hasCardMaster = !!definition?.cardMaster;
    if (
      closeIfEmpty &&
      gossipMenuIsEmpty({
        questCount: interesting.length,
        discussionCount: discussionQuests.length,
        hasVendor,
        hasMarket,
        hasHeroicVendor,
        hasDelveBoard,
        hasVcup: hasValeCup,
        hasCardMaster,
        hasTraining,
      })
    ) {
      this.close();
      return;
    }
    this.npcId = npc.id;
    this.detailQuestId = null;
    markDialogRoot(this.deps.element, { labelledBy: 'quest-dialog-title' });
    const npcName = definition
      ? this.deps.text.npcName(npc.templateId)
      : this.deps.text.mobName(npc.templateId);
    const npcTitle = definition ? this.deps.text.npcTitle(definition.id) : '';
    let html = `<div class="panel-title"><span id="quest-dialog-title">${esc(npcName)}<span class="quest-muted"> &lt;${esc(npcTitle)}&gt;</span></span><button type="button" class="x-btn" data-close aria-label="${esc(t('questUi.dialog.close'))}">${svgIcon('close')}</button></div>`;
    html += `<div class="qd-text">"${esc(definition ? this.deps.text.npcGreeting(definition.id, world.cfg.playerClass, world.player.name) : t('questUi.dialog.greetingFallback'))}"</div>`;
    // Locked-quest hint row: a profession master's
    // dialog points a pre-q_prof_intro viewer at the intro quest's giver, so
    // the Guild trend letter never lands on a greeting-plus-vendor dead end.
    // Non-interactive, the qd-req hint family; both names arrive through the
    // text port so they localize like every other dialog line.
    const introHintVisible = this.introHintVisibleFor(npc);
    this.lastIntroHintVisible = introHintVisible;
    if (introHintVisible) {
      html += `<div class="qd-req" data-prof-intro-hint="1">${esc(
        t('questUi.dialog.profIntroHint', {
          name: this.deps.text.npcName(QUESTS[PROF_INTRO_QUEST_ID].giverNpcId),
          quest: this.deps.text.questTitle(PROF_INTRO_QUEST_ID),
        }),
      )}</div>`;
    }
    for (const questId of interesting) {
      const state = world.questState(questId);
      const icon =
        state === 'ready' ? '<span class="gold">?</span> ' : '<span class="gold">!</span> ';
      const title = this.deps.text.questTitle(questId);
      const aria =
        state === 'ready'
          ? t('questUi.dialog.readyQuestAria', { name: title })
          : t('questUi.dialog.availableQuestAria', { name: title });
      html += `<button type="button" class="qd-list-item" data-quest="${esc(questId)}" aria-label="${esc(aria)}">${icon}${esc(title)}</button>`;
    }
    for (const questId of discussionQuests) {
      const title = this.deps.text.questTitle(questId);
      html += `<button type="button" class="qd-list-item" data-discuss="${esc(questId)}" aria-label="${esc(t('questUi.dialog.discussQuestAria', { name: title }))}"><span class="gold">?</span> ${esc(t('questUi.dialog.discussQuest', { name: title }))}</button>`;
    }
    if (hasVendor) {
      html += `<button type="button" class="qd-list-item" data-vendor="1" aria-label="${esc(t('questUi.dialog.browseGoodsAria', { name: npcName }))}"><span class="quest-complete">$</span> ${esc(t('questUi.dialog.browseGoods'))}</button>`;
    }
    if (hasTraining) {
      html += `<button type="button" class="qd-list-item" data-train="1" aria-label="${esc(t('hudChrome.training.dialogOptionAria', { name: npcName }))}"><span class="gold">${svgIcon('crafting')}</span> ${esc(t('hudChrome.training.dialogOption'))}</button>`;
      // Maker's Bond unbind service (Professions 2.0): every
      // station master offers it beside training (the same isStationMasterNpc
      // gate, so the empty-menu check needs no new arm).
      html += `<button type="button" class="qd-list-item" data-unbind="1" aria-label="${esc(t('hudChrome.unbind.dialogOptionAria', { name: npcName }))}"><span class="gold">${svgIcon('crafting')}</span> ${esc(t('hudChrome.unbind.dialogOption'))}</button>`;
    }
    if (hasMarket) {
      html += `<button type="button" class="qd-list-item" data-market="1" aria-label="${esc(t('questUi.dialog.worldMarketAria'))}"><span class="gold">${svgIcon('market')}</span> ${esc(t('questUi.dialog.worldMarket'))}</button>`;
    }
    if (hasHeroicVendor) {
      html += `<button type="button" class="qd-list-item" data-heroic-shop="1" aria-label="${esc(t('questUi.dialog.browseGoodsAria', { name: npcName }))}"><span class="quest-complete">$</span> ${esc(t('questUi.dialog.browseGoods'))}</button>`;
    }
    if (hasDelveBoard) {
      const delve = Object.values(DELVES).find((entry) => entry.boardNpcId === npc.templateId);
      const label = delve ? this.deps.text.delveName(delve.id) : t('delveUi.board.openDelve');
      html += `<button type="button" class="qd-list-item" data-delve-board="1" aria-label="${esc(t('delveUi.board.openDelveAria', { name: npcName }))}"><span class="gold">${svgIcon('skull')}</span> ${esc(label)}</button>`;
    }
    if (hasValeCup) {
      html += `<button type="button" class="qd-list-item" data-vcup="1" aria-label="${esc(t('hudChrome.vcup.gossipOpenAria'))}"><span class="gold">${svgIcon('ball')}</span> ${esc(t('hudChrome.vcup.gossipOpen'))}</button>`;
    }
    if (hasCardMaster) {
      html += `<button type="button" class="qd-list-item" data-card-duel="1" aria-label="${esc(t('cardDuel.title'))}"><span class="gold">&#9824;</span> ${esc(t('cardDuel.title'))}</button>`;
    }
    this.deps.element.innerHTML = html;
    this.deps.element.querySelectorAll<HTMLElement>('[data-quest]').forEach((item) => {
      item.addEventListener('click', () => this.renderQuestDetail(npc, item.dataset.quest ?? ''));
    });
    this.deps.element.querySelectorAll<HTMLButtonElement>('[data-discuss]').forEach((item) => {
      item.addEventListener('click', () => {
        const liveWorld = this.deps.world();
        liveWorld.targetEntity(npc.id);
        liveWorld.interact();
        item.disabled = true;
      });
    });
    this.bindRoute('[data-vendor]', () => this.deps.openVendor(npc.id));
    this.bindRoute('[data-heroic-shop]', () => this.deps.openHeroicVendor(npc.id));
    this.bindRoute('[data-train]', () => this.deps.openTrain(npc.id));
    this.bindRoute('[data-unbind]', () => this.deps.openUnbind(npc.id));
    this.bindRoute('[data-market]', this.deps.openMarket);
    this.bindRoute('[data-delve-board]', () => this.deps.openDelveBoard(npc.id));
    this.bindRoute('[data-vcup]', this.deps.openValeCup);
    this.bindRoute('[data-card-duel]', this.deps.openCardDuel);
    this.bindClose();
    this.showAndFocus();
  }

  private renderQuestDetail(npc: Entity, questId: string): void {
    const quest = QUESTS[questId];
    const world = this.deps.world();
    this.detailQuestId = questId;
    const state = world.questState(questId);
    const narrative = this.deps.text.questNarrative(
      questId,
      state === 'ready' ? 'completion' : 'text',
      world.player.name,
    );
    this.deps.voice.play(
      state === 'ready' ? `quest__${questId}__complete` : `quest__${questId}__offer`,
    );
    this.voiceNpcId = npc.id;
    markDialogRoot(this.deps.element, { labelledBy: 'quest-dialog-title' });
    let html = `<div class="panel-title"><span id="quest-dialog-title">${esc(this.deps.text.questTitle(questId))}${this.deps.text.suggestedPlayers(quest.suggestedPlayers)}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('questUi.dialog.close'))}">${svgIcon('close')}</button></div>`;
    if (state === 'available' && quest.minLevel) {
      html += `<div class="qd-req">${esc(t('questUi.detail.requiresLevel', { level: this.deps.text.number(quest.minLevel) }))}</div>`;
    }
    html += `<div class="qd-text">${esc(narrative)}</div>`;
    if (state !== 'ready') {
      const progress = world.questLog.get(questId);
      html += `<div class="qd-sub">${esc(t('questUi.detail.objectives'))}</div>`;
      html += quest.objectives
        .map((objective, index) => {
          const required = progress
            ? questObjectiveRequired(quest, progress, index)
            : quest.resolvedObjectiveCounts === 'archetypeAmends'
              ? world.craftingIdentity.amendsRequired
              : objective.count;
          return `<div class="qd-obj">${esc(this.deps.text.progress(this.deps.text.objectiveLabel(questId, index), progress ? Math.min(progress.counts[index], required) : 0, required))}</div>`;
        })
        .join('');
    }
    let professionTargets: string[] = [];
    let professionPreviewContent: ((target: string) => ProfessionPreviewContent) | null = null;
    let initialProfessionPreview: ProfessionPreviewContent | null = null;
    if (state === 'available' && quest.completionEffect) {
      const identity = world.craftingIdentity;
      professionTargets = professionQuestSelectionTargets(quest, {
        activeArchetype: identity.activeArchetype,
        pairedMajor: identity.pairedMajor,
        hobbyCraft: identity.hobbyCraft,
        attunedPairs: [...identity.attunedPairs],
        switchCount: identity.switchCount,
        amendsProgress: identity.amendsProgress,
      });
      const options = professionTargets
        .map((target) => {
          const pair = craftsForPairTarget(target);
          // A pair target leads with its archetype name and keeps both craft
          // names visible so the choice stays informative, e.g.
          // "Smith (Weaponcrafting + Armorcrafting)"; a single-craft target
          // (the hobby-switch quest) is just the craft name.
          const label = pair
            ? t('hudChrome.crafting.pairOptionLabel', {
                pair: archetypeTitleText(target),
                craftA: craftNameText(pair[0]),
                craftB: craftNameText(pair[1]),
              })
            : craftNameText(target);
          return `<option value="${esc(target)}">${esc(label)}</option>`;
        })
        .join('');
      professionPreviewContent = (target) => {
        if (quest.completionEffect?.type === 'switchHobby') {
          return {
            text: t('hudChrome.crafting.hobbyPreview', { hobby: craftNameText(target) }),
            crestUrl: null,
          };
        }
        const preview = buildAttunementPreview(target, identity.craftSkills, identity.switchCount);
        if (!preview) return { text: '', crestUrl: null };
        // The pre-commit picture: majors, hobby, and retained-but-dormant
        // knowledge, PLUS the escalating make-amends return cost (closing the
        // 2039 gap). Two complete localized sentences joined, the
        // combo line + status precedent (crafting_window.ts).
        const base = t('hudChrome.crafting.attunementPreview', {
          title: archetypeTitleText(preview.target),
          majorA: craftNameText(preview.majors[0]),
          majorB: craftNameText(preview.majors[1]),
          hobby: craftNameText(preview.hobbyCraft),
        });
        const returnCost = t('hudChrome.crafting.attunementReturnCost', {
          cost: this.deps.text.number(preview.returnCost),
        });
        return {
          text: `${base} ${returnCost}`,
          crestUrl: archetypeImageUrl(preview.target),
        };
      };
      initialProfessionPreview = professionTargets[0]
        ? professionPreviewContent(professionTargets[0])
        : { text: t('hudChrome.crafting.noProfessionChoice'), crestUrl: null };
      html += `<label class="qd-profession-choice">${esc(t('hudChrome.crafting.professionChoice'))}<select data-profession-selection aria-label="${esc(t('hudChrome.crafting.professionChoice'))}">${options}</select></label><div class="qd-profession-preview" data-profession-preview></div>`;
    }
    html += this.rewardsHtml(questId);
    this.deps.element.innerHTML = html;
    const professionSelect = this.deps.element.querySelector<HTMLSelectElement>(
      '[data-profession-selection]',
    );
    const professionPreview = this.deps.element.querySelector<HTMLElement>(
      '[data-profession-preview]',
    );
    if (professionPreview && initialProfessionPreview) {
      this.paintProfessionPreview(professionPreview, initialProfessionPreview);
      // The initial preview is already visible when the dialog opens. Enable
      // announcements only after that first paint so it does not talk over the
      // dialog title; subsequent select changes replace this region once.
      professionPreview.setAttribute('aria-live', 'polite');
      professionPreview.setAttribute('aria-atomic', 'true');
    }
    if (professionSelect && professionPreviewContent && professionPreview) {
      professionSelect.addEventListener('change', () => {
        const content = professionPreviewContent?.(professionSelect.value);
        if (content) this.paintProfessionPreview(professionPreview, content);
      });
    }
    this.attachRewardTooltip(questId);
    if (state === 'available') {
      const button = this.makeButton(t('questUi.dialog.accept'));
      if (quest.completionEffect && professionTargets.length === 0) button.disabled = true;
      button.addEventListener('click', () => {
        const liveWorld = this.deps.world();
        const selection = this.deps.element.querySelector<HTMLSelectElement>(
          '[data-profession-selection]',
        )?.value;
        if (selection === undefined) liveWorld.acceptQuest(questId);
        else liveWorld.acceptQuest(questId, selection);
        liveWorld.reportTelemetry('quest_accept', {
          timeMs: this.deps.now() - this.openedAt,
        });
        this.renderGossip(npc, true);
      });
      this.deps.element.appendChild(button);
    } else if (state === 'ready') {
      const button = this.makeButton(t('questUi.dialog.completeQuest'));
      button.addEventListener('click', () => {
        const liveWorld = this.deps.world();
        liveWorld.turnInQuest(questId);
        liveWorld.reportTelemetry('quest_turnin', {
          timeMs: this.deps.now() - this.openedAt,
        });
        this.renderGossip(npc, true);
      });
      this.deps.element.appendChild(button);
    }
    const back = this.makeButton(t('questUi.dialog.back'));
    back.addEventListener('click', () => this.renderGossip(npc));
    this.deps.element.appendChild(back);
    this.bindClose();
    this.showAndFocus();
  }

  private rewardsHtml(questId: string): string {
    const world = this.deps.world();
    const quest = QUESTS[questId];
    let html = `<div class="qd-sub">${esc(t('questUi.detail.rewards'))}</div>`;
    html += `<div class="qd-obj">${esc(t('questUi.detail.xpReward', { xp: this.deps.text.number(quest.xpReward) }))} &nbsp; ${this.deps.text.money(quest.copperReward)}</div>`;
    const rewardItemId = questRewardItem(quest, world.cfg.playerClass);
    if (rewardItemId) {
      const item = ITEMS[rewardItemId];
      html += `<div class="qd-reward-row" data-reward><span class="qd-reward-label">${esc(t('questUi.detail.itemReward'))}</span>${this.deps.itemIcon(item)}<span class="qd-reward-name" style="color:${QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff'}">${esc(itemDisplayName(item))}</span></div>`;
    }
    return html;
  }

  private attachRewardTooltip(questId: string): void {
    const rewardItemId = questRewardItem(QUESTS[questId], this.deps.world().cfg.playerClass);
    const row = this.deps.element.querySelector<HTMLElement>('[data-reward]');
    if (row && rewardItemId) {
      this.deps.attachTooltip(row, () => this.deps.itemTooltip(ITEMS[rewardItemId]));
    }
  }

  private makeButton(label: string): HTMLButtonElement {
    const button = this.deps.document.createElement('button');
    button.className = 'btn';
    button.type = 'button';
    button.textContent = label;
    return button;
  }

  private paintProfessionPreview(element: HTMLElement, content: ProfessionPreviewContent): void {
    const copy = this.deps.document.createElement('span');
    copy.className = 'qd-profession-preview-copy';
    copy.textContent = content.text;
    if (!content.crestUrl) {
      element.replaceChildren(copy);
      return;
    }
    element.replaceChildren(
      decorativeArtImg(this.deps.document, 'qd-profession-crest', content.crestUrl),
      copy,
    );
  }

  private bindRoute(selector: string, open: () => void): void {
    this.deps.element.querySelector(selector)?.addEventListener('click', () => {
      this.close(false);
      open();
    });
  }

  private bindClose(): void {
    this.deps.element.querySelector('[data-close]')?.addEventListener('click', () => this.close());
  }

  private showAndFocus(): void {
    this.deps.element.style.display = 'block';
    this.trap?.focusFirst();
  }
}
