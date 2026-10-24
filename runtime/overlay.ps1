# Launches the floating character. The window code is C# in overlay\*.cs,
# compiled here with the compiler that ships with Windows, so nothing needs
# installing. The compiled assembly is cached by a hash of the sources.
#
# Needs MINI_BOT_URL and MINI_BOT_TOKEN in its environment (the runtime sets
# them). Run with -STA. Exits when the runtime goes away.

$ErrorActionPreference = 'Stop'
$sources = Get-ChildItem -Path (Join-Path $PSScriptRoot 'overlay') -Filter '*.cs' | Sort-Object Name
$references = 'System.Windows.Forms', 'System.Drawing', 'System.Web.Extensions', 'System.Net.Http', 'System.Speech'

$sha = [System.Security.Cryptography.SHA1]::Create()
$bytes = $sources | ForEach-Object { [System.IO.File]::ReadAllBytes($_.FullName) } | ForEach-Object { $_ }
$hash = -join ($sha.ComputeHash([byte[]]$bytes) | ForEach-Object { $_.ToString('x2') })
$cacheDir = Join-Path ($(if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { $env:TEMP })) 'ClaudeMiniBot'
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
$dll = Join-Path $cacheDir "overlay-$($hash.Substring(0, 16)).dll"

try {
  if (-not (Test-Path $dll)) {
    Add-Type -Path ($sources | ForEach-Object { $_.FullName }) -ReferencedAssemblies $references -OutputAssembly $dll
    Get-ChildItem $cacheDir -Filter 'overlay-*.dll' | Where-Object { $_.FullName -ne $dll } | Remove-Item -ErrorAction SilentlyContinue
  }
  Add-Type -Path $dll
  exit ([MiniBot.Program]::Run($env:MINI_BOT_URL, $env:MINI_BOT_TOKEN))
} catch {
  $log = Join-Path $env:TEMP 'minibot-overlay.log'
  "$(Get-Date -Format s) $($_ | Out-String)" | Add-Content -Path $log
  exit 1
}
