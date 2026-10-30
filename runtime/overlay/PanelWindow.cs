// The compact panel that opens next to the bot when it is clicked, drawn as a small
// piece of Claude Code's terminal: black, a rounded border in the accent colour,
// a monospace font, a `>` prompt, `●` before the reply, and the live status line
// with Claude Code's spinner. It also shows the two short questions that belong to
// the bot itself: the microphone consent and computer control's questions (in Claude
// Code's permission colour), and the first-run "what should I be called?".
//
// It is a front-end only. Typing here queues a prompt for Claude Code; nothing
// in this window talks to a model.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace MiniBot
{
    public class PanelWindow : Form
    {
        public event Action<string> SendRequested;
        public event Action MicRequested;
        public event Action MicHoldStarted;                // Space held down in the empty prompt: start listening
        public event Action MicHoldReleased;               // ...and let go: finish listening
        public event Action ScreenshotRequested;
        public event Action<int> ChipRemoved;              // the x on an attachment chip: its position in the row
        public event Action<string[]> FilesDropped;        // files or folders dropped on the panel, or pasted from the clipboard
        public event Action DropHover;                     // a drag with files is over the panel (again and again while it stays)
        public event Action SettingsRequested;
        public event Action CloseRequested;
        public event Action ConsentAllowed;
        public event Action ConsentDeclined;
        public event Action<int> ChoiceMade;               // a button of a question card: its position, 0 first
        public event Action<string> OnboardingContinued;   // the chosen name, or "" for none
        public event Action OnboardingSkipped;
        public event Action InputEdited;                   // the person typed (cancels a pending voice send)
        public event Action<int, int> SizeCommitted;       // the person finished resizing: width and reply height, at 100% scaling

        public const string Chat = "chat", Consent = "consent", Onboarding = "onboarding";

        // The size limits in pixels at 100% scaling, the same as PANEL_WIDTH_RANGE and PANEL_REPLY_RANGE in shared/config.mjs.
        const int MinPanelWidth = 320, MaxPanelWidth = 900, MinReplyHeight = 80, MaxReplyHeight = 600;
        const int DefaultPanelWidth = 380, DefaultReplyHeight = 150;
        const int LargeWidth = 640;       // the large view is at least this wide...
        const double LargeShare = 0.6;    // ...and this share of the screen's height; replies that grow stop there too
        const int KeyStep = 40;           // Ctrl+Alt+arrow
        const int MaxInputLines = 6;
        const int WM_SETCURSOR = 0x20;

        enum Grip { None, Horizontal, Vertical, Corner }

        Palette pal = Ui.PaletteFor("dark", "claude");
        readonly Label title = new Label();
        readonly StatusLine status = new StatusLine();
        readonly Label notice = new Label();
        readonly RichTextBox response = new RichTextBox();
        readonly PromptBox input = new PromptBox();
        readonly IconButton btnExpand = new IconButton("expand");
        readonly IconButton btnSettings = new IconButton("sliders");
        readonly IconButton btnClose = new IconButton("close");
        readonly IconButton btnMic = new IconButton("mic");
        readonly IconButton btnShot = new IconButton("camera");
        readonly ChipBar chips = new ChipBar();
        readonly ModelLabel modelLbl = new ModelLabel();
        readonly CommandList picker = new CommandList();
        readonly IconButton btnSend = new IconButton("send");
        readonly TextButton btnAllow = new TextButton("Allow");
        readonly TextButton btnNotNow = new TextButton("Not now");
        readonly TextButton btnThird = new TextButton("");
        string[] choices;   // the labels of the question card shown now; null while the microphone consent is shown
        readonly TextButton btnContinue = new TextButton("Continue");
        readonly TextButton btnSkip = new TextButton("Skip for now");
        readonly ToolTip tips = new ToolTip();

        // Hold Space to talk, as in Claude Code: the first press types its one space, and the key repeating
        // (a second, continuous press) starts listening and takes that space back. Only this box reacts.
        bool spaceDown, holdFired, listening;
        string preText = "";
        int preStart, preLength;
        readonly VoiceMeter meter = new VoiceMeter();

        string mode = Chat;
        bool hasResponse;
        bool settingText;
        bool noticeIsError;
        string promptShown = "";
        string replyShown = "";
        bool replyIsError;
        Bitmap icon;
        string iconKey = "";
        Rectangle inputRect;
        Rectangle responseRect;
        Rectangle iconRect;

        // The size. The person's choice is kept per bot (see SetPreferences); what is shown can be smaller,
        // because the panel never covers the bot or leaves the screen.
        int prefWidth = DefaultPanelWidth, prefReply = DefaultReplyHeight;
        bool autoFit;              // grow for a long reply
        bool fitWanted;            // ...and the current reply is one that should
        bool expanded;             // the large view, until the next reply or a drag
        int chromeH;               // the panel's height without the reply area (and the gap under it)
        int replyPx;               // the reply area's height as laid out
        int inputLines = 1;
        int promptLineH;           // the prompt's line pitch, measured once
        bool scrollOn;
        // The slash-command list under the prompt: open while the text is "/" and what follows matches a command.
        bool pickerOpen, pickerDismissed;
        int pickerRows;
        string renderedText = "";
        int contentWidth = -1, contentHeight;
        readonly Timer commitTimer = new Timer();

        // Where the panel sits. It lines up with the bot on one side and grows away from it, so the
        // edges that can be dragged are the two on the far side.
        Rectangle lastBot, lastWork;
        bool placed;
        bool growLeft, growUp;
        bool dragging;
        Grip dragGrip;
        Rectangle dragStart;
        Size dragFrom;             // the chosen width and reply height when the drag began

        public string Mode { get { return mode; } }

        public PanelWindow()
        {
            Text = "Mini Bot panel";
            AccessibleName = "Mini Bot panel";
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            TopMost = true;
            KeyPreview = true;
            DoubleBuffered = true;
            ResizeRedraw = true;
            Padding = new Padding(0);

            title.Font = Ui.Mono(10.5f, FontStyle.Bold);
            title.AutoSize = false;
            notice.Font = Ui.Mono(9f);
            notice.AutoSize = false;

            response.ReadOnly = true;
            response.BorderStyle = BorderStyle.None;
            response.ScrollBars = RichTextBoxScrollBars.Vertical;
            response.Font = Ui.Mono(9.5f);
            response.TabStop = false;
            response.DetectUrls = false;
            response.AccessibleName = "Reply";

            input.BorderStyle = BorderStyle.None;
            input.Font = Ui.Mono(10f);
            input.MaxLength = 8000;
            input.AccessibleName = "Prompt";
            input.Hint = "Type, or hold Space to talk";

            tips.SetToolTip(btnSettings, "Customize this bot");
            tips.SetToolTip(btnExpand, "Make the panel larger (or double-click the top)");
            tips.SetToolTip(btnClose, "Close");
            tips.SetToolTip(btnMic, "Speak a prompt");
            tips.SetToolTip(btnShot, "Take a screenshot");
            tips.SetToolTip(btnSend, "Send");
            btnSend.Primary = true;

            Control[] all = { meter, title, status, notice, response, input, btnExpand, btnSettings, btnClose, btnMic, btnShot, btnSend, chips, modelLbl, btnAllow, btnNotNow, btnThird, btnContinue, btnSkip, picker };
            foreach (var c in all) Controls.Add(c);
            btnAllow.Primary = true;
            btnContinue.Primary = true;

            commitTimer.Interval = 600;
            commitTimer.Tick += delegate { commitTimer.Stop(); CommitSize(); };
            Disposed += delegate { commitTimer.Dispose(); };

            btnExpand.Click += delegate { ToggleExpanded(); };
            title.DoubleClick += delegate { ToggleExpanded(); };
            status.DoubleClick += delegate { ToggleExpanded(); };
            btnClose.Click += delegate { Raise(CloseRequested); };
            btnSettings.Click += delegate { Raise(SettingsRequested); };
            btnMic.Click += delegate { Raise(MicRequested); };
            btnShot.Click += delegate { Raise(ScreenshotRequested); };
            chips.Removed += delegate (int index) { if (ChipRemoved != null) ChipRemoved(index); };
            btnSend.Click += delegate { SendNow(); };
            btnAllow.Click += delegate { if (choices != null) Choose(0); else Raise(ConsentAllowed); };
            btnNotNow.Click += delegate { if (choices != null) Choose(1); else Raise(ConsentDeclined); };
            btnThird.Click += delegate { Choose(2); };
            btnContinue.Click += delegate { FinishOnboarding(); };
            btnSkip.Click += delegate { Raise(OnboardingSkipped); };
            picker.Picked += delegate (CommandItem item) { Choose(item, false); input.Focus(); };
            input.TextChanged += delegate { if (!settingText && InputEdited != null) InputEdited(); UpdateSendEnabled(); pickerDismissed = false; UpdatePicker(); FitInput(); };
            input.KeyDown += OnInputKey;
            input.KeyUp += OnInputKeyUp;
            input.LostFocus += delegate { if (!(ActiveForm is NoActivateForm)) EndHold(); };

            HookDrop(this);
            ApplyPalette(pal);
            Relayout();
        }

        // ---- files dropped on the panel, or pasted ----

        /// <summary>Files can be dropped anywhere on the panel, whichever control is under the pointer.</summary>
        void HookDrop(Control c)
        {
            c.AllowDrop = true;
            c.DragEnter += OnDragFiles;
            c.DragOver += OnDragFiles;
            c.DragDrop += OnDropFiles;
            foreach (Control child in c.Controls) HookDrop(child);
        }

        static bool HasFiles(DragEventArgs e) { return e.Data != null && e.Data.GetDataPresent(DataFormats.FileDrop); }

        void OnDragFiles(object sender, DragEventArgs e)
        {
            bool files = HasFiles(e) && mode == Chat;
            e.Effect = files ? DragDropEffects.Copy : DragDropEffects.None;
            if (files) Raise(DropHover);
        }

        void OnDropFiles(object sender, DragEventArgs e)
        {
            if (!HasFiles(e) || mode != Chat) return;
            var paths = e.Data.GetData(DataFormats.FileDrop) as string[];
            if (paths != null && paths.Length > 0 && FilesDropped != null) FilesDropped(paths);
        }

        /// <summary>Ctrl+V with files copied in Explorer attaches them, as dropping them would.</summary>
        bool TryPasteFiles()
        {
            try
            {
                if (!Clipboard.ContainsFileDropList()) return false;
                var list = Clipboard.GetFileDropList();
                var paths = new string[list.Count];
                list.CopyTo(paths, 0);
                if (paths.Length == 0 || FilesDropped == null) return false;
                FilesDropped(paths);
                return true;
            }
            catch (Exception) { return false; }
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var p = base.CreateParams;
                p.ExStyle |= Native.WS_EX_TOOLWINDOW;
                return p;
            }
        }

        static void Raise(Action a) { if (a != null) a(); }

        // ---- the slash-command list ----

        /// <summary>The commands Claude Code can run, as the companion has them; typing "/" lists and narrows them.</summary>
        public void SetCommands(IList<CommandItem> items)
        {
            picker.SetItems(items);
            UpdatePicker();
        }

        /// <summary>Opens, narrows or closes the list to match the prompt: it is open while the text is a slash and a command still fits it.</summary>
        void UpdatePicker()
        {
            string text = input.Text;
            bool want = mode == Chat && !listening && !pickerDismissed && text.StartsWith("/", StringComparison.Ordinal) && text.IndexOf('\n') < 0;
            if (want) want = picker.Filter(text.Substring(1)) > 0;
            int rows = want ? picker.Rows : 0;
            input.CaptureTab = want;
            if (want == pickerOpen && rows == pickerRows)
            {
                if (want) picker.Invalidate();
                return;
            }
            pickerOpen = want;
            pickerRows = rows;
            Relayout();
        }

        /// <summary>
        /// Takes a command from the list. Completing puts its name in the prompt and waits for the rest; running (Enter)
        /// sends it at once, unless it needs something typed after it, in which case it is completed instead.
        /// </summary>
        void Choose(CommandItem item, bool run)
        {
            if (item == null) return;
            string full = "/" + item.Name;
            if (run && !item.TakesArgs)
            {
                SetInput(full);
                SendNow();
            }
            else SetInput(full + " ");
        }

        /// <summary>Keys for the open list. Returns true when the key was for it.</summary>
        bool HandlePickerKey(KeyEventArgs e)
        {
            if (e.Alt || e.Control) return false;
            switch (e.KeyCode)
            {
                case Keys.Down: picker.MoveSelection(1); return true;
                case Keys.Up: picker.MoveSelection(-1); return true;
                case Keys.PageDown: picker.MoveSelection(CommandList.MaxRows); return true;
                case Keys.PageUp: picker.MoveSelection(-CommandList.MaxRows); return true;
                case Keys.Tab: Choose(picker.Selected, false); return true;
                case Keys.Enter:
                    if (e.Shift) return false;
                    Choose(picker.Selected, true);
                    return true;
                case Keys.Escape:
                    pickerDismissed = true;   // the next Escape closes the panel as usual
                    UpdatePicker();
                    return true;
            }
            return false;
        }

        void OnInputKey(object sender, KeyEventArgs e)
        {
            if (pickerOpen && mode == Chat && !listening && HandlePickerKey(e))
            {
                e.SuppressKeyPress = true;
                e.Handled = true;
                return;
            }
            if (e.Control && !e.Alt && e.KeyCode == Keys.V && mode == Chat && TryPasteFiles())
            {
                e.SuppressKeyPress = true;
                e.Handled = true;
                return;
            }
            if (e.KeyCode == Keys.Space && !e.Control && !e.Alt && mode == Chat)
            {
                if (!spaceDown)
                {
                    spaceDown = true;
                    holdFired = false;
                    preText = input.Text;
                    preStart = input.SelectionStart;
                    preLength = input.SelectionLength;
                    // An empty prompt gets no leading space; otherwise this press types its one space as usual.
                    if (preText.Trim().Length == 0) e.SuppressKeyPress = true;
                    return;
                }
                // The key is still down and repeating: never a second space. This is "talk".
                e.SuppressKeyPress = true;
                if (!holdFired && !e.Shift)
                {
                    holdFired = true;
                    settingText = true;
                    input.Text = preText;
                    input.SelectionStart = Math.Min(preStart, input.Text.Length);
                    input.SelectionLength = Math.Min(preLength, input.Text.Length - input.SelectionStart);
                    settingText = false;
                    UpdateSendEnabled();
                    Raise(MicHoldStarted);
                }
                return;
            }
            if (e.KeyCode != Keys.Space && !holdFired) spaceDown = false;
            // Enter sends; Shift+Enter adds a line (the name box in onboarding stays a single line).
            if (e.KeyCode == Keys.Enter && (!e.Shift || mode == Onboarding))
            {
                e.SuppressKeyPress = true;
                if (mode == Onboarding) FinishOnboarding(); else SendNow();
            }
            else if (e.KeyCode == Keys.Escape)
            {
                e.SuppressKeyPress = true;
                if (mode == Onboarding) Raise(OnboardingSkipped); else Raise(CloseRequested);
            }
        }

        void OnInputKeyUp(object sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Space) EndHold();
        }

        void EndHold()
        {
            bool wasHeld = spaceDown && holdFired;
            spaceDown = false;
            holdFired = false;
            if (wasHeld) Raise(MicHoldReleased);
        }

        void SendNow()
        {
            var text = input.Text.Trim();
            // A screenshot can be sent on its own; Claude is then asked to take a look at it.
            if ((text.Length > 0 || chips.Count > 0) && SendRequested != null) SendRequested(text);
        }

        void FinishOnboarding()
        {
            if (OnboardingContinued != null) OnboardingContinued(input.Text.Trim());
        }

        void UpdateSendEnabled() { btnSend.Enabled = input.Text.Trim().Length > 0 || chips.Count > 0; }

        /// <summary>The screenshot, files and folders that go with the next prompt, as chips; none to clear them.</summary>
        public void SetChips(IList<Chip> items)
        {
            items = items ?? new List<Chip>();
            chips.SetItems(items);
            UpdateHint();
            UpdateSendEnabled();
            Relayout();
        }

        /// <summary>The grey line in the empty prompt: what to do, or what the attachments are there for.</summary>
        void UpdateHint()
        {
            if (mode == Onboarding) { input.Hint = "A name for your bot (optional)"; return; }
            var items = chips.Items;
            bool shots = false, files = false;
            foreach (var chip in items)
            {
                if (chip.Kind == Chip.Shot) shots = true; else files = true;
            }
            input.Hint = items.Count == 0 ? "Type, or hold Space to talk"
                : shots && !files ? "Ask about this screenshot..."
                : files && !shots ? (items.Count == 1 ? "Ask about this " + (items[0].Kind == Chip.Folder ? "folder" : "file") + "..." : "Ask about these files...")
                : "Ask about these...";
        }

        // ---- what the App sets ----

        public void ApplyPalette(Palette p)
        {
            pal = p;
            BackColor = p.Bg;
            ForeColor = p.Fg;
            title.ForeColor = p.Fg; title.BackColor = p.Bg;
            status.Colors = p; status.BackColor = p.Bg; status.Invalidate();
            meter.Colors = p; meter.BackColor = p.Bg; meter.Invalidate();
            notice.BackColor = p.Bg; notice.ForeColor = noticeIsError ? p.Danger : p.Fg;
            response.BackColor = p.Field; response.ForeColor = p.Fg;
            input.BackColor = p.Bg; input.ForeColor = p.Fg; input.HintColor = p.Muted;
            foreach (var b in new[] { btnExpand, btnSettings, btnClose, btnMic, btnShot, btnSend }) { b.Colors = p; b.BackColor = p.Bg; b.Invalidate(); }
            chips.Colors = p; chips.BackColor = p.Bg; chips.Invalidate();
            modelLbl.Colors = p; modelLbl.BackColor = p.Bg; modelLbl.Invalidate();
            picker.Colors = p; picker.BackColor = p.Bg; picker.Invalidate();
            foreach (var b in new[] { btnAllow, btnNotNow, btnThird, btnContinue, btnSkip }) { b.Colors = p; b.BackColor = p.Bg; b.Invalidate(); }
            RenderConversation();
            Invalidate();
        }

        /// <summary>Which model the session runs on, its effort, how much to show of that (full, model, off), and a note while it has just changed.</summary>
        public void SetModel(string name, string effort, string labelMode, string note)
        {
            bool before = modelLbl.HasContent;
            modelLbl.Set(name, effort, labelMode, note);
            if (before != modelLbl.HasContent) Relayout();
        }

        /// <summary>The bot's name and face, shown at the top of the panel.</summary>
        public void SetBot(Look look)
        {
            title.Text = look.Name;
            string key = look.Avatar + look.Skin;
            if (key != iconKey)
            {
                iconKey = key;
                if (icon != null) icon.Dispose();
                icon = Painter.RenderIcon(look.Avatar, look.Skin, Ui.Px(40));
                Invalidate();
            }
        }

        public void SetStatus(string phase, bool listening, string detail, string id)
        {
            status.SetState(phase, listening, detail, id);
        }

        /// <summary>The last prompt the bot sent and what Claude Code answered. Empty reply hides the box.</summary>
        public void SetConversation(string prompt, string reply, bool isError)
        {
            if (prompt == promptShown && reply == replyShown && isError == replyIsError) return;
            promptShown = prompt ?? "";
            replyShown = reply ?? "";
            replyIsError = isError;
            RenderConversation();
            bool has = replyShown.Length > 0;
            if (!has) expanded = false;
            fitWanted = autoFit && has;
            if (has != hasResponse) { hasResponse = has; Relayout(); }
            else if (fitWanted) Relayout();   // a longer reply may need a taller box
        }

        void RenderConversation()
        {
            response.Clear();
            renderedText = "";
            contentWidth = -1;
            if (replyShown.Length == 0) return;
            response.SelectionFont = Ui.Mono(9.5f);
            string asked = promptShown.Length > 0 ? "> " + promptShown + "\n\n" : "";
            string answer = "● " + replyShown.Replace("\r\n", "\n");
            if (asked.Length > 0)
            {
                response.SelectionColor = pal.Muted;
                response.AppendText(asked);
            }
            response.SelectionStart = response.TextLength;
            response.SelectionColor = replyIsError ? pal.Danger : pal.Fg;
            response.AppendText(answer);
            response.SelectionStart = 0;
            renderedText = asked + answer;
        }

        /// <summary>The height the whole reply needs, for growing the box to fit it.</summary>
        int ContentPx()
        {
            if (renderedText.Length == 0) return 0;
            int width = Math.Max(Ui.Px(40), PanelWidth() - 2 * Ui.Px(14) - Ui.Px(20) - SystemInformation.VerticalScrollBarWidth);
            if (width != contentWidth)
            {
                contentWidth = width;
                contentHeight = TextRenderer.MeasureText(renderedText, response.Font, new Size(width, 0),
                    TextFormatFlags.WordBreak | TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix).Height;
            }
            return contentHeight + Ui.Px(16) + Ui.Px(8);
        }

        public void SetNotice(string text, bool isError)
        {
            if (mode != Chat) return;
            if (notice.Text == (text ?? "") && noticeIsError == isError) return;
            notice.Text = text ?? "";
            noticeIsError = isError;
            notice.ForeColor = isError ? pal.Danger : pal.Muted;
            Relayout();
        }

        public void ShowConsent(string text)
        {
            choices = null;
            SetChoice(btnAllow, "Allow", true);
            SetChoice(btnNotNow, "Not now", false);
            mode = Consent;
            noticeIsError = false;
            notice.Text = text;
            notice.ForeColor = pal.Fg;
            Relayout();
        }

        public void EndConsent()
        {
            if (mode != Consent) return;
            mode = Chat;
            choices = null;
            notice.Text = "";
            Relayout();
        }

        /// <summary>A question with two or three answers, such as computer control's. The answer comes back as ChoiceMade.</summary>
        public void ShowChoices(string text, string[] labels, int primary)
        {
            if (mode == Consent && choices != null && notice.Text == text && string.Join("|", choices) == string.Join("|", labels)) return;
            if (mode == Onboarding) input.Hint = "Type, or hold Space to talk";
            choices = labels;
            SetChoice(btnAllow, labels.Length > 0 ? labels[0] : "", primary == 0);
            SetChoice(btnNotNow, labels.Length > 1 ? labels[1] : "", primary == 1);
            SetChoice(btnThird, labels.Length > 2 ? labels[2] : "", primary == 2);
            mode = Consent;
            noticeIsError = false;
            notice.Text = text;
            notice.ForeColor = pal.Fg;
            Relayout();
        }

        /// <summary>While true, showing the panel leaves the window in front where it is (computer control's questions).</summary>
        public bool ShowQuietly;

        protected override bool ShowWithoutActivation { get { return ShowQuietly; } }

        /// <summary>True while a question card (not the microphone consent) is shown.</summary>
        public bool IsAsking { get { return mode == Consent && choices != null; } }

        static void SetChoice(TextButton button, string text, bool primary)
        {
            button.Text = text;
            button.AccessibleName = text;
            button.Primary = primary;
            button.Invalidate();
        }

        void Choose(int index)
        {
            if (choices == null || index >= choices.Length) return;
            if (ChoiceMade != null) ChoiceMade(index);
        }

        public void StartOnboarding(string botName)
        {
            mode = Onboarding;
            noticeIsError = false;
            notice.Text = "Welcome! I'm your Claude Mini Bot. I float on your screen and give you a quick way to talk to Claude Code. What would you like to call me? You can skip this and rename me any time.";
            notice.ForeColor = pal.Fg;
            SetInput(botName == "Mini" ? "" : botName);
            input.Hint = "A name for your bot (optional)";
            Relayout();
        }

        public void EndOnboarding()
        {
            if (mode != Onboarding) return;
            mode = Chat;
            notice.Text = "";
            SetInput("");
            UpdateHint();
            Relayout();
        }

        public void ShowOnboardingError(string text)
        {
            noticeIsError = true;
            notice.Text = text;
            notice.ForeColor = pal.Danger;
            Relayout();
        }

        public void SetListening(bool listening)
        {
            if (btnMic.Active == listening) return;
            this.listening = listening;
            btnMic.Active = listening;
            if (!listening) meter.Clear();
            Relayout();
            btnMic.Invalidate();
            tips.SetToolTip(btnMic, listening ? "Stop listening" : "Speak a prompt");
        }

        /// <summary>The microphone level, 0-100, for the meter.</summary>
        public void PushLevel(int level) { if (listening) meter.Push(level); }

        public string InputText { get { return input.Text; } }

        /// <summary>Sets the text without counting it as the person typing.</summary>
        public void SetInput(string text)
        {
            settingText = true;
            input.Text = text ?? "";
            input.SelectionStart = input.Text.Length;
            settingText = false;
            UpdateSendEnabled();
        }

        public void FocusInput()
        {
            Activate();
            input.Focus();
        }

        // ---- layout ----

        bool ReplyShown { get { return mode == Chat && hasResponse; } }
        bool Large { get { return expanded && ReplyShown; } }

        static int Clamp(int value, int min, int max) { return Math.Max(min, Math.Min(max, value)); }

        Rectangle Work() { return placed ? lastWork : Screen.PrimaryScreen.WorkingArea; }

        /// <summary>Whether the panel extends to the left of the bot's right edge (the bot is on the right half of the screen).</summary>
        bool OnLeft()
        {
            if (dragging || !placed) return growLeft;
            return lastBot.X + lastBot.Width / 2 > lastWork.X + lastWork.Width / 2;
        }

        static bool PlaceAbove(int height, int above, int below)
        {
            return height <= above || (height > below && above >= below);
        }

        /// <summary>The width shown: the one chosen, kept inside the limits and on the screen beside the bot.</summary>
        int PanelWidth()
        {
            int want = Ui.Px(Large ? Math.Max(prefWidth, LargeWidth) : prefWidth);
            var work = Work();
            int room = work.Width - 2 * Ui.Px(8);
            if (placed) room = (OnLeft() ? lastBot.Right - work.Left : work.Right - lastBot.X) - Ui.Px(8);
            int max = Math.Min(Ui.Px(MaxPanelWidth), room);
            return Math.Max(Ui.Px(MinPanelWidth), Math.Min(want, max));
        }

        /// <summary>The reply height asked for: the chosen one, or more in the large view or for a long reply.</summary>
        int WantedReply()
        {
            int h = Ui.Px(prefReply);
            int cap = (int)(Work().Height * LargeShare) - chromeH - Ui.Px(10);
            if (Large) h = Math.Max(h, cap);
            else if (fitWanted) h = Math.Max(h, Math.Min(ContentPx(), cap));
            return Math.Max(Ui.Px(MinReplyHeight), h);
        }

        /// <summary>The tallest the panel can be on the side of the bot it will be on.</summary>
        int RoomHeight(int wantedHeight)
        {
            var work = Work();
            if (!placed) return work.Height - Ui.Px(16);
            int gap = Ui.Px(6);
            int above = lastBot.Top - gap - work.Top, below = work.Bottom - lastBot.Bottom - gap;
            bool up = dragging ? growUp : PlaceAbove(wantedHeight, above, below);
            return up ? above : below;
        }

        public void Relayout()
        {
            int w = PanelWidth();
            bool replyOn = ReplyShown;
            int reply = replyOn ? WantedReply() : 0;
            int total = PlaceControls(w, reply);
            if (replyOn)
            {
                // Shrink the reply, never the rest, when there is not room for what was asked.
                int cut = Math.Min(total - RoomHeight(total), reply - Ui.Px(MinReplyHeight));
                if (cut > 0)
                {
                    reply -= cut;
                    total = PlaceControls(w, reply);
                }
                replyPx = reply;
                chromeH = total - reply - Ui.Px(10);
            }
            else
            {
                replyPx = 0;
                chromeH = total;
            }

            Point at = placed ? NearBot(w, total) : Location;
            bool resized = Width != w || Height != total;
            if (resized || Location != at) SetBounds(at.X, at.Y, w, total);
            if (resized)
                using (var path = Shapes.Round(new RectangleF(0, 0, Width, Height), Ui.Px(10)))
                    Region = new Region(path);
            Invalidate(true);
        }

        /// <summary>Places every control for a width and a reply height, and returns the height of the whole panel.</summary>
        int PlaceControls(int w, int reply)
        {
            int m = Ui.Px(14), gap = Ui.Px(10);
            int inner = w - 2 * m;
            int y = m;
            int bs = Ui.Px(30);

            bool chat = mode == Chat, consent = mode == Consent, onboarding = mode == Onboarding;
            btnSettings.Visible = btnClose.Visible = !onboarding;
            status.Visible = !onboarding;
            btnExpand.Visible = ReplyShown;
            string expandKind = Large ? "collapse" : "expand";
            if (btnExpand.Kind != expandKind)
            {
                btnExpand.Kind = expandKind;
                tips.SetToolTip(btnExpand, Large ? "Back to the usual size" : "Make the panel larger (or double-click the top)");
            }

            int face = Ui.Px(34);
            int buttons = ReplyShown ? 3 : 2;
            iconRect = new Rectangle(m, y, face, face);
            int textX = m + face + Ui.Px(10);
            title.SetBounds(textX, y, inner - face - Ui.Px(10) - buttons * bs, Ui.Px(20));
            status.SetBounds(textX, y + Ui.Px(18), inner - face - Ui.Px(10) - buttons * bs, Ui.Px(20));
            btnClose.SetBounds(w - m - bs, y, bs, bs);
            btnSettings.SetBounds(w - m - 2 * bs - Ui.Px(2), y, bs, bs);
            btnExpand.SetBounds(w - m - 3 * bs - Ui.Px(4), y, bs, bs);
            y += face + gap;

            // Under the header: which model the session runs on and its effort (a thin line, tucked up to the header).
            bool showModel = !onboarding && modelLbl.HasContent;
            modelLbl.Visible = showModel;
            if (showModel)
            {
                modelLbl.SetBounds(m, y - Ui.Px(4), inner, Ui.Px(16));
                y += Ui.Px(14);
            }

            response.Visible = ReplyShown;
            if (ReplyShown)
            {
                responseRect = new Rectangle(m, y, inner, reply);
                response.SetBounds(m + Ui.Px(10), y + Ui.Px(8), inner - Ui.Px(20), reply - Ui.Px(16));
                y += reply + gap;
            }
            else responseRect = Rectangle.Empty;

            bool showNotice = notice.Text.Length > 0;
            notice.Visible = showNotice;
            if (showNotice)
            {
                int nh = TextRenderer.MeasureText(notice.Text, notice.Font, new Size(inner, 0), TextFormatFlags.WordBreak).Height + Ui.Px(2);
                notice.SetBounds(m, y, inner, nh);
                y += nh + gap;
            }

            bool third = consent && choices != null && choices.Length > 2;
            btnAllow.Visible = btnNotNow.Visible = consent;
            btnThird.Visible = third;
            if (consent)
            {
                // Each button as wide as its words; a row that would not fit goes on to the next. (Which ones show is
                // decided here, not read back from Visible: that reads false for every button while the panel is hidden.)
                int bx = m, bh = Ui.Px(30);
                foreach (var b in third ? new[] { btnAllow, btnNotNow, btnThird } : new[] { btnAllow, btnNotNow })
                {
                    int bw = Math.Max(Ui.Px(84), TextRenderer.MeasureText(b.Text, b.Font).Width + Ui.Px(28));
                    if (bx > m && bx + bw > m + inner) { bx = m; y += bh + Ui.Px(6); }
                    b.SetBounds(bx, y, Math.Min(bw, inner), bh);
                    bx += bw + Ui.Px(8);
                }
                y += bh + gap;
            }

            int chipsH = chat && chips.Count > 0 ? chips.HeightFor(inner) : 0;
            chips.Visible = chipsH > 0;
            if (chipsH > 0)
            {
                chips.SetBounds(m, y, inner, chipsH);
                y += chipsH + Ui.Px(6);
            }

            // The prompt: one line, growing to MaxInputLines as the text wraps, then it scrolls.
            btnMic.Visible = btnShot.Visible = btnSend.Visible = !onboarding;
            int oneLine = Ui.Px(38);
            if (promptLineH == 0) promptLineH = Native.LineHeight(input.Font);
            int lineH = promptLineH;
            int pad = (oneLine - lineH) / 2;
            int right = onboarding ? inner : inner - 3 * bs - Ui.Px(4);
            int promptW = Ui.Px(20);
            int inputW = right - promptW - Ui.Px(20);
            int lines = InputLines(inputW);
            int fieldH = Math.Max(oneLine, lines * lineH + 2 * pad);
            inputRect = new Rectangle(m, y, right, fieldH);
            input.SetBounds(m + promptW + Ui.Px(6), y + pad, inputW, lines * lineH);
            inputLines = lines;
            if (!onboarding)
            {
                int by = y + fieldH - bs - (oneLine - bs) / 2;   // level with the last line
                btnShot.SetBounds(m + right + Ui.Px(4), by, bs, bs);
                btnMic.SetBounds(m + right + Ui.Px(4) + bs, by, bs, bs);
                btnSend.SetBounds(m + right + Ui.Px(4) + 2 * bs, by, bs, bs);
            }
            // While listening the prompt line is the meter (as in Claude Code); the box stays under it for the key events.
            meter.Visible = chat && listening;
            meter.SetBounds(inputRect.X, inputRect.Y, inputRect.Width, inputRect.Height);
            y += fieldH + gap;

            // The slash-command list sits right under the prompt, like Claude Code's own.
            bool showPicker = chat && pickerOpen && !listening && picker.Rows > 0;
            picker.Visible = showPicker;
            if (showPicker)
            {
                int pickerH = picker.HeightFor();
                int pickerY = y - gap + Ui.Px(4);
                picker.SetBounds(m, pickerY, inner, pickerH);
                y = pickerY + pickerH + gap;
            }

            btnContinue.Visible = btnSkip.Visible = onboarding;
            if (onboarding)
            {
                btnContinue.SetBounds(m, y, Ui.Px(120), Ui.Px(30));
                btnSkip.SetBounds(m + Ui.Px(128), y, Ui.Px(120), Ui.Px(30));
                y += Ui.Px(30) + gap;
            }

            return y + m - gap;
        }

        // ---- the prompt grows with its text ----

        /// <summary>How many lines the prompt should show at this width: its wrapped lines, from one to six.</summary>
        int InputLines(int width)
        {
            if (listening || mode == Onboarding) return 1;
            if (input.Width != width && width > 0) input.Width = width;
            int lines = Native.LineCount(input);
            if (NeedsScroll(lines) != scrollOn) BeginInvoke(new Action(UpdateInputScroll));
            return Clamp(lines, 1, MaxInputLines);
        }

        /// <summary>The text changed: make the prompt taller or shorter if its lines changed.</summary>
        void FitInput()
        {
            if (!input.IsHandleCreated) return;
            int lines = Native.LineCount(input);
            if (!listening && mode != Onboarding && Visible && Clamp(lines, 1, MaxInputLines) != inputLines) Relayout();
            else if (NeedsScroll(lines) != scrollOn) BeginInvoke(new Action(UpdateInputScroll));   // not from inside the box's own change event
        }

        bool NeedsScroll(int lines) { return lines > MaxInputLines && mode != Onboarding && !listening; }

        /// <summary>The scroll bar only exists past six lines. Changing it rebuilds the box, so the caret and focus are put back.</summary>
        void UpdateInputScroll()
        {
            bool needScroll = NeedsScroll(Native.LineCount(input));
            if (needScroll == scrollOn || !input.IsHandleCreated) return;
            scrollOn = needScroll;
            bool focused = input.Focused;
            int start = input.SelectionStart, length = input.SelectionLength;
            input.ScrollBars = needScroll ? ScrollBars.Vertical : ScrollBars.None;
            input.SelectionStart = start;
            input.SelectionLength = length;
            if (focused) input.Focus();
            input.ScrollToCaret();
        }

        // ---- the panel's size ----

        /// <summary>Takes the size saved with the bot. Ignored while the person is resizing.</summary>
        public void SetPreferences(int width, int replyHeight, bool grow)
        {
            if (dragging || commitTimer.Enabled) return;
            width = Clamp(width, MinPanelWidth, MaxPanelWidth);
            replyHeight = Clamp(replyHeight, MinReplyHeight, MaxReplyHeight);
            if (width == prefWidth && replyHeight == prefReply && grow == autoFit) return;
            bool sizeChanged = width != prefWidth || replyHeight != prefReply;
            prefWidth = width;
            prefReply = replyHeight;
            autoFit = grow;
            if (sizeChanged) expanded = false;
            fitWanted = autoFit && hasResponse;
            Relayout();
        }

        void ToggleExpanded()
        {
            if (!ReplyShown) return;
            expanded = !expanded;
            if (!expanded) fitWanted = false;
            Relayout();
        }

        /// <summary>Remembers what is shown as the person's choice, and tells the App to save it.</summary>
        void ChooseSize(bool width, bool reply)
        {
            if (width) prefWidth = Clamp(Ui.Unpx(Width), MinPanelWidth, MaxPanelWidth);
            if (reply && ReplyShown) prefReply = Clamp(Ui.Unpx(replyPx), MinReplyHeight, MaxReplyHeight);
            expanded = false;
            fitWanted = false;
        }

        void CommitSize()
        {
            if (SizeCommitted != null) SizeCommitted(prefWidth, prefReply);
        }

        void ResetSize()
        {
            prefWidth = DefaultPanelWidth;
            prefReply = DefaultReplyHeight;
            expanded = false;
            fitWanted = false;
            Relayout();
            CommitSize();
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            // Ctrl+Alt+arrows: right and up grow the panel, left and down shrink it.
            if (mode == Chat && (keyData & Keys.Control) != 0 && (keyData & Keys.Alt) != 0 && (keyData & Keys.Shift) == 0)
            {
                int dw = 0, dh = 0;
                switch (keyData & Keys.KeyCode)
                {
                    case Keys.Right: dw = KeyStep; break;
                    case Keys.Left: dw = -KeyStep; break;
                    case Keys.Up: dh = KeyStep; break;
                    case Keys.Down: dh = -KeyStep; break;
                }
                if (dw != 0 || (dh != 0 && ReplyShown))
                {
                    int w = Clamp(Ui.Unpx(Width) + dw, MinPanelWidth, MaxPanelWidth);
                    int h = ReplyShown ? Clamp(Ui.Unpx(replyPx) + dh, MinReplyHeight, MaxReplyHeight) : prefReply;
                    prefWidth = w;
                    prefReply = h;
                    expanded = false;
                    fitWanted = false;
                    Relayout();
                    commitTimer.Stop();
                    commitTimer.Start();   // saved once the keys stop
                    return true;
                }
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        // ---- dragging the far edges ----

        /// <summary>Which grip, if any, is under a point: the outer side edge, the outer top or bottom edge, or the outer corner.</summary>
        Grip GripAt(Point p)
        {
            if (mode != Chat) return Grip.None;
            int edge = Ui.Px(6), corner = Ui.Px(16);
            bool nearX = growLeft ? p.X < edge : p.X >= Width - edge;
            bool nearY = ReplyShown && (growUp ? p.Y < edge : p.Y >= Height - edge);
            bool cornerX = growLeft ? p.X < corner : p.X >= Width - corner;
            bool cornerY = ReplyShown && (growUp ? p.Y < corner : p.Y >= Height - corner);
            if (cornerX && cornerY) return Grip.Corner;
            if (nearX) return Grip.Horizontal;
            if (nearY) return Grip.Vertical;
            return Grip.None;
        }

        Cursor CursorFor(Grip grip)
        {
            if (grip == Grip.Horizontal) return Cursors.SizeWE;
            if (grip == Grip.Vertical) return Cursors.SizeNS;
            return growLeft == growUp ? Cursors.SizeNWSE : Cursors.SizeNESW;
        }

        protected override void WndProc(ref Message m)
        {
            // Over the panel's own edges (not a control on it) the cursor says they can be dragged.
            if (m.Msg == WM_SETCURSOR && m.WParam == Handle && (m.LParam.ToInt64() & 0xFFFF) == 1)
            {
                var grip = dragging ? dragGrip : GripAt(PointToClient(Cursor.Position));
                if (grip != Grip.None)
                {
                    Cursor.Current = CursorFor(grip);
                    m.Result = (IntPtr)1;
                    return;
                }
            }
            base.WndProc(ref m);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button != MouseButtons.Left) return;
            var grip = GripAt(e.Location);
            if (grip == Grip.None)
            {
                // The top of the panel, beside the face and name, switches between the usual and the large view.
                if (e.Clicks == 2 && e.Y < iconRect.Bottom + Ui.Px(4)) ToggleExpanded();
                return;
            }
            if (e.Clicks == 2) { ResetSize(); return; }
            dragging = true;
            dragGrip = grip;
            dragStart = Bounds;
            dragFrom = new Size(prefWidth, prefReply);
            Capture = true;
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            if (!dragging) return;
            var cursor = Cursor.Position;
            if (dragGrip != Grip.Vertical)
            {
                int w = growLeft ? dragStart.Right - cursor.X : cursor.X - dragStart.Left;
                prefWidth = Clamp(Ui.Unpx(w), MinPanelWidth, MaxPanelWidth);
            }
            if (dragGrip != Grip.Horizontal)
            {
                int h = growUp ? dragStart.Bottom - cursor.Y : cursor.Y - dragStart.Top;
                prefReply = Clamp(Ui.Unpx(h - chromeH - Ui.Px(10)), MinReplyHeight, MaxReplyHeight);
            }
            expanded = false;
            fitWanted = false;
            Relayout();
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            EndDrag();
        }

        protected override void OnMouseCaptureChanged(EventArgs e)
        {
            base.OnMouseCaptureChanged(e);
            if (dragging && !Capture) EndDrag();
        }

        void EndDrag()
        {
            if (!dragging) return;
            var grip = dragGrip;
            dragging = false;
            Capture = false;
            // What stays is what was shown, which can be less than the pointer asked for.
            ChooseSize(grip != Grip.Vertical, grip != Grip.Horizontal);
            Relayout();
            if (prefWidth != dragFrom.Width || prefReply != dragFrom.Height) CommitSize();
        }

        /// <summary>Puts the panel next to the bot: above it if there is room, otherwise below.</summary>
        Point NearBot(int w, int h)
        {
            int gap = Ui.Px(6);
            bool left = OnLeft();
            bool up = dragging ? growUp : PlaceAbove(h, lastBot.Top - gap - lastWork.Top, lastWork.Bottom - lastBot.Bottom - gap);
            growLeft = left;
            growUp = up;
            int x = left ? lastBot.Right - w : lastBot.X;
            int y = up ? lastBot.Top - h - gap : lastBot.Bottom + gap;
            x = Math.Max(lastWork.Left, Math.Min(x, lastWork.Right - w));
            y = Math.Max(lastWork.Top, Math.Min(y, lastWork.Bottom - h));
            return new Point(x, y);
        }

        /// <summary>Tells the panel where the bot is. The panel sits beside it and sizes itself to the room around it.</summary>
        public void PlaceNear(Rectangle bot, Rectangle work)
        {
            if (dragging) return;
            bool changed = !placed || bot != lastBot || work != lastWork;
            lastBot = bot;
            lastWork = work;
            placed = true;
            if (changed) Relayout();
        }

        Color BorderColor()
        {
            // Claude Code draws its permission questions in their own colour.
            return mode == Consent ? pal.Permission : pal.Accent;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var path = Shapes.Round(new RectangleF(0.5f, 0.5f, Width - 2, Height - 2), Ui.Px(10)))
            using (var pen = new Pen(BorderColor(), 1.6f))
                g.DrawPath(pen, path);
            if (icon != null)
                g.DrawImage(icon, new Rectangle(iconRect.X, iconRect.Y, iconRect.Width, iconRect.Height));

            // The prompt box: a rounded outline in the prompt-border grey with the `>` mark.
            using (var path = Shapes.Round(inputRect, Ui.Px(8)))
            using (var pen = new Pen(pal.Border, 1.2f))
                g.DrawPath(pen, path);
            using (var font = Ui.Mono(10f, FontStyle.Bold))
            using (var brush = new SolidBrush(pal.Muted))
                g.DrawString(">", font, brush, inputRect.X + Ui.Px(9), inputRect.Y + (Ui.Px(38) - font.Height) / 2f);

            if (!responseRect.IsEmpty)
            {
                using (var path = Shapes.Round(responseRect, Ui.Px(8)))
                using (var fill = new SolidBrush(pal.Field))
                    g.FillPath(fill, path);
            }

            // A grip in the corner that can be dragged, on the side away from the bot.
            if (ReplyShown)
            {
                float cx = growLeft ? Ui.Px(7) : Width - Ui.Px(7), cy = growUp ? Ui.Px(7) : Height - Ui.Px(7);
                int sx = growLeft ? 1 : -1, sy = growUp ? 1 : -1;
                using (var pen = new Pen(pal.Border, 1.2f) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                    for (int k = 1; k <= 3; k++)
                    {
                        float step = Ui.Px(3) * k;
                        g.DrawLine(pen, cx + sx * step, cy, cx, cy + sy * step);
                    }
            }
        }
    }
}
