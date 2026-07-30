// Private filesystem lifecycle for production CPU incident artifacts.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const OUTPUT_MARKER = 'woc-prod-cpu-monitor-v1\n';
const CAPTURE_MARKER = 'woc-prod-cpu-capture-v1\n';

export async function privateWrite(file, data) {
  await writeFile(file, data, { mode: 0o600 });
  await chmod(file, 0o600);
}

export async function privateAtomicWrite(file, data) {
  const temporaryPath = `${file}.${process.pid}.tmp`;
  await privateWrite(temporaryPath, data);
  await rename(temporaryPath, file);
  await chmod(file, 0o600);
}

export async function prepareOutputDirectory(outDir) {
  const markerPath = path.join(outDir, '.woc-prod-cpu-monitor');
  let directoryInfo;
  try {
    directoryInfo = await lstat(outDir);
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
      throw new Error('monitor output path must be a real directory');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    await mkdir(outDir, { recursive: true, mode: 0o700 });
    await privateWrite(markerPath, OUTPUT_MARKER);
    await chmod(outDir, 0o700);
    return;
  }

  const currentUid = process.getuid?.();
  if (currentUid === undefined || directoryInfo.uid !== currentUid) {
    throw new Error(`refusing unowned monitor output directory: ${outDir}`);
  }

  let markerInfo = null;
  try {
    markerInfo = await lstat(markerPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (markerInfo === null) {
    const empty = (await readdir(outDir)).length === 0;
    const privateMode = (directoryInfo.mode & 0o077) === 0;
    if (!empty || !privateMode) {
      throw new Error(`refusing unowned monitor output directory: ${outDir}`);
    }
    await privateWrite(markerPath, OUTPUT_MARKER);
  } else if (
    markerInfo.isSymbolicLink() ||
    !markerInfo.isFile() ||
    markerInfo.uid !== directoryInfo.uid ||
    (await readFile(markerPath, 'utf8')) !== OUTPUT_MARKER
  ) {
    throw new Error(`refusing unowned monitor output directory: ${outDir}`);
  }
  await chmod(outDir, 0o700);
}

export async function markCaptureDirectory(captureDir) {
  await privateWrite(path.join(captureDir, '.woc-prod-cpu-capture'), CAPTURE_MARKER);
}

async function checksumFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function writeChecksums(captureDir) {
  const names = (await readdir(captureDir)).filter((name) => name !== 'checksums.sha256').sort();
  const lines = [];
  for (const name of names) {
    const file = path.join(captureDir, name);
    if ((await stat(file)).isFile()) lines.push(`${await checksumFile(file)}  ${name}`);
  }
  await privateAtomicWrite(path.join(captureDir, 'checksums.sha256'), `${lines.join('\n')}\n`);
}

export async function pruneCaptures(options) {
  const candidates = (await readdir(options.outDir)).filter((name) =>
    /^capture-\d{8}T\d{9}Z$/.test(name),
  );
  const validated = [];
  for (const name of candidates) {
    const capturePath = path.join(options.outDir, name);
    const info = await lstat(capturePath);
    if (info.isSymbolicLink() || !info.isDirectory()) continue;
    let allowIncompleteFallback = true;
    try {
      const metadata = JSON.parse(await readFile(path.join(capturePath, 'metadata.json'), 'utf8'));
      if (metadata.schemaVersion === 1) {
        allowIncompleteFallback = false;
      }
      if (
        metadata.schemaVersion === 1 &&
        metadata.targetHost === options.targetHost &&
        metadata.container === options.container
      ) {
        validated.push({ name, capturePath, createdAt: Date.parse(metadata.startedAt) });
        continue;
      }
    } catch {
      // A monitor-owned capture marker safely identifies crash-incomplete output.
    }
    if (!allowIncompleteFallback) continue;
    try {
      const markerPath = path.join(capturePath, '.woc-prod-cpu-capture');
      const marker = await lstat(markerPath);
      if (
        marker.isSymbolicLink() ||
        !marker.isFile() ||
        marker.uid !== info.uid ||
        info.uid !== process.getuid?.() ||
        (await readFile(markerPath, 'utf8')) !== CAPTURE_MARKER
      ) {
        continue;
      }
      validated.push({
        name,
        capturePath,
        createdAt: Number.isFinite(info.birthtimeMs) ? info.birthtimeMs : info.mtimeMs,
      });
    } catch {
      // Unknown directories are never removed by this monitor.
    }
  }
  validated.sort((left, right) => left.name.localeCompare(right.name));
  const expired = validated.filter(
    (entry) =>
      Number.isFinite(entry.createdAt) && Date.now() - entry.createdAt > options.maxCaptureAgeMs,
  );
  const current = validated.filter((entry) => !expired.includes(entry));
  const overflow = current.slice(0, Math.max(0, current.length - options.maxCaptures));
  const remove = [...new Set([...expired, ...overflow].map((entry) => entry.capturePath))];
  await Promise.all(remove.map((capturePath) => rm(capturePath, { recursive: true })));
}
