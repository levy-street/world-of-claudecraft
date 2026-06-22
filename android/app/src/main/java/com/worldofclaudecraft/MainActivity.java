package com.worldofclaudecraft;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeAttestationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
