import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  diagnosticsCaptureAllowed,
  diagnosticsReadAllowed,
  isLoopbackHost,
  isLoopbackRemoteAddress,
  sameOrigin,
} from '../scripts/lib/diagnostics_capture_guard.mjs';

describe('diagnostics capture guard', () => {
  it('keeps the guard in the production Docker build context', () => {
    const dockerignore = readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8');
    expect(dockerignore).toContain('!scripts/lib/');
    expect(dockerignore).toContain('!scripts/lib/diagnostics_capture_guard.mjs');
  });

  it('accepts only concrete loopback socket addresses', () => {
    expect(isLoopbackRemoteAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackRemoteAddress('::1')).toBe(true);
    expect(isLoopbackRemoteAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackRemoteAddress('192.168.1.20')).toBe(false);
    expect(isLoopbackRemoteAddress('203.0.113.9')).toBe(false);
    expect(isLoopbackRemoteAddress(undefined)).toBe(false);
  });

  it('accepts only loopback Host headers', () => {
    expect(isLoopbackHost('127.0.0.1:5173')).toBe(true);
    expect(isLoopbackHost('localhost:5173')).toBe(true);
    expect(isLoopbackHost('[::1]:5173')).toBe(true);
    expect(isLoopbackHost('evil.example:5173')).toBe(false);
    expect(isLoopbackHost('0.0.0.0:5173')).toBe(false);
    expect(isLoopbackHost(undefined)).toBe(false);
  });
  it('fails closed when Origin or Host is missing or malformed', () => {
    expect(sameOrigin('http://127.0.0.1:5173', '127.0.0.1:5173')).toBe(true);
    expect(sameOrigin(undefined, '127.0.0.1:5173')).toBe(false);
    expect(sameOrigin('http://127.0.0.1:5173', undefined)).toBe(false);
    expect(sameOrigin('not a URL', '127.0.0.1:5173')).toBe(false);
    expect(sameOrigin('http://evil.example', '127.0.0.1:5173')).toBe(false);
    expect(sameOrigin('http://evil.example:5173', 'evil.example:5173')).toBe(false);
  });

  it('protects both the latest-report read and report capture write', () => {
    expect(diagnosticsReadAllowed('127.0.0.1', '127.0.0.1:5173')).toBe(true);
    expect(diagnosticsReadAllowed('203.0.113.9', '127.0.0.1:5173')).toBe(false);
    expect(diagnosticsReadAllowed('127.0.0.1', 'evil.example:5173')).toBe(false);
    expect(diagnosticsCaptureAllowed('127.0.0.1', 'http://127.0.0.1:5173', '127.0.0.1:5173')).toBe(
      true,
    );
    expect(diagnosticsCaptureAllowed('127.0.0.1', undefined, '127.0.0.1:5173')).toBe(false);
    expect(
      diagnosticsCaptureAllowed('203.0.113.9', 'http://127.0.0.1:5173', '127.0.0.1:5173'),
    ).toBe(false);
  });
});

it('keeps dependency installation opt-in in the Windows launcher', () => {
  const launcher = readFileSync(
    new URL('../diagnostics/start-diagnostics.ps1', import.meta.url),
    'utf8',
  );
  expect(launcher).toContain('[switch]$InstallDependencies');
  expect(launcher).toContain('if ($InstallDependencies)');
  expect(launcher).not.toContain('[switch]$SkipInstall');
  expect(launcher).toContain("$env:WOC_DIAGNOSTICS_CAPTURE = '1'");
});
it('keeps the collector opt-in and decodes UTF-8 before enforcing the byte cap', () => {
  const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  expect(vite).toContain("process.env.WOC_DIAGNOSTICS_CAPTURE === '1'");
  const collector = vite.slice(vite.indexOf('function diagnosticsCapturePlugin()'));
  expect(collector).toContain("req.setEncoding('utf8')");
  expect(collector).toContain("Buffer.byteLength(text, 'utf8')");
  expect(collector).not.toContain('body += String(chunk)');
});
