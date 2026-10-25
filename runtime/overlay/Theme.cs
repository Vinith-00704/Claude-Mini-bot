// Sizes, fonts and colours. One scale factor for the screen's DPI, and the
// palettes the panel and dialogs draw with.
//
// The dark and light palettes are Claude Code's own: the values below are the
// ones in its theme (claude, claudeShimmer, text, inactive, subtle, promptBorder,
// success, error, warning, permission, userMessageBackground and the rest), so the
// panel reads as a small piece of the terminal. A bot's accent colour replaces
// `claude` only if the person picks another one.

using System;
using System.Drawing;

namespace MiniBot
{
    public class Palette
    {
        public Color Bg, Fg, Muted, Subtle, Field, UserMessage, Border, Accent, Shimmer, AccentText;
        public Color Success, Warning, Danger, Permission;
        public bool IsDark;
    }

    public static class Ui
    {
        public static float Scale = 1f;
        static string monoFace;

        public static void Init()
        {
            using (var g = Graphics.FromHwnd(IntPtr.Zero)) Scale = Math.Max(1f, g.DpiX / 96f);
        }

        public static int Px(int value) { return (int)Math.Round(value * Scale); }

        /// <summary>The other way round: screen pixels back to the 100% pixels the configuration stores.</summary>
        public static int Unpx(int value) { return (int)Math.Round(value / Scale); }

        public static Font Font(float points, FontStyle style = FontStyle.Regular)
        {
            return new Font("Segoe UI", points, style, GraphicsUnit.Point);
        }

        /// <summary>The terminal font: Cascadia Mono where it exists, else Consolas.</summary>
        public static Font Mono(float points, FontStyle style = FontStyle.Regular)
        {
            if (monoFace == null)
            {
                monoFace = "Consolas";
                foreach (var family in FontFamily.Families)
                    if (family.Name == "Cascadia Mono") { monoFace = "Cascadia Mono"; break; }
            }
            return new Font(monoFace, points, style, GraphicsUnit.Point);
        }

        public static Color Hex(string hex)
        {
            return ColorTranslator.FromHtml(hex);
        }

        public static Color Rgb(int r, int g, int b) { return Color.FromArgb(r, g, b); }

        /// <summary>The body colour of the character. 'claude' is Claude Code's clawd_body.</summary>
        public static Color Skin(string name)
        {
            switch (name)
            {
                case "sunrise": return Hex("#F4A259");
                case "ocean": return Hex("#5AA9E6");
                case "forest": return Hex("#62B77F");
                case "berry": return Hex("#B76BC9");
                case "slate": return Hex("#8E9AAF");
                default: return Rgb(215, 119, 87);
            }
        }

        public static Color AccentColor(string name)
        {
            switch (name)
            {
                case "blue": return Hex("#4C8DFF");
                case "green": return Hex("#2FBF71");
                case "pink": return Hex("#EF5DA8");
                case "orange": return Hex("#F58F29");
                case "purple": return Hex("#8E5CF0");
                default: return Rgb(215, 119, 87);
            }
        }

        public static Color Mix(Color a, Color b, float t)
        {
            return Color.FromArgb(
                (int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));
        }

        public static Color Darken(Color c, float amount) { return Mix(c, Color.Black, amount); }
        public static Color Lighten(Color c, float amount) { return Mix(c, Color.White, amount); }

        public static Palette PaletteFor(string theme, string accent)
        {
            bool light = theme == "light";
            var a = AccentColor(accent);
            // Claude Code's own shimmer for its own colour; a computed one for the others.
            var shimmer = accent == "claude" || accent == null || accent == ""
                ? (light ? Rgb(245, 149, 117) : Rgb(235, 159, 127))
                : Lighten(a, 0.3f);
            if (light)
            {
                return new Palette
                {
                    IsDark = false,
                    Bg = Rgb(255, 255, 255), Fg = Rgb(0, 0, 0), Muted = Rgb(102, 102, 102), Subtle = Rgb(175, 175, 175),
                    Field = Rgb(245, 245, 245), UserMessage = Rgb(240, 240, 240), Border = Rgb(138, 138, 138),
                    Accent = a, Shimmer = shimmer, AccentText = Color.White,
                    Success = Rgb(44, 122, 57), Warning = Rgb(150, 108, 30), Danger = Rgb(171, 43, 63), Permission = Rgb(87, 105, 247)
                };
            }
            return new Palette
            {
                IsDark = true,
                Bg = Rgb(0, 0, 0), Fg = Rgb(255, 255, 255), Muted = Rgb(153, 153, 153), Subtle = Rgb(80, 80, 80),
                Field = Rgb(38, 38, 38), UserMessage = Rgb(55, 55, 55), Border = Rgb(136, 136, 136),
                Accent = a, Shimmer = shimmer, AccentText = Color.White,
                Success = Rgb(78, 186, 101), Warning = Rgb(255, 193, 7), Danger = Rgb(255, 107, 128), Permission = Rgb(177, 185, 249)
            };
        }
    }
}
