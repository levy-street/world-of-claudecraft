// One batched Canvas2D compositor for every overhead nameplate. The renderer
// owns character/object views; this painter owns resolved label state, numeric
// projection, decluttering, text/image caches, and the single canvas surface.

import * as THREE from 'three';
import { ABILITIES, MOBS, QUESTS } from '../sim/data';
import { specialRoleColor } from '../sim/discord_roles';
import { isQuestGatedEntityHidden } from '../sim/quest_gated_entity';
import {
  npcQuestMarkerKind,
  type QuestMarkerKind,
  strongerQuestMarker,
} from '../sim/quests/quest_marker_kind';
import { type Entity, GATHER_CAST_ID } from '../sim/types';
import { deedTitleText } from '../ui/deed_i18n';
import { devTierBadgeDataUrl, devTierByIndex, devTierNameOutlineColor } from '../ui/dev_tier';
import { discordRoleTagLabel } from '../ui/discord_role_tag';
import { tEntity } from '../ui/entity_i18n';
import { holderTierBadgeDataUrl, holderTierByIndex } from '../ui/holder_tier';
import { formatNumber, getI18nRevision, t } from '../ui/i18n';
import { raidMarkerDataUrl } from '../ui/icons';
import { localizeSimAuraName } from '../ui/sim_i18n';
import { type IWorld, OVERHEAD_EMOTES } from '../world_api';

import { castBarState } from './cast_bar';
import { mobDisplayName, npcDisplayName, objectDisplayName } from './entity_labels';
import {
  createNameplateCanvasState,
  type NameplateCanvasState,
  NameplateCanvasSurface,
  type NameplateMarkerTone,
} from './nameplate_canvas';
import { COMBO_PIP_MAX } from './nameplate_combo';
import { declutterNameplatesInPlace, type NameplateAnchor } from './nameplate_declutter';
import {
  isNameplateScreenAnchorVisible,
  isProjectedNameplateAnchorVisible,
} from './nameplate_projection';
import { type NameplatePlan, nameplatePlanInto, newNameplatePlan } from './nameplate_view';
import { FRIENDLY, isFriendlyPet, mobNameColor } from './reaction';
import type { EntityView } from './renderer';

const NAMEPLATE_LEVEL_NUMBER_OPTIONS = { maximumFractionDigits: 0 } as const;
const HOLDER_BADGE_URLS = new Map<number, string>();
const DEV_BADGE_URLS = new Map<number, string>();

const emoteIconUrl = (id: string): string => `/ui/emotes/emote-${id}.png`;

function holderBadgeUrl(index: number): string {
  const cached = HOLDER_BADGE_URLS.get(index);
  if (cached) return cached;
  const tier = holderTierByIndex(index);
  if (!tier) return '';
  const url = holderTierBadgeDataUrl(tier, 32);
  HOLDER_BADGE_URLS.set(index, url);
  return url;
}

function devBadgeUrl(index: number): string {
  const cached = DEV_BADGE_URLS.get(index);
  if (cached) return cached;
  const tier = devTierByIndex(index);
  if (!tier) return '';
  const url = devTierBadgeDataUrl(tier, 32);
  DEV_BADGE_URLS.set(index, url);
  return url;
}

function setBadge(
  badges: NameplateCanvasState['badges'],
  index: number,
  url: string,
  size: number,
  circular: boolean,
  border: string | undefined,
  glow: string | undefined,
): number {
  const current = badges[index] ?? { url, size };
  current.url = url;
  current.size = size;
  current.circular = circular;
  current.border = border;
  current.glow = glow;
  badges[index] = current;
  return index + 1;
}

export interface NameplatePainterDeps {
  views: Map<number, EntityView>;
  camera: THREE.PerspectiveCamera;
  world: IWorld;
  layer: HTMLElement;
  getViewport: () => { width: number; height: number };
  getDevicePixelRatio?: () => number;
  showNameplates: () => boolean;
  showDevBadges: () => boolean;
  showOwnNameplate: () => boolean;
  showPlayerNameplates: () => boolean;
  isHostilePlayer: (e: Entity) => boolean;
}

export class NameplatePainter {
  private readonly views: Map<number, EntityView>;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world: IWorld;
  private readonly getViewport: () => { width: number; height: number };
  private readonly getDevicePixelRatio: () => number;
  private readonly showNameplates: () => boolean;
  private readonly showDevBadges: () => boolean;
  private readonly showOwnNameplate: () => boolean;
  private readonly showPlayerNameplates: () => boolean;
  private readonly isHostilePlayer: (e: Entity) => boolean;
  private readonly surface: NameplateCanvasSurface;
  private readonly states = new Map<number, NameplateCanvasState>();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly plan: NameplatePlan = newNameplatePlan();
  private readonly anchorScratch: NameplateAnchor[] = [];
  private anchorCount = 0;
  private i18nRevision = -1;
  // Quest-marker inputs (the shared quest_marker_kind rule), resolved lazily
  // on the first quest-bearing plate of a pass and dropped at every full
  // pass: craftingIdentity is a per-access allocation on the offline Sim,
  // and an urgent town-NPC plate reaches the content branch at frame rate on
  // throttled passes too, so a per-frame resolve tripled that cost for a
  // marker whose inputs move on turn-in cadence. questsDone is held by
  // REFERENCE: live on the offline Sim (one Set mutated in place), frozen on
  // the online ClientWorld (replaced wholesale per qdone snapshot). The
  // identity re-check at the resolve site heals that replacement immediately
  // (and re-reads the cadence mirror with it, since a turn-in ships qdone
  // and cprof in the same snapshot), so the one remaining stale window is a
  // cprof-only change (a cadence lapse) on a throttled pass, bounded by one
  // nameplate interval: the tier-scaled 1/24s to 1/15s plate staleness floor
  // that already throttles every field identically (ruling recorded in the
  // phase 23 QA record, docs/design/professions-tuning-packet-review.md:
  // inside the sanctioned envelope, not a fairness gate). A throttled pass
  // reuses the snapshot when one exists and resolves it fresh otherwise.
  private questMarkerCtx: {
    questsDone: ReadonlySet<string>;
    cadenceBlocked: ReadonlySet<string> | undefined;
  } | null = null;

  constructor(deps: NameplatePainterDeps) {
    this.views = deps.views;
    this.camera = deps.camera;
    this.world = deps.world;
    this.getViewport = deps.getViewport;
    this.getDevicePixelRatio =
      deps.getDevicePixelRatio ??
      (() => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
    this.showNameplates = deps.showNameplates;
    this.showDevBadges = deps.showDevBadges;
    this.showOwnNameplate = deps.showOwnNameplate;
    this.showPlayerNameplates = deps.showPlayerNameplates;
    this.isHostilePlayer = deps.isHostilePlayer;
    this.surface = new NameplateCanvasSurface(deps.layer);
  }

  update(fullPass: boolean): void {
    const world = this.world;
    const player = world.player;
    const { width, height } = this.getViewport();
    const revision = getI18nRevision();
    const languageChanged = revision !== this.i18nRevision;
    if (languageChanged) {
      this.i18nRevision = revision;
      this.surface.clearTextCache();
    }
    this.surface.beginFrame(width, height, this.getDevicePixelRatio());
    this.anchorCount = 0;

    const showNameplates = this.showNameplates();
    const showDevBadges = this.showDevBadges();
    const showOwnNameplate = this.showOwnNameplate();
    const showPlayerNameplates = this.showPlayerNameplates();
    // Drop the quest-marker snapshot at every full pass so it re-resolves
    // lazily below; throttled passes reuse it (see the field's rationale).
    if (fullPass) this.questMarkerCtx = null;

    for (const [id, view] of this.views) {
      const entity = world.entities.get(id);
      if (!entity) continue;
      // Quest-gated mobs (Broodmother eggs): no nameplate or hp bar for players not
      // on the gating quest, so the clutch reads as inert scenery until you have it.
      // The canvas pass draws only what it reaches, so skipping the entity is the
      // whole hide (the removed DOM-era hideNameplate had to clear styles instead).
      if (isQuestGatedEntityHidden(entity, world.questLog)) continue;
      // the saddle lift rides the anchor so a mounted player's plate clears the head
      const plan = nameplatePlanInto(
        this.plan,
        entity,
        player,
        view.height + view.mountLift,
        showNameplates,
        showOwnNameplate,
        showPlayerNameplates,
      );
      if (plan.hidden) continue;

      this.tmpV.copy(view.group.position);
      this.tmpV.y += plan.anchorYOffset;
      if (!isProjectedNameplateAnchorVisible(this.camera, this.tmpV, this.tmpV2)) continue;
      this.tmpV.project(this.camera);
      if (this.tmpV.z < -1 || this.tmpV.z > 1) continue;
      const screenX = (this.tmpV.x * 0.5 + 0.5) * width;
      const screenY = (-this.tmpV.y * 0.5 + 0.5) * height;
      if (!isNameplateScreenAnchorVisible(screenX, screenY, width, height)) continue;

      const anchor = this.anchorScratch[this.anchorCount];
      if (anchor) {
        anchor.id = id;
        anchor.sx = screenX;
        anchor.sy = screenY;
      } else {
        this.anchorScratch.push({ id, sx: screenX, sy: screenY });
      }
      this.anchorCount++;

      let state = this.states.get(id);
      if (!state) {
        state = createNameplateCanvasState();
        this.states.set(id, state);
      }
      this.updateDynamicState(state, entity, player, plan, languageChanged);
      if (!state.initialized || fullPass || plan.urgent || languageChanged) {
        this.resolveContent(state, entity, player, plan, showOwnNameplate, showDevBadges);
      }
    }

    declutterNameplatesInPlace(this.anchorScratch, this.anchorCount);
    for (let i = 0; i < this.anchorCount; i++) {
      const anchor = this.anchorScratch[i];
      const state = this.states.get(anchor.id);
      if (state) this.surface.drawBase(state, anchor.sx, anchor.sy);
    }
    // Emotes paint last on the same canvas so they remain legible over other
    // nameplates without restoring a per-entity compositor layer.
    for (let i = 0; i < this.anchorCount; i++) {
      const anchor = this.anchorScratch[i];
      const state = this.states.get(anchor.id);
      if (state) this.surface.drawEmote(state, anchor.sx, anchor.sy);
    }
  }

  remove(id: number): void {
    this.states.delete(id);
  }

  dispose(): void {
    this.states.clear();
    this.surface.dispose();
  }

  private updateDynamicState(
    state: NameplateCanvasState,
    entity: Entity,
    player: Entity,
    plan: NameplatePlan,
    languageChanged: boolean,
  ): void {
    state.currentTarget = entity.id === player.targetId;
    // Enemy PLAYERS too, not just mobs: a battleground/duel/arena opponent
    // must read hostile-red, never friendly-blue (same predicate the
    // dead-enemy arm below already trusts).
    state.hostile = entity.hostile || (entity.kind === 'player' && this.isHostilePlayer(entity));
    state.deadEnemy =
      entity.dead && (entity.hostile || (entity.kind === 'player' && this.isHostilePlayer(entity)));
    state.myPet = entity.ownerId === player.id;
    state.threat = plan.threat;
    state.comboPips = Math.max(0, Math.min(COMBO_PIP_MAX, plan.comboPips));
    state.hpFill = entity.hp / Math.max(1, entity.maxHp);

    const cast = castBarState(entity);
    state.castVisible = cast.visible;
    state.castFill = cast.fill;
    state.castChannel = cast.channel;
    if (cast.visible && (languageChanged || state.castSource !== cast.label)) {
      state.castSource = cast.label;
      state.castLabel = cast.fishing
        ? t('abilityUi.cast.fishing')
        : cast.label === GATHER_CAST_ID
          ? t('abilityUi.cast.gathering')
          : ABILITIES[cast.label]
            ? tEntity({ kind: 'ability', id: cast.label, field: 'name' })
            : cast.label;
    } else if (!cast.visible) {
      state.castSource = '';
      state.castLabel = '';
    }
  }

  private resolveContent(
    state: NameplateCanvasState,
    entity: Entity,
    player: Entity,
    plan: NameplatePlan,
    showOwnNameplate: boolean,
    showDevBadges: boolean,
  ): void {
    state.initialized = true;
    state.name = '';
    state.nameColor = '#fff';
    state.level = '';
    state.levelColor = '#fff';
    state.guild = '';
    state.guildLabel = '';
    state.title = '';
    state.marker = '';
    state.markerTone = 'none';
    state.hpVisible = false;
    state.opacity = 1;
    state.frame = '';
    state.aiLabel = '';
    state.devOutline = null;
    state.raidMarkerUrl = '';
    state.emoteIconUrl = '';
    state.emoteLabel = '';
    state.friendlyPet = false;

    const raidMark = this.world.markerFor(entity.id);
    if (raidMark !== null) state.raidMarkerUrl = raidMarkerDataUrl(raidMark);

    let emote = null;
    if (entity.overheadEmoteId) {
      for (const candidate of OVERHEAD_EMOTES) {
        if (candidate.id === entity.overheadEmoteId) {
          emote = candidate;
          break;
        }
      }
    }
    if (emote && entity.kind === 'player' && !entity.dead && plan.hasOverheadEmote) {
      state.emoteIconUrl = emoteIconUrl(emote.id);
      state.emoteLabel = t(`hudChrome.emotes.${emote.id}`);
    }

    if (entity.kind === 'object') {
      state.badges.length = 0;
      state.name = objectDisplayName(entity);
      state.nameColor = '#c084ff';
      return;
    }

    if (entity.kind === 'player') {
      let badgeCount = 0;
      const suppressSelf = entity.id === player.id && !showOwnNameplate;
      if (suppressSelf) {
        state.badges.length = 0;
        return;
      }
      const roleColor = specialRoleColor(entity.discordRole);
      const roleTag = discordRoleTagLabel(entity.discordRole);
      const baseName = roleTag ? `[${roleTag}] ${entity.name}` : entity.name;
      state.name = entity.afk ? `<${t('hudChrome.nameplate.afkTag')}> ${baseName}` : baseName;
      state.nameColor = roleColor ?? '#7fb8ff';
      state.guild = entity.guild;
      // Build the drawn `<guild>` wrapper here, not in the per-frame drawBase:
      // resolveContent is guild's only writer and runs strictly less often (the
      // init / fullPass / urgent / languageChanged gate), so the label can
      // never diverge from the guild it wraps.
      if (entity.guild) state.guildLabel = `<${entity.guild}>`;
      state.hpVisible = !entity.dead;
      state.title = entity.title ? deedTitleText(entity.title) : '';
      state.aiLabel = entity.aiAccount === true ? t('hudChrome.playerMenu.aiTag') : '';
      state.devOutline = showDevBadges ? devTierNameOutlineColor(entity.devTier ?? 0) : null;
      for (const aura of entity.auras) {
        if (aura.kind === 'stealth') {
          state.opacity = 0.55;
          break;
        }
      }

      const holder = holderTierByIndex(entity.holderTier ?? 0);
      if (holder) {
        badgeCount = setBadge(
          state.badges,
          badgeCount,
          holderBadgeUrl(holder.index),
          15,
          false,
          undefined,
          holder.glow,
        );
      }
      const developer = showDevBadges ? devTierByIndex(entity.devTier ?? 0) : undefined;
      if (developer) {
        badgeCount = setBadge(
          state.badges,
          badgeCount,
          devBadgeUrl(developer.index),
          15,
          false,
          undefined,
          developer.glow,
        );
      }
      if (entity.discordAvatar) {
        badgeCount = setBadge(
          state.badges,
          badgeCount,
          entity.discordAvatar,
          24,
          true,
          '#5865f2',
          undefined,
        );
      }
      state.badges.length = badgeCount;
      return;
    }

    state.badges.length = 0;

    if (entity.kind === 'npc' || (!entity.hostile && entity.questIds.length > 0)) {
      state.name =
        entity.kind === 'npc'
          ? npcDisplayName(entity.templateId)
          : tEntity({ kind: 'mob', id: entity.templateId, field: 'name' });
      state.nameColor = FRIENDLY;
      const questMarker = this.questMarker(entity);
      state.marker = questMarker.marker;
      state.markerTone = questMarker.tone;
      return;
    }

    const template = MOBS[entity.templateId];
    const elite = !!template?.elite;
    const boss = !!template?.boss;
    state.friendlyPet = isFriendlyPet(entity, this.world.entities, this.isHostilePlayer);
    const mobName =
      entity.ownerId !== null
        ? (localizeSimAuraName(entity.name) ?? entity.name)
        : mobDisplayName(entity.templateId);
    state.name = entity.dead ? t('worldContent.corpseName', { name: mobName }) : mobName;
    state.nameColor = '#fff';
    state.level = entity.dead
      ? ''
      : t(elite ? 'hudChrome.nameplate.mobEliteLevel' : 'hudChrome.nameplate.mobLevel', {
          level: formatNumber(entity.level, NAMEPLATE_LEVEL_NUMBER_OPTIONS),
        });
    state.levelColor = mobNameColor(entity.level - player.level, entity.dead, state.friendlyPet);
    state.hpVisible = !entity.dead;
    state.marker = entity.lootable ? '$' : elite && !entity.dead ? '◆' : '';
    state.markerTone = state.marker ? 'loot' : 'none';
    state.frame = entity.dead ? '' : boss ? 'boss' : elite ? 'elite' : '';
  }

  // Role-aware via the shared quest_marker_kind rule: '!' only at the
  // quest's giver (gold first-offer, blue repeat, dimmed cooldown), '?' only
  // at its turn-in NPC. The nameplate is the ONE surface that renders the
  // gray in-progress state, so 'active' joins its fold at its shared rank
  // (beating cooldown: an in-progress turn-in here is the more actionable
  // signal); the minimap, map, and gossip list filter 'active' per quest
  // instead, since they never drew it.
  private questMarker(entity: Entity): { marker: string; tone: NameplateMarkerTone } {
    if (entity.questIds.length > 0) {
      // A changed questsDone identity means the online mirror replaced the
      // history Set: drop the snapshot and re-resolve now, instead of folding
      // a fresh questState against stale history for the rest of the pass
      // (see the field's rationale).
      if (this.questMarkerCtx && this.questMarkerCtx.questsDone !== this.world.questsDone) {
        this.questMarkerCtx = null;
      }
      if (!this.questMarkerCtx) {
        const blocked = this.world.craftingIdentity?.cadenceBlockedQuests;
        this.questMarkerCtx = {
          questsDone: this.world.questsDone,
          cadenceBlocked: blocked && blocked.length > 0 ? new Set(blocked) : undefined,
        };
      }
    }
    let folded: QuestMarkerKind = 'none';
    for (const questId of entity.questIds) {
      const quest = QUESTS[questId];
      if (!quest || !this.questMarkerCtx) continue;
      folded = strongerQuestMarker(
        folded,
        npcQuestMarkerKind(
          quest,
          entity.templateId,
          this.world.questState(questId),
          this.questMarkerCtx.questsDone,
          this.questMarkerCtx.cadenceBlocked,
        ),
      );
      if (folded === 'ready') break; // nothing outranks the '?'
    }
    const marker = folded === 'none' ? '' : folded === 'ready' || folded === 'active' ? '?' : '!';
    const tone: NameplateMarkerTone =
      folded === 'ready' || folded === 'available'
        ? 'quest'
        : folded === 'repeat' || folded === 'active' || folded === 'cooldown'
          ? folded
          : 'none';
    return { marker, tone };
  }
}
