// The floating character: a window with per-pixel transparency, so only the
// character is drawn and clicks on the empty corners pass through to whatever
// is underneath.
//
// Click and drag share one gesture: if the pointer moves past a small
// threshold the press becomes a drag and moves the window; otherwise releasing
// is a click. Right-click asks for the quick-actions menu.

using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace MiniBot
{
    /// <summary>A borderless window painted with a per-pixel alpha bitmap.</summary>
    public class LayeredForm : Form
    {
        public LayeredForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var p = base.CreateParams;
                p.ExStyle |= Native.WS_EX_LAYERED | Native.WS_EX_TOOLWINDOW;
                return p;
            }
        }

        public void SetBitmap(Bitmap bitmap, byte opacity)
        {
            if (!IsHandleCreated) return;
            IntPtr screenDc = Native.GetDC(IntPtr.Zero);
            IntPtr memDc = Native.CreateCompatibleDC(screenDc);
            IntPtr hBitmap = IntPtr.Zero;
            IntPtr old = IntPtr.Zero;
            try
            {
                hBitmap = bitmap.GetHbitmap(Color.FromArgb(0));
                old = Native.SelectObject(memDc, hBitmap);
                var size = new Native.SIZE { cx = bitmap.Width, cy = bitmap.Height };
                var source = new Native.POINT { x = 0, y = 0 };
                var blend = new Native.BLENDFUNCTION
                {
                    BlendOp = Native.AC_SRC_OVER, BlendFlags = 0, SourceConstantAlpha = opacity, AlphaFormat = Native.AC_SRC_ALPHA
                };
                Native.UpdateLayeredWindow(Handle, screenDc, IntPtr.Zero, ref size, memDc, ref source, 0, ref blend, Native.ULW_ALPHA);
            }
            finally
            {
                Native.ReleaseDC(IntPtr.Zero, screenDc);
                if (hBitmap != IntPtr.Zero)
                {
                    Native.SelectObject(memDc, old);
                    Native.DeleteObject(hBitmap);
                }
                Native.DeleteDC(memDc);
            }
        }
    }

    public class BotWindow : LayeredForm
    {
        public event Action Clicked;
        public event Action<Point> Dragged;
        public event Action<Point> MenuRequested;

        public Look Look = new Look();
        public string Phase = "idle";
        public bool Listening;
        public int Opacity100 = 100;
        public bool IsDragging { get; private set; }

        bool down;
        Point pressScreen;
        Point pressLocation;
        string lastKey = "";

        public BotWindow()
        {
            Text = "Mini Bot";
        }

        /// <summary>Redraws if anything visible changed or the character is animating.</summary>
        public void Redraw(double t, bool force)
        {
            bool animated = Painter.IsAnimated(Look, Phase, Listening);
            string key = Look.Avatar + Look.Skin + Look.Accent + Look.Name + Look.Size + Look.Idle + Look.Speed + Look.Reduced
                + Phase + Listening + Opacity100;
            if (!force && !animated && key == lastKey) return;
            lastKey = key;
            var size = Painter.WindowSize(Look);
            if (Size != size) Size = size;
            using (var bmp = Painter.RenderWindow(Look, Phase, Listening, t, true))
                SetBitmap(bmp, (byte)(255 * Math.Max(20, Math.Min(100, Opacity100)) / 100));
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button != MouseButtons.Left) return;
            down = true;
            IsDragging = false;
            pressScreen = PointToScreen(e.Location);
            pressLocation = Location;
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            if (!down) return;
            var now = PointToScreen(e.Location);
            int dx = now.X - pressScreen.X, dy = now.Y - pressScreen.Y;
            if (!IsDragging && Math.Abs(dx) + Math.Abs(dy) > Ui.Px(5)) IsDragging = true;
            if (IsDragging) Location = new Point(pressLocation.X + dx, pressLocation.Y + dy);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (e.Button == MouseButtons.Right)
            {
                if (MenuRequested != null) MenuRequested(PointToScreen(e.Location));
                return;
            }
            if (e.Button != MouseButtons.Left || !down) return;
            down = false;
            // If the window actually moved with the pointer it was a drag, whatever the flag says.
            if (Math.Abs(Location.X - pressLocation.X) + Math.Abs(Location.Y - pressLocation.Y) > Ui.Px(5)) IsDragging = true;
            if (IsDragging)
            {
                IsDragging = false;
                if (Dragged != null) Dragged(Location);
            }
            else if (Clicked != null) Clicked();
        }

        protected override void OnPaintBackground(PaintEventArgs e) { }
    }

    /// <summary>A small window that never takes the keyboard focus, for the access indicator.</summary>
    public class NoActivateForm : Form
    {
        public NoActivateForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                var p = base.CreateParams;
                p.ExStyle |= Native.WS_EX_NOACTIVATE | Native.WS_EX_TOOLWINDOW;
                return p;
            }
        }
    }
}
