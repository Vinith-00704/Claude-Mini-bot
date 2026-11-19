// The preview of a bot that was designed from the person's description, shown with the question "Use it?".
//
// It shows the bot exactly as it would float on the screen, at its own size and with its name, and beside that
// every state it can be in (resting, listening, thinking, working, done, a problem), each one moving as it will.
// Nothing about the person's bots changes while this is up: only their answer in the panel makes the design real.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Windows.Forms;

namespace MiniBot
{
    public class PreviewWindow : NoActivateForm
    {
        static readonly string[] Labels = { "Resting", "Listening", "Thinking", "Working", "Done", "A problem" };
        static readonly string[] Phases = { "idle", "idle", "thinking", "working", "completed", "error" };

        readonly Timer frame = new Timer();
        readonly DateTime opened = DateTime.UtcNow;
        Look look = new Look();
        Palette pal = Ui.PaletteFor("dark", "claude");
        string heading = "";

        public PreviewWindow()
        {
            Text = "Mini Bot preview";
            AccessibleName = "Preview of the new bot";
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
            frame.Interval = 50;
            frame.Tick += delegate { if (Visible) Invalidate(); };
            Disposed += delegate { frame.Dispose(); };
        }

        int CellBody { get { return 24 * Math.Max(2, Ui.Px(60) / 24); } }
        int Margin_ { get { return Ui.Px(16); } }
        int TitleH { get { return Ui.Px(30); } }
        int HintH { get { return Ui.Px(24); } }
        int LabelH { get { return Ui.Px(18); } }

        Size CellSize()
        {
            int s = CellBody;
            var small = new Look { Avatar = look.Avatar, Sprite = look.Sprite };
            return new Size(s + Ui.Px(28), (int)(s * 0.36f) + Math.Max(s, Painter.ArtHeight(small, s)) + LabelH + Ui.Px(8));
        }

        /// <summary>The bot to show, and the colours of its panel.</summary>
        public void SetBot(Look bot, Palette palette, string name)
        {
            look = bot;
            pal = palette;
            heading = "✻ Preview: " + name;
            BackColor = pal.Bg;
            var actual = Painter.WindowSize(look);
            var cell = CellSize();
            int m = Margin_;
            int gridW = 3 * cell.Width, gridH = 2 * cell.Height;
            int bodyH = Math.Max(actual.Height, gridH);
            var size = new Size(m + actual.Width + m + gridW + m, m + TitleH + bodyH + HintH + m);
            if (Size != size)
            {
                Size = size;
                using (var path = Shapes.Round(new RectangleF(0, 0, Width, Height), Ui.Px(10))) Region = new Region(path);
            }
            frame.Start();
            Invalidate();
        }

        /// <summary>
        /// Beside what has to stay in view (the panel with its answer buttons, and the bot), on whichever side has
        /// room: right, left, above, below. It is always whole on the screen, and covers the bot only if there is no room at all.
        /// </summary>
        public void PlaceBeside(Rectangle keepClear, Rectangle work)
        {
            int gap = Ui.Px(10);
            int minX = work.Left + gap, maxX = work.Right - gap - Width, minY = work.Top + gap, maxY = work.Bottom - gap - Height;
            int alongY = Math.Max(minY, Math.Min(keepClear.Top, maxY)), alongX = Math.Max(minX, Math.Min(keepClear.Left, maxX));
            var spots = new[]
            {
                new Point(keepClear.Right + gap, alongY), new Point(keepClear.Left - gap - Width, alongY),
                new Point(alongX, keepClear.Top - gap - Height), new Point(alongX, keepClear.Bottom + gap),
            };
            Point chosen = new Point(Math.Max(minX, Math.Min(keepClear.Right + gap, maxX)), alongY);
            foreach (var spot in spots)
            {
                if (spot.X < minX || spot.X > maxX || spot.Y < minY || spot.Y > maxY) continue;
                chosen = spot;
                break;
            }
            if (Location != chosen) Location = chosen;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
            g.Clear(pal.Bg);
            double t = (DateTime.UtcNow - opened).TotalSeconds;
            int m = Margin_;

            using (var border = new Pen(pal.Accent, Ui.Px(2)))
            using (var path = Shapes.Round(new RectangleF(1, 1, Width - 3, Height - 3), Ui.Px(9)))
                g.DrawPath(border, path);

            using (var font = Ui.Mono(10.5f, FontStyle.Bold))
            using (var brush = new SolidBrush(pal.Accent))
            using (var format = new StringFormat { Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap })
                g.DrawString(heading, font, brush, new RectangleF(m, m - Ui.Px(2), Width - 2 * m, TitleH), format);

            // As it would float on the screen: its own size, its name under it.
            var actual = Painter.WindowSize(look);
            var cell = CellSize();
            int bodyTop = m + TitleH;
            int bodyH = Math.Max(actual.Height, 2 * cell.Height);
            using (var bmp = Painter.RenderWindow(look, "idle", false, t, true))
                g.DrawImageUnscaled(bmp, m, bodyTop + (bodyH - actual.Height) / 2);

            // Every state, each moving as it will.
            int s = CellBody;
            int gridX = m + actual.Width + m;
            using (var font = Ui.Mono(8.5f))
            using (var muted = new SolidBrush(pal.Muted))
            using (var plate = new SolidBrush(pal.Field))
            using (var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            {
                for (int i = 0; i < Labels.Length; i++)
                {
                    int cx = gridX + (i % 3) * cell.Width, cy = bodyTop + (i / 3) * cell.Height;
                    var box = new RectangleF(cx + Ui.Px(3), cy + Ui.Px(3), cell.Width - Ui.Px(6), cell.Height - Ui.Px(6));
                    using (var path = Shapes.Round(box, Ui.Px(8))) g.FillPath(plate, path);
                    var state = g.Save();
                    Painter.DrawCharacter(g, cx + (cell.Width - s) / 2f, cy + s * 0.36f, s, look, Phases[i], i == 1, t);
                    g.Restore(state);
                    g.DrawString(Labels[i], font, muted, new RectangleF(cx, cy + cell.Height - LabelH - Ui.Px(6), cell.Width, LabelH), format);
                }
            }

            using (var font = Ui.Mono(8.5f))
            using (var muted = new SolidBrush(pal.Muted))
                g.DrawString("Nothing has changed yet. Answer in the bot's panel.", font, muted, new RectangleF(m, Height - m - HintH + Ui.Px(6), Width - 2 * m, HintH));
        }
    }
}
