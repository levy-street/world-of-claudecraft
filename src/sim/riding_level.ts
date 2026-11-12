// The character level riding is learned at. A constants-only leaf so light
// readers (the item tooltip level gate, item_level_gate.ts) can quote it
// without importing the riding-lesson system in mounts_training.ts, which
// re-exports it as its own tuning value.
export const MOUNT_TRAIN_MIN_LEVEL = 20;
