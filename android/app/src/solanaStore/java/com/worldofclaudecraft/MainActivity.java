package com.worldofclaudecraft;

public final class MainActivity extends BaseMainActivity {
    @Override
    protected void registerDistributionPlugins() {
        registerPlugin(NativeSolanaMobilePlugin.class);
    }
}
