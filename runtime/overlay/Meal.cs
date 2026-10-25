// The bot eating what is dropped on it. This is only the timing and the pose of that little
// animation (how wide the mouth is, whether the body is pressed down, where the flying file
// is); the drawing is in Clawd.cs and Painter.cs.
//
//   open    a drag with files is over the bot: arms up, mouth wide open, waiting
//   eat     the drop: the file flies to the mouth, two or three chews, a swallow, then it is
//           pleased (hops), or pulls a face if it is a kind Claude may not open directly
//   refuse  nothing could be taken: it shuts its eyes and shakes its head

using System;
using System.Diagnostics;
using System.Drawing;

namespace MiniBot
{
    public struct MealPose
    {
        public int Mouth;        // 0 none, 1 shut (a line), 2 half open, 3 wide open
        public bool Tongue;
        public bool Squash;      // the body is pressed down by one cell, as in a chew
        public string Eyes;      // open or closed
        public string Arms;      // down, up or one-up
        public bool Hop;
        public int Shake;        // -1, 0 or 1: a step to one side while it says no
        public double Fly;       // how far the file has come toward the mouth, 0 to 1; -1 when none is flying
    }

    public class Meal
    {
        public const string Open = "open", Eat = "eat", Refuse = "refuse";

        const double FlySeconds = 0.40;
        const double ChewSeconds = 0.28;
        const double SwallowSeconds = 0.25;
        const double FinishSeconds = 0.45;
        const double RefuseSeconds = 0.80;

        public readonly string Stage;
        public readonly int Count;        // how many things were taken
        public readonly bool Meh;         // one of them is a kind Claude may not open directly
        public readonly PointF? From;     // where the drop landed, in the bot window's own coordinates
        readonly int cycles;
        readonly long started = Stopwatch.GetTimestamp();

        Meal(string stage, int count, bool meh, bool big, PointF? from)
        {
            Stage = stage;
            Count = Math.Max(1, count);
            Meh = meh;
            From = from;
            cycles = 2 + (Count > 1 ? 1 : 0) + (big ? 1 : 0);
        }

        /// <summary>A drag with files is over the bot.</summary>
        public static Meal Hover() { return new Meal(Open, 1, false, false, null); }

        /// <summary>Files were dropped. `from` is where, if it was on the bot itself.</summary>
        public static Meal Take(int count, bool meh, bool big, PointF? from) { return new Meal(Eat, count, meh, big, from); }

        /// <summary>Nothing could be taken.</summary>
        public static Meal Decline() { return new Meal(Refuse, 1, false, false, null); }

        public double Elapsed { get { return (Stopwatch.GetTimestamp() - started) / (double)Stopwatch.Frequency; } }

        double Length
        {
            get
            {
                if (Stage == Open) return double.MaxValue;
                if (Stage == Refuse) return RefuseSeconds;
                return FlySeconds + cycles * ChewSeconds + SwallowSeconds + FinishSeconds;
            }
        }

        public bool Done { get { return Elapsed >= Length; } }

        public MealPose Pose()
        {
            double e = Elapsed;
            var p = new MealPose { Eyes = "open", Arms = "down", Fly = -1 };

            if (Stage == Open)
            {
                p.Arms = "up";
                p.Mouth = e % 0.8 < 0.5 ? 3 : 2;
                p.Tongue = p.Mouth == 3;
                return p;
            }
            if (Stage == Refuse)
            {
                p.Eyes = "closed";
                p.Shake = (int)(e / 0.1) % 2 == 0 ? -1 : 1;
                return p;
            }

            if (e < FlySeconds)
            {
                p.Arms = "up";
                p.Mouth = 3;
                p.Tongue = true;
                p.Fly = e / FlySeconds;
                return p;
            }
            e -= FlySeconds;

            double chewing = cycles * ChewSeconds;
            if (e < chewing)
            {
                bool shut = e % ChewSeconds >= ChewSeconds / 2;
                p.Mouth = shut ? 1 : 2;
                p.Squash = shut;
                return p;
            }
            e -= chewing;

            if (e < SwallowSeconds)
            {
                p.Eyes = "closed";
                p.Squash = e < SwallowSeconds / 2;
                return p;
            }
            e -= SwallowSeconds;

            if (Meh)
            {
                // A shrug: eyes shut, one arm up.
                p.Eyes = "closed";
                p.Arms = "one-up";
            }
            else
            {
                p.Arms = "up";
                p.Hop = (int)(e / 0.15) % 2 == 0;
            }
            return p;
        }
    }
}
