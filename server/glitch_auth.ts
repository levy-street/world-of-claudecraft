import type * as http from 'node:http';
import type { CharacterState } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import { hashPassword, newToken, offensiveName } from './auth';
import type { RequestMetadata } from './db';
import { isUniqueViolation, readBody } from './http_util';

export const GLITCH_API_BASE_URL = 'https://api.glitch.fun/api';
export const GLITCH_TITLE_ID = '8254e0f9-6c3a-4c94-8a16-570157b9df3b';

const INSTALL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GLITCH_ACCOUNT_PREFIX = 'glitch';
const GLITCH_ACCOUNT_LIMIT = 48;
const GLITCH_CHARACTER_LIMIT = 16;
const VALID_CLASSES = new Set<PlayerClass>([
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
]);

export type GlitchFetch = typeof fetch;

export interface GlitchServerConfig {
  enabled: boolean;
  apiBaseUrl: string;
  titleId: string;
  titleToken: string;
  defaultClass: PlayerClass;
}

export interface GlitchValidation {
  valid: boolean;
  userName: string;
  licenseType: string | null;
  serverTime: string | null;
  reason: string | null;
}

export interface GlitchLoginCharacter {
  id: number;
  name: string;
  class: PlayerClass;
  level: number;
  skin: number;
  online: boolean;
  forceRename: boolean;
}

export interface GlitchLoginResult {
  token: string;
  username: string;
  realm: string;
  characterCreated: boolean;
  character: GlitchLoginCharacter;
}

export interface GlitchAccountLink {
  account_id: number;
  glitch_user_name: string | null;
}

export interface GlitchCharacterRow {
  id: number;
  account_id: number;
  name: string;
  class: PlayerClass;
  level: number;
  state: CharacterState | null;
  force_rename: boolean;
}

export interface GlitchLoginDeps {
  realm: string;
  config: GlitchServerConfig;
  fetchImpl?: GlitchFetch;
  requestMetadata: (req: http.IncomingMessage) => RequestMetadata;
  initialCharacterState: (cls: PlayerClass, name: string, skin: number) => CharacterState;
  glitchAccountForInstall: (
    titleId: string,
    installId: string,
  ) => Promise<GlitchAccountLink | null>;
  linkGlitchAccount: (
    titleId: string,
    installId: string,
    accountId: number,
    glitchUserName: string,
  ) => Promise<GlitchAccountLink>;
  createAccount: (
    username: string,
    passwordHash: string,
    meta: RequestMetadata,
    opts: { passwordSet: boolean },
  ) => Promise<{ id: number; username: string }>;
  touchLogin: (accountId: number, meta: RequestMetadata) => Promise<void>;
  saveToken: (token: string, accountId: number) => Promise<void>;
  listCharacters: (accountId: number) => Promise<GlitchCharacterRow[]>;
  createCharacterCapped: (
    accountId: number,
    name: string,
    cls: PlayerClass,
    limit: number,
    state: CharacterState,
  ) => Promise<GlitchCharacterRow | null>;
  isCharacterOnline: (characterId: number) => boolean;
}

type JsonResponder = (res: http.ServerResponse, status: number, body: unknown) => void;

class GlitchLoginError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GlitchLoginError';
  }
}

export function readGlitchServerConfig(env: NodeJS.ProcessEnv = process.env): GlitchServerConfig {
  const enabled = String(env.GLITCH_ENABLED ?? env.VITE_GLITCH_ENABLED ?? '') === '1';
  const titleToken = String(
    env.GLITCH_SERVER_TITLE_TOKEN ?? env.VITE_GLITCH_TITLE_TOKEN ?? '',
  ).trim();
  const titleId = String(env.GLITCH_TITLE_ID ?? env.VITE_GLITCH_TITLE_ID ?? GLITCH_TITLE_ID).trim();
  const apiBaseUrl = String(env.GLITCH_API_BASE_URL ?? GLITCH_API_BASE_URL).trim();
  return {
    enabled: enabled && titleToken.length > 0,
    apiBaseUrl: stripTrailingSlash(apiBaseUrl || GLITCH_API_BASE_URL),
    titleId: titleId || GLITCH_TITLE_ID,
    titleToken,
    defaultClass: resolveGlitchClass(env.GLITCH_DEFAULT_CLASS ?? env.VITE_GLITCH_DEFAULT_CLASS),
  };
}

export function safeGlitchDisplayName(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  const printable = Array.from(raw)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('');
  const compact = printable.replace(/\s+/g, ' ').trim();
  if (!compact) return 'Guest Player';
  return Array.from(compact).slice(0, GLITCH_ACCOUNT_LIMIT).join('');
}

export function glitchCharacterNameCandidates(displayName: string, installId: string): string[] {
  const suffix = installId.replace(/-/g, '').slice(0, 4).toUpperCase();
  const cleaned = Array.from(displayName)
    .map((character) => (/^[A-Za-z0-9 _'-]$/.test(character) ? character : ' '))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const base =
    cleaned && !offensiveName(cleaned)
      ? cleaned
      : `Glitch ${suffix.replace(/[0-9]/g, (digit) => String.fromCharCode(65 + Number(digit)))}`;
  const compactBase = ensureCharacterStart(base).slice(0, GLITCH_CHARACTER_LIMIT).trim();
  const root = compactBase.length >= 2 ? compactBase : `Glitch ${suffix}`;
  const suffixText = ` ${suffix}`;
  const suffixedRoot = `${root.slice(0, GLITCH_CHARACTER_LIMIT - suffixText.length).trim()}${suffixText}`;
  const candidates = [root, suffixedRoot];
  for (const letter of 'ABCDEFGHJKLMNPQRSTUVWXYZ') {
    const tail = ` ${letter}`;
    candidates.push(`${root.slice(0, GLITCH_CHARACTER_LIMIT - tail.length).trim()}${tail}`);
  }
  return [...new Set(candidates.filter((name) => name.length >= 2))];
}

export async function completeGlitchLogin(
  input: { installId: string; requestedClass?: unknown },
  meta: RequestMetadata,
  deps: GlitchLoginDeps,
): Promise<GlitchLoginResult> {
  if (!deps.config.enabled)
    throw new GlitchLoginError(503, 'Glitch authentication is not configured');
  const installId = String(input.installId ?? '').trim();
  if (!INSTALL_ID_RE.test(installId)) throw new GlitchLoginError(400, 'invalid Glitch install id');

  const validation = await validateGlitchInstall(deps.config, installId, deps.fetchImpl ?? fetch);
  if (!validation.valid) {
    throw new GlitchLoginError(403, validation.reason ?? 'Glitch license is not valid');
  }

  const displayName = safeGlitchDisplayName(validation.userName);
  let link = await deps.glitchAccountForInstall(deps.config.titleId, installId);
  let accountId = link?.account_id ?? null;
  let accountUsername = link?.glitch_user_name || displayName;

  if (accountId === null) {
    const account = await createLinkedGlitchAccount(displayName, installId, meta, deps);
    accountId = account.id;
    accountUsername = account.username;
    link = await deps.linkGlitchAccount(deps.config.titleId, installId, accountId, displayName);
    accountId = link.account_id;
  } else if (link?.glitch_user_name !== displayName) {
    link = await deps.linkGlitchAccount(deps.config.titleId, installId, accountId, displayName);
    accountUsername = link.glitch_user_name || accountUsername;
  }

  await deps.touchLogin(accountId, meta);
  const resolved = await resolveGlitchCharacter(accountId, displayName, installId, input, deps);
  const character = resolved.character;
  const token = newToken();
  await deps.saveToken(token, accountId);

  return {
    token,
    username: accountUsername,
    realm: deps.realm,
    characterCreated: resolved.created,
    character: {
      id: character.id,
      name: character.name,
      class: character.class,
      level: character.level,
      skin: character.state?.skin ?? 0,
      online: deps.isCharacterOnline(character.id),
      forceRename: character.force_rename,
    },
  };
}

export async function handleGlitchLogin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: GlitchLoginDeps,
  json: JsonResponder,
): Promise<void> {
  try {
    const body = await readBody(req);
    const result = await completeGlitchLogin(
      {
        installId: typeof body.install_id === 'string' ? body.install_id : '',
        requestedClass: body.default_class,
      },
      deps.requestMetadata(req),
      deps,
    );
    return json(res, 200, result);
  } catch (err) {
    if (err instanceof GlitchLoginError) {
      return json(res, err.status, { error: err.message });
    }
    throw err;
  }
}

async function createLinkedGlitchAccount(
  displayName: string,
  installId: string,
  meta: RequestMetadata,
  deps: GlitchLoginDeps,
): Promise<{ id: number; username: string }> {
  for (const username of glitchAccountUsernameCandidates(displayName, installId)) {
    try {
      return await deps.createAccount(username, await hashPassword(newToken()), meta, {
        passwordSet: false,
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new GlitchLoginError(409, 'could not create Glitch account');
}

async function resolveGlitchCharacter(
  accountId: number,
  displayName: string,
  installId: string,
  input: { requestedClass?: unknown },
  deps: GlitchLoginDeps,
): Promise<{ character: GlitchCharacterRow; created: boolean }> {
  const existing = (await deps.listCharacters(accountId)).find(
    (character) => !character.force_rename,
  );
  if (existing) return { character: existing, created: false };

  const cls = resolveGlitchClass(input.requestedClass, deps.config.defaultClass);
  for (const name of glitchCharacterNameCandidates(displayName, installId)) {
    try {
      const created = await deps.createCharacterCapped(
        accountId,
        name,
        cls,
        10,
        deps.initialCharacterState(cls, name, 0),
      );
      if (!created) throw new GlitchLoginError(400, 'character limit reached');
      return { character: created, created: true };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new GlitchLoginError(409, 'that name is taken');
}

function glitchAccountUsernameCandidates(displayName: string, installId: string): string[] {
  const suffix = installId.replace(/-/g, '').slice(0, 8);
  const safe = safeGlitchDisplayName(displayName);
  const base = offensiveName(safe) ? 'Glitch Player' : safe;
  const first = base.slice(0, GLITCH_ACCOUNT_LIMIT).trim() || 'Glitch Player';
  return [
    first,
    `${first.slice(0, Math.max(1, GLITCH_ACCOUNT_LIMIT - suffix.length - 1)).trim()}-${suffix}`,
    `${GLITCH_ACCOUNT_PREFIX}-${suffix}`,
  ];
}

async function validateGlitchInstall(
  config: GlitchServerConfig,
  installId: string,
  fetchImpl: GlitchFetch,
): Promise<GlitchValidation> {
  const response = await fetchImpl(
    `${config.apiBaseUrl}/titles/${config.titleId}/installs/${installId}/validate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.titleToken}` },
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = readReason(data) ?? `Glitch validation failed (${response.status})`;
    throw new GlitchLoginError(response.status === 404 ? 404 : 403, reason);
  }
  const src = unwrapData(data);
  return {
    valid: src.valid === true,
    userName: safeGlitchDisplayName(src.user_name),
    licenseType: typeof src.license_type === 'string' ? src.license_type : null,
    serverTime: typeof src.server_time === 'string' ? src.server_time : null,
    reason: typeof src.reason === 'string' ? src.reason : null,
  };
}

function resolveGlitchClass(raw: unknown, fallback: PlayerClass = 'warrior'): PlayerClass {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return VALID_CLASSES.has(value as PlayerClass) ? (value as PlayerClass) : fallback;
}

function ensureCharacterStart(value: string): string {
  return /^[A-Za-z0-9]/.test(value) ? value : `G${value}`.trim();
}

function unwrapData(value: unknown): Record<string, unknown> {
  const outer = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const inner = outer.data;
  return inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : outer;
}

function readReason(value: unknown): string | null {
  const src = unwrapData(value);
  return typeof src.reason === 'string'
    ? src.reason
    : typeof src.code === 'string'
      ? src.code
      : typeof src.error === 'string'
        ? src.error
        : null;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
