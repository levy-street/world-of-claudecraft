export function inferExpectedReleaseVersion(input?: {
  argv?: string[];
  env?: Record<string, string | undefined>;
}): string;

export function setPackageVersion(packageJson: string, version: string): string;

export function setPackageLockVersion(packageLock: string, version: string): string;

export function setDesktopDownloadVersion(html: string, version: string, path: string): string;

export function setDesktopModuleVersion(source: string, version: string, path: string): string;

export function setGameVersionText(html: string, version: string, path: string): string;

export function setReadmeVersionBadge(markdown: string, version: string, path: string): string;

export function planReleaseVersion(input: {
  version: string;
  packageJson: string;
  packageLock: string;
  gradle: string;
  pbxproj: string;
  desktopModule: string;
  htmlFiles: Record<string, string>;
  readmeFiles: Record<string, string>;
}): {
  packageJson: string;
  packageLock: string;
  gradle: string;
  pbxproj: string;
  desktopModule: string;
  htmlFiles: Record<string, string>;
  readmeFiles: Record<string, string>;
};

export function collectReleaseVersionFailures(input: {
  version: string;
  packageJson: string;
  packageLock: string;
  gradle: string;
  pbxproj: string;
  desktopModule: string;
  htmlFiles: Record<string, string>;
  readmeFiles: Record<string, string>;
}): string[];
