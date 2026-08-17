import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, test } from 'vitest';
import {
  type BatchHeader,
  CONTRACT_VERSION,
  type ContentPackRecord,
} from '../server/parse/contract';
import { ABILITIES, CLASSES } from '../src/sim/content/classes';
import { TALENTS } from '../src/sim/content/talents';
import { DUNGEONS, MOBS, ZONES } from '../src/sim/data';

const repoRoot = path.resolve(__dirname, '..');
const script = path.join(repoRoot, 'scripts/parse/build_content_pack.mjs');
const outputPath = path.join(repoRoot, 'dist', 'parse-content-pack.json');
const packageVersion = (
  JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    version: string;
  }
).version;
const previousOutput = existsSync(outputPath) ? readFileSync(outputPath) : null;

interface ContentPackPayload {
  abilities: Record<string, { name: string; class: string | null; castTime: number }>;
  abilityNameToId: Record<string, string>;
  mobs: Record<
    string,
    { name: string; boss: boolean; elite: boolean; family: string | null; level: number | null }
  >;
  zones: Record<string, string>;
  dungeons: Record<string, { name: string; bossKeys: string[] }>;
  classes: Record<
    string,
    { name: string; resourceType: string | null; specs: Array<{ id: string; name: string }> }
  >;
}

interface ContentPackFile {
  build: string;
  payload: ContentPackPayload;
}

interface ScriptResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runScript(args: string[] = [], env: Record<string, string> = {}): Promise<ScriptResult> {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  return new Promise((resolve, reject) => {
    const killer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`content-pack producer did not exit within 120s:\n${stdout}\n${stderr}`));
    }, 120_000);
    killer.unref();
    child.on('error', (error) => {
      clearTimeout(killer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(killer);
      resolve({ code, stdout, stderr });
    });
  });
}

function readOutput(): ContentPackFile {
  return JSON.parse(readFileSync(outputPath, 'utf8')) as ContentPackFile;
}

afterAll(() => {
  if (previousOutput === null) rmSync(outputPath, { force: true });
  else writeFileSync(outputPath, previousOutput);
});

describe.sequential('parse content-pack producer', () => {
  test('runs directly and emits the live build dictionary', async () => {
    const result = await runScript();

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`parse content pack: build ${packageVersion}`);
    const generated = readOutput();
    expect(generated.build).toBe(packageVersion);
    expect(Object.keys(generated.payload.abilities).sort()).toEqual(Object.keys(ABILITIES).sort());
    expect(Object.keys(generated.payload.mobs).sort()).toEqual(Object.keys(MOBS).sort());
    expect(Object.keys(generated.payload.zones).sort()).toEqual(
      ZONES.map((zone) => zone.id).sort(),
    );
    expect(Object.keys(generated.payload.dungeons).sort()).toEqual(Object.keys(DUNGEONS).sort());
    expect(Object.keys(generated.payload.classes).sort()).toEqual(Object.keys(CLASSES).sort());

    for (const [name, id] of Object.entries(generated.payload.abilityNameToId)) {
      expect(ABILITIES[id]?.name).toBe(name);
    }
    for (const id of Object.keys(CLASSES) as Array<keyof typeof CLASSES>) {
      const cls = CLASSES[id];
      expect(generated.payload.classes[id]).toEqual({
        name: cls.name,
        resourceType: cls.resourceType ?? null,
        specs: (TALENTS[id]?.specs ?? []).map((spec) => ({ id: spec.id, name: spec.name })),
      });
    }
  });

  test('ships the generated dictionary as the versioned gzip NDJSON contract', async () => {
    let resolveRequest:
      | ((request: { headers: Record<string, string>; body: Buffer }) => void)
      | null = null;
    const requestReceived = new Promise<{ headers: Record<string, string>; body: Buffer }>(
      (resolve) => {
        resolveRequest = resolve;
      },
    );
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        resolveRequest?.({
          headers: Object.fromEntries(
            Object.entries(req.headers).flatMap(([key, value]) =>
              typeof value === 'string' ? [[key, value]] : [],
            ),
          ),
          body: Buffer.concat(chunks),
        });
        res.statusCode = 204;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const result = await runScript(['--ship'], {
        PARSE_INGEST_URL: `http://127.0.0.1:${port}/ingest/v1/batch`,
        PARSE_INGEST_TOKEN: 'content-pack-test-secret',
        PARSE_ENV_LABEL: 'qa',
      });
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain('parse content pack shipped');

      const request = await Promise.race([
        requestReceived,
        new Promise<never>((_resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('content-pack request was not received')),
            5000,
          );
          timer.unref();
        }),
      ]);
      expect(request.headers['content-type']).toBe('application/x-ndjson');
      expect(request.headers['content-encoding']).toBe('gzip');
      expect(request.headers['x-woc-parse-secret']).toBe('content-pack-test-secret');
      const [headerLine, recordLine] = gunzipSync(request.body).toString('utf8').split('\n');
      const header = JSON.parse(headerLine) as BatchHeader;
      const record = JSON.parse(recordLine) as ContentPackRecord;
      expect(header).toMatchObject({
        t: 'batch',
        v: CONTRACT_VERSION,
        realm: 'content',
        env: 'qa',
        build: packageVersion,
      });
      expect(header.batchId).toMatch(
        new RegExp(`^content-${packageVersion.replaceAll('.', '\\.')}-\\d+$`),
      );
      expect(header.sentAtMs).toEqual(expect.any(Number));
      expect(record).toEqual({
        t: 'content_pack',
        build: packageVersion,
        payload: readOutput().payload,
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  test('fails closed when --ship lacks ingest credentials', async () => {
    const result = await runScript(['--ship'], {
      PARSE_INGEST_URL: '',
      PARSE_INGEST_TOKEN: '',
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'parse:content --ship needs PARSE_INGEST_URL and PARSE_INGEST_TOKEN',
    );
  });
});
