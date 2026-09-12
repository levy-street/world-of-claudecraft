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
    // The female take of the same cue. Registered here (rather than reached as
    // a bare SfxId) so it lands in the UiCue union and play() keeps refusing
    // anything that is not a real cue; hud.ts picks between the two via
    // playerVoiceCue.
    playerDeathFemale: 'player_death_female',
    readyCheck: 'ui_ready_check',
    weaponSheathe: 'ui_weapon_sheathe',
    weaponUnsheathe: 'ui_weapon_unsheathe',
    error: 'ui_error',
    duelChallenge: 'ui_duel_challenge',
    duelCountdown: 'ui_duel_countdown',
    duelStart: 'ui_duel_start',
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
    // Craft-family cast start (Craft Cast System Phase 6): one shared wind-up
    // for craft, disenchant, apply-enchant, salvage, and tool recharge. Mirrors
    // gatherCast / fishCast: personal feedback at castStart, distinct from the
    // completion cues below. Procedural placeholder in scripts/sfx/ui_sfx.mjs
    // until a custom recording lands.
    craftCast: 'ui_craft_cast',
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
    // Masterwrought crafting UX (phase 14): perfectingAttempt is the Perfecting
    // attempt resolve strike and perfectingSuccess the rank landing (both
    // consumed by the Perfecting window); legendaryForged is the orange
    // promotion's own capstone cue, replacing the reused achievement chime at
    // the hud's legendaryForged arm so the rarest crafting moment stops
    // sounding like any deed unlock; sunderComplete closes the one silent
    // craft-family completion (the sunder grant is silent + callerLogs, so no
    // generic ding ever covered it).
    perfectingAttempt: 'ui_perfecting_attempt',
    perfectingSuccess: 'ui_perfecting_success',
    legendaryForged: 'ui_legendary_forged',
    sunderComplete: 'ui_sunder_complete',
    // Farming (the render / juice phase): the plant ACTION and the harvest
    // RESULT, the same cast/result split the gathering family uses. Both are
    // procedural placeholders in scripts/sfx/ui_sfx.mjs until real recordings
    // land.
    farmPlant: 'ui_farm_plant',
    farmHarvest: 'ui_farm_harvest',
    // The withered outcome's own sting (the deferred Phase 8/10 cue, landed at
    // the Phase 18 sweep). It shared farmHarvest through the interim, which
    // sounded like the crop came in; it is the same action resolving, so the
    // cue keeps the harvest's vocabulary and inverts its tail rather than
    // reaching for an unrelated failure sound.
    farmWithered: 'ui_farm_withered',
    // The ready notice (the ready-notice phase): its own cue rather than a
    // borrowed one, because it is the only farming sound the player did not
    // just ask for by pressing something, and it must not read as a harvest
    // that happened without them.
    farmReady: 'ui_farm_ready',
    // The golden-harvest sting (the celebrations phase): layers alongside the
    // shared rare-event achievement cue, never a replacement for it, the same
    // additive design masterwork and gatherRareTier follow.
    farmGolden: 'ui_farm_golden',
    // Setting out the shared feast (Phase 12): the placement's own cue, a
    // procedural placeholder like its farming siblings until a real recording
    // lands.
    farmFeast: 'ui_farm_feast',
} as const;

type DeepValues<T> = T extends string ? T : T extends readonly (infer U)[] ? U : T extends Record<string, infer V> ? DeepValues<V> : never;

type UiCue = DeepValues<typeof UI_CUES>;

type PlayOpts = {
    cooldown?: number;
    rate?: number;
    gain?: number;
    feedback?: boolean;
};

export class GameAudio {
    private vol = 1;
    private feedbackOn = true;

    setVolume(value: number): void {
        this.vol = Math.min(1, Math.max(0, value));
        sfx.setVolume(this.vol);
    }

    get volume(): number {
        return this.vol;
    }

    setFeedbackEnabled(value: boolean): void {
        this.feedbackOn = value;
    }

    get feedbackEnabled(): boolean {
        return this.feedbackOn;
    }

    init(): void {
        sfx.setVolume(this.vol);
        sfx.init();
    }

    private play(key: UiCue, opts: PlayOpts = {}): void {
        if (opts.feedback && !this.feedbackOn) return;
        sfx.playUi(key, { jitter: false, cooldown: opts.cooldown, rate: opts.rate, gain: opts.gain });
    }

    private playLayered(layers: Array<{ key: UiCue; rate?: number; gain?: number }>, opts: PlayOpts = {}): void {
        for (const layer of layers) {
            this.play(layer.key, { ...opts, rate: layer.rate, gain: layer.gain });
        }
    }

    bagOpen(): void { this.play(UI_CUES.bagOpen); }
    bagClose(): void { this.play(UI_CUES.bagClose); }
    click(): void { this.play(UI_CUES.click); }
    coin(): void { this.play(UI_CUES.coin, { feedback: true }); }
    levelUp(): void { this.play(UI_CUES.levelUp, { feedback: true }); }
    achievement(): void { this.play(UI_CUES.achievement); }
    cosmeticUnlock(): void { this.play(UI_CUES.cosmeticUnlock); }
    playerDeath(cue: typeof UI_CUES.playerDeath | typeof UI_CUES.playerDeathFemale = UI_CUES.playerDeath): void { this.play(cue); }
    lootItem(): void { this.play(UI_CUES.lootItem, { feedback: true }); }
    questDone(): void { this.play(UI_CUES.questDone, { feedback: true }); }
    readyCheck(): void { this.play(UI_CUES.readyCheck); }
    weaponSheathe(): void { this.play(UI_CUES.weaponSheathe); }
    weaponUnsheathe(): void { this.play(UI_CUES.weaponUnsheathe); }
    whisper(): void { this.play(UI_CUES.whisper, { feedback: true }); }
    sheep(): void { this.play(UI_CUES.sheep, { feedback: true }); }
    death(): void { this.play(UI_CUES.death, { feedback: true }); }
    arenaLoss(): void { this.play(UI_CUES.arenaLoss, { feedback: true }); }
    error(): void { this.play(UI_CUES.error, { feedback: true, cooldown: ERROR_SFX_COOLDOWN_SECONDS }); }
    duelChallenge(): void { this.play(UI_CUES.duelChallenge); }
    invitePrompt(): void { this.play(UI_CUES.duelChallenge, { feedback: true }); }
    partyInvite(): void { this.play(UI_CUES.questReady, { feedback: true }); }
    duelCountdownTick(): void { this.play(UI_CUES.duelCountdown); }
    duelStart(): void { this.play(UI_CUES.duelStart); }
    duelEnd(): void { this.play(UI_CUES.duelEnd); }

    fiestaWord(tier = 0): void {
        const index = Math.max(0, Math.min(3, Math.floor(Number.isFinite(tier) ? tier : 0)));
        this.play(UI_CUES.fiestaWords[index]);
    }

    fiestaScorePing(mine: boolean): void { this.play(mine ? UI_CUES.fiestaScoreMine : UI_CUES.fiestaScoreOther); }
    fiestaWave(): void { this.play(UI_CUES.fiestaWave); }
    fiestaAugment(): void { this.play(UI_CUES.fiestaAugment); }
    fiestaDown(): void { this.play(UI_CUES.fiestaDown); }
    fiestaRevive(): void { this.play(UI_CUES.fiestaRevive); }
    bgFlagTaken(): void { this.playLayered([{ key: UI_CUES.duelChallenge, rate: 0.58 }, { key: UI_CUES.duelChallenge, rate: 0.87, gain: 0.7 }, { key: UI_CUES.duelStart, gain: 0.85 }]); }
    bgCapture(): void { this.playLayered([{ key: UI_CUES.achievement }, { key: UI_CUES.duelStart }]); }
    cardPlay(): void { this.play(UI_CUES.cardPlay); }
    cardReveal(): void { this.play(UI_CUES.cardReveal); }
    cardRoundPush(): void { this.play(UI_CUES.cardRoundPush); }
    cardShuffle(): void { this.play(UI_CUES.cardShuffle); }

    gatherCast(nodeType?: GatherNodeType): void {
        const key = nodeType ? UI_CUES.gatherCastByNodeType[nodeType] : UI_CUES.gatherCast;
        this.play(key, { feedback: true });
    }

    fishCast(): void { this.play(UI_CUES.fishCast, { feedback: true }); }
    fishBite(): void { this.play(UI_CUES.fishBite); }
    fishReel(): void { this.play(UI_CUES.fishReel, { feedback: true }); }
    gather(nodeType: GatherNodeType): void { this.play(UI_CUES.gatherByNodeType[nodeType], { feedback: true }); }
    gatherRareTier(tier: 'rare' | 'epic' | 'legendary'): void { this.play(UI_CUES.gatherRareTier[tier], { feedback: true }); }
    craftCast(): void { this.play(UI_CUES.craftCast, { feedback: true }); }

    craftSuccess(recipeFamily: string): void {
        const key = (UI_CUES.craftByFamily as Record<string, string>)[recipeFamily] ?? UI_CUES.lootItem;
        this.play(key as UiCue, { feedback: true });
    }

    masterwork(): void { this.play(UI_CUES.masterwork, { feedback: true }); }
    disenchant(): void { this.play(UI_CUES.disenchant, { feedback: true }); }
    salvage(): void { this.play(UI_CUES.salvage, { feedback: true }); }
    enchant(): void { this.play(UI_CUES.enchant, { feedback: true }); }
    perfectingAttempt(): void { this.play(UI_CUES.perfectingAttempt, { feedback: true }); }
    perfectingSuccess(): void { this.play(UI_CUES.perfectingSuccess, { feedback: true }); }
    legendaryForged(): void { this.play(UI_CUES.legendaryForged, { feedback: true }); }
    sunderComplete(): void { this.play(UI_CUES.sunderComplete, { feedback: true }); }
    farmPlant(): void { this.play(UI_CUES.farmPlant); }
    farmHarvest(): void { this.play(UI_CUES.farmHarvest, { feedback: true }); }
    farmWithered(): void { this.play(UI_CUES.farmWithered, { feedback: true }); }
    farmReady(): void { this.play(UI_CUES.farmReady, { feedback: true }); }
    farmGolden(): void { this.play(UI_CUES.farmGolden, { feedback: true }); }
    farmFeast(): void { this.play(UI_CUES.farmFeast); }
}

export const audio = new GameAudio();