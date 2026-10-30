// Computer control's eyes and hands. They act only on the jobs the runtime hands out, one at a time,
// on a worker thread of their own: look (a picture of a monitor, the windows on it and the named
// controls of one window), probe (what is at the point a step would touch, so the runtime can decide)
// and act (the step itself, once the runtime has allowed it). Nothing here decides whether a step may
// happen. Every input it sends carries the bot's signature, so the person's own mouse and keyboard can
// be told apart from it.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Automation;
using System.Windows.Forms;

namespace MiniBot
{
    /// <summary>A step that cannot be taken, with the reason Claude reads.</summary>
    public class StepException : Exception
    {
        public StepException(string message) : base(message) { }
    }

    public class ComputerHands
    {
        /// <summary>"MBOT": the extra information on every input event the bot sends.</summary>
        public static readonly IntPtr Signature = new IntPtr(0x4D424F54);
        const int LongEdge = 1366;          // pictures are made no larger than this on their long edge
        const int MaxElements = 150;
        const int MaxVisited = 2500;
        const int ElementMs = 2500;
        const int TypeGapMs = 8;            // between typed characters (about 120 a second)

        static long actingUntil;            // ticks; while now is before it, input is the bot's own
        readonly int ownPid = Process.GetCurrentProcess().Id;

        // The last picture: which part of the desktop it shows and how much smaller it is, so x and y in it map back.
        Rectangle lookBounds = Rectangle.Empty;
        double lookScale = 1;
        int lookMonitor = 1;
        List<Rectangle> lookElements = new List<Rectangle>();

        /// <summary>Shows the marker on the spot a step is about to touch (the overlay draws it on its own thread).</summary>
        public Action<Point> Mark;

        /// <summary>True while the bot itself is sending input, and briefly after, so it is not taken for the person's.</summary>
        public static bool IsActing { get { return DateTime.UtcNow.Ticks < Interlocked.Read(ref actingUntil); } }

        static void Acting(int ms)
        {
            Interlocked.Exchange(ref actingUntil, DateTime.UtcNow.AddMilliseconds(ms).Ticks);
        }

        public Dictionary<string, object> Run(string kind, Dictionary<string, object> args)
        {
            switch (kind)
            {
                case "look": return Look(args);
                case "probe": return Probe(args);
                case "act": return Act(args);
                default: throw new StepException("unknown job " + kind);
            }
        }

        // ---- look ----

        static Screen[] Monitors()
        {
            return Screen.AllScreens.OrderByDescending(s => s.Primary).ThenBy(s => s.Bounds.X).ThenBy(s => s.Bounds.Y).ToArray();
        }

        public Dictionary<string, object> Look(Dictionary<string, object> args)
        {
            int wait = Json.Int(args, "waitMs");
            if (wait > 0) Thread.Sleep(Math.Min(wait, 10000));
            var monitors = Monitors();
            IntPtr target = IntPtr.Zero;
            string named = Json.Str(args, "window");
            if (named.Length > 0)
            {
                target = FindWindow(named);
                if (target == IntPtr.Zero) throw new StepException("No window matches \"" + named + "\". The window list below each picture says what is open.");
            }
            IntPtr front = Win.GetForegroundWindow();
            int index;
            if (Json.Has(args, "monitor")) index = Math.Max(1, Math.Min(Json.Int(args, "monitor", 1), monitors.Length));
            else
            {
                IntPtr basis = target != IntPtr.Zero ? target : front;
                var screen = basis != IntPtr.Zero ? Screen.FromHandle(basis) : Screen.PrimaryScreen;
                index = Array.FindIndex(monitors, s => s.DeviceName == screen.DeviceName) + 1;
                if (index < 1) index = 1;
            }
            var bounds = monitors[index - 1].Bounds;

            double scale = Math.Min(1.0, (double)LongEdge / Math.Max(bounds.Width, bounds.Height));
            int w = Math.Max(1, (int)Math.Round(bounds.Width * scale)), h = Math.Max(1, (int)Math.Round(bounds.Height * scale));
            string image;
            Point cursor = Cursor.Position;
            using (var full = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb))
            {
                Grab(full, bounds);
                using (var small = new Bitmap(w, h, PixelFormat.Format24bppRgb))
                {
                    using (var g = Graphics.FromImage(small))
                    {
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.DrawImage(full, 0, 0, w, h);
                        if (bounds.Contains(cursor)) DrawPointer(g, ToImage(cursor, bounds, scale));
                    }
                    image = Jpeg(small, 80);
                }
            }

            lookBounds = bounds;
            lookScale = scale;
            lookMonitor = index;
            var result = new Dictionary<string, object>
            {
                { "image", image }, { "mediaType", "image/jpeg" }, { "width", w }, { "height", h },
                { "monitor", index }, { "scale", Math.Round(scale, 4) },
                { "monitors", monitors.Select((s, i) => (object)new Dictionary<string, object> { { "index", i + 1 }, { "primary", s.Primary }, { "width", s.Bounds.Width }, { "height", s.Bounds.Height } }).ToArray() },
                { "cursor", bounds.Contains(cursor) ? (object)PointObj(ToImage(cursor, bounds, scale)) : null },
                { "windows", Windows(bounds, scale, front).ToArray() },
            };

            lookElements = new List<Rectangle>();
            IntPtr of = target != IntPtr.Zero ? target : front;
            if (Json.Bool(args, "elements", true) && of != IntPtr.Zero && Pid(of) != ownPid)
            {
                result["elementsOf"] = WindowObj(of, bounds, scale, front);
                var found = Elements(of, bounds);
                if (found == null) result["elementsNote"] = "The window took too long to list its controls; use the picture.";
                else
                {
                    var list = new List<object>();
                    for (int i = 0; i < found.Count; i++)
                    {
                        lookElements.Add(found[i].Rect);
                        var r = ToImage(found[i].Rect, bounds, scale);
                        list.Add(new Dictionary<string, object>
                        {
                            { "n", i + 1 }, { "type", found[i].Type }, { "name", found[i].Name },
                            { "x", r.X + r.Width / 2 }, { "y", r.Y + r.Height / 2 }, { "w", r.Width }, { "h", r.Height },
                            { "password", found[i].IsPassword }, { "enabled", found[i].IsEnabled },
                        });
                    }
                    result["elements"] = list.ToArray();
                }
            }
            return result;
        }

        /// <summary>Copies a part of the screen, menus and other layered windows included (CopyFromScreen cannot ask for those).</summary>
        static void Grab(Bitmap into, Rectangle bounds)
        {
            IntPtr screen = Native.GetDC(IntPtr.Zero);
            try
            {
                using (var g = Graphics.FromImage(into))
                {
                    IntPtr dc = g.GetHdc();
                    try { Win.BitBlt(dc, 0, 0, bounds.Width, bounds.Height, screen, bounds.X, bounds.Y, Win.SRCCOPY | Win.CAPTUREBLT); }
                    finally { g.ReleaseHdc(dc); }
                }
            }
            finally { Native.ReleaseDC(IntPtr.Zero, screen); }
        }

        static void DrawPointer(Graphics g, Point p)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var outline = new Pen(Color.White, 3))
            using (var pen = new Pen(Color.FromArgb(220, 30, 30), 1.6f))
            {
                g.DrawEllipse(outline, p.X - 7, p.Y - 7, 14, 14);
                g.DrawEllipse(pen, p.X - 7, p.Y - 7, 14, 14);
                g.DrawLine(pen, p.X - 11, p.Y, p.X + 11, p.Y);
                g.DrawLine(pen, p.X, p.Y - 11, p.X, p.Y + 11);
            }
        }

        static string Jpeg(Bitmap bitmap, long quality)
        {
            var codec = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
            using (var parameters = new EncoderParameters(1))
            using (var stream = new MemoryStream())
            {
                parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
                bitmap.Save(stream, codec, parameters);
                return Convert.ToBase64String(stream.ToArray());
            }
        }

        static Point ToImage(Point p, Rectangle bounds, double scale)
        {
            return new Point((int)Math.Round((p.X - bounds.X) * scale), (int)Math.Round((p.Y - bounds.Y) * scale));
        }

        static Rectangle ToImage(Rectangle r, Rectangle bounds, double scale)
        {
            var a = ToImage(r.Location, bounds, scale);
            return new Rectangle(a.X, a.Y, Math.Max(1, (int)Math.Round(r.Width * scale)), Math.Max(1, (int)Math.Round(r.Height * scale)));
        }

        static Dictionary<string, object> PointObj(Point p)
        {
            return new Dictionary<string, object> { { "x", p.X }, { "y", p.Y } };
        }

        // ---- windows ----

        static int Pid(IntPtr hwnd)
        {
            uint pid;
            Native.GetWindowThreadProcessId(hwnd, out pid);
            return (int)pid;
        }

        static string ProcessName(int pid)
        {
            try { using (var p = Process.GetProcessById(pid)) return p.ProcessName; }
            catch (Exception) { return ""; }
        }

        /// <summary>The program a window really belongs to: a Store app's frame is drawn by ApplicationFrameHost, its content by the app.</summary>
        static int AppPid(IntPtr root)
        {
            int pid = Pid(root);
            if (!ProcessName(pid).Equals("ApplicationFrameHost", StringComparison.OrdinalIgnoreCase)) return pid;
            int inner = pid;
            Win.EnumChildWindows(root, delegate (IntPtr child, IntPtr unused)
            {
                int p = Pid(child);
                if (p != pid) { inner = p; return false; }
                return true;
            }, IntPtr.Zero);
            return inner;
        }

        static string Title(IntPtr hwnd)
        {
            int length = Native.GetWindowTextLength(hwnd);
            if (length == 0) return "";
            var text = new StringBuilder(length + 1);
            Native.GetWindowText(hwnd, text, text.Capacity);
            return text.ToString();
        }

        /// <summary>The program windows a person would see, front to back.</summary>
        static List<IntPtr> TopWindows()
        {
            var list = new List<IntPtr>();
            Native.EnumWindows(delegate (IntPtr hwnd, IntPtr unused)
            {
                if (!Native.IsWindowVisible(hwnd)) return true;
                if (Win.GetWindow(hwnd, Win.GW_OWNER) != IntPtr.Zero) return true;
                if ((Win.GetWindowLong(hwnd, Win.GWL_EXSTYLE) & Native.WS_EX_TOOLWINDOW) != 0) return true;
                int cloaked;
                if (Native.DwmGetWindowAttribute(hwnd, Native.DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;
                if (Native.GetWindowTextLength(hwnd) == 0) return true;
                list.Add(hwnd);
                return true;
            }, IntPtr.Zero);
            return list;
        }

        static Rectangle Bounds(IntPtr hwnd)
        {
            Native.RECT r;
            if (Native.DwmGetWindowAttribute(hwnd, Native.DWMWA_EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(Native.RECT))) != 0)
                Native.GetWindowRect(hwnd, out r);
            return Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
        }

        Dictionary<string, object> WindowObj(IntPtr hwnd, Rectangle bounds, double scale, IntPtr front)
        {
            var r = Bounds(hwnd);
            var d = new Dictionary<string, object>
            {
                { "title", Clip(Title(hwnd), 90) }, { "process", ProcessName(AppPid(hwnd)) },
                { "foreground", hwnd == front }, { "minimized", Native.IsIconic(hwnd) },
            };
            if (!Native.IsIconic(hwnd) && r.IntersectsWith(bounds))
            {
                var ir = ToImage(Rectangle.Intersect(r, bounds), bounds, scale);
                d["x"] = ir.X; d["y"] = ir.Y; d["w"] = ir.Width; d["h"] = ir.Height;
            }
            else d["elsewhere"] = true;
            return d;
        }

        List<object> Windows(Rectangle bounds, double scale, IntPtr front)
        {
            var list = new List<object>();
            foreach (var hwnd in TopWindows())
            {
                if (Pid(hwnd) == ownPid) continue;
                list.Add(WindowObj(hwnd, bounds, scale, front));
                if (list.Count >= 15) break;
            }
            return list;
        }

        /// <summary>A window by program name ("excel") or part of its title, front-most first.</summary>
        IntPtr FindWindow(string named)
        {
            string want = named.Trim().ToLowerInvariant();
            if (want.EndsWith(".exe")) want = want.Substring(0, want.Length - 4);
            var windows = TopWindows().Where(h => Pid(h) != ownPid).ToList();
            foreach (var h in windows) if (ProcessName(AppPid(h)).ToLowerInvariant() == want) return h;
            foreach (var h in windows) if (Title(h).ToLowerInvariant().Contains(want)) return h;
            return IntPtr.Zero;
        }

        static string Clip(string text, int max)
        {
            text = (text ?? "").Replace('\n', ' ').Replace('\r', ' ').Trim();
            return text.Length > max ? text.Substring(0, max - 1) + "…" : text;
        }

        /// <summary>Whether a program runs as administrator (or cannot be looked at at all, which reads the same).</summary>
        static bool IsElevated(int pid)
        {
            IntPtr process = Win.OpenProcess(Win.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (process == IntPtr.Zero) return true;
            try
            {
                IntPtr token;
                if (!Win.OpenProcessToken(process, Win.TOKEN_QUERY, out token)) return true;
                try
                {
                    int elevation, size;
                    if (!Win.GetTokenInformation(token, Win.TokenElevation, out elevation, 4, out size)) return true;
                    return elevation != 0;
                }
                finally { Win.CloseHandle(token); }
            }
            finally { Win.CloseHandle(process); }
        }

        // ---- the controls of a window (Windows' accessibility tree) ----

        class Found
        {
            public string Type, Name;
            public Rectangle Rect;
            public bool IsPassword, IsEnabled;
        }

        static readonly HashSet<ControlType> Interactive = new HashSet<ControlType>
        {
            ControlType.Button, ControlType.CheckBox, ControlType.ComboBox, ControlType.Edit, ControlType.Hyperlink,
            ControlType.ListItem, ControlType.MenuItem, ControlType.RadioButton, ControlType.Slider, ControlType.Spinner,
            ControlType.SplitButton, ControlType.TabItem, ControlType.TreeItem, ControlType.DataItem, ControlType.Document,
            ControlType.HeaderItem,
        };

        static T Within<T>(Func<T> work, int ms) where T : class
        {
            var task = Task.Run(work);
            try { return task.Wait(ms) ? task.Result : null; }
            catch (AggregateException) { return null; }
        }

        static Rectangle RectOf(System.Windows.Rect r)
        {
            if (r.IsEmpty || double.IsInfinity(r.Width) || double.IsNaN(r.Width)) return Rectangle.Empty;
            return new Rectangle((int)r.X, (int)r.Y, (int)r.Width, (int)r.Height);
        }

        static string TypeName(ControlType type)
        {
            string name = type.ProgrammaticName;
            int dot = name.LastIndexOf('.');
            return (dot >= 0 ? name.Substring(dot + 1) : name).ToLowerInvariant();
        }

        /// <summary>The named controls of a window that are on this monitor, buttons and fields first. Null when the window takes too long.</summary>
        List<Found> Elements(IntPtr hwnd, Rectangle monitor)
        {
            return Within(delegate
            {
                var watch = Stopwatch.StartNew();
                var cache = new CacheRequest();
                cache.Add(AutomationElement.NameProperty);
                cache.Add(AutomationElement.ControlTypeProperty);
                cache.Add(AutomationElement.BoundingRectangleProperty);
                cache.Add(AutomationElement.IsOffscreenProperty);
                cache.Add(AutomationElement.IsPasswordProperty);
                cache.Add(AutomationElement.IsEnabledProperty);
                var interactive = new List<Found>();
                var text = new List<Found>();
                using (cache.Activate())
                {
                    var root = AutomationElement.FromHandle(hwnd);
                    var walker = TreeWalker.ControlViewWalker;
                    var stack = new Stack<KeyValuePair<AutomationElement, int>>();
                    var first = walker.GetFirstChild(root, cache);
                    if (first != null) stack.Push(new KeyValuePair<AutomationElement, int>(first, 1));
                    int visited = 0;
                    while (stack.Count > 0 && visited < MaxVisited && interactive.Count < MaxElements && watch.ElapsedMilliseconds < ElementMs - 300)
                    {
                        var top = stack.Pop();
                        var el = top.Key;
                        visited++;
                        try
                        {
                            var next = walker.GetNextSibling(el, cache);
                            if (next != null) stack.Push(new KeyValuePair<AutomationElement, int>(next, top.Value));
                            var c = el.Cached;
                            var rect = RectOf(c.BoundingRectangle);
                            bool shown = !c.IsOffscreen && rect.Width > 2 && rect.Height > 2 && rect.IntersectsWith(monitor);
                            if (shown)
                            {
                                var found = new Found { Type = TypeName(c.ControlType), Name = Clip(c.Name, 70), Rect = rect, IsPassword = c.IsPassword, IsEnabled = c.IsEnabled };
                                if (Interactive.Contains(c.ControlType)) interactive.Add(found);
                                else if (c.ControlType == ControlType.Text && found.Name.Length > 0) text.Add(found);
                            }
                            // A control off the screen can still hold shown ones (a scrolled list); a cell grid's rows are skipped below a depth.
                            if (top.Value < 25 && (shown || rect.IsEmpty))
                            {
                                var child = walker.GetFirstChild(el, cache);
                                if (child != null) stack.Push(new KeyValuePair<AutomationElement, int>(child, top.Value + 1));
                            }
                        }
                        catch (ElementNotAvailableException) { }
                    }
                }
                foreach (var t in text)
                {
                    if (interactive.Count >= MaxElements) break;
                    interactive.Add(t);
                }
                return interactive;
            }, ElementMs);
        }

        static Dictionary<string, object> ElementAt(Point p)
        {
            return Within(delegate
            {
                var el = AutomationElement.FromPoint(new System.Windows.Point(p.X, p.Y));
                return el == null ? null : Describe(el);
            }, 1500);
        }

        static Dictionary<string, object> FocusedElement()
        {
            return Within(delegate
            {
                var el = AutomationElement.FocusedElement;
                return el == null ? null : Describe(el);
            }, 1500);
        }

        static Dictionary<string, object> Describe(AutomationElement el)
        {
            var c = el.Current;
            return new Dictionary<string, object>
            {
                { "name", Clip(c.Name, 70) }, { "type", TypeName(c.ControlType) },
                { "isPassword", c.IsPassword }, { "enabled", c.IsEnabled },
            };
        }

        // ---- probe: what a step would touch ----

        bool IsPointer(string action)
        {
            return action == "click" || action == "double_click" || action == "right_click" || action == "move" || action == "drag" || action == "scroll";
        }

        /// <summary>The spot on the screen x and y (or element n) of the last picture stand for.</summary>
        Point Target(Dictionary<string, object> args, string xKey, string yKey)
        {
            if (lookBounds.IsEmpty) throw new StepException("Look at the screen first (computer_look): positions are pixels in the last picture.");
            if (xKey == "x" && Json.Has(args, "element"))
            {
                int n = Json.Int(args, "element");
                if (n < 1 || n > lookElements.Count) throw new StepException("There is no element " + n + " in the last picture's list.");
                var r = lookElements[n - 1];
                return new Point(r.X + r.Width / 2, r.Y + r.Height / 2);
            }
            int x = Json.Int(args, xKey), y = Json.Int(args, yKey);
            var p = new Point(lookBounds.X + (int)Math.Round(x / lookScale), lookBounds.Y + (int)Math.Round(y / lookScale));
            if (!lookBounds.Contains(p)) throw new StepException("That position is outside the last picture (" + (int)Math.Round(lookBounds.Width * lookScale) + " x " + (int)Math.Round(lookBounds.Height * lookScale) + ").");
            return p;
        }

        Dictionary<string, object> WindowInfo(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return null;
            var root = Win.GetAncestor(hwnd, Win.GA_ROOT);
            if (root == IntPtr.Zero) root = hwnd;
            int pid = AppPid(root);
            int rootPid = Pid(root);
            return new Dictionary<string, object>
            {
                { "pid", pid }, { "process", ProcessName(pid) }, { "title", Clip(Title(root), 90) },
                { "own", pid == ownPid || rootPid == ownPid }, { "elevated", IsElevated(pid) }, { "hwnd", root.ToInt64() },
            };
        }

        public Dictionary<string, object> Probe(Dictionary<string, object> args)
        {
            string action = Json.Str(args, "action");
            var result = new Dictionary<string, object>();
            if (IsPointer(action))
            {
                var p = Target(args, "x", "y");
                result["point"] = PointObj(p);
                result["window"] = WindowInfo(Win.WindowFromPoint(new Win.POINT { x = p.X, y = p.Y }));
                result["element"] = ElementAt(p);
                if (action == "drag")
                {
                    var to = Target(args, "toX", "toY");
                    result["toWindow"] = WindowInfo(Win.WindowFromPoint(new Win.POINT { x = to.X, y = to.Y }));
                }
            }
            else if (action == "focus")
            {
                var hwnd = FindWindow(Json.Str(args, "window"));
                if (hwnd == IntPtr.Zero) throw new StepException("No window matches \"" + Json.Str(args, "window") + "\".");
                result["window"] = WindowInfo(hwnd);
            }
            else
            {
                // Keys and typing go to the window in front, into its focused control.
                result["window"] = WindowInfo(Win.GetForegroundWindow());
                result["element"] = FocusedElement();
            }
            return result;
        }

        // ---- act ----

        public Dictionary<string, object> Act(Dictionary<string, object> args)
        {
            string action = Json.Str(args, "action");
            int expect = Json.Int(args, "expectPid");
            Point at = Point.Empty;
            if (IsPointer(action))
            {
                at = Target(args, "x", "y");
                // The screen may have changed since the probe: the step lands on the program that was allowed, or not at all.
                var now = WindowInfo(Win.WindowFromPoint(new Win.POINT { x = at.X, y = at.Y }));
                if (now == null || Json.Int(now, "pid") != expect) throw new StepException("The screen changed before the step: look again.");
                if (Mark != null) Mark(at);
                Thread.Sleep(320);
            }
            else if (action == "focus")
            {
                var hwnd = FindWindow(Json.Str(args, "window"));
                if (hwnd == IntPtr.Zero || AppPid(hwnd) != expect) throw new StepException("That window is gone: look again.");
                Focus(hwnd);
            }
            else
            {
                var front = WindowInfo(Win.GetForegroundWindow());
                if (front == null || Json.Int(front, "pid") != expect) throw new StepException("Another window came to the front before the step: look again.");
            }

            Acting(400);
            switch (action)
            {
                case "move": MoveTo(at); break;
                case "click": Click(at, Win.MOUSEEVENTF_LEFTDOWN, Win.MOUSEEVENTF_LEFTUP, 1); break;
                case "double_click": Click(at, Win.MOUSEEVENTF_LEFTDOWN, Win.MOUSEEVENTF_LEFTUP, 2); break;
                case "right_click": Click(at, Win.MOUSEEVENTF_RIGHTDOWN, Win.MOUSEEVENTF_RIGHTUP, 1); break;
                case "drag": Drag(at, Target(args, "toX", "toY")); break;
                case "scroll": Scroll(at, Json.Str(args, "direction"), Json.Int(args, "amount", 3)); break;
                case "type": TypeText(Json.Str(args, "text")); break;
                case "keys": Press(Json.Str(args, "keys"), Json.Int(args, "repeat", 1)); break;
                case "focus": break;
                default: throw new StepException("unknown action " + action);
            }
            Acting(250);

            Thread.Sleep(450);   // let the app draw what the step did
            if (!Json.Bool(args, "lookAfter", true)) return new Dictionary<string, object>();
            return Look(new Dictionary<string, object> { { "monitor", lookMonitor }, { "elements", true } });
        }

        static void Send(params Win.INPUT[] inputs)
        {
            if (inputs.Length == 0) return;
            uint sent = Win.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Win.INPUT)));
            if (sent != inputs.Length) throw new StepException("Windows did not take the input (the window in front may run as administrator).");
        }

        static Win.INPUT Mouse(uint flags, int dx, int dy, int data)
        {
            var i = new Win.INPUT { type = Win.INPUT_MOUSE };
            i.u.mi = new Win.MOUSEINPUT { dx = dx, dy = dy, mouseData = unchecked((uint)data), dwFlags = flags, dwExtraInfo = Signature };
            return i;
        }

        static Win.INPUT Key(ushort vk, ushort scan, uint flags)
        {
            var i = new Win.INPUT { type = Win.INPUT_KEYBOARD };
            i.u.ki = new Win.KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags, dwExtraInfo = Signature };
            return i;
        }

        static void MoveTo(Point p)
        {
            var desk = SystemInformation.VirtualScreen;
            int dx = (int)Math.Round((p.X - desk.Left) * 65535.0 / Math.Max(1, desk.Width - 1));
            int dy = (int)Math.Round((p.Y - desk.Top) * 65535.0 / Math.Max(1, desk.Height - 1));
            Send(Mouse(Win.MOUSEEVENTF_MOVE | Win.MOUSEEVENTF_ABSOLUTE | Win.MOUSEEVENTF_VIRTUALDESK, dx, dy, 0));
            Thread.Sleep(30);
            // Rounding can leave the pointer a pixel off; put it exactly where it belongs.
            if (Cursor.Position != p) Win.SetCursorPos(p.X, p.Y);
        }

        static void Click(Point p, uint down, uint up, int times)
        {
            MoveTo(p);
            for (int i = 0; i < times; i++)
            {
                Send(Mouse(down, 0, 0, 0), Mouse(up, 0, 0, 0));
                if (i + 1 < times) Thread.Sleep(60);
            }
        }

        static void Drag(Point from, Point to)
        {
            MoveTo(from);
            Send(Mouse(Win.MOUSEEVENTF_LEFTDOWN, 0, 0, 0));
            Thread.Sleep(80);
            for (int i = 1; i <= 12; i++)
            {
                MoveTo(new Point(from.X + (to.X - from.X) * i / 12, from.Y + (to.Y - from.Y) * i / 12));
                Thread.Sleep(15);
            }
            Send(Mouse(Win.MOUSEEVENTF_LEFTUP, 0, 0, 0));
        }

        static void Scroll(Point p, string direction, int amount)
        {
            MoveTo(p);
            bool sideways = direction == "left" || direction == "right";
            int delta = (direction == "up" || direction == "right" ? 1 : -1) * 120;
            for (int i = 0; i < Math.Max(1, Math.Min(amount, 30)); i++)
            {
                Send(Mouse(sideways ? Win.MOUSEEVENTF_HWHEEL : Win.MOUSEEVENTF_WHEEL, 0, 0, delta));
                Thread.Sleep(25);
            }
        }

        /// <summary>
        /// Types text one character at a time, a few milliseconds apart: newer apps (Windows 11's Notepad among them)
        /// mix up characters that arrive in one burst. A character outside the basic plane goes as its two halves together.
        /// </summary>
        static void TypeText(string text)
        {
            for (int i = 0; i < text.Length; i++)
            {
                char ch = text[i];
                Acting(300);
                if (ch == '\r') continue;
                if (ch == '\n') Send(Key(0x0D, 0, 0), Key(0x0D, 0, Win.KEYEVENTF_KEYUP));
                else if (ch == '\t') Send(Key(0x09, 0, 0), Key(0x09, 0, Win.KEYEVENTF_KEYUP));
                else if (char.IsHighSurrogate(ch) && i + 1 < text.Length)
                {
                    char low = text[++i];
                    Send(Key(0, ch, Win.KEYEVENTF_UNICODE), Key(0, low, Win.KEYEVENTF_UNICODE),
                        Key(0, ch, Win.KEYEVENTF_UNICODE | Win.KEYEVENTF_KEYUP), Key(0, low, Win.KEYEVENTF_UNICODE | Win.KEYEVENTF_KEYUP));
                }
                else Send(Key(0, ch, Win.KEYEVENTF_UNICODE), Key(0, ch, Win.KEYEVENTF_UNICODE | Win.KEYEVENTF_KEYUP));
                Thread.Sleep(TypeGapMs);
            }
        }

        static readonly Dictionary<string, ushort> Keys = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase)
        {
            { "Enter", 0x0D }, { "Tab", 0x09 }, { "Esc", 0x1B }, { "Space", 0x20 }, { "Backspace", 0x08 }, { "Delete", 0x2E },
            { "Insert", 0x2D }, { "Home", 0x24 }, { "End", 0x23 }, { "PageUp", 0x21 }, { "PageDown", 0x22 }, { "Left", 0x25 },
            { "Up", 0x26 }, { "Right", 0x27 }, { "Down", 0x28 }, { "Menu", 0x5D }, { "Plus", 0xBB }, { "Minus", 0xBD },
            { "Comma", 0xBC }, { "Period", 0xBE }, { "Slash", 0xBF },
        };

        // Keys Windows reads as the extended ones (not the number pad's twins).
        static readonly HashSet<ushort> Extended = new HashSet<ushort> { 0x2E, 0x2D, 0x24, 0x23, 0x21, 0x22, 0x25, 0x26, 0x27, 0x28, 0x5D };

        static ushort VirtualKey(string name)
        {
            ushort vk;
            if (Keys.TryGetValue(name, out vk)) return vk;
            if (name.Length == 1 && char.IsLetterOrDigit(name[0])) return char.ToUpperInvariant(name[0]);
            int n;
            if (name.Length >= 2 && (name[0] == 'F' || name[0] == 'f') && int.TryParse(name.Substring(1), out n) && n >= 1 && n <= 24) return (ushort)(0x70 + n - 1);
            throw new StepException("Unknown key " + name);
        }

        static void Press(string combo, int repeat)
        {
            var parts = combo.Split('+');
            var mods = new List<ushort>();
            for (int i = 0; i < parts.Length - 1; i++)
            {
                switch (parts[i])
                {
                    case "Ctrl": mods.Add(0x11); break;
                    case "Alt": mods.Add(0x12); break;
                    case "Shift": mods.Add(0x10); break;
                    default: throw new StepException("Unknown modifier " + parts[i]);
                }
            }
            ushort key = VirtualKey(parts[parts.Length - 1]);
            uint ext = Extended.Contains(key) ? Win.KEYEVENTF_EXTENDEDKEY : 0;
            var inputs = new List<Win.INPUT>();
            foreach (var m in mods) inputs.Add(Key(m, 0, 0));
            for (int i = 0; i < Math.Max(1, Math.Min(repeat, 20)); i++)
            {
                inputs.Add(Key(key, 0, ext));
                inputs.Add(Key(key, 0, ext | Win.KEYEVENTF_KEYUP));
            }
            for (int i = mods.Count - 1; i >= 0; i--) inputs.Add(Key(mods[i], 0, Win.KEYEVENTF_KEYUP));
            Send(inputs.ToArray());
        }

        static void Focus(IntPtr hwnd)
        {
            if (Native.IsIconic(hwnd)) Native.ShowWindow(hwnd, 9);   // SW_RESTORE
            // Windows only lets the program in front hand the front on; joining its input queue for a moment does that.
            uint unused;
            uint front = Native.GetWindowThreadProcessId(Win.GetForegroundWindow(), out unused);
            uint mine = Win.GetCurrentThreadId();
            bool joined = front != 0 && front != mine && Win.AttachThreadInput(mine, front, true);
            try
            {
                Win.BringWindowToTop(hwnd);
                Native.SetForegroundWindow(hwnd);
            }
            finally
            {
                if (joined) Win.AttachThreadInput(mine, front, false);
            }
            Thread.Sleep(150);
            if (AppPid(Win.GetForegroundWindow()) != AppPid(hwnd)) throw new StepException("Windows did not let the window come to the front.");
        }
    }

    /// <summary>The Windows calls computer control needs, beside the shared ones in Native.</summary>
    static class Win
    {
        public const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
        public const uint MOUSEEVENTF_MOVE = 0x1, MOUSEEVENTF_LEFTDOWN = 0x2, MOUSEEVENTF_LEFTUP = 0x4, MOUSEEVENTF_RIGHTDOWN = 0x8,
            MOUSEEVENTF_RIGHTUP = 0x10, MOUSEEVENTF_WHEEL = 0x800, MOUSEEVENTF_HWHEEL = 0x1000, MOUSEEVENTF_VIRTUALDESK = 0x4000,
            MOUSEEVENTF_ABSOLUTE = 0x8000;
        public const uint KEYEVENTF_EXTENDEDKEY = 0x1, KEYEVENTF_KEYUP = 0x2, KEYEVENTF_UNICODE = 0x4;
        public const uint GA_ROOT = 2, GW_OWNER = 4;
        public const int GWL_EXSTYLE = -20;
        public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000, TOKEN_QUERY = 0x8;
        public const int TokenElevation = 20;
        public const uint SRCCOPY = 0x00CC0020, CAPTUREBLT = 0x40000000;

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int x; public int y; }

        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Explicit)]
        public struct InputUnion
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT { public uint type; public InputUnion u; }

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint count, INPUT[] inputs, int size);

        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int x, int y);

        [DllImport("user32.dll")]
        public static extern IntPtr WindowFromPoint(POINT point);

        [DllImport("user32.dll")]
        public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern IntPtr GetWindow(IntPtr hwnd, uint command);

        [DllImport("user32.dll")]
        public static extern int GetWindowLong(IntPtr hwnd, int index);

        [DllImport("user32.dll")]
        public static extern bool EnumChildWindows(IntPtr parent, Native.EnumWindowsProc callback, IntPtr lParam);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool GetTokenInformation(IntPtr token, int infoClass, out int info, int length, out int returned);

        [DllImport("kernel32.dll")]
        public static extern bool CloseHandle(IntPtr handle);

        [DllImport("kernel32.dll")]
        public static extern uint GetCurrentThreadId();

        [DllImport("gdi32.dll")]
        public static extern bool BitBlt(IntPtr dest, int x, int y, int width, int height, IntPtr source, int sx, int sy, uint rop);

        [DllImport("user32.dll")]
        public static extern bool AttachThreadInput(uint from, uint to, bool attach);

        [DllImport("user32.dll")]
        public static extern bool BringWindowToTop(IntPtr hwnd);
    }
}
