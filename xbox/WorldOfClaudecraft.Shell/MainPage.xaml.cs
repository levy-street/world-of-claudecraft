using System;
using System.IO;
using Microsoft.Web.WebView2.Core;
using Windows.ApplicationModel;
using Windows.Security.ExchangeActiveSyncProvisioning;
using Windows.System;
using Windows.UI.Core;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;

namespace WorldOfClaudecraft.Shell
{
    /// <summary>
    /// Hosts the game on console, from client content shipped INSIDE the package.
    ///
    /// The client is a WebGL2 three.js app, which rules out the obvious
    /// packaging route: a hosted web app (an MSIX whose Application element is
    /// a StartPage URL) runs on the legacy EdgeHTML engine on Xbox, and
    /// EdgeHTML has no WebGL2. three.js dropped WebGL1 in r163, so such a
    /// package installs, launches and renders nothing. A WinUI 2 UWP hosting
    /// WebView2 gets the Chromium engine instead.
    ///
    /// The whole client is packaged rather than loaded from the site, so the app
    /// boots instantly, works with no network at all (offline play and local
    /// character saves), and does not depend on any server staying up. Online
    /// play still works when there is a connection: the client's own net layer
    /// reaches the API, whose CORS allow-list carries this origin (see
    /// XBOX_APP_ORIGIN in server/web_login_guard.ts).
    ///
    /// WebView2 cannot get controller input for itself on UWP (the Gamepad API
    /// does not reach its content, MicrosoftEdge/WebView2Feedback#4366), so
    /// <see cref="GamepadBridge"/> reads Windows.Gaming.Input natively and
    /// Assets/gamepad-polyfill.js republishes it through
    /// navigator.getGamepads(). The web client runs UNMODIFIED.
    /// </summary>
    public sealed partial class MainPage : Page
    {
        /// <summary>Virtual host for the packaged client. https keeps it a secure
        /// context (storage, WebGL and the rest behave), and it cannot collide
        /// with any public origin.</summary>
        private const string VirtualHost = "app.local";

        /// <summary>The site this build belongs to. Entering some flows navigates
        /// the page to the live site on purpose, so it has to be allowed through
        /// the navigation guard below. A fork repoints this one constant.</summary>
        private const string SiteHost = "worldofclaudecraft.com";

        /// <summary>Release builds enable WebView2 remote debugging only when an
        /// operator drops a file with this name in the app's LocalState folder.
        /// A shipped Store package never has it.</summary>
        private const string DevToolsMarker = "woc-devtools";

        private readonly GamepadBridge _pads = new GamepadBridge();

        public MainPage()
        {
            InitializeComponent();
            Loaded += OnLoaded;

            // On Xbox the chain is KeyDown/KeyUp -> if unhandled,
            // BackRequested -> if unhandled, the shell closes the app. Handling
            // only BackRequested was not enough on real hardware, so B is
            // claimed at the earliest stage as well.
            // Guarded: another legacy view API, and losing the extra B-claim is
            // survivable where dying at the splash is not.
            try { SystemNavigationManager.GetForCurrentView().BackRequested += (s, e) => e.Handled = true; }
            catch (Exception) { }

            var win = Window.Current.CoreWindow;
            win.KeyDown += Swallow;
            win.KeyUp += Swallow;
            win.Dispatcher.AcceleratorKeyActivated += (s, e) =>
            {
                if (IsClaimed(e.VirtualKey)) e.Handled = true;
            };

            _pads.ExitRequested += OnExitRequested;
        }

        /* Claimed before anything else sees them.
         *
         * B: unclaimed it is the console back gesture and tears the app down.
         * The game uses B in combat, so it must reach the page instead, which
         * it does via GamepadBridge reading Windows.Gaming.Input directly.
         * Claiming the KEY does not hide the BUTTON.
         *
         * Menu and View: WebView2 on Xbox offers to switch out of gamepad mode
         * into a mouse cursor when these are pressed, and this app has no
         * cursor UI to switch back with. */
        private static readonly VirtualKey[] ClaimedKeys =
        {
            VirtualKey.GamepadB,
            VirtualKey.GamepadMenu,
            VirtualKey.GamepadView,
        };

        private static bool IsClaimed(VirtualKey key)
        {
            foreach (var k in ClaimedKeys)
            {
                if (k == key) return true;
            }
            return false;
        }

        private static void Swallow(CoreWindow sender, KeyEventArgs e)
        {
            if (IsClaimed(e.VirtualKey)) e.Handled = true;
        }

        /// <summary>Console model, e.g. "Xbox One X" or "Xbox Series X". The web
        /// layer cannot tell the generations apart (identical user agent), and
        /// they have very different graphics budgets. Published to the page as
        /// document.documentElement.dataset.console; nothing in the client reads
        /// it yet, and Assets/console-memory-guard.js applies a single
        /// conservative budget that both generations survive.</summary>
        private static string ConsoleModel()
        {
            try
            {
                return new EasClientDeviceInformation().SystemProductName ?? string.Empty;
            }
            catch (Exception)
            {
                // Never let a diagnostic lookup stop the app starting.
                return string.Empty;
            }
        }

        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            // Chrome DevTools over the Xbox Device Portal is the only way to
            // profile a console (the Xbox Edge browser has no DevTools). On in
            // Debug, and in Release only behind the LocalState marker. Must be
            // set before the CoreWebView2 is created.
            var debugOn = false;
#if DEBUG
            debugOn = true;
#endif
            try
            {
                if (File.Exists(Path.Combine(
                        Windows.Storage.ApplicationData.Current.LocalFolder.Path,
                        DevToolsMarker)))
                    debugOn = true;
            }
            catch (Exception) { }
            if (debugOn)
            {
                Environment.SetEnvironmentVariable(
                    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                    "--enable-features=msEdgeDevToolsWdpRemoteDebugging");
            }
            try
            {
                await Web.EnsureCoreWebView2Async();
            }
            catch (Exception ex)
            {
                Fail("The game runtime could not start on this console.\n\n" + ex.Message);
                return;
            }

            var core = Web.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;

            // Serve the packaged client from a real https origin.
            var webRoot = Path.Combine(Package.Current.InstalledLocation.Path, "web");
            if (!Directory.Exists(webRoot))
            {
                Fail("This package shipped without its game content.");
                return;
            }
            core.SetVirtualHostNameToFolderMapping(
                VirtualHost, webRoot, CoreWebView2HostResourceAccessKind.Allow);

            try
            {
                // All land at document-create, before any game script runs: the
                // polyfill must beat the page to navigator.getGamepads, and the
                // memory guard must pin devicePixelRatio and floor the persisted
                // graphics settings before the graphics tier resolves.
                var memoryGuard = await ReadAssetAsync("Assets/console-memory-guard.js");
                await core.AddScriptToExecuteOnDocumentCreatedAsync(memoryGuard);
                var polyfill = await ReadAssetAsync("Assets/gamepad-polyfill.js");
                await core.AddScriptToExecuteOnDocumentCreatedAsync(polyfill);

                var model = ConsoleModel().Replace("\\", string.Empty).Replace("'", string.Empty);
                await core.AddScriptToExecuteOnDocumentCreatedAsync(
                    "document.documentElement.dataset.console = '" + model + "';");
            }
            catch (Exception ex)
            {
                // Without the polyfill the game ignores the controller entirely,
                // which is worse than refusing to start.
                Fail("Controller support failed to install.\n\n" + ex.Message);
                return;
            }

            // Two navigation guards for console reality. WebView2 maps a
            // controller gesture to history back and forward, which reloads the
            // page under the player and looks like being logged out; nothing in
            // this app navigates through history on purpose, so those are
            // cancelled outright. Top-level navigation is otherwise allowed ONLY
            // to the app's own surfaces: the packaged origin and the site's own
            // hosts. Genuinely external destinations (OAuth providers, community
            // links) are cancelled, since those would strand the player in a
            // webview with no browser chrome to come back from.
            core.NavigationStarting += (s, a) =>
            {
                if (a.NavigationKind == CoreWebView2NavigationKind.BackOrForward)
                {
                    a.Cancel = true;
                    return;
                }
                if (!IsAllowedHost(a.Uri)) a.Cancel = true;
            };

            core.NavigationCompleted += (s, a) =>
            {
                if (a.IsSuccess)
                {
                    Status.Visibility = Visibility.Collapsed;
                    _pads.Start(core);
                }
                else
                {
                    _pads.Stop();
                    Fail("The packaged client failed to load (" + a.WebErrorStatus + ").");
                }
            };
            core.ProcessFailed += (s, a) => OnProcessFailed(core, a);

            Web.Source = new Uri("https://" + VirtualHost + "/index.html");
            Web.Focus(FocusState.Programmatic);
        }

        private static bool IsAllowedHost(string uri)
        {
            try
            {
                var host = new Uri(uri).Host;
                return host.Equals(VirtualHost, StringComparison.OrdinalIgnoreCase)
                    || host.Equals(SiteHost, StringComparison.OrdinalIgnoreCase)
                    || host.EndsWith("." + SiteHost, StringComparison.OrdinalIgnoreCase);
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static async System.Threading.Tasks.Task<string> ReadAssetAsync(string relative)
        {
            var uri = new Uri("ms-appx:///" + relative);
            var file = await Windows.Storage.StorageFile.GetFileFromApplicationUriAsync(uri);
            return await Windows.Storage.FileIO.ReadTextAsync(file);
        }

        private void Fail(string message)
        {
            Status.Visibility = Visibility.Visible;
            Status.Text = message;
        }

        // Bounded crash recovery. Consoles kill the WebView2 render process far
        // more readily than desktops (tight app memory budgets), and handling
        // ProcessFailed by simply stopping turns every such death into a dead
        // end: a permanent banner over a half-alive page whose input is frozen
        // at the last-held stick, so the character runs into a wall and no
        // button, exit included, does anything. Render and GPU side deaths
        // reload the packaged client in place; the NavigationCompleted handler
        // above clears the banner and restarts the pad feed when it lands.
        private int _recoveries;
        private DateTime _recoveryWindow = DateTime.MinValue;

        private void OnProcessFailed(CoreWebView2 core, CoreWebView2ProcessFailedEventArgs a)
        {
            // Neutralize page input first: the feed pauses and the page is told
            // the pad disconnected, so nothing stays latched while we recover.
            // The native loop keeps running, so View+Menu exit always works.
            _pads.Stop();

            if (a.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
            {
                // The whole runtime is gone; a Reload has nothing to run in.
                Fail("The game runtime closed. Please reopen World of ClaudeCraft.");
                return;
            }

            var now = DateTime.UtcNow;
            if ((now - _recoveryWindow).TotalMinutes > 5)
            {
                _recoveryWindow = now;
                _recoveries = 0;
            }
            if (++_recoveries > 3)
            {
                // Crash-looping. Stop flashing reloads at the player.
                Fail("The game keeps crashing on this console. Please close World of ClaudeCraft and reopen it.");
                return;
            }

            Fail("Reconnecting to the world...");
            try
            {
                core.Reload();
            }
            catch (Exception)
            {
                Fail("The game could not recover. Please reopen World of ClaudeCraft.");
            }
        }

        private void OnExitRequested(object sender, EventArgs e)
        {
            // B is claimed and in-game, so it cannot be the way out. View+Menu
            // held together is deliberate enough never to be hit by accident.
            _pads.Stop();
            Application.Current.Exit();
        }
    }
}
