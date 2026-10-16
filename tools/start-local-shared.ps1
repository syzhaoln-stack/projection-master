param(
  [string]$KeyFile = 'D:\claude_work\20260721现代机械制图\deepseek-api.txt',
  [switch]$Stop
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskLauncher = Join-Path $PSScriptRoot 'start-local-shared.mjs'
if ($Stop) {
  & node $taskLauncher --stop
  exit $LASTEXITCODE
}
$taskLocal = Join-Path $taskRoot '.wrangler\local-shared'
New-Item -ItemType Directory -Path $taskLocal -Force | Out-Null
$taskStatusPath = Join-Path $taskLocal 'status.json'
if (Test-Path -LiteralPath $taskStatusPath) {
  $taskState = Get-Content -LiteralPath $taskStatusPath -Raw | ConvertFrom-Json
  if ($taskState.status -in @('starting', 'running') -and (Get-Process -Id $taskState.pid -ErrorAction SilentlyContinue)) {
    Write-Output ('本机共享 AI 已在运行或启动中。进程：' + $taskState.pid)
    exit 0
  }
}
$taskNode = (Get-Command node).Source
$taskArguments = @('"' + $taskLauncher + '"', '--key-file', '"' + $KeyFile + '"')
$taskProcess = Start-Process -FilePath $taskNode -ArgumentList $taskArguments -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskLocal 'launcher.log') -RedirectStandardError (Join-Path $taskLocal 'launcher-error.log')
Write-Output ('本机共享 AI 正在后台启动。进程：' + $taskProcess.Id)
Write-Output ('就绪后查看：' + (Join-Path $taskLocal 'status.json'))
