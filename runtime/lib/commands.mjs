// The slash commands Claude Code can run, for the floating bot's `/` picker.
//
// The Claude Code side sends the list (it is the only one that knows it: built-ins, plugins, skills,
// MCP prompts) and the overlay reads it to show and search. The runtime only holds the latest list.
// A name here is something the person may type after a slash; nothing in this list is ever run by
// the runtime itself.

const MAX_ITEMS = 600
const MAX_NAME = 80
const MAX_DESCRIPTION = 120
const SOURCES = ['builtin', 'plugin', 'user', 'mcp', 'bot']

const fail = (status, error) => Object.assign(new Error(error), { status })

export class Commands {
  #items = []
  #revision = 0

  /** Replaces the list. Entries that are not well formed are dropped, not repaired. */
  set(items) {
    if (!Array.isArray(items)) throw fail(400, 'commands must be a list')
    const seen = new Set()
    const clean = []
    for (const item of items.slice(0, MAX_ITEMS)) {
      const name = typeof item?.name === 'string' ? item.name.trim() : ''
      if (name === '' || name.length > MAX_NAME || !/^[\w:.-]+(?: [\w:.-]+)*$/.test(name) || seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      clean.push({
        name,
        description: typeof item.description === 'string' ? item.description.replace(/\s+/g, ' ').trim().slice(0, MAX_DESCRIPTION) : '',
        source: SOURCES.includes(item.source) ? item.source : 'plugin',
        // True for a command that needs something typed after it, so Enter completes it instead of running it bare.
        takesArgs: item.takesArgs === true,
      })
    }
    if (JSON.stringify(clean) !== JSON.stringify(this.#items)) {
      this.#items = clean
      this.#revision += 1
    }
    return this.summary()
  }

  /** What the state carries: enough for the overlay to know whether to fetch the list again. */
  summary() {
    return { revision: this.#revision, count: this.#items.length }
  }

  snapshot() {
    return { ...this.summary(), items: this.#items }
  }
}
