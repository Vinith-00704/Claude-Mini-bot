// What is attached to the next prompt, shown as chips above the prompt box: a screenshot, or a
// file or folder that was dropped on the bot. Each has a small x to take it off again.
//
// FileKinds decides, from the name alone, whether Claude can open a file directly. It never
// reads a file: the bot only passes the path on.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Windows.Forms;

namespace MiniBot
{
    public class Chip
    {
        public const string Shot = "shot", File = "file", Folder = "folder";
        public string Kind = File;
        public string Label = "";
        public string Path = "";
        public string Note = "";       // why Claude may not manage this one; empty when it should
        public bool Direct = true;     // false for a type the Read tool may not open
    }

    public static class FileKinds
    {
        // Claude's Read tool shows these as they are (images, PDFs, notebooks).
        static readonly HashSet<string> Readable = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "png", "jpg", "jpeg", "gif", "webp", "pdf", "ipynb", "svg"
        };

        // Types that are not text and not something Read shows: Claude would need a command or a script.
        static readonly HashSet<string> Opaque = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "zip", "rar", "7z", "gz", "tgz", "tar", "bz2", "xz", "iso", "img", "dmg", "cab", "jar", "apk", "whl",
            "exe", "dll", "msi", "sys", "bin", "dat", "obj", "lib", "pdb", "so", "class", "pyc", "lnk", "bak", "tmp",
            "mp3", "wav", "flac", "aac", "ogg", "m4a", "wma", "mp4", "mkv", "avi", "mov", "wmv", "webm", "flv",
            "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "pages", "numbers", "key",
            "ttf", "otf", "woff", "woff2", "psd", "ai", "sketch", "fig", "db", "sqlite", "sqlite3", "mdb", "accdb",
            "bmp", "tif", "tiff", "ico", "heic", "raw", "dwg", "blend", "fbx", "glb"
        };

        const long BigBytes = 20L * 1024 * 1024;
        const long HugeBytes = 100L * 1024 * 1024;

        public static bool IsDirect(string path)
        {
            string ext = System.IO.Path.GetExtension(path);
            ext = ext.Length > 0 ? ext.Substring(1) : "";
            return Readable.Contains(ext) || !Opaque.Contains(ext);
        }

        /// <summary>The size of a file, from the folder listing alone; 0 when it cannot be told.</summary>
        public static long SizeOf(string path)
        {
            try { return new FileInfo(path).Length; }
            catch (Exception) { return 0; }
        }

        public static bool IsBig(string path) { return SizeOf(path) >= BigBytes; }

        public static string NoteFor(string path, bool folder)
        {
            if (folder) return "";
            if (!IsDirect(path)) return "Claude can't open this type directly. It may need a command or a script.";
            if (SizeOf(path) >= HugeBytes) return "A very large file: Claude will only be able to read part of it.";
            return "";
        }
    }

    /// <summary>A wrapping row (or rows) of attachment chips, each with an x to remove it.</summary>
    public class ChipBar : Control
    {
        public event Action<int> Removed;

        public Palette Colors = Ui.PaletteFor("dark", "claude");
        readonly List<Chip> items = new List<Chip>();
        readonly List<Rectangle> rects = new List<Rectangle>();
        readonly ToolTip tip = new ToolTip();
        readonly Font font = Ui.Mono(9f);
        int hover = -1;
        bool hoverClose;

        public ChipBar()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint
                | ControlStyles.ResizeRedraw, true);
            SetStyle(ControlStyles.Selectable, false);   // never takes the keyboard from the prompt
            TabStop = false;
            AccessibleName = "Attachments";
            Disposed += delegate { tip.Dispose(); font.Dispose(); };
        }

        public int Count { get { return items.Count; } }
        public IList<Chip> Items { get { return items; } }

        public void SetItems(IEnumerable<Chip> chips)
        {
            items.Clear();
            items.AddRange(chips);
            hover = -1;
            Invalidate();
        }

        int RowHeight { get { return Ui.Px(26); } }
        int Gap { get { return Ui.Px(6); } }

        /// <summary>Works out where every chip goes for a width, and returns the height they need.</summary>
        public int HeightFor(int width)
        {
            Arrange(width);
            if (rects.Count == 0) return 0;
            int bottom = 0;
            foreach (var r in rects) bottom = Math.Max(bottom, r.Bottom);
            return bottom;
        }

        void Arrange(int width)
        {
            rects.Clear();
            int x = 0, y = 0;
            int widest = Math.Max(Ui.Px(110), Math.Min(width, Ui.Px(240)));
            foreach (var chip in items)
            {
                int w = TextRenderer.MeasureText(chip.Label, font, new Size(int.MaxValue, RowHeight), TextFormatFlags.NoPrefix).Width
                    + Ui.Px(8) + Ui.Px(20) + (chip.Note.Length > 0 ? Ui.Px(14) : 0) + Ui.Px(24);
                w = Math.Min(w, widest);
                if (x > 0 && x + w > width) { x = 0; y += RowHeight + Gap; }
                rects.Add(new Rectangle(x, y, w, RowHeight));
                x += w + Gap;
            }
        }

        Rectangle CloseOf(Rectangle r) { return new Rectangle(r.Right - Ui.Px(24), r.Y, Ui.Px(24), r.Height); }

        int HitChip(Point at)
        {
            for (int i = 0; i < rects.Count; i++) if (rects[i].Contains(at)) return i;
            return -1;
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            int i = HitChip(e.Location);
            bool onClose = i >= 0 && CloseOf(rects[i]).Contains(e.Location);
            if (i != hover || onClose != hoverClose)
            {
                hover = i;
                hoverClose = onClose;
                Cursor = onClose ? Cursors.Hand : Cursors.Default;
                tip.SetToolTip(this, i < 0 ? "" : onClose ? "Remove" : Describe(items[i]));
                Invalidate();
            }
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            if (hover != -1) { hover = -1; hoverClose = false; Invalidate(); }
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (e.Button != MouseButtons.Left) return;
            int i = HitChip(e.Location);
            if (i >= 0 && CloseOf(rects[i]).Contains(e.Location) && Removed != null) Removed(i);
        }

        static string Describe(Chip chip)
        {
            string text = chip.Kind == Chip.Shot ? chip.Label : chip.Path;
            return chip.Note.Length > 0 ? text + "\n" + chip.Note : text;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Colors.Bg);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Arrange(Width);
            for (int i = 0; i < items.Count && i < rects.Count; i++)
            {
                var r = rects[i];
                var chip = items[i];
                using (var path = Shapes.Round(r, Ui.Px(6)))
                using (var fill = new SolidBrush(Colors.UserMessage))
                    g.FillPath(fill, path);

                // The kind of thing it is, drawn small.
                var icon = new Rectangle(r.X + Ui.Px(9), r.Y + (r.Height - Ui.Px(14)) / 2, Ui.Px(12), Ui.Px(14));
                DrawIcon(g, icon, chip.Kind, Colors.Muted, Colors.UserMessage);

                int textX = icon.Right + Ui.Px(7);
                int textRight = r.Right - Ui.Px(24) - (chip.Note.Length > 0 ? Ui.Px(14) : 0);
                TextRenderer.DrawText(g, chip.Label, font, new Rectangle(textX, r.Y, Math.Max(1, textRight - textX), r.Height), Colors.Fg,
                    TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine);

                if (chip.Note.Length > 0)
                {
                    using (var warn = new SolidBrush(Colors.Warning))
                    using (var bold = Ui.Mono(9f, FontStyle.Bold))
                        g.DrawString("!", bold, warn, textRight + Ui.Px(2), r.Y + (r.Height - bold.Height) / 2f);
                }

                var close = CloseOf(r);
                bool lit = i == hover && hoverClose;
                if (lit)
                    using (var back = new SolidBrush(Colors.Border))
                        g.FillEllipse(back, close.X + Ui.Px(3), close.Y + Ui.Px(4), close.Width - Ui.Px(6), close.Height - Ui.Px(8));
                using (var pen = new Pen(lit ? Colors.Fg : Colors.Muted, 1.4f) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                {
                    float cx = close.X + close.Width / 2f, cy = close.Y + close.Height / 2f, d = 3.5f * Ui.Scale;
                    g.DrawLine(pen, cx - d, cy - d, cx + d, cy + d);
                    g.DrawLine(pen, cx - d, cy + d, cx + d, cy - d);
                }
            }
        }

        /// <summary>A page with a folded corner for a file, a tabbed folder, a framed picture for a screenshot.</summary>
        static void DrawIcon(Graphics g, Rectangle r, string kind, Color line, Color back)
        {
            using (var pen = new Pen(line, 1.3f) { LineJoin = LineJoin.Round })
            {
                if (kind == Chip.Folder)
                {
                    var body = new Rectangle(r.X, r.Y + r.Height / 4, r.Width, r.Height * 3 / 4 - 1);
                    g.DrawLines(pen, new[]
                    {
                        new Point(r.X, r.Y + r.Height / 4), new Point(r.X, r.Y + 1), new Point(r.X + r.Width / 2 - 1, r.Y + 1),
                        new Point(r.X + r.Width / 2 + 1, r.Y + r.Height / 4)
                    });
                    g.DrawRectangle(pen, body);
                }
                else if (kind == Chip.Shot)
                {
                    var frame = new Rectangle(r.X, r.Y + Ui.Px(2), r.Width, r.Height - Ui.Px(4));
                    g.DrawRectangle(pen, frame);
                    g.DrawLine(pen, frame.X + 2, frame.Bottom - 2, frame.X + frame.Width / 2, frame.Y + frame.Height / 2);
                    g.DrawLine(pen, frame.X + frame.Width / 2, frame.Y + frame.Height / 2, frame.Right - 2, frame.Bottom - 2);
                }
                else
                {
                    int fold = Math.Max(3, r.Width / 2);
                    g.DrawLines(pen, new[]
                    {
                        new Point(r.X, r.Bottom - 1), new Point(r.X, r.Y), new Point(r.Right - fold, r.Y),
                        new Point(r.Right - 1, r.Y + fold), new Point(r.Right - 1, r.Bottom - 1), new Point(r.X, r.Bottom - 1)
                    });
                    g.DrawLine(pen, r.Right - fold, r.Y, r.Right - fold, r.Y + fold);
                    g.DrawLine(pen, r.Right - fold, r.Y + fold, r.Right - 1, r.Y + fold);
                }
            }
        }
    }
}
