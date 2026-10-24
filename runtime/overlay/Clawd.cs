// Clawd, Claude Code's mascot, as the flat pixel art in the reference image.
//
// The sprite is measured from that image: a grid 24 cells wide and 15 high.
//
//   body   cols 3-20, rows 0-11      eyes   1 wide, 3 high, at cols 6 and 17, rows 3-5
//   arms   3 x 3 cells, either side  legs   2 wide, 3 high: cols 4-5, 7-8, 15-16, 18-19
//
// Claude Code poses the mascot with a few parts (eyes: open, left, right, closed,
// wink; arms: down, up, one up; feet: both, left, right). The same parts are used
// here, and the pose follows what Claude Code is really doing.

using System;
using System.Drawing;
using System.Drawing.Drawing2D;

namespace MiniBot
{
    public static class Clawd
    {
        struct Pose
        {
            public string Eyes, Arms, Feet;
            public bool Hop;
        }

        static readonly Color EyeColor = Color.FromArgb(18, 14, 14);

        static Pose PoseFor(Look look, string phase, bool listening, double t)
        {
            var rest = new Pose { Eyes = "open", Arms = "down", Feet = "both", Hop = false };
            if (look.Reduced) return phase == "error" ? new Pose { Eyes = "closed", Arms = "down", Feet = "both" } : rest;

            double sf = look.Speed == "slow" ? 0.6 : look.Speed == "fast" ? 1.6 : 1.0;
            double time = t * sf;

            if (listening) return new Pose { Eyes = "open", Arms = "up", Feet = "both" };

            switch (phase)
            {
                case "sending":
                case "thinking":
                    // Looking around while it thinks.
                    string[] around = { "left", "open", "right", "open" };
                    return new Pose { Eyes = around[(int)(time / 0.5) % 4], Arms = "down", Feet = "both" };
                case "working":
                    // Feet alternate, and an arm goes up and down, as if typing.
                    return new Pose
                    {
                        Eyes = "open",
                        Arms = (int)(time / 0.3) % 2 == 0 ? "down" : "one-up",
                        Feet = (int)(time / 0.15) % 2 == 0 ? "left" : "right"
                    };
                case "completed":
                    return new Pose { Eyes = "open", Arms = "up", Feet = "both", Hop = (int)(time / 0.35) % 2 == 0 };
                case "error":
                    return new Pose { Eyes = "closed", Arms = "down", Feet = "both" };
            }

            if (look.Idle == "none") return rest;

            // Idle: a slow loop of blinking and glancing about; "lively" adds a wave and a hop.
            double c = time % 9.0;
            string eyes = "open";
            if (c >= 2.8 && c < 2.95) eyes = "closed";
            else if (c >= 4.6 && c < 5.4) eyes = "left";
            else if (c >= 5.4 && c < 6.2) eyes = "right";
            else if (c >= 6.9 && c < 7.05) eyes = "closed";
            var pose = new Pose { Eyes = eyes, Arms = "down", Feet = "both" };
            if (look.Idle == "lively")
            {
                if (c >= 7.4 && c < 8.2) pose.Arms = (int)(c / 0.2) % 2 == 0 ? "up" : "one-up";
                if (c >= 3.9 && c < 4.15) pose.Hop = true;
                if (c >= 8.3 && c < 8.45) pose.Eyes = "wink";
            }
            return pose;
        }

        /// <summary>Draws Clawd across `s` pixels (a whole number of 24 cells) with its top left at x0, y0.</summary>
        public static void Draw(Graphics g, float x0, float y0, float s, Look look, string phase, bool listening, double t)
        {
            int u = Math.Max(1, (int)Math.Floor(s / 24f));
            int ox = (int)Math.Round(x0 + (s - 24 * u) / 2f);
            int oy = (int)Math.Round(y0);
            var pose = PoseFor(look, phase, listening, t);
            int lift = pose.Hop ? u : 0;
            Color body = Ui.Skin(look.Skin);

            var oldSmoothing = g.SmoothingMode;
            var oldOffset = g.PixelOffsetMode;
            g.SmoothingMode = SmoothingMode.None;
            g.PixelOffsetMode = PixelOffsetMode.Half;
            using (var shade = new SolidBrush(Color.FromArgb(pose.Hop ? 35 : 60, 0, 0, 0)))
            using (var fill = new SolidBrush(body))
            using (var ink = new SolidBrush(EyeColor))
            {
                Action<Brush, int, int, int, int> cells = (brush, col, row, cols, rows) =>
                    g.FillRectangle(brush, ox + col * u, oy + row * u - lift, cols * u, rows * u);

                g.FillRectangle(shade, ox + 4 * u, oy + 15 * u, 16 * u, u);

                // Body, then the eyes as dark cells on it.
                cells(fill, 3, 0, 18, 12);
                int shift = pose.Eyes == "left" ? -1 : pose.Eyes == "right" ? 1 : 0;
                switch (pose.Eyes)
                {
                    case "closed":
                        cells(ink, 5, 4, 3, 1);
                        cells(ink, 16, 4, 3, 1);
                        break;
                    case "wink":
                        cells(ink, 6, 3, 1, 3);
                        cells(ink, 16, 4, 3, 1);
                        break;
                    default:
                        cells(ink, 6 + shift, 3, 1, 3);
                        cells(ink, 17 + shift, 3, 1, 3);
                        break;
                }

                // Arms.
                int leftArm = pose.Arms == "up" ? 2 : 6;
                int rightArm = pose.Arms == "up" || pose.Arms == "one-up" ? 2 : 6;
                cells(fill, 0, leftArm, 3, 3);
                cells(fill, 21, rightArm, 3, 3);

                // Legs: all four, or one pair while it walks.
                if (pose.Feet != "right")
                {
                    cells(fill, 4, 12, 2, 3);
                    cells(fill, 7, 12, 2, 3);
                }
                if (pose.Feet != "left")
                {
                    cells(fill, 15, 12, 2, 3);
                    cells(fill, 18, 12, 2, 3);
                }
            }
            g.SmoothingMode = oldSmoothing;
            g.PixelOffsetMode = oldOffset;
        }
    }
}
