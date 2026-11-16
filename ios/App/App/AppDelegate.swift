import UIKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func applicationWillTerminate(_ application: UIApplication) {
        NSLog("[entry-diag] iOS application will terminate")
    }

    func applicationDidReceiveMemoryWarning(_ application: UIApplication) {
        NSLog(
            "[entry-diag] iOS application received memory warning physicalMemoryBytes=%llu",
            ProcessInfo.processInfo.physicalMemory
        )
    }
}
