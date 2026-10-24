// Claude Code's own motion, as found in the app: the spinner glyphs, the verbs it
// shows while it works, and the shimmer that sweeps across them.
//
//   frames   · ✢ * ✶ ✻ ✽ played forward and then back (the non-Ghostty set)
//   verbs    "Pondering", "Clauding", ... one is picked per request
//   shimmer  a window of a few characters, in the lighter accent, sweeping over
//            the text and starting from beyond its left edge

using System;

namespace MiniBot
{
    public static class ClaudeMotion
    {
        public const double FrameSeconds = 0.12;
        public const double ShimmerStepSeconds = 0.10;

        static readonly string[] Forward = { "·", "✢", "*", "✶", "✻", "✽" };
        static readonly string[] Frames = BuildFrames();

        static string[] BuildFrames()
        {
            var all = new string[Forward.Length * 2];
            for (int i = 0; i < Forward.Length; i++)
            {
                all[i] = Forward[i];
                all[all.Length - 1 - i] = Forward[i];
            }
            return all;
        }

        /// <summary>The spinner glyph at a moment, in seconds.</summary>
        public static string Glyph(double seconds)
        {
            int i = (int)Math.Floor(seconds / FrameSeconds) % Frames.Length;
            return Frames[i < 0 ? 0 : i];
        }

        /// <summary>The index the shimmer is centred on, for a text of `length` characters.</summary>
        public static int ShimmerCentre(double seconds, int length)
        {
            int step = (int)Math.Floor(seconds / ShimmerStepSeconds);
            return step % (length + 20) - 10;
        }

        /// <summary>True for the characters the shimmer covers (the centre and one either side).</summary>
        public static bool IsShimmering(int index, int centre) { return index >= centre - 1 && index <= centre + 1; }

        static readonly string[] Verbs =
        {
            "Accomplishing", "Actioning", "Actualizing", "Architecting", "Baking", "Beaming", "Beboppin'", "Befuddling",
            "Billowing", "Blanching", "Bloviating", "Boogieing", "Boondoggling", "Booping", "Bootstrapping", "Brewing",
            "Bunning", "Burrowing", "Calculating", "Caramelizing", "Cascading", "Catapulting", "Cerebrating", "Channeling",
            "Choreographing", "Churning", "Clauding", "Coalescing", "Cogitating", "Combobulating", "Composing", "Computing",
            "Concocting", "Considering", "Contemplating", "Cooking", "Crafting", "Creating", "Crunching", "Crystallizing",
            "Cultivating", "Deciphering", "Deliberating", "Determining", "Dilly-dallying", "Discombobulating", "Doing",
            "Doodling", "Drizzling", "Ebbing", "Effecting", "Elucidating", "Embellishing", "Enchanting", "Envisioning",
            "Fermenting", "Fiddle-faddling", "Finagling", "Flambéing", "Flibbertigibbeting", "Flowing", "Flummoxing",
            "Fluttering", "Forging", "Forming", "Frolicking", "Frosting", "Gallivanting", "Galloping", "Garnishing",
            "Generating", "Gesticulating", "Germinating", "Gitifying", "Grooving", "Gusting", "Harmonizing", "Hashing",
            "Hatching", "Herding", "Honking", "Hullaballooing", "Hyperspacing", "Ideating", "Imagining", "Improvising",
            "Incubating", "Inferring", "Infusing", "Ionizing", "Jitterbugging", "Julienning", "Kerfuffling", "Kneading",
            "Leavening", "Levitating", "Lollygagging", "Manifesting", "Marinating", "Meandering", "Metamorphosing",
            "Misting", "Moonwalking", "Moseying", "Mulling", "Mustering", "Nebulizing", "Nesting", "Newspapering",
            "Noodling", "Nucleating", "Onioning", "Orbiting", "Orchestrating", "Osmosing", "Perambulating", "Percolating",
            "Perusing", "Philosophizing", "Photosynthesizing", "Polishing", "Pollinating", "Pondering", "Pontificating",
            "Pouncing", "Precipitating", "Prestidigitating", "Processing", "Proofing", "Propagating", "Puttering",
            "Puzzling", "Quantumizing", "Razzle-dazzling", "Razzmatazzing", "Recombobulating", "Reticulating", "Roosting",
            "Ruminating", "Sautéing", "Scampering", "Schlepping", "Scurrying", "Seasoning", "Shenaniganing",
            "Shimmying", "Simmering", "Skedaddling", "Sketching", "Slithering", "Smooshing", "Sock-hopping", "Spelunking",
            "Spinning", "Sprouting", "Stewing", "Sublimating", "Swirling", "Swooping", "Symbioting", "Synthesizing",
            "Tempering", "Thinking", "Thundering", "Tinkering", "Tomfoolering", "Topsy-turvying", "Transfiguring",
            "Transmogrifying", "Transmuting", "Twisting", "Undulating", "Unfurling", "Unraveling", "Vibing", "Waddling",
            "Wandering", "Warping", "Whatchamacalliting", "Whirlpooling", "Whirring", "Whisking", "Wibbling", "Working",
            "Wrangling", "Zesting", "Zigzagging"
        };

        /// <summary>One verb per request, the same for the whole request.</summary>
        public static string VerbFor(string seed)
        {
            unchecked
            {
                int h = 17;
                foreach (char c in seed ?? "") h = h * 31 + c;
                return Verbs[(h & 0x7FFFFFFF) % Verbs.Length];
            }
        }
    }
}
