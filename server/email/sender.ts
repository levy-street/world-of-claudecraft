// The delivery seam. Everything above this file is pure rendering; everything
// provider-specific is isolated here so swapping mail providers, or running with
// none in dev, is a one-file concern. No new dependency: HttpSender uses the
// same raw `fetch` the codebase already uses for Turnstile and the Solana RPC.

import { SesSender } from './ses_sender';

export interface OutboundEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSender {
  // Deliver one message. Implementations should reject on hard failure; the
  // EmailService wraps every call so a rejection is logged, never thrown to the
  // request handler.
  send(msg: OutboundEmail): Promise<void>;
  // Human-readable transport name, surfaced in startup logs.
  readonly name: string;
}

// Dev / no-config default: prints the email to the server log and "sends"
// nothing. Active whenever the EMAIL_API_* env vars are absent, so local
// development and tests never need a real mail provider or leak real mail.
export class ConsoleSender implements EmailSender {
  readonly name = 'console';
  async send(msg: OutboundEmail): Promise<void> {
    console.log(`[email:console] to=${redactEmail(msg.to)} subject=${JSON.stringify(msg.subject)}`);
  }
}

function redactEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf('@');
  if (at <= 0) return '[redacted]';
  const domain = trimmed.slice(at + 1);
  return `${trimmed[0]}***@${domain || '[redacted]'}`;
}

// Provider-agnostic HTTP transport. POSTs a JSON envelope to EMAIL_API_URL with
// a bearer key. The exact request shape is intentionally generic (to/from/
// subject/html/text); adapting to a specific provider's API is a change to this
// one method only.
export interface HttpSenderConfig {
  apiUrl: string;
  apiKey: string;
  from: string;
}

export class HttpSender implements EmailSender {
  readonly name = 'http';
  constructor(private readonly cfg: HttpSenderConfig) {}
  async send(msg: OutboundEmail): Promise<void> {
    const res = await fetch(this.cfg.apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        from: this.cfg.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`email provider responded ${res.status}: ${detail.slice(0, 200)}`);
    }
  }
}

// Pick a transport from the environment. An explicit EMAIL_PROVIDER=ses wins;
// otherwise the generic http transport requires BOTH a provider URL and key
// plus a from-address. Anything missing falls back to console so a
// half-configured env can never silently drop mail on the floor without a log.
export function selectSender(env: NodeJS.ProcessEnv = process.env): EmailSender {
  const from = env.EMAIL_FROM?.trim();
  if (env.EMAIL_PROVIDER?.trim() === 'ses') {
    const region = env.EMAIL_SES_REGION?.trim() || env.AWS_REGION?.trim();
    if (region && from) {
      return new SesSender({ region, from });
    }
    return new ConsoleSender();
  }
  const apiUrl = env.EMAIL_API_URL?.trim();
  const apiKey = env.EMAIL_API_KEY?.trim();
  if (apiUrl && apiKey && from) {
    return new HttpSender({ apiUrl, apiKey, from });
  }
  return new ConsoleSender();
}
