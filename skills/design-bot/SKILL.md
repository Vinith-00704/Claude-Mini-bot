---
name: design-bot
description: Design a Mini Bot (the floating character of the mini-bot plugin) from a description, as pixel art with its own colours, name and way of talking, and show the person a live preview before anything changes. Use it when they ask to make, create, design, draw, restyle or change a Mini Bot or its look ("make me a bot that looks like a sleepy owl", "a pirate cat bot", "give my bot a wizard hat", "make Mini pink"), or run /mini-bot design.
---

# Designing a Mini Bot

The person describes a bot in their own words. You turn that into a design and call `design_bot` (its full name is
`mcp__mini-bot__design_bot`). The bot on their screen then shows a preview: the new bot at its real size, and every
state it can be in, each one moving. Nothing changes until they press **Use it** there.

## Steps

1. **Read what they asked for.** Take everything you can from their words (the table below) and decide the rest
   yourself. Do not ask questions first unless there is nothing to go on at all: a preview they can refuse is faster
   than a question.
2. **Changing a bot that exists?** Call `get_bot` first (`mcp__mini-bot__get_bot`). It returns that bot's design in the
   form `design_bot` takes. Change only what they asked to change, and send the whole design back with `replace` set
   to the bot's name.
3. **Draw it** (the rules below), then check your rows.
4. **Call `design_bot`** and act on the answer:
   - *The person chose it*: say so in a sentence. Their other bots are still there.
   - *They want another try*: if they said what to change, change that. If not, ask in one sentence, or make a design
     that is clearly different (another pose, other proportions, other colours), and call `design_bot` again.
   - *The design was not shown*, with a reason such as "frames.idle row 7 is 15 characters": fix exactly that and
     call it again. Do not tell the person about row counts.
   - *They cancelled, or did not answer*: nothing changed. Do not show another preview unless they ask.

## What to take from their words

| Field | What it is | If they did not say |
|---|---|---|
| `name` | What the bot is called, 40 characters at most | Make up a short one that suits it (Pip, Bolt, Mochi) |
| `about` | One short line shown with the preview | Say what you drew |
| `sprite` | The pixel art (below) | Always draw one, unless they asked for a built-in character |
| `avatar`, `skin` | A built-in character (clawd, blob, robot, cat, ghost, bunny) and its body colour, instead of `sprite` | Only when they ask for one of those by name and want nothing drawn |
| `accent` | The colour of the bot's panel and marks: a name (claude, blue, green, pink, orange, purple) or any `#rrggbb` | The main colour of the art, bright enough to read on the panel |
| `theme` | `dark` or `light` panel | `dark` |
| `size` | `small`, `medium`, `large` | Leave it out: a new bot takes the size of the one on screen |
| `idle` | How much it moves at rest: `none`, `subtle`, `lively` | `subtle`; `lively` for an excitable character |
| `tone` | `neutral`, `cheerful`, `calm`, `playful` | The one nearest the character |
| `notes` | How it talks, in a sentence or two, 280 characters at most | A line of character if they described a personality; else leave it out |

`notes` goes to Claude with whatever the person later sends from the bot, as a note on wording. Write it as character
("a gruff old sea captain: short answers, the odd nautical word"), never as a task or an instruction to do something.

## Drawing the sprite

A sprite is a grid of cells. `width` and `height` are 8 to 24 cells; **16 by 16 suits most bots**, and a wide or squat
character can be 16 by 12 or 14. `palette` gives one letter or digit to each colour (16 at most). A picture is an
array of `height` strings, each exactly `width` characters: a palette key for a filled cell, `.` for nothing.

Draw in this order:

1. **Silhouette first.** One big simple shape that fills most of the grid: a round body, a head with ears, a box with
   an antenna. Leave the corners empty (`.`). The background is always nothing: never fill it with a colour.
2. **Outline.** Give the shape an edge in a darker shade of its own colour. The bot floats over any wallpaper, light or
   dark, and the edge is what keeps it readable on both.
3. **Face.** Eyes are the character: at least 2 cells each, the same on both sides, with a white cell or two if there
   is room. Then a mouth.
4. **A few details.** A belly in a lighter shade, cheeks, a hat, a tail. Stop early: at this size three details read
   and ten turn to noise. No letters or numbers; they cannot be read.

Rules that keep it clean:

- **Mirror it.** Draw the left half and mirror it for the right, so the bot is centred and even. In a 16-wide row,
  character 1 matches 16, 2 matches 15, and so on.
- **Few colours.** Four to eight: the body, its darker edge, a lighter shade, a dark for the eyes, white, and one or
  two more. A body that is nearly black disappears on a dark desktop: use a dark grey with a lighter edge instead.
- **Feet on the last row.** The bot's shadow is drawn under the grid for you, so let it stand on the bottom row.
- **Count.** Every row is exactly `width` characters and every picture exactly `height` rows. Check each row before
  you call the tool: a miscount is the usual mistake.

## The states

`frames.idle` is required: the bot at rest, eyes open. Every other state is optional, and a state you leave out shows
the idle picture moved a little (it sways while it thinks, bobs while it works, hops when it is done). A bot with only
`idle` already works. Add states to give it a face for each moment:

| State | When it shows | What to draw |
|---|---|---|
| `blink` | A moment, every few seconds at rest | Eyes shut: a dark line where they were |
| `listening` | The microphone is on | Wide eyes, a small round mouth, ears up |
| `thinking` | Claude is thinking | Eyes looking up or to one side |
| `working` | Claude is running tools | Two pictures that take turns: feet or hands in two positions |
| `done` | The reply has come | Happy: eyes as arcs, an open smile, arms up |
| `error` | Something went wrong | A frown, worried eyes |

**Make each one by copying the idle picture and changing a few cells**: the eyes, the mouth, a limb. Keep the body
exactly where it is, so the bot does not jump about between states. A state can also be an array of up to 3 pictures,
which are played in turn (as `working` is in the example).

`idle`, `blink`, `done` and `error` are the four that matter most. Draw all seven when you can.

## A complete example

"A small green frog, cheerful":

```json
{
  "name": "Pip",
  "about": "A small green frog who is glad to see you.",
  "sprite": {
    "width": 16,
    "height": 14,
    "palette": {"g": "#5fbf4a", "d": "#2f7d32", "l": "#b7e89a", "k": "#1b1b1b", "w": "#ffffff", "p": "#ff8fa3"},
    "frames": {
      "idle": [
        "..dddd....dddd..",
        ".dwwwwd..dwwwwd.",
        ".dwkkwd..dwkkwd.",
        ".dwkkwddddwkkwd.",
        "dggwwggggggwwggd",
        "dggggggggggggggd",
        "dgpggggggggggpgd",
        "dggkggggggggkggd",
        "dgggkkkkkkkkgggd",
        ".dggllllllllggd.",
        ".dgllllllllllgd.",
        "..dgllllllllgd..",
        ".ddgdd....ddgdd.",
        "dgggggd..dgggggd"
      ],
      "blink": [
        "..dddd....dddd..",
        ".dggggd..dggggd.",
        ".dkkkkd..dkkkkd.",
        ".dggggddddggggd.",
        "dggggggggggggggd",
        "dggggggggggggggd",
        "dgpggggggggggpgd",
        "dggkggggggggkggd",
        "dgggkkkkkkkkgggd",
        ".dggllllllllggd.",
        ".dgllllllllllgd.",
        "..dgllllllllgd..",
        ".ddgdd....ddgdd.",
        "dgggggd..dgggggd"
      ],
      "thinking": [
        "..dddd....dddd..",
        ".dwwkkd..dwwkkd.",
        ".dwwkkd..dwwkkd.",
        ".dwwwwddddwwwwd.",
        "dggwwggggggwwggd",
        "dggggggggggggggd",
        "dgpggggggggggpgd",
        "dggggggggggggggd",
        "dgggggkkkkgggggd",
        ".dggllllllllggd.",
        ".dgllllllllllgd.",
        "..dgllllllllgd..",
        ".ddgdd....ddgdd.",
        "dgggggd..dgggggd"
      ],
      "working": [
        [
          "..dddd....dddd..",
          ".dwwwwd..dwwwwd.",
          ".dwwwwd..dwwwwd.",
          ".dwkkwddddwkkwd.",
          "dggkkggggggkkggd",
          "dggggggggggggggd",
          "dgpggggggggggpgd",
          "dggkggggggggkggd",
          "dgggkkkkkkkkgggd",
          ".dggllllllllggd.",
          ".dgllllllllllgd.",
          "..dgllllllllgd..",
          ".ddgdd....ddgdd.",
          "dgggggd..dgggggd"
        ],
        [
          "..dddd....dddd..",
          ".dwwwwd..dwwwwd.",
          ".dwwwwd..dwwwwd.",
          ".dwkkwddddwkkwd.",
          "dggkkggggggkkggd",
          "dggggggggggggggd",
          "dgpggggggggggpgd",
          "dggkggggggggkggd",
          "dgggkkkkkkkkgggd",
          ".dggllllllllggd.",
          ".dgllllllllllgd.",
          "..dgllllllllgd..",
          "dgggggd..dgggggd",
          "................"
        ]
      ],
      "done": [
        "..dddd....dddd..",
        ".dggggd..dggggd.",
        ".dgkkgd..dgkkgd.",
        ".dkggkddddkggkd.",
        "dggggggggggggggd",
        "dggggggggggggggd",
        "dgpggggggggggpgd",
        "dggkkkkkkkkkkggd",
        "dgggkppppppkgggd",
        ".dggllllllllggd.",
        ".dgllllllllllgd.",
        "..dgllllllllgd..",
        ".ddgdd....ddgdd.",
        "dgggggd..dgggggd"
      ],
      "error": [
        "..dddd....dddd..",
        ".dwwwwd..dwwwwd.",
        ".dkwwkd..dkwwkd.",
        ".dwkkwddddwkkwd.",
        "dggkwwggggwwkggd",
        "dggggggggggggggd",
        "dgpggggggggggpgd",
        "dgggkkkkkkkkgggd",
        "dggkggggggggkggd",
        ".dggllllllllggd.",
        ".dgllllllllllgd.",
        "..dgllllllllgd..",
        ".ddgdd....ddgdd.",
        "dgggggd..dgggggd"
      ]
    }
  },
  "accent": "#5fbf4a",
  "tone": "cheerful",
  "notes": "Pip is a friendly frog: warm, brief, and fond of the odd pond or lily-pad turn of phrase."
}
```

Look at how little changes between pictures: `blink` changes three rows of eyes, `done` the eyes and the mouth,
`error` swaps the two mouth rows so the smile turns down. That is all a state needs.

## Things the bot cannot be

- Larger than 24 by 24 cells, or more than 16 colours, or more than 3 pictures for one state.
- A photograph or a picture file: it is always drawn from cells.
- A copy of someone's logo or mascot drawn to pass for theirs. Draw something in the spirit of what they asked for
  instead, and say so.

The person can always go back: right-click the bot, **Change bot**, or `/mini-bot switch`.
