// `/mini-bot speech`: offline speech recognition (Whisper) for the microphone.
//
// The bot works without it, with Windows' own recognizer, which is far less accurate.
// Setting it up is a one-time download of a small program and a model, checked against
// fixed checksums (runtime/speech/install.ps1). Nothing is downloaded without a yes.

import { confirm } from './prompts'
import type { Engine } from './types'

const HINTS = 'Ask for more accuracy with a bigger model: /mini-bot speech install small (465 MB).'

async function runInstaller($: Engine, extra: string[], timeoutMs: number) {
  const script = `${$.plugin.root}/runtime/speech/install.ps1`
  return $.process.run(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...extra], { timeoutMs })
}

function lastLines(text: string | undefined, count: number): string {
  return (text ?? '').trim().split(/\r?\n/).slice(-count).join('\n')
}

export async function speechCommand($: Engine, args: string[]): Promise<string> {
  const [verb, size] = args
  if (verb === undefined || verb === 'status') {
    try {
      const checked = await runInstaller($, ['-Check'], 20_000)
      if (checked.exitCode === 0) return `Offline speech recognition (Whisper) is set up.\n${lastLines(checked.stdout, 1)}\n${HINTS}`
    } catch {
      return 'Could not check speech recognition: PowerShell did not run.'
    }
    return 'The microphone is using Windows\' basic recognizer, which is not very accurate.\nFor much better results, set up offline Whisper: /mini-bot speech install (about 150 MB, one time; the audio never leaves this computer).'
  }
  if (verb !== 'install') return 'Use: /mini-bot speech [status | install [small]]'
  if (size !== undefined && size !== 'small' && size !== 'base') return 'Use: /mini-bot speech install [base | small]'
  const model = size === 'small' ? 'small' : 'base'
  const megabytes = model === 'small' ? '465 MB' : '141 MB'
  const sure = await confirm(
    $,
    `Download offline speech recognition? This fetches whisper.cpp (9 MB, from github.com/ggml-org) and the English "${model}" model (${megabytes}, from huggingface.co/ggerganov), checks both against fixed checksums, and keeps them in %LOCALAPPDATA%\\ClaudeMiniBot\\speech. After that the microphone is recognized on this computer and nothing is sent anywhere.`,
    'Download',
    'Not now',
    'Speech setup',
  )
  if (sure === undefined) return 'Setting up speech needs someone at the prompt to say yes, so nothing was downloaded.'
  if (!sure) return 'Nothing was downloaded.'
  try {
    const done = await runInstaller($, ['-Model', model], 600_000)
    if (done.exitCode !== 0) return `Speech setup did not finish:\n${lastLines(done.stderr || done.stdout, 4)}`
    return `Offline speech recognition is ready. It is used from the next time you use the microphone; no restart is needed.\n${lastLines(done.stdout, 1)}`
  } catch {
    return 'Speech setup did not finish: it took too long or PowerShell could not run it. Try again, or run runtime/speech/install.ps1 yourself.'
  }
}
