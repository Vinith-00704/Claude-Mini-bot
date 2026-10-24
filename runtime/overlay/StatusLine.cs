// The one-line status under the bot's name, drawn the way Claude Code draws its
// own: while it works, the spinner glyph cycles in the accent colour next to a
// verb ("Pondering…") with a lighter shimmer sweeping across it, then the seconds
// it has taken in grey. When it is done or has failed, a plain mark and a word in
// the success or error colour.

using System;
using System.Drawing;
using System.Drawing.Text;
using System.Windows.Forms;

namespace MiniBot
{
    public class StatusLine : Control
    {
        public Palette Colors = Ui.PaletteFor("dark", "claude");

        string phase = "idle";
        bool listening;
        string detail = "";
        string verb = "Thinking";
        string seed = "";
        DateTime since = DateTime.UtcNow;
        readonly Timer tick = new Timer();
        readonly DateTime started = DateTime.UtcNow;
        float cell;

        public StatusLine()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint
                | ControlStyles.ResizeRedraw, true);
            Font = Ui.Mono(9.5f);
            Height = Ui.Px(22);
            AccessibleRole = AccessibleRole.StaticText;
            AccessibleName = "Status";
            tick.Interval = 50;
            tick.Tick += delegate { if (IsBusy) Invalidate(); };
            tick.Start();
        }

        bool IsBusy { get { return listening || phase == "sending" || phase == "thinking" || phase == "working"; } }

        /// <summary>What the line says now. A new `id` (a new request) draws a new verb and restarts the clock.</summary>
        public void SetState(string newPhase, bool isListening, string newDetail, string id)
        {
            bool restart = newPhase != phase && (newPhase == "sending" || newPhase == "thinking") || id != seed;
            phase = newPhase;
            listening = isListening;
            detail = newDetail ?? "";
            if (restart && (newPhase == "sending" || newPhase == "thinking" || newPhase == "working"))
            {
                since = DateTime.UtcNow;
                verb = ClaudeMotion.VerbFor(id + newPhase.Length);
            }
            seed = id ?? "";
            AccessibleDescription = Summary();
            Invalidate();
        }

        string Summary()
        {
            if (listening) return "Listening";
            switch (phase)
            {
                case "sending": return "Sending";
                case "thinking": return verb;
                case "working": return detail.Length > 0 ? "Working: " + detail : "Working";
                case "completed": return "Done";
                case "error": return "Something went wrong";
                default: return "Ready";
            }
        }

        float CellWidth(Graphics g)
        {
            if (cell <= 0)
            {
                using (var f = new StringFormat(StringFormat.GenericTypographic) { FormatFlags = StringFormatFlags.MeasureTrailingSpaces })
                    cell = g.MeasureString("MMMMMMMMMM", Font, 1000, f).Width / 10f;
            }
            return cell;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Parent != null ? Parent.BackColor : Colors.Bg);
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
            double seconds = (DateTime.UtcNow - started).TotalSeconds;
            double elapsed = (DateTime.UtcNow - since).TotalSeconds;
            float w = CellWidth(g);
            float y = (Height - Font.Height) / 2f;
            using (var typo = new StringFormat(StringFormat.GenericTypographic) { FormatFlags = StringFormatFlags.NoWrap })
            using (var symbols = new Font("Segoe UI Symbol", Font.Size, FontStyle.Bold))
            {
                Action<string, float, Color, Font> text = (s, x, color, font) =>
                {
                    using (var b = new SolidBrush(color)) g.DrawString(s, font, b, x, y, typo);
                };

                if (listening)
                {
                    text("●", 0, Colors.Danger, symbols);
                    text("Listening…", w * 2, Colors.Danger, Font);
                    return;
                }
                switch (phase)
                {
                    case "sending":
                    case "thinking":
                    case "working":
                    {
                        string label = (phase == "working" && detail.Length > 0 ? detail : verb) + "…";
                        text(ClaudeMotion.Glyph(seconds), 0, Colors.Accent, symbols);
                        int centre = ClaudeMotion.ShimmerCentre(seconds, label.Length);
                        using (var bold = new Font(Font, FontStyle.Bold))
                            for (int i = 0; i < label.Length; i++)
                                text(label[i].ToString(), w * 2 + i * w,
                                    ClaudeMotion.IsShimmering(i, centre) ? Colors.Shimmer : Colors.Accent, bold);
                        string time = "(" + (int)elapsed + "s)";
                        text(time, w * 2 + (label.Length + 1) * w, Colors.Muted, Font);
                        return;
                    }
                    case "completed":
                        text("✓", 0, Colors.Success, symbols);
                        text("Done", w * 2, Colors.Success, Font);
                        return;
                    case "error":
                        text("✗", 0, Colors.Danger, symbols);
                        text("Something went wrong", w * 2, Colors.Danger, Font);
                        return;
                    default:
                        text("Ready", 0, Colors.Muted, Font);
                        return;
                }
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) tick.Dispose();
            base.Dispose(disposing);
        }
    }
}
