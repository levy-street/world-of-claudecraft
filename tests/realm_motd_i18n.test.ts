// The realm message of the day crosses the server/client i18n seam as stable
// English (server/realm_motd.ts) and is re-localized by the system-message
// matcher (src/ui/system_text_i18n.ts). The S3 guard parses server/game.ts
// only, so it cannot see these emits; this suite drives every line the server
// module can produce through the real matcher, under a non-English locale so a
// passthrough cannot masquerade as a match.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { REALM_MOTD_MAX, REALM_MOTD_NOTICES, realmMotdLine } from '../server/realm_motd';
import { ensureLocaleLoaded, formatNumber, setLanguage, t } from '../src/ui/i18n';
import { localizeSystemText } from '../src/ui/system_text_i18n';

beforeAll(async () => {
  await ensureLocaleLoaded('zh_CN');
});
afterEach(() => setLanguage('en'));

describe('realm message of the day localization', () => {
  it('re-renders the message line with the admin text spliced verbatim', () => {
    setLanguage('zh_CN');
    const out = localizeSystemText(realmMotdLine('Double XP tonight!'));
    expect(out).toBe(t('hudChrome.realmMotd.line', { text: 'Double XP tonight!' }));
    expect(out).toContain('Double XP tonight!');
    expect(out).not.toBe(realmMotdLine('Double XP tonight!'));
  });

  it('keeps a message that looks like another system line on the MOTD arm', () => {
    setLanguage('zh_CN');
    // Each body matches a regex arm that opens on a (.+) capture, so the whole
    // prefixed line would be swallowed by it if the MOTD arm ran later.
    for (const body of [
      'Bob joins the party.',
      'Mira has come online.',
      'Tor is now the party leader.',
    ]) {
      expect(localizeSystemText(realmMotdLine(body))).toBe(
        t('hudChrome.realmMotd.line', { text: body }),
      );
    }
  });

  it('localizes every admin notice the command can send', () => {
    setLanguage('zh_CN');
    const expected: Record<keyof typeof REALM_MOTD_NOTICES, string> = {
      updated: t('hudChrome.realmMotd.updated'),
      cleared: t('hudChrome.realmMotd.cleared'),
      none: t('hudChrome.realmMotd.none'),
      usage: t('hudChrome.realmMotd.usage'),
      tooLong: t('hudChrome.realmMotd.tooLong', {
        max: formatNumber(REALM_MOTD_MAX, { maximumFractionDigits: 0 }),
      }),
      saveFailed: t('hudChrome.realmMotd.saveFailed'),
    };
    for (const [code, english] of Object.entries(REALM_MOTD_NOTICES)) {
      const out = localizeSystemText(english);
      expect(out, code).toBe(expected[code as keyof typeof REALM_MOTD_NOTICES]);
      expect(out, code).not.toBe(english);
    }
  });

  it('renders the English catalog lines byte-identical to the server English', () => {
    setLanguage('en');
    expect(localizeSystemText(realmMotdLine('Hi'))).toBe(realmMotdLine('Hi'));
    for (const english of Object.values(REALM_MOTD_NOTICES)) {
      expect(localizeSystemText(english)).toBe(english);
    }
  });
});
