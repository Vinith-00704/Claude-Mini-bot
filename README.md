# Claude Mini Bot

A small floating character for Claude Code on Windows. **Claude Code stays the intelligence; Mini Bot is the character you talk through.** It is not a second assistant: what you type or say into it is submitted to your Claude Code session as an ordinary prompt, under Claude Code's own permissions.

The default bot is **Clawd**, Claude Code's own mascot, drawn as the flat pixel art it is in the terminal, and the panel, colours and motion follow Claude Code's own theme. You name the bot yourself ("Mini" is only the default), keep several bots, and change how each one looks.

- Click it, type a prompt, press Enter. Or hold Space and talk.
- Snip any part of the screen and ask Claude about it.
- Hide it, move it, restyle it, keep several bots. Claude Code is never interrupted.
- Nothing is listened to or captured until you say yes, and a red indicator is always shown while it is.

## Install

You install it once and it is part of Claude Code from then on. There is no `--plugin-dir` to remember.

**Requirements**

- Windows 10 (version 2004 or later) or Windows 11.
- [Claude Code](https://claude.com/claude-code) with plugin support.
- [Node.js](https://nodejs.org) on your `PATH` (or set `MINI_BOT_NODE` to the full path of `node.exe`).

**Install command**

Type this at the prompt of a Claude Code session:

```
/plugin install mini-bot --marketplace Vinith-00704/Claude-Mini-bot
```

Or run it from any terminal:

```
claude plugin install mini-bot --marketplace Vinith-00704/Claude-Mini-bot
```

What you will see, in order:

1. `Add marketplace?` naming `github:Vinith-00704/Claude-Mini-bot`. Answer **y**.
2. The plugin's details and a choice of scope. Choose **user**, so it loads in every project and every session.
3. `Installed mini-bot. Plugin is now active.` It is active in that session straight away; sessions you start later load it by themselves.

**Start it**

```
/mini-bot start
```

The bot appears on your screen. After that you do not have to start it again: by default it comes back with each new Claude Code session if it was running when you last used it (change this in `/mini-bot settings`, "Startup": `manual`, `restore` or `always`).

**First run:** the bot asks what you would like to call it. You can skip, and rename it any time.

**Update**

`/mini-bot update` tells you whether a newer version is out (one plain request to this repository's `plugin.json` on GitHub, nothing sent from your computer) and prints the commands below. A plugin cannot replace itself while it is running, so you run them yourself:

```
claude plugin marketplace update claude-mini-bot
claude plugin update mini-bot
```

The first line fetches the latest listing from GitHub, the second installs the new version. Then start a new Claude Code session (or run `/reload-plugins`). If the bot was running, `/mini-bot stop` then `/mini-bot start` makes it use the new version.

**Uninstall**

```
/mini-bot stop
claude plugin uninstall mini-bot
```

Your bots and settings stay in `%APPDATA%\ClaudeMiniBot`, and the optional speech files in `%LOCALAPPDATA%\ClaudeMiniBot`. Delete those folders to remove everything.

**Private repository?** Only people who can read it on GitHub can install, and their computer needs a git credential for github.com (an SSH key, or `gh auth login` then `gh auth setup-git`). The install never prompts for one.

**Troubleshooting**

| Problem | What to do |
| --- | --- |
| `/mini-bot` is not found | Run `claude plugin list`; it should show `mini-bot`. Then `/reload-plugins`. |
| `/mini-bot start` says it could not start | Check that `node --version` works in a terminal, or set `MINI_BOT_NODE`. |
| The bot does not appear the first time | The overlay is compiled on first launch; give it a few seconds. |
| `/mini-bot update` says it is up to date but a change is missing | Updates are found by the `version` in `.claude-plugin/plugin.json`, not by commits: a push that leaves the version as it was is never offered. Raise the version, push, then update (below). |
| Typing `/` shows no list | The running companion is from before the list: `/mini-bot stop`, then `/mini-bot start` (`/mini-bot status` says so). |
| Prompts from the bot are refused | The bot only sends while a Claude Code session is connected. Run `/mini-bot status`; after an update run `/mini-bot stop` then `/mini-bot start`. |
| The microphone does nothing | Windows must allow desktop apps to use it: Settings > Privacy & security > Microphone. |
| Voice is inaccurate | Set up offline Whisper: `/mini-bot speech install` (see below). |

## Quick start

| Do this | To |
| --- | --- |
| `/mini-bot start` | show the bot |
| **Click** the bot, type, **Enter** | send a prompt to Claude Code |
| **Hold Space** in the prompt | talk instead of typing |
| The **snip** button | screenshot part of the screen and ask about it |
| **Drop files** on the bot | have Claude look at them (see below) |
| **Right-click** the bot | hide, customize, change bot, permissions, stop |
| `/mini-bot help` | every command |

## Claude Code's look and motion

Taken from the app itself, not imitated:

- **Colours:** Claude Code's dark and light palettes (`claude` rgb(215,119,87) and its shimmer, `inactive`, `subtle`, `promptBorder`, `success`, `error`, `warning`, `permission`, the message backgrounds). The bot's body is its `clawd_body`. The panel is black with a rounded accent border, set in a monospace font, with a `>` prompt and `●` before replies; the microphone question takes the permission colour.
- **Spinner:** the glyphs `· ✢ * ✶ ✻ ✽` played forward then back, shown beside a verb from Claude Code's own list ("Pondering…", "Clauding…") with the lighter shimmer sweeping across it and the seconds elapsed.
- **Clawd's poses:** the same parts Claude Code poses it with: eyes open, left, right, closed and wink; arms down, up and one up; feet both, left and right. It looks around while thinking, walks and types while working, hops with its arms up when done, and shuts its eyes on a problem. When idle it blinks and glances about (a wave and a hop at "lively").
- **Marks:** the spinner glyph above the head while it works, a green check when done, a red mark on error. The microphone is always a red disc, so recording is never ambiguous.

## Using the floating bot

| Do this | To |
| --- | --- |
| **Click** the bot | open or close its small panel |
| **Drag** the bot | move it (its position is saved with that bot; it stays on screen) |
| **Right-click** the bot | Hide, Customize, Change bot, Permissions, Stop |
| Type in the panel, **Enter** or the send button | send a prompt to Claude Code (**Shift+Enter** adds a line; the prompt grows up to six lines, then scrolls) |
| **Drag** the panel's far edges or corner (the ones away from the bot) | resize the panel; the reply area takes the extra room. It is saved with that bot. **Double-click** an edge to reset |
| The **arrows** button in the panel, or double-click its top | switch between the usual size and a large view (up to 60% of the screen's height) |
| **Ctrl+Alt+arrows** in the panel | resize it from the keyboard (right and up grow it, left and down shrink it) |
| Type a **/command** in the panel (`/cost`, `/compact`, `/mini-bot hide`) | run it as if typed in Claude Code; what it prints comes back to the panel (see below) |
| The **microphone** button, or **holding Space** in the empty prompt | speak a prompt (see below) |
| The **sliders** button in the panel | customize this bot |
| The **snip** button in the panel, or right-click > Take screenshot | snip part of the screen and ask Claude about it (below) |
| **Drop** files or folders on the bot or its panel, or **Ctrl+V** files copied in Explorer | attach them to the next prompt as chips (below) |
| The tray icon | show or hide the bot, open the prompt, take a screenshot, customize, stop |

The panel always sits beside the bot and never covers it or leaves the screen: if there is not room for the size you chose, the reply area is shortened (your chosen size is kept). Only the reply area changes height, so dragging an edge before there is a reply changes the width only. In Customize, **Long replies > Grow the panel** lets a long reply make the panel taller by itself (up to 60% of the screen's height, and never smaller than the size you chose), and **Chat panel > Reset to default size** puts it back. From Claude Code: `/mini-bot set panel-size 520x300` (width x reply height, in pixels), `set panel-size reset`, `set grow-replies on`.

The panel shows what Claude Code is really doing: *Sending, Thinking, Working (and which tool), Done, Something went wrong*. The face and a small badge on the bot show the same. The reply text is shown only for prompts you sent from the bot; turns you start in Claude Code only show a state.

### Slash commands

Type `/` in the panel and a list of every command opens under the prompt, as in Claude Code: Claude Code's own commands, your skills, your plugins' commands, and the `/mini-bot` ones. Keep typing to narrow it (`/co` finds `/compact`, `/cost`, `/context`; `/rv` finds `/review`; it also looks in the descriptions). **Up** and **Down** move, **Tab** completes the name, **Enter** runs the highlighted command (or, for one that needs more typed after it such as `/mini-bot set`, completes it and waits), **Esc** closes the list (a second **Esc** closes the panel), and a click on a row completes it. The list follows your session: a plugin installed or a skill added shows up within a few seconds.

Typing `/name args` in the panel runs that command in your Claude Code session, as if you had typed it there: Claude Code's own commands, your skills and plugins' commands, and `/mini-bot ...`. The output comes back as the reply. A command that opens a panel or dialog (or prints nothing) opens it in Claude Code, and the bot says so. A command that sends a prompt to Claude shows its answer in Claude Code, not in the bot.

- Only **typed** text runs a command. Speech and prompts with attachments never do.
- `/permissions`, `/allowed-tools`, `/model`, `/effort`, `/config`, `/hooks`, `/login`, `/logout`, `/exit` and `/quit` are refused, because the bot never changes Claude Code's permissions, model or session. Run those in Claude Code.
- A prompt that starts with `/` but is not a command (a path, say) is not sent, because Claude Code would read it as a command too. Start it with a word.
- Commands that open menus (`/mini-bot settings`, `/mini-bot` alone) still open their menu in Claude Code. The typed forms (`/mini-bot set opacity 70`, `/mini-bot hide`) work fully from the bot.

### Voice

**Hold Space to talk.** Like Claude Code's voice mode. Press Space in the prompt and it types its one space as usual; keep holding, and when the key starts repeating (the second, continuous press) the space is taken back out, the bot starts listening and the prompt line turns into a small audio meter ("● Listening" with bars that follow your voice, and "Release Space to finish." underneath). Let go and it stops. While you hold, it keeps listening through pauses; what you said is added after whatever you had typed, and the text waits in the prompt for you to check, edit and send. A tap on an empty prompt types nothing, a tap with text types one space, and Space never types more than one. It only reacts while the bot's own prompt has focus; the bot does not watch your keyboard anywhere else. The first time it asks the same microphone question as the button does.

**The microphone button.** Clicking it for the first time asks whether the bot may listen. It listens for one sentence (it stops after a pause, after 15 s, or when you click again) and puts the text in the box for you to read and edit. It is never sent by itself: you press Enter (or the send button) when the words are right. A red bar at the top of the screen and a red badge on the bot show whenever the microphone is in use, even if the bot is hidden; clicking the bar stops it, and it closes as soon as you stop talking, before the words are worked out.

**Accurate speech recognition (offline Whisper).** Windows' built-in recognizer is old and mishears a lot, especially with accents, so the bot can use Whisper instead, running on your computer: the audio is recorded while you talk and turned into text when you stop (about two seconds for a sentence), and nothing is sent anywhere. Set it up once with `/mini-bot speech install`: it asks first, then downloads whisper.cpp (9 MB, from github.com/ggml-org) and the English "base" model (141 MB, from huggingface.co/ggerganov) into `%LOCALAPPDATA%\ClaudeMiniBot\speech`, and checks both against checksums fixed in `runtime/speech/install.ps1` (a file that does not match is deleted). `/mini-bot speech install small` adds a bigger model (465 MB) that is slower but better with accents, and is then used automatically. `/mini-bot speech` says which recognizer is in use. Without Whisper the bot falls back to Windows' recognizer and says so after each use.

### Screenshots

A snipping tool in Claude Code's style. The screen is captured first, frozen and dimmed; the bot, its panel and the access indicator are left out of the picture (Windows' "exclude from capture"), so they never cover what you snip.

- **Drag** to select an area, **click** to take a whole window (it is outlined as you hover), or press **Enter** for the screen under the pointer.
- Then **Ask Claude** (Enter), **Copy** (Ctrl+C), **Save** (Ctrl+S) or **Cancel** (Esc, or right-click).
- **Ask Claude** attaches the screenshot to the panel's next prompt (it shows as a chip you can remove). Type a question, or send it as it is. Claude Code receives the question and the screenshot's file path, and opens the image with its Read tool, under its own permissions. A plugin's prompt cannot carry an image itself, which is why it goes as a file.
- `/mini-bot screenshot` starts the same snip from Claude Code.

The first screenshot asks for screen access (in Claude Code's permission colour); nothing is captured without it, and it can be turned off from right-click > Permissions. Screenshots for Claude are kept in `%APPDATA%\ClaudeMiniBot\screenshots` and removed after a week. Besides screenshots saved there, only the paths of files and folders you drop on the bot (full local paths that exist) can be attached to a prompt; the runtime refuses anything else.

### The model and effort label

Under the panel's header a thin line shows what your Claude Code session is running on: `● Opus 5.5  ▮▮▮▯▯ high` (the model, and its effort as five bars from low to max). It follows each request, so it is what Claude is using right now, after any silent downgrade for the model. When the model changes (`/model`, or a fallback) the line says so for a few seconds in the accent colour: `Opus 5.5 → Sonnet 5.5`.

- It is only ever shown: the bot cannot change the model or the effort. The Claude Code side reports it over the same local, authenticated channel as everything else.
- The effort is known from the first request on, so right after a start (or a model change) only the model shows. A model with no effort setting shows no bars.
- `/mini-bot set model-label full|model|off` chooses how much to show: both, the model alone, or nothing. `/mini-bot status` prints the same information.
- Subagents' own models are not shown.

### Dropping files on the bot

Drag files or folders from Explorer onto the bot (or onto its open panel) and it eats them: its mouth opens as soon as the drag is over it, the file flies in, it chews twice and swallows. A shrug means the kind of file is one Claude may not open directly. A shake of the head means nothing could be taken. Ctrl+V in the prompt does the same with files copied in Explorer. Nothing about the bot's look changes the rest of the time: the mouth only exists while it is eating, and with **reduced motion** on the animation is skipped (the files are still attached).

- Each file or folder becomes a **chip** above the prompt, with a small x to take it off. Nothing is sent until you press Enter, so you can add a question first. Up to 10 at a time; a folder counts as one.
- A plugin's prompt can only carry text, so the bot passes the **path**, not the contents. Claude Code opens it with its own tools, under its own permissions (it asks you first for files outside your project, as usual). The bot never reads, copies or moves a dropped file.
- Claude can read text and code, images, PDFs and notebooks directly. Types it cannot open directly (archives, programs, Office files, audio and video, and so on) get a small **!** on the chip and are sent with a note telling Claude to use a command or a script if it needs what is inside. You can send them anyway.
- Only paths on this computer are accepted: no network shares, no relative paths. The first-run name question comes first; drops are refused until it is answered or skipped.

### Customizing

Per bot: name, avatar (Clawd, blob, robot, cat, ghost, bunny), skin (Claude's orange by default), accent colour (Claude's by default), panel theme (dark or light), size, opacity, animation intensity, position, and optional personality notes (used only for the character's own presentation, never added to Claude's prompt). Changes are previewed live in the dialog and applied on **Save**; **Cancel** discards them. You can create, switch, rename and delete bots there; deleting asks first. Switching bots never touches your Claude Code session.

## `/mini-bot`

| | |
| --- | --- |
| `/mini-bot` | menu: Hide / Unhide, Settings, Permissions, Change Bot, Start / Stop (four options at a time) |
| `/mini-bot hide` · `show` · `toggle` | hide or restore the character; Claude Code stays connected |
| `/mini-bot start` · `stop` | start or stop only the companion (overlay and runtime); Claude Code itself is never stopped |
| `/mini-bot status` | what is running, the active bot, what access is in use, which model and effort the session runs on, whether the bot is connected to this session |
| `/mini-bot settings [list]` · `set <field> <value>` | change settings by menu or by typing, e.g. `set opacity 70`, `set skin ocean`, `set accent pink` |
| `/mini-bot permissions [grant\|revoke <screen\|microphone\|computer\|all>]` | see, grant or revoke access |
| `/mini-bot switch [name]` · `create [name]` | change to another bot, or make one |
| `/mini-bot bot list \| use \| new \| rename \| customize \| delete` | the full set of bot commands |
| `/mini-bot screenshot` | snip part of the screen |
| `/mini-bot speech [install [small]]` | which speech recognizer is in use; set up offline Whisper |
| `/mini-bot update` | which version is installed, whether GitHub has a newer one, and the commands to install it |
| `/mini-bot help` | the list |

## Security model

- A dropped file is only a path in the prompt: the bot never reads its contents, and Claude Code opens it under its own permissions.
- Prompts reach Claude Code only through `$.prompt.submit`, so they run under your normal permission rules and appear in the transcript. The bot never reads or changes Claude Code's permission rules, and it is not a second assistant.
- Access to the microphone (and screen, and computer control) is the companion's own and separate from Claude Code's permissions. Granting needs your explicit answer (a dialog in Claude Code, or the Allow button in the bot's panel); the runtime also refuses a grant that does not say it was confirmed. Grants last only while the runtime runs, so a restarted companion starts with nothing granted. Stopping the companion ends every capture.
- The access indicator is computed from live access state alone, so hiding the bot cannot hide it.
- The local interface listens on `127.0.0.1` only, on a random port, and every request needs a secret token kept in your user folder. Requests that carry an `Origin` header (a web page) or an unexpected `Host` are refused.
- The bot refuses to take prompts while nothing in Claude Code is picking them up.
- Nothing runs in the background without you: no hidden AI behaviour, no silent microphone or screen capture.

## How it fits together

```
 you ── click / type / speak ──▶ floating bot (overlay, C#)
                                       │  authenticated, local only
                                       ▼
                               companion runtime (Node)  ◀── /mini-bot (this mod)
                                       ▲                          │
                 prompts waiting ──────┘                          ▼
                 activity, settings                  your Claude Code session
```

- **The mod** (`hooks/`) registers `/mini-bot`, picks up prompts from the bot about once a second and submits them with `$.prompt.submit`, and reports turn starts, tool runs and turn ends so the bot can show them.
- **The runtime** (`runtime/`, Node, no packages) owns the settings while it runs, the prompt queue, the activity state, and the permissions. It writes `{ pid, port, token }` to `%APPDATA%\ClaudeMiniBot\runtime.json` (`MINI_BOT_HOME` overrides the folder).
- **The overlay** (`runtime/overlay/*.cs`) is compiled on first launch with the compiler that ships with Windows (cached afterwards in `%LOCALAPPDATA%\ClaudeMiniBot`). It is only a client of the runtime and decides nothing.
- **`shared/config.mjs`** holds the settings model and every rule for changing a bot. The mod and the runtime both import it, so the floating dialog and `/mini-bot` can never disagree.

```
hooks/register.ts            wiring only
hooks/lib/bridge.ts          prompts in, activity out
hooks/lib/lifecycle.ts       start, stop, reconnect, keeping the two copies of the settings together
hooks/lib/{config,profiles,fields,visibility,permissions,status,speech}.ts
hooks/lib/*-menu.ts, menu.ts, commands.ts    the interactive menus and typed commands
runtime/lib/                 auth, permissions, visibility, activity, prompts, the server
runtime/overlay/             Api, Painter, BotWindow, PanelWindow, SettingsWindow, Dictation, Recorder, App ...
runtime/speech/install.ps1   one-time offline Whisper setup
shared/config.mjs            settings model and profile rules (+ config.d.mts)
tests/                       claude plugin test <folder>      runtime/test: node --test "test/*.test.mjs"
```

## Development

Run it straight from a clone, without installing:

```
git clone https://github.com/Vinith-00704/Claude-Mini-bot.git
claude --plugin-dir ./Claude-Mini-bot
```

Check and test:

```
claude plugin validate .
claude plugin test .
node --test "runtime/test/*.test.mjs"
```

## Limits

- Windows only. The overlay is a Windows program.
- Without Whisper, voice recognition is only as good as the built-in Windows recognizer (it can be rough). Whisper only writes the words after you stop talking, so there is no live text while you speak, and it needs a microphone Windows lets desktop apps use. English only for now.
- Computer control has a permission switch but nothing in this package uses it yet.
- Leaving the bot out of screenshots needs Windows 10 version 2004 or later; on older Windows it is hidden for a moment instead.
- Voice-reply speech, sound effects and notification settings are stored and sent to the runtime; nothing consumes them yet.
- A companion started before an update must be restarted (`/mini-bot stop`, then `/mini-bot start`) to pick up the new version.

## License

[MIT](LICENSE). The optional offline speech setup downloads [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (MIT) and OpenAI's Whisper models (MIT) separately; they are not part of this repository.
