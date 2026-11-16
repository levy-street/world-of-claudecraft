import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const plist = readFileSync('ios/App/App/Info.plist', 'utf8');
const project = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8');
const scene = readFileSync('ios/App/App/SceneDelegate.swift', 'utf8');
const callbacks = scene.split(/\n {4}func /);
const callback = (signature: string) => {
  const body = callbacks.find((part) => part.startsWith(signature));
  expect(body, `missing scene callback: ${signature}`).toBeDefined();
  return body ?? '';
};

describe('iOS scene launch contract', () => {
  it('declares a single application scene so iOS 27 accepts launch', () => {
    expect(plist).toContain('<key>UIApplicationSceneManifest</key>');
    expect(plist).toMatch(/<key>UIApplicationSupportsMultipleScenes<\/key>\s*<false\/>/);
    expect(plist).toContain('<key>UIWindowSceneSessionRoleApplication</key>');
    expect(plist).toContain('<string>$(PRODUCT_MODULE_NAME).SceneDelegate</string>');
    expect(plist).not.toContain('UIWindowSceneSessionRoleExternalDisplay');
  });

  it('lets UIKit load the existing custom bridge storyboard exactly once', () => {
    expect(plist).toMatch(/<key>UISceneStoryboardFile<\/key>\s*<string>Main<\/string>/);
    expect(plist).not.toContain('<key>UIMainStoryboardFile</key>');
    const storyboard = readFileSync('ios/App/App/Base.lproj/Main.storyboard', 'utf8');
    expect(storyboard).toContain('customClass="AppViewController"');
  });

  it('compiles the scene delegate in the App target', () => {
    expect(project).toMatch(/SceneDelegate.swift in Sources \*\/ = \{isa = PBXBuildFile;/);
    const sources = project.match(/isa = PBXSourcesBuildPhase;[\s\S]*?files = \(([\s\S]*?)\);/);
    expect(sources?.[1]).toContain('SceneDelegate.swift in Sources');
  });

  it('initializes the custom bridge before delivering both kinds of cold-start links', () => {
    const connect = callback('scene(_ scene: UIScene, willConnectTo');
    expect(connect).toContain('guard session.role == .windowApplication else { return }');
    expect(connect).toContain('window?.rootViewController?.loadViewIfNeeded()');
    expect(connect).toContain('self.scene(scene, openURLContexts: connectionOptions.urlContexts)');
    expect(connect).toContain('for activity in connectionOptions.userActivities');
    expect(connect).toContain('self.scene(scene, continue: activity)');
    expect(connect.indexOf('loadViewIfNeeded()')).toBeLessThan(
      connect.indexOf('connectionOptions.urlContexts'),
    );
    expect(scene).not.toContain('CAPBridgeViewController()');
    expect(scene).not.toContain('UIWindow(windowScene:');
  });

  it('forwards warm custom URLs with their metadata to the Capacitor launch-URL proxy', () => {
    const open = callback('scene(_ scene: UIScene, openURLContexts');
    expect(open).toContain('for context in URLContexts');
    expect(open).toContain('.openInPlace: context.options.openInPlace');
    expect(open).toContain('options[.sourceApplication] = context.options.sourceApplication');
    expect(open).toContain('options[.annotation] = context.options.annotation');
    expect(open).toContain(
      'ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: options)',
    );
  });

  it('forwards warm universal links through the existing Capacitor validation path', () => {
    const activity = callback('scene(_ scene: UIScene, continue userActivity');
    expect(activity).toContain(
      'ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler:',
    );
    expect(scene).not.toContain('NotificationCenter.default.post');
  });
});
