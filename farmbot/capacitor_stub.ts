// Bundle-time stand-ins for @capacitor/app and @capacitor/core, aliased over
// the real plugins by scripts/build_farmbot.mjs. src/net/online.ts imports
// both at module scope, so the specifiers must resolve even though the
// NATIVE_APP gate (falsy in the bot bundle: VITE_NATIVE_APP is defined to '')
// means none of this ever runs. The shapes mirror what online.ts touches:
// App.addListener returns a promise of a handle with an async remove().

export interface StubPluginListenerHandle {
  remove(): Promise<void>;
}

export const App = {
  addListener(
    _eventName: string,
    _listener: (data: Record<string, unknown>) => void,
  ): Promise<StubPluginListenerHandle> {
    return Promise.resolve({ remove: () => Promise.resolve() });
  },
};

export const Capacitor = {
  isNativePlatform: (): boolean => false,
  getPlatform: (): string => 'web',
};
