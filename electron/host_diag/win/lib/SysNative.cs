// Windows power / display / performance-counter helpers. READ-ONLY.
// C# 5 only (PowerShell 5.1 compiler): no $"", no ?., no out var.
namespace HostDiag.Sys
{
    using System;
    using System.Collections.Generic;
    using System.Runtime.InteropServices;

    public static class Runtime
    {
        [DllImport("kernel32.dll")] static extern uint SetErrorMode(uint mode);
        // SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX: a native crash ends the worker silently.
        public static void DisableCrashDialogs() { SetErrorMode(0x0001 | 0x0002); }
    }

    // ------------------------------------------------------------------
    // Power
    // ------------------------------------------------------------------
    public class PowerInfo
    {
        public bool   StatusOk;
        public int    AcLineStatus;        // 0 battery, 1 plugged, 255 unknown
        public int    BatteryFlag;         // bit 128 = no system battery, 8 = charging
        public int    BatteryPercent;      // 255 = unknown
        public int    BatterySecondsLeft;  // -1 = unknown
        public bool   BatterySaverOn;
        public string ActiveSchemeGuid;
        public string ActiveSchemeName;
        public string EffectiveOverlayGuid; // Win10/11 "power mode" slider, as currently applied
        public string ActualOverlayGuid;    // what the user picked (may differ, e.g. battery saver)
        public List<string> Warnings = new List<string>();
    }

    public static class Power
    {
        [StructLayout(LayoutKind.Sequential)]
        struct SYSTEM_POWER_STATUS
        {
            public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag;
            public int BatteryLifeTime, BatteryFullLifeTime;
        }

        [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS s);
        [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
        [DllImport("powrprof.dll")] static extern uint PowerGetActiveScheme(IntPtr root, out IntPtr guid);
        [DllImport("powrprof.dll")] static extern uint PowerReadFriendlyName(IntPtr root, ref Guid scheme, IntPtr sub, IntPtr setting, IntPtr buffer, ref uint size);
        [DllImport("powrprof.dll")] static extern uint PowerGetEffectiveOverlayScheme(out Guid g);
        [DllImport("powrprof.dll")] static extern uint PowerGetActualOverlayScheme(out Guid g);

        public static PowerInfo Get()
        {
            PowerInfo r = new PowerInfo();
            try
            {
                SYSTEM_POWER_STATUS s;
                if (GetSystemPowerStatus(out s))
                {
                    r.StatusOk = true;
                    r.AcLineStatus = s.ACLineStatus; r.BatteryFlag = s.BatteryFlag;
                    r.BatteryPercent = s.BatteryLifePercent; r.BatterySecondsLeft = s.BatteryLifeTime;
                    r.BatterySaverOn = s.SystemStatusFlag == 1;
                }
            }
            catch (Exception e) { r.Warnings.Add("GetSystemPowerStatus: " + e.Message); }

            try
            {
                IntPtr pg;
                if (PowerGetActiveScheme(IntPtr.Zero, out pg) == 0)
                {
                    Guid g = (Guid)Marshal.PtrToStructure(pg, typeof(Guid));
                    LocalFree(pg);
                    r.ActiveSchemeGuid = g.ToString();
                    uint size = 1024; IntPtr buf = Marshal.AllocHGlobal((int)size);
                    try { if (PowerReadFriendlyName(IntPtr.Zero, ref g, IntPtr.Zero, IntPtr.Zero, buf, ref size) == 0) r.ActiveSchemeName = Marshal.PtrToStringUni(buf); }
                    finally { Marshal.FreeHGlobal(buf); }
                }
            }
            catch (Exception e) { r.Warnings.Add("PowerGetActiveScheme: " + e.Message); }

            // Overlay APIs exist since Windows 10 1709; absent on older systems.
            try { Guid g; if (PowerGetEffectiveOverlayScheme(out g) == 0) r.EffectiveOverlayGuid = g.ToString(); }
            catch (Exception e) { r.Warnings.Add("PowerGetEffectiveOverlayScheme: " + e.GetType().Name); }
            try { Guid g; if (PowerGetActualOverlayScheme(out g) == 0) r.ActualOverlayGuid = g.ToString(); }
            catch (Exception e) { r.Warnings.Add("PowerGetActualOverlayScheme: " + e.GetType().Name); }
            return r;
        }
    }

    // ------------------------------------------------------------------
    // Displays
    // ------------------------------------------------------------------
    public class DisplayInfo
    {
        public string Device;          // \\.\DISPLAY1
        public string Adapter;         // GPU driving this output
        public bool   Primary;
        public int    Width, Height, RefreshHz, BitsPerPixel;
        public int    MaxRefreshHzAtThisResolution;
        public int    ScalePercent;    // 0 = unknown
    }

    public static class Display
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct DISPLAY_DEVICE
        {
            public int cb;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]  public string DeviceName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
            public int StateFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct DEVMODE
        {
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
            public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
            public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
            public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
            public short dmLogPixels;
            public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
            public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
        }

        [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct MONITORINFOEX
        {
            public int cbSize; public RECT rcMonitor, rcWork; public int dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
        }

        delegate bool MonitorEnumProc(IntPtr hMon, IntPtr hdc, IntPtr rect, IntPtr data);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplayDevices(string dev, uint i, ref DISPLAY_DEVICE dd, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettingsEx(string dev, int mode, ref DEVMODE dm, uint flags);
        [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr hMon, ref MONITORINFOEX mi);
        [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
        [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr hMon, int type, out uint x, out uint y);

        const int ENUM_CURRENT_SETTINGS = -1;
        const int ATTACHED = 1, PRIMARY = 4;

        public static List<DisplayInfo> Get()
        {
            List<DisplayInfo> list = new List<DisplayInfo>();
            for (uint i = 0; ; i++)
            {
                DISPLAY_DEVICE dd = new DISPLAY_DEVICE(); dd.cb = Marshal.SizeOf(typeof(DISPLAY_DEVICE));
                if (!EnumDisplayDevices(null, i, ref dd, 0)) break;
                if ((dd.StateFlags & ATTACHED) == 0) continue;
                DEVMODE dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
                if (!EnumDisplaySettingsEx(dd.DeviceName, ENUM_CURRENT_SETTINGS, ref dm, 0)) continue;

                DisplayInfo d = new DisplayInfo();
                d.Device = dd.DeviceName; d.Adapter = dd.DeviceString; d.Primary = (dd.StateFlags & PRIMARY) != 0;
                d.Width = dm.dmPelsWidth; d.Height = dm.dmPelsHeight; d.RefreshHz = dm.dmDisplayFrequency; d.BitsPerPixel = dm.dmBitsPerPel;

                // Best refresh rate the monitor offers at the current resolution (144 Hz panel left at 60 Hz...).
                for (int m = 0; ; m++)
                {
                    DEVMODE mm = new DEVMODE(); mm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
                    if (!EnumDisplaySettingsEx(dd.DeviceName, m, ref mm, 0)) break;
                    if (mm.dmPelsWidth == d.Width && mm.dmPelsHeight == d.Height && mm.dmDisplayFrequency > d.MaxRefreshHzAtThisResolution)
                        d.MaxRefreshHzAtThisResolution = mm.dmDisplayFrequency;
                }
                list.Add(d);
            }

            // Per-monitor scaling: needs per-monitor DPI awareness on this thread (Win10 1607+).
            try
            {
                IntPtr old = SetThreadDpiAwarenessContext(new IntPtr(-4));
                try
                {
                    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr hMon, IntPtr hdc, IntPtr rc, IntPtr data)
                    {
                        MONITORINFOEX mi = new MONITORINFOEX(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
                        uint dx, dy;
                        if (GetMonitorInfo(hMon, ref mi) && GetDpiForMonitor(hMon, 0, out dx, out dy) == 0)
                            foreach (DisplayInfo d in list)
                                if (d.Device == mi.szDevice) d.ScalePercent = (int)Math.Round(dx * 100.0 / 96.0);
                        return true;
                    }, IntPtr.Zero);
                }
                finally { if (old != IntPtr.Zero) SetThreadDpiAwarenessContext(old); }
            }
            catch { }
            return list;
        }
    }

    // ------------------------------------------------------------------
    // Performance counters through PDH with ENGLISH paths
    // (Get-Counter needs localized names; PdhAddEnglishCounter does not).
    // ------------------------------------------------------------------
    public class CounterSample { public string Instance; public double Value; }

    public class PdhQuery : IDisposable
    {
        [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhOpenQueryW(string src, IntPtr user, out IntPtr query);
        [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhAddEnglishCounterW(IntPtr query, string path, IntPtr user, out IntPtr counter);
        [DllImport("pdh.dll")] static extern uint PdhCollectQueryData(IntPtr query);
        [DllImport("pdh.dll")] static extern uint PdhCloseQuery(IntPtr query);
        [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhGetFormattedCounterArrayW(IntPtr counter, uint fmt, ref uint size, out uint count, IntPtr buffer);

        const uint PDH_FMT_DOUBLE = 0x200, PDH_FMT_NOCAP100 = 0x8000, PDH_MORE_DATA = 0x800007D2;

        IntPtr query;
        Dictionary<string, IntPtr> counters = new Dictionary<string, IntPtr>();
        public Dictionary<string, string> Errors = new Dictionary<string, string>();

        public PdhQuery()
        {
            uint st = PdhOpenQueryW(null, IntPtr.Zero, out query);
            if (st != 0) throw new InvalidOperationException("PdhOpenQuery 0x" + st.ToString("X8"));
        }

        public bool Add(string key, string englishPath)
        {
            IntPtr c;
            uint st = PdhAddEnglishCounterW(query, englishPath, IntPtr.Zero, out c);
            if (st != 0) { Errors[key] = "0x" + st.ToString("X8"); return false; }
            counters[key] = c; return true;
        }

        public void Collect() { PdhCollectQueryData(query); }

        public CounterSample[] Read(string key)
        {
            IntPtr c;
            if (!counters.TryGetValue(key, out c)) return new CounterSample[0];
            uint size = 0, count;
            uint st = PdhGetFormattedCounterArrayW(c, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, ref size, out count, IntPtr.Zero);
            if (st != PDH_MORE_DATA || size == 0) return new CounterSample[0];
            IntPtr buf = Marshal.AllocHGlobal((int)size);
            try
            {
                st = PdhGetFormattedCounterArrayW(c, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, ref size, out count, buf);
                if (st != 0) return new CounterSample[0];
                // PDH_FMT_COUNTERVALUE_ITEM_W: { LPWSTR name; (pad) DWORD status; (pad) double value } = 24 bytes on x86 and x64
                List<CounterSample> res = new List<CounterSample>();
                for (int i = 0; i < count; i++)
                {
                    IntPtr item = IntPtr.Add(buf, i * 24);
                    int cstatus = Marshal.ReadInt32(item, 8);
                    if (cstatus != 0 && cstatus != 1) continue; // neither VALID_DATA nor NEW_DATA
                    CounterSample s = new CounterSample();
                    s.Instance = Marshal.PtrToStringUni(Marshal.ReadIntPtr(item));
                    s.Value = BitConverter.Int64BitsToDouble(Marshal.ReadInt64(item, 16));
                    res.Add(s);
                }
                return res.ToArray();
            }
            finally { Marshal.FreeHGlobal(buf); }
        }

        public void Dispose() { if (query != IntPtr.Zero) { PdhCloseQuery(query); query = IntPtr.Zero; } }
    }
}
