// Live talking, on this computer: hearing the bot's name, saying replies aloud, and the few spoken words the bot
// acts on itself. Everything Claude is asked goes to Claude Code as an ordinary prompt; nothing here talks to a model.
//
// The listener only runs once the person has allowed it in the bot, and a mark on the screen says so the whole time.
// It keeps no audio: a stretch of speech goes through Whisper on this computer to see whether it starts with the
// bot's name, and then it is gone. Only what the person says to the bot after its name ever leaves the PC, as text.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Media;
using System.Speech.Synthesis;
using System.Text.RegularExpressions;
using System.Threading;

namespace MiniBot
{
    /// <summary>Whether what was heard is addressed to the bot, and what was said after its name.</summary>
    public static class WakePhrase
    {
        const string Greeting = "hey|hi|hello|ok|okay|yo";
        // How Whisper tends to write "Mini" when it is not sure.
        const string Likely = "mini|minnie|minny|mimi|meany|meeny|many";

        static string NameOf(string botName)
        {
            string name = Regex.Escape((botName ?? "").Trim().ToLowerInvariant());
            return Regex.Replace(name, @"(\\ )+", @"\W+");
        }

        /// <summary>
        /// True when the text is addressed to the bot: a greeting and its name near the start ("hey mini, ..."), or (unless
        /// strict, as while the bot itself is talking) its exact name set apart at the very start ("Mini, ..."). `rest` is what followed.
        /// </summary>
        public static bool Match(string text, string botName, bool strict, out string rest)
        {
            rest = "";
            if (string.IsNullOrWhiteSpace(text)) return false;
            string own = NameOf(botName);
            string fuzzy = own.Length > 0 ? own + "|" + Likely : Likely;
            string exact = own.Length > 0 ? own + "|mini" : "mini";
            var m = Regex.Match(text, @"^\W*(?:\w+\W+){0,3}?(?:" + Greeting + @")\W+(?:" + fuzzy + @")\b\W*(.*)$", RegexOptions.IgnoreCase | RegexOptions.Singleline);
            if (!m.Success && !strict) m = Regex.Match(text, @"^\W*(?:" + exact + @")(?:\W*$|\s*[,.!?:;]+\s*(.*)$)", RegexOptions.IgnoreCase | RegexOptions.Singleline);
            if (!m.Success) return false;
            rest = m.Groups[1].Value.Trim();
            return true;
        }
    }

    /// <summary>The few spoken things the bot does itself, at once. Anything else is for Claude.</summary>
    public static class SpokenCommand
    {
        public const string Stop = "stop", Quiet = "quiet", Hide = "hide", Show = "show", Deaf = "deaf", Off = "off", Done = "done", Summarize = "summarize", Terminal = "terminal";

        static readonly Dictionary<string, string> Words = new Dictionary<string, string>
        {
            { "stop", Stop }, { "stop it", Stop }, { "stop that", Stop }, { "cancel", Stop }, { "cancel that", Stop }, { "abort", Stop }, { "never mind", Stop }, { "nevermind", Stop },
            { "stop talking", Quiet }, { "be quiet", Quiet }, { "quiet", Quiet }, { "shut up", Quiet }, { "silence", Quiet },
            { "hide", Hide }, { "hide yourself", Hide }, { "go away", Hide },
            { "show", Show }, { "show yourself", Show }, { "come back", Show },
            { "stop listening", Deaf }, { "mute", Deaf }, { "mute yourself", Deaf }, { "stop listening to me", Deaf },
            { "turn off", Off }, { "turn yourself off", Off }, { "switch off", Off }, { "switch yourself off", Off }, { "shut yourself down", Off },
            { "summarize this page", Summarize }, { "summarise this page", Summarize }, { "summarize the page", Summarize }, { "summarise the page", Summarize },
            { "summarize this", Summarize }, { "summarise this", Summarize }, { "summarize this for me", Summarize }, { "summarise this for me", Summarize },
            { "summarize this page for me", Summarize }, { "summarise this page for me", Summarize }, { "summarize page", Summarize }, { "summarise page", Summarize },
            { "summarize this article", Summarize }, { "summarise this article", Summarize }, { "summarize this document", Summarize }, { "summarise this document", Summarize },
            { "open claude code", Terminal }, { "open claude", Terminal }, { "show claude code", Terminal }, { "open the terminal", Terminal }, { "open your terminal", Terminal }, { "show the terminal", Terminal },
            { "thanks", Done }, { "thank you", Done }, { "thats all", Done }, { "that is all", Done }, { "goodbye", Done }, { "bye", Done }, { "no thanks", Done }, { "nothing", Done },
        };

        /// <summary>Which of them this is, or null. The whole of what was said has to be the command, so a sentence is never taken for one.</summary>
        public static string Of(string text)
        {
            string plain = Regex.Replace((text ?? "").ToLowerInvariant().Replace("'", ""), @"[^a-z0-9 ]", " ");
            plain = Regex.Replace(plain, @"\s+", " ").Trim();
            string found;
            return Words.TryGetValue(plain, out found) ? found : null;
        }
    }

    /// <summary>
    /// Listens to the microphone for the bot's name. It finds stretches of speech by loudness against the room's own
    /// noise, and hands each to Whisper. Runs on its own thread; `Heard` is raised on a worker thread.
    /// </summary>
    public class WakeListener : IDisposable
    {
        const int PreRollChunks = 5;      // audio kept from before the speech began, so the first word is whole (100 ms each)
        const int StartChunks = 2;        // loud this long: speech has begun
        const int EndChunks = 7;          // quiet this long: it has ended
        const int MinChunks = 3;          // shorter than this was a knock on the desk
        const int MaxChunks = 150;        // past this it is cut and looked at anyway
        const int HeadChunks = 35;        // a long stretch: only this much is looked at first, so talk in the room costs little
        const int MinLevel = 6;

        public event Action<string> Heard;
        public event Action<string> Failed;

        /// <summary>The microphone is someone else's for now, or the PC is locked: nothing is looked at.</summary>
        public volatile bool Paused;
        /// <summary>The bot itself is talking, and may be heard: only its full greeting counts.</summary>
        public volatile bool Strict;
        public volatile string BotName = "Mini";

        Thread thread;
        Recorder recorder;
        volatile bool stopping;
        readonly Queue<byte[]> preRoll = new Queue<byte[]>();
        readonly List<byte[]> clip = new List<byte[]>();
        double noise = 3;
        int loudRun, quietRun;
        bool inSpeech;
        int busy;
        List<byte[]> waiting;
        readonly object gate = new object();

        public void Start()
        {
            thread = new Thread(Loop) { IsBackground = true, Name = "Listening for the name" };
            thread.Start();
        }

        void Loop()
        {
            try
            {
                recorder = new Recorder { KeepAudio = false };
                recorder.Chunk = Feed;
                recorder.Start();
            }
            catch (Exception e)
            {
                if (Failed != null) Failed(e.Message);
                return;
            }
            while (!stopping)
            {
                recorder.Poll();
                Thread.Sleep(30);
            }
            recorder.Dispose();
        }

        /// <summary>Takes in 100 ms of audio. A test feeds recordings through here instead of a microphone.</summary>
        public void Feed(byte[] chunk)
        {
            if (Paused)
            {
                clip.Clear();
                preRoll.Clear();
                inSpeech = false;
                loudRun = quietRun = 0;
                return;
            }
            int level = Recorder.LevelOf(chunk);
            double threshold = Math.Max(MinLevel, noise * 2.2 + 2);
            bool loud = level >= threshold;
            if (!inSpeech)
            {
                noise = Math.Min(40, noise * 0.97 + level * 0.03);
                preRoll.Enqueue(chunk);
                while (preRoll.Count > PreRollChunks) preRoll.Dequeue();
                loudRun = loud ? loudRun + 1 : 0;
                if (loudRun >= StartChunks)
                {
                    inSpeech = true;
                    quietRun = 0;
                    clip.Clear();
                    clip.AddRange(preRoll);
                    preRoll.Clear();
                }
                return;
            }
            clip.Add(chunk);
            quietRun = loud ? 0 : quietRun + 1;
            if (quietRun < EndChunks && clip.Count < MaxChunks) return;
            inSpeech = false;
            loudRun = 0;
            if (clip.Count - quietRun >= MinChunks) Hand(new List<byte[]>(clip));
            clip.Clear();
        }

        /// <summary>One stretch at a time goes to Whisper; a newer one waiting replaces an older one.</summary>
        void Hand(List<byte[]> stretch)
        {
            lock (gate)
            {
                if (busy != 0) { waiting = stretch; return; }
                busy = 1;
            }
            ThreadPool.QueueUserWorkItem(delegate { Work(stretch); });
        }

        void Work(List<byte[]> stretch)
        {
            for (;;)
            {
                try { Look(stretch); }
                catch (Exception e) { App.Log("listening: " + e.Message); }
                lock (gate)
                {
                    stretch = waiting;
                    waiting = null;
                    if (stretch == null) { busy = 0; return; }
                }
            }
        }

        void Look(List<byte[]> stretch)
        {
            string name = BotName;
            bool strict = Strict;
            string hint = "An assistant called " + name + ". Spoken commands to " + name + ":";
            string rest;
            // Most of what a microphone hears is not for the bot: the start of a long stretch says so at little cost.
            if (stretch.Count > HeadChunks + 10)
            {
                string head = Dictation.Recognize(Join(stretch.Take(HeadChunks)), hint);
                if (stopping || !WakePhrase.Match(head, name, strict, out rest)) return;
            }
            string text = Dictation.Recognize(Join(stretch), hint);
            if (stopping || Paused || !WakePhrase.Match(text, name, strict, out rest)) return;
            if (Heard != null) Heard(rest);
        }

        static byte[] Join(IEnumerable<byte[]> chunks)
        {
            using (var all = new MemoryStream())
            {
                foreach (var c in chunks) all.Write(c, 0, c.Length);
                return Recorder.ToWav(all.ToArray());
            }
        }

        public void Dispose()
        {
            stopping = true;
        }
    }

    /// <summary>Says replies aloud with a Windows voice, on this computer.</summary>
    public class Speaker : IDisposable
    {
        const int MaxSpoken = 700;
        SpeechSynthesizer synth;

        public bool IsSpeaking { get { return synth != null && synth.State == SynthesizerState.Speaking; } }

        /// <summary>Starts saying the text, instead of whatever it was saying. A voice that is not there is left for the default.</summary>
        public void Say(string text, string voice, int rate, int volume)
        {
            if (string.IsNullOrWhiteSpace(text)) return;
            try
            {
                if (synth == null)
                {
                    synth = new SpeechSynthesizer();
                    synth.SetOutputToDefaultAudioDevice();
                }
                synth.SpeakAsyncCancelAll();
                if (!string.IsNullOrEmpty(voice) && synth.Voice.Name != voice && synth.GetInstalledVoices().Any(v => v.Enabled && v.VoiceInfo.Name == voice)) synth.SelectVoice(voice);
                synth.Rate = Math.Max(-10, Math.Min(10, rate));
                synth.Volume = Math.Max(0, Math.Min(100, volume));
                synth.SpeakAsync(text);
            }
            catch (Exception e) { App.Log("speaking: " + e.Message); }
        }

        public void Stop()
        {
            if (synth == null) return;
            try { synth.SpeakAsyncCancelAll(); } catch (Exception) { }
        }

        /// <summary>A reply as it should sound: no code, no markdown marks, no web addresses read out, and only the first part of a long one.</summary>
        public static string ForSpeech(string reply)
        {
            string text = reply ?? "";
            text = Regex.Replace(text, @"```.*?```", " (code in the panel) ", RegexOptions.Singleline);
            text = Regex.Replace(text, @"!?\[([^\]]*)\]\([^)]*\)", "$1");
            text = Regex.Replace(text, @"https?://\S+", "a link");
            text = Regex.Replace(text, @"^\s*#{1,6}\s*", "", RegexOptions.Multiline);
            text = Regex.Replace(text, @"^\s*[-*+]\s+", "", RegexOptions.Multiline);
            text = Regex.Replace(text, @"^\s*\|.*\|\s*$", "", RegexOptions.Multiline);
            text = Regex.Replace(text, @"[*_`~>#]+", "");
            text = Regex.Replace(text, @"\s*\n+\s*", ". ");
            text = Regex.Replace(text, @"\.(\s*\.)+", ".");
            text = Regex.Replace(text, @"\s+", " ").Trim();
            if (text.Length <= MaxSpoken) return text;
            string cut = text.Substring(0, MaxSpoken);
            int end = Math.Max(cut.LastIndexOf(". "), Math.Max(cut.LastIndexOf("? "), cut.LastIndexOf("! ")));
            return (end > 100 ? cut.Substring(0, end + 1) : cut) + " The rest is in the panel.";
        }

        public void Dispose()
        {
            if (synth == null) return;
            try { synth.SpeakAsyncCancelAll(); synth.Dispose(); } catch (Exception) { }
            synth = null;
        }
    }

    /// <summary>The two short notes when the bot hears its name, so the person knows it is listening without looking.</summary>
    public static class Chime
    {
        const int Rate = 22050;

        public static void Play(int volume)
        {
            if (volume <= 0) return;
            try
            {
                var player = new SoundPlayer(new MemoryStream(Tone(volume)));
                player.Play();
            }
            catch (Exception e) { App.Log("chime: " + e.Message); }
        }

        static byte[] Tone(int volume)
        {
            double[] notes = { 784, 1175 };
            int each = Rate * 90 / 1000;
            using (var pcm = new MemoryStream())
            using (var w = new BinaryWriter(pcm))
            {
                foreach (double freq in notes)
                {
                    for (int i = 0; i < each; i++)
                    {
                        double fade = Math.Min(1.0, Math.Min(i, each - i) / (Rate * 0.008));
                        double sample = Math.Sin(2 * Math.PI * freq * i / Rate) * fade * 0.5 * volume / 100.0;
                        w.Write((short)(sample * short.MaxValue));
                    }
                }
                w.Flush();
                return Recorder.ToWav(pcm.ToArray(), Rate);
            }
        }
    }
}
