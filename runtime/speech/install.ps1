# One-time setup of offline speech recognition for Mini Bot (Whisper, run by whisper.cpp).
#
# Downloads two files into %LOCALAPPDATA%\ClaudeMiniBot\speech and checks each against a SHA-256 that is
# pinned here; a file that does not match is deleted and nothing is installed:
#   - whisper-bin-x64.zip (whisper.cpp release b5454, about 9 MB) from github.com/ggml-org/whisper.cpp
#   - ggml-base.en.bin (the English "base" model, about 141 MB) from huggingface.co/ggerganov/whisper.cpp
#     or, with -Model small, ggml-small.en.bin (about 465 MB): slower to answer, noticeably better with accents
# Nothing is sent anywhere: both are plain downloads, and recognition afterwards runs on this computer.
#
# Usage: powershell -File install.ps1                  (install or repair)
#        powershell -File install.ps1 -Model small     (also get the bigger, more accurate model)
#        powershell -File install.ps1 -Check           (only say whether it is installed)

param([switch]$Check, [ValidateSet('base', 'small')][string]$Model = 'base')

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $env:TEMP }
$dir = Join-Path $base 'ClaudeMiniBot\speech'
$exe = Join-Path $dir 'whisper-cli.exe'
$modelFile = Join-Path $dir "ggml-$Model.en.bin"

$engine = @{
  Url    = 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip'
  Sha256 = '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb'
}
$models = @{
  base  = @{ Url = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin'; Sha256 = 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002' }
  small = @{ Url = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin'; Sha256 = 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d' }
}
$weights = $models[$Model]

function Test-Installed { (Test-Path $exe) -and (Test-Path $modelFile) }

if ($Check) {
  $have = @('base', 'small' | Where-Object { Test-Path (Join-Path $dir "ggml-$_.en.bin") })
  if ((Test-Path $exe) -and $have.Count -gt 0) { "installed: $dir (model: $($have -join ', '))"; exit 0 } else { "not installed"; exit 1 }
}

function Get-Verified($spec, $target) {
  Write-Host "Downloading $($spec.Url)"
  Invoke-WebRequest -Uri $spec.Url -OutFile $target -UseBasicParsing
  $actual = (Get-FileHash -Algorithm SHA256 -Path $target).Hash.ToLowerInvariant()
  if ($actual -ne $spec.Sha256) {
    Remove-Item $target -Force -ErrorAction SilentlyContinue
    throw "The download does not match the expected checksum ($actual), so it was deleted. Nothing was installed."
  }
}

New-Item -ItemType Directory -Force -Path $dir | Out-Null
$work = Join-Path $dir 'download'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Force -Path $work | Out-Null
try {
  if (-not (Test-Path $exe)) {
    $zip = Join-Path $work 'engine.zip'
    Get-Verified $engine $zip
    $unpacked = Join-Path $work 'engine'
    Expand-Archive -Path $zip -DestinationPath $unpacked -Force
    $found = Get-ChildItem -Path $unpacked -Recurse -Filter 'whisper-cli.exe' | Select-Object -First 1
    if (-not $found) { throw 'The engine archive does not contain whisper-cli.exe.' }
    # Only the command-line program and the libraries beside it; the archive carries many other tools.
    Get-ChildItem -Path $found.DirectoryName -File | Where-Object { $_.Extension -eq '.dll' -or $_.Name -eq 'whisper-cli.exe' } | ForEach-Object {
      Copy-Item $_.FullName -Destination $dir -Force
    }
  }
  if (-not (Test-Path $modelFile)) {
    $part = Join-Path $work 'model.bin'
    Get-Verified $weights $part
    Move-Item $part $modelFile -Force
  }
} finally {
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Installed)) { throw 'Setup did not finish.' }
Write-Host "Offline speech recognition is installed in $dir"
