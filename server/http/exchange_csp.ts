export const EXCHANGE_CSP = [
  "default-src 'none'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://secure.walletconnect.com https://api.web3modal.org",
  "font-src 'self' https://fonts.reown.com",
  "connect-src 'self' https://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.com wss://*.walletconnect.org https://api.web3modal.org https://pulse.walletconnect.org",
  'frame-src https://challenges.cloudflare.com https://secure.walletconnect.com https://verify.walletconnect.com',
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export function isExchangeDocumentPath(path: string): boolean {
  return path === '/exchange' || path === '/exchange/' || path === '/exchange.html';
}
