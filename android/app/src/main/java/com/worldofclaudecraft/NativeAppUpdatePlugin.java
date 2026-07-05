package com.worldofclaudecraft;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.UpdateAvailability;

@CapacitorPlugin(name = "NativeAppUpdate")
public class NativeAppUpdatePlugin extends Plugin {
    @PluginMethod
    public void checkForUpdate(PluginCall call) {
        AppUpdateManager appUpdateManager = AppUpdateManagerFactory.create(getContext());
        appUpdateManager.getAppUpdateInfo()
            .addOnSuccessListener(info -> {
                boolean available =
                    info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE &&
                    (info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE) ||
                        info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE));
                JSObject result = new JSObject();
                result.put("platform", "android");
                result.put("available", available);
                result.put("currentVersion", BuildConfig.VERSION_NAME);
                result.put("storeUrl", playStoreUrl());
                call.resolve(result);
            })
            .addOnFailureListener(error -> {
                JSObject result = new JSObject();
                result.put("platform", "android");
                result.put("available", false);
                result.put("currentVersion", BuildConfig.VERSION_NAME);
                result.put("storeUrl", playStoreUrl());
                call.resolve(result);
            });
    }

    @PluginMethod
    public void openUpdate(PluginCall call) {
        String storeUrl = call.getString("storeUrl", playStoreUrl());
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(storeUrl));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
        } catch (Exception firstError) {
            Intent fallback = new Intent(Intent.ACTION_VIEW, Uri.parse(playStoreWebUrl()));
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(fallback);
            } catch (Exception fallbackError) {
                call.reject("Could not open Google Play", fallbackError);
                return;
            }
        }
        call.resolve();
    }

    private String playStoreUrl() {
        return "market://details?id=" + getContext().getPackageName();
    }

    private String playStoreWebUrl() {
        return "https://play.google.com/store/apps/details?id=" + getContext().getPackageName();
    }
}
