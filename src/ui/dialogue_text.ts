import { CLASSES } from '../sim/data';
import type { PlayerClass } from '../sim/types';

export function formatDialogueText(text: string, playerName: string, playerClass: PlayerClass): string {
  return text
    .replace(/\$N/g, playerName)
    .replace(/\$C/g, CLASSES[playerClass].name.toLowerCase());
}
