import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const viewController = readFileSync('ios/App/App/AppViewController.swift', 'utf8');
const appDelegate = readFileSync('ios/App/App/AppDelegate.swift', 'utf8');
const sceneDelegate = readFileSync('ios/App/App/SceneDelegate.swift', 'utf8');
const storyboard = readFileSync('ios/App/App/Base.lproj/Main.storyboard', 'utf8');

describe('native iOS entry diagnostics wiring', () => {
  it('keeps the storyboard on the diagnostic Capacitor view controller', () => {
    expect(storyboard).toContain('customClass="AppViewController"');
    expect(viewController).toContain('class AppViewController: CAPBridgeViewController');
    expect(viewController).toContain(
      'return DiagnosticWebView(frame: frame, configuration: configuration)',
    );
  });

  it('logs native WebView reloads without replacing Capacitor navigation delegation', () => {
    expect(viewController).toContain('override func reload() -> WKNavigation?');
    expect(viewController).toContain('[entry-diag] native WKWebView reload requested');
    expect(viewController).not.toContain('navigationDelegate');
  });

  it('logs memory warnings and every relevant app lifecycle transition', () => {
    expect(appDelegate).toContain('func applicationDidReceiveMemoryWarning');
    expect(sceneDelegate).toContain('scene will resign active');
    expect(sceneDelegate).toContain('scene entered background');
    expect(sceneDelegate).toContain('scene will enter foreground');
    expect(sceneDelegate).toContain('scene became active');
    expect(appDelegate).toContain('application will terminate');
  });
});
