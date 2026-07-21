import AuthenticationServices
import Capacitor
import CryptoKit
import UIKit

@objc(NativeAppleAuthPlugin)
public class NativeAppleAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "NativeAppleAuthPlugin"
    public let jsName = "NativeAppleAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise)
    ]
    private var pendingCall: CAPPluginCall?

    @objc func signIn(_ call: CAPPluginCall) {
        guard pendingCall == nil else {
            call.reject("Apple authorization already in progress")
            return
        }
        guard let nonce = call.getString("nonce"), !nonce.isEmpty else {
            call.reject("Apple authorization nonce missing")
            return
        }
        pendingCall = call
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        controller.performRequests()
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8) else {
            call.reject("Apple identity token missing")
            return
        }
        let formatter = PersonNameComponentsFormatter()
        let displayName = credential.fullName.map { formatter.string(from: $0) } ?? ""
        call.resolve([
            "identityToken": identityToken,
            "authorizationCode": credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) } ?? "",
            "email": credential.email ?? "",
            "displayName": displayName
        ])
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = pendingCall else { return }
        pendingCall = nil
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            call.reject("Apple authorization cancelled", "APPLE_CANCELED", error)
            return
        }
        call.reject("Apple authorization failed", "APPLE_AUTH_FAILED", error)
    }
}
