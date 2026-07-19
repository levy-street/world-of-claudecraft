// Compatibility facade for non-positional UI and event sounds.
//
// GameAudio keeps the established HUD-facing method surface while delegating
// playback, loading, voice limits, and volume control to the sampled SFX engine.

import { sfx } from './sfx';

// Minimum seconds between repeats of the SAME error cue: spamming an ability
// on cooldown, or holding a cast with no mana, would otherwise refire the
// bloop every failed attempt. Per-key (via sfx.playUi's own cooldown option),
// so an unrelated error class right after still sounds immediately.
const ERROR_SFX_COOLDOWN_SECONDS = 1.5;

const UI_CUES = {
  bagOpen: 'ui_bag_open',
  bagClose: 'ui_bag_close',
  click: 'ui_click',
  coin: 'ui_coin',
  levelUp: 'ui_level_up',
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
} as const;

type UiCue =
  | Exclude<(typeof UI_CUES)[keyof typeof UI_CUES], readonly string[]>
  | (typeof UI_CUES.fiestaWords)[number];

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

  private play(key: UiCue, opts?: { cooldown?: number }): void {
    sfx.playUi(key, { jitter: false, cooldown: opts?.cooldown });
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
}

export const audio = new GameAudio();
