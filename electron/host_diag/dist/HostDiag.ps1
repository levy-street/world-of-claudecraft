<#
.SYNOPSIS
    Host diagnostic for game performance issues (Windows native layer).
    Runs independent collectors and writes one versioned JSON file.
    READ-ONLY, no admin rights, no interaction. See SCHEMA.md.

.EXAMPLE
    powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File Invoke-HostDiag.ps1 -OutDir C:\temp
.EXAMPLE
    ... -Mode Sample -SampleSeconds 30 -Apps chrome.exe,MyGame.exe
#>
[CmdletBinding()]
param(
    [string]$OutDir = '',
    # Executables of interest: NVIDIA profile, Windows GPU preference, GPU usage while sampling.
    [string[]]$Apps = @('chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe'),
    # Snapshot = configuration only. Sample = configuration + live measures during -SampleSeconds.
    [ValidateSet('Snapshot', 'Sample')][string]$Mode = 'Snapshot',
    [ValidateRange(3, 300)][int]$SampleSeconds = 20,
    [string[]]$Only = @(),
    [string[]]$Skip = @(),
    # Keep the real computer name in the report (default: short hash only).
    [switch]$NoAnonymize,
    # Also write a human-readable .txt next to the JSON.
    [switch]$Summary,
    # Print the JSON on stdout and nothing else (progress is silenced).
    [switch]$StdoutJson,
    [switch]$Quiet,
    # A collector still running after this delay is killed and reported as "error: timeout".
    [ValidateRange(5, 600)][int]$CollectorTimeoutSeconds = 60,
    # Debug: run collectors inside this process (no crash/hang protection).
    [switch]$InProcess,
    # Internal (isolation mechanism): run a single collector, write its result to -ResultFile,
    # and die with the parent process.
    [string]$Worker = '',
    [string]$ResultFile = '',
    [int]$ParentPid = 0
)

# ==============================================================================
# RULE FOR THIS FILE: outside of a try{} block, use only cmdlets, operators and
# property reads. On locked-down machines (Constrained Language Mode) every .NET
# method call / New-Object throws; the orchestrator must still emit a JSON there.
# ==============================================================================
$ErrorActionPreference = 'Stop'
$ToolVersion = '0.3.1'
$SchemaVersion = 2
$FullLanguage = "$($ExecutionContext.SessionState.LanguageMode)" -eq 'FullLanguage'
$SelfPath = $MyInvocation.MyCommand.Path

# ------------------------------------------------------------
# 32-bit PowerShell on 64-bit Windows (e.g. spawned by a 32-bit Electron): registry and
# System32 are redirected, so half of the data would be wrong. Relaunch as 64-bit.
# Start-Process -NoNewWindow hands our stdout/stderr handles to the child untouched.
# ------------------------------------------------------------
if ($env:PROCESSOR_ARCHITEW6432 -and -not $Worker -and $SelfPath -and -not $env:HOSTDIAG_NO_RELAUNCH) {
    $relaunched = $false; $code = 0
    try {
        $native = Join-Path $env:windir 'sysnative\WindowsPowerShell\v1.0\powershell.exe'
        if (Test-Path $native) {
            $argList = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', "`"$SelfPath`"")
            foreach ($k in $PSBoundParameters.Keys) {
                $v = $PSBoundParameters[$k]
                if ($v -is [switch]) { if ($v) { $argList += "-$k" } }
                else { $argList += "-$k"; $argList += "`"$(@($v) -join ',')`"" }
            }
            $env:HOSTDIAG_NO_RELAUNCH = '1'
            $p = Start-Process -FilePath $native -ArgumentList $argList -NoNewWindow -Wait -PassThru
            $code = $p.ExitCode; $relaunched = $true
        }
    } catch { $relaunched = $false }
    if ($relaunched) { exit $code }
}

# "-Apps a.exe,b.exe" through powershell.exe -File arrives as ONE string.
$Apps = @($Apps | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -ne '_none_' })
$Only = @($Only | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })
$Skip = @($Skip | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })

#region INLINED BY scripts/host_diag_build.mjs - do not edit, edit the sources instead
$script:NativeSources = @(
@'
// NVIDIA driver settings (DRS) reader, via nvapi. READ-ONLY.
// C# 5 only (PowerShell 5.1 compiler): no $"", no ?., no out var.
namespace HostDiag.Nv
{
    using System;
    using System.Collections.Generic;
    using System.Runtime.InteropServices;
    public class SettingRow
    {
        public uint   Id;
        public string IdHex;
        public string Name;
        public string Type;               // DWORD / BINARY / STRING / WSTRING
        public bool   InAvailableList;    // known to NvAPI_DRS_EnumAvailableSettingIds
        public bool   InProfile;          // stored in this very profile
        public bool   Internal;           // undocumented driver flag (values may be obfuscated)
        public bool   Overridden;         // effective value != NVIDIA default
        public string Location;           // where the effective value comes from
        public string DefaultValue;
        public string CurrentValue;
        public string[] AllowedValues;
        public string Note;
    }

    public class ProfileDump
    {
        public string Target;             // "base", "app:chrome.exe", "profile:<name>"
        public bool   Found;
        public int    Status;
        public string ProfileName;
        public bool   IsPredefined;
        public uint   NumSettingsInProfile;
        public uint   NumApps;
        public List<SettingRow> Settings = new List<SettingRow>();
        public List<string> Warnings = new List<string>();
    }

    public class DumpResult
    {
        public bool   Success;
        public string Error;
        public string FailedStep;
        public int    Status;
        public string InterfaceVersion;
        public string DriverVersion;
        public string DriverBranch;
        public bool   BaseIsCurrentGlobal;
        public List<ProfileDump> Profiles = new List<ProfileDump>();
        public List<string> Warnings = new List<string>();
    }

    class AvailInfo { public int Type = -1; public string Default; public string[] Allowed; public string Note; public string Name; }

    public static class Dumper
    {
        [DllImport("nvapi64.dll", EntryPoint = "nvapi_QueryInterface", CallingConvention = CallingConvention.Cdecl)]
        static extern IntPtr QueryInterface64(uint id);
        [DllImport("nvapi.dll", EntryPoint = "nvapi_QueryInterface", CallingConvention = CallingConvention.Cdecl)]
        static extern IntPtr QueryInterface32(uint id);

        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnVoid();
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnOutPtr(out IntPtr p);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnPtr(IntPtr p);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnPtrOutPtr(IntPtr a, out IntPtr b);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnPtrPtrPtr(IntPtr a, IntPtr b, IntPtr c);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnPtrPtrOutPtr(IntPtr a, IntPtr b, out IntPtr c);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnFindApp(IntPtr s, IntPtr appName, out IntPtr profile, IntPtr app);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnGetSetting(IntPtr s, IntPtr p, uint id, IntPtr setting);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnEnumSettings(IntPtr s, IntPtr p, uint start, ref uint count, IntPtr settings);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnEnumIds(IntPtr ids, ref uint count);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnEnumValues(uint id, ref uint count, IntPtr values);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnNameFromId(uint id, IntPtr name);
        [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnDriverVer(out uint ver, IntPtr branch);

        // ---- NVAPI interface IDs -------------------------------------
        const uint ID_Initialize                 = 0x0150E828;
        const uint ID_Unload                     = 0xD22BDD7E;
        const uint ID_GetInterfaceVersionString  = 0x01053FA5;
        const uint ID_GetDriverAndBranchVersion  = 0x2926AAAD;
        const uint ID_CreateSession              = 0x0694D52E;
        const uint ID_DestroySession             = 0xDAD9CFF8;
        const uint ID_LoadSettings               = 0x375DBD6B;
        const uint ID_GetBaseProfile             = 0xDA8466A0;
        const uint ID_GetCurrentGlobalProfile    = 0x617BFF9F;
        const uint ID_GetProfileInfo             = 0x61CD6FD6;
        const uint ID_FindProfileByName          = 0x7E4A9A0B;
        const uint ID_FindApplicationByName      = 0xEEE566B2;
        const uint ID_EnumSettings               = 0xAE3039DA;
        const uint ID_GetSetting                 = 0x73BF8338;
        const uint ID_EnumAvailableSettingIds    = 0xF020614A;
        const uint ID_EnumAvailableSettingValues = 0x2EC39F90;
        const uint ID_GetSettingNameFromId       = 0xD61CBE6E;

        // ---- Struct layouts (nvapi.h, NvDrs) ---------------------------
        const int UNICODE_STRING = 4096;               // NvU16[2048]
        const int VALUE_UNION    = 4100;               // max(NvU32, {NvU32 len; NvU8[4096]}, wchar[2048])

        // NVDRS_SETTING_V1
        const int S_Version      = 0;
        const int S_Name         = 4;
        const int S_Id           = 4 + UNICODE_STRING;  // 4100
        const int S_Type         = S_Id + 4;
        const int S_Location     = S_Id + 8;
        const int S_IsCurPredef  = S_Id + 12;
        const int S_IsPredefValid= S_Id + 16;
        const int S_Predefined   = S_Id + 20;           // 4120
        const int S_Current      = S_Predefined + VALUE_UNION; // 8220
        const int S_Size         = S_Current + VALUE_UNION;    // 12320

        // NVDRS_SETTING_VALUES
        const int V_MaxValues    = 100;
        const int V_NumValues    = 4;
        const int V_Type         = 8;
        const int V_Default      = 12;
        const int V_Values       = V_Default + VALUE_UNION;
        const int V_Size         = V_Values + V_MaxValues * VALUE_UNION; // 414112

        // NVDRS_PROFILE_V1
        const int P_Name         = 4;
        const int P_IsPredefined = 4 + UNICODE_STRING + 4;
        const int P_NumApps      = 4 + UNICODE_STRING + 8;
        const int P_NumSettings  = 4 + UNICODE_STRING + 12;
        const int P_Size         = 4 + UNICODE_STRING + 16;     // 4116

        // NVDRS_APPLICATION_V1: version, isPredefined, appName, userFriendlyName, launcher
        const int A_Size         = 8 + 3 * UNICODE_STRING;      // 12296

        const int NVAPI_OK = 0;
        const int NVAPI_END_ENUMERATION = -7;
        const int NVAPI_SETTING_NOT_FOUND = -160;

        static uint MakeVersion(int size, int ver) { return (uint)size | ((uint)ver << 16); }

        static T Fn<T>(uint id) where T : class
        {
            IntPtr p = IntPtr.Size == 8 ? QueryInterface64(id) : QueryInterface32(id);
            if (p == IntPtr.Zero) return null;
            return (T)(object)Marshal.GetDelegateForFunctionPointer(p, typeof(T));
        }

        static readonly byte[] Zeros = new byte[65536];
        static void Zero(IntPtr p, int size)
        {
            for (int off = 0; off < size; off += Zeros.Length)
                Marshal.Copy(Zeros, 0, IntPtr.Add(p, off), Math.Min(Zeros.Length, size - off));
        }

        static void WriteUnicodeString(IntPtr p, string s)
        {
            Zero(p, UNICODE_STRING);
            char[] chars = s.ToCharArray();
            Marshal.Copy(chars, 0, p, Math.Min(chars.Length, 2047));
        }

        static string TypeName(int t)
        {
            switch (t) { case 0: return "DWORD"; case 1: return "BINARY"; case 2: return "STRING"; case 3: return "WSTRING"; }
            return "UNKNOWN(" + t + ")";
        }

        static string LocationName(int l)
        {
            switch (l) { case 0: return "ThisProfile"; case 1: return "GlobalProfile"; case 2: return "BaseProfile"; case 3: return "DriverDefault"; }
            return "Unknown(" + l + ")";
        }

        static string ReadValue(IntPtr p, int type)
        {
            switch (type)
            {
                case 0:
                    return "0x" + ((uint)Marshal.ReadInt32(p)).ToString("X8");
                case 1:
                {
                    int len = Marshal.ReadInt32(p);
                    if (len < 0 || len > 4096) return "<invalid binary length " + len + ">";
                    byte[] data = new byte[len];
                    Marshal.Copy(IntPtr.Add(p, 4), data, 0, len);
                    return "bin[" + len + "]:" + BitConverter.ToString(data).Replace("-", "");
                }
                case 2:
                    return Marshal.PtrToStringAnsi(p) ?? "";
                case 3:
                {
                    // Internal settings (0x7xxxxxxx) hold encrypted blobs typed as strings.
                    string s = Marshal.PtrToStringUni(p) ?? "";
                    foreach (char c in s)
                        if (c < 0x20 || c > 0x24F) return "<opaque string, " + s.Length + " chars>";
                    return s;
                }
            }
            return "<unknown type>";
        }

        // ---- state shared by the helpers during one Run() ----
        static IntPtr session, bufSetting, bufValues, bufMisc;
        static FnPtrPtrPtr getProfileInfo; static FnEnumSettings enumSettings; static FnGetSetting getSetting;
        static FnEnumValues enumValues; static FnNameFromId nameFromId;
        static List<uint> availableIds; static Dictionary<uint, AvailInfo> availCache;

        static AvailInfo GetAvail(uint id, bool inAvailableList)
        {
            AvailInfo a;
            if (availCache.TryGetValue(id, out a)) return a;
            a = new AvailInfo();
            if (nameFromId != null)
            {
                Zero(bufMisc, UNICODE_STRING);
                if (nameFromId(id, bufMisc) == NVAPI_OK) a.Name = Marshal.PtrToStringUni(bufMisc);
            }
            if (enumValues != null && inAvailableList)
            {
                Zero(bufValues, V_Size);
                Marshal.WriteInt32(bufValues, 0, (int)MakeVersion(V_Size, 1));
                uint max = V_MaxValues;
                int vs = enumValues(id, ref max, bufValues);
                if (vs == NVAPI_OK)
                {
                    a.Type = Marshal.ReadInt32(bufValues, V_Type);
                    a.Default = ReadValue(IntPtr.Add(bufValues, V_Default), a.Type);
                    int n = Marshal.ReadInt32(bufValues, V_NumValues);
                    if (n < 0) n = 0; if (n > V_MaxValues) n = V_MaxValues;
                    a.Allowed = new string[n];
                    for (int i = 0; i < n; i++)
                        a.Allowed[i] = ReadValue(IntPtr.Add(bufValues, V_Values + i * VALUE_UNION), a.Type);
                }
                else a.Note = "EnumAvailableSettingValues status " + vs;
            }
            availCache[id] = a;
            return a;
        }

        static void DumpProfile(IntPtr profile, ProfileDump d)
        {
            d.Found = true;
            if (getProfileInfo != null)
            {
                Zero(bufMisc, P_Size);
                Marshal.WriteInt32(bufMisc, 0, (int)MakeVersion(P_Size, 1));
                int st = getProfileInfo(session, profile, bufMisc);
                if (st == NVAPI_OK)
                {
                    d.ProfileName = Marshal.PtrToStringUni(IntPtr.Add(bufMisc, P_Name));
                    d.IsPredefined = Marshal.ReadInt32(bufMisc, P_IsPredefined) != 0;
                    d.NumApps = (uint)Marshal.ReadInt32(bufMisc, P_NumApps);
                    d.NumSettingsInProfile = (uint)Marshal.ReadInt32(bufMisc, P_NumSettings);
                }
                else d.Warnings.Add("GetProfileInfo status " + st);
            }

            Dictionary<uint, SettingRow> rows = new Dictionary<uint, SettingRow>();
            List<uint> order = new List<uint>();
            foreach (uint id in availableIds)
            {
                if (rows.ContainsKey(id)) continue;
                SettingRow row = new SettingRow(); row.Id = id; row.InAvailableList = true;
                rows[id] = row; order.Add(id);
            }

            // Settings stored in the profile: catches IDs missing from the public list.
            // (The driver hides some entries here, so per-ID GetSetting below stays the source of truth.)
            if (enumSettings != null && d.NumSettingsInProfile > 0)
            {
                int batch = (int)Math.Min(d.NumSettingsInProfile, 64);
                IntPtr buf = Marshal.AllocHGlobal(S_Size * batch);
                try
                {
                    uint start = 0;
                    while (true)
                    {
                        Zero(buf, S_Size * batch);
                        for (int i = 0; i < batch; i++)
                            Marshal.WriteInt32(buf, i * S_Size + S_Version, (int)MakeVersion(S_Size, 1));
                        uint count = (uint)batch;
                        int st = enumSettings(session, profile, start, ref count, buf);
                        if (st == NVAPI_END_ENUMERATION || count == 0) break;
                        if (st != NVAPI_OK) { d.Warnings.Add("EnumSettings status " + st + " at index " + start); break; }
                        for (int i = 0; i < count; i++)
                        {
                            uint id = (uint)Marshal.ReadInt32(buf, i * S_Size + S_Id);
                            if (!rows.ContainsKey(id))
                            {
                                SettingRow row = new SettingRow(); row.Id = id;
                                rows[id] = row; order.Add(id);
                            }
                        }
                        start += count;
                        if (count < batch) break;
                    }
                }
                finally { Marshal.FreeHGlobal(buf); }
            }

            foreach (uint id in order)
            {
                SettingRow row = rows[id];
                row.IdHex = "0x" + id.ToString("X8");
                row.Internal = !row.InAvailableList;
                try
                {
                    AvailInfo a = GetAvail(id, row.InAvailableList);
                    row.Name = a.Name; row.AllowedValues = a.Allowed; row.Note = a.Note;
                    int type = a.Type;

                    Zero(bufSetting, S_Size);
                    Marshal.WriteInt32(bufSetting, S_Version, (int)MakeVersion(S_Size, 1));
                    int gs = getSetting(session, profile, id, bufSetting);
                    if (gs == NVAPI_OK)
                    {
                        type = Marshal.ReadInt32(bufSetting, S_Type);
                        int loc = Marshal.ReadInt32(bufSetting, S_Location);
                        bool isCurPredef   = Marshal.ReadInt32(bufSetting, S_IsCurPredef) != 0;
                        bool isPredefValid = Marshal.ReadInt32(bufSetting, S_IsPredefValid) != 0;
                        if (string.IsNullOrEmpty(row.Name))
                            row.Name = Marshal.PtrToStringUni(IntPtr.Add(bufSetting, S_Name));
                        row.InProfile = (loc == 0);
                        row.Location = LocationName(loc);
                        row.CurrentValue = ReadValue(IntPtr.Add(bufSetting, S_Current), type);
                        row.DefaultValue = isPredefValid
                            ? ReadValue(IntPtr.Add(bufSetting, S_Predefined), type)
                            : a.Default;
                        // isCurrentPredefined is unreliable on the Base Profile -> compare values.
                        if (row.DefaultValue != null) row.Overridden = row.CurrentValue != row.DefaultValue;
                        else if (!isCurPredef) { row.Overridden = true; row.Note = "user value, no known default"; }
                    }
                    else if (gs == NVAPI_SETTING_NOT_FOUND)
                    {
                        row.Location = "DriverDefault";
                        row.DefaultValue = a.Default;
                        row.CurrentValue = a.Default;
                    }
                    else
                    {
                        row.DefaultValue = a.Default;
                        row.Note = "GetSetting status " + gs;
                    }
                    row.Type = TypeName(type);
                }
                catch (Exception e) { row.Note = "exception: " + e.Message; }
                d.Settings.Add(row);
            }
        }

        public static DumpResult Run(string[] apps, string[] profileNames)
        {
            DumpResult r = new DumpResult();
            session = bufSetting = bufValues = bufMisc = IntPtr.Zero;
            IntPtr bufApp = IntPtr.Zero;
            bool initialized = false;
            string step = "load nvapi";

            try
            {
                FnVoid init;
                try { init = Fn<FnVoid>(ID_Initialize); }
                catch (DllNotFoundException)
                {
                    r.Error = "nvapi DLL not found: no NVIDIA driver installed on this machine.";
                    r.FailedStep = step; return r;
                }
                FnOutPtr       createSession = Fn<FnOutPtr>(ID_CreateSession);
                FnPtr          loadSettings  = Fn<FnPtr>(ID_LoadSettings);
                FnPtrOutPtr    getBase       = Fn<FnPtrOutPtr>(ID_GetBaseProfile);
                FnPtrOutPtr    getGlobal     = Fn<FnPtrOutPtr>(ID_GetCurrentGlobalProfile);
                FnPtrPtrOutPtr findProfile   = Fn<FnPtrPtrOutPtr>(ID_FindProfileByName);
                FnFindApp      findApp       = Fn<FnFindApp>(ID_FindApplicationByName);
                FnEnumIds      enumIds       = Fn<FnEnumIds>(ID_EnumAvailableSettingIds);
                getProfileInfo = Fn<FnPtrPtrPtr>(ID_GetProfileInfo);
                enumSettings   = Fn<FnEnumSettings>(ID_EnumSettings);
                getSetting     = Fn<FnGetSetting>(ID_GetSetting);
                enumValues     = Fn<FnEnumValues>(ID_EnumAvailableSettingValues);
                nameFromId     = Fn<FnNameFromId>(ID_GetSettingNameFromId);

                if (init == null || createSession == null || loadSettings == null || getBase == null ||
                    getSetting == null || enumIds == null)
                {
                    r.Error = "A required NVAPI DRS function is missing from this driver.";
                    r.FailedStep = "QueryInterface"; return r;
                }

                step = "NvAPI_Initialize";
                int st = init();
                if (st != NVAPI_OK) { r.Status = st; r.FailedStep = step; r.Error = "NVAPI init failed (no NVIDIA GPU active?)."; return r; }
                initialized = true;

                bufMisc    = Marshal.AllocHGlobal(8192);
                bufSetting = Marshal.AllocHGlobal(S_Size);
                bufValues  = Marshal.AllocHGlobal(V_Size);
                bufApp     = Marshal.AllocHGlobal(A_Size);

                try
                {
                    FnPtr ivs = Fn<FnPtr>(ID_GetInterfaceVersionString);
                    if (ivs != null) { Zero(bufMisc, 256); if (ivs(bufMisc) == 0) r.InterfaceVersion = Marshal.PtrToStringAnsi(bufMisc); }
                    FnDriverVer dv = Fn<FnDriverVer>(ID_GetDriverAndBranchVersion);
                    if (dv != null)
                    {
                        uint ver; Zero(bufMisc, 256);
                        if (dv(out ver, bufMisc) == 0)
                        {
                            r.DriverVersion = (ver / 100) + "." + (ver % 100).ToString("00");
                            r.DriverBranch = Marshal.PtrToStringAnsi(bufMisc);
                        }
                    }
                }
                catch (Exception e) { r.Warnings.Add("version query: " + e.Message); }

                step = "NvAPI_DRS_CreateSession";
                st = createSession(out session);
                if (st != NVAPI_OK) { r.Status = st; r.FailedStep = step; r.Error = step + " failed"; return r; }

                step = "NvAPI_DRS_LoadSettings";
                st = loadSettings(session);
                if (st != NVAPI_OK) { r.Status = st; r.FailedStep = step; r.Error = step + " failed"; return r; }

                step = "NvAPI_DRS_EnumAvailableSettingIds";
                availableIds = new List<uint>(); availCache = new Dictionary<uint, AvailInfo>();
                uint idCount = 8192;
                IntPtr bufIds = Marshal.AllocHGlobal((int)idCount * 4);
                try
                {
                    st = enumIds(bufIds, ref idCount);
                    if (st != NVAPI_OK) { r.Status = st; r.FailedStep = step; r.Error = step + " failed"; return r; }
                    for (int i = 0; i < idCount; i++) availableIds.Add((uint)Marshal.ReadInt32(bufIds, i * 4));
                }
                finally { Marshal.FreeHGlobal(bufIds); }

                // ---- Base profile ----
                step = "NvAPI_DRS_GetBaseProfile";
                IntPtr baseProfile;
                st = getBase(session, out baseProfile);
                if (st != NVAPI_OK) { r.Status = st; r.FailedStep = step; r.Error = step + " failed"; return r; }
                if (getGlobal != null)
                {
                    IntPtr global;
                    if (getGlobal(session, out global) == NVAPI_OK)
                    {
                        r.BaseIsCurrentGlobal = (global == baseProfile);
                        if (!r.BaseIsCurrentGlobal)
                            r.Warnings.Add("Current global profile is NOT the Base Profile: another global profile is active.");
                    }
                }
                step = "dump base";
                ProfileDump bd = new ProfileDump(); bd.Target = "base";
                DumpProfile(baseProfile, bd);
                r.Profiles.Add(bd);

                // ---- Application profiles (by executable name) ----
                foreach (string app in apps ?? new string[0])
                {
                    step = "dump app " + app;
                    ProfileDump d = new ProfileDump(); d.Target = "app:" + app;
                    r.Profiles.Add(d);
                    if (findApp == null) { d.Warnings.Add("FindApplicationByName not exported"); continue; }
                    WriteUnicodeString(bufMisc, app);
                    Zero(bufApp, A_Size);
                    Marshal.WriteInt32(bufApp, 0, (int)MakeVersion(A_Size, 1));
                    IntPtr p;
                    d.Status = findApp(session, bufMisc, out p, bufApp);
                    if (d.Status == NVAPI_OK) DumpProfile(p, d);
                }

                // ---- Extra profiles by name ----
                foreach (string name in profileNames ?? new string[0])
                {
                    step = "dump profile " + name;
                    ProfileDump d = new ProfileDump(); d.Target = "profile:" + name;
                    r.Profiles.Add(d);
                    if (findProfile == null) { d.Warnings.Add("FindProfileByName not exported"); continue; }
                    WriteUnicodeString(bufMisc, name);
                    IntPtr p;
                    d.Status = findProfile(session, bufMisc, out p);
                    if (d.Status == NVAPI_OK) DumpProfile(p, d);
                }

                r.Success = true;
                return r;
            }
            catch (Exception e)
            {
                r.Error = e.GetType().Name + ": " + e.Message;
                r.FailedStep = step;
                return r;
            }
            finally
            {
                if (bufApp     != IntPtr.Zero) Marshal.FreeHGlobal(bufApp);
                if (bufSetting != IntPtr.Zero) Marshal.FreeHGlobal(bufSetting);
                if (bufValues  != IntPtr.Zero) Marshal.FreeHGlobal(bufValues);
                if (bufMisc    != IntPtr.Zero) Marshal.FreeHGlobal(bufMisc);
                try
                {
                    if (session != IntPtr.Zero) { FnPtr d = Fn<FnPtr>(ID_DestroySession); if (d != null) d(session); }
                    if (initialized) { FnVoid u = Fn<FnVoid>(ID_Unload); if (u != null) u(); }
                } catch { }
            }
        }
    }
}
'@,
@'
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
'@
)
# ---- lib\Summary.ps1 ----
# Human-readable digest of a report (what the player can read before sending the JSON).
function Format-DiagSummary {
    param($Report)

    $out = New-Object System.Collections.Generic.List[string]
    $c = $Report.collectors
    function Sect($name) { if ($c[$name] -and $c[$name].status -eq 'ok') { $c[$name].data } }

    $out.Add("host-diag $($Report.tool.version) - $($Report.generatedAt) - mode $($Report.mode) - $($Report.computer)")
    $out.Add('')
    foreach ($name in $c.Keys) {
        $e = $c[$name]
        $out.Add(('  [{0,-10}] {1,-8} {2}' -f $name, $e.status, $e.error))
    }
    $out.Add('')

    $d = Sect 'system'
    if ($d) {
        $out.Add("SYSTEM   $($d.os.caption) build $($d.os.build), uptime $($d.os.uptimeHours) h")
        $out.Add("         $($d.cpu.name) ($($d.cpu.cores)C/$($d.cpu.threads)T)")
        $out.Add("         laptop: $($d.isLaptop)")
    }
    $d = Sect 'power'
    if ($d) {
        $bat = if ($d.hasBattery) { "battery $($d.batteryPercent)%" } else { 'no battery' }
        $out.Add("POWER    $($d.acLine), $bat, battery saver: $($d.batterySaverOn)")
        $out.Add("         plan: $($d.powerPlan.name) - power mode: $($d.powerModeEffective.name)")
    }
    $d = Sect 'memory'
    if ($d) { $out.Add("MEMORY   $($d.availableGB) GB free of $($d.totalGB) GB ($($d.usedPercent)% used), $($d.moduleCount) module(s)") }
    $d = Sect 'gpu'
    if ($d) {
        foreach ($a in $d.adapters) { $out.Add("GPU      $($a.name) [$($a.vendor)] driver $($a.driverVersion) ($($a.driverDate)) VRAM $($a.vramGB) GB") }
        $out.Add("         multiple GPUs: $($d.multipleGpus) - HAGS: $($d.hardwareGpuScheduling) - game mode: $($d.gameMode)")
        foreach ($p in $d.windowsGpuPreferences) { $out.Add("         Windows GPU preference: $($p.app) -> $($p.preference)") }
    }
    $d = Sect 'display'
    if ($d) { foreach ($s in $d.displays) { $out.Add("DISPLAY  $($s.width)x$($s.height) @ $($s.refreshHz) Hz (max $($s.maxRefreshHzAtThisResolution) Hz), scale $($s.scalePercent)%, on $($s.adapter)") } }
    $d = Sect 'browsers'
    if ($d) { foreach ($b in ($d.browsers | Where-Object { $_.installed })) { $out.Add("BROWSER  $($b.name) $($b.version) - hw acceleration disabled by user: $($b.hardwareAccelerationDisabledByUser) - running: $($b.running)") } }
    $d = Sect 'processes'
    if ($d) {
        $out.Add('TOP CPU  ' + (($d.topCpu | ForEach-Object { "$($_.name) $($_.cpuPercent)%" }) -join ', '))
        $out.Add('TOP RAM  ' + (($d.topMemory | ForEach-Object { "$($_.name) $($_.memoryMB) MB" }) -join ', '))
    }
    $d = Sect 'nvidia'
    if ($d) {
        $out.Add("NVIDIA   driver $($d.driverVersion) [$($d.driverBranch)]")
        $out.Add("         [global settings] $($d.base.overriddenCount) changed from NVIDIA defaults")
        foreach ($s in ($d.base.settings | Where-Object { $_.overridden })) {
            $cur = if ($s.currentLabel) { "$($s.current) ($($s.currentLabel))" } else { $s.current }
            $def = if ($s.defaultLabel) { "$($s.default) ($($s.defaultLabel))" } else { $s.default }
            $out.Add("             * $($s.id) $($s.name): $def -> $cur")
        }
        foreach ($p in $d.apps) {
            if ($p.lookup -ne 'found') { $out.Add("         [$($p.app)] $($p.lookup) (status $($p.nvapiStatus)) -> global settings apply"); continue }
            $out.Add("         [$($p.app)] '$($p.profileName)' - $(@($p.differences).Count) difference(s) with global settings")
            foreach ($s in $p.differences) {
                $cur = if ($s.currentLabel) { "$($s.current) ($($s.currentLabel))" } else { $s.current }
                $bas = if ($s.baseLabel) { "$($s.baseValue) ($($s.baseLabel))" } else { $s.baseValue }
                $tag = if ($s.userModified) { 'changed by user' } else { 'NVIDIA preset' }
                $out.Add("             * $($s.id) $($s.name): global $bas -> app $cur  [$tag]")
            }
        }
    }
    $d = Sect 'sampling'
    if ($d) {
        $out.Add("SAMPLING $($d.seconds) s - CPU avg $($d.cpuPercent.avg)% (max $($d.cpuPercent.max)%), clock avg $($d.cpuMHz.avg) MHz (min $($d.cpuMHz.min), max $($d.cpuMHz.max))")
        if ($d.underLoadSamples -gt 0) { $out.Add("         under load ($($d.underLoadSamples) s): clock avg $($d.cpuMHzUnderLoad.avg) MHz (min $($d.cpuMHzUnderLoad.min)), perf avg $($d.cpuPerformancePercentUnderLoad.avg)%") }
        else { $out.Add('         CPU never reached 50% load: clock figures only show idle power saving') }
        $out.Add("         RAM available min $($d.memoryAvailableMB.min) MB")
        foreach ($g in $d.gpuAdapters) { $out.Add("         GPU $($g.adapter): avg $($g.usagePercent.avg)% max $($g.usagePercent.max)%, VRAM max $($g.dedicatedMemoryMB.max) MB") }
        foreach ($g in $d.gpuApps) { $out.Add("         $($g.app) on $($g.adapter): avg $($g.usagePercent.avg)% max $($g.usagePercent.max)%") }
    }
    return $out
}

# ---- collectors\Browsers.ps1 ----
function Get-DiagBrowsers {
    param($Ctx)

    $local = $env:LOCALAPPDATA; $roaming = $env:APPDATA
    $defs = @(
        @{ name = 'chrome';  exe = 'chrome.exe';  kind = 'chromium'; state = "$local\Google\Chrome\User Data\Local State" }
        @{ name = 'edge';    exe = 'msedge.exe';  kind = 'chromium'; state = "$local\Microsoft\Edge\User Data\Local State" }
        @{ name = 'brave';   exe = 'brave.exe';   kind = 'chromium'; state = "$local\BraveSoftware\Brave-Browser\User Data\Local State" }
        @{ name = 'opera';   exe = 'opera.exe';   kind = 'chromium'; state = "$roaming\Opera Software\Opera Stable\Local State" }
        @{ name = 'firefox'; exe = 'firefox.exe'; kind = 'firefox';  state = "$roaming\Mozilla\Firefox\Profiles" }
    )

    function Find-Exe([string]$exe) {
        foreach ($hive in 'HKCU:', 'HKLM:') {
            foreach ($node in 'SOFTWARE', 'SOFTWARE\WOW6432Node') {
                try {
                    $p = (Get-ItemProperty "$hive\$node\Microsoft\Windows\CurrentVersion\App Paths\$exe" -ErrorAction Stop).'(default)'
                    if ($p) { $p = $p.Trim('"'); if (Test-Path $p) { return $p } }
                } catch { }
            }
        }
        return $null
    }

    $running = @{}
    try { Get-Process | ForEach-Object { $running["$($_.ProcessName).exe".ToLower()] = $true } } catch { }

    $browsers = @(foreach ($d in $defs) {
        $path = Find-Exe $d.exe
        $version = $null
        if ($path) { try { $version = (Get-Item $path).VersionInfo.ProductVersion } catch { } }

        # Targeted read: only the hardware-acceleration flag is extracted, nothing else is parsed or kept.
        # Local State is single-line JSON, so the read is whole-file by necessity (docs/desktop-release.md, antivirus checklist).
        $disabled = $null; $note = $null
        try {
            if ($d.kind -eq 'chromium' -and (Test-Path $d.state)) {
                $raw = Get-Content -LiteralPath $d.state -Raw
                if ($raw -match '"hardware_acceleration_mode"\s*:\s*\{[^}]*"enabled"\s*:\s*(true|false)') { $disabled = $Matches[1] -ne 'true' }
                else { $disabled = $false; $note = 'flag absent = browser default (enabled)' }
            }
            elseif ($d.kind -eq 'firefox' -and (Test-Path $d.state)) {
                $prefs = Get-ChildItem $d.state -Filter prefs.js -Recurse -Depth 1 -ErrorAction SilentlyContinue |
                         Sort-Object LastWriteTime -Descending | Select-Object -First 1
                if ($prefs) {
                    $hits = @(Select-String -Path $prefs.FullName -Pattern 'user_pref\("(layers\.acceleration\.disabled|gfx\.webrender\.software|webgl\.disabled)",\s*true\)')
                    $disabled = $hits.Count -gt 0
                    if ($hits.Count) { $note = ($hits | ForEach-Object { $_.Matches[0].Groups[1].Value }) -join ', ' }
                    else { $note = 'no disabling pref found = browser default (enabled)' }
                }
            }
        } catch { $note = "read error: $($_.Exception.GetType().Name)" }

        [ordered]@{
            name                 = $d.name
            exe                  = $d.exe
            installed            = [bool]$path
            version              = $version
            running              = [bool]$running[$d.exe]
            # true = the USER turned hardware acceleration off. false does NOT prove the GPU is used
            # (command-line flags, driver blocklist): sampling.gpuApps is the ground truth. null = unknown.
            hardwareAccelerationDisabledByUser = $disabled
            note                 = $note
        }
    })

    # The ProgId is FOLDED to a browser name, never emitted: Firefox's is 'FirefoxURL-<16 hex>', a
    # hash of the install path, and it has no backslash so the scrubber would not touch it.
    # null = unreadable, 'other' = a browser outside the table above.
    $default = $null
    try {
        $progId = "$((Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice' -ErrorAction Stop).ProgId)"
        $default = switch -Regex ($progId) {
            '^ChromeHTML'  { 'chrome'; break }
            '^MSEdge'      { 'edge'; break }
            '^Brave'       { 'brave'; break }
            '^Opera'       { 'opera'; break }
            '^Firefox'     { 'firefox'; break }
            default        { 'other' }
        }
    } catch { }

    [ordered]@{
        defaultBrowser = $default
        browsers             = $browsers
    }
}

# ---- collectors\Display.ps1 ----
function Get-DiagDisplay {
    param($Ctx)

    Initialize-DiagNative
    $displays = @([HostDiag.Sys.Display]::Get() | ForEach-Object {
        [ordered]@{
            device        = $_.Device
            adapter       = $_.Adapter
            primary       = $_.Primary
            width         = $_.Width
            height        = $_.Height
            refreshHz     = $_.RefreshHz
            # > refreshHz means the monitor can do better at this resolution (144 Hz panel left at 60 Hz).
            maxRefreshHzAtThisResolution = $_.MaxRefreshHzAtThisResolution
            scalePercent  = if ($_.ScalePercent -gt 0) { $_.ScalePercent } else { $null }
            bitsPerPixel  = $_.BitsPerPixel
        }
    })

    # 59 (59.94) and 60 are the same rate: bucket to the nearest multiple of 5 before comparing.
    $rates = @($displays | ForEach-Object { [int]([math]::Round($_.refreshHz / 5.0) * 5) } | Sort-Object -Unique)
    $primary = $displays | Where-Object { $_.primary } | Select-Object -First 1
    [ordered]@{
        count              = $displays.Count
        # Which GPU drives the main screen (on hybrid laptops: usually the integrated one).
        primaryDisplayAdapter = if ($primary) { $primary.adapter } else { $null }
        # Mixed refresh rates across monitors is a classic source of stutter in windowed/browser rendering.
        mixedRefreshRates  = $rates.Count -gt 1
        displays           = $displays
    }
}

# ---- collectors\Gpu.ps1 ----
function Get-DiagGpuVendor([string]$PnpId) {
    switch -Regex ($PnpId) {
        'VEN_10DE' { 'NVIDIA'; break }
        'VEN_1002' { 'AMD'; break }
        'VEN_8086' { 'Intel'; break }
        'VEN_1414' { 'Microsoft'; break }
        'VEN_5143|VEN_QCOM' { 'Qualcomm'; break }
        default    { 'Other' }
    }
}

# DirectX adapter table: real VRAM (Win32_VideoController.AdapterRAM is capped at 4 GB) and the
# adapter LUID used by the GPU performance counters.
function Get-DiagDxAdapters {
    $list = @()
    try {
        $list = @(Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\DirectX' -ErrorAction Stop | ForEach-Object {
            $p = Get-ItemProperty $_.PSPath
            if ($p.Description) {
                [pscustomobject]@{
                    Description = $p.Description
                    Luid        = if ($null -ne $p.AdapterLuid) { [uint64]$p.AdapterLuid } else { $null }
                    VramBytes   = if ($null -ne $p.DedicatedVideoMemory) { [uint64]$p.DedicatedVideoMemory } else { $null }
                    VendorId    = $p.VendorId
                }
            }
        })
    } catch { }
    return $list
}

function Get-DiagGpu {
    param($Ctx)

    $dx = Get-DiagDxAdapters
    $adapters = @(Get-DiagVideoControllers | ForEach-Object {
        $vc = $_
        $match = $dx | Where-Object { $_.Description -eq $vc.Name } | Select-Object -First 1
        [ordered]@{
            name          = $vc.Name
            vendor        = Get-DiagGpuVendor $vc.PNPDeviceID
            driverVersion = $vc.DriverVersion
            driverDate    = if ($vc.DriverDate) { $vc.DriverDate.ToString('yyyy-MM-dd') } else { $null }
            vramGB        = if ($match -and $match.VramBytes) { (Get-DiagRound ($match.VramBytes / 1GB) 1) } else { $null }
            status        = $vc.Status
            isPhysical    = $vc.PNPDeviceID -match '^PCI\\'
        }
    })

    # Several GPUs (integrated + discrete). On a laptop this means hybrid graphics (Optimus / MX / AMD
    # switchable); on a desktop it only means the iGPU is enabled. Cross with system.isLaptop and
    # display.primaryDisplayAdapter.
    $vendors = @($adapters | Where-Object { $_.isPhysical } | ForEach-Object { $_.vendor } | Sort-Object -Unique)
    $hybrid = ($vendors -contains 'Intel' -and ($vendors -contains 'NVIDIA' -or $vendors -contains 'AMD')) -or
              (@($adapters | Where-Object { $_.isPhysical -and $_.vendor -eq 'AMD' }).Count -ge 2) -or
              ($vendors -contains 'AMD' -and $vendors -contains 'NVIDIA')

    $hags = $null
    try {
        $v = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers' -ErrorAction Stop).HwSchMode
        $hags = switch ($v) { 2 { 'on' } 1 { 'off' } default { $null } }
    } catch { }

    $gameMode = $null
    try {
        $v = (Get-ItemProperty 'HKCU:\Software\Microsoft\GameBar' -ErrorAction Stop).AutoGameModeEnabled
        $gameMode = if ($null -eq $v -or $v -eq 1) { 'on' } else { 'off' }
    } catch { $gameMode = 'on' }   # key absent = Windows default = on

    # Windows per-app GPU preference (Settings > Display > Graphics).
    # Only the apps of interest + the global default: other entries are none of our business.
    $prefs = @(); $global = $null
    try {
        $key = Get-Item 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences' -ErrorAction Stop
        $wanted = @($Ctx.Apps | ForEach-Object { [regex]::Escape($_) }) -join '|'
        foreach ($name in $key.GetValueNames()) {
            $value = "$($key.GetValue($name))"
            if ($name -eq 'DirectXUserGlobalSettings') { $global = $value; continue }
            if ($wanted -and $name -match "(^|\\)($wanted)$") {
                $pref = if ($value -match 'GpuPreference=(\d+)') { [int]$Matches[1] } else { $null }
                $prefs += [ordered]@{
                    app        = Split-Path $name -Leaf          # never the full user path
                    preference = switch ($pref) { 0 { 'auto' } 1 { 'powerSaving' } 2 { 'highPerformance' } default { 'unknown' } }
                    raw        = $value
                }
            }
        }
    } catch { }

    [ordered]@{
        adapters                 = $adapters
        multipleGpus             = $hybrid
        hardwareGpuScheduling    = $hags
        gameMode                 = $gameMode
        windowsGpuPreferences    = $prefs
        windowsGlobalGraphicsSettings = $global     # e.g. "SwapEffectUpgradeEnable=1;VRROptimizeEnable=0;"
    }
}

# ---- collectors\Memory.ps1 ----
function Get-DiagMemory {
    param($Ctx)

    $os = Get-CimInstance Win32_OperatingSystem   # sizes in KB
    $modules = @()
    try {
        $modules = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object {
            [ordered]@{
                slot            = $_.DeviceLocator
                sizeGB          = (Get-DiagRound ($_.Capacity / 1GB) 1)
                speedMHz        = [int]$_.Speed
                configuredMHz   = [int]$_.ConfiguredClockSpeed
                manufacturer    = "$($_.Manufacturer)".Trim()
            }
        })
    } catch { }

    $slots = $null
    try { $slots = [int](Get-CimInstance Win32_PhysicalMemoryArray | Measure-Object MemoryDevices -Sum).Sum } catch { }

    [ordered]@{
        totalGB        = (Get-DiagRound ($os.TotalVisibleMemorySize / 1MB) 1)
        availableGB    = (Get-DiagRound ($os.FreePhysicalMemory / 1MB) 1)
        usedPercent    = [int](100 - 100 * $os.FreePhysicalMemory / $os.TotalVisibleMemorySize)
        commitLimitGB  = (Get-DiagRound ($os.TotalVirtualMemorySize / 1MB) 1)
        commitUsedGB   = (Get-DiagRound (($os.TotalVirtualMemorySize - $os.FreeVirtualMemory) / 1MB) 1)
        moduleCount    = $modules.Count
        slotCount      = $slots
        # One module = single channel for sure (hurts integrated GPUs a lot). Two or more = probably dual.
        singleModule   = $modules.Count -eq 1
        modules        = $modules
    }
}

# ---- collectors\Nvidia.ps1 ----
# Friendly names for a few values. Cosmetic only: the raw hex value is always kept,
# and settings/values missing from this table are dumped anyway (nothing is filtered by it).
$script:NvValueHints = @{
    '0x1057EB71' = @{ '0x00000000'='Adaptive'; '0x00000001'='Prefer max performance'; '0x00000002'='Driver controlled'
                      '0x00000003'='Consistent performance'; '0x00000004'='Prefer min performance'; '0x00000005'='Optimal power' }
    '0x00A879CF' = @{ '0x60925292'='Use 3D application setting'; '0x08416747'='Force off'; '0x47814940'='Force on'
                      '0x32610244'='Half refresh rate'; '0x18888888'='Fast sync' }
    '0x00198FFF' = @{ '0x00000000'='Off'; '0x00000001'='On' }
    '0x00CE2691' = @{ '0xFFFFFFF6'='High quality'; '0x00000000'='Quality'; '0x0000000A'='Performance'; '0x00000014'='High performance' }
    '0x007BA09E' = @{ '0x00000000'='Use 3D application setting' }
    '0x10835002' = @{ '0x00000000'='Off' }
}

function Get-DiagNvidia {
    param($Ctx)

    Initialize-DiagNative
    $r = [HostDiag.Nv.Dumper]::Run([string[]]$Ctx.Apps, [string[]]@())
    if (-not $r.Success) { throw "NVAPI failed at [$($r.FailedStep)] status=$($r.Status): $($r.Error)" }

    function Label([string]$IdHex, [string]$Value) {
        if ($null -eq $Value -or $Value -eq '') { return $null }
        $map = $script:NvValueHints[$IdHex]
        if ($map -and $map.ContainsKey($Value)) { return $map[$Value] }
        return $null
    }

    # ---- Base profile = "Global settings" of the NVIDIA Control Panel ----
    # Every setting the driver knows is listed. overridden = effective value != NVIDIA default.
    $base = $r.Profiles | Where-Object { $_.Target -eq 'base' } | Select-Object -First 1
    $baseValues = @{}
    foreach ($s in $base.Settings) { $baseValues[$s.IdHex] = $s.CurrentValue }

    $baseRows = @($base.Settings | Sort-Object @{e={-not $_.Overridden}}, Name, Id | ForEach-Object {
        [ordered]@{
            id            = $_.IdHex
            name          = $_.Name
            type          = $_.Type
            overridden    = $_.Overridden
            default       = $_.DefaultValue
            defaultLabel  = Label $_.IdHex $_.DefaultValue
            current       = $_.CurrentValue
            currentLabel  = Label $_.IdHex $_.CurrentValue
            allowedValues = $_.AllowedValues
            note          = $_.Note
        }
    })

    # ---- App profiles: ONLY what makes the app behave differently from the base profile ----
    #   differsFromBase: effective value for this app != effective value of the base profile
    #                    (e.g. NVIDIA ships Firefox with "Adaptive" power mode whatever the global setting is)
    #   userModified   : the user changed this setting in the app's own profile
    # A global override inherited by the app is NOT repeated here: it is in the base profile.
    # Undocumented internal driver flags (no known base value) are left out unless user-modified.
    $apps = @(foreach ($p in ($r.Profiles | Where-Object { $_.Target -ne 'base' })) {
        $rows = @()
        foreach ($s in ($p.Settings | Sort-Object Name, Id)) {
            $hasBase = $baseValues.ContainsKey($s.IdHex) -and $null -ne $baseValues[$s.IdHex]
            $differs = $hasBase -and $s.CurrentValue -ne $baseValues[$s.IdHex]
            $userModified = $s.InProfile -and $s.Overridden
            if (-not ($differs -or $userModified)) { continue }
            $rows += [ordered]@{
                id              = $s.IdHex
                name            = $s.Name
                type            = $s.Type
                current         = $s.CurrentValue
                currentLabel    = Label $s.IdHex $s.CurrentValue
                baseValue       = if ($hasBase) { $baseValues[$s.IdHex] } else { $null }
                baseLabel       = if ($hasBase) { Label $s.IdHex $baseValues[$s.IdHex] } else { $null }
                differsFromBase = $differs
                userModified    = $userModified
                nvidiaDefaultForApp = $s.DefaultValue
                internal        = $s.Internal
            }
        }
        [ordered]@{
            app             = $p.Target -replace '^app:', ''
            # found | noProfile (only the base profile applies) | unknown (lookup failed, see nvapiStatus)
            lookup          = if ($p.Found) { 'found' } elseif ($p.Status -eq -166) { 'noProfile' } else { 'unknown' }
            nvapiStatus     = $p.Status
            profileName     = $p.ProfileName
            isPredefined    = $p.IsPredefined
            settingsStored  = $p.NumSettingsInProfile
            warnings        = @($p.Warnings)
            differences     = $rows
        }
    })

    [ordered]@{
        driverVersion       = $r.DriverVersion
        driverBranch        = $r.DriverBranch
        nvapiInterface      = $r.InterfaceVersion
        baseIsCurrentGlobal = $r.BaseIsCurrentGlobal
        warnings            = @($r.Warnings)
        base = [ordered]@{
            profileName     = $base.ProfileName
            settingsStored  = $base.NumSettingsInProfile
            overriddenCount = @($baseRows | Where-Object { $_.overridden }).Count
            warnings        = @($base.Warnings)
            settings        = $baseRows
        }
        apps = $apps
    }
}

# ---- collectors\Power.ps1 ----
function Get-DiagPower {
    param($Ctx)

    # Windows 10/11 "power mode" slider (overlay on top of the classic power plan).
    $overlayNames = @{
        '961cc777-2547-4f9d-8174-7d86181b8a7a' = 'BestPowerEfficiency'
        '00000000-0000-0000-0000-000000000000' = 'Balanced'
        '3af9b8d9-7c97-431d-ad78-34a8bfea439f' = 'BetterPerformance'
        'ded574b5-45a0-4f42-8737-46345c09c238' = 'BestPerformance'
    }
    function Resolve-Overlay($guid) {
        if (-not $guid) { return $null }
        $n = $overlayNames[$guid.ToLower()]
        [ordered]@{ guid = $guid; name = if ($n) { $n } else { 'Unknown' } }
    }

    $nativeError = $null
    try { Initialize-DiagNative } catch { $nativeError = "$($_.Exception.Message)" }

    if (-not $nativeError) {
        $p = [HostDiag.Sys.Power]::Get()
        $hasBattery = $p.StatusOk -and $p.BatteryFlag -ne 255 -and -not ($p.BatteryFlag -band 128)
        return [ordered]@{
            source       = 'native'
            acLine       = switch ($p.AcLineStatus) { 0 { 'battery' } 1 { 'plugged' } default { 'unknown' } }
            hasBattery   = $hasBattery
            batteryPercent     = if ($hasBattery -and $p.BatteryPercent -le 100) { $p.BatteryPercent } else { $null }
            batteryCharging    = if ($hasBattery) { [bool]($p.BatteryFlag -band 8) } else { $null }
            batteryMinutesLeft = if ($hasBattery -and $p.BatterySecondsLeft -ge 0) { [int]($p.BatterySecondsLeft / 60) } else { $null }
            batterySaverOn     = $p.BatterySaverOn
            powerPlan          = [ordered]@{ guid = $p.ActiveSchemeGuid; name = $p.ActiveSchemeName }
            powerModeEffective = Resolve-Overlay $p.EffectiveOverlayGuid
            powerModeSelected  = Resolve-Overlay $p.ActualOverlayGuid
            warnings           = @($p.Warnings)
        }
    }

    # Fallback without Add-Type: no power-mode slider, but battery and plan are still available.
    $bat = @(Get-CimInstance Win32_Battery)
    $plan = $null
    try {
        $active = Get-CimInstance -Namespace root\cimv2\power -ClassName Win32_PowerPlan -Filter 'IsActive=true'
        $plan = [ordered]@{ guid = ($active.InstanceID -replace '.*\{(.+)\}.*', '$1'); name = $active.ElementName }
    } catch { }
    [ordered]@{
        source       = 'cim-fallback'
        acLine       = if ($bat.Count -eq 0) { 'plugged' } elseif ($bat[0].BatteryStatus -eq 1) { 'battery' } else { 'plugged' }
        hasBattery   = $bat.Count -gt 0
        batteryPercent     = if ($bat.Count) { [int]$bat[0].EstimatedChargeRemaining } else { $null }
        batteryCharging    = $null
        batteryMinutesLeft = $null
        batterySaverOn     = $null
        powerPlan          = $plan
        powerModeEffective = $null
        powerModeSelected  = $null
        warnings           = @($nativeError)
    }
}

# ---- collectors\Processes.ps1 ----
function Get-DiagProcesses {
    param($Ctx)

    # Two snapshots one second apart to turn cumulative CPU time into a percentage.
    # Privacy: process NAMES only, aggregated; no path, no command line, no window title.
    function Snapshot {
        $h = @{}
        foreach ($p in Get-Process) {
            $cpu = 0.0; try { if ($null -ne $p.CPU) { $cpu = [double]$p.CPU } } catch { }
            $h[$p.Id] = @{ Name = $p.ProcessName; Cpu = $cpu; Ws = [long]$p.WorkingSet64 }
        }
        $h
    }

    $cores = [int]$env:NUMBER_OF_PROCESSORS; if ($cores -lt 1) { $cores = 1 }
    $t0 = Get-Date
    $a = Snapshot
    Start-Sleep -Milliseconds 1000
    $b = Snapshot
    $elapsed = (New-TimeSpan -Start $t0 -End (Get-Date)).TotalSeconds; if ($elapsed -le 0) { $elapsed = 1 }

    $byName = @{}
    foreach ($id in $b.Keys) {
        $n = $b[$id].Name
        if (-not $byName.ContainsKey($n)) { $byName[$n] = @{ Cpu = 0.0; Ws = 0L; Count = 0 } }
        $delta = if ($a.ContainsKey($id) -and $a[$id].Name -eq $n) { $(if ($b[$id].Cpu -gt $a[$id].Cpu) { [double]($b[$id].Cpu - $a[$id].Cpu) } else { 0.0 }) } else { 0.0 }
        $byName[$n].Cpu += $delta; $byName[$n].Ws += $b[$id].Ws; $byName[$n].Count++
    }

    $rows = @($byName.GetEnumerator() | ForEach-Object {
        New-Object psobject -Property @{
            name       = $_.Key
            instances  = $_.Value.Count
            cpuPercent = (Get-DiagRound (100 * $_.Value.Cpu / ($elapsed * $cores)) 1)
            memoryMB   = [int]($_.Value.Ws / 1MB)
        }
    })

    $shape = { param($r) [ordered]@{ name = $r.name; instances = $r.instances; cpuPercent = $r.cpuPercent; memoryMB = $r.memoryMB } }
    [ordered]@{
        processCount = $b.Count
        topCpu    = @($rows | Sort-Object cpuPercent -Descending | Select-Object -First 5 | ForEach-Object { & $shape $_ })
        topMemory = @($rows | Sort-Object memoryMB   -Descending | Select-Object -First 5 | ForEach-Object { & $shape $_ })
    }
}

# ---- collectors\Sampling.ps1 ----
function Get-DiagSampling {
    param($Ctx)

    Initialize-DiagNative
    $seconds = [int]$Ctx.SampleSeconds

    # LUID -> adapter name (the GPU counters only know adapters by LUID).
    $luidNames = @{}
    foreach ($a in Get-DiagDxAdapters) { if ($null -ne $a.Luid) { $luidNames[[uint64]$a.Luid] = $a.Description } }
    $appNames = @{}
    foreach ($app in $Ctx.Apps) { $appNames[([IO.Path]::GetFileNameWithoutExtension($app)).ToLower()] = $app }

    function Stats($values) {
        $v = @($values | Where-Object { $null -ne $_ })
        if ($v.Count -eq 0) { return $null }
        $m = $v | Measure-Object -Minimum -Maximum -Average
        [ordered]@{ min = [math]::Round($m.Minimum, 1); avg = [math]::Round($m.Average, 1); max = [math]::Round($m.Maximum, 1) }
    }

    $q = New-Object HostDiag.Sys.PdhQuery
    try {
        # English counter paths on purpose: PDH resolves them on any Windows language.
        [void]$q.Add('cpuUtil', '\Processor Information(_Total)\% Processor Utility')
        [void]$q.Add('cpuTime', '\Processor Information(_Total)\% Processor Time')
        [void]$q.Add('cpuPerf', '\Processor Information(_Total)\% Processor Performance')
        [void]$q.Add('cpuFreq', '\Processor Information(_Total)\Processor Frequency')
        [void]$q.Add('memAvail', '\Memory\Available MBytes')
        [void]$q.Add('gpuEngine', '\GPU Engine(*)\Utilization Percentage')
        [void]$q.Add('gpuMem', '\GPU Adapter Memory(*)\Dedicated Usage')

        $series = [ordered]@{ cpuPercent = @(); cpuPerformancePercent = @(); cpuMHz = @(); memoryAvailableMB = @() }
        $gpuAdapterSeries = @{}     # adapter name -> values
        $gpuVramSeries    = @{}     # adapter name -> MB
        $gpuAppSeries     = @{}     # "app.exe @ adapter" -> values
        $pidNames         = @{}     # pid -> process name (cache)

        $q.Collect()                # rate counters need a first baseline
        for ($i = 0; $i -lt $seconds; $i++) {
            Start-Sleep -Milliseconds 1000
            $q.Collect()

            $cpu = $q.Read('cpuUtil'); if (-not $cpu.Count) { $cpu = $q.Read('cpuTime') }
            if ($cpu.Count) { $series.cpuPercent += [math]::Round([math]::Min(100, $cpu[0].Value), 1) }
            $perf = $q.Read('cpuPerf'); $freq = $q.Read('cpuFreq')
            if ($perf.Count) {
                # < 100 = the CPU runs below its nominal clock (power saving or thermal throttling); > 100 = turbo.
                $series.cpuPerformancePercent += [math]::Round($perf[0].Value, 1)
                if ($freq.Count) { $series.cpuMHz += [int]($freq[0].Value * $perf[0].Value / 100) }
            }
            $mem = $q.Read('memAvail'); if ($mem.Count) { $series.memoryAvailableMB += [int]$mem[0].Value }

            # GPU engines. Instance: pid_<pid>_luid_0x<hi>_0x<lo>_phys_0_eng_<n>_engtype_<type>
            $perAdapterType = @{}; $perAppType = @{}
            foreach ($s in $q.Read('gpuEngine')) {
                if ($s.Instance -notmatch '^pid_(\d+)_luid_0x([0-9A-Fa-f]+)_0x([0-9A-Fa-f]+)_(phys_\d+_eng_\d+)_engtype_') { continue }
                $luid = ([uint64][Convert]::ToUInt32($Matches[2], 16) -shl 32) -bor [Convert]::ToUInt32($Matches[3], 16)
                $adapter = if ($luidNames.ContainsKey($luid)) { $luidNames[$luid] } else { 'luid:0x{0:X}' -f $luid }
                $type = $Matches[4]      # one physical engine (several engines can share a type)
                $k = "$adapter|$type"
                $perAdapterType[$k] = [double]$perAdapterType[$k] + $s.Value
                $procId = [int]$Matches[1]
                if (-not $pidNames.ContainsKey($procId)) {      # resolve each pid once, not the whole process list every second
                    $pidNames[$procId] = ''
                    try { $pidNames[$procId] = (Get-Process -Id $procId -ErrorAction Stop).ProcessName.ToLower() } catch { }
                }
                $pname = $pidNames[$procId]
                if ($pname -and $appNames.ContainsKey($pname)) {
                    $k2 = "$($appNames[$pname]) @ $adapter|$type"
                    $perAppType[$k2] = [double]$perAppType[$k2] + $s.Value
                }
            }
            # Same rule as Task Manager: sum the processes per ENGINE, then usage of an adapter = its busiest engine.
            foreach ($group in @(@{ src = $perAdapterType; dst = $gpuAdapterSeries }, @{ src = $perAppType; dst = $gpuAppSeries })) {
                $best = @{}
                foreach ($k in $group.src.Keys) {
                    $name = $k.Substring(0, $k.LastIndexOf('|'))
                    if (-not $best.ContainsKey($name) -or $group.src[$k] -gt $best[$name]) { $best[$name] = $group.src[$k] }
                }
                foreach ($name in $best.Keys) {
                    if (-not $group.dst.ContainsKey($name)) { $group.dst[$name] = @() }
                    $group.dst[$name] += [math]::Round([math]::Min(100, $best[$name]), 1)
                }
            }

            foreach ($s in $q.Read('gpuMem')) {
                if ($s.Instance -notmatch 'luid_0x([0-9A-Fa-f]+)_0x([0-9A-Fa-f]+)') { continue }
                $luid = ([uint64][Convert]::ToUInt32($Matches[1], 16) -shl 32) -bor [Convert]::ToUInt32($Matches[2], 16)
                $adapter = if ($luidNames.ContainsKey($luid)) { $luidNames[$luid] } else { 'luid:0x{0:X}' -f $luid }
                if (-not $gpuVramSeries.ContainsKey($adapter)) { $gpuVramSeries[$adapter] = @() }
                $gpuVramSeries[$adapter] += [int]($s.Value / 1MB)
            }
        }

        $gpuAdapters = @($gpuAdapterSeries.Keys | Sort-Object | ForEach-Object {
            [ordered]@{ adapter = $_; usagePercent = Stats $gpuAdapterSeries[$_]; dedicatedMemoryMB = Stats $gpuVramSeries[$_]; series = $gpuAdapterSeries[$_] }
        })
        # Which GPU each app of interest really uses. An app missing here did no GPU work during the window.
        $gpuApps = @($gpuAppSeries.Keys | Sort-Object | ForEach-Object {
            $parts = $_ -split ' @ ', 2
            [ordered]@{ app = $parts[0]; adapter = $parts[1]; usagePercent = Stats $gpuAppSeries[$_]; samples = $gpuAppSeries[$_].Count }
        })

        $underLoadPerf = @(); $underLoadMHz = @()
        $n = [math]::Min([math]::Min($series.cpuPercent.Count, $series.cpuPerformancePercent.Count), $series.cpuMHz.Count)
        for ($k = 0; $k -lt $n; $k++) {
            if ($series.cpuPercent[$k] -ge 50) { $underLoadPerf += $series.cpuPerformancePercent[$k]; $underLoadMHz += $series.cpuMHz[$k] }
        }

        [ordered]@{
            seconds               = $seconds
            cpuPercent            = Stats $series.cpuPercent
            cpuPerformancePercent = Stats $series.cpuPerformancePercent
            cpuMHz                = Stats $series.cpuMHz
            # Same two metrics restricted to the seconds where the CPU was busy (>= 50 %): a low clock at idle
            # is normal power saving, a low clock UNDER LOAD is throttling. null = the CPU was never busy.
            cpuPerformancePercentUnderLoad = Stats $underLoadPerf
            cpuMHzUnderLoad       = Stats $underLoadMHz
            underLoadSamples      = @($underLoadPerf).Count
            memoryAvailableMB     = Stats $series.memoryAvailableMB
            gpuAdapters           = $gpuAdapters
            gpuApps               = $gpuApps
            series                = $series
            counterErrors         = $q.Errors
        }
    }
    finally { $q.Dispose() }
}

# ---- collectors\System.ps1 ----
function Get-DiagSystem {
    param($Ctx)

    $os  = Get-CimInstance Win32_OperatingSystem
    $cs  = Get-CimInstance Win32_ComputerSystem
    $cpu = @(Get-CimInstance Win32_Processor)[0]

    $ubr = $null
    try { $ubr = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').UBR } catch { }

    # Laptop detection: no single source is reliable (mini PCs, USB UPS seen as a battery...),
    # so expose the three raw hints and a majority vote.
    $laptopChassis = 8, 9, 10, 11, 12, 14, 18, 21, 30, 31, 32
    $chassis = @()
    try { $chassis = @((Get-CimInstance Win32_SystemEnclosure).ChassisTypes | ForEach-Object { [int]$_ }) } catch { }
    $hasBattery = $false
    try { $hasBattery = @(Get-CimInstance Win32_Battery).Count -gt 0 } catch { }

    $hintChassis = @($chassis | Where-Object { $laptopChassis -contains $_ }).Count -gt 0
    $hintPcType  = [int]$cs.PCSystemType -eq 2          # 2 = Mobile
    $votes = @($hintChassis, $hintPcType, $hasBattery | Where-Object { $_ }).Count

    $sysDrive = $null
    try {
        $d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'"
        $sysDrive = [ordered]@{ sizeGB = (Get-DiagRound ($d.Size / 1GB) 1); freeGB = (Get-DiagRound ($d.FreeSpace / 1GB) 1) }
    } catch { }

    [ordered]@{
        os = [ordered]@{
            caption      = $os.Caption
            version      = $os.Version
            build        = if ($ubr) { "$($os.BuildNumber).$ubr" } else { "$($os.BuildNumber)" }
            architecture = $os.OSArchitecture
            # With Windows "fast startup", a shutdown does not reset this: weeks of uptime are common.
            uptimeHours  = (Get-DiagRound (((Get-Date) - $os.LastBootUpTime).TotalHours) 1)
        }
        cpu = [ordered]@{
            name         = "$($cpu.Name)".Trim()
            cores        = [int]$cpu.NumberOfCores
            threads      = [int]$cpu.NumberOfLogicalProcessors
            maxClockMHz  = [int]$cpu.MaxClockSpeed
        }
        isLaptop = $votes -ge 2
        laptopHints = [ordered]@{
            chassisTypes      = $chassis
            chassisIsPortable = $hintChassis
            pcSystemType      = [int]$cs.PCSystemType
            pcSystemIsMobile  = $hintPcType
            hasBattery        = $hasBattery
        }
        systemDrive = $sysDrive
    }
}

#endregion

# ------------------------------------------------------------
# Shared helpers (available to every collector)
# ------------------------------------------------------------

# Compiles the C# helpers once. Throws a clear error where Add-Type is blocked: native
# collectors then report "error" (or use their fallback) and the others keep working.
$script:NativeState = $null
function Initialize-DiagNative {
    if ($script:NativeState -eq 'ok') { return }
    if ($script:NativeState) { throw $script:NativeState }
    try {
        if (-not ('HostDiag.Sys.Power' -as [type])) {
            Add-Type -Language CSharp -TypeDefinition ($script:NativeSources -join "`n")
        }
        [HostDiag.Sys.Runtime]::DisableCrashDialogs()      # a native crash must not pop a Windows error box
        $script:NativeState = 'ok'
    } catch {
        $script:NativeState = "Native helpers unavailable (LanguageMode=$($ExecutionContext.SessionState.LanguageMode)): $($_.Exception.Message)"
        throw $script:NativeState
    }
}

# GPU list from CIM, shared by several collectors.
$script:VideoControllers = $null
function Get-DiagVideoControllers {
    if ($null -eq $script:VideoControllers) { $script:VideoControllers = @(Get-CimInstance Win32_VideoController) }
    return $script:VideoControllers
}

function Write-DiagProgress([string]$Text) {
    if (-not $Quiet -and -not $StdoutJson) { Write-Host $Text }
}

# Rounding without [math] (method calls are forbidden in Constrained Language Mode; casts are not).
function Get-DiagRound($Value, [int]$Decimals = 1) {
    if ($null -eq $Value) { return $null }
    $m = 1; for ($i = 0; $i -lt $Decimals; $i++) { $m *= 10 }
    return ([long]([double]$Value * $m)) / $m
}

function Get-DiagElapsedMs($since) {
    try { return [int](New-TimeSpan -Start $since -End (Get-Date)).TotalMilliseconds } catch { return 0 }
}

# Privacy: error texts and notes come from exceptions and may quote user paths. Every string
# leaving a collector goes through this. Operators only (works in Constrained Language Mode).
# Two independent jobs, split on purpose (see Protect-DiagObject):
#   Protect-DiagPaths - rewrites a user path to a token. Only a string holding '\' or '%' can
#                       contain one, so that test is a sound fast path for THIS half.
#   Protect-DiagWords - redacts the bare user name / machine name. Those appear in plain prose
#                       ("access denied for mathieu"), in a device name, in a profile name: no
#                       backslash and no percent in sight, so this half must run on EVERY string.
$script:ScrubPairs = @()
foreach ($pair in @(
        @($env:LOCALAPPDATA, '%LOCALAPPDATA%'), @($env:APPDATA, '%APPDATA%'), @($env:TEMP, '%TEMP%'),
        @($env:USERPROFILE, '%USERPROFILE%'), @($(if ($SelfPath) { Split-Path -Parent $SelfPath }), '%SCRIPTDIR%'))) {
    if ($pair[0]) { $script:ScrubPairs += , @(($pair[0] -replace '([\\\.\^\$\|\?\*\+\(\)\[\]\{\}])', '\$1'), $pair[1]) }
}
# Built once: a per-string rebuild of these two patterns would run on every scrubbed value.
$script:ScrubWords = @()
foreach ($word in @($env:USERNAME, $env:COMPUTERNAME)) {
    if ($word -and $word.Length -ge 3) { $script:ScrubWords += ('(?i)\b' + ($word -replace '([\\\.\^\$\|\?\*\+\(\)\[\]\{\}])', '\$1') + '\b') }
}
function Protect-DiagPaths([string]$Text) {
    if (-not $Text) { return $Text }
    foreach ($pair in $script:ScrubPairs) { $Text = $Text -replace $pair[0], $pair[1] }
    return ($Text -replace '(?i)[a-z]:\\Users\\[^\\''"<>|:*?\r\n]+', '%USERPROFILE%')
}
function Protect-DiagWords([string]$Text) {
    if (-not $Text) { return $Text }
    foreach ($re in $script:ScrubWords) { $Text = $Text -replace $re, '%REDACTED%' }
    return $Text
}
# The full scrub, in that order: rewrite the paths first, then redact whatever bare word
# survived. What every error message and note goes through.
function Protect-DiagText([string]$Text) {
    return (Protect-DiagWords (Protect-DiagPaths $Text))
}
function Protect-DiagObject($Value, [int]$Depth = 0) {
    if ($null -eq $Value -or $Depth -gt 12) { return $Value }
    # Every string gets the bare-word redaction; only a path-shaped one pays for the rewrites.
    if ($Value -is [string]) { if ($Value -match '\\|%') { return (Protect-DiagText $Value) } else { return (Protect-DiagWords $Value) } }
    if ($Value -is [System.Collections.IDictionary]) {
        foreach ($k in @($Value.Keys)) { $Value[$k] = Protect-DiagObject $Value[$k] ($Depth + 1) }
        return $Value
    }
    if ($Value -is [array]) {
        for ($i = 0; $i -lt $Value.Count; $i++) { $Value[$i] = Protect-DiagObject $Value[$i] ($Depth + 1) }
        return , $Value
    }
    return $Value
}

# ------------------------------------------------------------
# Collector registry. Order = order in the report.
#   Phase    : 1 (default) runs in parallel; 2 and 3 run alone afterwards so that
#              processes/sampling do not measure our own workers.
#   Condition: scriptblock returning $null (run) or a skip reason. Evaluated inside the worker
#              (it may query WMI, which can hang) unless ConditionIsCheap.
# ------------------------------------------------------------
$Registry = @(
    @{ Name = 'system';    Fn = 'Get-DiagSystem' }
    @{ Name = 'power';     Fn = 'Get-DiagPower' }
    @{ Name = 'memory';    Fn = 'Get-DiagMemory' }
    @{ Name = 'gpu';       Fn = 'Get-DiagGpu' }
    @{ Name = 'display';   Fn = 'Get-DiagDisplay' }
    @{ Name = 'browsers';  Fn = 'Get-DiagBrowsers' }
    @{ Name = 'processes'; Fn = 'Get-DiagProcesses'; Phase = 2 }
    @{ Name = 'nvidia';    Fn = 'Get-DiagNvidia'
       Condition = { if (-not (Get-DiagVideoControllers | Where-Object { $_.PNPDeviceID -match 'VEN_10DE' })) { 'no NVIDIA GPU detected' } } }
    @{ Name = 'sampling';  Fn = 'Get-DiagSampling'; Phase = 3; ConditionIsCheap = $true
       Condition = { if ($Mode -ne 'Sample') { 'snapshot mode' } } }
)
$MaxParallel = 4      # more concurrent PowerShell + C# compilations would choke slow laptops

$Ctx = @{ Apps = $Apps; Mode = $Mode; SampleSeconds = $SampleSeconds }

# ------------------------------------------------------------
# Running ONE collector (used in-process and by worker processes)
# ------------------------------------------------------------
function Invoke-DiagCollector($c) {
    $entry = [ordered]@{ status = 'ok'; durationMs = 0; error = $null; errorType = $null; data = $null }
    $t0 = Get-Date
    try {
        $reason = $null
        if ($c.Condition) { $reason = & $c.Condition }
        if ($reason) { $entry.status = 'skipped'; $entry.error = "$reason" }
        else { $entry.data = Protect-DiagObject (& $c.Fn $Ctx) }
    } catch {
        $entry.status = 'error'
        $entry.data   = $null
        $entry.error  = Protect-DiagText "$($_.Exception.Message)"
        # Messages are localized; the exception type is what a server can match on.
        try { $entry.errorType = $_.Exception.GetType().Name } catch { $entry.errorType = "$($_.FullyQualifiedErrorId)" }
    }
    $entry.durationMs = Get-DiagElapsedMs $t0
    return $entry
}

# ------------------------------------------------------------
# Worker mode: run one collector and hand the result back through a file.
# (Not through stdout: a grandchild such as csc.exe can keep that pipe open.)
# ------------------------------------------------------------
if ($Worker) {
    if ($ParentPid -gt 0) {
        # Die with the parent (Electron killed the tool, console closed...). Runs on its own thread,
        # so it works even while the collector is stuck in a blocking call.
        try {
            $watchdog = [powershell]::Create()
            [void]$watchdog.AddScript('param($id) while (Get-Process -Id $id -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 2 }; [Environment]::Exit(3)').AddArgument($ParentPid)
            [void]$watchdog.BeginInvoke()
        } catch { }
    }
    $c = $Registry | Where-Object { $_.Name -eq $Worker } | Select-Object -First 1
    $entry = if ($c) { Invoke-DiagCollector $c } else { [ordered]@{ status = 'error'; durationMs = 0; error = "unknown collector '$Worker'"; errorType = $null; data = $null } }
    try { $text = $entry | ConvertTo-Json -Depth 12 -Compress }
    catch { $text = ([ordered]@{ status = 'error'; durationMs = $entry.durationMs; error = 'result serialization failed'; errorType = $null; data = $null } | ConvertTo-Json -Compress) }
    try {
        if ($ResultFile) { [IO.File]::WriteAllText($ResultFile, $text, (New-Object Text.UTF8Encoding($false))) }
        else { Write-Output $text }
    } catch { Write-Output $text }
    exit 0
}

# ------------------------------------------------------------
# Stale worker residue. Complete-DiagWorker deletes each fragment in its finally block, but a
# run the caller KILLED (Electron's 120 s cap, the console closed, a reboot) never reaches it,
# and %TEMP%\hostdiag-<guid>-<collector>.json is left behind. Orchestrator only, once, and
# strictly older than 10 minutes so a concurrent run's live fragments are never touched.
# Entirely best-effort: a locked file, a redirected TEMP, a missing folder all just mean the
# residue stays, which costs a few KB and nothing else.
# ------------------------------------------------------------
try {
    $staleBefore = (Get-Date) - (New-TimeSpan -Minutes 10)
    foreach ($old in @(Get-ChildItem -LiteralPath $env:TEMP -Filter 'hostdiag-*.json' -File -Force -ErrorAction SilentlyContinue)) {
        if ($old.LastWriteTime -lt $staleBefore) { Remove-Item -LiteralPath $old.FullName -Force -ErrorAction SilentlyContinue }
    }
} catch { }

# ------------------------------------------------------------
# Isolation: each collector runs in its own child process with a timeout, so that a native
# crash (access violation inside a driver DLL) or a hang (stuck WMI query) only loses THAT
# collector. try/catch alone cannot protect against those two.
# Not available in Constrained Language Mode -> collectors run in-process there.
# ------------------------------------------------------------
$HostExe = $null
try { $HostExe = (Get-Process -Id $PID).Path } catch { }
$Isolate = $FullLanguage -and (-not $InProcess) -and $SelfPath -and $HostExe

function Start-DiagWorker($c) {
    $appsArg = if ($Apps.Count) { $Apps -join ',' } else { '_none_' }
    $result  = Join-Path $env:TEMP ("hostdiag-{0}-{1}.json" -f [guid]::NewGuid().ToString('N'), $c.Name)
    $psi = New-Object Diagnostics.ProcessStartInfo
    $psi.FileName  = $HostExe
    $psi.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$SelfPath`" -Worker $($c.Name) -ResultFile `"$result`" -ParentPid $PID -Apps `"$appsArg`" -Mode $Mode -SampleSeconds $SampleSeconds"
    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $psi.RedirectStandardError = $true
    $p = [Diagnostics.Process]::Start($psi)
    $seconds = if ($c.Name -eq 'sampling') { $SampleSeconds + $CollectorTimeoutSeconds } else { $CollectorTimeoutSeconds }
    @{ Collector = $c; Process = $p; Started = Get-Date; TimeoutMs = 1000 * $seconds; ResultFile = $result
       Err = $p.StandardError.ReadToEndAsync() }      # async read: no pipe deadlock
}

# Turns a finished/expired worker into @{ Entry = <object>; Raw = <json text or $null> }.
function Complete-DiagWorker($w, [bool]$timedOut) {
    $ms = Get-DiagElapsedMs $w.Started
    $fail = { param($msg, $type) @{ Raw = $null; Entry = [ordered]@{ status = 'error'; durationMs = $ms; error = (Protect-DiagText $msg); errorType = $type; data = $null } } }
    try {
        if ($timedOut) {
            try { $w.Process.Kill() } catch { }
            return & $fail "timeout: collector killed after $([int]($w.TimeoutMs / 1000)) s" 'Timeout'
        }
        $w.Process.WaitForExit()
        $out = ''
        try { if (Test-Path $w.ResultFile) { $out = [IO.File]::ReadAllText($w.ResultFile).Trim() } } catch { }
        if ($out.StartsWith('{') -and $out.EndsWith('}')) {
            try { return @{ Raw = $out; Entry = ($out | ConvertFrom-Json) } } catch { }
        }
        $err = ''
        try { if ($w.Err.Wait(500)) { $err = "$($w.Err.Result)".Trim() } } catch { }
        if ($err.Length -gt 300) { $err = $err.Substring(0, 300) }
        return & $fail ("collector process crashed (exit code {0}) {1}" -f $w.Process.ExitCode, $err).Trim() 'WorkerCrash'
    } catch {
        return & $fail "worker handling failed: $($_.Exception.Message)" 'WorkerHandling'
    } finally {
        try { $w.Process.Dispose() } catch { }
        try { if (Test-Path $w.ResultFile) { Remove-Item $w.ResultFile -Force } } catch { }
    }
}

# ------------------------------------------------------------
# Main. Whatever happens, a JSON document comes out.
# ------------------------------------------------------------
# The report's machine label. NOT derived from the computer name: a truncated SHA-256 of a
# name is a pseudonym anyone can reverse by hashing a dictionary of plausible names (and the
# default Windows name is DESKTOP-<7 chars> from a tiny alphabet), and this file is mailed to
# a stranger. A fresh random code per report tells a reader nothing about the machine, which
# is all that is wanted here: two reports from one player are correlated by the session code
# the game already sends, not by this field.
$computer = 'pc-unknown'
try {
    $computer = if ($NoAnonymize) { $env:COMPUTERNAME } else {
        'pc-' + (("$(New-Guid)" -replace '-', '') -replace '^(.{10}).*$', '$1')
    }
} catch { }

$warnings = @()
$known = @($Registry | ForEach-Object { $_.Name })
foreach ($n in @($Only) + @($Skip)) { if ($known -notcontains $n) { $warnings += "unknown collector name '$n' in -Only/-Skip" } }
if (-not $FullLanguage) { $warnings += 'restricted PowerShell language mode: no process isolation, native collectors unavailable' }

$report = [ordered]@{
    schemaVersion = $SchemaVersion
    tool          = [ordered]@{ name = 'host-diag'; version = $ToolVersion }
    generatedAt   = Get-Date -Format 'o'
    mode          = $Mode
    computer      = $computer
    apps          = $Apps
    host          = [ordered]@{
        powershell   = "$($PSVersionTable.PSVersion)"
        bitness      = if ($env:PROCESSOR_ARCHITECTURE -eq 'x86') { 32 } else { 64 }
        languageMode = "$($ExecutionContext.SessionState.LanguageMode)"
        culture      = "$((Get-Culture).Name)"
        isolation    = if ($Isolate) { 'process' } else { 'none' }
    }
    warnings      = $warnings
    fatalError    = $null
    collectors    = [ordered]@{}
}
$entries = [ordered]@{}     # name -> entry object (for the summary and the exit code)
$rawJson = @{}              # name -> JSON text produced by a worker, spliced as-is into the report

function Register-DiagResult($name, $entry, $raw) {
    $entries[$name] = $entry
    if ($raw) { $rawJson[$name] = $raw }
    Write-DiagProgress ("[{0,-10}] {1,-8} {2,6} ms  {3}" -f $name, $entry.status, $entry.durationMs, $entry.error)
}

try {
    $todo = @()
    foreach ($c in $Registry) {
        $reason = $null
        if     ($Only.Count -and $Only -notcontains $c.Name) { $reason = 'not selected (-Only)' }
        elseif ($Skip -contains $c.Name)                     { $reason = 'excluded (-Skip)' }
        elseif ($c.Condition -and $c.ConditionIsCheap) { try { $reason = & $c.Condition } catch { $reason = $null } }
        if ($reason) { Register-DiagResult $c.Name ([ordered]@{ status = 'skipped'; durationMs = 0; error = "$reason"; errorType = $null; data = $null }) $null }
        else { $todo += $c }
    }

    foreach ($phase in 1, 2, 3) {
        $queue = @($todo | Where-Object { $p = if ($_.Phase) { $_.Phase } else { 1 }; $p -eq $phase })
        $workers = @()
        while ($queue.Count -or $workers.Count) {
            while ($queue.Count -and $workers.Count -lt $MaxParallel) {
                $c = $queue[0]
                $queue = @($queue | Select-Object -Skip 1)
                $started = $null
                if ($Isolate) { try { $started = Start-DiagWorker $c } catch { $started = $null } }
                if ($started) { $workers += $started }
                else { Register-DiagResult $c.Name (Invoke-DiagCollector $c) $null }     # isolation unavailable: run here
            }
            $still = @()
            foreach ($w in $workers) {
                $expired = (Get-DiagElapsedMs $w.Started) -gt $w.TimeoutMs
                if ($w.Process.HasExited -or $expired) {
                    $r = Complete-DiagWorker $w ($expired -and -not $w.Process.HasExited)
                    Register-DiagResult $w.Collector.Name $r.Entry $r.Raw
                } else { $still += $w }
            }
            $workers = $still
            if ($workers.Count) { Start-Sleep -Milliseconds 100 }
        }
    }
} catch {
    $report.fatalError = Protect-DiagText "orchestrator: $($_.Exception.Message)"
}

# Keep registry order in the output, whatever the completion order was.
$failed = 0; $ran = 0
foreach ($c in $Registry) {
    $e = $entries[$c.Name]
    if (-not $e) { $e = [ordered]@{ status = 'error'; durationMs = 0; error = 'not run (orchestrator failure)'; errorType = $null; data = $null }; $entries[$c.Name] = $e }
    if ($e.status -eq 'ok') { $ran++ } elseif ($e.status -eq 'error') { $failed++ }
    $report.collectors[$c.Name] = if ($rawJson[$c.Name]) { "@@HOSTDIAG:$($c.Name)@@" } else { $e }
}
# 0 = all good, 1 = partial, 2 = nothing usable (includes "everything skipped", e.g. a typo in -Only).
$exit = if ($report.fatalError -or $ran -eq 0) { 2 } elseif ($failed -gt 0) { 1 } else { 0 }

$json = $null
try {
    $json = $report | ConvertTo-Json -Depth 12
    foreach ($name in @($rawJson.Keys)) { $json = $json -replace [regex]::Escape("`"@@HOSTDIAG:$name@@`""), ($rawJson[$name] -replace '\$', '$$$$') }
} catch {
    $exit = 2
    $json = '{"schemaVersion":' + $SchemaVersion + ',"fatalError":"report serialization failed","collectors":{}}'
}

function Write-DiagTextFile([string]$Path, $Lines) {
    if ($FullLanguage) { [IO.File]::WriteAllLines($Path, [string[]]@($Lines), (New-Object Text.UTF8Encoding($false))) }   # no BOM: friendlier to JSON.parse
    else { Set-Content -LiteralPath $Path -Value $Lines -Encoding UTF8 }
}

$written = $false
if (-not $StdoutJson) {
    # Asked folder, then the script folder, then %TEMP% (the script folder is read-only under Program Files).
    $candidates = @($OutDir, $(if ($SelfPath) { Split-Path -Parent $SelfPath }), $env:TEMP) | Where-Object { $_ } | Select-Object -Unique
    if ($OutDir) { $candidates = @($OutDir, $env:TEMP) | Select-Object -Unique }
    foreach ($dir in $candidates) {
        try {
            if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
            $base = Join-Path $dir ("host-diag-{0}-{1}" -f $computer, (Get-Date -Format 'yyyyMMdd-HHmmss'))
            Write-DiagTextFile "$base.json" $json
            Write-DiagProgress "Written: $base.json"
            $written = $true
            if ($Summary) {
                try {
                    $view = [ordered]@{ tool = $report.tool; generatedAt = $report.generatedAt; mode = $Mode; computer = $computer; warnings = $warnings; collectors = $entries }
                    Write-DiagTextFile "$base.txt" (Format-DiagSummary $view)
                    Write-DiagProgress "Written: $base.txt"
                } catch { Write-DiagProgress 'Summary failed.' }
            }
            break
        } catch { Write-DiagProgress "Cannot write to $dir" }
    }
}
if (-not $written) {
    # -StdoutJson, or nowhere to write: the JSON is the ONLY thing on stdout, after this marker line.
    if (-not $StdoutJson) { $exit = 2 }
    try { [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false) } catch { }
    if (-not $StdoutJson) { Write-Output '@@HOSTDIAG-JSON@@' }
    Write-Output $json
}
exit $exit
