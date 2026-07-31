// Compatibility facade for non-positional UI and event sounds.
//
// GameAudio keeps the established HUD-facing method surface while delegating
// playback, loading, voice limits, and volume control to the sampled SFX engine.

import type { GatherNodeType } from '../sim/types';
import { sfx } from './sfx';

// Minimum seconds between repeats of the SAME error cue: spamming an ability
// on cooldown, or holding a cast with no mana, would otherwise refire the
// bloop every failed attempt. Per-key (via sfx.playUi's own cooldown option),
// so an unrelated error class right after still sounds immediately.
const ERROR_SFX_COOLDOWN_SECONDS = 1.5;

// Exported ONLY so tests/game_audio.test.ts's catalog-completeness guard can
// walk every leaf key against the real SFX_FIXED_CATALOG_KEYS; not consumed
// anywhere else (GameAudio's methods are the real call surface).
export const UI_CUES = {
  bagOpen: 'ui_bag_open',
  bagClose: 'ui_bag_close',
  click: 'ui_click',
  coin: 'ui_coin',
  levelUp: 'ui_level_up',
  questReady: 'quest_ready',
  achievement: 'ui_achievement',
  cosmeticUnlock: 'ui_cosmetic_unlock',
  lootItem: 'ui_loot_item',
  questDone: 'ui_quest_done',
  whisper: 'ui_whisper',
  sheep: 'ui_sheep',
  death: 'ui_death',
  arenaLoss: 'ui_arena_loss',
  playerDeath: 'player_death',
  readyCheck: 'ui_ready_check',
  weaponSheathe: 'ui_weapon_sheathe',
  weaponUnsheathe: 'ui_weapon_unsheathe',
  error: 'ui_error',
  duelChallenge: 'ui_duel_challenge',
  duelCountdown: 'ui_duel_countdown',
  duelStart: 'ui_duel_start',
  vcupKickoff: 'ui_vcup_kickoff',
  duelEnd: 'ui_duel_end',
  fiestaWords: ['ui_fiesta_word_0', 'ui_fiesta_word_1', 'ui_fiesta_word_2', 'ui_fiesta_word_3'],
  fiestaScoreMine: 'ui_fiesta_score_mine',
  fiestaScoreOther: 'ui_fiesta_score_other',
  fiestaWave: 'ui_fiesta_wave',
  fiestaAugment: 'ui_fiesta_augment',
  fiestaDown: 'ui_fiesta_down',
  fiestaRevive: 'ui_fiesta_revive',
  // Card Duel minigame (src/sim/social/card_duel.ts). cardShuffle covers both
  // the initial deal (cardDuelMatchStart) and a mid-match reshuffle
  // (cardRoundResolved.reshuffled); match win/lose deliberately reuse the
  // existing duelEnd/arenaLoss cues rather than new recordings (Jamie's
  // 2026-07-19 design call).
  cardPlay: 'ui_card_play',
  cardReveal: 'ui_card_reveal',
  cardRoundPush: 'ui_card_round_push',
  cardShuffle: 'ui_card_shuffle',
  // Gathering rhythm (Professions 2.0 Phase 12b, issue #2208): fishCast/
  // fishBite/fishReel are real, shipped fishing cues. gatherCast branches by
  // node type (gatherCastByNodeType below); this flat cue is only the
  // fallback for the rare case gatherCast() is called with no type known.
  // fishBite is the one gameplay-timing cue of the family (the reel window
  // opens with it), so it rides the ungated play() arm; the rest are
  // feedback notifications.
  gatherCast: 'ui_gather_cast',
  fishCast: 'ui_fish_cast',
  fishBite: 'ui_fish_bite',
  fishReel: 'ui_fish_reel',
  // Gathering (#1729/#1866 gatherResult event): one cue per GatherNodeType,
  // replacing the old flat gatherStrike/gatherRare placeholders.
  gatherByNodeType: {
    ore: 'ui_gather_ore',
    wood: 'ui_gather_wood',
    herb: 'ui_gather_herb',
  },
  // The gather-cast "pulling a tool out" affordance, one recording per node
  // type (mirrors gatherByNodeType above): a pickaxe for ore, an axe for
  // wood, a knife/pouch for herb.
  gatherCastByNodeType: {
    ore: 'ui_gather_cast_ore',
    wood: 'ui_gather_cast_wood',
    herb: 'ui_gather_cast_herb',
  },
  // Rare-or-better gather stinger: layers alongside the gatherByNodeType cue
  // above, never a replacement for it, one tier per rolled MaterialRarity
  // (common/uncommon get none).
  gatherRareTier: {
    rare: 'ui_gather_rare',
    epic: 'ui_gather_epic',
    legendary: 'ui_gather_legendary',
  },
  // Crafting completion: one cue per CRAFT_RING craft family, keyed by the
  // recipe's professionId (src/sim/content/professions.ts).
  craftByFamily: {
    engineering: 'ui_craft_engineering',
    alchemy: 'ui_craft_alchemy',
    cooking: 'ui_craft_cooking',
    leatherworking: 'ui_craft_leatherworking',
    tailoring: 'ui_craft_tailoring',
    inscription: 'ui_craft_inscription',
    enchanting: 'ui_craft_enchanting',
    jewelcrafting: 'ui_craft_jewelcrafting',
    weaponcrafting: 'ui_craft_weaponcrafting',
    armorcrafting: 'ui_craft_armorcrafting',
  },
  // Masterwork proc: layers alongside the craftByFamily cue above, never a
  // replacement for it (Jamie's explicit design call, 2026-07-18).
  masterwork: 'ui_masterwork',
  disenchant: 'ui_craft_disenchant',
  salvage: 'ui_craft_salvage',
  // Reuses the same recording as craftByFamily.enchanting above (one
  // enchanting-profession take, no separate apply-enchant recording): that
  // craftByFamily slot never actually fires (see its comment), so there is
  // no conflict sharing the file with the real applyEnchant/enchantResult
  // action here.
  enchant: 'ui_craft_enchanting',
} as const;

type UiCue =
  | Exclude<(typeof UI_CUES)[keyof typeof UI_CUES], readonly string[] | Record<string, string>>
  | (typeof UI_CUES.fiestaWords)[number]
  | (typeof UI_CUES.gatherByNodeType)[keyof typeof UI_CUES.gatherByNodeType]
  | (typeof UI_CUES.gatherCastByNodeType)[keyof typeof UI_CUES.gatherCastByNodeType]
  | (typeof UI_CUES.gatherRareTier)[keyof typeof UI_CUES.gatherRareTier]
  | (typeof UI_CUES.craftByFamily)[keyof typeof UI_CUES.craftByFamily];

export class GameAudio {
  private vol = 1;
  // Gates the discrete interface/feedback cues (loot, level, quest, whisper, error,
  // ...) plus the combat avoid cues the HUD reads via `feedbackEnabled`. On by
  // default; driven by the `interfaceSfx` setting. World/spatial sounds and the
  // gameplay-timing cues (ready check, duel countdown) are unaffected.
  private feedbackOn = true;

  /** Set SFX volume (0..1). Safe before init(). */
  setVolume(value: number): void {
    this.vol = Math.min(1, Math.max(0, value));
    sfx.setVolume(this.vol);
  }

  get volume(): number {
    return this.vol;
  }

  /** Enable/disable the interface and feedback cues (the `interfaceSfx` setting).
   *  On by default; when off, the notification "beeps" fall silent while the SFX
   *  volume slider and the spatial world sounds are untouched. Safe before init(). */
  setFeedbackEnabled(value: boolean): void {
    this.feedbackOn = value;
  }

  /** Whether the interface/feedback cues are on. The HUD reads this to gate the
   *  combat avoid cues (miss/dodge/parry) it plays through the spatial engine. */
  get feedbackEnabled(): boolean {
    return this.feedbackOn;
  }

  /** Initialize sampled playback. Safe to call repeatedly after a user gesture. */
  init(): void {
    sfx.setVolume(this.vol);
    sfx.init();
  }

  private play(key: UiCue, opts?: { cooldown?: number; rate?: number; gain?: number }): void {
    sfx.playUi(key, {
      jitter: false,
      cooldown: opts?.cooldown,
      rate: opts?.rate,
      gain: opts?.gain,
    });
  }

  /** Play a cue only when interface/feedback sounds are enabled. The notification
   *  cues (loot, level, quest, whisper, error, polymorph, death) route through here;
   *  the gameplay-timing cues (ready check, duel countdown) call `play` directly. */
  private playFeedback(key: UiCue, opts?: { cooldown?: number }): void {
    if (this.feedbackOn) this.play(key, opts);
  }

  bagOpen(): void {
    this.play(UI_CUES.bagOpen);
  }

  bagClose(): void {
    this.play(UI_CUES.bagClose);
  }

  click(): void {
    this.play(UI_CUES.click);
  }

  coin(): void {
    this.playFeedback(UI_CUES.coin);
  }

  levelUp(): void {
    this.playFeedback(UI_CUES.levelUp);
  }

  achievement(): void {
    this.play(UI_CUES.achievement);
  }

  cosmeticUnlock(): void {
    this.play(UI_CUES.cosmeticUnlock);
  }

  // Your OWN character actually dying (the 'playerDeath' sim event), not a
  // minigame/PvP loss chime (fiesta, Yumi, arena rating, Vale Cup all still
  // use death() below): plays the real custom death vocalization instead of
  // the generic UI stinger.
  //
  // player_death_female_1..3 exist under public/audio/sfx but are unwired,
  // same gap as the other player-voice trigger sites in src/ui/hud.ts (search
  // player_hurt_female / player_death_female there): no gender field exists
  // on PlayerMeta yet. This is the site to wire for your OWN character's
  // death vocalization once that field lands, distinct from the OTHER
  // players' death cue commented in hud.ts.
  playerDeath(): void {
    this.play(UI_CUES.playerDeath);
  }

  lootItem(): void {
    this.playFeedback(UI_CUES.lootItem);
  }

  questDone(): void {
    this.playFeedback(UI_CUES.questDone);
  }

  readyCheck(): void {
    this.play(UI_CUES.readyCheck);
  }

  weaponSheathe(): void {
    this.play(UI_CUES.weaponSheathe);
  }

  weaponUnsheathe(): void {
    this.play(UI_CUES.weaponUnsheathe);
  }

  whisper(): void {
    this.playFeedback(UI_CUES.whisper);
  }

  sheep(): void {
    this.playFeedback(UI_CUES.sheep);
  }

  death(): void {
    this.playFeedback(UI_CUES.death);
  }

  arenaLoss(): void {
    this.playFeedback(UI_CUES.arenaLoss);
  }

  error(): void {
    this.playFeedback(UI_CUES.error, { cooldown: ERROR_SFX_COOLDOWN_SECONDS });
  }

  duelChallenge(): void {
    this.play(UI_CUES.duelChallenge);
  }

  // Same ui_duel_challenge cue as a real duel/arena/Vale Cup challenge, but
  // gated: party invite, guild invite, and a resurrection offer are not
  // time-critical the way an actual match challenge is, and questAccept()
  // (which they used before it was retired) always respected the Interface &
  // Feedback Sounds toggle. Losing that gating was an unintended side effect
  // of consolidating onto duelChallenge(), not a deliberate change.
  invitePrompt(): void {
    this.playFeedback(UI_CUES.duelChallenge);
  }

  // Party/group invite gets its own cue, distinct from the shared duelChallenge
  // invitePrompt() above (resurrectionOffer still uses that one unchanged) and
  // from guildInvite's own levelUp cue. Feedback-gated the same way: not
  // time-critical, respects the Interface & Feedback Sounds toggle.
  partyInvite(): void {
    this.playFeedback(UI_CUES.questReady);
  }

  duelCountdownTick(): void {
    this.play(UI_CUES.duelCountdown);
  }

  duelStart(): void {
    this.play(UI_CUES.duelStart);
  }

  vcupKickoff(): void {
    this.play(UI_CUES.vcupKickoff);
  }

  duelEnd(): void {
    this.play(UI_CUES.duelEnd);
  }

  fiestaWord(tier = 0): void {
    const index = Math.max(0, Math.min(3, Math.floor(Number.isFinite(tier) ? tier : 0)));
    this.play(UI_CUES.fiestaWords[index]);
  }

  fiestaScorePing(mine: boolean): void {
    this.play(mine ? UI_CUES.fiestaScoreMine : UI_CUES.fiestaScoreOther);
  }

  fiestaWave(): void {
    this.play(UI_CUES.fiestaWave);
  }

  fiestaAugment(): void {
    this.play(UI_CUES.fiestaAugment);
  }

  fiestaDown(): void {
    this.play(UI_CUES.fiestaDown);
  }

  fiestaRevive(): void {
    this.play(UI_CUES.fiestaRevive);
  }

  // Thornhollow Fields flag moments want WEIGHT. No dedicated recordings yet (the SFX
  // asset flow is a follow-up), so each layers two existing cues into one
  // bigger hit: a WAR-HORN stack for a take (the challenge horn doubled with
  // a deep detuned layer carrying the weight and the fight-starts hit on the
  // front edge; the old down-sting layer read as a boop, owner note), and the
  // fanfare over the fight-starts hit for a capture.
  bgFlagTaken(): void {
    this.play(UI_CUES.duelChallenge, { rate: 0.58 });
    this.play(UI_CUES.duelChallenge, { rate: 0.87, gain: 0.7 });
    this.play(UI_CUES.duelStart, { gain: 0.85 });
  }

  bgCapture(): void {
    this.play(UI_CUES.achievement);
    this.play(UI_CUES.duelStart);
  }

  // Card Duel: live in-match feedback, same ungated category as the Fiesta
  // cues above (match win/lose reuse duelEnd()/arenaLoss() directly, no
  // dedicated methods needed for those).
  cardPlay(): void {
    this.play(UI_CUES.cardPlay);
  }

  cardReveal(): void {
    this.play(UI_CUES.cardReveal);
  }

  cardRoundPush(): void {
    this.play(UI_CUES.cardRoundPush);
  }

  cardShuffle(): void {
    this.play(UI_CUES.cardShuffle);
  }

  // Gathering rhythm (Professions 2.0 Phase 12b). All of these are personal
  // feedback notifications EXCEPT fishBite: the bite opens the live reel
  // window, so it is a gameplay-timing cue (the ready-check/duel-countdown
  // category) and deliberately ignores the Interface & Feedback toggle.
  gatherCast(nodeType?: GatherNodeType): void {
    this.playFeedback(nodeType ? UI_CUES.gatherCastByNodeType[nodeType] : UI_CUES.gatherCast);
  }

  fishCast(): void {
    this.playFeedback(UI_CUES.fishCast);
  }

  fishBite(): void {
    this.play(UI_CUES.fishBite);
  }

  fishReel(): void {
    this.playFeedback(UI_CUES.fishReel);
  }

  gather(nodeType: GatherNodeType): void {
    this.playFeedback(UI_CUES.gatherByNodeType[nodeType]);
  }

  // Layers alongside gather's own node-type cue above, never a replacement
  // for it: a rare-or-better material roll (or a rare-event roll) gets an
  // additional tiered stinger on top of the plain impact.
  gatherRareTier(tier: 'rare' | 'epic' | 'legendary'): void {
    this.playFeedback(UI_CUES.gatherRareTier[tier]);
  }

  // recipeFamily is the recipe's professionId (a CRAFT_RING id); an unknown
  // id (should never happen, every recipe's professionId is one of the ten)
  // falls back to the generic loot ding rather than throwing.
  craftSuccess(recipeFamily: string): void {
    const key = (UI_CUES.craftByFamily as Record<string, string>)[recipeFamily];
    this.playFeedback((key ?? UI_CUES.lootItem) as UiCue);
  }

  // Layers alongside craftSuccess's own cue, never a replacement for it.
  masterwork(): void {
    this.playFeedback(UI_CUES.masterwork);
  }

  disenchant(): void {
    this.playFeedback(UI_CUES.disenchant);
  }

  salvage(): void {
    this.playFeedback(UI_CUES.salvage);
  }

  enchant(): void {
    this.playFeedback(UI_CUES.enchant);
  }
}

export const audio = new GameAudio();
