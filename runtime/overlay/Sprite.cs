// A bot's own pixel art: the look of a bot that was made by describing it to Claude.
//
// The art is data in the bot's profile (shared/config.mjs checks it): a grid of cells, a few colours, and a
// picture, or a few played in turn, for each state the bot can be in. Only the resting picture is required.
// A state without a picture of its own shows the resting one, moved a little: it sways while it thinks,
// bobs while it works and hops when it is done, so even one picture makes a bot that is alive.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace MiniBot
{
    public class Sprite
    {
        public int Width, Height;
        /// <summary>Tells one piece of art from another, so the bot is redrawn when it changes.</summary>
        public string Key = "";

        readonly Dictionary<char, Color> palette = new Dictionary<char, Color>();
        readonly Dictionary<string, List<string[]>> frames = new Dictionary<string, List<string[]>>();
        int inkLeft, inkRight;   // the columns the resting picture fills, for the shadow under it

        static readonly Dictionary<string, Sprite> cache = new Dictionary<string, Sprite>();

        /// <summary>The art of a profile, or null when it has none that can be drawn.</summary>
        public static Sprite From(Dictionary<string, object> profile)
        {
            var raw = Json.Obj(profile, "sprite");
            if (raw.Count == 0) return null;
            string text;
            try { text = Json.Write(raw); }
            catch (Exception) { return null; }
            Sprite known;
            if (cache.TryGetValue(text, out known)) return known;
            Sprite made;
            try { made = Parse(raw); }
            catch (Exception) { made = null; }
            if (made != null) made.Key = text.Length + ":" + text.GetHashCode();
            if (cache.Count > 40) cache.Clear();
            cache[text] = made;
            return made;
        }

        static Sprite Parse(Dictionary<string, object> raw)
        {
            var s = new Sprite { Width = Json.Int(raw, "width"), Height = Json.Int(raw, "height") };
            if (s.Width < 4 || s.Width > 64 || s.Height < 4 || s.Height > 64) return null;
            foreach (var entry in Json.Obj(raw, "palette"))
            {
                var hex = entry.Value as string;
                if (entry.Key.Length != 1 || hex == null) return null;
                s.palette[entry.Key[0]] = ColorTranslator.FromHtml(hex);
            }
            foreach (var entry in Json.Obj(raw, "frames"))
            {
                var pictures = entry.Value as object[];
                if (pictures == null || pictures.Length == 0) return null;
                // One picture (its rows), or a few of them.
                if (pictures[0] is string) pictures = new object[] { pictures };
                var list = new List<string[]>();
                foreach (var picture in pictures)
                {
                    var rows = picture as object[];
                    if (rows == null || rows.Length != s.Height) return null;
                    var lines = new string[s.Height];
                    for (int y = 0; y < s.Height; y++)
                    {
                        var row = rows[y] as string;
                        if (row == null || row.Length != s.Width) return null;
                        lines[y] = row;
                    }
                    list.Add(lines);
                }
                s.frames[entry.Key] = list;
            }
            if (!s.frames.ContainsKey("idle")) return null;
            s.inkLeft = s.Width;
            s.inkRight = -1;
            foreach (var row in s.frames["idle"][0])
                for (int x = 0; x < s.Width; x++)
                    if (s.palette.ContainsKey(row[x])) { s.inkLeft = Math.Min(s.inkLeft, x); s.inkRight = Math.Max(s.inkRight, x); }
            if (s.inkRight < 0) return null;
            return s;
        }

        /// <summary>The size of one cell when the art is drawn across `s` pixels: whole pixels, and a tall bot is not let grow past a quarter more than its width.</summary>
        public int Unit(float s)
        {
            return Math.Max(1, Math.Min((int)Math.Floor(s / Width), (int)Math.Floor(s * 1.25f / Height)));
        }

        /// <summary>The height the art takes when drawn across `s` pixels, with the row for its shadow.</summary>
        public int ArtHeight(float s)
        {
            return (Height + 1) * Unit(s);
        }

        List<string[]> Of(string state)
        {
            List<string[]> list;
            return frames.TryGetValue(state, out list) ? list : null;
        }

        static string StateFor(string phase, bool listening)
        {
            if (listening) return "listening";
            switch (phase)
            {
                case "sending":
                case "thinking": return "thinking";
                case "working": return "working";
                case "completed": return "done";
                case "error": return "error";
                default: return "idle";
            }
        }

        static double Period(string state)
        {
            switch (state)
            {
                case "working": return 0.25;
                case "done": return 0.35;
                case "idle": return 0.6;
                default: return 0.5;
            }
        }

        /// <summary>Draws the bot across `s` pixels with its top left at x0, y0, in the state Claude Code is really in.</summary>
        public void Draw(Graphics g, float x0, float y0, float s, Look look, string phase, bool listening, double t)
        {
            int u = Unit(s);
            int ox = (int)Math.Round(x0 + (s - Width * u) / 2f);
            int oy = (int)Math.Round(y0);
            double time = t * (look.Speed == "slow" ? 0.6 : look.Speed == "fast" ? 1.6 : 1.0);

            string state = StateFor(phase, listening);
            var own = Of(state);
            var idle = frames["idle"];
            string[] picture = (own ?? idle)[0];
            int shift = 0, lift = 0;

            if (!look.Reduced)
            {
                if (own != null && own.Count > 1 && (state != "idle" || look.Idle != "none"))
                {
                    picture = own[(int)(time / Period(state)) % own.Count];
                }
                else if (own == null || own.Count == 1)
                {
                    // One picture for this state, or none of its own: it moves instead.
                    if (state == "thinking") shift = new[] { -1, 0, 1, 0 }[(int)(time / 0.5) % 4];
                    else if (state == "working") lift = (int)(time / 0.18) % 2;
                    else if (state == "done") lift = (int)(time / 0.35) % 2 == 0 ? 2 : 0;
                }
                if (state == "idle" && look.Idle != "none")
                {
                    var blink = Of("blink");
                    if (blink != null && time % 4.2 < 0.15) picture = blink[0];
                    if (look.Idle == "lively" && time % 9.0 >= 3.9 && time % 9.0 < 4.15) lift = 1;
                }

                // Something is being dropped on it, or was just: it hops, shakes its head or shuts its eyes as the meal goes.
                if (look.Meal != null)
                {
                    var meal = look.Meal.Pose();
                    picture = idle[0];
                    shift = meal.Shake;
                    lift = meal.Hop ? 2 : meal.Arms == "up" ? 1 : 0;
                    var blink = Of("blink");
                    if (blink != null && (meal.Eyes == "closed" || meal.Squash)) picture = blink[0];
                    var glad = Of("done");
                    if (glad != null && meal.Hop) picture = glad[0];
                }
            }

            var oldSmoothing = g.SmoothingMode;
            var oldOffset = g.PixelOffsetMode;
            g.SmoothingMode = SmoothingMode.None;
            g.PixelOffsetMode = PixelOffsetMode.Half;
            var brushes = new Dictionary<char, SolidBrush>();
            try
            {
                using (var shade = new SolidBrush(Color.FromArgb(lift > 0 ? 35 : 60, 0, 0, 0)))
                {
                    int from = inkLeft, to = inkRight;
                    if (to - from >= 4) { from += 1; to -= 1; }
                    g.FillRectangle(shade, ox + from * u, oy + Height * u, (to - from + 1) * u, u);
                }
                for (int y = 0; y < Height; y++)
                {
                    string row = picture[y];
                    int x = 0;
                    while (x < Width)
                    {
                        char cell = row[x];
                        int run = 1;
                        while (x + run < Width && row[x + run] == cell) run++;
                        Color colour;
                        if (palette.TryGetValue(cell, out colour))
                        {
                            SolidBrush brush;
                            if (!brushes.TryGetValue(cell, out brush)) brushes[cell] = brush = new SolidBrush(colour);
                            g.FillRectangle(brush, ox + (x + shift) * u, oy + (y - lift) * u, run * u, u);
                        }
                        x += run;
                    }
                }
            }
            finally
            {
                foreach (var brush in brushes.Values) brush.Dispose();
                g.SmoothingMode = oldSmoothing;
                g.PixelOffsetMode = oldOffset;
            }
        }
    }
}
