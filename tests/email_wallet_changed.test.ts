// The wallet-changed alert sender (server/email/index.ts emailWalletChanged,
// the R11 compensating control): the address must reach the mail TRUNCATED
// (enough for the owner to recognize their wallet without linking the mailbox
// to a full on-chain identity), and the action must read inline in the
// rendered subject and body.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_email_units';

import { afterEach, describe, expect, it } from 'vitest';
import { __setEmailService, emailWalletChanged } from '../server/email';
import type { EmailSender, OutboundEmail } from '../server/email/sender';
import { EmailService } from '../server/email/service';

function captureService(): { sent: OutboundEmail[] } {
  const sent: OutboundEmail[] = [];
  const sender: EmailSender = {
    name: 'capture',
    async send(msg) {
      sent.push(msg);
    },
  };
  __setEmailService(new EmailService({ sender }));
  return { sent };
}

const TARGET = { id: 7, username: 'guard', email: 'g@x.nz', locale: null, marketing_opt_in: false };
const ADDRESS = 'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx';

afterEach(() => {
  __setEmailService(null);
});

describe('emailWalletChanged', () => {
  it('truncates the address and renders the action into subject and body', async () => {
    const { sent } = captureService();
    emailWalletChanged(TARGET as never, 'changed', ADDRESS);
    await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('g@x.nz');
    expect(sent[0].subject).toContain('was changed');
    expect(sent[0].text).toContain('US51...ELFx');
    expect(sent[0].text).not.toContain(ADDRESS);
  });

  it('a short test value passes through un-truncated', async () => {
    const { sent } = captureService();
    emailWalletChanged(TARGET as never, 'removed', 'PUBKEY');
    await new Promise((r) => setImmediate(r));
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('PUBKEY');
  });
});
