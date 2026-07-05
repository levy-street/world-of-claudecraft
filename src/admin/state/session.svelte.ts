import { adminLanguage, setAdminLanguage } from '../i18n';

// Reactive locale signal. The admin t() layer reads a module-level current locale that
// Svelte cannot track, so components depend on this signal (and App.svelte wraps its
// content in {#key session.locale}) to re-render localized text when the locale
// changes. Admin keeps every locale static in DICT, so switching is synchronous.
// Today the locale is fixed at boot from adminLanguage() (URL ?lang / default); this
// seam keeps a runtime switch a one-liner if a selector is ever added.
class SessionState {
  locale = $state<string>(adminLanguage());

  setLocale(lang: string): void {
    setAdminLanguage(lang);
    this.locale = adminLanguage();
  }
}

export const session = new SessionState();
