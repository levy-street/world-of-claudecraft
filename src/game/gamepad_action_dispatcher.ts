import type { IWorld } from '../world_api';
import { GAMEPAD_CANCEL, GAMEPAD_CYCLE_HUD, GAMEPAD_SUBCOMMANDS } from './gamepad_map';
import { nextNpcTarget } from './npc_cycle';

type DispatchWorld = Pick<
  IWorld,
  | 'entities'
  | 'player'
  | 'tabTarget'
  | 'tabTargetPrev'
  | 'targetNearestFriendly'
  | 'friendlyTabTarget'
  | 'targetEntity'
  | 'toggleMounted'
  | 'setPetMode'
  | 'petTaunt'
  | 'petAttack'
  | 'toggleWeaponStow'
>;

export interface GamepadActionHud {
  cancelGroundAim(): boolean;
  closeAll(): boolean;
  toggleOptionsMenu(): void;
  pressSlot(slot: number): void;
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

export interface GamepadActionDispatcherDeps {
  world: DispatchWorld;
  hud: GamepadActionHud;
  canUseGameKeys(): boolean;
  dismissCameraPrompt(): boolean;
  cycleHudFocus(): boolean;
  interact(): void;
  openTargetSubcommands(): boolean;
  toggleNameplates(): void;
  bgFlag(): void;
  toggleDiscord(): void;
  openChat(): void;
  weaponSheathe(): void;
  weaponUnsheathe(): void;
}

export function createGamepadActionDispatcher(
  deps: GamepadActionDispatcherDeps,
): (id: string) => void {
  const { hud, world } = deps;
  return (id) => {
    if (id === GAMEPAD_CANCEL) {
      if (deps.dismissCameraPrompt() || hud.cancelGroundAim() || hud.closeAll()) return;
      world.targetEntity(null);
      return;
    }
    if (id === GAMEPAD_CYCLE_HUD) {
      deps.cycleHudFocus();
      return;
    }
    if (id === 'escape') {
      if (!hud.cancelGroundAim() && !hud.closeAll()) hud.toggleOptionsMenu();
      return;
    }
    if (!deps.canUseGameKeys()) return;
    if (id.startsWith('slot')) {
      hud.pressSlot(Number(id.slice(4)));
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
      case 'targetNpcPrev': {
        const next = nextNpcTarget(
          world.entities.values(),
          world.player.pos,
          world.player.targetId ?? null,
          id === 'targetNpcNext' ? 1 : -1,
        );
        if (next !== null) world.targetEntity(next);
        break;
      }
      case 'targetFriendlyNext':
        world.friendlyTabTarget();
        break;
      case 'interact':
        deps.interact();
        break;
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
        deps.toggleNameplates();
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
        deps.bgFlag();
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
          if (world.player.weaponStowed) deps.weaponSheathe();
          else deps.weaponUnsheathe();
        }
        break;
      }
      case 'chat':
        deps.openChat();
        break;
    }
  };
}
