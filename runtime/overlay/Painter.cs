// Draws the character. The face shows what is really happening (listening,
// thinking, working, done, a problem) and a small badge at the corner says it
// again, so the state reads at a glance even at the smallest size.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;

namespace MiniBot
{
    public class Look
    {
        public string Avatar = "clawd";
        public string Skin = "claude";
        public string Accent = "claude";
        public string Name = "Mini";
        public string Idle = "subtle";   // animation intensity: none, subtle, lively
        public string Speed = "normal";
        public bool Reduced;
        public string Size = "medium";
    }

    public static class Painter
    {
        static readonly Color Ink = Color.FromArgb(42, 36, 56);
        static readonly Color Amber = Color.FromArgb(242, 177, 52);
        static readonly Color Green = Color.FromArgb(47, 191, 113);
        static readonly Color Red = Color.FromArgb(229, 72, 77);

        /// <summary>The character's width in pixels: always a whole number of pixel-art cells (24 across).</summary>
        public static int BodyPx(string size)
        {
            int target = size == "small" ? Ui.Px(72) : size == "large" ? Ui.Px(144) : Ui.Px(96);
            return 24 * Math.Max(2, target / 24);
        }

        /// <summary>The height the drawing needs: Clawd is wider than tall (24 by 15 cells, plus a row for its shadow).</summary>
        public static int ArtHeight(string avatar, int s)
        {
            return avatar == "clawd" ? 16 * (s / 24) : s;
        }

        public static int PadX(int s) { return (int)(s * 0.14f); }
        public static int PadTop(int s) { return (int)(s * 0.30f); }
        public static int LabelHeight() { return Ui.Px(20); }

        public static Size WindowSize(Look look)
        {
            int s = BodyPx(look.Size);
            return new Size(s + 2 * PadX(s), PadTop(s) + ArtHeight(look.Avatar, s) + (int)(s * 0.07f) + LabelHeight());
        }

        public static bool IsAnimated(Look look, string phase, bool listening)
        {
            if (look.Reduced) return false;
            if (look.Idle != "none") return true;
            return listening || phase == "sending" || phase == "thinking" || phase == "working";
        }

        static float SpeedFactor(Look look)
        {
            return look.Speed == "slow" ? 0.6f : look.Speed == "fast" ? 1.6f : 1f;
        }

        static GraphicsPath Round(RectangleF r, float radius)
        {
            var p = new GraphicsPath();
            float d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        static Graphics Smooth(Bitmap bmp)
        {
            var g = Graphics.FromImage(bmp);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.TextRenderingHint = TextRenderingHint.AntiAlias;
            return g;
        }

        /// <summary>The floating window's picture: character, effects and name.</summary>
        public static Bitmap RenderWindow(Look look, string phase, bool listening, double t, bool showName)
        {
            var size = WindowSize(look);
            int s = BodyPx(look.Size);
            var bmp = new Bitmap(size.Width, size.Height, PixelFormat32());
            using (var g = Smooth(bmp))
            {
                float x0 = PadX(s), y0 = PadTop(s);
                DrawCharacter(g, x0, y0, s, look, phase, listening, t);
                if (showName) DrawName(g, look.Name, size.Width, y0 + ArtHeight(look.Avatar, s) + s * 0.06f);
            }
            return bmp;
        }

        static System.Drawing.Imaging.PixelFormat PixelFormat32()
        {
            return System.Drawing.Imaging.PixelFormat.Format32bppArgb;
        }

        /// <summary>A still face for small tiles and the tray icon.</summary>
        public static Bitmap RenderIcon(string avatar, string skin, int px)
        {
            var bmp = new Bitmap(px, px, PixelFormat32());
            using (var g = Smooth(bmp))
            {
                var look = new Look { Avatar = avatar, Skin = skin, Idle = "none", Reduced = true };
                DrawCharacter(g, px * 0.04f, px * 0.04f, px * 0.92f, look, "idle", false, 0);
            }
            return bmp;
        }

        static void DrawName(Graphics g, string name, int width, float y)
        {
            using (var font = Ui.Font(8.5f, FontStyle.Bold))
            using (var format = new StringFormat { Alignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap })
            {
                var measured = g.MeasureString(name, font);
                float w = Math.Min(width - 4, measured.Width + Ui.Px(14));
                float h = Ui.Px(18);
                var pill = new RectangleF((width - w) / 2f, y, w, h);
                using (var path = Round(pill, h / 2f))
                using (var fill = new SolidBrush(Color.FromArgb(190, 22, 25, 34)))
                    g.FillPath(fill, path);
                using (var text = new SolidBrush(Color.White))
                    g.DrawString(name, font, text, new RectangleF(pill.X, pill.Y + Ui.Px(1), pill.Width, pill.Height), format);
            }
        }

        public static void DrawCharacter(Graphics g, float x0, float y0, float s, Look look, string phase, bool listening, double t)
        {
            if (look.Avatar == "clawd")
            {
                Clawd.Draw(g, x0, y0, s, look, phase, listening, t);
                DrawMark(g, x0, y0, s, phase, listening, Ui.AccentColor(look.Accent), t, look.Reduced);
                return;
            }
            bool animated = IsAnimated(look, phase, listening);
            float sf = SpeedFactor(look);
            bool bobs = !look.Reduced && look.Idle != "none";
            float amp = look.Idle == "lively" ? 0.035f : 0.015f;
            float bob = bobs ? (float)Math.Sin(t * 2.2 * sf) * s * amp : 0f;
            bool blink = bobs && (t * sf) % 4.2 < 0.13;
            Color skin = Ui.Skin(look.Skin);
            Color accent = Ui.AccentColor(look.Accent);

            string mood = listening ? "listening"
                : phase == "completed" ? "happy"
                : phase == "error" ? "worried"
                : phase == "thinking" || phase == "sending" ? "thinking"
                : phase == "working" ? "focused"
                : "idle";

            // Shadow, drawn first and shrinking a little as the character rises.
            using (var shadow = new SolidBrush(Color.FromArgb(55, 0, 0, 0)))
            {
                float sw = s * (0.56f - (bob < 0 ? -bob / s : 0) * 1.5f);
                g.FillEllipse(shadow, x0 + (s - sw) / 2f, y0 + s * 0.97f, sw, s * 0.06f);
            }

            if (listening) DrawPulse(g, x0, y0, s, accent, t, look.Reduced);

            RectangleF face;
            DrawBody(g, x0, y0, s, bob, look.Avatar, skin, accent, out face);
            DrawFace(g, face, s, look.Avatar, skin, accent, mood, blink, t);

            DrawMark(g, x0, y0, s, phase, listening, accent, t, look.Reduced);
        }

        static void DrawPulse(Graphics g, float x0, float y0, float s, Color accent, double t, bool reduced)
        {
            float grow = reduced ? 0.5f : (float)((t * 1.2) % 1.0);
            float pad = s * (0.02f + 0.1f * grow);
            using (var pen = new Pen(Color.FromArgb((int)(190 * (1 - grow)), Red), Math.Max(2f, s * 0.03f)))
                g.DrawEllipse(pen, x0 - pad, y0 + s * 0.06f - pad, s + 2 * pad, s * 0.9f + 2 * pad);
        }

        static void DrawBody(Graphics g, float x0, float y0, float s, float bob, string avatar, Color skin, Color accent, out RectangleF face)
        {
            Color rim = Ui.Darken(skin, 0.32f);
            Color top = Ui.Lighten(skin, 0.28f);
            float lw = Math.Max(1.6f, s * 0.028f);
            RectangleF body;
            GraphicsPath path;

            switch (avatar)
            {
                case "robot":
                    body = new RectangleF(x0 + s * 0.10f, y0 + s * 0.20f + bob, s * 0.80f, s * 0.72f);
                    path = Round(body, s * 0.20f);
                    DrawAntenna(g, x0, y0, s, bob, rim, accent);
                    break;
                case "cat":
                    body = new RectangleF(x0 + s * 0.07f, y0 + s * 0.17f + bob, s * 0.86f, s * 0.78f);
                    DrawEars(g, x0, y0, s, bob, skin, rim, new[] { 0.14f, 0.86f }, 0.0f, 0.40f, true);
                    path = new GraphicsPath();
                    path.AddEllipse(body);
                    break;
                case "ghost":
                    body = new RectangleF(x0 + s * 0.12f, y0 + s * 0.10f + bob, s * 0.76f, s * 0.84f);
                    path = GhostPath(body);
                    break;
                case "bunny":
                    body = new RectangleF(x0 + s * 0.08f, y0 + s * 0.32f + bob, s * 0.84f, s * 0.63f);
                    DrawBunnyEars(g, x0, y0, s, bob, skin, rim);
                    path = new GraphicsPath();
                    path.AddEllipse(body);
                    break;
                default:
                    body = new RectangleF(x0 + s * 0.07f, y0 + s * 0.14f + bob, s * 0.86f, s * 0.80f);
                    path = new GraphicsPath();
                    path.AddEllipse(body);
                    break;
            }

            using (path)
            {
                using (var fill = new LinearGradientBrush(body, top, skin, LinearGradientMode.Vertical))
                    g.FillPath(fill, path);
                using (var pen = new Pen(rim, lw) { LineJoin = LineJoin.Round })
                    g.DrawPath(pen, path);
            }
            // A soft highlight, so the body reads as round.
            using (var shine = new SolidBrush(Color.FromArgb(80, 255, 255, 255)))
                g.FillEllipse(shine, body.X + body.Width * 0.16f, body.Y + body.Height * 0.10f, body.Width * 0.22f, body.Height * 0.12f);

            face = avatar == "ghost" ? new RectangleF(body.X, body.Y, body.Width, body.Height * 0.78f) : body;
        }

        static GraphicsPath GhostPath(RectangleF b)
        {
            var p = new GraphicsPath();
            float r = b.Width / 2f;
            p.AddArc(b.X, b.Y, b.Width, b.Width, 180, 180);
            p.AddLine(b.Right, b.Y + r, b.Right, b.Bottom - b.Height * 0.08f);
            float bump = b.Width / 3f;
            for (int i = 0; i < 3; i++)
            {
                float xr = b.Right - i * bump;
                p.AddArc(xr - bump, b.Bottom - bump * 0.55f, bump, bump * 0.55f, 0, 180);
            }
            p.AddLine(b.X, b.Bottom - b.Height * 0.08f, b.X, b.Y + r);
            p.CloseFigure();
            return p;
        }

        static void DrawAntenna(Graphics g, float x0, float y0, float s, float bob, Color rim, Color accent)
        {
            float cx = x0 + s * 0.5f;
            using (var pen = new Pen(rim, Math.Max(2f, s * 0.03f)))
                g.DrawLine(pen, cx, y0 + s * 0.20f + bob, cx, y0 + s * 0.07f + bob);
            using (var glow = new SolidBrush(accent))
                g.FillEllipse(glow, cx - s * 0.05f, y0 + s * 0.02f + bob, s * 0.10f, s * 0.10f);
            using (var side = new SolidBrush(rim))
            {
                g.FillRectangle(side, x0 + s * 0.04f, y0 + s * 0.46f + bob, s * 0.07f, s * 0.20f);
                g.FillRectangle(side, x0 + s * 0.89f, y0 + s * 0.46f + bob, s * 0.07f, s * 0.20f);
            }
        }

        static void DrawEars(Graphics g, float x0, float y0, float s, float bob, Color skin, Color rim, float[] centers, float lift, float height, bool inner)
        {
            foreach (var c in centers)
            {
                float cx = x0 + s * c;
                float dir = c < 0.5f ? 1f : -1f;
                var tri = new[]
                {
                    new PointF(cx - dir * s * 0.02f, y0 + s * 0.34f + bob),
                    new PointF(cx + dir * s * 0.02f, y0 + s * 0.03f + bob),
                    new PointF(cx + dir * s * 0.26f, y0 + s * 0.22f + bob)
                };
                using (var fill = new SolidBrush(skin)) g.FillPolygon(fill, tri);
                using (var pen = new Pen(rim, Math.Max(1.6f, s * 0.028f)) { LineJoin = LineJoin.Round }) g.DrawPolygon(pen, tri);
                if (inner)
                {
                    var small = new[]
                    {
                        new PointF(cx + dir * s * 0.02f, y0 + s * 0.28f + bob),
                        new PointF(cx + dir * s * 0.04f, y0 + s * 0.10f + bob),
                        new PointF(cx + dir * s * 0.17f, y0 + s * 0.22f + bob)
                    };
                    using (var pink = new SolidBrush(Color.FromArgb(200, 255, 150, 170))) g.FillPolygon(pink, small);
                }
            }
        }

        static void DrawBunnyEars(Graphics g, float x0, float y0, float s, float bob, Color skin, Color rim)
        {
            foreach (var cx in new[] { 0.30f, 0.62f })
            {
                var r = new RectangleF(x0 + s * (cx - 0.08f), y0 + s * 0.01f + bob, s * 0.18f, s * 0.48f);
                using (var path = Round(r, s * 0.09f))
                {
                    using (var fill = new SolidBrush(skin)) g.FillPath(fill, path);
                    using (var pen = new Pen(rim, Math.Max(1.6f, s * 0.028f))) g.DrawPath(pen, path);
                }
                var inner = new RectangleF(r.X + r.Width * 0.28f, r.Y + r.Height * 0.14f, r.Width * 0.44f, r.Height * 0.62f);
                using (var path = Round(inner, s * 0.04f))
                using (var pink = new SolidBrush(Color.FromArgb(190, 255, 150, 170)))
                    g.FillPath(pink, path);
            }
        }

        static void DrawFace(Graphics g, RectangleF face, float s, string avatar, Color skin, Color accent, string mood, bool blink, double t)
        {
            float cx = face.X + face.Width / 2f;
            float eyeY = face.Y + face.Height * 0.42f;
            float mouthY = face.Y + face.Height * 0.68f;
            bool robot = avatar == "robot";
            Color eyeColor = robot ? Ui.Lighten(accent, 0.35f) : Ink;

            if (robot)
            {
                var visor = new RectangleF(face.X + face.Width * 0.14f, face.Y + face.Height * 0.22f, face.Width * 0.72f, face.Height * 0.46f);
                using (var path = Round(visor, s * 0.12f))
                using (var fill = new SolidBrush(Color.FromArgb(34, 38, 54)))
                    g.FillPath(fill, path);
                eyeY = visor.Y + visor.Height * 0.48f;
                mouthY = face.Y + face.Height * 0.80f;
            }
            else
            {
                using (var blush = new SolidBrush(Color.FromArgb(105, 255, 125, 150)))
                {
                    float bw = s * 0.11f, bh = s * 0.06f;
                    g.FillEllipse(blush, cx - s * 0.33f, mouthY - bh * 0.7f, bw, bh);
                    g.FillEllipse(blush, cx + s * 0.22f, mouthY - bh * 0.7f, bw, bh);
                }
            }

            float ex = s * 0.17f, ew = s * 0.095f, eh = s * 0.125f;
            float lookX = 0, lookY = 0;
            if (mood == "thinking") { lookX = s * 0.025f; lookY = -s * 0.03f; }
            if (mood == "focused") { eh *= 0.8f; }
            if (mood == "listening") { ew *= 1.15f; eh *= 1.2f; }

            foreach (var side in new[] { -1f, 1f })
            {
                float x = cx + side * ex + lookX, y = eyeY + lookY;
                if (mood == "happy")
                {
                    using (var pen = new Pen(eyeColor, Math.Max(2f, s * 0.035f)) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                        g.DrawArc(pen, x - ew * 0.8f, y - eh * 0.3f, ew * 1.6f, eh * 0.9f, 200, 140);
                }
                else if (blink)
                {
                    using (var pen = new Pen(eyeColor, Math.Max(2f, s * 0.03f)) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                        g.DrawLine(pen, x - ew * 0.7f, y, x + ew * 0.7f, y);
                }
                else
                {
                    using (var fill = new SolidBrush(eyeColor))
                        g.FillEllipse(fill, x - ew / 2f, y - eh / 2f, ew, eh);
                    using (var spark = new SolidBrush(Color.FromArgb(230, 255, 255, 255)))
                        g.FillEllipse(spark, x - ew * 0.05f, y - eh * 0.32f, ew * 0.38f, ew * 0.38f);
                }
            }

            float mw = s * 0.16f;
            Color mouthColor = robot ? Ui.Lighten(accent, 0.35f) : Ink;
            using (var pen = new Pen(mouthColor, Math.Max(2f, s * 0.032f)) { StartCap = LineCap.Round, EndCap = LineCap.Round })
            {
                switch (mood)
                {
                    case "happy":
                        using (var fill = new SolidBrush(mouthColor))
                            g.FillPie(fill, cx - mw * 0.7f, mouthY - mw * 0.35f, mw * 1.4f, mw * 1.0f, 0, 180);
                        break;
                    case "listening":
                        g.DrawEllipse(pen, cx - mw * 0.22f, mouthY - mw * 0.1f, mw * 0.44f, mw * 0.5f);
                        break;
                    case "thinking":
                        g.DrawLine(pen, cx - mw * 0.25f, mouthY + mw * 0.1f, cx + mw * 0.25f, mouthY + mw * 0.1f);
                        break;
                    case "focused":
                        g.DrawLine(pen, cx - mw * 0.35f, mouthY + mw * 0.1f, cx + mw * 0.35f, mouthY + mw * 0.1f);
                        break;
                    case "worried":
                        g.DrawArc(pen, cx - mw * 0.4f, mouthY + mw * 0.05f, mw * 0.8f, mw * 0.5f, 200, 140);
                        break;
                    default:
                        g.DrawArc(pen, cx - mw * 0.5f, mouthY - mw * 0.3f, mw, mw * 0.6f, 20, 140);
                        break;
                }
            }
        }

        /// <summary>
        /// The state mark above the character, in Claude Code's own vocabulary: while it
        /// works the spinner glyph cycles in the accent colour, a finished request shows a
        /// check in the success colour, a problem a mark in the error colour. Listening
        /// is the one exception: a red microphone disc, so recording is never ambiguous.
        /// </summary>
        static void DrawMark(Graphics g, float x0, float y0, float s, string phase, bool listening, Color accent, double t, bool reduced)
        {
            float cx = x0 + s * 0.80f, cy = y0 - s * 0.14f;
            if (listening)
            {
                DrawMic(g, cx, y0 + s * 0.02f, Math.Max(Ui.Px(9), s * 0.15f));
                return;
            }
            string glyph;
            Color color;
            switch (phase)
            {
                case "sending":
                case "thinking":
                case "working":
                    glyph = reduced ? "\u273B" : ClaudeMotion.Glyph(t);
                    color = accent;
                    break;
                case "completed":
                    glyph = "\u2713";
                    color = Ui.Rgb(78, 186, 101);
                    break;
                case "error":
                    glyph = "!";
                    color = Ui.Rgb(255, 107, 128);
                    break;
                default:
                    return;
            }
            float px = Math.Max(Ui.Px(16), s * 0.30f);
            using (var font = new Font("Segoe UI Symbol", px, FontStyle.Bold, GraphicsUnit.Pixel))
            using (var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
            {
                var box = new RectangleF(cx - px, cy - px, 2 * px, 2 * px);
                // A thin dark edge keeps the glyph readable on any desktop.
                using (var edge = new SolidBrush(Color.FromArgb(150, 0, 0, 0)))
                    foreach (var d in new[] { new PointF(-1, 0), new PointF(1, 0), new PointF(0, -1), new PointF(0, 1) })
                        g.DrawString(glyph, font, edge, new RectangleF(box.X + d.X, box.Y + d.Y, box.Width, box.Height), format);
                using (var brush = new SolidBrush(color))
                    g.DrawString(glyph, font, brush, box, format);
            }
        }

        static void DrawMic(Graphics g, float cx, float cy, float r)
        {
            using (var ring = new SolidBrush(Color.White)) g.FillEllipse(ring, cx - r - 1.5f, cy - r - 1.5f, 2 * r + 3, 2 * r + 3);
            using (var fill = new SolidBrush(Red)) g.FillEllipse(fill, cx - r, cy - r, 2 * r, 2 * r);
            using (var pen = new Pen(Color.White, Math.Max(1.6f, r * 0.17f)) { StartCap = LineCap.Round, EndCap = LineCap.Round })
            using (var white = new SolidBrush(Color.White))
            {
                // A capsule, the cup it sits in, and the stand.
                using (var capsule = Shapes.Round(new RectangleF(cx - r * 0.2f, cy - r * 0.62f, r * 0.4f, r * 0.7f), r * 0.2f))
                    g.FillPath(white, capsule);
                g.DrawArc(pen, cx - r * 0.4f, cy - r * 0.38f, r * 0.8f, r * 0.8f, 20, 140);
                g.DrawLine(pen, cx, cy + r * 0.42f, cx, cy + r * 0.62f);
                g.DrawLine(pen, cx - r * 0.2f, cy + r * 0.62f, cx + r * 0.2f, cy + r * 0.62f);
            }
        }
    }
}
