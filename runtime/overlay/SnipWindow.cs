// The snipping tool, drawn in Claude Code's style.
//
// The screen is captured first (without the bot on it) and shown frozen and
// dimmed across every monitor. Drag to select an area, click to take a whole
// window, or press Enter for the screen under the pointer. The selection is shown
// at full brightness with an accent-coloured border, its size in the terminal
// font, and a small bar of actions: Ask Claude, Copy, Save, Cancel.
//
// Nothing leaves this window unless the person picks an action.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Windows.Forms;

namespace MiniBot
{
    public class SnipWindow : Form
    {
        public const string Ask = "ask", Copy = "copy", Save = "save";

        /// <summary>The cropped picture and what to do with it.</summary>
        public event Action<Bitmap, string> Finished;
        public event Action Cancelled;

        readonly Bitmap shot;
        readonly Bitmap dim;
        readonly Rectangle desktop;
        readonly List<WindowArea> windows = new List<WindowArea>();
        readonly Palette pal;
        readonly TextButton btnAsk = new TextButton("Ask Claude");
        readonly TextButton btnCopy = new TextButton("Copy");
        readonly TextButton btnSave = new TextButton("Save");
        readonly TextButton btnCancel = new TextButton("Cancel");
        readonly Font mono = Ui.Mono(9.5f);
        readonly Font monoBold = Ui.Mono(9.5f, FontStyle.Bold);
        Rectangle selection = Rectangle.Empty;
        WindowArea hover;
        bool dragging;
        Point dragStart;
        Rectangle actionsRect = Rectangle.Empty;
        bool done;

        public SnipWindow(Bitmap screen, Rectangle desktopBounds, List<WindowArea> others, Palette palette)
        {
            shot = screen;
            desktop = desktopBounds;
            pal = palette;
            foreach (var w in others)
            {
                var r = Rectangle.Intersect(w.Bounds, desktop);
                if (r.Width < 20 || r.Height < 20) continue;
                r.Offset(-desktop.X, -desktop.Y);
                windows.Add(new WindowArea { Bounds = r, Title = w.Title });
            }

            dim = new Bitmap(shot.Width, shot.Height);
            using (var g = Graphics.FromImage(dim))
            using (var veil = new SolidBrush(Color.FromArgb(150, 0, 0, 0)))
            {
                g.DrawImageUnscaled(shot, 0, 0);
                g.FillRectangle(veil, 0, 0, dim.Width, dim.Height);
            }

            Text = "Mini Bot screenshot";
            AccessibleName = "Mini Bot screenshot";
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            Bounds = desktop;
            BackColor = Color.Black;
            DoubleBuffered = true;
            KeyPreview = true;
            Cursor = Cursors.Cross;

            btnAsk.Primary = true;
            foreach (var b in new[] { btnAsk, btnCopy, btnSave, btnCancel })
            {
                b.Colors = pal;
                b.BackColor = Color.Black;
                b.Visible = false;
                b.Cursor = Cursors.Hand;
                Controls.Add(b);
            }
            btnAsk.Click += delegate { Finish(Ask); };
            btnCopy.Click += delegate { Finish(Copy); };
            btnSave.Click += delegate { Finish(Save); };
            btnCancel.Click += delegate { Cancel(); };
        }

        // ---- input ----

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button == MouseButtons.Right) { Cancel(); return; }
            if (e.Button != MouseButtons.Left) return;
            dragging = true;
            dragStart = e.Location;
            selection = Rectangle.Empty;
            ShowActions(false);
            Invalidate();
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            if (dragging)
            {
                selection = Rectangle.FromLTRB(
                    Math.Min(dragStart.X, e.X), Math.Min(dragStart.Y, e.Y),
                    Math.Max(dragStart.X, e.X), Math.Max(dragStart.Y, e.Y));
                Invalidate();
                return;
            }
            if (!selection.IsEmpty) return;
            WindowArea under = null;
            foreach (var w in windows)
                if (w.Bounds.Contains(e.Location)) { under = w; break; }
            if (under != hover) { hover = under; Invalidate(); }
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (e.Button != MouseButtons.Left || !dragging) return;
            dragging = false;
            if (selection.Width < 6 || selection.Height < 6)
            {
                // A click, not a drag: the window under the pointer.
                selection = hover != null ? hover.Bounds : Rectangle.Empty;
            }
            selection.Intersect(new Rectangle(Point.Empty, Size));
            ShowActions(!selection.IsEmpty);
            Invalidate();
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            base.OnKeyDown(e);
            if (e.KeyCode == Keys.Escape) { Cancel(); return; }
            if (e.KeyCode == Keys.Enter)
            {
                if (selection.IsEmpty)
                {
                    var screen = Screen.FromPoint(Cursor.Position).Bounds;
                    screen.Offset(-desktop.X, -desktop.Y);
                    selection = Rectangle.Intersect(screen, new Rectangle(Point.Empty, Size));
                }
                Finish(Ask);
            }
            else if (e.Control && e.KeyCode == Keys.C && !selection.IsEmpty) Finish(Copy);
            else if (e.Control && e.KeyCode == Keys.S && !selection.IsEmpty) Finish(Save);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            Activate();
            Native.SetForegroundWindow(Handle);
        }

        protected override void OnDeactivate(EventArgs e)
        {
            base.OnDeactivate(e);
            // Switching away (Alt+Tab, another window) gives up the snip rather than
            // leaving a frozen picture over the desktop.
            if (!done && !ContainsFocus && Form.ActiveForm == null) BeginInvoke(new Action(Cancel));
        }

        void ShowActions(bool show)
        {
            foreach (var b in new[] { btnAsk, btnCopy, btnSave, btnCancel }) b.Visible = show;
            if (!show) { actionsRect = Rectangle.Empty; return; }
            int h = Ui.Px(32), gap = Ui.Px(6), pad = Ui.Px(8);
            int[] widths = { Ui.Px(108), Ui.Px(64), Ui.Px(64), Ui.Px(76) };
            int total = pad * 2 + widths[0] + widths[1] + widths[2] + widths[3] + gap * 3;
            int barH = h + pad * 2;
            int x = Math.Max(Ui.Px(8), Math.Min(selection.Right - total, Width - total - Ui.Px(8)));
            int y = selection.Bottom + Ui.Px(10);
            if (y + barH > Height - Ui.Px(8)) y = selection.Top - barH - Ui.Px(10);
            if (y < Ui.Px(8)) y = selection.Bottom - barH - Ui.Px(10);
            actionsRect = new Rectangle(x, y, total, barH);
            int bx = x + pad;
            var buttons = new[] { btnAsk, btnCopy, btnSave, btnCancel };
            for (int i = 0; i < buttons.Length; i++)
            {
                buttons[i].SetBounds(bx, y + pad, widths[i], h);
                bx += widths[i] + gap;
            }
        }

        // ---- results ----

        Bitmap Crop()
        {
            var part = new Bitmap(selection.Width, selection.Height);
            using (var g = Graphics.FromImage(part))
                g.DrawImage(shot, new Rectangle(0, 0, selection.Width, selection.Height), selection, GraphicsUnit.Pixel);
            return part;
        }

        void Finish(string action)
        {
            if (done || selection.IsEmpty) return;
            done = true;
            var picture = Crop();
            Hide();
            if (Finished != null) Finished(picture, action);
            Close();
        }

        void Cancel()
        {
            if (done) return;
            done = true;
            Hide();
            if (Cancelled != null) Cancelled();
            Close();
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            base.OnFormClosed(e);
            dim.Dispose();
            shot.Dispose();
            mono.Dispose();
            monoBold.Dispose();
        }

        // ---- drawing ----

        protected override void OnPaintBackground(PaintEventArgs e) { }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.DrawImage(dim, e.ClipRectangle, e.ClipRectangle, GraphicsUnit.Pixel);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;

            Rectangle focus = !selection.IsEmpty ? selection : hover != null && !dragging ? hover.Bounds : Rectangle.Empty;
            if (!focus.IsEmpty)
            {
                g.DrawImage(shot, focus, focus, GraphicsUnit.Pixel);
                bool isChosen = !selection.IsEmpty;
                using (var pen = new Pen(pal.Accent, isChosen ? 2f : 1.5f))
                {
                    if (!isChosen) pen.DashStyle = DashStyle.Dash;
                    g.DrawRectangle(pen, focus.X, focus.Y, focus.Width - 1, focus.Height - 1);
                }
                if (isChosen) DrawHandles(g, focus);
                string label = focus.Width + " × " + focus.Height;
                if (!isChosen && hover != null) label = Shorten(hover.Title, 48) + "  " + label;
                DrawPill(g, label, focus);
            }

            if (!actionsRect.IsEmpty) DrawBox(g, actionsRect);
            DrawHint(g);
        }

        static string Shorten(string s, int max) { return s.Length <= max ? s : s.Substring(0, max - 1) + "…"; }

        void DrawHandles(Graphics g, Rectangle r)
        {
            int s = Ui.Px(7);
            using (var b = new SolidBrush(pal.Accent))
                foreach (var p in new[] { new Point(r.Left, r.Top), new Point(r.Right, r.Top), new Point(r.Left, r.Bottom), new Point(r.Right, r.Bottom) })
                    g.FillRectangle(b, p.X - s / 2, p.Y - s / 2, s, s);
        }

        void DrawBox(Graphics g, Rectangle r)
        {
            using (var path = Shapes.Round(r, Ui.Px(8)))
            {
                using (var fill = new SolidBrush(pal.Bg)) g.FillPath(fill, path);
                using (var pen = new Pen(pal.Accent, 1.5f)) g.DrawPath(pen, path);
            }
        }

        /// <summary>The size of the selection, just above it (or inside it at the top of the screen).</summary>
        void DrawPill(Graphics g, string text, Rectangle r)
        {
            var size = TextRenderer.MeasureText(text, mono);
            int h = size.Height + Ui.Px(6), w = size.Width + Ui.Px(10);
            int x = r.Left, y = r.Top - h - Ui.Px(6);
            if (y < Ui.Px(4)) y = r.Top + Ui.Px(6);
            var box = new Rectangle(x, y, w, h);
            DrawBox(g, box);
            TextRenderer.DrawText(g, text, mono, box, pal.Fg, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        }

        /// <summary>The bar at the top of the screen the pointer is on: what to do, in Claude Code's voice.</summary>
        void DrawHint(Graphics g)
        {
            string lead = "✻ Screenshot";
            string rest = selection.IsEmpty
                ? "  drag to select · click a window · Enter: whole screen · Esc: cancel"
                : "  Enter: ask Claude · Ctrl+C: copy · Ctrl+S: save · Esc: cancel";
            var leadSize = TextRenderer.MeasureText(lead, monoBold, Size.Empty, TextFormatFlags.NoPadding);
            var restSize = TextRenderer.MeasureText(rest, mono, Size.Empty, TextFormatFlags.NoPadding);
            int pad = Ui.Px(12);
            int w = leadSize.Width + restSize.Width + pad * 2, h = Math.Max(leadSize.Height, restSize.Height) + Ui.Px(14);
            var screen = Screen.FromPoint(Cursor.Position).Bounds;
            screen.Offset(-desktop.X, -desktop.Y);
            var box = new Rectangle(screen.Left + (screen.Width - w) / 2, screen.Top + Ui.Px(18), w, h);
            DrawBox(g, box);
            int ty = box.Top + (h - leadSize.Height) / 2;
            TextRenderer.DrawText(g, lead, monoBold, new Point(box.Left + pad, ty), pal.Accent, TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, rest, mono, new Point(box.Left + pad + leadSize.Width, ty), pal.Muted, TextFormatFlags.NoPadding);
        }
    }
}
