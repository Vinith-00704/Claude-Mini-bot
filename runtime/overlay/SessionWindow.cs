// The console window of Mini's own Claude Code session, which nobody normally sees. The person can bring it up from
// the bot's menu, and it comes up by itself when the session has been silent long enough that it may be waiting for
// them (a first-time trust question, a sign-in). Only this one window is ever touched.

using System;
using System.Runtime.InteropServices;
using System.Text;

namespace MiniBot
{
    static class SessionWindow
    {
        const uint TH32CS_SNAPPROCESS = 2;
        const int SW_HIDE = 0, SW_SHOWNORMAL = 1;
        const uint SWP_NOSIZE = 1, SWP_NOMOVE = 2, SWP_SHOWWINDOW = 0x40;
        static readonly IntPtr HWND_TOPMOST = new IntPtr(-1), HWND_NOTOPMOST = new IntPtr(-2);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct PROCESSENTRY32
        {
            public uint dwSize, cntUsage, th32ProcessID;
            public IntPtr th32DefaultHeapID;
            public uint th32ModuleID, cntThreads, th32ParentProcessID;
            public int pcPriClassBase;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
        }

        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref PROCESSENTRY32 entry);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref PROCESSENTRY32 entry);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd, StringBuilder name, int size);
        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);

        /// <summary>Whether this process is the session or the console host that belongs to it.</summary>
        static bool Belongs(uint pid, int session)
        {
            if (pid == (uint)session) return true;
            IntPtr snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if (snapshot == IntPtr.Zero || snapshot == new IntPtr(-1)) return false;
            try
            {
                var entry = new PROCESSENTRY32 { dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32)) };
                if (!Process32FirstW(snapshot, ref entry)) return false;
                do
                {
                    if (entry.th32ProcessID == pid) return entry.th32ParentProcessID == (uint)session;
                }
                while (Process32NextW(snapshot, ref entry));
                return false;
            }
            finally { CloseHandle(snapshot); }
        }

        /// <summary>The session's console window, shown or not; zero if there is none.</summary>
        public static IntPtr Find(int session)
        {
            if (session <= 0) return IntPtr.Zero;
            IntPtr found = IntPtr.Zero;
            var name = new StringBuilder(64);
            Native.EnumWindows(delegate (IntPtr hwnd, IntPtr unused)
            {
                name.Length = 0;
                GetClassNameW(hwnd, name, name.Capacity);
                if (name.ToString() != "ConsoleWindowClass") return true;
                uint pid;
                Native.GetWindowThreadProcessId(hwnd, out pid);
                if (!Belongs(pid, session)) return true;
                found = hwnd;
                return false;
            }, IntPtr.Zero);
            return found;
        }

        public static bool IsShown(int session)
        {
            IntPtr window = Find(session);
            return window != IntPtr.Zero && Native.IsWindowVisible(window);
        }

        public static bool Show(int session)
        {
            IntPtr window = Find(session);
            if (window == IntPtr.Zero) return false;
            Native.ShowWindow(window, SW_SHOWNORMAL);
            // Windows does not let a program in the background take the front. Being on top for a moment still puts it where it can be seen.
            SetWindowPos(window, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            SetWindowPos(window, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            Native.SetForegroundWindow(window);
            return true;
        }

        public static void Hide(int session)
        {
            IntPtr window = Find(session);
            if (window != IntPtr.Zero) Native.ShowWindow(window, SW_HIDE);
        }
    }
}
