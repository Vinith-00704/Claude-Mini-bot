// What the person sees while Claude controls the computer, besides the access bar at the top (which
// says what is going on and stops it when clicked): a frame around every monitor in the accent colour
// (amber while paused) and a ring on the spot a step is about to touch. Neither takes clicks (they pass
// through to what is under them) and neither is in the pictures Claude gets.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace MiniBot
{
    /// <summary>A window that is only there to be seen: on top, never focused, transparent to the mouse, left out of screen captures.</summary>
    class SeeThroughWindow : Form
    {
        const int WS_EX_TRANSPARENT = 0x20, WS_EX_TOPMOST = 0x8;

        public SeeThroughWindow()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            AutoScaleMode = AutoScaleMode.None;
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get
            {
                var p = base.CreateParams;
                p.ExStyle |= Native.WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE;
                return p;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Native.SetWindowDisplayAffinity(Handle, Native.WDA_EXCLUDEFROMCAPTURE);
        }
    }

    class ControlFrame : IDisposable
    {
        const int Thickness = 4;
        readonly List<SeeThroughWindow> edges = new List<SeeThroughWindow>();
        readonly List<Rectangle> edgeBounds = new List<Rectangle>();
        readonly SeeThroughWindow ring = new SeeThroughWindow();
        readonly Timer ringTimer = new Timer();
        bool paused;
        Color accent = Color.FromArgb(215, 119, 87);
        static readonly Color Amber = Color.FromArgb(232, 170, 40);
        string screensKey = "";

        public ControlFrame()
        {
            ring.Opacity = 0.9;
            ringTimer.Tick += delegate { ringTimer.Stop(); ring.Hide(); };
        }

        public bool IsShown { get; private set; }

        /// <summary>Shows the frame, or brings it up to date.</summary>
        public void Show(bool isPaused, Color accentColor)
        {
            paused = isPaused;
            accent = accentColor;
            string key = string.Join(";", Array.ConvertAll(Screen.AllScreens, s => s.Bounds.ToString()));
            if (key != screensKey) { BuildEdges(); screensKey = key; }
            var color = paused ? Amber : accent;
            for (int i = 0; i < edges.Count; i++)
            {
                var e = edges[i];
                if (e.BackColor != color) e.BackColor = color;
                if (e.Visible) continue;
                // Sized once shown: a window made with its size given first is held to a dozen pixels or more.
                e.Show();
                e.Bounds = edgeBounds[i];
            }
            IsShown = true;
        }

        public void Hide()
        {
            foreach (var e in edges) e.Hide();
            ring.Hide();
            IsShown = false;
        }

        void BuildEdges()
        {
            foreach (var e in edges) e.Dispose();
            edges.Clear();
            edgeBounds.Clear();
            foreach (var screen in Screen.AllScreens)
            {
                var b = screen.Bounds;
                foreach (var r in new[]
                {
                    new Rectangle(b.X, b.Y, b.Width, Thickness), new Rectangle(b.X, b.Bottom - Thickness, b.Width, Thickness),
                    new Rectangle(b.X, b.Y, Thickness, b.Height), new Rectangle(b.Right - Thickness, b.Y, Thickness, b.Height),
                })
                {
                    edges.Add(new SeeThroughWindow { Bounds = r, Opacity = 0.85, BackColor = accent });
                    edgeBounds.Add(r);
                }
            }
        }

        /// <summary>A ring on the spot a step will touch: kept while the person is asked, else briefly.</summary>
        public void Mark(Point at, bool hold)
        {
            int d = Ui.Px(46), t = Ui.Px(5);
            ring.Bounds = new Rectangle(at.X - d / 2, at.Y - d / 2, d, d);
            using (var outer = new GraphicsPath())
            {
                outer.AddEllipse(0, 0, d, d);
                outer.AddEllipse(t, t, d - 2 * t, d - 2 * t);   // the inner circle cuts the hole (alternate fill)
                ring.Region = new Region(outer);
            }
            ring.BackColor = accent;
            if (!ring.Visible) ring.Show();
            ringTimer.Stop();
            if (!hold)
            {
                ringTimer.Interval = 700;
                ringTimer.Start();
            }
        }

        public void Unmark()
        {
            ringTimer.Stop();
            if (ring.Visible) ring.Hide();
        }

        public void Dispose()
        {
            ringTimer.Dispose();
            foreach (var e in edges) e.Dispose();
            ring.Dispose();
        }
    }
}
