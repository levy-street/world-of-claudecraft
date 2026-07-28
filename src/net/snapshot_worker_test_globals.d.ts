// The worker lib reference makes TypeScript narrow mocked addEventListener keys
// in two browser tests. These browser events exist only in the test host and are
// declared here until the worker entry is split into its own tsconfig.
interface DedicatedWorkerGlobalScopeEventMap {
  popstate: PopStateEvent;
  keydown: KeyboardEvent;
}
