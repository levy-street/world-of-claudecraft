// Pet commands as action-bar slots: the pet-bar commands (the set the Ctrl+1..5
// binds run, src/game/pet_commands.ts, plus the Assist stance) can be dragged off the pet bar
// onto any configurable action-bar slot and pressed from there. This is the pure
// half: which ids are valid, what each slot paints (icon, name, usable, active,
// cooldown) for the commanded pet, and nothing that touches the DOM or the world.
//
// A pet slot is presentation state like any other binding: the server never sees
// it (a press runs the ordinary IWorld pet command), and the stored id set is
// closed, so a hand-edited layout cannot smuggle a new command in.

import { petCanForceTaunt } from '../../../sim/pet/pet_taunt_gate';
import { PET_GROWL_INTERVAL, type PetMode } from '../../../sim/types';
import type { PetCommand } from '../../../world_api/pet';
import type { TranslationKey } from '../../i18n';
import { PET_ACTION_ICONS } from '../../pet_action_icons';

/** Every command a pet slot may hold, in pet-bar order. */
export const PET_SLOT_COMMANDS: readonly PetCommand[] = [
  'attack',
  'taunt',
  'stop',
  'defensive',
  'aggressive',
  'assist',
];

const PET_SLOT_COMMAND_SET: ReadonlySet<string> = new Set(PET_SLOT_COMMANDS);

export function isPetSlotCommand(id: string): id is PetCommand {
  return PET_SLOT_COMMAND_SET.has(id);
}

// 'stop' is the passive stance (runPetCommand maps it to setPetMode('passive')),
// so it wears the passive art and copy the pet bar's stance menu shows.
const PET_SLOT_ICON_IDS: Record<PetCommand, string> = {
  attack: PET_ACTION_ICONS.attack,
  taunt: PET_ACTION_ICONS.taunt,
  stop: PET_ACTION_ICONS.passive,
  defensive: PET_ACTION_ICONS.defensive,
  aggressive: PET_ACTION_ICONS.aggressive,
  // Assist has no art of its own: it wears Pet Attack's, by design.
  assist: PET_ACTION_ICONS.attack,
};

const PET_SLOT_TEXT: Record<
  PetCommand,
  { name: TranslationKey; title: TranslationKey; desc: TranslationKey }
> = {
  attack: {
    name: 'hud.pet.attack',
    title: 'hud.pet.petAttackTitle',
    desc: 'hud.pet.petAttackDesc',
  },
  taunt: { name: 'hud.pet.taunt', title: 'hud.pet.petTauntTitle', desc: 'hud.pet.petTauntDesc' },
  stop: { name: 'hud.pet.passive', title: 'hud.pet.passive', desc: 'hud.pet.passiveDesc' },
  defensive: {
    name: 'hud.pet.defensive',
    title: 'hud.pet.defensive',
    desc: 'hud.pet.defensiveDesc',
  },
  aggressive: {
    name: 'hud.pet.aggressive',
    title: 'hud.pet.aggressive',
    desc: 'hud.pet.aggressiveDesc',
  },
  assist: { name: 'hud.pet.assist', title: 'hud.pet.assist', desc: 'hud.pet.assistDesc' },
};

// The stance a command selects, or null for the one-shot commands.
const PET_SLOT_MODE: Record<PetCommand, PetMode | null> = {
  attack: null,
  taunt: null,
  stop: 'passive',
  defensive: 'defensive',
  aggressive: 'aggressive',
  assist: 'assist',
};

export function petSlotIconId(command: PetCommand): string {
  return PET_SLOT_ICON_IDS[command];
}

export function petSlotText(command: PetCommand): {
  name: TranslationKey;
  title: TranslationKey;
  desc: TranslationKey;
} {
  return PET_SLOT_TEXT[command];
}

/** The pet-bar stance a command selects ('stop' is passive), or null. */
export function petSlotMode(command: PetCommand): PetMode | null {
  return PET_SLOT_MODE[command];
}

/** The pet fields one slot reads: the same subset the pet bar itself renders from. */
export interface PetSlotPet {
  dead: boolean;
  templateId: string;
  petMode?: PetMode;
  petTauntTimer: number;
}

// Scalar reads rather than one state object: the action-bar view calls these
// every frame per pet slot and allocates nothing on that path.
// `pet` is the pet bar's own anchor (renderPetBar), or null when there is none.

function livingPet(pet: PetSlotPet | null): pet is PetSlotPet {
  return pet !== null && !pet.dead;
}

/** Seconds left on the command's cooldown (only taunt has one; the pet bar's
 *  taunt button shows the same timer). */
export function petSlotCooldown(command: PetCommand, pet: PetSlotPet | null): number {
  if (command !== 'taunt' || !livingPet(pet) || !petCanForceTaunt(pet.templateId)) return 0;
  return Math.max(0, pet.petTauntTimer);
}

/** The full cooldown the sweep drains from: the Growl interval, or the live
 *  timer when a template runs a longer one. */
export function petSlotCooldownTotal(command: PetCommand, pet: PetSlotPet | null): number {
  const cd = petSlotCooldown(command, pet);
  return cd > 0 ? Math.max(cd, PET_GROWL_INTERVAL) : 0;
}

/** False with no living pet, or a taunt the pet cannot perform or is cooling. */
export function petSlotUsable(command: PetCommand, pet: PetSlotPet | null): boolean {
  if (!livingPet(pet)) return false;
  if (command !== 'taunt') return true;
  return petCanForceTaunt(pet.templateId) && petSlotCooldown(command, pet) <= 0;
}

/** The command's stance is the pet's current one (the three stance slots only). */
export function petSlotActive(command: PetCommand, pet: PetSlotPet | null): boolean {
  const mode = petSlotMode(command);
  if (mode === null || !livingPet(pet)) return false;
  // An unset mode reads as defensive, as the pet bar does.
  return (pet.petMode ?? 'defensive') === mode;
}
