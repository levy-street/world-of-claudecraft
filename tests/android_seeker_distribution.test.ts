import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appGradle = readFileSync('android/app/build.gradle', 'utf8');
const plugin = readFileSync(
  'android/app/src/solanaStore/java/com/worldofclaudecraft/NativeSolanaMobilePlugin.kt',
  'utf8',
);
const baseActivity = readFileSync(
  'android/app/src/main/java/com/worldofclaudecraft/BaseMainActivity.java',
  'utf8',
);
const playActivity = readFileSync(
  'android/app/src/play/java/com/worldofclaudecraft/MainActivity.java',
  'utf8',
);
const solanaStoreActivity = readFileSync(
  'android/app/src/solanaStore/java/com/worldofclaudecraft/MainActivity.java',
  'utf8',
);
const tokenStore = readFileSync(
  'android/app/src/solanaStore/java/com/worldofclaudecraft/MwaAuthorizationTokenStore.kt',
  'utf8',
);
const solanaStoreManifest = readFileSync('android/app/src/solanaStore/AndroidManifest.xml', 'utf8');
const solanaBackupRules = readFileSync(
  'android/app/src/solanaStore/res/xml/solana_mobile_backup_rules.xml',
  'utf8',
);
const solanaDataExtractionRules = readFileSync(
  'android/app/src/solanaStore/res/xml/solana_mobile_data_extraction_rules.xml',
  'utf8',
);
const main = readFileSync('src/main.ts', 'utf8');
const hudCss = readFileSync('src/styles/hud.css', 'utf8');
const shellCss = readFileSync('src/styles/shell.css', 'utf8');
const mobileHudCss = readFileSync('src/styles/hud.mobile.css', 'utf8');

function sourceText(root: string): string {
  const files: string[] = [];
  const visit = (path: string): void => {
    for (const name of readdirSync(path)) {
      const child = join(path, name);
      if (statSync(child).isDirectory()) visit(child);
      else if (/\.(?:java|kt)$/.test(name)) files.push(child);
    }
  };
  visit(root);
  return files
    .sort()
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
}

describe('Android Seeker distribution boundary', () => {
  it('builds explicit Play and Solana dApp Store flavors', () => {
    expect(appGradle).toContain('flavorDimensions += "distribution"');
    expect(appGradle).toContain('play {');
    expect(appGradle).toContain(
      'buildConfigField "String", "SOLANA_MOBILE_DISTRIBUTION", \'"google-play"\'',
    );
    expect(appGradle).toContain('solanaStore {');
    expect(appGradle).toContain(
      'buildConfigField "String", "SOLANA_MOBILE_DISTRIBUTION", \'"solana-dapp-store"\'',
    );
  });

  it('packages the Solana SDK dependencies only in the Solana Store variant', () => {
    for (const dependency of [
      'com.solanamobile:mobile-wallet-adapter-clientlib-ktx:2.0.3',
      'com.solanamobile:web3-solana:0.2.5',
      'com.solanamobile:rpc-core:0.2.7',
      'io.github.funkatronics:multimult:0.2.3',
    ]) {
      expect(appGradle).toMatch(
        new RegExp(`solanaStoreImplementation(?:\\(|\\s+)"${dependency.replace(/[.]/g, '\\.')}"`),
      );
      expect(appGradle).not.toMatch(
        new RegExp(`^\\s*implementation\\s+"${dependency.replace(/[.]/g, '\\.')}"`, 'm'),
      );
    }
  });

  it('keeps the real MWA plugin and registration out of shared and Play sources', () => {
    expect(
      existsSync('android/app/src/main/java/com/worldofclaudecraft/NativeSolanaMobilePlugin.kt'),
    ).toBe(false);
    expect(
      existsSync('android/app/src/play/java/com/worldofclaudecraft/NativeSolanaMobilePlugin.kt'),
    ).toBe(false);
    expect(baseActivity).not.toContain('NativeSolanaMobilePlugin');
    expect(playActivity).not.toContain('NativeSolanaMobilePlugin');
    expect(playActivity).not.toContain('registerPlugin(');
    const nonSolanaSources = [
      sourceText('android/app/src/main/java'),
      sourceText('android/app/src/play/java'),
    ].join('\n');
    expect(nonSolanaSources).not.toMatch(
      /com\.solanamobile|com\.funkatronics|NativeSolanaMobilePlugin/,
    );
    expect(solanaStoreActivity).toContain('registerPlugin(NativeSolanaMobilePlugin.class);');
  });

  it('encrypts the reusable MWA token with a flavor-scoped Android Keystore store', () => {
    expect(tokenStore).toContain('private const val ANDROID_KEYSTORE = "AndroidKeyStore"');
    expect(tokenStore).toContain('KeyStore.getInstance(ANDROID_KEYSTORE)');
    expect(tokenStore).toContain('KeyProperties.KEY_ALGORITHM_AES');
    expect(tokenStore).toContain('KeyProperties.BLOCK_MODE_GCM');
    expect(tokenStore).toContain('KeyProperties.ENCRYPTION_PADDING_NONE');
    expect(tokenStore).toContain('setKeySize(256)');
    expect(tokenStore).toContain('cipher.updateAAD');
    expect(tokenStore).toContain('MAX_TOKEN_BYTES');
    expect(plugin).toContain('tokenStore.load()');
    expect(plugin).toContain('tokenStore.save(token)');
    expect(plugin).toContain('tokenStore.clear()');
    expect(plugin).toContain('remove(LEGACY_AUTH_TOKEN_KEY).commit()');
    expect(plugin).toContain('if (!legacyTokenRemoved)');
    expect(plugin).not.toContain('getString(LEGACY_AUTH_TOKEN_KEY');
    expect(plugin).not.toContain('putString(LEGACY_AUTH_TOKEN_KEY');
    const nonSolanaSources = [
      sourceText('android/app/src/main/java'),
      sourceText('android/app/src/play/java'),
    ].join('\n');
    expect(nonSolanaSources).not.toMatch(/MwaAuthorizationTokenStore|AndroidKeyStore/);
  });

  it('excludes the encrypted MWA token envelope from every Android backup path', () => {
    expect(solanaStoreManifest).toContain(
      'android:fullBackupContent="@xml/solana_mobile_backup_rules"',
    );
    expect(solanaStoreManifest).toContain(
      'android:dataExtractionRules="@xml/solana_mobile_data_extraction_rules"',
    );
    expect(solanaBackupRules).toContain(
      '<exclude domain="sharedpref" path="solana_mobile_auth.xml" />',
    );
    expect(solanaBackupRules).toContain('<exclude domain="sharedpref" path="solana_mobile.xml" />');
    expect(solanaDataExtractionRules).toMatch(
      /<cloud-backup>[\s\S]*?<exclude domain="sharedpref" path="solana_mobile_auth\.xml" \/>[\s\S]*?<exclude domain="sharedpref" path="solana_mobile\.xml" \/>[\s\S]*?<\/cloud-backup>/,
    );
    expect(solanaDataExtractionRules).toMatch(
      /<device-transfer>[\s\S]*?<exclude domain="sharedpref" path="solana_mobile_auth\.xml" \/>[\s\S]*?<exclude domain="sharedpref" path="solana_mobile\.xml" \/>[\s\S]*?<\/device-transfer>/,
    );
  });

  it('fails closed unless dApp Store, exact Seeker identity, and MWA are all present', () => {
    expect(plugin).toContain('BuildConfig.SOLANA_MOBILE_DISTRIBUTION == "solana-dapp-store"');
    expect(plugin).toContain('Build.MODEL.equals("Seeker", ignoreCase = true)');
    expect(plugin).toContain('Build.BRAND.equals("solanamobile", ignoreCase = true)');
    expect(plugin).toContain('Build.MANUFACTURER.equals("Solana Mobile Inc.", ignoreCase = true)');
    expect(plugin).toContain('result.put("mwaAvailable", solanaMobileAllowed())');
    expect(plugin).toContain('BuildConfig.SOLANA_MOBILE_DISTRIBUTION == "solana-dapp-store" &&');
    expect(plugin).toContain('isSeeker() &&');
    expect(plugin).toContain('secureStorageReady');
    expect(solanaStoreActivity).toContain('registerPlugin(NativeSolanaMobilePlugin.class);');
  });

  it('reveals the existing wallet UI only after the Seeker capability succeeds', () => {
    expect(main).toContain(
      "document.body.classList.toggle('seeker-wallet-enabled', NATIVE_APP && WALLET_ENABLED)",
    );
    expect(hudCss).toContain('body.native-app:not(.seeker-wallet-enabled) .cs-wallet');
    expect(shellCss).toContain(
      'body.mobile-touch:not(.seeker-wallet-enabled) #charselect-panel .cs-wallet',
    );
    expect(hudCss).not.toContain('body.native-app .cs-wallet,');
    expect(shellCss).not.toContain('body.mobile-touch #charselect-panel .cs-wallet,');
  });

  it('registers the MWA activity result sender before the activity is started', () => {
    expect(plugin).toContain('private lateinit var activityResultSender: ActivityResultSender');
    expect(plugin).toContain('activityResultSender = ActivityResultSender(activity)');
    expect(plugin.match(/ActivityResultSender\(activity\)/g)).toHaveLength(1);
    expect(plugin).toContain('walletAdapter.connect(activityResultSender)');
    expect(plugin).toContain('walletAdapter.disconnect(activityResultSender)');
    expect(plugin).toContain('walletAdapter.transact(activityResultSender)');
  });

  it('rejects empty MWA authorization accounts before either signing operation', () => {
    expect(plugin.match(/authResult\.accounts\.firstOrNull\(\)/g)).toHaveLength(3);
    expect(plugin).not.toContain('authResult.accounts.first()');
    expect(plugin.match(/MissingAuthorizedAccountException/g)?.length).toBeGreaterThanOrEqual(3);
    expect(plugin.match(/MWA_NO_ACCOUNT/g)?.length).toBeGreaterThanOrEqual(3);
    expect(plugin).toMatch(
      /private fun clearAuthorizationState\(\) \{\s+walletAdapter\.authToken = null\s+tokenStore\.clear\(\)\s+walletPreferences\(\)\.edit\(\)\.remove\(WALLET_ADDRESS_KEY\)\.commit\(\)\s+\}/,
    );
    expect(plugin).toMatch(
      /if \(account == null\) \{\s+clearAuthorizationState\(\)\s+call\.reject\("Wallet returned no account", "MWA_NO_ACCOUNT"\)/,
    );
    expect(
      plugin.match(
        /if \(result\.e is MissingAuthorizedAccountException\) \{\s+clearAuthorizationState\(\)\s+call\.reject\("Wallet returned no account", "MWA_NO_ACCOUNT"\)/g,
      ),
    ).toHaveLength(2);
  });

  it('uses Seed Vault instructions in the native Seeker wallet picker', () => {
    expect(main).toContain("? t('wallet.seekerAppHelp')");
  });

  it('points the MWA connection identity icon at a favicon that actually ships', () => {
    expect(plugin).toContain('iconUri = Uri.parse("favicon.ico")');
    expect(plugin).not.toContain('favicon.svg');
    expect(existsSync('public/favicon.ico')).toBe(true);
  });

  it('promotes the existing rewards button below Chat without covering mobile unit frames', () => {
    expect(main).toContain(
      "document.getElementById('mobile-combat-controls')?.appendChild(dailyRewardsButton)",
    );
    expect(mobileHudCss).toContain('#mobile-daily-rewards:not([hidden])');
    expect(mobileHudCss).not.toContain('display: flex !important;');
    expect(mobileHudCss).toContain('url("/ui/daily-rewards/treasure_chest.webp")');
    expect(mobileHudCss).toContain('grid-column: 1;');
    expect(mobileHudCss).toContain('grid-row: 2;');
    expect(mobileHudCss).toMatch(
      /body\.mobile-touch\.seeker-wallet-enabled #target-frame \{[^}]*top: calc\(max\(8px, env\(safe-area-inset-top\)\) \+ 140px\);/,
    );
    expect(mobileHudCss).toMatch(
      /body\.mobile-touch\.seeker-wallet-enabled #party-frames \{[^}]*top: calc\(max\(8px, env\(safe-area-inset-top\)\) \+ 142px\);/,
    );
    expect(mobileHudCss).toMatch(
      /body\.mobile-touch\.seeker-wallet-enabled #target-frame \{[^}]*top: calc\(max\(6px, env\(safe-area-inset-top\)\) \+ 132px\);/,
    );
    expect(mobileHudCss).toMatch(
      /body\.mobile-touch\.seeker-wallet-enabled #party-frames \{[^}]*top: calc\(max\(6px, env\(safe-area-inset-top\)\) \+ 134px\);/,
    );
  });

  it('lays out the Seeker wallet as a header row above its actions', () => {
    expect(shellCss).toContain(
      'body.mobile-touch.seeker-wallet-enabled #charselect-panel .cs-wallet-group',
    );
    expect(shellCss).toContain('grid-template-columns: auto minmax(0, 1fr);');
    expect(shellCss).toContain(
      'body.mobile-touch.seeker-wallet-enabled #charselect-panel .cs-wallet-main',
    );
    expect(shellCss).toContain('display: contents;');
    expect(shellCss).toMatch(
      /body\.mobile-touch\.seeker-wallet-enabled #charselect-panel :is\(\.wallet-cta, \.wallet-mini\) \{[\s\S]*?min-width: 40px;[\s\S]*?min-height: 40px;/,
    );
  });
});
