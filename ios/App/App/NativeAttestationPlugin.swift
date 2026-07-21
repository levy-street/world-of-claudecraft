import Capacitor
import DeviceCheck
import Foundation

@objc(NativeAttestationPlugin)
public class NativeAttestationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeAttestationPlugin"
    public let jsName = "NativeAttestation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getToken", returnType: CAPPluginReturnPromise)
    ]

    @objc func getToken(_ call: CAPPluginCall) {
        guard DCDevice.current.isSupported else {
            call.reject("DeviceCheck is not supported on this device")
            return
        }

        DCDevice.current.generateToken { data, error in
            if let error = error {
                call.reject("DeviceCheck token failed", nil, error)
                return
            }
            guard let data = data else {
                call.reject("DeviceCheck token missing")
                return
            }
            call.resolve([
                "platform": "ios",
                "token": data.base64EncodedString()
            ])
        }
    }
}
