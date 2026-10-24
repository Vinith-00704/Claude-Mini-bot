// Takes the picture of the screen for a snip.
//
// The bot's own windows (the character, its panel, the access indicator) are
// left out of the picture with Windows' "exclude from capture" display affinity,
// so they stay on the monitor and never cover what is being captured. On a
// Windows that does not have that, they are hidden for the moment of the capture.
//
// It also notes where the other windows are, so a click can snip one whole window.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace MiniBot
{
    public class WindowArea
    {
        public Rectangle Bounds;
        public string Title;
    }

    public static class ScreenGrab
    {
        /// <summary>The whole desktop, across every monitor, in screen pixels.</summary>
        public static Rectangle Desktop { get { return SystemInformation.VirtualScreen; } }

        public static Bitmap Capture(IEnumerable<Form> keepOut)
        {
            var excluded = new List<IntPtr>();
            var hidden = new List<Form>();
            foreach (var form in keepOut)
            {
                if (form == null || form.IsDisposed || !form.IsHandleCreated || !form.Visible) continue;
                if (Native.SetWindowDisplayAffinity(form.Handle, Native.WDA_EXCLUDEFROMCAPTURE)) excluded.Add(form.Handle);
                else { form.Hide(); hidden.Add(form); }
            }
            try
            {
                // Let the desktop compositor draw one frame without them.
                Application.DoEvents();
                Native.DwmFlush();
                Thread.Sleep(hidden.Count > 0 ? 150 : 40);
                Native.DwmFlush();

                var area = Desktop;
                var shot = new Bitmap(area.Width, area.Height, PixelFormat.Format32bppArgb);
                using (var g = Graphics.FromImage(shot))
                    g.CopyFromScreen(area.Location, Point.Empty, area.Size, CopyPixelOperation.SourceCopy);
                return shot;
            }
            finally
            {
                foreach (var handle in excluded) Native.SetWindowDisplayAffinity(handle, Native.WDA_NONE);
                foreach (var form in hidden) form.Show();
            }
        }

        /// <summary>The visible windows of other programs, front to back, in screen pixels.</summary>
        public static List<WindowArea> Windows()
        {
            var list = new List<WindowArea>();
            uint own = (uint)Process.GetCurrentProcess().Id;
            Native.EnumWindows(delegate (IntPtr hwnd, IntPtr unused)
            {
                if (!Native.IsWindowVisible(hwnd) || Native.IsIconic(hwnd)) return true;
                uint pid;
                Native.GetWindowThreadProcessId(hwnd, out pid);
                if (pid == own) return true;
                int cloaked;
                if (Native.DwmGetWindowAttribute(hwnd, Native.DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;
                int length = Native.GetWindowTextLength(hwnd);
                if (length == 0) return true;
                var title = new StringBuilder(length + 1);
                Native.GetWindowText(hwnd, title, title.Capacity);
                Native.RECT r;
                if (Native.DwmGetWindowAttribute(hwnd, Native.DWMWA_EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(Native.RECT))) != 0)
                    Native.GetWindowRect(hwnd, out r);
                var bounds = Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
                if (bounds.Width < 40 || bounds.Height < 40) return true;
                list.Add(new WindowArea { Bounds = bounds, Title = title.ToString() });
                return true;
            }, IntPtr.Zero);
            return list;
        }
    }
}
