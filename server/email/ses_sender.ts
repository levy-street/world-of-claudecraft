// AWS SES transport. SES signs requests with SigV4, which the generic
// HttpSender's bearer-token POST cannot do, so this is the one place the AWS
// SDK enters the codebase (server bundle only; the game client never sees it).
// Credentials come from the SDK's default chain: an IAM instance role in
// production, AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY env vars otherwise.
//
// The SDK is loaded lazily on first send, never at module load: the Vitest
// config resolves with the browser condition (svelteTesting), under which the
// SDK's browser build fails to import, and eager loading would also tax every
// server boot that never selects SES. Only type imports appear at top level.
import type { SendEmailCommandInput } from '@aws-sdk/client-sesv2';
import type { EmailSender, OutboundEmail } from './sender';

export interface SesSenderConfig {
  region: string;
  from: string;
}

// The one operation we use, injectable so tests never construct a real client.
export interface SesClientLike {
  sendEmail(input: SendEmailCommandInput): Promise<unknown>;
}

export class SesSender implements EmailSender {
  readonly name = 'ses';
  readonly region: string;
  private readonly from: string;
  private clientPromise: Promise<SesClientLike> | undefined;

  constructor(cfg: SesSenderConfig, client?: SesClientLike) {
    this.region = cfg.region;
    this.from = cfg.from;
    if (client) this.clientPromise = Promise.resolve(client);
  }

  private resolveClient(): Promise<SesClientLike> {
    this.clientPromise ??= import('@aws-sdk/client-sesv2').then(
      ({ SESv2Client, SendEmailCommand }) => {
        const sdk = new SESv2Client({ region: this.region });
        return { sendEmail: (input) => sdk.send(new SendEmailCommand(input)) };
      },
    );
    return this.clientPromise;
  }

  async send(msg: OutboundEmail): Promise<void> {
    const client = await this.resolveClient();
    await client.sendEmail({
      FromEmailAddress: this.from,
      Destination: { ToAddresses: [msg.to] },
      Content: {
        Simple: {
          Subject: { Data: msg.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: msg.html, Charset: 'UTF-8' },
            Text: { Data: msg.text, Charset: 'UTF-8' },
          },
        },
      },
    });
  }
}
