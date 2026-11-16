import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    // UIKit creates this window from the scene's Main storyboard, preserving
    // AppViewController and its custom native plugins. Do not create a second bridge.
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard session.role == .windowApplication else { return }
        window?.rootViewController?.loadViewIfNeeded()
        NSLog("[entry-diag] iOS scene connected")

        // A cold launch delivers links here, not in the warm-open callbacks.
        // Capacitor's proxy also retains lastURL for App.getLaunchUrl().
        self.scene(scene, openURLContexts: connectionOptions.urlContexts)
        for activity in connectionOptions.userActivities {
            self.scene(scene, continue: activity)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            var options: [UIApplication.OpenURLOptionsKey: Any] = [
                .openInPlace: context.options.openInPlace
            ]
            options[.sourceApplication] = context.options.sourceApplication
            options[.annotation] = context.options.annotation
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: options)
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }

    // UIKit still posts the application notifications consumed by Capacitor and
    // the updater in this single-scene app. Do not post duplicate notifications.
    func sceneWillResignActive(_ scene: UIScene) {
        NSLog("[entry-diag] iOS scene will resign active")
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        NSLog("[entry-diag] iOS scene entered background")
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        NSLog("[entry-diag] iOS scene will enter foreground")
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        NSLog("[entry-diag] iOS scene became active")
    }
}
