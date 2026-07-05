import { describe, it, expect, vi } from 'vitest';
import { EmailService } from '../server/email/service';
import type { EmailSender, OutboundEmail } from '../server/email/sender';

function fakeSender(): { sender: EmailSender; sent: OutboundEmail[] } {
  const sent: OutboundEmail[] = [];
  return {
    sent,
    sender: { name: 'fake', async send(msg) { sent.push(msg); } },
  };
}

describe('EmailService.send', () => {
  it('renders and delivers a transactional email exactly once and logs ok', async () => {
    const { sender, sent } = fakeSender();
    const log = vi.fn();
    const svc = new EmailService({ sender, log });
    const result = await svc.send({
      event: 'password_changed', to: 'a@b.com', accountId: 7, data: { username: 'Aelwyn' },
    });
    expect(result).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('a@b.com');
    expect(sent[0].subject).toContain('password');
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: 'password_changed', ok: true, accountId: 7 }));
  });

  it('skips (no send) when the recipient address is missing', async () => {
    const { sender, sent } = fakeSender();
    const svc = new EmailService({ sender });
    const result = await svc.send({ event: 'account_created', to: null, data: { username: 'X' } });
    expect(result).toBe('skipped');
    expect(sent).toHaveLength(0);
  });

  it('drops a marketing send for an opted-out account and logs the opt-out', async () => {
    const { sender, sent } = fakeSender();
    const log = vi.fn();
    const svc = new EmailService({ sender, log });
    const result = await svc.send({
      event: 'generic', category: 'marketing', to: 'a@b.com', accountId: 1,
      marketingOptIn: false, data: { username: 'A', heading: 'News', body: 'Patch notes' },
    });
    expect(result).toBe('skipped');
    expect(sent).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ category: 'marketing', ok: false, error: 'opt-out' }));
  });

  it('delivers a marketing send when the account has opted in', async () => {
    const { sender, sent } = fakeSender();
    const svc = new EmailService({ sender });
    const result = await svc.send({
      event: 'generic', category: 'marketing', to: 'a@b.com',
      marketingOptIn: true, data: { username: 'A', heading: 'News', body: 'Patch notes' },
    });
    expect(result).toBe('sent');
    expect(sent).toHaveLength(1);
  });

  it('never throws and reports failure when the transport rejects', async () => {
    const sender: EmailSender = { name: 'boom', async send() { throw new Error('smtp down'); } };
    const log = vi.fn();
    const svc = new EmailService({ sender, log });
    const result = await svc.send({ event: 'account_created', to: 'a@b.com', data: { username: 'X' } });
    expect(result).toBe('failed');
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'smtp down' }));
  });
});
