// idle/: the Idle Classic game host. Public surface is the engine plus the
// storage-decoupling seam a browser dashboard injects; the CLI and the policy
// leaves are imported by callers that need them.
export {
  IdleEngine,
  type IdleEngineOptions,
  type IdleSaveData,
  type IdleStepSummary,
  type IdleStorageProvider,
  type StepCounterSnapshot,
} from './engine';
