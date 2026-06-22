package com.worldofclaudecraft;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.integrity.IntegrityManager;
import com.google.android.play.core.integrity.IntegrityManagerFactory;
import com.google.android.play.core.integrity.IntegrityTokenRequest;

@CapacitorPlugin(name = "NativeAttestation")
public class NativeAttestationPlugin extends Plugin {
    @PluginMethod
    public void getToken(PluginCall call) {
        String nonce = call.getString("nonce");
        if (nonce == null || nonce.isEmpty()) {
            call.reject("Missing nonce");
            return;
        }

        IntegrityManager integrityManager = IntegrityManagerFactory.create(getContext());
        IntegrityTokenRequest request = IntegrityTokenRequest.builder()
            .setNonce(nonce)
            .build();

        integrityManager.requestIntegrityToken(request)
            .addOnSuccessListener(response -> {
                JSObject result = new JSObject();
                result.put("platform", "android");
                result.put("token", response.token());
                call.resolve(result);
            })
            .addOnFailureListener(error -> call.reject("Play Integrity token failed", error));
    }
}
