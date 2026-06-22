// The Guide page contract. Each section is a GuidePage that returns the inner HTML for
// the <main> landmark; it must contain exactly one <h1>. Kept separate from the registry
// so individual page modules import the type without a circular dependency.

import type { TranslationKey } from '../../ui/i18n';

export interface PageContext {
  /** Path segments after the matched route, e.g. ['warrior'] for classes/warrior. */
  params: string[];
  /** The matched route's sub-path. */
  sub: string;
  /** i18n key for the page title (the route's nav label). */
  titleKey: TranslationKey;
}

export interface GuidePage {
  /** Title key for document.title; falls back to the route nav label when omitted. */
  titleKey?: TranslationKey;
  /** Dynamic document title (e.g. the class name on a class page). Wins over titleKey. */
  titleFor?(ctx: PageContext): string;
  render(ctx: PageContext): string;
  /**
   * Optional: wire interactivity after the rendered HTML is in the DOM (filters,
   * scrollspy, search). Receives the <main> element. Return a cleanup function; the app
   * runs it before the next navigation so document-level listeners do not stack.
   */
  mount?(root: HTMLElement, ctx: PageContext): (() => void) | void;
}
