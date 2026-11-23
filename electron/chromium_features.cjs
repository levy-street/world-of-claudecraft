'use strict';

// Chromium keeps ONE value per command-line switch: a second
// app.commandLine.appendSwitch('enable-features', ...) replaces the first value instead of
// adding to it, so two shell levers that each enable a feature would silently cancel each
// other (the Linux Vulkan rungs enable their own feature set, and the shader disk cache
// enables another on the same launch). Every shell lever that enables a Chromium feature
// goes through appendEnabledFeatures, which reads what the switch already holds (from the
// real command line or an earlier append) and writes the merged list back as one value.

const ENABLE_FEATURES_SWITCH = 'enable-features';

/**
 * The feature's name in a feature-list entry: Chromium accepts `Name`, `*Name` (a default
 * override marker), `Name<Trial` and `Name:param/value`, and all of them name the same
 * feature, so a duplicate is judged on this, never on the raw entry.
 */
function featureName(entry) {
  return entry.replace(/^\*/, '').split(/[<:]/)[0];
}

/**
 * `existing` (a comma-separated switch value, possibly empty or absent) plus `additions`,
 * each feature once, the existing entries first and untouched. An addition whose feature
 * is already listed (in any entry form) is dropped rather than appended again.
 */
function mergeFeatureList(existing, additions) {
  const merged = [];
  const names = new Set();
  const incoming = typeof existing === 'string' ? existing.split(',') : [];
  for (const raw of [...incoming, ...(additions ?? [])]) {
    const entry = typeof raw === 'string' ? raw.trim() : '';
    if (entry === '') continue;
    const name = featureName(entry);
    if (name === '' || names.has(name)) continue;
    names.add(name);
    merged.push(entry);
  }
  return merged.join(',');
}

/**
 * Append `features` to the process's `enable-features` switch, merged with what it already
 * holds. Returns the value written. Must run before app 'ready', like every switch.
 */
function appendEnabledFeatures(commandLine, features) {
  const current =
    typeof commandLine.getSwitchValue === 'function'
      ? commandLine.getSwitchValue(ENABLE_FEATURES_SWITCH)
      : '';
  const value = mergeFeatureList(current, features);
  if (value !== '') commandLine.appendSwitch(ENABLE_FEATURES_SWITCH, value);
  return value;
}

module.exports = {
  ENABLE_FEATURES_SWITCH,
  appendEnabledFeatures,
  featureName,
  mergeFeatureList,
};
