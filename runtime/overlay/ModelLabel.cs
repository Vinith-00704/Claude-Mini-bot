// The line under the panel's header that says which model the Claude Code session runs on and how hard
// it is asked to think: "Opus 5.5  ▮▮▮▯▯ high". It only shows what the session reported; it changes nothing.
// For a few seconds after the model changes it says so instead ("Opus 5.5 -> Sonnet 5.5").

using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace MiniBot
{
    public class ModelLabel : Control
    {
        public Palette Colors = Ui.PaletteFor("dark", "claude");
        string name = "", effort = "", mode = "full", note = "";
        readonly Font font = Ui.Mono(8.5f);

        public ModelLabel()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint
                | ControlStyles.ResizeRedraw, true);
            SetStyle(ControlStyles.Selectable, false);   // never takes the keyboard from the prompt
            TabStop = false;
            AccessibleName = "Model";
            Disposed += delegate { font.Dispose(); };
        }

        /// <summary>True when there is something to show: a model is known and the person has not turned the label off.</summary>
        public bool HasContent { get { return name.Length > 0 && mode != "off"; } }

        /// <summary>The model's short name, the effort level (low to max, or "" for none), how much to show (full, model or off), and a short note about a change.</summary>
        public void Set(string modelName, string effortLevel, string labelMode, string changeNote)
        {
            modelName = modelName ?? ""; effortLevel = effortLevel ?? ""; labelMode = labelMode ?? "full"; changeNote = changeNote ?? "";
            if (modelName == name && effortLevel == effort && labelMode == mode && changeNote == note) return;
            name = modelName; effort = effortLevel; mode = labelMode; note = changeNote;
            AccessibleName = "Model " + name + (effort.Length > 0 ? ", effort " + effort : "");
            Invalidate();
        }

        static int Pips(string level)
        {
            switch (level)
            {
                case "low": return 1;
                case "medium": return 2;
                case "high": return 3;
                case "xhigh": return 4;
                case "max": return 5;
                default: return 0;
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Colors.Bg);
            if (!HasContent) return;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            // A small dot in the accent colour leads the line; it is the accent while a change is being announced.
            int dot = Ui.Px(6);
            int x = Ui.Px(2);
            using (var fill = new SolidBrush(note.Length > 0 ? Colors.Accent : Colors.Muted))
                g.FillEllipse(fill, x, (Height - dot) / 2, dot, dot);
            x += dot + Ui.Px(7);

            string text = note.Length > 0 ? note : name;
            var flags = TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis;
            int levels = mode == "full" ? Pips(effort) : 0;
            int pipsW = levels > 0 ? 5 * Ui.Px(5) + 4 * Ui.Px(3) + Ui.Px(8) + TextRenderer.MeasureText(effort, font, new Size(int.MaxValue, Height), TextFormatFlags.NoPrefix).Width : 0;
            int textW = Math.Max(Ui.Px(20), Math.Min(TextRenderer.MeasureText(text, font, new Size(int.MaxValue, Height), TextFormatFlags.NoPrefix).Width, Width - x - pipsW - Ui.Px(8)));
            TextRenderer.DrawText(g, text, font, new Rectangle(x, 0, textW, Height), note.Length > 0 ? Colors.Accent : Colors.Muted, flags);
            x += textW + Ui.Px(10);

            // The effort, as five small bars filled up to its level, and its name.
            if (levels > 0)
            {
                int w = Ui.Px(5), h = Ui.Px(10), gap = Ui.Px(3), top = (Height - h) / 2;
                for (int i = 0; i < 5; i++)
                {
                    var bar = new Rectangle(x + i * (w + gap), top, w, h);
                    using (var path = Shapes.Round(bar, Ui.Px(2)))
                    using (var fill = new SolidBrush(i < levels ? Colors.Accent : Colors.Border))
                        g.FillPath(fill, path);
                }
                x += 5 * w + 4 * gap + Ui.Px(8);
                TextRenderer.DrawText(g, effort, font, new Rectangle(x, 0, Math.Max(1, Width - x), Height), Colors.Muted, flags);
            }
        }
    }
}
