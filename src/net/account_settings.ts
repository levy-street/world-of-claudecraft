import {
  type AccountSettingsEntries,
  type DeviceType,
  validateAccountSettingsEntries,
} from '../account_settings_contract';
import { apiErrorFromBody } from './api_error';

/** A fixed credential prevents a delayed save from crossing an account switch. */
export class AccountSettingsClient {
  constructor(
    private readonly token: string,
    private readonly base = '',
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  private async request(path: string, body?: unknown, keepalive = false): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.base}/api/account/settings${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        keepalive,
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw apiErrorFromBody(data, response.status);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async status(): Promise<{ acknowledged: boolean; accountId: number }> {
    const data = (await this.request('')) as { acknowledged?: unknown; accountId?: unknown } | null;
    if (
      typeof data?.acknowledged !== 'boolean' ||
      typeof data.accountId !== 'number' ||
      !Number.isSafeInteger(data.accountId) ||
      data.accountId <= 0
    ) {
      throw new Error('invalid account settings status');
    }
    return { acknowledged: data.acknowledged, accountId: data.accountId };
  }

  async acknowledge(): Promise<void> {
    const data = (await this.request('/ack', { understood: true })) as {
      acknowledged?: unknown;
    } | null;
    if (data?.acknowledged !== true) throw new Error('invalid account settings acknowledgement');
  }

  async initialize(
    deviceType: DeviceType,
    characterId: number,
    entries: AccountSettingsEntries,
  ): Promise<AccountSettingsEntries> {
    if (!validateAccountSettingsEntries(entries))
      throw new Error('invalid account settings entries');
    const data = (await this.request('/initialize', { deviceType, characterId, entries })) as {
      entries?: unknown;
    } | null;
    const result = validateAccountSettingsEntries(data?.entries);
    if (!result) throw new Error('invalid account settings response');
    return result;
  }

  async save(
    deviceType: DeviceType,
    entries: AccountSettingsEntries,
    keepalive = false,
  ): Promise<void> {
    if (!validateAccountSettingsEntries(entries))
      throw new Error('invalid account settings entries');
    const data = (await this.request('/save', { deviceType, entries }, keepalive)) as {
      saved?: unknown;
    } | null;
    if (data?.saved !== true) throw new Error('invalid account settings save response');
  }
}
