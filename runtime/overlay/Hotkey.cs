// The keyboard shortcut that hides and shows the bot from any program (Ctrl+Alt+M unless changed).
// It is a Windows hot key: the shortcut is read only while it is pressed, nothing else about the keyboard is
// seen, and it does one thing, which is to raise Pressed. Pressing it never reaches Claude Code.

using System;
using System.Windows.Forms;

namespace MiniBot
{
    class Hotkey : NativeWindow, IDisposable
    {
        const int WM_HOTKEY = 0x0312;
        const uint MOD_ALT = 1, MOD_CONTROL = 2, MOD_SHIFT = 4, MOD_WIN = 8, MOD_NOREPEAT = 0x4000;
        static readonly IntPtr MessageOnly = new IntPtr(-3);

        public event Action Pressed;
        readonly int hotkeyId;
        bool registered;

        public Hotkey() : this(0x4D42) { }

        /// <summary>A shortcut with its own id, so one program can hold several.</summary>
        public Hotkey(int id)
        {
            hotkeyId = id;
            // A window that is never shown: it exists to receive the hot key message.
            CreateHandle(new CreateParams { Parent = MessageOnly });
        }

        /// <summary>Registers the shortcut, replacing the previous one. "off" or empty only releases it. False when Windows refuses (another program has it).</summary>
        public bool Set(string combo)
        {
            Release();
            combo = (combo ?? "").Trim();
            if (combo.Length == 0 || combo.Equals("off", StringComparison.OrdinalIgnoreCase)) return true;
            uint modifiers;
            uint key;
            if (!Parse(combo, out modifiers, out key)) return false;
            registered = Native.RegisterHotKey(Handle, hotkeyId, modifiers | MOD_NOREPEAT, key);
            return registered;
        }

        /// <summary>The modifiers and virtual key of a shortcut in the form the configuration keeps it: "Ctrl+Alt+M", "Win+F9".</summary>
        public static bool Parse(string combo, out uint modifiers, out uint key)
        {
            modifiers = 0; key = 0;
            var parts = combo.Split('+');
            string name = parts[parts.Length - 1].Trim().ToUpperInvariant();
            for (int i = 0; i < parts.Length - 1; i++)
            {
                switch (parts[i].Trim().ToLowerInvariant())
                {
                    case "ctrl": modifiers |= MOD_CONTROL; break;
                    case "alt": modifiers |= MOD_ALT; break;
                    case "shift": modifiers |= MOD_SHIFT; break;
                    case "win": modifiers |= MOD_WIN; break;
                    default: return false;
                }
            }
            if ((modifiers & (MOD_CONTROL | MOD_ALT | MOD_WIN)) == 0) return false;
            if (name.Length == 1 && ((name[0] >= 'A' && name[0] <= 'Z') || (name[0] >= '0' && name[0] <= '9'))) { key = name[0]; return true; }
            int n;
            if (name.Length >= 2 && name[0] == 'F' && int.TryParse(name.Substring(1), out n) && n >= 1 && n <= 12) { key = (uint)(0x70 + n - 1); return true; }
            if (name == "ESC") { key = 0x1B; return true; }
            if (name == "PAUSE") { key = 0x13; return true; }
            return false;
        }

        void Release()
        {
            if (!registered) return;
            Native.UnregisterHotKey(Handle, hotkeyId);
            registered = false;
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == hotkeyId && Pressed != null) Pressed();
            base.WndProc(ref m);
        }

        public void Dispose()
        {
            Release();
            if (Handle != IntPtr.Zero) DestroyHandle();
        }
    }
}
