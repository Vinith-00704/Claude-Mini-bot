// Reads the words of the page in a window, for "summarize this page": a web page in a browser, a document in
// Word, a text file in Notepad. It reads through Windows' accessibility interface, the one screen readers use,
// so it gets the whole page and not only the part on the screen, and it works on pages the person is signed in
// to, because it reads what their own browser already shows. It never clicks, scrolls or types anything.
//
// It runs on computer control's worker thread, for one window the runtime named, and only after the runtime
// has decided the read may happen. Password fields are never read.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Automation;

namespace MiniBot
{
    public class PageText
    {
        public string Text = "";
        public string Url = "";
        public bool Truncated;
        /// <summary>How the words were got: "text" (the page handed them over whole), "tree" (gathered piece by piece), or "" (none).</summary>
        public string How = "";
    }

    public static class PageReader
    {
        const int MaxNodes = 15000;
        const int MinUseful = 80;

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern int GetClassNameW(IntPtr hwnd, StringBuilder name, int size);

        public static PageText Read(IntPtr hwnd, int maxChars, int budgetMs)
        {
            var watch = Stopwatch.StartNew();
            var page = new PageText();
            AutomationElement root = AutomationElement.FromHandle(hwnd);
            AutomationElement document = null;
            string words = "";

            // A browser builds what it tells other programs about a page only once one of them asks, so the first
            // look can come back with nothing. It is asked again, a few times, before the page is given up on.
            for (int attempt = 0; attempt < 7 && watch.ElapsedMilliseconds < budgetMs - 2500; attempt++)
            {
                if (attempt > 0) Thread.Sleep(500);
                document = FindDocument(root, hwnd);
                if (document == null) continue;
                words = Clean(FromPattern(document, maxChars));
                page.How = "text";
                if (words.Length >= MinUseful) break;
                words = Clean(FromTree(document, maxChars, watch, budgetMs - 1500));
                page.How = "tree";
                if (words.Length >= MinUseful) break;
            }

            // Not a page at all (a spreadsheet, a settings window): whatever the window names is better than nothing.
            if (words.Length < MinUseful && watch.ElapsedMilliseconds < budgetMs - 1500)
            {
                string named = Clean(FromTree(root, maxChars, watch, budgetMs - 800));
                if (named.Length > words.Length) { words = named; page.How = "tree"; }
            }
            if (words.Length < MinUseful) page.How = "";

            if (words.Length > maxChars)
            {
                int cut = words.LastIndexOf('\n', maxChars - 1, Math.Min(600, maxChars));
                words = words.Substring(0, cut > 0 ? cut : maxChars).TrimEnd();
                page.Truncated = true;
            }
            page.Text = words;
            if (watch.ElapsedMilliseconds < budgetMs - 300) page.Url = UrlOf(document, root, watch, budgetMs);
            return page;
        }

        // ---- finding the page inside the window ----

        static string ClassOf(IntPtr hwnd)
        {
            var name = new StringBuilder(80);
            GetClassNameW(hwnd, name, name.Capacity);
            return name.ToString();
        }

        static double Area(AutomationElement el)
        {
            try
            {
                var r = el.Current.BoundingRectangle;
                return r.IsEmpty || double.IsInfinity(r.Width) || double.IsNaN(r.Width) ? 0 : r.Width * r.Height;
            }
            catch (Exception) { return 0; }
        }

        static AutomationElement Largest(AutomationElementCollection found, bool needsText)
        {
            AutomationElement best = null;
            double bestArea = 0;
            foreach (AutomationElement el in found)
            {
                try
                {
                    if (el.Current.IsPassword) continue;
                    object pattern;
                    if (needsText && !el.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) continue;
                    double area = Area(el);
                    if (best == null || area > bestArea) { best = el; bestArea = area; }
                }
                catch (ElementNotAvailableException) { }
            }
            return best;
        }

        static AutomationElement FindDocument(AutomationElement root, IntPtr hwnd)
        {
            // Chrome, Edge, Brave and the like draw the page in a child window of their own, which is the page itself.
            IntPtr render = IntPtr.Zero;
            long renderArea = 0;
            Win.EnumChildWindows(hwnd, delegate (IntPtr child, IntPtr unused)
            {
                if (!Native.IsWindowVisible(child) || ClassOf(child) != "Chrome_RenderWidgetHostHWND") return true;
                Native.RECT r;
                if (!Native.GetWindowRect(child, out r)) return true;
                long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
                if (area > renderArea) { render = child; renderArea = area; }
                return true;
            }, IntPtr.Zero);
            if (render != IntPtr.Zero)
            {
                try
                {
                    var page = AutomationElement.FromHandle(render);
                    if (page != null) return page;
                }
                catch (Exception) { }
            }

            // Anything else: the largest thing in the window that calls itself a document, or failing that the largest text box.
            Func<AutomationElement> search = delegate
            {
                var documents = root.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document));
                var best = Largest(documents, false);
                if (best != null) return best;
                var boxes = root.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit));
                return Largest(boxes, true);
            };
            var task = Task.Run(search);
            try { return task.Wait(4000) ? task.Result : null; }
            catch (AggregateException) { return null; }
        }

        // ---- getting the words ----

        /// <summary>The whole text, where the page hands it over in one piece.</summary>
        static string FromPattern(AutomationElement document, int maxChars)
        {
            try
            {
                if (document.Current.IsPassword) return "";
                object pattern;
                if (!document.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) return "";
                return ((TextPattern)pattern).DocumentRange.GetText(maxChars + 2000) ?? "";
            }
            catch (Exception) { return ""; }
        }

        /// <summary>The words gathered piece by piece, in reading order: what each smallest part of the page is called.</summary>
        static string FromTree(AutomationElement top, int maxChars, Stopwatch watch, int deadlineMs)
        {
            var text = new StringBuilder();
            try
            {
                var cache = new CacheRequest();
                cache.Add(AutomationElement.NameProperty);
                cache.Add(AutomationElement.ControlTypeProperty);
                cache.Add(AutomationElement.IsPasswordProperty);
                string last = "";
                using (cache.Activate())
                {
                    var walker = TreeWalker.ControlViewWalker;
                    var stack = new Stack<AutomationElement>();
                    var first = walker.GetFirstChild(top, cache);
                    if (first != null) stack.Push(first);
                    int visited = 0;
                    while (stack.Count > 0 && visited < MaxNodes && text.Length <= maxChars && watch.ElapsedMilliseconds < deadlineMs)
                    {
                        var el = stack.Pop();
                        visited++;
                        try
                        {
                            var next = walker.GetNextSibling(el, cache);
                            if (next != null) stack.Push(next);
                            var c = el.Cached;
                            if (c.IsPassword) continue;
                            var child = walker.GetFirstChild(el, cache);
                            if (child != null) { stack.Push(child); continue; }
                            // A part with nothing inside it: its name is the words it shows.
                            string name = (c.Name ?? "").Trim();
                            if (name.Length == 0 || name == last) continue;
                            // Scroll bars and window buttons are not the page.
                            if (c.ControlType == ControlType.ScrollBar || c.ControlType == ControlType.Thumb || c.ControlType == ControlType.TitleBar) continue;
                            last = name;
                            if (text.Length > 0) text.Append(name.Length <= 2 && c.ControlType == ControlType.Text ? " " : "\n");
                            text.Append(name);
                        }
                        catch (ElementNotAvailableException) { }
                    }
                }
            }
            catch (Exception) { }
            return text.ToString();
        }

        static string Clean(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return "";
            var text = new StringBuilder(raw.Length);
            foreach (char ch in raw)
            {
                if (ch == '￼' || ch == '​' || ch == '﻿') continue;        // a picture's place holder, and marks that show nothing
                if (ch == '\r') continue;
                if (ch == ' ' || ch == '\t') { text.Append(' '); continue; }
                if (ch < ' ' && ch != '\n') continue;
                text.Append(ch);
            }
            string tidy = Regex.Replace(text.ToString(), @"[ ]{2,}", " ");
            tidy = Regex.Replace(tidy, @" *\n *", "\n");
            tidy = Regex.Replace(tidy, @"\n{3,}", "\n\n");
            return tidy.Trim();
        }

        // ---- the address ----

        static bool IsAddress(string value)
        {
            return value != null && value.Length < 2000 && Regex.IsMatch(value, @"^(https?|file)://\S+$", RegexOptions.IgnoreCase);
        }

        static string ValueOf(AutomationElement el)
        {
            try
            {
                object pattern;
                return el.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) ? ((ValuePattern)pattern).Current.Value ?? "" : "";
            }
            catch (Exception) { return ""; }
        }

        static string UrlOf(AutomationElement document, AutomationElement root, Stopwatch watch, int budgetMs)
        {
            // A browser gives the page's address as the page's own value.
            if (document != null)
            {
                string value = ValueOf(document).Trim();
                if (IsAddress(value)) return value;
            }
            // Failing that, the address bar: a text box near the top of the window, outside the page, that holds an address.
            try
            {
                var cache = new CacheRequest();
                cache.Add(AutomationElement.ControlTypeProperty);
                using (cache.Activate())
                {
                    var walker = TreeWalker.ControlViewWalker;
                    var queue = new Queue<KeyValuePair<AutomationElement, int>>();
                    queue.Enqueue(new KeyValuePair<AutomationElement, int>(root, 0));
                    int visited = 0;
                    while (queue.Count > 0 && visited < 500 && watch.ElapsedMilliseconds < budgetMs)
                    {
                        var item = queue.Dequeue();
                        for (var el = walker.GetFirstChild(item.Key, cache); el != null && visited < 500; el = walker.GetNextSibling(el, cache))
                        {
                            visited++;
                            var type = el.Cached.ControlType;
                            if (type == ControlType.Document) continue;   // the page itself is not searched
                            if (type == ControlType.Edit)
                            {
                                string value = ValueOf(el).Trim();
                                if (IsAddress(value)) return value;
                                // Browsers leave "https://" off what the bar shows.
                                if (Regex.IsMatch(value, @"^[\w-]+(\.[\w-]+)+(:\d+)?(/\S*)?$") && value.Length < 2000) return "https://" + value;
                            }
                            if (item.Value < 12) queue.Enqueue(new KeyValuePair<AutomationElement, int>(el, item.Value + 1));
                        }
                    }
                }
            }
            catch (Exception) { }
            return "";
        }
    }
}
