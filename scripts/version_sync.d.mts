// Type declarations for the pure string transforms in version_sync.mjs, imported
// by tests/version_sync.test.ts (the .mjs has no inline types, mirrors malware_scan.d.mts).

export function setGradleVersionName(gradle: string, version: string): string;
export function bumpGradleVersionCode(gradle: string): string;
export function setMarketingVersion(pbxproj: string, version: string): string;
export function bumpCurrentProjectVersion(pbxproj: string): string;
export function planVersionSync(input: { version: string; gradle: string; pbxproj: string }): {
  gradle: string;
  pbxproj: string;
};
