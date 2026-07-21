// Pure email rendering: (event, locale, data) -> { subject, html, text }. No I/O,
// no DOM, no Date: trivially unit-testable. The HTML body is derived from the
// plaintext blocks so each template authors its copy exactly once.
import { CATALOG, BRAND, type EmailTemplate } from './catalog';
import { DEFAULT_EMAIL_LOCALE, type EmailTemplateKey, type EmailData } from './events';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

// Fill {{token}} placeholders from a flat string map. Unknown tokens are left
// untouched (visible in dev) rather than silently blanked, so a missing payload
// field is obvious instead of producing a confusing empty sentence.
export function interpolate(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(data, key) ? data[key] : whole,
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Turn an interpolated plaintext body into a minimal, client-safe HTML body.
// URLs on their own line become anchors; blank lines become paragraph breaks.
function textToHtml(text: string): string {
  const paragraphs = text.split(/\n\n+/).map((block) => {
    const lines = block.split('\n').map((line) => {
      const trimmed = line.trim();
      if (/^https?:\/\/\S+$/.test(trimmed)) {
        const safe = escapeHtml(trimmed);
        return `<a href="${safe}">${safe}</a>`;
      }
      return escapeHtml(line);
    });
    return `<p>${lines.join('<br>')}</p>`;
  });
  return (
    `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;line-height:1.5">` +
    paragraphs.join('') +
    `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">` +
    `<p style="font-size:12px;color:#888">${escapeHtml(BRAND)}</p>` +
    `</div>`
  );
}

function resolveTemplate(event: EmailTemplateKey, locale: string): EmailTemplate {
  const lang = (locale || DEFAULT_EMAIL_LOCALE).split(/[-_]/)[0].toLowerCase();
  return (
    CATALOG[lang]?.[event] ??
    CATALOG[DEFAULT_EMAIL_LOCALE]?.[event] ??
    // The default-locale entry is guaranteed present by the email-i18n test, so
    // this throw only fires if someone adds an EmailEvent without an `en` row.
    (() => {
      throw new Error(`no email template for event "${event}"`);
    })()
  );
}

export function renderEmail<K extends EmailTemplateKey>(
  event: K,
  locale: string,
  data: EmailData[K],
): RenderedEmail {
  const tpl = resolveTemplate(event, locale);
  const map = data as Record<string, string>;
  // The subject becomes an email header; collapse any CR/LF an interpolated
  // value (e.g. a caller-supplied generic heading) might carry so it can never
  // inject an extra header line.
  const subject = interpolate(tpl.subject, map).replace(/[\r\n]+/g, ' ').trim();
  const text = interpolate(tpl.text, map);
  return { subject, text, html: textToHtml(text) };
}
