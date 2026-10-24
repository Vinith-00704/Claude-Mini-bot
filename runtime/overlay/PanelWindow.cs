// The compact panel that opens next to the bot when it is clicked, drawn as a small
// piece of Claude Code's terminal: black, a rounded border in the accent colour,
// a monospace font, a `>` prompt, `●` before the reply, and the live status line
// with Claude Code's spinner. It also shows the two short questions that belong to
// the bot itself: the microphone consent (in Claude Code's permission colour) and
// the first-run "what should I be called?".
//
// It is a front-end only. Typing here queues a prompt for Claude Code; nothing
// in this window talks to a model.

using System;
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
        public event Action AttachmentRemoved;
        public event Action SettingsRequested;
        public event Action CloseRequested;
        public event Action ConsentAllowed;
        public event Action ConsentDeclined;
        public event Action<string> OnboardingContinued;   // the chosen name, or "" for none
        public event Action OnboardingSkipped;
        public event Action InputEdited;                   // the person typed (cancels a pending voice send)

        public const string Chat = "chat", Consent = "consent", Onboarding = "onboarding";

        Palette pal = Ui.PaletteFor("dark", "claude");
        readonly Label title = new Label();
        readonly StatusLine status = new StatusLine();
        readonly Label notice = new Label();
        readonly RichTextBox response = new RichTextBox();
        readonly TextBox input = new TextBox();
        readonly IconButton btnSettings = new IconButton("sliders");
        readonly IconButton btnClose = new IconButton("close");
        readonly IconButton btnMic = new IconButton("mic");
        readonly IconButton btnShot = new IconButton("camera");
        readonly Label chip = new Label();
        readonly IconButton btnUnattach = new IconButton("close");
        readonly IconButton btnSend = new IconButton("send");
        readonly TextButton btnAllow = new TextButton("Allow");
        readonly TextButton btnNotNow = new TextButton("Not now");
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
        string attachment = "";
        Rectangle chipRect;
        string promptShown = "";
        string replyShown = "";
        bool replyIsError;
        Bitmap icon;
        string iconKey = "";
        Rectangle inputRect;
        Rectangle responseRect;
        Rectangle iconRect;

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
            Native.SetPlaceholder(input, "Type, or hold Space to talk");

            tips.SetToolTip(btnSettings, "Customize this bot");
            tips.SetToolTip(btnClose, "Close");
            tips.SetToolTip(btnMic, "Speak a prompt");
            tips.SetToolTip(btnShot, "Take a screenshot");
            tips.SetToolTip(btnUnattach, "Remove the screenshot");
            chip.Font = Ui.Mono(9f);
            chip.AutoSize = false;
            chip.TextAlign = ContentAlignment.MiddleLeft;
            chip.AccessibleName = "Attached screenshot";
            tips.SetToolTip(btnSend, "Send");
            btnSend.Primary = true;

            Control[] all = { meter, title, status, notice, response, input, btnSettings, btnClose, btnMic, btnShot, btnSend, chip, btnUnattach, btnAllow, btnNotNow, btnContinue, btnSkip };
            foreach (var c in all) Controls.Add(c);
            btnAllow.Primary = true;
            btnContinue.Primary = true;

            btnClose.Click += delegate { Raise(CloseRequested); };
            btnSettings.Click += delegate { Raise(SettingsRequested); };
            btnMic.Click += delegate { Raise(MicRequested); };
            btnShot.Click += delegate { Raise(ScreenshotRequested); };
            btnUnattach.Click += delegate { Raise(AttachmentRemoved); };
            btnSend.Click += delegate { SendNow(); };
            btnAllow.Click += delegate { Raise(ConsentAllowed); };
            btnNotNow.Click += delegate { Raise(ConsentDeclined); };
            btnContinue.Click += delegate { FinishOnboarding(); };
            btnSkip.Click += delegate { Raise(OnboardingSkipped); };
            input.TextChanged += delegate { if (!settingText && InputEdited != null) InputEdited(); UpdateSendEnabled(); };
            input.KeyDown += OnInputKey;
            input.KeyUp += OnInputKeyUp;
            input.LostFocus += delegate { if (!(ActiveForm is NoActivateForm)) EndHold(); };

            ApplyPalette(pal);
            Relayout();
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

        void OnInputKey(object sender, KeyEventArgs e)
        {
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
            if (e.KeyCode == Keys.Enter && !e.Shift)
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
            if ((text.Length > 0 || attachment.Length > 0) && SendRequested != null) SendRequested(text);
        }

        void FinishOnboarding()
        {
            if (OnboardingContinued != null) OnboardingContinued(input.Text.Trim());
        }

        void UpdateSendEnabled() { btnSend.Enabled = input.Text.Trim().Length > 0 || attachment.Length > 0; }

        /// <summary>The screenshot that goes with the next prompt, as a short label; "" for none.</summary>
        public void SetAttachment(string label)
        {
            label = label ?? "";
            if (label == attachment) return;
            attachment = label;
            chip.Text = label.Length > 0 ? "\u25A3 " + label : "";
            Native.SetPlaceholder(input, label.Length > 0 ? "Ask about this screenshot..." : "Type, or hold Space to talk");
            UpdateSendEnabled();
            Relayout();
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
            input.BackColor = p.Bg; input.ForeColor = p.Fg;
            foreach (var b in new[] { btnSettings, btnClose, btnMic, btnShot, btnSend }) { b.Colors = p; b.BackColor = p.Bg; b.Invalidate(); }
            btnUnattach.Colors = p; btnUnattach.BackColor = p.UserMessage; btnUnattach.Invalidate();
            chip.BackColor = p.UserMessage; chip.ForeColor = p.Fg;
            foreach (var b in new[] { btnAllow, btnNotNow, btnContinue, btnSkip }) { b.Colors = p; b.BackColor = p.Bg; b.Invalidate(); }
            RenderConversation();
            Invalidate();
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
            if (has != hasResponse) { hasResponse = has; Relayout(); }
        }

        void RenderConversation()
        {
            response.Clear();
            if (replyShown.Length == 0) return;
            response.SelectionFont = Ui.Mono(9.5f);
            if (promptShown.Length > 0)
            {
                response.SelectionColor = pal.Muted;
                response.AppendText("> " + promptShown + "\n\n");
            }
            response.SelectionStart = response.TextLength;
            response.SelectionColor = replyIsError ? pal.Danger : pal.Fg;
            response.AppendText("● " + replyShown.Replace("\r\n", "\n"));
            response.SelectionStart = 0;
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
            notice.Text = "";
            Relayout();
        }

        public void StartOnboarding(string botName)
        {
            mode = Onboarding;
            noticeIsError = false;
            notice.Text = "Welcome! I'm your Claude Mini Bot. I float on your screen and give you a quick way to talk to Claude Code. What would you like to call me? You can skip this and rename me any time.";
            notice.ForeColor = pal.Fg;
            SetInput(botName == "Mini" ? "" : botName);
            Native.SetPlaceholder(input, "A name for your bot (optional)");
            Relayout();
        }

        public void EndOnboarding()
        {
            if (mode != Onboarding) return;
            mode = Chat;
            notice.Text = "";
            SetInput("");
            Native.SetPlaceholder(input, "Type, or hold Space to talk");
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

        public void Relayout()
        {
            int w = Ui.Px(380), m = Ui.Px(14), gap = Ui.Px(10);
            int inner = w - 2 * m;
            int y = m;
            int bs = Ui.Px(30);

            int face = Ui.Px(34);
            iconRect = new Rectangle(m, y, face, face);
            int textX = m + face + Ui.Px(10);
            title.SetBounds(textX, y, inner - face - Ui.Px(10) - 2 * bs, Ui.Px(20));
            status.SetBounds(textX, y + Ui.Px(18), inner - face - Ui.Px(10) - 2 * bs, Ui.Px(20));
            btnClose.SetBounds(w - m - bs, y, bs, bs);
            btnSettings.SetBounds(w - m - 2 * bs - Ui.Px(2), y, bs, bs);
            y += face + gap;

            bool chat = mode == Chat, consent = mode == Consent, onboarding = mode == Onboarding;
            btnSettings.Visible = btnClose.Visible = !onboarding;
            status.Visible = !onboarding;

            bool showResponse = chat && hasResponse;
            response.Visible = showResponse;
            if (showResponse)
            {
                responseRect = new Rectangle(m, y, inner, Ui.Px(150));
                response.SetBounds(m + Ui.Px(10), y + Ui.Px(8), inner - Ui.Px(20), Ui.Px(134));
                y += responseRect.Height + gap;
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

            btnAllow.Visible = btnNotNow.Visible = consent;
            if (consent)
            {
                btnAllow.SetBounds(m, y, Ui.Px(150), Ui.Px(30));
                btnNotNow.SetBounds(m + Ui.Px(158), y, Ui.Px(100), Ui.Px(30));
                y += Ui.Px(30) + gap;
            }

            bool showChip = chat && attachment.Length > 0;
            chip.Visible = btnUnattach.Visible = showChip;
            if (showChip)
            {
                int ch = Ui.Px(26);
                chipRect = new Rectangle(m, y, Math.Min(inner, TextRenderer.MeasureText(chip.Text, chip.Font).Width + Ui.Px(44)), ch);
                chip.SetBounds(chipRect.X + Ui.Px(8), chipRect.Y + 1, chipRect.Width - Ui.Px(36), ch - 2);
                btnUnattach.SetBounds(chipRect.Right - Ui.Px(26), chipRect.Y + 1, Ui.Px(24), ch - 2);
                y += ch + Ui.Px(6);
            }
            else chipRect = Rectangle.Empty;

            btnMic.Visible = btnShot.Visible = btnSend.Visible = !onboarding;
            int fieldH = Ui.Px(38);
            int right = onboarding ? inner : inner - 3 * bs - Ui.Px(4);
            inputRect = new Rectangle(m, y, right, fieldH);
            int promptW = Ui.Px(20);
            input.SetBounds(m + promptW + Ui.Px(6), y + (fieldH - input.PreferredHeight) / 2, right - promptW - Ui.Px(20), input.PreferredHeight);
            if (!onboarding)
            {
                btnShot.SetBounds(m + right + Ui.Px(4), y + (fieldH - bs) / 2, bs, bs);
                btnMic.SetBounds(m + right + Ui.Px(4) + bs, y + (fieldH - bs) / 2, bs, bs);
                btnSend.SetBounds(m + right + Ui.Px(4) + 2 * bs, y + (fieldH - bs) / 2, bs, bs);
            }
            // While listening the prompt line is the meter (as in Claude Code); the box stays under it for the key events.
            meter.Visible = chat && listening;
            meter.SetBounds(inputRect.X, inputRect.Y, inputRect.Width, inputRect.Height);
            y += fieldH + gap;

            btnContinue.Visible = btnSkip.Visible = onboarding;
            if (onboarding)
            {
                btnContinue.SetBounds(m, y, Ui.Px(120), Ui.Px(30));
                btnSkip.SetBounds(m + Ui.Px(128), y, Ui.Px(120), Ui.Px(30));
                y += Ui.Px(30) + gap;
            }

            ClientSize = new Size(w, y + m - gap);
            using (var path = Shapes.Round(new RectangleF(0, 0, Width, Height), Ui.Px(10)))
                Region = new Region(path);
            Invalidate(true);
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
                g.DrawString(">", font, brush, inputRect.X + Ui.Px(9), inputRect.Y + (inputRect.Height - font.Height) / 2f);

            if (!chipRect.IsEmpty)
            {
                using (var path = Shapes.Round(chipRect, Ui.Px(6)))
                using (var fill = new SolidBrush(pal.UserMessage))
                    g.FillPath(fill, path);
            }
            if (!responseRect.IsEmpty)
            {
                using (var path = Shapes.Round(responseRect, Ui.Px(8)))
                using (var fill = new SolidBrush(pal.Field))
                    g.FillPath(fill, path);
            }
        }

        /// <summary>Puts the panel next to the bot: above it if there is room, otherwise below.</summary>
        public void PlaceNear(Rectangle bot, Rectangle work)
        {
            int gap = Ui.Px(6);
            int x = bot.X + bot.Width / 2 > work.X + work.Width / 2 ? bot.Right - Width : bot.X;
            int y = bot.Top - Height - gap;
            if (y < work.Top) y = bot.Bottom + gap;
            x = Math.Max(work.Left, Math.Min(x, work.Right - Width));
            y = Math.Max(work.Top, Math.Min(y, work.Bottom - Height));
            if (Location.X != x || Location.Y != y) Location = new Point(x, y);
        }
    }
}
