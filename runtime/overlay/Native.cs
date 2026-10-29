using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace MiniBot
{
    static class Native
    {
        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int x; public int y; }

        [StructLayout(LayoutKind.Sequential)]
        public struct SIZE { public int cx; public int cy; }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        public struct BLENDFUNCTION
        {
            public byte BlendOp;
            public byte BlendFlags;
            public byte SourceConstantAlpha;
            public byte AlphaFormat;
        }

        public const int ULW_ALPHA = 2;
        public const byte AC_SRC_OVER = 0;
        public const byte AC_SRC_ALPHA = 1;
        public const int WS_EX_LAYERED = 0x80000;
        public const int WS_EX_TOOLWINDOW = 0x80;
        public const int WS_EX_NOACTIVATE = 0x08000000;

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, IntPtr pptDst, ref SIZE psize,
            IntPtr hdcSrc, ref POINT pptSrc, int crKey, ref BLENDFUNCTION pblend, int dwFlags);

        [DllImport("user32.dll")]
        public static extern IntPtr GetDC(IntPtr hwnd);

        [DllImport("user32.dll")]
        public static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hwnd, int command);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hwnd);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hwnd);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint key);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool UnregisterHotKey(IntPtr hwnd, int id);

        // ---- screenshots ----

        /// <summary>Leaves a window out of every screen capture while it stays on the monitor (Windows 10 2004 and later).</summary>
        public const uint WDA_NONE = 0x0, WDA_EXCLUDEFROMCAPTURE = 0x11;

        [DllImport("user32.dll")]
        public static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint affinity);

        [DllImport("dwmapi.dll")]
        public static extern int DwmFlush();

        public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hwnd);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetWindowText(IntPtr hwnd, System.Text.StringBuilder text, int max);

        [DllImport("user32.dll")]
        public static extern int GetWindowTextLength(IntPtr hwnd);

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left, Top, Right, Bottom; }

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

        public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9, DWMWA_CLOAKED = 14;

        [DllImport("dwmapi.dll")]
        public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out RECT value, int size);

        [DllImport("dwmapi.dll")]
        public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);

        [DllImport("gdi32.dll")]
        public static extern IntPtr CreateCompatibleDC(IntPtr hdc);

        [DllImport("gdi32.dll")]
        public static extern bool DeleteDC(IntPtr hdc);

        [DllImport("gdi32.dll")]
        public static extern IntPtr SelectObject(IntPtr hdc, IntPtr hobject);

        [DllImport("gdi32.dll")]
        public static extern bool DeleteObject(IntPtr hobject);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct TEXTMETRIC
        {
            public int tmHeight, tmAscent, tmDescent, tmInternalLeading, tmExternalLeading, tmAveCharWidth, tmMaxCharWidth,
                tmWeight, tmOverhang, tmDigitizedAspectX, tmDigitizedAspectY;
            public char tmFirstChar, tmLastChar, tmDefaultChar, tmBreakChar;
            public byte tmItalic, tmUnderlined, tmStruckOut, tmPitchAndFamily, tmCharSet;
        }

        [DllImport("gdi32.dll", CharSet = CharSet.Unicode)]
        static extern bool GetTextMetrics(IntPtr hdc, out TEXTMETRIC metrics);

        /// <summary>
        /// The distance between two lines in an edit box. It is the font's height plus its external leading,
        /// which can be a pixel more than Font.Height; sizing a box by Font.Height would show one line too few.
        /// </summary>
        public static int LineHeight(Font font)
        {
            using (var g = Graphics.FromHwnd(IntPtr.Zero))
            {
                IntPtr hdc = g.GetHdc();
                IntPtr hfont = font.ToHfont();
                IntPtr previous = SelectObject(hdc, hfont);
                TEXTMETRIC tm;
                bool ok = GetTextMetrics(hdc, out tm);
                SelectObject(hdc, previous);
                DeleteObject(hfont);
                g.ReleaseHdc(hdc);
                return ok ? tm.tmHeight + tm.tmExternalLeading : font.Height;
            }
        }

        public const int EM_GETLINECOUNT = 0xBA;

        [DllImport("user32.dll", EntryPoint = "SendMessageW")]
        public static extern IntPtr SendMessageRaw(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam);

        /// <summary>How many lines (after word wrapping) a multi-line text box is showing.</summary>
        public static int LineCount(TextBox box)
        {
            return box.IsHandleCreated ? (int)SendMessageRaw(box.Handle, EM_GETLINECOUNT, IntPtr.Zero, IntPtr.Zero) : 1;
        }
    }
}
