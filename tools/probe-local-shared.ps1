param([Parameter(Mandatory=$true)][string]$Url)
$ErrorActionPreference = 'Stop'
if ($Url -notmatch '^https://[a-z0-9-]+\.trycloudflare\.com$') { exit 2 }
try {
  $taskProbe = Invoke-WebRequest -UseBasicParsing -Uri ($Url + '/api/ai/status') -Headers @{ Origin='https://syzhaoln-stack.github.io' } -TimeoutSec 12
  $taskBody = $taskProbe.Content | ConvertFrom-Json
  $taskReady = ([int]$taskProbe.StatusCode -eq 200 -and $taskBody.ready -eq $true -and $taskBody.mode -eq 'shared')
  [pscustomobject]@{ ready=$taskReady } | ConvertTo-Json -Compress
} catch { '{"ready":false}' }
