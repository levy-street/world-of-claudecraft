import type { InvSlot } from '../sim/types';
import { GAMEPAD_CANCEL, GAMEPAD_CYCLE_HUD, GAMEPAD_SUBCOMMANDS } from './gamepad_map';
import { padReelItemId } from './pad_reel';

interface GamepadDispatchPlayer {
  castingAbility: string | null;
  weaponStowed: boolean;
}

interface GamepadDispatchWorld {
  readonly player: GamepadDispatchPlayer;
  readonly inventory: readonly InvSlot[];
  tabTarget(): void;
  tabTargetPrev(): void;
  targetNearestFriendly(): void;
  friendlyTabTarget(): void;
  useItem(itemId: string): void;
  toggleMounted(): void;
  setPetMode(mode: 'passive' | 'defensive' | 'aggressive'): void;
  petTaunt(): void;
  petAttack(): void;
  toggleWeaponStow(): void;
}

interface GamepadDispatchHud {
  cancelGroundAim(): boolean;
  closeAll(): boolean;
  toggleOptionsMenu(): void;
  castSlot(slot: number): void;
  toggleBags(): void;
  toggleChar(): void;
  toggleSpellbook(): void;
  toggleQuestLog(): void;
  toggleMap(): void;
  toggleTalents(): void;
  toggleMeters(): void;
  toggleTargetAuras(): void;
  toggleSocial(): void;
  toggleArena(): void;
  toggleLeaderboard(): void;
  toggleCalendar(): void;
  toggleDeeds(): void;
  toggleProfessions(): void;
  toggleReliquary(): void;
  toggleCrafting(): void;
  targetOwnPet(): void;
  toggleDungeonFinder(): void;
}

export interface GamepadActionDeps {
  world: GamepadDispatchWorld;
  hud: GamepadDispatchHud;
  renderer: { showNameplates: boolean };
  audio: { weaponSheathe(): void; weaponUnsheathe(): void };
  dismissCameraPrompt(): boolean;
  canUseGameKeys(): boolean;
  clearTarget(): void;
  cycleHudFocus(): void;
  targetNpc(direction: 1 | -1): void;
  interact(): void;
  openTargetSubcommands(): boolean;
  battlegroundFlag(): void;
  toggleDiscord(): void;
  openChat(): void;
  toggleActionCamera(): void;
}

/** Dispatches controller edge actions through the same handlers used by keyboard input. */
export function dispatchGamepadAction(id: string, deps: GamepadActionDeps): void {
  const { world, hud, renderer, audio } = deps;
  if (id === GAMEPAD_CANCEL) {
    if (deps.dismissCameraPrompt() || hud.cancelGroundAim() || hud.closeAll()) return;
    deps.clearTarget();
    return;
  }
  if (id === GAMEPAD_CYCLE_HUD) {
    deps.cycleHudFocus();
    return;
  }
  if (id === 'escape') {
    if (deps.dismissCameraPrompt()) return;
    if (hud.cancelGroundAim()) return;
    if (!hud.closeAll()) hud.toggleOptionsMenu();
    return;
  }
  if (!deps.canUseGameKeys()) return;
  if (id.startsWith('slot')) {
    hud.castSlot(Number(id.slice(4)));
    return;
  }
  hud.cancelGroundAim();
  switch (id) {
    case 'target':
      world.tabTarget();
      break;
    case 'targetPrev':
      world.tabTargetPrev();
      break;
    case 'targetFriendly':
      world.targetNearestFriendly();
      break;
    case 'targetNpcNext':
      deps.targetNpc(1);
      break;
    case 'targetNpcPrev':
      deps.targetNpc(-1);
      break;
    case 'targetFriendlyNext':
      world.friendlyTabTarget();
      break;
    case 'interact': {
      const reelRod = padReelItemId(world.player.castingAbility, world.inventory);
      if (reelRod !== null) world.useItem(reelRod);
      else deps.interact();
      break;
    }
    case 'bags':
      hud.toggleBags();
      break;
    case 'char':
      hud.toggleChar();
      break;
    case 'spellbook':
      hud.toggleSpellbook();
      break;
    case 'questlog':
      hud.toggleQuestLog();
      break;
    case 'map':
      hud.toggleMap();
      break;
    case GAMEPAD_SUBCOMMANDS:
      if (!deps.openTargetSubcommands()) hud.toggleMap();
      break;
    case 'nameplates':
      renderer.showNameplates = !renderer.showNameplates;
      break;
    case 'toggleActionCamera':
      deps.toggleActionCamera();
      break;
    case 'talents':
      hud.toggleTalents();
      break;
    case 'meters':
      hud.toggleMeters();
      break;
    case 'targetAuras':
      hud.toggleTargetAuras();
      break;
    case 'social':
      hud.toggleSocial();
      break;
    case 'arena':
      hud.toggleArena();
      break;
    case 'bgFlag':
      deps.battlegroundFlag();
      break;
    case 'mount':
      world.toggleMounted();
      break;
    case 'leaderboard':
      hud.toggleLeaderboard();
      break;
    case 'calendar':
      hud.toggleCalendar();
      break;
    case 'discord':
      deps.toggleDiscord();
      break;
    case 'deeds':
      hud.toggleDeeds();
      break;
    case 'professions':
      hud.toggleProfessions();
      break;
    case 'reliquary':
      hud.toggleReliquary();
      break;
    case 'crafting':
      hud.toggleCrafting();
      break;
    case 'petStop':
      world.setPetMode('passive');
      break;
    case 'petTaunt':
      world.petTaunt();
      break;
    case 'petAttack':
      world.petAttack();
      break;
    case 'petDefensive':
      world.setPetMode('defensive');
      break;
    case 'petAggressive':
      world.setPetMode('aggressive');
      break;
    case 'targetPet':
      hud.targetOwnPet();
      break;
    case 'dungeonFinder':
      hud.toggleDungeonFinder();
      break;
    case 'sheathe': {
      const wasStowed = world.player.weaponStowed;
      world.toggleWeaponStow();
      if (world.player.weaponStowed !== wasStowed) {
        if (world.player.weaponStowed) audio.weaponSheathe();
        else audio.weaponUnsheathe();
      }
      break;
    }
    case 'chat':
      deps.openChat();
      break;
  }
}
