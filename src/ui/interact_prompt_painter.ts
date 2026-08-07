// Thin painter for the interact prompt (the two-line hint above the action
// bars). The pure visibility / verb rules live in interact_prompt_view.ts; this
// resolves the core's verb discriminator and the target's display name through
// t() / tEntity(), and routes EVERY write through the host's elided writers.
//
// The keyboard glyph is static markup hydrated from the entry pages
// (`data-icon="keyboard"` in index.html AND play.html), so this painter never
// touches innerHTML: it writes only the two text nodes, the keycap, and the
// container's display + class.

import { objectDisplayName } from '../render/entity_labels';
import type { Entity, GatherNodeType } from '../sim/types';
import { tEntity } from './entity_i18n';
import { type TranslationKey, t } from './i18n';
import type {
  InteractPromptState,
  InteractPromptTargetKind,
  InteractPromptVerb,
} from './interact_prompt_view';
import type { PainterHostWriters } from './painter_host';

const VERB_KEYS: Record<InteractPromptVerb, TranslationKey> = {
  interact: 'hudChrome.interactPrompt.interact',
  loot: 'hudChrome.interactPrompt.loot',
  talk: 'hudChrome.interactPrompt.talk',
  open: 'hudChrome.interactPrompt.open',
  take: 'hudChrome.interactPrompt.take',
  gather: 'hudChrome.interactPrompt.gather',
  enter: 'hudChrome.interactPrompt.enter',
  leave: 'hudChrome.interactPrompt.leave',
};

// The node families already carry localized names for the gather tooltip; the
// prompt reuses them rather than minting a second set.
const NODE_NAME_KEYS: Record<GatherNodeType, TranslationKey> = {
  ore: 'hudChrome.gathering.nodeName.ore',
  wood: 'hudChrome.gathering.nodeName.wood',
  herb: 'hudChrome.gathering.nodeName.herb',
};

// Several delve interactables carry a CALL TO ACTION as their nameplate text
// ("Press F to pick the lock"), which is right above the prop and wrong in a
// prompt whose second line already says Interact and shows the key: the player
// would read "Press F to pick the lock / Interact F". These give that family a
// plain noun instead. Anything not listed keeps its nameplate name, which is
// already a noun (Mailbox, Notice Board, Sluice Valve, a dungeon's own name).
const PROMPT_NAME_OVERRIDES: Record<string, TranslationKey> = {
  delve_locked_chest: 'hudChrome.interactPrompt.name.lockedChest',
  delve_reward_chest: 'hudChrome.interactPrompt.name.rewardChest',
  delve_drowned_reliquary_open: 'hudChrome.interactPrompt.name.rewardChest',
  delve_surface_exit: 'hudChrome.interactPrompt.name.surfaceExit',
  delve_drowned_reliquary: 'hudChrome.interactPrompt.name.reliquary',
  delve_rite_shrine_bell: 'hudChrome.interactPrompt.name.bellShrine',
  delve_rite_shrine_candle: 'hudChrome.interactPrompt.name.candleShrine',
  delve_rite_shrine_reed: 'hudChrome.interactPrompt.name.reedShrine',
  delve_rite_shrine_skull: 'hudChrome.interactPrompt.name.skullShrine',
};

/** Localized display name for whatever the prompt is naming. A summoned pet or
 *  escortee carries its own instance name; everything else resolves through the
 *  shared entity dictionaries (the same names the nameplates show), except the
 *  call-to-action delve props above. */
export function interactPromptName(
  kind: InteractPromptTargetKind,
  entity: Entity | undefined,
  nodeType: GatherNodeType | null,
): string {
  if (kind === 'gatherNode') return nodeType ? t(NODE_NAME_KEYS[nodeType]) : '';
  if (!entity) return '';
  if (entity.kind === 'npc') return tEntity({ kind: 'npc', id: entity.templateId, field: 'name' });
  if (entity.kind === 'mob') {
    return entity.ownerId !== null
      ? entity.name
      : tEntity({ kind: 'mob', id: entity.templateId, field: 'name' });
  }
  const override = PROMPT_NAME_OVERRIDES[entity.templateId];
  return override ? t(override) : objectDisplayName(entity);
}

export class InteractPromptPainter {
  constructor(
    private readonly writers: PainterHostWriters,
    private readonly root: HTMLElement, // #interact-prompt
    private readonly nameEl: HTMLElement, // .ip-name
    private readonly verbEl: HTMLElement, // .ip-verb
    private readonly capEl: HTMLElement, // .ip-cap
  ) {}

  paint(state: InteractPromptState): void {
    if (!state.visible) {
      this.writers.setDisplay(this.root, 'none');
      return;
    }
    // block, not flex: the container is a zero-height slot and the visible box
    // is its absolutely-positioned .ip-box child (see hud.css).
    this.writers.setDisplay(this.root, 'block');
    this.writers.setText(this.nameEl, state.name);
    this.writers.setText(this.verbEl, t(VERB_KEYS[state.verb]));
    // An unbound interact action must not render an empty keycap that reads as
    // a key you could press; the word replaces the cap and the cap chrome drops.
    this.writers.toggleClass(this.capEl, 'unbound', state.unbound);
    // The Key Bindings screen's own word for "no key assigned", reused rather
    // than a second string that could drift from it.
    this.writers.setText(this.capEl, state.unbound ? t('hud.options.unbound') : state.keyLabel);
  }
}
