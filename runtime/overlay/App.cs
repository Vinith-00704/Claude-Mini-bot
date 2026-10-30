// The overlay application: it reads the runtime's state a few times a second,
// draws the bot, the panel and the access indicator from it, and turns the
// person's clicks into requests to the runtime. It decides nothing itself:
// permissions, prompts and configuration all live in the runtime.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace MiniBot
{
    public static class Program
    {
        [STAThread]
        public static int Run(string url, string token)
        {
            Native.SetProcessDPIAware();
            Ui.Init();
            Application.EnableVisualStyles();
            try { Application.SetCompatibleTextRenderingDefault(false); } catch (InvalidOperationException) { }
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += delegate (object s, System.Threading.ThreadExceptionEventArgs e) { App.Log(e.Exception.ToString()); };
            // The overlay key is for this process alone: kept in the Api, gone from the environment programs it starts would inherit.
            string overlayKey = Environment.GetEnvironmentVariable("MINI_BOT_OVERLAY_KEY");
            Environment.SetEnvironmentVariable("MINI_BOT_OVERLAY_KEY", null);
            var app = new App(new Api(url, token, overlayKey));
            return app.Run();
        }
    }

    class App
    {
        const int FailuresBeforeExit = 6;

        readonly Api api;
        readonly Stopwatch clock = Stopwatch.StartNew();
        readonly Timer poll = new Timer();
        readonly Timer frame = new Timer();
        BotWindow bot;
        PanelWindow panel;
        SettingsWindow settings;
        NoActivateForm badge;
        Label badgeLabel;
        NotifyIcon tray;
        Hotkey hotkey;
        string hotkeyWanted;
        // Computer control: the hands, the thread that runs their jobs, the takeover watch, what the person sees, the stop key.
        ComputerHands hands;
        ControlWorker worker;
        InputWatch watch;
        ControlFrame controlFrame;
        Hotkey stopKey;
        string stopKeyWanted;
        System.Threading.SynchronizationContext ui;
        string cardId;                          // the question in the panel now ("paused" for the takeover card), or null
        string[] cardChoices = new string[0];   // what each of its buttons answers
        bool cardOpenedPanel;                   // the panel was opened for the card, so it closes after
        IntPtr frontBeforeCard;                 // the window in front before the card: it gets the front back after the answer
        bool markHeld;                          // a ring is on the spot of the step being asked about
        DateTime watchFrom = DateTime.MinValue; // after an answer in the bot, the hand moving away is not a takeover
        string controlStatus = "off";   // the shortcut last tried, so a refused one is reported once and not on every refresh
        Dictation dict;
        Dictionary<string, object> st = new Dictionary<string, object>();
        Look look = new Look();
        int failures;
        int lastRevision = -1;
        string positionKey = "";
        string paletteKey = "";
        string lastPartial = "";
        string lastPrompt = "";
        string localInfo;
        DateTime localInfoUntil = DateTime.MinValue;
        SnipWindow snip;
        bool isStartingScreenshot;
        readonly List<Chip> attached = new List<Chip>();   // what goes with the next prompt: a screenshot, dropped files and folders
        DateTime hoverAt = DateTime.MinValue;             // when a drag with files was last over the bot or the panel
        int lastScreenshotRequest = -1;
        int lastCommandsRevision = -1;   // the slash-command list the panel has; -1 is none yet
        string localError;
        DateTime localErrorUntil = DateTime.MinValue;
        bool reviewVoice;   // what was just heard is waiting for the person to read, edit and send: nothing is sent by itself
        bool onboardingShown;
        bool silentEnd;

        public App(Api api) { this.api = api; }

        public static void Log(string text)
        {
            try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "minibot-overlay.log"), DateTime.Now.ToString("s") + " " + text + Environment.NewLine); }
            catch (Exception) { }
        }

        public int Run()
        {
            bot = new BotWindow();
            panel = new PanelWindow();
            BuildBadge();
            BuildTray();
            hotkey = new Hotkey();
            hotkey.Pressed += delegate { SetVisible(!Json.Bool(Json.Obj(st, "config"), "visible", true)); };
            BuildControl();
            WireEvents();

            poll.Interval = 400;
            poll.Tick += delegate { Refresh(); };
            frame.Interval = 40;
            frame.Tick += delegate { Tick(); };
            Refresh();
            poll.Start();
            frame.Start();
            Application.Run();
            Cleanup();
            return 0;
        }

        // ---- wiring ----

        void WireEvents()
        {
            bot.Clicked += TogglePanel;
            bot.Dragged += delegate (Point location)
            {
                // Keep the bot where it can be seen and grabbed again.
                var work = Screen.FromRectangle(new Rectangle(location, bot.Size)).WorkingArea;
                location = new Point(
                    Math.Max(work.Left, Math.Min(location.X, work.Right - bot.Width)),
                    Math.Max(work.Top, Math.Min(location.Y, work.Bottom - bot.Height)));
                bot.Location = location;
                positionKey = "";
                Try(delegate { st = api.Apply(Op("move", "x", location.X, "y", location.Y)); positionKey = PositionKey(); });
            };
            bot.MenuRequested += ShowMenu;
            panel.SendRequested += delegate (string text) { Send(text, reviewVoice ? "voice" : "text"); };
            panel.MicRequested += delegate { holdToTalk = false; OnMic(); };
            panel.MicHoldStarted += delegate { if (dict == null) { holdToTalk = true; OnMic(); } };
            panel.MicHoldReleased += delegate { if (dict != null && dict.IsActive) dict.Stop(); };
            panel.ScreenshotRequested += delegate { panel.BeginInvoke(new Action(StartScreenshot)); };
            panel.ChipRemoved += RemoveChip;
            panel.FilesDropped += delegate (string[] paths) { TakeFiles(paths, null); };
            panel.DropHover += OnDropHover;
            bot.DropHover += OnDropHover;
            bot.FilesDropped += delegate (string[] paths, PointF at) { TakeFiles(paths, at); };
            panel.SizeCommitted += delegate (int width, int replyHeight)
            {
                Try(delegate { st = api.Apply(Op("resize", "width", width, "replyHeight", replyHeight)); });
            };
            panel.SettingsRequested += OpenSettings;
            panel.CloseRequested += HidePanel;
            panel.ConsentAllowed += GrantMicrophone;
            panel.ConsentDeclined += delegate { panel.EndConsent(); };
            panel.OnboardingContinued += FinishOnboarding;
            panel.OnboardingSkipped += delegate { FinishOnboarding(""); };
            panel.ChoiceMade += OnChoice;
        }

        static Dictionary<string, object> Op(string op, params object[] pairs)
        {
            var d = new Dictionary<string, object> { { "op", op } };
            for (int i = 0; i + 1 < pairs.Length; i += 2) d[(string)pairs[i]] = pairs[i + 1];
            return d;
        }

        /// <summary>Runs a request and shows any failure in the panel instead of crashing.</summary>
        bool Try(Action action)
        {
            try { action(); return true; }
            catch (ApiException e) { ShowError(e.Message); return false; }
        }

        void ShowError(string message)
        {
            localError = message;
            localErrorUntil = DateTime.UtcNow.AddSeconds(8);
        }

        void ShowInfo(string message)
        {
            localInfo = message;
            localInfoUntil = DateTime.UtcNow.AddSeconds(5);
        }

        // ---- reading the runtime ----

        void Refresh()
        {
            try
            {
                st = api.Get("/v1/state");
                failures = 0;
            }
            catch (ApiException)
            {
                if (++failures >= FailuresBeforeExit) Quit();
                return;
            }
            try { Apply(); } catch (Exception e) { Log(e.ToString()); }
        }

        Dictionary<string, object> ActiveProfile()
        {
            var cfg = Json.Obj(st, "config");
            string id = Json.Str(cfg, "activeProfileId");
            var profiles = Json.Arr(cfg, "profiles").OfType<Dictionary<string, object>>().ToList();
            return profiles.FirstOrDefault(p => Json.Str(p, "id") == id) ?? profiles.FirstOrDefault() ?? new Dictionary<string, object>();
        }

        static Look LookOf(Dictionary<string, object> profile)
        {
            var a = Json.Obj(profile, "appearance");
            var n = Json.Obj(profile, "animation");
            return new Look
            {
                Avatar = Json.Str(profile, "avatar", "clawd"),
                Name = Json.Str(profile, "name", "Mini"),
                Skin = Json.Str(a, "skin", "claude"),
                Accent = Json.Str(a, "accent", "claude"),
                Size = Json.Str(a, "size", "medium"),
                Idle = Json.Str(n, "idle", "subtle"),
                Speed = Json.Str(n, "speed", "normal"),
                Reduced = Json.Bool(n, "reducedMotion")
            };
        }

        /// <summary>The model and effort the session reported, for the line under the panel's header.</summary>
        void ShowModel(Dictionary<string, object> cfg)
        {
            var session = Json.Obj(st, "session");
            var change = Json.Obj(session, "switched");
            string note = "";
            // For a few seconds after the model changes the line says so.
            if (Json.Has(change, "to") && Json.Int(change, "ageMs", int.MaxValue) < 6000)
                note = Json.Str(change, "from") + " → " +Json.Str(change, "to");
            panel.SetModel(Json.Str(session, "name"), Json.Str(session, "effort"), Json.Str(Json.Obj(cfg, "display"), "modelLabel", "full"), note);
        }

        string PositionKey()
        {
            var p = ActiveProfile();
            var pos = Json.Obj(p, "position");
            return Json.Str(p, "id") + "|" + Json.Str(pos, "anchor") + "|" + Json.Int(pos, "x") + "|" + Json.Int(pos, "y")
                + "|" + Json.Str(Json.Obj(p, "appearance"), "size") + "|" + Screen.PrimaryScreen.WorkingArea;
        }

        /// <summary>Keeps the hide/show shortcut as the configuration says. A shortcut Windows refuses is reported once.</summary>
        void ApplyHotkey(Dictionary<string, object> cfg)
        {
            string wanted = Json.Str(Json.Obj(cfg, "hotkey"), "toggle", "");
            if (wanted == hotkeyWanted) return;
            hotkeyWanted = wanted;
            bool on = wanted.Length > 0 && wanted != "off";
            bool ok = hotkey.Set(wanted);
            // Said to the runtime so that /mini-bot status can tell the person when the shortcut is not theirs to use.
            if (wanted.Length > 0)
            {
                try { api.Post("/v1/overlay/hotkey", new Dictionary<string, object> { { "combo", wanted }, { "ok", ok } }); }
                catch (ApiException) { }
            }
            tray.Text = on && ok ? "Claude Mini Bot (" + wanted + " hides or shows)" : "Claude Mini Bot";
            if (on && !ok)
                tray.ShowBalloonTip(8000, "Claude Mini Bot", wanted + " is used by another program, so it cannot hide or show the bot. Pick another with /mini-bot set hotkey.", ToolTipIcon.Warning);
        }

        // ---- computer control ----

        void BuildControl()
        {
            ui = System.Threading.SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
            controlFrame = new ControlFrame();
            hands = new ComputerHands();
            hands.Mark = delegate (Point p) { ui.Post(delegate { controlFrame.Mark(p, false); }, null); };
            worker = new ControlWorker(api, hands);
            watch = new InputWatch();
            // Raised inside Windows' input hook, which must return at once: the request goes out afterwards.
            watch.TookOver += delegate { ui.Post(delegate { TakeOver(); }, null); };
            stopKey = new Hotkey(0x4D43);
            stopKey.Pressed += delegate { Halt("the stop key"); };
            Microsoft.Win32.SystemEvents.SessionSwitch += OnSessionSwitch;
        }

        void OnSessionSwitch(object sender, Microsoft.Win32.SessionSwitchEventArgs e)
        {
            // Nobody is watching a locked screen: control ends.
            if (e.Reason == Microsoft.Win32.SessionSwitchReason.SessionLock && controlStatus != "off")
                ui.Post(delegate { Halt("the PC was locked"); }, null);
        }

        void TakeOver()
        {
            try { api.Overlay("/v1/computer/pause", new Dictionary<string, object> { { "reason", "you moved the mouse or pressed a key" } }); }
            catch (ApiException) { }
            Refresh();
        }

        void Halt(string reason)
        {
            try { api.Overlay("/v1/computer/halt", new Dictionary<string, object> { { "reason", reason } }); }
            catch (ApiException) { }
            Refresh();
        }

        /// <summary>Keeps the frame, the stop key, the takeover watch and the question card as the runtime says.</summary>
        void ApplyControl(Dictionary<string, object> cfg)
        {
            var c = Json.Obj(st, "computer");
            string status = Json.Str(c, "status", "off");
            controlStatus = status;
            var q = Json.Obj(c, "question");
            string qid = Json.Str(q, "id");
            bool on = status != "off";
            bool controlling = status == "running" || status == "paused";
            string key = Json.Str(Json.Obj(cfg, "computer"), "stopKey", "Ctrl+Alt+Esc");

            worker.Active = on;
            watch.Install(controlling);
            watch.Arm(status == "running" && qid.Length == 0 && cardId == null && DateTime.UtcNow >= watchFrom);

            // The stop key is held only while there is something to stop.
            string wantKey = on ? key : "";
            if (wantKey != stopKeyWanted)
            {
                stopKeyWanted = wantKey;
                if (!stopKey.Set(wantKey) && on)
                    tray.ShowBalloonTip(8000, "Claude Mini Bot", key + " is used by another program, so it cannot stop computer control. Stop it from the bot or this icon, and pick another key with /mini-bot set computer-stop-key.", ToolTipIcon.Warning);
            }

            if (controlling)
            {
                controlFrame.Show(status == "paused", CurrentPalette().Accent);
            }
            else if (controlFrame.IsShown) controlFrame.Hide();

            bool confirmWithPoint = qid.Length > 0 && Json.Str(q, "kind") == "confirm" && Json.Has(q, "point") && Json.Obj(q, "point").Count > 0;
            if (confirmWithPoint)
            {
                var p = Json.Obj(q, "point");
                controlFrame.Mark(new Point(Json.Int(p, "x"), Json.Int(p, "y")), true);
                markHeld = true;
            }
            else if (markHeld) { controlFrame.Unmark(); markHeld = false; }

            if (qid.Length > 0)
            {
                if (cardId != qid)
                {
                    var options = Json.Arr(q, "options").OfType<Dictionary<string, object>>().ToArray();
                    int primary = Math.Max(0, Array.FindIndex(options, o => Json.Bool(o, "primary")));
                    ShowCard(qid, Json.Str(q, "text"), options.Select(o => Json.Str(o, "label")).ToArray(), options.Select(o => Json.Str(o, "id")).ToArray(), primary);
                }
            }
            else if (status == "paused")
            {
                if (cardId != "paused") ShowCard("paused", "You have control. Claude waits until you hand it back.", new[] { "Give control back", "Stop" }, new[] { "resume", "stop" }, 0);
            }
            else if (cardId != null) EndCard();
        }

        /// <summary>A question from computer control in the panel, without taking the front from the window Claude works in.</summary>
        void ShowCard(string id, string text, string[] labels, string[] ids, int primary)
        {
            if (!bot.Visible)
            {
                // A question is always seen: the bot comes back first, and the card follows on the next refresh.
                ui.Post(delegate { SetVisible(true); }, null);
                return;
            }
            if (cardId == null)
            {
                IntPtr front = Win.GetForegroundWindow();
                uint pid;
                Native.GetWindowThreadProcessId(front, out pid);
                frontBeforeCard = pid == (uint)Process.GetCurrentProcess().Id ? IntPtr.Zero : front;
                cardOpenedPanel = !panel.Visible;
            }
            cardId = id;
            cardChoices = ids;
            panel.ShowChoices(text, labels, primary);
            if (!panel.Visible)
            {
                panel.Relayout();
                panel.PlaceNear(bot.Bounds, Screen.FromRectangle(bot.Bounds).WorkingArea);
                panel.ShowQuietly = true;
                try { panel.Show(); }
                finally { panel.ShowQuietly = false; }
            }
        }

        void EndCard()
        {
            cardId = null;
            cardChoices = new string[0];
            panel.EndConsent();
            if (cardOpenedPanel && panel.Visible) HidePanel();
            cardOpenedPanel = false;
            // The window Claude was working in gets the front back, so the next step lands where it was meant to.
            if (frontBeforeCard != IntPtr.Zero) Native.SetForegroundWindow(frontBeforeCard);
            frontBeforeCard = IntPtr.Zero;
        }

        void OnChoice(int index)
        {
            if (cardId == null || index < 0 || index >= cardChoices.Length) return;
            string id = cardId, choice = cardChoices[index];
            if (id == "paused")
            {
                if (choice == "resume")
                {
                    try { api.Overlay("/v1/computer/resume", null); } catch (ApiException e) { ShowError(e.Message); }
                }
                else Halt("the person stopped it");
            }
            else
            {
                try { api.Overlay("/v1/computer/answer", new Dictionary<string, object> { { "id", id }, { "choice", choice } }); }
                catch (ApiException e) { ShowError(e.Message); }
            }
            watchFrom = DateTime.UtcNow.AddSeconds(2);
            EndCard();
            Refresh();
        }

        void Apply()
        {
            var cfg = Json.Obj(st, "config");
            ApplyHotkey(cfg);
            ApplyControl(cfg);
            var profile = ActiveProfile();
            look = LookOf(profile);
            var appearance = Json.Obj(profile, "appearance");
            var activity = Json.Obj(st, "activity");
            var mic = Json.Obj(Json.Obj(st, "permissions"), "microphone");
            bool visible = Json.Bool(cfg, "visible", true);

            string phase = Json.Str(activity, "phase", "idle");
            if (localError != null && DateTime.UtcNow < localErrorUntil) phase = "error";
            bool listening = (dict != null && dict.IsActive) || Json.Str(Json.Obj(st, "voice"), "state") == "listening";

            bot.Look = look;
            bot.Phase = phase;
            bot.Listening = listening;
            bot.Opacity100 = Json.Int(appearance, "opacity", 100);

            string key = Json.Str(appearance, "theme", "dark") + Json.Str(appearance, "accent", "claude");
            if (key != paletteKey)
            {
                paletteKey = key;
                panel.ApplyPalette(Ui.PaletteFor(Json.Str(appearance, "theme", "dark"), Json.Str(appearance, "accent", "claude")));
            }
            panel.SetBot(look);
            ShowModel(cfg);
            var size = Json.Obj(profile, "panel");
            panel.SetPreferences(Json.Int(size, "width", 380), Json.Int(size, "replyHeight", 150), Json.Bool(size, "autoFit"));
            panel.SetStatus(phase, listening, Json.Str(activity, "detail"), Json.Str(activity, "id"));
            ShowReply(activity);
            panel.SetListening(listening);

            // The person ended the microphone elsewhere (the indicator, a revoke): stop listening.
            if (dict != null && dict.IsActive && !Json.Bool(mic, "active") && clock.Elapsed.TotalSeconds > 1)
            {
                silentEnd = true;
                dict.Cancel();
            }

            if (visible)
            {
                string pk = PositionKey();
                if (!bot.Visible || (pk != positionKey && !bot.IsDragging))
                {
                    positionKey = pk;
                    PlaceBot();
                }
                if (!bot.Visible)
                {
                    bot.Show();
                    bot.Redraw(clock.Elapsed.TotalSeconds, true);
                }
            }
            else if (bot.Visible)
            {
                HidePanel();
                bot.Hide();
            }

            ApplyBadge();
            tray.Text = Truncate("Claude Mini Bot - " + look.Name, 60);

            // Claude Code asked for a screenshot (/mini-bot screenshot).
            int asked = Json.Int(Json.Obj(st, "requests"), "screenshot");
            if (lastScreenshotRequest < 0) lastScreenshotRequest = asked;
            else if (asked > lastScreenshotRequest)
            {
                lastScreenshotRequest = asked;
                bot.BeginInvoke(new Action(StartScreenshot));
            }

            // The slash commands Claude Code can run, for the panel's `/` list; read again only when they change.
            int commandsRevision = Json.Int(Json.Obj(st, "commands"), "revision", -1);
            if (commandsRevision != lastCommandsRevision) LoadCommands(commandsRevision);

            int revision = Json.Int(cfg, "revision");
            if (revision != lastRevision)
            {
                lastRevision = revision;
                if (settings != null && !settings.IsDisposed && settings.Visible) settings.LoadState(st, false);
            }

            if (visible && !Json.Bool(cfg, "onboarded") && !onboardingShown)
            {
                onboardingShown = true;
                panel.StartOnboarding(look.Name);
                ShowPanel();
            }
        }

        void LoadCommands(int revision)
        {
            try
            {
                var reply = api.Get("/v1/commands");
                var items = new List<CommandItem>();
                foreach (var entry in Json.Arr(reply, "items"))
                    items.Add(new CommandItem
                    {
                        Name = Json.Str(entry, "name"),
                        Description = Json.Str(entry, "description"),
                        Source = Json.Str(entry, "source"),
                        TakesArgs = Json.Bool(entry, "takesArgs")
                    });
                panel.SetCommands(items);
                lastCommandsRevision = revision;
            }
            catch (ApiException) { }   // asked again on the next refresh
        }

        Palette CurrentPalette()
        {
            var a = Json.Obj(ActiveProfile(), "appearance");
            return Ui.PaletteFor(Json.Str(a, "theme", "dark"), Json.Str(a, "accent", "claude"));
        }

        static string Truncate(string s, int max) { return s.Length <= max ? s : s.Substring(0, max); }

        void ShowReply(Dictionary<string, object> activity)
        {
            var preview = Json.Obj(activity, "preview");
            panel.SetConversation(lastPrompt, Json.Str(preview, "text"), Json.Bool(preview, "isError"));
        }

        // ---- the frame tick: animation, voice, notices ----

        void Tick()
        {
            double t = clock.Elapsed.TotalSeconds;
            // A drag that has left (no word of it for a moment) closes the mouth again.
            if (bot.Meal != null && bot.Meal.Stage == Meal.Open && (DateTime.UtcNow - hoverAt).TotalMilliseconds > 450) bot.Meal = null;
            if (bot.Visible) bot.Redraw(t, false);
            if (panel.Visible && bot.Visible) panel.PlaceNear(bot.Bounds, Screen.FromRectangle(bot.Bounds).WorkingArea);
            HarvestVoice();
            ShowNotice();
        }

        void ShowNotice()
        {
            if (panel.Mode != PanelWindow.Chat) return;
            if (dict != null && dict.IsActive)
                panel.SetNotice(dict.Held ? "Release Space to finish." : "Click the microphone to finish.", false);
            else if (dict != null && !dict.Done)
                panel.SetNotice("Writing down what you said...", false);
            else if (reviewVoice && panel.InputText.Trim().Length > 0)
                panel.SetNotice("This is what I heard. Edit it if you like, then press Enter to send.", false);
            else if (localError != null && DateTime.UtcNow < localErrorUntil) panel.SetNotice(localError, true);
            else if (localInfo != null && DateTime.UtcNow < localInfoUntil) panel.SetNotice(localInfo, false);
            else if (!Json.Bool(Json.Obj(st, "bridge"), "connected"))
                panel.SetNotice("Claude Code isn't connected, so prompts can't be sent yet. Open a Claude Code session that has the Mini Bot mod.", false);
            else panel.SetNotice("", false);
        }

        // ---- the panel ----

        void TogglePanel()
        {
            if (panel.Visible) HidePanel(); else ShowPanel();
        }

        void ShowPanel()
        {
            if (!bot.Visible) return;
            panel.Relayout();
            panel.PlaceNear(bot.Bounds, Screen.FromRectangle(bot.Bounds).WorkingArea);
            panel.Show();
            Native.SetForegroundWindow(panel.Handle);
            panel.FocusInput();
        }

        void HidePanel()
        {
            reviewVoice = false;
            if (dict != null && !dict.Done) { silentEnd = true; dict.Cancel(); }
            if (panel.Visible) panel.Hide();
        }

        void Send(string text, string source)
        {
            var body = new Dictionary<string, object> { { "text", text }, { "source", source } };
            if (attached.Count > 0) body["attachments"] = attached.Select(AttachmentBody).ToArray();
            bool ok = Try(delegate { api.Post("/v1/prompts", body); });
            if (!ok) return;
            reviewVoice = false;
            localError = null;
            lastPrompt = attached.Count > 0 ? "\u25A3 " + AttachedNames() + (text.Length > 0 ? "  " + text : "") : text;
            ClearAttachments();
            panel.SetInput("");
            Refresh();
        }

        // ---- voice ----

        bool holdToTalk;

        void OnMic()
        {
            if (dict != null && dict.IsActive) { dict.Stop(); return; }
            if (dict != null) return;   // still working out the last sentence
            var mic = Json.Obj(Json.Obj(st, "permissions"), "microphone");
            if (!Json.Bool(mic, "granted"))
            {
                panel.ShowConsent("Let " + look.Name + " listen through your microphone? It only listens while you use the mic button or hold Space in the prompt, a red indicator shows the whole time, and you can turn it off any time (right-click the bot > Permissions).");
                return;
            }
            StartListening();
        }

        void GrantMicrophone()
        {
            // The person has just read the question and pressed Allow.
            bool ok = Try(delegate
            {
                api.Post("/v1/permissions/microphone/grant", new Dictionary<string, object> { { "confirmed", true } });
            });
            panel.EndConsent();
            holdToTalk = false;   // the key may be long released by the time Allow is pressed
            if (ok) { Refresh(); StartListening(); }
        }

        void StartListening()
        {
            if (!Try(delegate { api.Post("/v1/permissions/microphone/capture/start", null); })) return;
            dict = new Dictation();
            try { dict.StartMic(holdToTalk); }
            catch (Exception e)
            {
                dict.Dispose();
                dict = null;
                EndCapture();
                ShowError(e.Message);
                return;
            }
            silentEnd = false;
            captureEnded = false;
            lastPartial = "";
            localError = null;
            reviewVoice = false;
            // What is already typed stays; what is said is added after it.
            voicePrefix = panel.InputText.Trim();
            Try(delegate { api.Post("/v1/voice", new Dictionary<string, object> { { "state", "listening" } }); });
            panel.SetListening(true);
            Refresh();
        }

        void EndCapture()
        {
            try { api.Post("/v1/permissions/microphone/capture/stop", null); } catch (ApiException) { }
        }

        string voicePrefix = "";
        bool captureEnded;

        string WithPrefix(string said) { return voicePrefix.Length > 0 ? voicePrefix + " " + said : said; }

        void HarvestVoice()
        {
            if (dict == null)
            {
                if (reviewVoice && panel.InputText.Trim().Length == 0) reviewVoice = false;
                return;
            }
            dict.Pump();
            if (!dict.Done)
            {
                // The microphone closes the moment the person stops talking, before the text is worked out.
                if (!dict.IsActive && !captureEnded)
                {
                    captureEnded = true;
                    EndCapture();
                    panel.SetListening(false);
                    Refresh();
                }
                panel.PushLevel(dict.Level);
                if (dict.Seconds > (dict.Held ? Dictation.MaxHeldSeconds : Dictation.MaxSeconds)) dict.Stop();
                string partial = dict.Partial;
                if (partial != lastPartial && partial.Length > 0) { lastPartial = partial; panel.SetInput(WithPrefix(partial)); }
                return;
            }
            string text = dict.Final, error = dict.Error;
            bool quiet = silentEnd, basic = !dict.UsesWhisper;
            dict.Dispose();
            dict = null;
            silentEnd = false;
            if (!captureEnded) EndCapture();
            panel.SetListening(false);
            if (text.Length > 0 && !quiet)
            {
                panel.SetInput(WithPrefix(text));
                reviewVoice = true;
                if (panel.Visible) panel.FocusInput();   // ready to read, correct and send
            }
            else if (!quiet) ShowError(error ?? "I didn't catch that.");
            // Without Whisper the words are Windows' basic guess; say how to get the good recognizer.
            if (basic && !quiet && !Dictation.WhisperAvailable)
                ShowInfo("Heard with Windows' basic recognizer, which mishears a lot. For much better accuracy run /mini-bot speech install in Claude Code.");
            Refresh();
        }

        // ---- screenshots ----

        void StartScreenshot()
        {
            // One at a time: a second ask while the first is still being answered is dropped.
            if (isStartingScreenshot || snip != null && !snip.IsDisposed) return;
            isStartingScreenshot = true;
            try { BeginScreenshot(); }
            finally { isStartingScreenshot = false; }
        }

        void BeginScreenshot()
        {
            var screen = Json.Obj(Json.Obj(st, "permissions"), "screen");
            if (!Json.Bool(screen, "granted"))
            {
                bool allowed = Question.Ask(CurrentPalette(), "Let " + look.Name + " capture your screen?",
                    "It only captures when you take a screenshot, you choose the area, and the picture stays on this computer unless you choose Ask Claude. " +
                    "You can turn this off any time (right-click the bot > Permissions).",
                    "Allow screenshots", "Not now", true);
                if (!allowed) return;
                if (!Try(delegate { st = api.Post("/v1/permissions/screen/grant", new Dictionary<string, object> { { "confirmed", true } }); })) return;
            }
            // The runtime records the capture; it refuses one without the permission.
            if (!Try(delegate { api.Post("/v1/permissions/screen/capture/start", null); })) return;
            Bitmap picture;
            List<WindowArea> others;
            try
            {
                picture = ScreenGrab.Capture(new Form[] { bot, panel, badge, settings });
                others = ScreenGrab.Windows();
            }
            catch (Exception e)
            {
                ShowError("Could not take the screenshot: " + e.Message);
                return;
            }
            finally
            {
                try { api.Post("/v1/permissions/screen/capture/stop", null); } catch (ApiException) { }
            }
            snip = new SnipWindow(picture, ScreenGrab.Desktop, others, CurrentPalette());
            snip.Finished += OnSnipped;
            snip.Show();
        }

        void OnSnipped(Bitmap picture, string action)
        {
            try
            {
                if (action == SnipWindow.Copy)
                {
                    Clipboard.SetImage(picture);
                    ShowInfo("Screenshot copied (" + picture.Width + " \u00D7 " + picture.Height + ").");
                }
                else if (action == SnipWindow.Save)
                {
                    using (var dialog = new SaveFileDialog())
                    {
                        dialog.Title = "Save screenshot";
                        dialog.Filter = "PNG image|*.png";
                        dialog.InitialDirectory = Environment.GetFolderPath(Environment.SpecialFolder.MyPictures);
                        dialog.FileName = "Screenshot " + DateTime.Now.ToString("yyyy-MM-dd HHmmss") + ".png";
                        if (dialog.ShowDialog() == DialogResult.OK)
                        {
                            picture.Save(dialog.FileName, System.Drawing.Imaging.ImageFormat.Png);
                            ShowInfo("Saved to " + dialog.FileName);
                        }
                    }
                }
                else
                {
                    // Saved where the runtime keeps screenshots (it only lets those ride along
                    // with a prompt), then attached to the next prompt in the panel.
                    string folder = Json.Str(Json.Obj(st, "paths"), "screenshots");
                    if (folder.Length == 0) { ShowError("The companion did not say where to keep screenshots."); return; }
                    Directory.CreateDirectory(folder);
                    string path = Path.Combine(folder, "screenshot-" + DateTime.Now.ToString("yyyyMMdd-HHmmss-fff") + ".png");
                    picture.Save(path, System.Drawing.Imaging.ImageFormat.Png);
                    // One screenshot at a time: a new one replaces the one waiting.
                    attached.RemoveAll(c => c.Kind == Chip.Shot);
                    attached.Insert(0, new Chip { Kind = Chip.Shot, Label = "screenshot " + picture.Width + " \u00D7 " + picture.Height, Path = path });
                    panel.SetChips(attached);
                    if (!bot.Visible) SetVisible(true);
                    ShowPanel();
                }
            }
            catch (Exception e)
            {
                ShowError("Could not use the screenshot: " + e.Message);
            }
            finally
            {
                picture.Dispose();
            }
            if (!panel.Visible && action != SnipWindow.Ask && (localInfo != null || localError != null)) ShowPanel();
        }

        // ---- attachments: the screenshot, and files and folders dropped on the bot ----

        const int MaxFiles = 10;

        void ClearAttachments()
        {
            attached.Clear();
            panel.SetChips(attached);
        }

        void RemoveChip(int index)
        {
            if (index >= 0 && index < attached.Count) attached.RemoveAt(index);
            panel.SetChips(attached);
        }

        static Dictionary<string, object> AttachmentBody(Chip chip)
        {
            if (chip.Kind == Chip.Shot) return new Dictionary<string, object> { { "type", "image" }, { "path", chip.Path } };
            return new Dictionary<string, object> { { "type", "file" }, { "path", chip.Path }, { "direct", chip.Direct } };
        }

        string AttachedNames()
        {
            var names = attached.Take(3).Select(c => c.Kind == Chip.Shot ? "screenshot" : c.Label).ToList();
            if (attached.Count > 3) names.Add("+" + (attached.Count - 3) + " more");
            return string.Join(", ", names.ToArray());
        }

        /// <summary>A drag with files is over the bot or the panel: the mouth opens, and stays open while it stays.</summary>
        void OnDropHover()
        {
            hoverAt = DateTime.UtcNow;
            if (panel.Mode == PanelWindow.Onboarding) return;   // it is waiting for its name first
            if (bot.Meal == null && !look.Reduced) bot.Meal = Meal.Hover();
        }

        /// <summary>
        /// Files or folders were dropped (or pasted). They are only listed here: their paths ride along with the
        /// next prompt, which the person still has to send. Nothing is opened, read or copied.
        /// </summary>
        void TakeFiles(string[] paths, PointF? at)
        {
            if (panel.Mode == PanelWindow.Onboarding)
            {
                // The first-run name question comes first; files can be given once it is answered or skipped.
                if (!look.Reduced) bot.Meal = Meal.Decline();
                return;
            }
            int have = attached.Count(c => c.Kind != Chip.Shot);
            int added = 0, leftOut = 0;
            string problem = null;
            bool meh = false, big = false;
            foreach (string path in paths)
            {
                if (string.IsNullOrEmpty(path)) continue;
                if (path.StartsWith(@"\\"))
                {
                    problem = "Files on a network share aren't supported. Drop a file from this computer.";
                    continue;
                }
                bool folder = Directory.Exists(path);
                if (!folder && !File.Exists(path))
                {
                    problem = "I couldn't find that file.";
                    continue;
                }
                if (attached.Any(c => c.Kind != Chip.Shot && string.Equals(c.Path, path, StringComparison.OrdinalIgnoreCase))) continue;
                if (have + added >= MaxFiles) { leftOut++; continue; }

                var chip = new Chip
                {
                    Kind = folder ? Chip.Folder : Chip.File,
                    Path = path,
                    Label = (folder ? Path.GetFileName(path.TrimEnd('\\', '/')) : Path.GetFileName(path)),
                    Direct = folder || FileKinds.IsDirect(path),
                    Note = FileKinds.NoteFor(path, folder)
                };
                if (chip.Label.Length == 0) chip.Label = path;
                if (!chip.Direct) meh = true;
                if (!folder && FileKinds.IsBig(path)) big = true;
                attached.Add(chip);
                added++;
            }

            if (added == 0)
            {
                if (problem == null && leftOut == 0) { ShowInfo("That is already attached."); return; }
                if (!look.Reduced) bot.Meal = Meal.Decline();
                ShowError(problem ?? "That is the limit: " + MaxFiles + " files at a time. Send these first.");
                if (!panel.Visible) ShowPanel();
                return;
            }

            if (!look.Reduced) bot.Meal = Meal.Take(added, meh, big, at);
            panel.SetChips(attached);
            if (leftOut > 0) ShowInfo("Took " + added + ". The limit is " + MaxFiles + " files at a time, so " + leftOut + " were left out.");
            else if (problem != null) ShowInfo("Took " + added + ". " + problem);
            reviewVoice = false;
            if (!panel.Visible) ShowPanel(); else panel.FocusInput();
        }

        // ---- first run ----

        void FinishOnboarding(string chosen)
        {
            var profile = ActiveProfile();
            if (chosen.Length > 0 && chosen != Json.Str(profile, "name"))
            {
                try { st = api.Apply(Op("rename", "id", Json.Str(profile, "id"), "name", chosen)); }
                catch (ApiException e) { panel.ShowOnboardingError(e.Message); return; }
            }
            Try(delegate { st = api.Apply(Op("settings", "patch", new Dictionary<string, object> { { "onboarded", true } })); });
            panel.EndOnboarding();
            panel.Hide();
            Apply();
        }

        // ---- settings, visibility, menus ----

        void OpenSettings()
        {
            // Opened once the click that asked for it has finished, so the new window is not shown mid-click.
            panel.BeginInvoke(new Action(ShowSettings));
        }

        void ShowSettings()
        {
            bool isNew = settings == null || settings.IsDisposed;
            if (isNew) settings = new SettingsWindow(api, delegate (Dictionary<string, object> s) { st = s; Apply(); });
            settings.LoadState(st, isNew);
            settings.Show();
            if (!Native.IsWindowVisible(settings.Handle)) Native.ShowWindow(settings.Handle, 5);
            settings.Activate();
        }

        void SetVisible(bool visible)
        {
            Try(delegate { st = api.Apply(Op("settings", "patch", new Dictionary<string, object> { { "visible", visible } })); });
            Apply();
        }

        ContextMenuStrip currentMenu;

        void ShowMenu(Point at)
        {
            // The previous menu is disposed here, never while it is closing.
            if (currentMenu != null) currentMenu.Dispose();
            var menu = new ContextMenuStrip();
            menu.Renderer = new ThemedMenuRenderer(CurrentPalette());
            currentMenu = menu;
            menu.Items.Add(panel.Visible ? "Close prompt" : "Open prompt", null, delegate { TogglePanel(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Take screenshot", null, delegate { bot.BeginInvoke(new Action(StartScreenshot)); });
            menu.Items.Add("Hide", null, delegate { SetVisible(false); });
            menu.Items.Add("Customize...", null, delegate { OpenSettings(); });

            var change = new ToolStripMenuItem("Change bot");
            var cfg = Json.Obj(st, "config");
            string active = Json.Str(cfg, "activeProfileId");
            foreach (var p in Json.Arr(cfg, "profiles").OfType<Dictionary<string, object>>())
            {
                string id = Json.Str(p, "id");
                var item = new ToolStripMenuItem(Json.Str(p, "name")) { Checked = id == active };
                item.Click += delegate { Try(delegate { st = api.Apply(Op("select", "id", id)); }); Apply(); };
                change.DropDownItems.Add(item);
            }
            change.DropDownItems.Add(new ToolStripSeparator());
            change.DropDownItems.Add("New bot...", null, delegate { NewBot(); });
            menu.Items.Add(change);
            menu.Items.Add(BuildPermissionsMenu());
            if (controlStatus != "off") menu.Items.Add("Stop computer control", null, delegate { Halt("the person stopped it"); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Stop Mini Bot", null, delegate { ConfirmStop(); });
            Native.SetForegroundWindow(bot.Handle);
            menu.Show(at);
        }

        ToolStripMenuItem BuildPermissionsMenu()
        {
            var menu = new ToolStripMenuItem("Permissions");
            var perms = Json.Obj(st, "permissions");
            foreach (var kind in new[] { "microphone", "screen", "computer" })
            {
                var a = Json.Obj(perms, kind);
                string label = kind == "computer" ? "Computer control" : char.ToUpper(kind[0]) + kind.Substring(1);
                string status = Json.Bool(a, "active") ? "in use" : Json.Bool(a, "granted") ? "allowed" : "off";
                var item = new ToolStripMenuItem(label + ": " + status);
                string k = kind;
                if (Json.Bool(a, "granted"))
                {
                    item.Text = label + ": " + status + " - turn off";
                    item.Click += delegate { Try(delegate { st = api.Post("/v1/permissions/" + k + "/revoke", null); }); Apply(); };
                }
                else if (kind == "microphone")
                {
                    item.Text = "Microphone: off - allow...";
                    item.Click += delegate { AllowMicrophoneFromMenu(); };
                }
                else
                {
                    item.Enabled = false;
                    item.ToolTipText = "Grant this from Claude Code with /mini-bot permissions.";
                }
                menu.DropDownItems.Add(item);
            }
            return menu;
        }

        void AllowMicrophoneFromMenu()
        {
            var answer = MessageBox.Show(
                "Let " + look.Name + " listen through your microphone?\n\nIt only listens while you use the mic button or hold Space in the prompt, a red indicator shows the whole time, and you can turn it off any time.",
                "Allow microphone", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
            if (answer != DialogResult.Yes) return;
            Try(delegate { st = api.Post("/v1/permissions/microphone/grant", new Dictionary<string, object> { { "confirmed", true } }); });
            Apply();
        }

        void NewBot()
        {
            var pal = Ui.PaletteFor(Json.Str(Json.Obj(ActiveProfile(), "appearance"), "theme", "dark"), look.Accent);
            string name = NamePrompt.Ask(null, pal, "New bot", "What should the new bot be called?", "");
            if (name == null) return;
            Try(delegate { st = api.Apply(Op("create", "name", name)); });
            Apply();
            OpenSettings();
        }

        void ConfirmStop()
        {
            var answer = MessageBox.Show("Stop Mini Bot? The floating bot closes and any microphone or screen access ends. Claude Code keeps running.",
                "Stop Mini Bot", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
            if (answer == DialogResult.Yes) Try(delegate { api.Post("/v1/shutdown", null); });
        }

        // ---- the access indicator and the tray icon ----

        void BuildBadge()
        {
            badge = new NoActivateForm();
            badge.BackColor = Color.FromArgb(200, 30, 30);
            badge.Size = new Size(Ui.Px(380), Ui.Px(28));
            badge.Cursor = Cursors.Hand;
            badgeLabel = new Label
            {
                Dock = DockStyle.Fill, ForeColor = Color.White, TextAlign = ContentAlignment.MiddleCenter, Font = Ui.Font(9f, FontStyle.Bold)
            };
            badge.Controls.Add(badgeLabel);
            EventHandler stop = delegate { StopEverythingActive(); };
            badge.Click += stop;
            badgeLabel.Click += stop;
        }

        void ApplyBadge()
        {
            var indicator = Json.Obj(st, "indicator");
            if (Json.Bool(indicator, "visible"))
            {
                var all = Json.Arr(indicator, "kinds").OfType<string>().ToList();
                var others = all.Where(k => k != "computer").ToArray();
                string text;
                if (all.Contains("computer"))
                {
                    // Computer control says how to take over and how to stop, the two things the person needs most then.
                    string key = Json.Str(Json.Obj(Json.Obj(st, "config"), "computer"), "stopKey", "Ctrl+Alt+Esc");
                    text = controlStatus == "paused"
                        ? "Paused: you have control. Click here to stop Claude using your PC"
                        : "Claude is using your PC. Move the mouse to take over. " + key + " or click here to stop";
                    if (others.Length > 0) text += " (and your " + string.Join(" and ", others) + ")";
                }
                else text = "Mini Bot is using your " + string.Join(" and ", others) + " - click to stop";
                badgeLabel.Text = text;
                badge.BackColor = controlStatus == "paused" ? Color.FromArgb(176, 112, 0) : Color.FromArgb(200, 30, 30);
                badge.Width = Math.Max(Ui.Px(380), TextRenderer.MeasureText(text, badgeLabel.Font).Width + Ui.Px(40));
                var work = Screen.PrimaryScreen.WorkingArea;
                badge.Location = new Point(work.Left + (work.Width - badge.Width) / 2, work.Top);
                if (!badge.Visible)
                {
                    // Showing the bar activates it even though it asks not to be. The prompt must keep the keyboard
                    // (a key held down to talk would otherwise be taken for "let go"), and so must the window Claude
                    // is working in (its next keys would otherwise land on the bar, and be refused).
                    bool promptHadFocus = panel.Visible && panel.ContainsFocus;
                    IntPtr front = Win.GetForegroundWindow();
                    badge.Show();
                    if (promptHadFocus) panel.FocusInput();
                    else if (front != IntPtr.Zero && Win.GetForegroundWindow() == badge.Handle) Native.SetForegroundWindow(front);
                }
            }
            else if (badge.Visible) badge.Hide();
        }

        void StopEverythingActive()
        {
            if (dict != null && !dict.Done) { silentEnd = true; dict.Cancel(); }
            foreach (var kind in Json.Arr(Json.Obj(st, "indicator"), "kinds").OfType<string>())
            {
                string k = kind;
                // Computer control is ended as the person ending it, so the log says who stopped it.
                if (k == "computer") { try { api.Overlay("/v1/computer/halt", new Dictionary<string, object> { { "reason", "the person stopped it" } }); } catch (ApiException) { } continue; }
                try { api.Post("/v1/permissions/" + k + "/capture/stop", null); } catch (ApiException) { }
            }
            Refresh();
        }

        void BuildTray()
        {
            var icon = Painter.RenderIcon("clawd", "claude", 32);
            tray = new NotifyIcon { Icon = Icon.FromHandle(icon.GetHicon()), Visible = true, Text = "Claude Mini Bot" };
            var menu = new ContextMenuStrip();
            menu.Renderer = new ThemedMenuRenderer(CurrentPalette());
            menu.Items.Add("Show or hide the bot", null, delegate { SetVisible(!Json.Bool(Json.Obj(st, "config"), "visible", true)); });
            menu.Items.Add("Open prompt", null, delegate { if (!bot.Visible) SetVisible(true); ShowPanel(); });
            menu.Items.Add("Take screenshot", null, delegate { bot.BeginInvoke(new Action(StartScreenshot)); });
            menu.Items.Add("Customize...", null, delegate { OpenSettings(); });
            var stopControl = new ToolStripMenuItem("Stop computer control", null, delegate { Halt("the person stopped it"); });
            menu.Items.Add(stopControl);
            menu.Opening += delegate { stopControl.Enabled = controlStatus != "off"; };
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Stop Mini Bot", null, delegate { ConfirmStop(); });
            tray.ContextMenuStrip = menu;
            tray.MouseClick += delegate (object s, MouseEventArgs e)
            {
                if (e.Button == MouseButtons.Left) SetVisible(!Json.Bool(Json.Obj(st, "config"), "visible", true));
            };
        }

        // ---- placing the bot ----

        void PlaceBot()
        {
            var size = Painter.WindowSize(look);
            var pos = Json.Obj(ActiveProfile(), "position");
            string anchor = Json.Str(pos, "anchor", "bottom-right");
            Rectangle work = Screen.PrimaryScreen.WorkingArea;
            int margin = Ui.Px(24);
            int x, y;
            if (anchor == "custom")
            {
                x = Json.Int(pos, "x");
                y = Json.Int(pos, "y");
                work = Screen.FromPoint(new Point(x, y)).WorkingArea;
            }
            else
            {
                x = anchor.EndsWith("left") ? work.Left + margin : work.Right - size.Width - margin;
                y = anchor.StartsWith("top") ? work.Top + margin : work.Bottom - size.Height - margin;
            }
            x = Math.Max(work.Left, Math.Min(x, work.Right - size.Width));
            y = Math.Max(work.Top, Math.Min(y, work.Bottom - size.Height));
            bot.Size = size;
            bot.Location = new Point(x, y);
            bot.Redraw(clock.Elapsed.TotalSeconds, true);
        }

        // ---- shutting down ----

        void Quit()
        {
            poll.Stop();
            frame.Stop();
            Application.ExitThread();
        }

        void Cleanup()
        {
            if (dict != null) { dict.Cancel(); dict.Dispose(); }
            EndCapture();
            if (hotkey != null) hotkey.Dispose();
            Microsoft.Win32.SystemEvents.SessionSwitch -= OnSessionSwitch;
            if (worker != null) worker.Dispose();
            if (watch != null) watch.Dispose();
            if (stopKey != null) stopKey.Dispose();
            if (controlFrame != null) controlFrame.Dispose();
            if (tray != null) { tray.Visible = false; tray.Dispose(); }
        }
    }
}
