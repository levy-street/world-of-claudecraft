import Capacitor
import UIKit

class AppViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(NativeAttestationPlugin())
        bridge?.registerPluginInstance(NativeAppUpdatePlugin())
    }
}
