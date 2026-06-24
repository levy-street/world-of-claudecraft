import { describe, it, expect } from 'vitest';
import { interpolate, renderEmail } from '../server/email/templates';
import { CATALOG } from '../server/email/catalog';
import { EVENT_CATEGORY, type EmailEvent } from '../server/email/events';

describe('interpolate', () => {
  it('fills known {{tokens}} and tolerates whitespace', () => {
    expect(interpolate('Hi {{ name }}, {{x}}', { name: 'Aelwyn', x: 'ok' })).toBe('Hi Aelwyn, ok');
  });
  it('leaves unknown tokens visible rather than blanking them', () => {
    expect(interpolate('Hi {{missing}}', {})).toBe('Hi {{missing}}');
  });
});

describe('renderEmail', () => {
  it('renders subject, text, and derived html for an event', () => {
    const r = renderEmail('account_created', 'en', { username: 'Aelwyn' });
    expect(r.subject).toContain('Welcome');
    expect(r.text).toContain('Hi Aelwyn,');
    expect(r.html).toContain('<p>Hi Aelwyn,');
    expect(r.html).toContain('World of ClaudeCraft');
  });

  it('turns a bare URL line into an anchor in html', () => {
    const r = renderEmail('email_change_verify', 'en', {
      username: 'Aelwyn', newEmail: 'new@example.com', verifyUrl: 'https://woc.test/api/account/email/verify?token=abc',
    });
    expect(r.text).toContain('https://woc.test/api/account/email/verify?token=abc');
    expect(r.html).toContain('<a href="https://woc.test/api/account/email/verify?token=abc">');
  });

  it('escapes html-significant characters from interpolated data', () => {
    const r = renderEmail('generic', 'en', { username: '<b>x</b>', heading: 'Hi', body: 'a & b < c' });
    expect(r.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(r.html).toContain('a &amp; b &lt; c');
    // The raw subject keeps the interpolated value; only html escapes.
    expect(r.subject).toBe('Hi');
  });

  it('strips CR/LF from the subject to block header injection', () => {
    const r = renderEmail('generic', 'en', {
      username: 'A', heading: 'Hello\r\nBcc: victim@example.com', body: 'hi',
    });
    expect(r.subject).not.toMatch(/[\r\n]/);
    expect(r.subject).toBe('Hello Bcc: victim@example.com');
  });

  it('falls back to the default locale for an unfilled language', () => {
    const en = renderEmail('password_changed', 'en', { username: 'A' });
    const xx = renderEmail('password_changed', 'xx-YT', { username: 'A' });
    expect(xx.subject).toBe(en.subject);
  });

  it('normalizes region/script subtags to the base language', () => {
    const r = renderEmail('account_created', 'en_US', { username: 'A' });
    expect(r.subject).toContain('Welcome');
  });
});

describe('catalog completeness', () => {
  it('has an English template for every email event', () => {
    const events = Object.keys(EVENT_CATEGORY) as EmailEvent[];
    for (const ev of events) {
      const tpl = CATALOG.en[ev];
      expect(tpl, `missing en template for ${ev}`).toBeTruthy();
      expect(tpl!.subject.length).toBeGreaterThan(0);
      expect(tpl!.text.length).toBeGreaterThan(0);
    }
  });

  it('only generic may default to marketing; every lifecycle event is transactional', () => {
    const marketingDefaults = (Object.keys(EVENT_CATEGORY) as EmailEvent[])
      .filter((e) => EVENT_CATEGORY[e] === 'marketing');
    // generic is fail-closed (gated by default); all six lifecycle events are
    // intrinsically transactional and always delivered.
    expect(marketingDefaults).toEqual(['generic']);
  });
});
