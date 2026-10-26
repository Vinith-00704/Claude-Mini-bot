// The few controls the panel and the customization dialog are made of, drawn
// by hand so they follow the bot's theme and accent: an icon button, a text
// button and a strip of choices (text, colour swatches or avatar faces).

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace MiniBot
{
    static class Shapes
    {
        public static GraphicsPath Round(RectangleF r, float radius)
        {
            var p = new GraphicsPath();
            float d = Math.Max(0.1f, Math.Min(radius * 2, Math.Min(r.Width, r.Height)));
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }
    }

    public class IconButton : Control
    {
        string kind = "send";
        public Palette Colors = Ui.PaletteFor("dark", "claude");
        public bool Primary;
        public bool Active;     // e.g. the microphone while listening
        bool hover, pressed;

        /// <summary>Which icon is drawn; the panel's size button swaps between "expand" and "collapse".</summary>
        public string Kind
        {
            get { return kind; }
            set
            {
                if (kind == value) return;
                kind = value;
                AccessibleName = value == "collapse" ? "Make the panel smaller" : value == "expand" ? "Make the panel larger" : AccessibleName;
                Invalidate();
            }
        }

        public IconButton(string kind)
        {
            this.kind = kind;
            AccessibleRole = AccessibleRole.PushButton;
            AccessibleName = kind == "mic" ? "Microphone" : kind == "send" ? "Send" : kind == "close" ? "Close" : kind == "camera" ? "Screenshot"
                : kind == "expand" ? "Make the panel larger" : kind == "collapse" ? "Make the panel smaller" : "Customize";
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint
                | ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
            Cursor = Cursors.Hand;
            Size = new Size(Ui.Px(30), Ui.Px(30));
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; pressed = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { pressed = true; Invalidate(); base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { pressed = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Parent != null ? Parent.BackColor : Colors.Bg);
            var box = new RectangleF(1, 1, Width - 3, Height - 3);
            Color fill = Color.Transparent;
            Color ink = Colors.Muted;
            if (Active) { fill = Colors.Danger; ink = Color.White; }
            else if (Primary) { fill = Colors.Accent; ink = Colors.AccentText; }
            else if (hover) { fill = Colors.Field; ink = Colors.Fg; }
            if (pressed && fill != Color.Transparent) fill = Ui.Darken(fill, 0.12f);
            if (!Enabled) { ink = Ui.Mix(ink, Colors.Bg, 0.6f); if (Primary) fill = Ui.Mix(fill, Colors.Bg, 0.6f); }
            if (fill != Color.Transparent)
                using (var b = new SolidBrush(fill)) g.FillEllipse(b, box);
            float w = Math.Max(1.7f, Width * 0.065f);
            using (var pen = new Pen(ink, w) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
            using (var brush = new SolidBrush(ink))
            {
                float cx = Width / 2f, cy = Height / 2f, u = Width / 30f;
                switch (Kind)
                {
                    case "mic":
                        using (var capsule = Shapes.Round(new RectangleF(cx - 3.2f * u, cy - 8f * u, 6.4f * u, 11f * u), 3.2f * u))
                            g.DrawPath(pen, capsule);
                        g.DrawArc(pen, cx - 6.5f * u, cy - 6f * u, 13f * u, 13f * u, 15, 150);
                        g.DrawLine(pen, cx, cy + 7.5f * u, cx, cy + 10f * u);
                        break;
                    case "send":
                        g.FillPolygon(brush, new[]
                        {
                            new PointF(cx - 7f * u, cy - 7f * u), new PointF(cx + 8f * u, cy),
                            new PointF(cx - 7f * u, cy + 7f * u), new PointF(cx - 4f * u, cy)
                        });
                        break;
                    case "close":
                        g.DrawLine(pen, cx - 4.5f * u, cy - 4.5f * u, cx + 4.5f * u, cy + 4.5f * u);
                        g.DrawLine(pen, cx - 4.5f * u, cy + 4.5f * u, cx + 4.5f * u, cy - 4.5f * u);
                        break;
                    case "stop":
                        g.FillRectangle(brush, cx - 5f * u, cy - 5f * u, 10f * u, 10f * u);
                        break;
                    case "expand":
                        // Two corner arrows pointing apart.
                        g.DrawLine(pen, cx + 1.5f * u, cy - 1.5f * u, cx + 7f * u, cy - 7f * u);
                        g.DrawLines(pen, new[] { new PointF(cx + 2.5f * u, cy - 7f * u), new PointF(cx + 7f * u, cy - 7f * u), new PointF(cx + 7f * u, cy - 2.5f * u) });
                        g.DrawLine(pen, cx - 1.5f * u, cy + 1.5f * u, cx - 7f * u, cy + 7f * u);
                        g.DrawLines(pen, new[] { new PointF(cx - 2.5f * u, cy + 7f * u), new PointF(cx - 7f * u, cy + 7f * u), new PointF(cx - 7f * u, cy + 2.5f * u) });
                        break;
                    case "collapse":
                        // The same two arrows pointing together.
                        g.DrawLine(pen, cx + 7f * u, cy - 7f * u, cx + 1.5f * u, cy - 1.5f * u);
                        g.DrawLines(pen, new[] { new PointF(cx + 1.5f * u, cy - 6f * u), new PointF(cx + 1.5f * u, cy - 1.5f * u), new PointF(cx + 6f * u, cy - 1.5f * u) });
                        g.DrawLine(pen, cx - 7f * u, cy + 7f * u, cx - 1.5f * u, cy + 1.5f * u);
                        g.DrawLines(pen, new[] { new PointF(cx - 1.5f * u, cy + 6f * u), new PointF(cx - 1.5f * u, cy + 1.5f * u), new PointF(cx - 6f * u, cy + 1.5f * u) });
                        break;
                    case "camera":
                        // A snip: four corner marks around a small lens.
                        float edge = 8f * u, c = 3.5f * u;
                        g.DrawLines(pen, new[] { new PointF(cx - edge, cy - edge + c), new PointF(cx - edge, cy - edge), new PointF(cx - edge + c, cy - edge) });
                        g.DrawLines(pen, new[] { new PointF(cx + edge - c, cy - edge), new PointF(cx + edge, cy - edge), new PointF(cx + edge, cy - edge + c) });
                        g.DrawLines(pen, new[] { new PointF(cx - edge, cy + edge - c), new PointF(cx - edge, cy + edge), new PointF(cx - edge + c, cy + edge) });
                        g.DrawLines(pen, new[] { new PointF(cx + edge - c, cy + edge), new PointF(cx + edge, cy + edge), new PointF(cx + edge, cy + edge - c) });
                        g.DrawEllipse(pen, cx - 3f * u, cy - 3f * u, 6f * u, 6f * u);
                        break;
                    default: // "sliders"
                        g.DrawLine(pen, cx - 7f * u, cy - 4f * u, cx + 7f * u, cy - 4f * u);
                        g.DrawLine(pen, cx - 7f * u, cy + 4f * u, cx + 7f * u, cy + 4f * u);
                        g.FillEllipse(brush, cx + 1f * u, cy - 6.5f * u, 5f * u, 5f * u);
                        g.FillEllipse(brush, cx - 6f * u, cy + 1.5f * u, 5f * u, 5f * u);
                        break;
                }
            }
        }
    }

    /// <summary>
    /// The prompt line. It is a multi-line box that the panel keeps one line tall until the text wraps
    /// or Shift+Enter adds a line. A multi-line box has no built-in placeholder, so it paints its own.
    /// </summary>
    public class PromptBox : TextBox
    {
        const int WM_PAINT = 0x000F;
        string hint = "";
        public Color HintColor = Color.Gray;
        /// <summary>While the slash-command list is open, Tab is a key for the box (it completes a name) and not a move to the next control.</summary>
        public bool CaptureTab;

        public PromptBox()
        {
            Multiline = true;
            WordWrap = true;
            AcceptsReturn = true;   // Enter reaches OnInputKey, which sends; Shift+Enter falls through as a new line
            ScrollBars = ScrollBars.None;
        }

        public string Hint
        {
            get { return hint; }
            set { hint = value ?? ""; Invalidate(); }
        }

        protected override bool IsInputKey(Keys keyData)
        {
            if (CaptureTab && (keyData & Keys.KeyCode) == Keys.Tab && (keyData & (Keys.Control | Keys.Alt)) == 0) return true;
            return base.IsInputKey(keyData);
        }

        protected override void OnTextChanged(EventArgs e)
        {
            base.OnTextChanged(e);
            Invalidate();   // the hint goes away with the first character and comes back when the box is emptied
        }

        protected override void WndProc(ref Message m)
        {
            base.WndProc(ref m);
            if (m.Msg == WM_PAINT && hint.Length > 0 && TextLength == 0)
            {
                using (var g = Graphics.FromHwnd(Handle))
                    TextRenderer.DrawText(g, hint, Font, ClientRectangle, HintColor,
                        TextFormatFlags.Left | TextFormatFlags.Top | TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);
            }
        }
    }

    /// <summary>A wide button that shows the current choice; clicking it opens a list.</summary>
    public class PickerButton : Control
    {
        public Palette Colors = Ui.PaletteFor("dark", "claude");
        bool hover;

        public PickerButton()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint
                | ControlStyles.ResizeRedraw, true);
            Cursor = Cursors.Hand;
            Font = Ui.Font(10f);
            AccessibleRole = AccessibleRole.PushButton;
            AccessibleName = "Choose bot";
        }

        protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }
        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Parent != null ? Parent.BackColor : Colors.Bg);
            using (var path = Shapes.Round(new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f), Height / 2f))
            using (var b = new SolidBrush(hover ? Ui.Mix(Colors.Field, Colors.Fg, 0.06f) : Colors.Field))
                g.FillPath(b, path);
            using (var brush = new SolidBrush(Colors.Fg))
            using (var format = new StringFormat { LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap })
                g.DrawString(Text, Font, brush, new RectangleF(Ui.Px(14), 0, Width - Ui.Px(40), Height), format);
            float cx = Width - Ui.Px(18), cy = Height / 2f;
            using (var pen = new Pen(Colors.Muted, 2f) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                g.DrawLines(pen, new[] { new PointF(cx - 4, cy - 2), new PointF(cx, cy + 2), new PointF(cx + 4, cy - 2) });
        }
    }

    public class TextButton : Control
    {
        public Palette Colors = Ui.PaletteFor("dark", "claude");
        public bool Primary;
        bool hover, pressed;

        public TextButton(string text)
        {
            Text = text;
            AccessibleRole = AccessibleRole.PushButton;
            AccessibleName = text;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint
                | ControlStyles.ResizeRedraw, true);
            Cursor = Cursors.Hand;
            Font = Ui.Font(9f, FontStyle.Bold);
            Size = new Size(Ui.Px(96), Ui.Px(30));
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; pressed = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { pressed = true; Invalidate(); base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { pressed = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Parent != null ? Parent.BackColor : Colors.Bg);
            Color fill = Primary ? Colors.Accent : (hover ? Ui.Mix(Colors.Field, Colors.Fg, 0.08f) : Colors.Field);
            Color ink = Primary ? Colors.AccentText : Colors.Fg;
            if (Primary && hover) fill = Ui.Lighten(fill, 0.08f);
            if (pressed) fill = Ui.Darken(fill, 0.12f);
            if (!Enabled) { fill = Ui.Mix(fill, Colors.Bg, 0.55f); ink = Ui.Mix(ink, Colors.Bg, 0.5f); }
            using (var path = Shapes.Round(new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f), Height / 2f))
            using (var b = new SolidBrush(fill))
                g.FillPath(b, path);
            using (var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            using (var brush = new SolidBrush(ink))
                g.DrawString(Text, Font, brush, new RectangleF(0, 0, Width, Height), format);
        }
    }

    /// <summary>One choice out of several, shown as text, colour swatches or avatar faces.</summary>
    public class ChoiceStrip : Control
    {
        public enum Style { Text, Color, Avatar }

        public event EventHandler Changed;
        public Palette Colors = Ui.PaletteFor("dark", "claude");
        public Style Mode = Style.Text;
        public string[] Keys = new string[0];
        public string[] Labels = new string[0];
        public string SkinForAvatars = "claude";
        string selected = "";
        int hoverIndex = -1;
        readonly Dictionary<string, Bitmap> icons = new Dictionary<string, Bitmap>();

        public ChoiceStrip()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint
                | ControlStyles.ResizeRedraw, true);
            Cursor = Cursors.Hand;
            Font = Ui.Font(8.5f, FontStyle.Bold);
            Height = Ui.Px(34);
        }

        public string Selected
        {
            get { return selected; }
            set { if (selected != value) { selected = value; Invalidate(); } }
        }

        public void ClearIcons()
        {
            foreach (var b in icons.Values) b.Dispose();
            icons.Clear();
            Invalidate();
        }

        int IndexAt(Point p)
        {
            if (Keys.Length == 0) return -1;
            int i = p.X * Keys.Length / Math.Max(1, Width);
            return i < 0 || i >= Keys.Length ? -1 : i;
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            int i = IndexAt(e.Location);
            if (i != hoverIndex) { hoverIndex = i; Invalidate(); }
            base.OnMouseMove(e);
        }

        protected override void OnMouseLeave(EventArgs e) { hoverIndex = -1; Invalidate(); base.OnMouseLeave(e); }

        protected override void OnMouseClick(MouseEventArgs e)
        {
            base.OnMouseClick(e);
            int i = IndexAt(e.Location);
            if (i < 0 || Keys[i] == selected) return;
            selected = Keys[i];
            Invalidate();
            if (Changed != null) Changed(this, EventArgs.Empty);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Parent != null ? Parent.BackColor : Colors.Bg);
            int n = Keys.Length;
            if (n == 0) return;
            float cell = Width / (float)n;
            for (int i = 0; i < n; i++)
            {
                var r = new RectangleF(i * cell + 2, 1, cell - 4, Height - 3);
                bool isSelected = Keys[i] == selected;
                bool isHover = i == hoverIndex;
                switch (Mode)
                {
                    case Style.Color:
                        float d = Math.Min(r.Width, r.Height) * 0.72f;
                        var dot = new RectangleF(r.X + (r.Width - d) / 2f, r.Y + (r.Height - d) / 2f, d, d);
                        Color c = ColorFor(Keys[i]);
                        if (isSelected)
                            using (var ring = new Pen(Colors.Fg, 2.2f)) g.DrawEllipse(ring, dot.X - 3, dot.Y - 3, dot.Width + 6, dot.Height + 6);
                        else if (isHover)
                            using (var ring = new Pen(Colors.Muted, 1.5f)) g.DrawEllipse(ring, dot.X - 3, dot.Y - 3, dot.Width + 6, dot.Height + 6);
                        using (var b = new SolidBrush(c)) g.FillEllipse(b, dot);
                        break;
                    case Style.Avatar:
                        using (var path = Shapes.Round(r, 10))
                        {
                            using (var b = new SolidBrush(isSelected ? Ui.Mix(Colors.Field, Colors.Accent, 0.30f) : Colors.Field)) g.FillPath(b, path);
                            if (isSelected) using (var pen = new Pen(Colors.Accent, 2f)) g.DrawPath(pen, path);
                            else if (isHover) using (var pen = new Pen(Colors.Border, 1.5f)) g.DrawPath(pen, path);
                        }
                        var icon = IconFor(Keys[i], (int)Math.Min(r.Width, r.Height) - 6);
                        g.DrawImage(icon, r.X + (r.Width - icon.Width) / 2f, r.Y + (r.Height - icon.Height) / 2f);
                        break;
                    default:
                        using (var path = Shapes.Round(r, r.Height / 2f))
                        using (var b = new SolidBrush(isSelected ? Colors.Accent : isHover ? Ui.Mix(Colors.Field, Colors.Fg, 0.08f) : Colors.Field))
                            g.FillPath(b, path);
                        using (var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                        using (var brush = new SolidBrush(isSelected ? Colors.AccentText : Colors.Fg))
                            g.DrawString(i < Labels.Length ? Labels[i] : Keys[i], Font, brush, r, format);
                        break;
                }
            }
        }

        Color ColorFor(string key)
        {
            // A strip of skins or of accents: the key says which.
            foreach (var skin in new[] { "claude", "sunrise", "ocean", "forest", "berry", "slate" })
                if (key == skin) return Ui.Skin(key);
            return Ui.AccentColor(key);
        }

        Bitmap IconFor(string avatar, int px)
        {
            string id = avatar + SkinForAvatars + px;
            Bitmap b;
            if (!icons.TryGetValue(id, out b))
            {
                b = Painter.RenderIcon(avatar, SkinForAvatars, Math.Max(16, px));
                icons[id] = b;
            }
            return b;
        }
    }

    /// <summary>The small box shown while the microphone is listening: a red dot, a label and a row of bars that follow the voice.</summary>
    public class VoiceMeter : Control
    {
        const int Bars = 30;
        public Palette Colors = Ui.PaletteFor("dark", "claude");
        readonly float[] history = new float[Bars];
        float smooth;

        public VoiceMeter()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint
                | ControlStyles.ResizeRedraw, true);
            AccessibleRole = AccessibleRole.ProgressBar;
            AccessibleName = "Microphone level";
            SetStyle(ControlStyles.Selectable, false);   // showing it must never take the keyboard focus from the prompt
            TabStop = false;
        }

        /// <summary>One new reading, 0-100, about every frame.</summary>
        public void Push(int level)
        {
            float v = Math.Min(1f, (float)Math.Sqrt(Math.Max(0, level) / 70f));
            smooth = v > smooth ? v : smooth * 0.8f + v * 0.2f;
            Array.Copy(history, 1, history, 0, Bars - 1);
            history[Bars - 1] = smooth;
            Invalidate();
        }

        public void Clear()
        {
            Array.Clear(history, 0, Bars);
            smooth = 0;
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Colors.Bg);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var box = new RectangleF(0.5f, 0.5f, Width - 2, Height - 2);
            using (var path = Shapes.Round(box, Ui.Px(8)))
            {
                using (var fill = new SolidBrush(Colors.Field)) g.FillPath(fill, path);
                using (var pen = new Pen(Colors.Border, 1.2f)) g.DrawPath(pen, path);
            }
            int pad = Ui.Px(12), dot = Ui.Px(9);
            // The dot breathes with the voice, so it is plain that the microphone is live.
            float grow = smooth * Ui.Px(3);
            using (var red = new SolidBrush(Color.FromArgb(229, 72, 77)))
                g.FillEllipse(red, pad - grow / 2f, (Height - dot) / 2f - grow / 2f, dot + grow, dot + grow);
            int x = pad + dot + Ui.Px(8);
            using (var font = Ui.Mono(9f, FontStyle.Bold))
            using (var brush = new SolidBrush(Colors.Fg))
            {
                g.DrawString("Listening", font, brush, x, (Height - font.Height) / 2f);
                x += TextRenderer.MeasureText("Listening", font).Width - Ui.Px(2);
            }
            int left = x + Ui.Px(10), right = Width - pad;
            if (right - left < Ui.Px(24)) return;
            float step = (right - left) / (float)Bars, barW = Math.Max(2f, step * 0.58f);
            float maxH = Height - Ui.Px(14), minH = Ui.Px(3);
            using (var low = new SolidBrush(Colors.Subtle))
            using (var high = new SolidBrush(Colors.Accent))
                for (int i = 0; i < Bars; i++)
                {
                    float h = minH + history[i] * (maxH - minH);
                    var r = new RectangleF(left + i * step, (Height - h) / 2f, barW, h);
                    using (var path = Shapes.Round(r, barW / 2f)) g.FillPath(history[i] > 0.12f ? high : low, path);
                }
        }
    }
}
