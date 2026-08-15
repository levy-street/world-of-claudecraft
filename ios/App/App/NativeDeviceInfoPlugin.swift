import Capacitor
import Foundation

// Reports device hardware facts the WKWebView cannot observe itself. The web
// client caches physicalMemory in localStorage so the next boot's synchronous
// graphics-profile resolution can distinguish 4 GB-class devices (see
// src/device_memory_hint.ts); WebKit exposes no navigator.deviceMemory on iOS.
@objc(NativeDeviceInfoPlugin)
public class NativeDeviceInfoPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeDeviceInfoPlugin"
    public let jsName = "NativeDeviceInfo"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getMemoryInfo", returnType: CAPPluginReturnPromise)
    ]

    @objc func getMemoryInfo(_ call: CAPPluginCall) {
        call.resolve([
            "platform": "ios",
            // UInt64 bytes fit a Double exactly for any shipping RAM size.
            "physicalMemoryBytes": Double(ProcessInfo.processInfo.physicalMemory)
        ])
    }
}
