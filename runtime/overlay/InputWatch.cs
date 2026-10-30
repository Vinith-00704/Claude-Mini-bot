// Notices the person taking over while Claude controls the computer: a real mouse movement, click,
// wheel turn or key press. It is installed only while control runs and removed as soon as it ends.
// It reads one thing about each input, whether it came from a device or was sent by a program (the
// bot's own carries its signature); which key it was, or where the mouse went, is never kept.

using System;
using System.Runtime.InteropServices;

namespace MiniBot
{
    class InputWatch : IDisposable
    {
        const int WH_KEYBOARD_LL = 13, WH_MOUSE_LL = 14;
        const int WM_MOUSEMOVE = 0x200, WM_KEYDOWN = 0x100, WM_SYSKEYDOWN = 0x104;
        const uint LLMHF_INJECTED = 0x1, LLKHF_INJECTED = 0x10;
        const int MoveThreshold = 24;   // pixels of real movement before it counts: a nudged desk is not a takeover

        delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        struct MSLLHOOKSTRUCT { public int x; public int y; public uint mouseData; public uint flags; public uint time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }

        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr SetWindowsHookEx(int id, HookProc proc, IntPtr module, uint thread);

        [DllImport("user32.dll")]
        static extern bool UnhookWindowsHookEx(IntPtr hook);

        [DllImport("user32.dll")]
        static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll")]
        static extern IntPtr GetModuleHandle(string name);

        /// <summary>The person moved the mouse, clicked or pressed a key. Raised once per arming, on the thread that installed the watch.</summary>
        public event Action TookOver;

        readonly HookProc mouseProc, keyProc;   // kept so the collector never frees what Windows calls
        IntPtr mouseHook = IntPtr.Zero, keyHook = IntPtr.Zero;
        bool armed;
        int lastX = int.MinValue, lastY;
        double travelled;

        public InputWatch()
        {
            mouseProc = OnMouse;
            keyProc = OnKey;
        }

        /// <summary>Installs the watch while control runs, or removes it.</summary>
        public void Install(bool on)
        {
            if (on && mouseHook == IntPtr.Zero)
            {
                IntPtr module = GetModuleHandle(null);
                mouseHook = SetWindowsHookEx(WH_MOUSE_LL, mouseProc, module, 0);
                keyHook = SetWindowsHookEx(WH_KEYBOARD_LL, keyProc, module, 0);
            }
            else if (!on) Remove();
            if (!on) armed = false;
        }

        /// <summary>Whether input now counts as a takeover: not while the person is answering the bot.</summary>
        public void Arm(bool on)
        {
            if (on && !armed) { travelled = 0; lastX = int.MinValue; }
            armed = on && mouseHook != IntPtr.Zero;
        }

        void Fire()
        {
            armed = false;
            if (TookOver != null) TookOver();
        }

        IntPtr OnMouse(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code >= 0 && armed && !ComputerHands.IsActing)
            {
                var info = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
                bool fromProgram = (info.flags & LLMHF_INJECTED) != 0 || info.dwExtraInfo == ComputerHands.Signature;
                if (!fromProgram)
                {
                    if (wParam.ToInt32() != WM_MOUSEMOVE) Fire();
                    else
                    {
                        if (lastX != int.MinValue) travelled += Math.Abs(info.x - lastX) + Math.Abs(info.y - lastY);
                        lastX = info.x; lastY = info.y;
                        if (travelled > MoveThreshold) Fire();
                    }
                }
            }
            return CallNextHookEx(mouseHook, code, wParam, lParam);
        }

        IntPtr OnKey(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code >= 0 && armed && !ComputerHands.IsActing)
            {
                int message = wParam.ToInt32();
                if (message == WM_KEYDOWN || message == WM_SYSKEYDOWN)
                {
                    var info = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
                    bool fromProgram = (info.flags & LLKHF_INJECTED) != 0 || info.dwExtraInfo == ComputerHands.Signature;
                    if (!fromProgram) Fire();
                }
            }
            return CallNextHookEx(keyHook, code, wParam, lParam);
        }

        void Remove()
        {
            if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
            if (keyHook != IntPtr.Zero) UnhookWindowsHookEx(keyHook);
            mouseHook = keyHook = IntPtr.Zero;
        }

        public void Dispose()
        {
            Remove();
        }
    }
}
