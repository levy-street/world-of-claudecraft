import Capacitor
import UIKit
import WebKit

private final class DiagnosticWebView: WKWebView {
    override func reload() -> WKNavigation? {
        NSLog(
            "[entry-diag] native WKWebView reload requested applicationState=%ld",
            UIApplication.shared.applicationState.rawValue
        )
        return super.reload()
    }
}

class AppViewController: CAPBridgeViewController {
    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        return DiagnosticWebView(frame: frame, configuration: configuration)
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(NativeAttestationPlugin())
        bridge?.registerPluginInstance(NativeAppUpdatePlugin())
        bridge?.registerPluginInstance(NativeAppleAuthPlugin())
    }
}
