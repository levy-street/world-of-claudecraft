// Cold DOM adapter for the target frame's linked-account flair line.
//
// The three DECISIONS the line makes (is there anything to show, has anything
// changed, what markup) live in the pure src/ui/target_flair_line_view.ts core
// and are unit-tested there without a DOM; this controller owns only the
// element handling the core cannot do: the class toggle, the innerHTML write,
// and the avatar fallback wiring. One implementation, two hosts.

import type { Entity } from '../sim/types';
import { attachAvatarFallback } from './avatar_fallback';
import { getLanguage } from './i18n';
import {
  type TargetFlairLineInput,
  targetFlairLineHtml,
  targetFlairLineVisible,
  targetFlairSignature,
} from './target_flair_line_view';

/** Signature-gated owner for the target frame's linked-account flair line. */
export class TargetDiscordController {
  private signature = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly showDevBadges: () => boolean,
  ) {}

  update(target: Entity): void {
    // The language LEADS the signature (the core's own contract): four of the
    // line's faces are localized, so a locale switch must move the gate.
    const flair: TargetFlairLineInput = {
      language: getLanguage(),
      tier: target.discordTier ?? 0,
      name: target.discordName ?? '',
      role: target.discordRole ?? '',
      avatar: target.discordAvatar ?? '',
      devIndex: this.showDevBadges() ? (target.devTier ?? 0) : 0,
      isAi: target.aiAccount === true,
    };
    if (target.kind !== 'player' || !targetFlairLineVisible(flair)) {
      if (this.signature !== '') {
        this.signature = '';
        this.root.classList.remove('show');
        this.root.replaceChildren();
      }
      return;
    }
    const signature = targetFlairSignature(flair);
    if (signature === this.signature) return;
    this.signature = signature;
    this.root.innerHTML = targetFlairLineHtml(flair);
    const avatar = this.root.querySelector<HTMLImageElement>('.uf-dc-name img');
    if (avatar) attachAvatarFallback(avatar);
    this.root.classList.add('show');
  }
}
