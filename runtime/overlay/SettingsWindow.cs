// The customization dialog: pick a bot, see it, rename it, change how it looks,
// and save or cancel. Nothing is applied to the floating bot until Save, so the
// preview here is the only thing that moves while you experiment.
//
// Every change goes through the runtime (and so through the same profile rules
// as /mini-bot). Switching bots only changes what the overlay draws; the
// Claude Code session is not involved.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Windows.Forms;

namespace MiniBot
{
    /// <summary>A text box on a rounded background.</summary>
    public class RoundField : Panel
    {
        public readonly TextBox Box = new TextBox();
        public Palette Colors = Ui.PaletteFor("dark", "claude");

        public RoundField()
        {
            Box.BorderStyle = BorderStyle.None;
            Box.Font = Ui.Font(10f);
            Controls.Add(Box);
            SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            Height = Ui.Px(34);
        }

        public void Apply(Palette p)
        {
            Colors = p;
            BackColor = p.Bg;
            Box.BackColor = p.Field;
            Box.ForeColor = p.Fg;
            Invalidate();
        }

        protected override void OnLayout(LayoutEventArgs e)
        {
            base.OnLayout(e);
            Box.SetBounds(Ui.Px(12), (Height - Box.PreferredHeight) / 2, Math.Max(10, Width - Ui.Px(24)), Box.PreferredHeight);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using (var path = Shapes.Round(new RectangleF(0.5f, 0.5f, Width - 2, Height - 2), Height / 2f))
            using (var b = new SolidBrush(Colors.Field))
                e.Graphics.FillPath(b, path);
        }
    }

    public class SettingsWindow : Form
    {
        readonly Api api;
        readonly Action<Dictionary<string, object>> stateChanged;
        readonly Dictionary<string, string> baseline = new Dictionary<string, string>();
        readonly Dictionary<string, string> draft = new Dictionary<string, string>();
        readonly Dictionary<string, Label> rowLabels = new Dictionary<string, Label>();
        readonly List<Label> labels = new List<Label>();
        readonly PickerButton bots = new PickerButton();
        readonly List<BotItem> botItems = new List<BotItem>();
        ContextMenuStrip botMenu;
        readonly RoundField name = new RoundField();
        readonly Panel preview = new Panel();
        readonly ChoiceStrip avatar = new ChoiceStrip();
        readonly ChoiceStrip skin = new ChoiceStrip();
        readonly ChoiceStrip accent = new ChoiceStrip();
        readonly ChoiceStrip size = new ChoiceStrip();
        readonly ChoiceStrip anim = new ChoiceStrip();
        readonly ChoiceStrip theme = new ChoiceStrip();
        readonly ChoiceStrip position = new ChoiceStrip();
        readonly ChoiceStrip grow = new ChoiceStrip();
        readonly TextButton btnResetPanel = new TextButton("Reset to default size");
        readonly TrackBar opacity = new TrackBar();
        readonly Label opacityValue = new Label();
        readonly Label error = new Label();
        readonly TextButton btnNew = new TextButton("New");
        readonly TextButton btnDelete = new TextButton("Delete");
        readonly TextButton btnSave = new TextButton("Save");
        readonly TextButton btnCancel = new TextButton("Cancel");
        readonly Timer animation = new Timer();
        readonly DateTime opened = DateTime.UtcNow;
        Dictionary<string, object> state = new Dictionary<string, object>();
        string editingId = "";
        bool loading;
        bool customPosition;
        Palette pal = Ui.PaletteFor("dark", "claude");

        public SettingsWindow(Api api, Action<Dictionary<string, object>> stateChanged)
        {
            this.api = api;
            this.stateChanged = stateChanged;
            Text = "Customize bot";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            TopMost = true;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(Ui.Px(392), Ui.Px(640));
            Font = Ui.Font(9f);
            DoubleBuffered = true;

            int m = Ui.Px(18), inner = ClientSize.Width - 2 * m;
            int y = m;

            bots.SetBounds(m, y, inner - Ui.Px(140), Ui.Px(30));
            btnNew.SetBounds(m + inner - Ui.Px(132), y, Ui.Px(62), Ui.Px(30));
            btnDelete.SetBounds(m + inner - Ui.Px(66), y, Ui.Px(66), Ui.Px(30));
            y += Ui.Px(44);

            preview.SetBounds(m, y, Ui.Px(140), Ui.Px(150));
            preview.Paint += PaintPreview;
            int rx = m + Ui.Px(152), rw = inner - Ui.Px(152);
            var nameLabel = MakeLabel("Name", rx, y + Ui.Px(6), rw);
            name.SetBounds(rx, y + Ui.Px(28), rw, Ui.Px(34));
            name.Box.MaxLength = 40;
            var hint = MakeLabel("Shown under the bot and on its panel. Rename any time.", rx, y + Ui.Px(70), rw);
            hint.Height = Ui.Px(60);
            y += Ui.Px(162);

            avatar.Mode = ChoiceStrip.Style.Avatar;
            avatar.Keys = new[] { "clawd", "blob", "robot", "cat", "ghost", "bunny" };
            skin.Mode = ChoiceStrip.Style.Color;
            skin.Keys = new[] { "claude", "sunrise", "ocean", "forest", "berry", "slate" };
            accent.Mode = ChoiceStrip.Style.Color;
            accent.Keys = new[] { "claude", "blue", "green", "pink", "orange", "purple" };
            size.Keys = new[] { "small", "medium", "large" };
            size.Labels = new[] { "Small", "Medium", "Large" };
            anim.Keys = new[] { "none", "subtle", "lively" };
            anim.Labels = new[] { "Off", "Subtle", "Lively" };
            theme.Keys = new[] { "dark", "light" };
            theme.Labels = new[] { "Dark", "Light" };
            position.Keys = new[] { "top-left", "top-right", "bottom-left", "bottom-right" };
            position.Labels = new[] { "↖", "↗", "↙", "↘" };
            grow.Keys = new[] { "scroll", "grow" };
            grow.Labels = new[] { "Scroll", "Grow the panel" };
            grow.AccessibleName = "Long replies choice";
            btnResetPanel.AccessibleName = "Reset the chat panel to its default size";

            avatar.AccessibleName = "Avatar choice"; skin.AccessibleName = "Skin choice"; accent.AccessibleName = "Accent choice"; size.AccessibleName = "Size choice";
            anim.AccessibleName = "Animation choice"; theme.AccessibleName = "Panel theme choice"; position.AccessibleName = "Position choice";
            name.Box.AccessibleName = "Bot name"; opacity.AccessibleName = "Opacity level";
            y = Row("avatar", "Avatar", avatar, y, 48);
            y = Row("skin", "Skin", skin, y, 32);
            y = Row("accent", "Accent", accent, y, 32);
            y = Row("size", "Size", size, y, 34);
            y = Row("anim", "Animation", anim, y, 34);
            y = Row("theme", "Panel theme", theme, y, 34);
            y = Row("position", "Position", position, y, 34);
            y = Row("grow", "Long replies", grow, y, 34);
            labels.Add(MakeLabel("Chat panel", m, y + Ui.Px(6), Ui.Px(96)));
            btnResetPanel.Font = Ui.Font(8.5f, FontStyle.Bold);
            btnResetPanel.SetBounds(m + Ui.Px(100), y, inner - Ui.Px(100), Ui.Px(30));
            y += Ui.Px(40);

            labels.Add(MakeLabel("Opacity", m, y + Ui.Px(8), Ui.Px(96)));
            opacity.Minimum = 20;
            opacity.Maximum = 100;
            opacity.TickStyle = TickStyle.None;
            opacity.AutoSize = false;
            opacity.SetBounds(m + Ui.Px(100), y + Ui.Px(2), inner - Ui.Px(150), Ui.Px(30));
            opacityValue.SetBounds(m + inner - Ui.Px(44), y + Ui.Px(8), Ui.Px(44), Ui.Px(20));
            opacityValue.TextAlign = ContentAlignment.MiddleRight;
            y += Ui.Px(44);

            error.SetBounds(m, y, inner, Ui.Px(36));
            error.Font = Ui.Font(9f);
            y += Ui.Px(40);
            btnSave.Primary = true;
            btnSave.SetBounds(m + inner - Ui.Px(200), y, Ui.Px(96), Ui.Px(34));
            btnCancel.SetBounds(m + inner - Ui.Px(96), y, Ui.Px(96), Ui.Px(34));
            ClientSize = new Size(ClientSize.Width, y + Ui.Px(34) + m);

            Control[] all = { bots, btnNew, btnDelete, preview, name, avatar, skin, accent, size, anim, theme, position,
                              grow, btnResetPanel, opacity, opacityValue, error, btnSave, btnCancel };
            foreach (var c in all) Controls.Add(c);
            AcceptButton = null;
            CancelButton = null;

            bots.Click += delegate { ShowBotMenu(); };
            btnNew.Click += delegate { OnNew(); };
            btnDelete.Click += delegate { OnDelete(); };
            btnSave.Click += delegate { OnSave(); };
            btnCancel.Click += delegate { Close(); };
            name.Box.TextChanged += delegate { Edited("name", name.Box.Text); };
            avatar.Changed += delegate { Edited("avatar", avatar.Selected); };
            skin.Changed += delegate { Edited("skin", skin.Selected); avatar.SkinForAvatars = skin.Selected; avatar.ClearIcons(); };
            accent.Changed += delegate { Edited("accent", accent.Selected); };
            size.Changed += delegate { Edited("size", size.Selected); };
            anim.Changed += delegate { Edited("idle", anim.Selected); };
            theme.Changed += delegate { Edited("theme", theme.Selected); };
            position.Changed += delegate { Edited("anchor", position.Selected); customPosition = false; UpdatePositionLabel(); };
            grow.Changed += delegate { Edited("autoFit", grow.Selected == "grow" ? "1" : "0"); };
            btnResetPanel.Click += delegate
            {
                Edited("panelReset", "1");
                btnResetPanel.Text = "Will reset when saved";
                btnResetPanel.Invalidate();
            };
            opacity.ValueChanged += delegate { Edited("opacity", opacity.Value.ToString()); };
            KeyPreview = true;
            KeyDown += delegate (object s, KeyEventArgs e) { if (e.KeyCode == Keys.Escape) Close(); };

            animation.Interval = 60;
            animation.Tick += delegate { if (Visible) preview.Invalidate(); };
            animation.Start();
            FormClosed += delegate { animation.Stop(); animation.Dispose(); };
            ApplyPalette(pal);
        }

        Label MakeLabel(string text, int x, int y, int w)
        {
            var l = new Label { Text = text, AutoSize = false };
            l.SetBounds(x, y, w, Ui.Px(20));
            l.Font = Ui.Font(8.5f, FontStyle.Bold);
            labels.Add(l);
            Controls.Add(l);
            return l;
        }

        int Row(string key, string text, ChoiceStrip strip, int y, int height)
        {
            int m = Ui.Px(18), inner = ClientSize.Width - 2 * m;
            var l = MakeLabel(text, m, y + (Ui.Px(height) - Ui.Px(18)) / 2, Ui.Px(96));
            rowLabels[key] = l;
            strip.SetBounds(m + Ui.Px(100), y, inner - Ui.Px(100), Ui.Px(height));
            return y + Ui.Px(height) + Ui.Px(10);
        }

        void UpdatePositionLabel()
        {
            rowLabels["position"].Text = customPosition ? "Position (dragged)" : "Position";
        }

        void ApplyPalette(Palette p)
        {
            pal = p;
            BackColor = p.Bg;
            ForeColor = p.Fg;
            foreach (var l in labels) { l.ForeColor = p.Muted; l.BackColor = p.Bg; }
            opacityValue.ForeColor = p.Muted; opacityValue.BackColor = p.Bg;
            error.BackColor = p.Bg; error.ForeColor = p.Danger;
            bots.Colors = p; bots.BackColor = p.Bg; bots.Invalidate();
            preview.BackColor = p.Field;
            opacity.BackColor = p.Bg;
            name.Apply(p);
            foreach (var s in new[] { avatar, skin, accent, size, anim, theme, position, grow }) { s.Colors = p; s.Invalidate(); }
            foreach (var b in new[] { btnNew, btnDelete, btnSave, btnCancel, btnResetPanel }) { b.Colors = p; b.BackColor = p.Bg; b.Invalidate(); }
            Invalidate();
        }

        // ---- the draft ----

        static Dictionary<string, string> Flatten(Dictionary<string, object> profile)
        {
            var a = Json.Obj(profile, "appearance");
            var n = Json.Obj(profile, "animation");
            var pos = Json.Obj(profile, "position");
            var panel = Json.Obj(profile, "panel");
            return new Dictionary<string, string>
            {
                { "name", Json.Str(profile, "name", "Mini") },
                { "avatar", Json.Str(profile, "avatar", "clawd") },
                { "skin", Json.Str(a, "skin", "claude") },
                { "accent", Json.Str(a, "accent", "claude") },
                { "size", Json.Str(a, "size", "medium") },
                { "theme", Json.Str(a, "theme", "dark") },
                { "opacity", Json.Int(a, "opacity", 100).ToString() },
                { "idle", Json.Str(n, "idle", "subtle") },
                { "speed", Json.Str(n, "speed", "normal") },
                { "reduced", Json.Bool(n, "reducedMotion") ? "1" : "0" },
                { "anchor", Json.Str(pos, "anchor", "bottom-right") },
                { "autoFit", Json.Bool(panel, "autoFit") ? "1" : "0" },
                { "panelReset", "0" }
            };
        }

        Dictionary<string, object> ProfileById(string id)
        {
            foreach (var p in Json.Arr(Json.Obj(state, "config"), "profiles"))
            {
                var d = p as Dictionary<string, object>;
                if (d != null && Json.Str(d, "id") == id) return d;
            }
            return null;
        }

        bool IsDirty()
        {
            return draft.Any(kv => baseline.ContainsKey(kv.Key) && baseline[kv.Key] != kv.Value);
        }

        void Edited(string key, string value)
        {
            if (loading) return;
            draft[key] = value;
            error.Text = "";
            if (key == "opacity") opacityValue.Text = value + "%";
            if (key == "theme" || key == "accent") ApplyPalette(Ui.PaletteFor(draft["theme"], draft["accent"]));
            UpdateTitle();
            preview.Invalidate();
        }

        void UpdateTitle()
        {
            Text = "Customize " + draft["name"] + (IsDirty() ? " *" : "");
        }

        /// <summary>Shows the runtime's current bots. Unsaved edits are kept unless `force`.</summary>
        public void LoadState(Dictionary<string, object> st, bool force)
        {
            state = st;
            var cfg = Json.Obj(st, "config");
            var profiles = Json.Arr(cfg, "profiles").OfType<Dictionary<string, object>>().ToList();
            if (profiles.Count == 0) return;
            string activeId = Json.Str(cfg, "activeProfileId");
            bool stillThere = profiles.Any(p => Json.Str(p, "id") == editingId);
            if (!force && editingId != "" && stillThere && IsDirty()) { RefreshBotList(profiles, activeId); return; }
            editingId = stillThere && !force ? editingId : activeId;
            var current = ProfileById(editingId) ?? profiles[0];
            loading = true;
            baseline.Clear();
            draft.Clear();
            foreach (var kv in Flatten(current)) { baseline[kv.Key] = kv.Value; draft[kv.Key] = kv.Value; }
            name.Box.Text = draft["name"];
            avatar.SkinForAvatars = draft["skin"]; avatar.ClearIcons();
            avatar.Selected = draft["avatar"];
            skin.Selected = draft["skin"];
            accent.Selected = draft["accent"];
            size.Selected = draft["size"];
            anim.Selected = draft["idle"];
            theme.Selected = draft["theme"];
            customPosition = Json.Str(Json.Obj(current, "position"), "anchor") == "custom";
            position.Selected = customPosition ? "" : draft["anchor"];
            UpdatePositionLabel();
            grow.Selected = draft["autoFit"] == "1" ? "grow" : "scroll";
            btnResetPanel.Text = "Reset to default size";
            btnResetPanel.Invalidate();
            opacity.Value = Math.Max(20, Math.Min(100, int.Parse(draft["opacity"])));
            loading = false;
            opacityValue.Text = draft["opacity"] + "%";
            ApplyPalette(Ui.PaletteFor(draft["theme"], draft["accent"]));
            RefreshBotList(profiles, activeId);
            error.Text = "";
            UpdateTitle();
            preview.Invalidate();
        }

        void RefreshBotList(List<Dictionary<string, object>> profiles, string activeId)
        {
            loading = true;
            botItems.Clear();
            foreach (var p in profiles)
                botItems.Add(new BotItem { Id = Json.Str(p, "id"), Text = Json.Str(p, "name") + (Json.Str(p, "id") == activeId ? "  (active)" : "") });
            var editing = botItems.FirstOrDefault(i => i.Id == editingId);
            bots.Text = editing != null ? editing.Text : "";
            btnDelete.Enabled = profiles.Count > 1;
            loading = false;
        }

        class BotItem
        {
            public string Id;
            public string Text;
            public override string ToString() { return Text; }
        }

        // ---- actions ----

        bool Run(Dictionary<string, object> op)
        {
            try
            {
                var st = api.Apply(op);
                state = st;
                stateChanged(st);
                return true;
            }
            catch (ApiException e)
            {
                error.Text = e.Message;
                return false;
            }
        }

        bool ConfirmDiscard()
        {
            if (!IsDirty()) return true;
            return MessageBox.Show(this, "You have unsaved changes to " + baseline["name"] + ". Discard them?", "Unsaved changes",
                MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
        }

        void ShowBotMenu()
        {
            if (botMenu != null) botMenu.Dispose();
            botMenu = new ContextMenuStrip();
            botMenu.Renderer = new ThemedMenuRenderer(pal);
            foreach (var item in botItems)
            {
                string id = item.Id;
                var entry = new ToolStripMenuItem(item.Text) { Checked = id == editingId };
                entry.Click += delegate { OnBotChosen(id); };
                botMenu.Items.Add(entry);
            }
            botMenu.Show(bots, new Point(0, bots.Height));
        }

        void OnBotChosen(string chosenId)
        {
            if (chosenId == null || chosenId == editingId) return;
            if (!ConfirmDiscard()) { LoadState(state, false); return; }
            if (Run(new Dictionary<string, object> { { "op", "select" }, { "id", chosenId } })) LoadState(state, true);
            else LoadState(state, false);
        }

        void OnNew()
        {
            if (!ConfirmDiscard()) return;
            var proposed = NamePrompt.Ask(this, pal, "New bot", "What should the new bot be called?", "");
            if (proposed == null) return;
            if (Run(new Dictionary<string, object> { { "op", "create" }, { "name", proposed } })) LoadState(state, true);
        }

        void OnDelete()
        {
            var sure = MessageBox.Show(this,
                "Delete " + baseline["name"] + "? This cannot be undone. Your Claude Code session is not affected.",
                "Delete bot", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
            if (sure != DialogResult.Yes) return;
            if (Run(new Dictionary<string, object> { { "op", "delete" }, { "id", editingId } })) LoadState(state, true);
        }

        void OnSave()
        {
            if (draft["name"].Trim().Length == 0) { error.Text = "A bot needs a name."; return; }
            var patch = new Dictionary<string, object>();
            var appearance = new Dictionary<string, object>();
            var animationPatch = new Dictionary<string, object>();
            if (draft["name"] != baseline["name"]) patch["name"] = draft["name"].Trim();
            if (draft["avatar"] != baseline["avatar"]) patch["avatar"] = draft["avatar"];
            if (draft["skin"] != baseline["skin"]) appearance["skin"] = draft["skin"];
            if (draft["accent"] != baseline["accent"]) appearance["accent"] = draft["accent"];
            if (draft["size"] != baseline["size"]) appearance["size"] = draft["size"];
            if (draft["theme"] != baseline["theme"]) appearance["theme"] = draft["theme"];
            if (draft["opacity"] != baseline["opacity"]) appearance["opacity"] = int.Parse(draft["opacity"]);
            if (draft["idle"] != baseline["idle"]) animationPatch["idle"] = draft["idle"];
            if (appearance.Count > 0) patch["appearance"] = appearance;
            if (animationPatch.Count > 0) patch["animation"] = animationPatch;
            if (draft["anchor"] != baseline["anchor"] && !customPosition)
                patch["position"] = new Dictionary<string, object> { { "anchor", draft["anchor"] } };
            var panelPatch = new Dictionary<string, object>();
            if (draft["autoFit"] != baseline["autoFit"]) panelPatch["autoFit"] = draft["autoFit"] == "1";
            if (draft["panelReset"] == "1") { panelPatch["width"] = 380; panelPatch["replyHeight"] = 150; }
            if (panelPatch.Count > 0) patch["panel"] = panelPatch;
            if (patch.Count == 0) { Close(); return; }
            if (Run(new Dictionary<string, object> { { "op", "update" }, { "id", editingId }, { "patch", patch } })) Close();
        }

        void PaintPreview(object sender, PaintEventArgs e)
        {
            var look = new Look
            {
                Avatar = draft.ContainsKey("avatar") ? draft["avatar"] : "clawd",
                Skin = draft.ContainsKey("skin") ? draft["skin"] : "claude",
                Accent = draft.ContainsKey("accent") ? draft["accent"] : "claude",
                Name = draft.ContainsKey("name") && draft["name"].Trim().Length > 0 ? draft["name"].Trim() : "Mini",
                Idle = draft.ContainsKey("idle") ? draft["idle"] : "subtle",
                Speed = draft.ContainsKey("speed") ? draft["speed"] : "normal",
                Reduced = draft.ContainsKey("reduced") && draft["reduced"] == "1",
                Size = "small"
            };
            e.Graphics.Clear(preview.BackColor);
            double t = (DateTime.UtcNow - opened).TotalSeconds;
            using (var bmp = Painter.RenderWindow(look, "idle", false, t, true))
            {
                int w = Math.Min(preview.Width, bmp.Width), h = Math.Min(preview.Height, bmp.Height);
                float scale = Math.Min(preview.Width / (float)bmp.Width, preview.Height / (float)bmp.Height) * 0.95f;
                float dw = bmp.Width * scale, dh = bmp.Height * scale;
                e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                e.Graphics.DrawImage(bmp, (preview.Width - dw) / 2f, (preview.Height - dh) / 2f, dw, dh);
            }
        }

    }

    /// <summary>A small modal question with one line of text to answer.</summary>
    public static class NamePrompt
    {
        public static string Ask(IWin32Window owner, Palette pal, string title, string message, string initial)
        {
            using (var f = new Form())
            {
                f.Text = title;
                f.FormBorderStyle = FormBorderStyle.FixedDialog;
                f.MaximizeBox = false;
                f.MinimizeBox = false;
                f.ShowInTaskbar = false;
                f.TopMost = true;
                f.StartPosition = FormStartPosition.CenterParent;
                f.ClientSize = new Size(Ui.Px(340), Ui.Px(148));
                f.BackColor = pal.Bg;
                f.ForeColor = pal.Fg;
                f.Font = Ui.Font(9f);
                var label = new Label { Text = message, AutoSize = false, ForeColor = pal.Fg, BackColor = pal.Bg };
                label.SetBounds(Ui.Px(16), Ui.Px(14), Ui.Px(308), Ui.Px(22));
                var field = new RoundField();
                field.SetBounds(Ui.Px(16), Ui.Px(44), Ui.Px(308), Ui.Px(34));
                field.Apply(pal);
                field.Box.Text = initial;
                field.Box.MaxLength = 40;
                var ok = new TextButton("Create") { Primary = true, Colors = pal, BackColor = pal.Bg };
                var cancel = new TextButton("Cancel") { Colors = pal, BackColor = pal.Bg };
                ok.SetBounds(Ui.Px(16) + Ui.Px(308) - Ui.Px(200), Ui.Px(96), Ui.Px(96), Ui.Px(34));
                cancel.SetBounds(Ui.Px(16) + Ui.Px(308) - Ui.Px(96), Ui.Px(96), Ui.Px(96), Ui.Px(34));
                string result = null;
                ok.Click += delegate { result = field.Box.Text.Trim(); f.Close(); };
                cancel.Click += delegate { f.Close(); };
                field.Box.KeyDown += delegate (object s, KeyEventArgs e)
                {
                    if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; result = field.Box.Text.Trim(); f.Close(); }
                    else if (e.KeyCode == Keys.Escape) { e.SuppressKeyPress = true; f.Close(); }
                };
                f.Controls.AddRange(new Control[] { label, field, ok, cancel });
                f.Shown += delegate { field.Box.Focus(); };
                f.ShowDialog(owner);
                return string.IsNullOrEmpty(result) ? null : result;
            }
        }
    }
}
