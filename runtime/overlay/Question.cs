// A yes-or-no question in the bot's own style (a small black box with the accent
// border and the terminal font) for asks that cannot wait for the panel, such as
// the first screenshot's permission. Permission questions take Claude Code's
// permission colour for their border, as Claude Code's own do.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace MiniBot
{
    public static class Question
    {
        public static bool Ask(Palette pal, string title, string body, string yes, string no, bool isPermission)
        {
            using (var f = new Form())
            {
                int w = Ui.Px(420), m = Ui.Px(18);
                f.Text = title;
                f.FormBorderStyle = FormBorderStyle.None;
                f.ShowInTaskbar = false;
                f.TopMost = true;
                f.StartPosition = FormStartPosition.CenterScreen;
                f.BackColor = pal.Bg;
                f.KeyPreview = true;
                var heading = new Label { Text = "✻ " + title, AutoSize = false, ForeColor = isPermission ? pal.Permission : pal.Accent, BackColor = pal.Bg, Font = Ui.Mono(10.5f, FontStyle.Bold) };
                var text = new Label { Text = body, AutoSize = false, ForeColor = pal.Fg, BackColor = pal.Bg, Font = Ui.Mono(9.5f) };
                int th = TextRenderer.MeasureText(body, text.Font, new Size(w - 2 * m, 0), TextFormatFlags.WordBreak).Height + Ui.Px(4);
                heading.SetBounds(m, m, w - 2 * m, Ui.Px(24));
                text.SetBounds(m, m + Ui.Px(32), w - 2 * m, th);
                int by = m + Ui.Px(32) + th + Ui.Px(14);
                var accept = new TextButton(yes) { Primary = true, Colors = pal, BackColor = pal.Bg };
                var decline = new TextButton(no) { Colors = pal, BackColor = pal.Bg };
                accept.SetBounds(m, by, Ui.Px(150), Ui.Px(32));
                decline.SetBounds(m + Ui.Px(158), by, Ui.Px(110), Ui.Px(32));
                f.ClientSize = new Size(w, by + Ui.Px(32) + m);
                bool answer = false;
                accept.Click += delegate { answer = true; f.Close(); };
                decline.Click += delegate { f.Close(); };
                f.KeyDown += delegate (object s, KeyEventArgs e) { if (e.KeyCode == Keys.Escape) f.Close(); };
                Color border = isPermission ? pal.Permission : pal.Accent;
                f.Paint += delegate (object s, PaintEventArgs e)
                {
                    e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                    using (var path = Shapes.Round(new RectangleF(0.5f, 0.5f, f.Width - 2, f.Height - 2), Ui.Px(10)))
                    using (var pen = new Pen(border, 1.6f))
                        e.Graphics.DrawPath(pen, path);
                };
                f.Shown += delegate { f.Activate(); decline.Focus(); };
                f.Controls.AddRange(new Control[] { heading, text, accept, decline });
                using (var shape = Shapes.Round(new RectangleF(0, 0, f.ClientSize.Width, f.ClientSize.Height), Ui.Px(10)))
                    f.Region = new Region(shape);
                f.ShowDialog();
                return answer;
            }
        }
    }
}
