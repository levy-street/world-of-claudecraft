// Thin Three/DOM painter for the overhead nameplates (v0.16.0). Owns the
// per-entity nameplate elements (name, hp bar, marker,
// raid mark, combo pips, holder-tier badge, overhead emote, cast bar): it
// projects each rig's anchor with the camera and writes the show/hide, transform,
// and localized content to the EntityView DOM nodes the renderer built.
//
// All the gameplay-free DECISIONS (visible/hidden, the anchor lift, urgency, the
// threat plate, the combo count) come from the pure nameplate_view core; this
// file is the Humble Object that turns that plan into Three projection + DOM, and
// localizes the names via i18n (the core stays i18n-free, like cast_bar).
//
// Not a 2D-canvas painter: nameplates are positioned DOM divs, so the canvas
// getComputedStyle-once token rule is N/A here. The reaction/marker
// colors below are pre-existing renderer literals moved verbatim from
// updateNameplates (reworking them into CSS tokens is out of scope); the
// no-magic-values requirement here is the named per-tier interval (see
// ui_tier_knobs.nameplateIntervalSec), which the renderer reads, not the painter.

import * as THREE from 'three';
import { ABILITIES, MOBS, QUESTS } from '../sim/data';
import { specialRoleColor } from '../sim/discord_roles';
import { type Entity, isQuestTurnInNpc } from '../sim/types';
import { deedTitleText } from '../ui/deed_i18n';
import {
  devTierBadgeDataUrl,
  devTierByIndex,
  devTierDisplayName,
  devTierNameOutlineColor,
} from '../ui/dev_tier';
import { discordRoleTagLabel } from '../ui/discord_role_tag';
import { tEntity } from '../ui/entity_i18n';
import {
  holderTierBadgeDataUrl,
  holderTierByIndex,
  holderTierDisplayName,
} from '../ui/holder_tier';
import { formatNumber, getLanguage, t } from '../ui/i18n';
import { raidMarkerDataUrl } from '../ui/icons';
import { type IWorld, OVERHEAD_EMOTES } from '../world_api';

import { castBarState } from './cast_bar';
import { mobDisplayName, npcDisplayName, objectDisplayName } from './entity_labels';
import { COMBO_PIP_MAX } from './nameplate_combo';
import { declutterNameplatesInPlace, type NameplateAnchor } from './nameplate_declutter';
import {
  isProjectedNameplateAnchorVisible,
  nameplateScreenTransform,
} from './nameplate_projection';
import { type NameplatePlan, nameplatePlanInto, newNameplatePlan } from './nameplate_view';
import { FRIENDLY, isFriendlyPet, mobNameColor } from './reaction';
import type { EntityView } from './renderer';

const emoteIconUrl = (id: string): string => `/ui/emotes/emote-${id}.png`;

export interface NameplatePainterDeps {
  /** the per-entity view pool the renderer owns (keyed by entity id) */
  views: Map<number, EntityView>;
  camera: THREE.PerspectiveCamera;
  world: IWorld;
  /** current viewport (px); read each pass because the renderer reassigns it on resize */
  getViewport: () => { width: number; height: number };
  /** the player's mob-nameplate toggle */
  showNameplates: () => boolean;
  /** the player's developer-badge display toggle (glyph + name outline) */
  showDevBadges: () => boolean;
  /** the player's own-nameplate toggle: render your own plate as others see it */
  showOwnNameplate: () => boolean;
  /** PvP reaction check, owned by the renderer (duel/arena state) */
  isHostilePlayer: (e: Entity) => boolean;
}

export class NameplatePainter {
  private readonly views: Map<number, EntityView>;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world: IWorld;
  private readonly getViewport: () => { width: number; height: number };
  private readonly showNameplates: () => boolean;
  private readonly showDevBadges: () => boolean;
  private readonly showOwnNameplate: () => boolean;
  private readonly isHostilePlayer: (e: Entity) => boolean;
  // scratch reused every frame (no per-frame alloc); was renderer.tmpV/tmpV2.
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  // one plan, rewritten per entity by the pure core (allocation-light hot path).
  private readonly plan: NameplatePlan = newNameplatePlan();
  // This frame's projected anchors, fed through the declutter pass below so
  // overlapping nameplates (e.g. two nearby same-named mobs) stack apart
  // instead of rendering on top of each other. The anchor OBJECTS are pooled
  // too, not just the array: at crowd size this loop runs for every visible
  // plate every frame, and a fresh {id,sx,sy} per plate was steady GC churn
  // proportional to the player count. `anchorCount` is the live prefix length.
  private readonly anchorScratch: NameplateAnchor[] = [];
  private anchorCount = 0;

  constructor(deps: NameplatePainterDeps) {
    this.views = deps.views;
    this.camera = deps.camera;
    this.world = deps.world;
    this.getViewport = deps.getViewport;
    this.showNameplates = deps.showNameplates;
    this.showDevBadges = deps.showDevBadges;
    this.showOwnNameplate = deps.showOwnNameplate;
    this.isHostilePlayer = deps.isHostilePlayer;
  }

  // Project and refresh every nameplate. On a throttled pass (fullPass=false) only
  // urgent plates (targeted / very close / casting) update their content; every
  // visible plate still re-projects so positions never lag the camera.
  update(fullPass: boolean): void {
    const world = this.world;
    const p = world.player;
    const { width: w, height: h } = this.getViewport();
    const showNameplates = this.showNameplates();
    const showDevBadges = this.showDevBadges();
    const showOwnNameplate = this.showOwnNameplate();
    this.anchorCount = 0;
    for (const [id, v] of this.views) {
      const e = world.entities.get(id);
      if (!e) continue;
      const plan = nameplatePlanInto(this.plan, e, p, v.height, showNameplates, showOwnNameplate);
      if (plan.hidden) {
        this.hideNameplate(v);
        continue;
      }
      this.tmpV.copy(v.group.position);
      this.tmpV.y += plan.anchorYOffset;
      if (!isProjectedNameplateAnchorVisible(this.camera, this.tmpV, this.tmpV2)) {
        this.hideNameplate(v);
        continue;
      }
      this.tmpV.project(this.camera);
      if (this.tmpV.z < -1 || this.tmpV.z > 1) {
        this.hideNameplate(v);
        continue;
      }
      const sx = (this.tmpV.x * 0.5 + 0.5) * w;
      const sy = (-this.tmpV.y * 0.5 + 0.5) * h;
      // Record the anchor; the transform is written once, after declutter has
      // had its say, so a plate never builds two transform strings per frame.
      const slot = this.anchorScratch[this.anchorCount];
      if (slot) {
        slot.id = id;
        slot.sx = sx;
        slot.sy = sy;
      } else {
        this.anchorScratch.push({ id, sx, sy });
      }
      this.anchorCount++;
      if (v.nameplateDisplay !== '') {
        v.nameplate.style.display = '';
        v.nameplateDisplay = '';
      }
      const isCurrentTarget = id === p.targetId;
      const deadEnemy = e.dead && (e.hostile || (e.kind === 'player' && this.isHostilePlayer(e)));
      v.nameplate.classList.toggle('np-current-target', isCurrentTarget);
      v.nameplate.classList.toggle('np-hostile', e.hostile);
      v.nameplate.classList.toggle('np-dead-enemy', deadEnemy);
      v.nameplate.classList.toggle('np-my-pet', e.ownerId === p.id);
      v.nameplate.classList.toggle('np-aggroed-on-me', e.aggroTargetId === p.id);
      if (!fullPass && !plan.urgent) continue;
      const isSelf = id === p.id;
      v.nameplate.classList.toggle('has-emote', plan.hasOverheadEmote);

      // party raid/target marker (only mobs are markable, so this is null elsewhere)
      const emote = e.overheadEmoteId
        ? OVERHEAD_EMOTES.find((x) => x.id === e.overheadEmoteId)
        : null;
      if (emote && e.kind === 'player' && !e.dead) {
        v.emoteIconEl.src = emoteIconUrl(emote.id);
        const emoteLabel = t(`hudChrome.emotes.${emote.id}`);
        v.emoteLabelEl.textContent = emoteLabel;
        v.emoteEl.title = emoteLabel;
        v.emoteEl.style.display = '';
      } else {
        v.emoteEl.style.display = 'none';
      }
      v.nameEl.style.display = '';

      const raidMark = world.markerFor(e.id);
      if (raidMark !== null) {
        v.raidMarkEl.style.backgroundImage = `url(${raidMarkerDataUrl(raidMark)})`;
        v.raidMarkEl.style.display = '';
      } else {
        v.raidMarkEl.style.display = 'none';
      }

      // combo points the local player has built on this entity (rogue/druid)
      this.setNameplateCombo(v, plan.comboPips);

      if (e.kind === 'object') {
        // dungeon doorways announce themselves
        const objName = objectDisplayName(e);
        this.setNameplateStatic(
          v,
          `object|${objName}`,
          objName,
          '#c084ff',
          'none',
          '',
          'np-marker',
          '1',
        );
        this.setNameplateLevel(v, '', '');
      } else if (e.kind === 'player') {
        // Players: friendly blue with an hp bar; <Guild> tag under the name. Your
        // OWN plate is normally suppressed (suppressSelf), but with the "Show My
        // Nameplate" option on it renders exactly like another player's, so you can
        // see your name / level / hp / guild and all your flair the way others do.
        const suppressSelf = isSelf && !showOwnNameplate;
        const opacity = e.auras.some((a) => a.kind === 'stealth') ? '0.55' : '1';
        const nameDisplay = suppressSelf ? 'none' : '';
        const hpDisplay = e.dead || suppressSelf ? 'none' : '';
        const guild = suppressSelf ? '' : e.guild;
        // Staff/special Discord role: tint the name + prefix a tag.
        const roleKey = suppressSelf ? undefined : e.discordRole;
        const roleColor = specialRoleColor(roleKey);
        const roleTag = discordRoleTagLabel(roleKey);
        const displayName = roleTag ? `[${roleTag}] ${e.name}` : e.name;
        // Significant-contributor outline: a glowing outline drawn on top of the
        // existing name color (Discord staff or default) for a high dev tier, so
        // both read at once. Null for non-significant tiers, for a suppressed self
        // plate, and when the player has turned developer badges off.
        const devOutline =
          suppressSelf || !showDevBadges ? null : devTierNameOutlineColor(e.devTier ?? 0);
        // Operator-set AI-account tag. It rides the SIGNATURE (like every other
        // static field): without it, an admin flipping the flag on a live account
        // would never repaint the plate, because nothing else in the sig changed.
        const isAi = !suppressSelf && e.aiAccount === true;
        this.setNameplateStatic(
          v,
          `player|${displayName}|${roleColor ?? ''}|${guild}|${nameDisplay}|${hpDisplay}|${opacity}|${devOutline ?? ''}|${isAi ? 1 : 0}|${deadEnemy ? 1 : 0}`,
          displayName,
          deadEnemy ? null : (roleColor ?? '#7fb8ff'),
          hpDisplay,
          '',
          'np-marker',
          opacity,
          '',
          guild,
          devOutline,
          isAi,
        );
        v.nameEl.style.display = nameDisplay;
        // $WOC holder-tier flair (hidden only on a suppressed self plate).
        this.setNameplateTier(v, suppressSelf ? 0 : (e.holderTier ?? 0));
        // Developer-badge flair.
        this.setNameplateDevTier(v, suppressSelf || !showDevBadges ? 0 : (e.devTier ?? 0));
        // Linked-Discord PFP indicator.
        this.setNameplateDiscord(v, suppressSelf ? undefined : e.discordAvatar, e.discordName);
        // Book of Deeds title subtitle (the `title` wire field, a deed id).
        this.setNameplateTitle(v, suppressSelf ? undefined : e.title);
        this.setNameplateHp(v, e);
        this.setNameplateLevel(v, '', '');
      } else if (e.kind === 'npc' || (!e.hostile && e.questIds.length > 0)) {
        const npcName =
          e.kind === 'npc'
            ? npcDisplayName(e.templateId)
            : tEntity({ kind: 'mob', id: e.templateId, field: 'name' });
        let marker = '';
        let cls = '';
        // role-aware: '!' only at the quest's giver, '?' only at its turn-in
        // NPC (gray while in progress), matching the gossip dialog
        for (const qid of e.questIds) {
          const quest = QUESTS[qid];
          if (!quest) continue;
          const st = world.questState(qid);
          if (st === 'ready' && isQuestTurnInNpc(quest, e.templateId)) {
            marker = '?';
            cls = 'ready';
            break;
          }
          if (st === 'available' && quest.giverNpcId === e.templateId) {
            marker = '!';
            cls = 'avail';
          } else if (st === 'active' && isQuestTurnInNpc(quest, e.templateId) && !marker) {
            marker = '?';
            cls = 'active';
          }
        }
        const markerClass = cls ? `np-marker ${cls}` : 'np-marker';
        this.setNameplateStatic(
          v,
          `npc|${npcName}|${marker}|${markerClass}`,
          npcName,
          FRIENDLY,
          'none',
          marker,
          markerClass,
          '1',
        );
        this.setNameplateLevel(v, '', '');
        v.nameplate.classList.remove('np-friendly-pet');
      } else {
        const diff = e.level - p.level;
        const template = MOBS[e.templateId];
        const elite = !!template?.elite;
        const boss = !!template?.boss;
        // A friendly controlled pet reads as friendly green; wild mobs keep the
        // classic level-difference ("con") color.
        const friendlyPet = isFriendlyPet(e, world.entities, this.isHostilePlayer);
        const color = mobNameColor(diff, e.dead, friendlyPet);
        v.nameplate.classList.toggle('np-friendly-pet', friendlyPet);
        const mobName = e.ownerId !== null ? e.name : mobDisplayName(e.templateId);
        const levelText = e.dead
          ? ''
          : t(elite ? 'hudChrome.nameplate.mobEliteLevel' : 'hudChrome.nameplate.mobLevel', {
              level: formatNumber(e.level, { maximumFractionDigits: 0 }),
            });
        const displayName = e.dead ? t('worldContent.corpseName', { name: mobName }) : mobName;
        const hpDisplay = e.dead ? 'none' : '';
        // Quest-target marking lives in the mob's hover tooltip (Questie-style
        // quest + progress lines), not as an overhead glyph: the marker slot
        // stays the classic lootable '$' / elite diamond pair.
        const marker = e.lootable ? '$' : elite && !e.dead ? '◆' : '';
        // classic "dragon frame" cue: gold bar frame for elites, red for bosses (live mobs only)
        const frame = e.dead ? '' : boss ? 'boss' : elite ? 'elite' : '';
        this.setNameplateStatic(
          v,
          `mob|${displayName}|${levelText}|${color}|${hpDisplay}|${marker}|${frame}`,
          displayName,
          deadEnemy ? null : '#fff',
          hpDisplay,
          marker,
          'np-marker loot',
          '1',
          frame,
        );
        this.setNameplateLevel(v, levelText, color);
        this.setNameplateHp(v, e);
        // threat plate: tint the bar red when this mob is aggroed on me
        v.nameplate.classList.toggle('np-threat', plan.threat);
      }

      this.updateCastBar(v, e);
    }

    // Second pass: re-anchor any nameplates that collided during projection
    // (e.g. two nearby same-named mobs) so they stack apart instead of
    // rendering fully on top of each other. A no-op for the common case
    // where nothing overlapped. This is also where EVERY visible plate gets
    // its one transform write of the frame.
    declutterNameplatesInPlace(this.anchorScratch, this.anchorCount);
    for (let i = 0; i < this.anchorCount; i++) {
      const anchor = this.anchorScratch[i];
      const v = this.views.get(anchor.id);
      if (v?.nameplateDisplay !== '') continue;
      const transform = nameplateScreenTransform(anchor.sx, anchor.sy);
      if (transform !== v.nameplateTransform) {
        v.nameplate.style.transform = transform;
        v.nameplateTransform = transform;
      }
    }
  }

  private hideNameplate(v: EntityView): void {
    if (v.nameplateDisplay !== 'none') {
      v.nameplate.style.display = 'none';
      v.nameplateDisplay = 'none';
    }
    v.nameplate.classList.remove('np-current-target');
    v.nameplate.classList.remove('np-hostile');
    v.nameplate.classList.remove('np-dead-enemy');
    v.nameplate.classList.remove('np-my-pet');
    v.nameplate.classList.remove('np-aggroed-on-me');
    v.nameplate.classList.remove('np-friendly-pet');
  }

  private setNameplateStatic(
    v: EntityView,
    sig: string,
    name: string,
    color: string | null,
    hpDisplay: string,
    marker: string,
    markerClass: string,
    opacity: string,
    frame = '',
    guild = '',
    devOutline: string | null = null,
    isAi = false,
  ): void {
    if (sig === v.nameplateSig) return;
    v.nameplateSig = sig;
    v.nameEl.textContent = name;
    if (color === null) {
      v.nameEl.style.removeProperty('color');
    } else {
      v.nameEl.style.color = color;
    }
    v.hpBar.style.display = hpDisplay;
    v.hpBar.classList.toggle('elite', frame === 'elite');
    v.hpBar.classList.toggle('boss', frame === 'boss');
    v.markerEl.textContent = marker;
    v.markerEl.className = markerClass;
    v.nameplate.style.opacity = opacity;
    // guild tag rides in the sig (players only); empty for every other kind
    if (guild) {
      v.guildEl.textContent = `<${guild}>`;
      v.guildEl.style.display = '';
    } else {
      v.guildEl.style.display = 'none';
    }
    // Significant-contributor name outline: a steady glow (no animation, so it is
    // reduced-motion safe) layered over whatever name color applies. Driven by a
    // CSS var + class so the color stays out of the TS (no hardcoded hex here).
    if (devOutline) {
      v.nameEl.style.setProperty('--dev-outline', devOutline);
      v.nameEl.classList.add('np-sig-dev');
    } else {
      v.nameEl.style.removeProperty('--dev-outline');
      v.nameEl.classList.remove('np-sig-dev');
    }
    // Operator-set AI-account tag: a class toggle on its own span (the same shape as
    // the --dev-outline outline above, so the colours stay in CSS and no hex literal
    // enters this file). Nameplates are positioned DOM divs, so this is a toggle, not
    // a repaint. .np-ai collapses on its own; .ai-tag is the shared gradient mark.
    // (No title here: the plate is pointer-events:none, so nothing could hover it.)
    v.aiEl.textContent = isAi ? t('hudChrome.playerMenu.aiTag') : '';
    v.aiEl.classList.toggle('ai-tag', isAi);
  }

  // Show/hide the $WOC holder-tier badge on a player's nameplate. Cheap-diffed
  // on the tier value so the badge image is only rebuilt when the tier changes.
  private setNameplateTier(v: EntityView, tier: number): void {
    if (tier === v.tierValue) return;
    v.tierValue = tier;
    const def = holderTierByIndex(tier);
    if (def) {
      v.tierEl.src = holderTierBadgeDataUrl(def, 32);
      v.tierEl.title = t('wallet.holderTierTitle', { tier: holderTierDisplayName(def) });
      v.tierEl.style.display = '';
    } else {
      v.tierEl.removeAttribute('src');
      v.tierEl.style.display = 'none';
    }
  }

  // Show/hide the developer-badge on a player's nameplate. Cheap-diffed on the
  // tier value so the badge image is only rebuilt when the tier changes.
  private setNameplateDevTier(v: EntityView, tier: number): void {
    if (tier === v.devTierValue) return;
    v.devTierValue = tier;
    const def = devTierByIndex(tier);
    if (def) {
      v.devTierEl.src = devTierBadgeDataUrl(def, 32);
      v.devTierEl.title = t('hudChrome.devBadge.badgeTitle', { tier: devTierDisplayName(def) });
      v.devTierEl.style.display = '';
    } else {
      v.devTierEl.removeAttribute('src');
      v.devTierEl.style.display = 'none';
    }
  }

  // Show/hide the Book of Deeds title subtitle under a player's name (the
  // entity `title` wire field, a deed id; empty means untitled). Cheap-diffed
  // per (language, title id) so the id-to-text resolution and the DOM write
  // only run when either changes: no per-frame string work.
  private setNameplateTitle(v: EntityView, titleId: string | null | undefined): void {
    const sig = titleId ? `${getLanguage()}|${titleId}` : '';
    if (sig === v.titleSig) return;
    v.titleSig = sig;
    // A stale/unknown deed id (content drift) resolves to '' and hides the line.
    const text = titleId ? deedTitleText(titleId) : '';
    if (text !== '') {
      v.titleEl.textContent = text;
      v.titleEl.style.display = '';
    } else {
      v.titleEl.style.display = 'none';
    }
  }

  // Show/hide the linked-Discord PFP on a player's nameplate. Cheap-diffed on the
  // avatar URL so the external image is only (re)fetched when it changes.
  private setNameplateDiscord(
    v: EntityView,
    avatar: string | undefined,
    name: string | undefined,
  ): void {
    const sig = avatar ?? '';
    if (sig === v.discordAvatarSig) return;
    v.discordAvatarSig = sig;
    if (avatar) {
      v.discordEl.src = avatar;
      v.discordEl.title = name
        ? t('hudChrome.discord.linkedTitle', { name })
        : t('hudChrome.discord.title');
      v.discordEl.style.display = '';
    } else {
      v.discordEl.removeAttribute('src');
      v.discordEl.style.display = 'none';
    }
  }

  private setNameplateHp(v: EntityView, e: Entity): void {
    const width = `${((100 * e.hp) / Math.max(1, e.maxHp)).toFixed(1)}%`;
    if (width === v.nameplateHpWidth) return;
    v.nameplateHpWidth = width;
    v.hpFill.style.width = width;
  }

  // Show/hide the mob level badge (e.g. "[5]" / "[5+]") in its own element.
  // levelText='' hides the element (used for players, NPCs, objects, and dead mobs).
  // Cheap-diffed on (levelText|color) so no DOM write on unchanged entities.
  private setNameplateLevel(v: EntityView, levelText: string, color: string): void {
    const sig = `${levelText}|${color}`;
    if (sig === v.levelSig) return;
    v.levelSig = sig;
    if (levelText) {
      v.levelEl.textContent = levelText;
      v.levelEl.style.color = color;
      v.levelEl.style.display = '';
    } else {
      v.levelEl.style.display = 'none';
    }
  }

  // Light `count` of the COMBO_PIP_MAX pips over this nameplate; hide the row
  // entirely at zero so non-combo classes/targets show nothing.
  private setNameplateCombo(v: EntityView, count: number): void {
    const n = Math.max(0, Math.min(COMBO_PIP_MAX, count));
    const sig = `${n}`;
    if (sig === v.comboSig) return;
    v.comboSig = sig;
    v.comboRow.style.display = n > 0 ? '' : 'none';
    for (let i = 0; i < v.comboPips.length; i++) {
      v.comboPips[i].classList.toggle('lit', i < n);
    }
  }

  // Overhead spell cast/channel bar. The fill + label rules live in the DOM-free
  // castBarState() helper (cast_bar.ts); here we just push them to the DOM. Casts
  // fill up toward completion, channels drain down, both honest to the live cast
  // fields the sim and the online snapshot already expose.
  private updateCastBar(v: EntityView, e: Entity): void {
    const st = castBarState(e);
    if (!st.visible) {
      if (v.castBar.style.display !== 'none') v.castBar.style.display = 'none';
      return;
    }
    v.castBar.style.display = '';
    v.castBar.classList.toggle('channel', st.channel);
    v.castFill.style.width = `${(st.fill * 100).toFixed(1)}%`;
    // cast_bar.ts keeps st.label as a stable id (DOM/i18n-free); localize here.
    v.castLabel.textContent = st.fishing
      ? t('abilityUi.cast.fishing')
      : ABILITIES[st.label]
        ? tEntity({ kind: 'ability', id: st.label, field: 'name' })
        : st.label;
  }
}
