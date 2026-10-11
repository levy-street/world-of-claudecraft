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
