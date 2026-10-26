// The list of slash commands that opens under the prompt when "/" is typed, the way Claude Code's own
// prompt does: every command at first, narrowed as more is typed, Up and Down to move, Tab to complete
// the name, Enter to run it. It only shows and filters the names it is given; the panel decides what
// choosing one does, and Claude Code's side is what runs it.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Windows.Forms;

namespace MiniBot
{
    public class CommandItem
    {
        public string Name = "";           // without the slash; may hold spaces ("mini-bot hide")
        public string Description = "";
        public string Source = "";         // builtin, plugin, user, mcp or bot
        public bool TakesArgs;             // needs something typed after it, so Enter completes it instead of running it bare
    }

    public class CommandList : Control
    {
        public const int MaxRows = 7;

        public Palette Colors = Ui.PaletteFor("dark", "claude");
        public event Action<CommandItem> Picked;     // a row was clicked

        readonly List<CommandItem> all = new List<CommandItem>();
        readonly List<CommandItem> shown = new List<CommandItem>();
        readonly Font font = Ui.Mono(9.5f);
        int selected, top, hover = -1;
        int nameWidth;

        public CommandList()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint
                | ControlStyles.ResizeRedraw, true);
            SetStyle(ControlStyles.Selectable, false);   // never takes the keyboard from the prompt
            TabStop = false;
            AccessibleName = "Slash commands";
            Visible = false;
            Disposed += delegate { font.Dispose(); };
        }

        public int Count { get { return shown.Count; } }
        public int Rows { get { return Math.Min(shown.Count, MaxRows); } }
        public int RowHeight { get { return Ui.Px(24); } }
        public CommandItem Selected { get { return selected >= 0 && selected < shown.Count ? shown[selected] : null; } }

        /// <summary>The height the visible rows need, with a little room around them.</summary>
        public int HeightFor() { return Rows == 0 ? 0 : Rows * RowHeight + 2 * Ui.Px(4); }

        public void SetItems(IEnumerable<CommandItem> items)
        {
            all.Clear();
            all.AddRange(items ?? new CommandItem[0]);
        }

        // ---- searching ----

        // Lower is better; -1 is no match. A name matches by being what was typed, starting with it, having a
        // word that starts with it ("bot" in "mini-bot hide"), containing it, or holding its letters in order;
        // failing all of those, the description may mention it.
        static int Score(CommandItem c, string query)
        {
            if (query.Length == 0) return 0;
            string name = c.Name.ToLowerInvariant();
            if (name == query) return 0;
            if (name.StartsWith(query, StringComparison.Ordinal)) return 1;
            for (int i = 1; i < name.Length; i++)
                if (IsBoundary(name[i - 1]) && string.CompareOrdinal(name, i, query, 0, query.Length) == 0) return 2;
            if (name.IndexOf(query, StringComparison.Ordinal) >= 0) return 3;
            if (IsSubsequence(query, name)) return 4;
            if (c.Description.ToLowerInvariant().IndexOf(query, StringComparison.Ordinal) >= 0) return 5;
            return -1;
        }

        static bool IsBoundary(char c) { return c == '-' || c == ':' || c == ' ' || c == '.' || c == '_'; }

        static bool IsSubsequence(string needle, string haystack)
        {
            int at = 0;
            foreach (char c in haystack)
                if (at < needle.Length && c == needle[at]) at++;
            return at == needle.Length;
        }

        /// <summary>Shows the commands that match what follows the slash, best first (the order given breaks ties). Returns how many.</summary>
        public int Filter(string query)
        {
            query = (query ?? "").ToLowerInvariant();
            var scored = new List<KeyValuePair<int, CommandItem>>();
            foreach (var item in all)
            {
                int score = Score(item, query);
                if (score >= 0) scored.Add(new KeyValuePair<int, CommandItem>(score, item));
            }
            shown.Clear();
            shown.AddRange(scored.OrderBy(p => p.Key).Select(p => p.Value));   // OrderBy is stable
            selected = 0;
            top = 0;
            hover = -1;
            nameWidth = 0;
            foreach (var item in shown.Take(200))
                nameWidth = Math.Max(nameWidth, TextRenderer.MeasureText("/" + item.Name, font, new Size(int.MaxValue, RowHeight), TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix).Width);
            Invalidate();
            return shown.Count;
        }

        // ---- moving ----

        public void MoveSelection(int delta)
        {
            if (shown.Count == 0) return;
            selected = ((selected + delta) % shown.Count + shown.Count) % shown.Count;   // wraps round, as Claude Code's does
            if (selected < top) top = selected;
            if (selected >= top + MaxRows) top = selected - MaxRows + 1;
            Invalidate();
        }

        int RowAt(int y)
        {
            int row = (y - Ui.Px(4)) / RowHeight;
            int index = top + row;
            return y >= Ui.Px(4) && row >= 0 && row < Rows && index < shown.Count ? index : -1;
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            int index = RowAt(e.Y);
            if (index == hover) return;
            hover = index;
            Cursor = index >= 0 ? Cursors.Hand : Cursors.Default;
            Invalidate();
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            if (hover < 0) return;
            hover = -1;
            Invalidate();
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            int index = RowAt(e.Y);
            if (e.Button != MouseButtons.Left || index < 0) return;
            selected = index;
            Invalidate();
            if (Picked != null) Picked(shown[index]);
        }

        protected override void OnMouseWheel(MouseEventArgs e)
        {
            base.OnMouseWheel(e);
            int most = Math.Max(0, shown.Count - MaxRows);
            top = Math.Max(0, Math.Min(most, top - Math.Sign(e.Delta) * 2));
            Invalidate();
        }

        // ---- drawing ----

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Colors.Bg);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var path = Shapes.Round(new RectangleF(0.5f, 0.5f, Width - 2, Height - 2), Ui.Px(8)))
            {
                using (var fill = new SolidBrush(Colors.Field)) g.FillPath(fill, path);
                using (var pen = new Pen(Colors.Border, 1.2f)) g.DrawPath(pen, path);
            }

            int pad = Ui.Px(4), rowH = RowHeight, inset = Ui.Px(8);
            bool scrolls = shown.Count > MaxRows;
            int rowW = Width - 2 * pad - (scrolls ? Ui.Px(6) : 0);
            int nameCol = Math.Max(Ui.Px(60), Math.Min(nameWidth + Ui.Px(14), rowW / 2));
            var flags = TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine
                | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding;

            for (int row = 0; row < Rows; row++)
            {
                int index = top + row;
                var item = shown[index];
                var rect = new Rectangle(pad, pad + row * rowH, rowW, rowH);
                bool on = index == selected;
                if (on || index == hover)
                    using (var path = Shapes.Round(rect, Ui.Px(5)))
                    using (var fill = new SolidBrush(on ? Colors.UserMessage : Ui.Mix(Colors.Field, Colors.UserMessage, 0.5f)))
                        g.FillPath(fill, path);
                TextRenderer.DrawText(g, "/" + item.Name, font, new Rectangle(rect.X + inset, rect.Y, nameCol - inset, rowH), on ? Colors.Accent : Colors.Fg, flags);
                int descX = rect.X + nameCol;
                if (item.Description.Length > 0 && descX < rect.Right - inset)
                    TextRenderer.DrawText(g, item.Description, font, new Rectangle(descX, rect.Y, rect.Right - descX - inset, rowH), on ? Colors.Fg : Colors.Muted, flags);
            }

            // A thin bar at the right edge says there are more rows than fit, and where in the list the rows are.
            if (scrolls)
            {
                int trackH = Rows * rowH;
                int thumbH = Math.Max(Ui.Px(14), trackH * Rows / shown.Count);
                int thumbY = pad + (trackH - thumbH) * top / Math.Max(1, shown.Count - Rows);
                using (var path = Shapes.Round(new RectangleF(Width - pad - Ui.Px(4), thumbY, Ui.Px(3), thumbH), Ui.Px(1)))
                using (var fill = new SolidBrush(Colors.Border))
                    g.FillPath(fill, path);
            }
        }
    }
}
