import { EventEmitter } from 'node:events';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertHarvestPortAvailable,
  harvestViteCommand,
  startHarvestVite,
  stopHarvestVite,
} from '../scripts/lib/shader_harvest_server.mjs';

const io = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
  createServer: vi.fn(),
  openSync: vi.fn(),
  closeSync: vi.fn(),
  rmSync: vi.fn(),
}));
vi.mock('node:child_process', () => ({ spawn: io.spawn, spawnSync: io.spawnSync }));
vi.mock('node:net', () => ({ createServer: io.createServer }));
vi.mock('node:fs', () => ({
  default: { openSync: io.openSync, closeSync: io.closeSync, rmSync: io.rmSync },
}));

function childProcess() {
  const child = new EventEmitter();
  Object.assign(child, { pid: 1234, exitCode: null, signalCode: null, kill: vi.fn() });
  return child;
}

beforeEach(() => {
  vi.resetAllMocks();
  io.openSync.mockReturnValue(42);
  io.createServer.mockImplementation(() => {
    const probe = new EventEmitter();
    probe.listen = vi.fn((_options, ready) => ready());
    probe.close = vi.fn((closed) => closed());
    return probe;
  });
});
afterEach(() => vi.restoreAllMocks());

describe('shader harvest server ownership', () => {
  it('launches Node directly with a single path argument even when the root has spaces', async () => {
    const root = path.resolve('temporary worktree with spaces');
    const child = childProcess();
    io.spawn.mockReturnValue(child);
    const server = await startHarvestVite(root, 5188, 'vite.log');
    const { command, args } = harvestViteCommand(root, 5188);
    expect(command).toBe(process.execPath);
    expect(args).toEqual([
      path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--force',
      '--port',
      '5188',
      '--strictPort',
      '--host',
      '127.0.0.1',
    ]);
    expect(io.spawn).toHaveBeenCalledWith(command, args, {
      cwd: root,
      stdio: ['ignore', 42, 42],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    expect(io.closeSync).toHaveBeenCalledWith(42);
    expect(() => server.assertRunning()).not.toThrow();
    child.emit('error', new Error('executable missing'));
    expect(() => server.assertRunning()).toThrow('executable missing');
  });

  it('refuses an occupied port before changing caches or spawning any process', async () => {
    io.createServer.mockImplementation(() => {
      const probe = new EventEmitter();
      probe.listen = () => probe.emit('error', new Error('EADDRINUSE'));
      return probe;
    });
    await expect(startHarvestVite('/worktree', 5188, 'vite.log')).rejects.toThrow('EADDRINUSE');
    expect(io.spawn).not.toHaveBeenCalled();
    expect(io.spawnSync).not.toHaveBeenCalled();
    expect(io.rmSync).not.toHaveBeenCalled();
  });

  it('closes the availability probe and surfaces a child that exits during startup', async () => {
    const probe = io.createServer();
    io.createServer.mockReturnValue(probe);
    await assertHarvestPortAvailable(5188);
    expect(probe.close).toHaveBeenCalledOnce();
    const child = childProcess();
    io.spawn.mockReturnValue(child);
    const server = await startHarvestVite('/worktree', 5188, 'vite.log');
    child.exitCode = 1;
    expect(() => server.assertRunning()).toThrow('Vite exited');
  });

  it('terminates only its owned Windows process tree and waits for close', async () => {
    const child = childProcess();
    io.spawnSync.mockReturnValue({ status: 0 });
    let stopped = false;
    const stopping = stopHarvestVite(child, 'win32').then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(io.spawnSync).toHaveBeenCalledWith('taskkill', ['/pid', '1234', '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    child.emit('close');
    await stopping;
    expect(stopped).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('signals only its private POSIX process group', async () => {
    const child = childProcess();
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    const stopping = stopHarvestVite(child, 'linux');
    expect(kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
    child.emit('close');
    await stopping;
    expect(io.spawnSync).not.toHaveBeenCalled();
  });

  it('never signals a PID after its owned child has already exited', async () => {
    const child = childProcess();
    child.exitCode = 1;
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    await stopHarvestVite(child, 'win32');
    await stopHarvestVite(child, 'linux');
    expect(io.spawnSync).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });
});
