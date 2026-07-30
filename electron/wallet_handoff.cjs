'use strict';

const HANDOFF_CODE = /^[A-Za-z0-9_-]{43}$/;

function sanitizeWalletHandoffCode(value) {
  return typeof value === 'string' && HANDOFF_CODE.test(value) ? value : null;
}

function buildWalletHandoffBrowserUrl(origin, code) {
  const safeCode = sanitizeWalletHandoffCode(code);
  if (!safeCode) throw new Error('invalid wallet handoff code');
  const url = new URL('/wallet-handoff', origin);
  url.hash = new URLSearchParams({ code: safeCode }).toString();
  return url.toString();
}

function parseWalletHandoffDeepLink(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'worldofclaudecraft:' || url.hostname !== 'wallet-handoff') return null;
  const code = sanitizeWalletHandoffCode(url.searchParams.get('code'));
  return code ? { code } : null;
}

module.exports = {
  buildWalletHandoffBrowserUrl,
  parseWalletHandoffDeepLink,
  sanitizeWalletHandoffCode,
};
