// The EmailService composes rendering + delivery + marketing gating + audit
// logging into a single never-throws entry point. Routes call the convenience
// wrappers in index.ts; this class holds the policy so it can be unit-tested
// against a fake sender and a fake log, with no database or network.
import { renderEmail } from './templates';
import {
  EVENT_CATEGORY,
  DEFAULT_EMAIL_LOCALE,
  type EmailEvent,
  type EmailCategory,
  type EmailData,
} from './events';
import type { EmailSender } from './sender';

export interface EmailLogSink {
  (entry: {
    accountId: number | null;
    event: EmailEvent;
    toEmail: string;
    category: string;
    ok: boolean;
    error?: string | null;
  }): void;
}

export interface SendRequest<K extends EmailEvent> {
  event: K;
  to: string | null;
  locale?: string | null;
  data: EmailData[K];
  accountId?: number | null;
  // Override the event's default category. Only `generic` is allowed to be sent
  // as 'marketing'; every other event is intrinsically transactional. When
  // omitted, EVENT_CATEGORY[event] applies.
  category?: EmailCategory;
  // Consulted only when the resolved category is 'marketing': a false/undefined
  // opt-in skips the send and logs it, while transactional mail ignores it.
  marketingOptIn?: boolean;
}

export type SendResult = 'sent' | 'skipped' | 'failed';

export interface EmailServiceDeps {
  sender: EmailSender;
  log?: EmailLogSink;
}

export class EmailService {
  constructor(private readonly deps: EmailServiceDeps) {}

  // Send one email. Never throws: a missing address, a marketing opt-out, or a
  // transport error all resolve to a result and an audit log line, so a mail
  // outage can never break the HTTP request that triggered it.
  async send<K extends EmailEvent>(req: SendRequest<K>): Promise<SendResult> {
    const category = req.category ?? EVENT_CATEGORY[req.event];
    const accountId = req.accountId ?? null;
    if (!req.to) return 'skipped';
    if (category === 'marketing' && !req.marketingOptIn) {
      this.deps.log?.({ accountId, event: req.event, toEmail: req.to, category, ok: false, error: 'opt-out' });
      return 'skipped';
    }
    const rendered = renderEmail(req.event, req.locale || DEFAULT_EMAIL_LOCALE, req.data);
    try {
      await this.deps.sender.send({ to: req.to, ...rendered });
      this.deps.log?.({ accountId, event: req.event, toEmail: req.to, category, ok: true });
      return 'sent';
    } catch (err) {
      this.deps.log?.({
        accountId,
        event: req.event,
        toEmail: req.to,
        category,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
      return 'failed';
    }
  }
}
