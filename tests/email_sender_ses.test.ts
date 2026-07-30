import type { SendEmailCommandInput } from '@aws-sdk/client-sesv2';
import { describe, expect, it } from 'vitest';
import { ConsoleSender, HttpSender, selectSender } from '../server/email/sender';
import { SesSender } from '../server/email/ses_sender';

const MSG = {
  to: 'player@example.com',
  subject: 'Verify your email',
  html: '<p>Hello</p>',
  text: 'Hello',
};

function fakeClient() {
  const inputs: SendEmailCommandInput[] = [];
  return {
    inputs,
    client: {
      async sendEmail(input: SendEmailCommandInput) {
        inputs.push(input);
        return {};
      },
    },
  };
}

describe('selectSender with EMAIL_PROVIDER=ses', () => {
  it('selects the SES transport when provider, region, and from are all set', () => {
    const sender = selectSender({
      EMAIL_PROVIDER: 'ses',
      AWS_REGION: 'us-east-1',
      EMAIL_FROM: 'noreply@worldofclaudecraft.com',
    } as NodeJS.ProcessEnv);
    expect(sender).toBeInstanceOf(SesSender);
    expect(sender.name).toBe('ses');
  });

  it('prefers EMAIL_SES_REGION over AWS_REGION', () => {
    const sender = selectSender({
      EMAIL_PROVIDER: 'ses',
      AWS_REGION: 'us-east-1',
      EMAIL_SES_REGION: 'eu-west-1',
      EMAIL_FROM: 'noreply@worldofclaudecraft.com',
    } as NodeJS.ProcessEnv);
    expect(sender).toBeInstanceOf(SesSender);
    expect((sender as SesSender).region).toBe('eu-west-1');
  });

  it('falls back to console when the region is missing', () => {
    const sender = selectSender({
      EMAIL_PROVIDER: 'ses',
      EMAIL_FROM: 'noreply@worldofclaudecraft.com',
    } as NodeJS.ProcessEnv);
    expect(sender).toBeInstanceOf(ConsoleSender);
  });

  it('falls back to console when EMAIL_FROM is missing', () => {
    const sender = selectSender({
      EMAIL_PROVIDER: 'ses',
      AWS_REGION: 'us-east-1',
    } as NodeJS.ProcessEnv);
    expect(sender).toBeInstanceOf(ConsoleSender);
  });

  it('wins over a fully configured http transport (explicit provider beats implicit)', () => {
    const sender = selectSender({
      EMAIL_PROVIDER: 'ses',
      AWS_REGION: 'us-east-1',
      EMAIL_FROM: 'noreply@worldofclaudecraft.com',
      EMAIL_API_URL: 'https://api.example.com/emails',
      EMAIL_API_KEY: 'key',
    } as NodeJS.ProcessEnv);
    expect(sender).toBeInstanceOf(SesSender);
  });

  it('leaves the existing http selection untouched when EMAIL_PROVIDER is unset', () => {
    const sender = selectSender({
      EMAIL_API_URL: 'https://api.example.com/emails',
      EMAIL_API_KEY: 'key',
      EMAIL_FROM: 'noreply@worldofclaudecraft.com',
    } as NodeJS.ProcessEnv);
    expect(sender).toBeInstanceOf(HttpSender);
    expect(sender.name).toBe('http');
  });

  it('still defaults to console with no email configuration at all', () => {
    const sender = selectSender({} as NodeJS.ProcessEnv);
    expect(sender).toBeInstanceOf(ConsoleSender);
  });
});

describe('SesSender.send', () => {
  it('maps the outbound email onto a SendEmail input', async () => {
    const { client, inputs } = fakeClient();
    const sender = new SesSender(
      { region: 'us-east-1', from: 'noreply@worldofclaudecraft.com' },
      client,
    );
    await sender.send(MSG);
    expect(inputs).toHaveLength(1);
    const input = inputs[0];
    expect(input.FromEmailAddress).toBe('noreply@worldofclaudecraft.com');
    expect(input.Destination?.ToAddresses).toEqual(['player@example.com']);
    expect(input.Content?.Simple?.Subject?.Data).toBe('Verify your email');
    expect(input.Content?.Simple?.Body?.Html?.Data).toBe('<p>Hello</p>');
    expect(input.Content?.Simple?.Body?.Text?.Data).toBe('Hello');
  });

  it('rejects with the SES error when delivery fails', async () => {
    const sender = new SesSender(
      { region: 'us-east-1', from: 'noreply@worldofclaudecraft.com' },
      {
        async sendEmail() {
          throw new Error('MessageRejected: Email address is not verified.');
        },
      },
    );
    await expect(sender.send(MSG)).rejects.toThrow(/MessageRejected/);
  });
});
