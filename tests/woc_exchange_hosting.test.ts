import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXCHANGE_CSP, isExchangeDocumentPath } from '../server/http/exchange_csp';

describe('WOC Exchange browser hosting', () => {
  it('registers the same pretty aliases in Vite and production', () => {
    const vite = readFileSync('vite.config.ts', 'utf8');
    const server = readFileSync('server/main.ts', 'utf8');
    for (const row of ["['/exchange', '/exchange.html']", "['/exchange/', '/exchange.html']"]) {
      expect(vite).toContain(row);
      expect(server).toContain(row);
    }
    expect(vite).toContain("exchange: fileURLToPath(new URL('exchange.html', import.meta.url))");
  });

  it('limits the Exchange document path and CSP', () => {
    expect(isExchangeDocumentPath('/exchange')).toBe(true);
    expect(isExchangeDocumentPath('/exchange.html')).toBe(true);
    expect(isExchangeDocumentPath('/exchange/listing/1')).toBe(false);
    expect(EXCHANGE_CSP).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(EXCHANGE_CSP).toContain('frame-src https://challenges.cloudflare.com');
    expect(EXCHANGE_CSP).toContain("object-src 'none'");
    expect(EXCHANGE_CSP).toContain("base-uri 'none'");
    expect(EXCHANGE_CSP).toContain("frame-ancestors 'none'");
    expect(EXCHANGE_CSP).not.toContain("'unsafe-eval'");
  });

  it('keeps listing creation and desktop integration out of the SPA source', () => {
    const source = readFileSync('src/exchange/app.ts', 'utf8');
    const client = readFileSync('src/net/woc_exchange_client.ts', 'utf8');
    const shipping = `${source}\n${client}`;
    expect(shipping).not.toContain('.createListing(');
    expect(shipping).not.toContain('.stepUpChallenge(');
    expect(shipping).not.toContain('.createOffer(');
    expect(shipping).not.toContain('/api/woc-market/offers');
    expect(shipping).not.toContain('/api/woc-market/step-up');
    expect(source).not.toContain('desktopBridge');
    expect(source).not.toContain('liveBag');
    expect(source).toContain("from '../net/woc_exchange_client'");
    expect(source).not.toContain('WocMarketClient');
  });
});
