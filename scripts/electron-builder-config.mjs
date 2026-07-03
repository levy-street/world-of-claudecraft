// Pure construction of the EFFECTIVE electron-builder configuration for one
// desktop distribution channel. The static, channel-independent config stays in
// package.json's "build" block (single visible source of truth); this module
// derives the per-channel variant from it:
//
//  - every channel: stamps `extraMetadata.wocDesktop` into the packaged
//    package.json (distribution + the web origins the Vite bundle was baked
//    with + optional crash submit URL), which is how the shipped main process
//    (electron/desktop_config.cjs) knows what it is at runtime, how the
//    auto-updater stays OFF in Steam builds, and why a packaged build never
//    honors the VITE_DESKTOP_* runtime env pair.
//  - steam: publish is nulled (no app-update.yml is emitted, electron-updater
//    has nothing to read even if it were reached), and every OS targets 'dir'
//    because SteamPipe depots upload the loose installed layout (mac: the
//    signed .app; win: win-unpacked; linux: linux-unpacked), never installers.
//  - windows signing: Azure Artifact Signing options are injected only when the
//    caller resolved a complete set from the environment, so unsigned local
//    builds never trip the signing step.
//
// Kept free of child_process/fs so tests/electron_builder_config.test.ts can pin
// the channel differences directly.

export function azureSignOptionsFromEnv(env = {}) {
  const options = {
    publisherName: env.WIN_SIGN_PUBLISHER_NAME,
    endpoint: env.WIN_SIGN_ENDPOINT,
    codeSigningAccountName: env.WIN_SIGN_ACCOUNT_NAME,
    certificateProfileName: env.WIN_SIGN_PROFILE_NAME,
  };
  const values = Object.values(options);
  if (values.every((value) => typeof value === 'string' && value !== '')) return options;
  return null;
}

// Collapse [{target, arch}] entries to bare target names so `pack` mode builds
// only the host arch: the full arch matrix (mac universal, win/linux x64+arm64)
// is a RELEASE concern, and a local --dir verification pack should stay fast.
function stripArch(targets) {
  if (!Array.isArray(targets)) return targets;
  return targets.map((entry) =>
    entry && typeof entry === 'object' && 'target' in entry ? entry.target : entry,
  );
}

export function desktopBuilderConfig({
  base,
  distribution,
  mode = 'build',
  apiOrigin = '',
  loginOrigin = '',
  crashSubmitUrl = '',
  azureSign = null,
}) {
  if (distribution !== 'website' && distribution !== 'steam') {
    throw new Error(`unknown desktop distribution: ${distribution}`);
  }
  const config = structuredClone(base);
  config.extraMetadata = {
    ...(config.extraMetadata ?? {}),
    wocDesktop: {
      distribution,
      ...(apiOrigin ? { apiOrigin } : {}),
      ...(loginOrigin ? { loginOrigin } : {}),
      ...(crashSubmitUrl ? { crashSubmitUrl } : {}),
    },
  };
  if (azureSign) {
    config.win = { ...(config.win ?? {}), azureSignOptions: azureSign };
  }
  if (distribution === 'steam') {
    config.publish = null;
    config.directories = { ...(config.directories ?? {}), output: 'release-steam' };
    // One depot per OS: mac ships a single universal .app (Steam has no mac
    // arch selector), win and linux ship x64 (Steam's depot arch filter is
    // 32/64-bit only; win-arm64 runs the x64 build under emulation).
    config.mac = { ...(config.mac ?? {}), target: [{ target: 'dir', arch: ['universal'] }] };
    config.win = { ...(config.win ?? {}), target: [{ target: 'dir', arch: ['x64'] }] };
    config.linux = { ...(config.linux ?? {}), target: [{ target: 'dir', arch: ['x64'] }] };
  }
  if (mode === 'pack') {
    for (const os of ['mac', 'win', 'linux']) {
      if (config[os]?.target) config[os] = { ...config[os], target: stripArch(config[os].target) };
    }
  }
  return config;
}
