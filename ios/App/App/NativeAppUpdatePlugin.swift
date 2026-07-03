import Capacitor
import Foundation
import UIKit

@objc(NativeAppUpdatePlugin)
public class NativeAppUpdatePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeAppUpdatePlugin"
    public let jsName = "NativeAppUpdate"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkForUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openUpdate", returnType: CAPPluginReturnPromise)
    ]

    @objc func checkForUpdate(_ call: CAPPluginCall) {
        guard let bundleId = Bundle.main.bundleIdentifier else {
            call.resolve(baseResult(available: false, storeVersion: nil, storeUrl: nil))
            return
        }

        var components = URLComponents(string: "https://itunes.apple.com/lookup")
        components?.queryItems = [
            URLQueryItem(name: "bundleId", value: bundleId),
            URLQueryItem(name: "country", value: Locale.current.regionCode ?? "us")
        ]
        guard let url = components?.url else {
            call.resolve(baseResult(available: false, storeVersion: nil, storeUrl: nil))
            return
        }

        URLSession.shared.dataTask(with: url) { data, _, error in
            guard error == nil, let data = data else {
                call.resolve(self.baseResult(available: false, storeVersion: nil, storeUrl: nil))
                return
            }
            do {
                guard
                    let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                    let results = json["results"] as? [[String: Any]],
                    let app = results.first,
                    let storeVersion = app["version"] as? String
                else {
                    call.resolve(self.baseResult(available: false, storeVersion: nil, storeUrl: nil))
                    return
                }
                let storeUrl = app["trackViewUrl"] as? String
                let available = self.compareVersions(storeVersion, self.currentVersion()) == .orderedDescending
                call.resolve(self.baseResult(available: available, storeVersion: storeVersion, storeUrl: storeUrl))
            } catch {
                call.resolve(self.baseResult(available: false, storeVersion: nil, storeUrl: nil))
            }
        }.resume()
    }

    @objc func openUpdate(_ call: CAPPluginCall) {
        guard let rawUrl = call.getString("storeUrl"), let url = URL(string: rawUrl) else {
            call.reject("Missing App Store URL")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url) { success in
                if success {
                    call.resolve()
                } else {
                    call.reject("Could not open App Store")
                }
            }
        }
    }

    private func baseResult(available: Bool, storeVersion: String?, storeUrl: String?) -> [String: Any] {
        var result: [String: Any] = [
            "platform": "ios",
            "available": available,
            "currentVersion": currentVersion()
        ]
        if let storeVersion = storeVersion {
            result["storeVersion"] = storeVersion
        }
        if let storeUrl = storeUrl {
            result["storeUrl"] = storeUrl
        }
        return result
    }

    private func currentVersion() -> String {
        return Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
    }

    private func compareVersions(_ left: String, _ right: String) -> ComparisonResult {
        let lhs = left.split(separator: ".").map { Int($0) ?? 0 }
        let rhs = right.split(separator: ".").map { Int($0) ?? 0 }
        let count = max(lhs.count, rhs.count)
        for index in 0..<count {
            let l = index < lhs.count ? lhs[index] : 0
            let r = index < rhs.count ? rhs[index] : 0
            if l > r { return .orderedDescending }
            if l < r { return .orderedAscending }
        }
        return .orderedSame
    }
}
