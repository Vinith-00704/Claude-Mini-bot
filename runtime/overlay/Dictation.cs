// Speech to text, on this computer, with nothing sent anywhere.
//
// The good recognizer is Whisper (whisper.cpp, installed once by runtime/speech/install.ps1):
// the microphone is recorded while the person talks and the recording is transcribed when
// they stop. Without it this falls back on the recognizer that ships with Windows
// (System.Speech), which is far less accurate but works with no setup and shows words as
// they are heard. The overlay owns when anything may start (a click or a held key, and a
// granted permission); this class only records and recognizes.

using System;
using System.Diagnostics;
using System.IO;
using System.Speech.Recognition;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace MiniBot
{
    public class Dictation : IDisposable
    {
        public const int MaxSeconds = 15;
        public const int MaxHeldSeconds = 60;

        const double EndSilenceSeconds = 1.4;      // Whisper mode, when not holding a key: how long a pause ends the sentence
        const double NoSpeechSeconds = 7;          // ...and how long to wait for the first word
        const int SpeechLevel = 8;                 // 0-100: louder than this counts as talking

        SpeechRecognitionEngine engine;
        Recorder recorder;
        Process whisper;
        DateTime startedAt;
        DateTime lastLoud;
        bool continuous;
        bool useWhisper;
        volatile bool cancelled;

        public volatile string Partial = "";
        public volatile string Final = "";
        public volatile string Error;
        public volatile bool Done;
        public volatile int Level;              // how loud the microphone is right now, 0-100
        public volatile bool Transcribing;      // Whisper is working on what was said (the microphone is already closed)

        /// <summary>True while the person holds the key to talk: it listens until they let go, pauses and all.</summary>
        public bool Held { get { return continuous; } }
        public bool UsesWhisper { get { return useWhisper; } }
        /// <summary>True while the microphone is open.</summary>
        public bool IsActive { get { return useWhisper ? (recorder != null && recorder.Running) : (engine != null && !Done); } }
        public double Seconds { get { return (DateTime.UtcNow - startedAt).TotalSeconds; } }

        // ---- where Whisper lives ----

        public static string SpeechDir
        {
            get
            {
                string root = Environment.GetEnvironmentVariable("LOCALAPPDATA");
                if (string.IsNullOrEmpty(root)) root = Path.GetTempPath();
                return Path.Combine(Path.Combine(root, "ClaudeMiniBot"), "speech");
            }
        }

        static string WhisperExe { get { return Path.Combine(SpeechDir, "whisper-cli.exe"); } }

        /// <summary>The best model that is installed: a bigger one if the person added it, else the standard one.</summary>
        static string ModelPath()
        {
            foreach (var name in new[] { "ggml-small.en.bin", "ggml-base.en.bin" })
            {
                string p = Path.Combine(SpeechDir, name);
                if (File.Exists(p)) return p;
            }
            return null;
        }

        public static bool WhisperAvailable { get { return File.Exists(WhisperExe) && ModelPath() != null; } }

        // ---- starting ----

        public void StartMic(bool untilReleased)
        {
            continuous = untilReleased;
            if (WhisperAvailable)
            {
                useWhisper = true;
                recorder = new Recorder();
                recorder.Start();       // throws, with a readable message, if there is no microphone
                startedAt = lastLoud = DateTime.UtcNow;
                return;
            }
            Create();
            try { engine.SetInputToDefaultAudioDevice(); }
            catch (Exception)
            {
                throw new InvalidOperationException(
                    "No microphone was found, or Windows is not letting desktop apps use it (Settings > Privacy & security > Microphone).");
            }
            Begin();
        }

        /// <summary>Recognizes a recording instead of the microphone, with Windows' recognizer. Used to test it.</summary>
        public void StartWav(string path)
        {
            Create();
            engine.SetInputToWaveFile(path);
            Begin();
        }

        // ---- Windows' recognizer (fallback) ----

        void Create()
        {
            try { engine = new SpeechRecognitionEngine(); }
            catch (Exception)
            {
                throw new InvalidOperationException(
                    "Windows has no speech recognizer installed (Settings > Time & language > Speech).");
            }
            engine.LoadGrammar(new DictationGrammar());
            engine.InitialSilenceTimeout = TimeSpan.FromSeconds(7);
            engine.EndSilenceTimeoutAmbiguous = TimeSpan.FromSeconds(1.2);
            engine.EndSilenceTimeout = TimeSpan.FromSeconds(1.0);
            engine.AudioLevelUpdated += delegate (object s, AudioLevelUpdatedEventArgs e) { Level = e.AudioLevel; };
            engine.SpeechHypothesized += delegate (object s, SpeechHypothesizedEventArgs e) { Partial = e.Result.Text; };
            engine.SpeechRecognized += delegate (object s, SpeechRecognizedEventArgs e)
            {
                if (e.Result.Confidence >= 0.2f && !string.IsNullOrWhiteSpace(e.Result.Text)) Final = (Final + " " + e.Result.Text).Trim();
            };
            engine.RecognizeCompleted += delegate (object s, RecognizeCompletedEventArgs e)
            {
                if (e.Error != null) Error = "Speech recognition failed: " + e.Error.Message;
                else if (e.InitialSilenceTimeout) Error = "I didn't hear anything.";
                else if (Final.Length == 0 && !e.Cancelled) Error = "I didn't catch that.";
                Done = true;
            };
        }

        void Begin()
        {
            startedAt = DateTime.UtcNow;
            engine.RecognizeAsync(continuous ? RecognizeMode.Multiple : RecognizeMode.Single);
        }

        // ---- the loop the overlay runs about every frame ----

        /// <summary>Takes in the microphone's audio (Whisper mode) and ends a spoken sentence after a pause.</summary>
        public void Pump()
        {
            if (!useWhisper || recorder == null || !recorder.Running) return;
            recorder.Poll();
            Level = recorder.Level;
            if (recorder.Level >= SpeechLevel) lastLoud = DateTime.UtcNow;
            if (continuous) return;
            // Clicked the microphone (no key held): finish by itself after a pause, as the Windows recognizer does.
            double quiet = (DateTime.UtcNow - lastLoud).TotalSeconds;
            if (recorder.Peak >= SpeechLevel ? quiet > EndSilenceSeconds : Seconds > NoSpeechSeconds) Stop();
        }

        /// <summary>Finishes what is being heard and hands over the text.</summary>
        public void Stop()
        {
            if (useWhisper)
            {
                if (recorder == null || !recorder.Running) return;
                byte[] wav = recorder.Stop();
                int peak = recorder.Peak;
                Level = 0;
                if (cancelled) { Done = true; return; }
                if (Seconds < 0.4 || peak < SpeechLevel / 2)
                {
                    Error = "I didn't hear anything.";
                    Done = true;
                    return;
                }
                Transcribing = true;
                ThreadPool.QueueUserWorkItem(delegate { Transcribe(wav); });
                return;
            }
            if (!IsActive) return;
            try { engine.RecognizeAsyncStop(); } catch (Exception) { Done = true; }
        }

        /// <summary>Stops at once and keeps nothing.</summary>
        public void Cancel()
        {
            cancelled = true;
            Final = "";
            Partial = "";
            if (recorder != null && recorder.Running) recorder.Stop();
            Level = 0;
            try { if (whisper != null && !whisper.HasExited) whisper.Kill(); } catch (Exception) { }
            if (engine != null && !Done)
            {
                try { engine.RecognizeAsyncCancel(); } catch (Exception) { }
            }
            Transcribing = false;
            Done = true;
        }

        // ---- Whisper ----

        void Transcribe(byte[] wav)
        {
            string file = Path.Combine(Path.GetTempPath(), "minibot-speech-" + Guid.NewGuid().ToString("N") + ".wav");
            try
            {
                File.WriteAllBytes(file, wav);
                var info = new ProcessStartInfo
                {
                    FileName = WhisperExe,
                    // -nt: no timestamps, -np: print only the text. A short hint of the kind of talk to expect helps with names.
                    Arguments = "-m \"" + ModelPath() + "\" -f \"" + file + "\" -nt -np -l en -t " + Math.Max(2, Math.Min(6, Environment.ProcessorCount / 2))
                        + " --prompt \"Instructions to Claude Code about files, functions, bugs and the repository.\"",
                    WorkingDirectory = SpeechDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8
                };
                whisper = Process.Start(info);
                whisper.ErrorDataReceived += delegate { };
                whisper.BeginErrorReadLine();
                string text = whisper.StandardOutput.ReadToEnd();
                if (!whisper.WaitForExit(60000)) { try { whisper.Kill(); } catch (Exception) { } }
                if (cancelled) return;
                text = Clean(text);
                if (text.Length > 0) Final = text;
                else Error = "I didn't catch that.";
            }
            catch (Exception e)
            {
                if (!cancelled) Error = "Speech recognition failed: " + e.Message;
            }
            finally
            {
                try { File.Delete(file); } catch (Exception) { }
                Transcribing = false;
                Done = true;
            }
        }

        /// <summary>Whisper marks non-speech like [BLANK_AUDIO] or (music); that is not something to type.</summary>
        static string Clean(string raw)
        {
            string text = Regex.Replace(raw ?? "", @"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*", " ");
            return Regex.Replace(text, @"\s+", " ").Trim();
        }

        public void Dispose()
        {
            if (recorder != null) { recorder.Dispose(); recorder = null; }
            if (engine != null)
            {
                try { engine.Dispose(); } catch (Exception) { }
                engine = null;
            }
        }
    }
}
