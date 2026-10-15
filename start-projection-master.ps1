param(
    [switch]$NoOpen,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$webRoot = Join-Path $projectRoot 'dist\client'
$entryPath = Join-Path $webRoot 'index.html'
$previewPort = 5186
$pageUrl = "http://127.0.0.1:$previewPort/index.html"
$serverProcess = $null

function Test-PreviewPort {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $attempt = $client.ConnectAsync('127.0.0.1', $previewPort)
        return ($attempt.Wait(500) -and $client.Connected)
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Test-ExpectedPreview {
    $hasher = $null
    try {
        $response = Invoke-WebRequest -Uri $pageUrl -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -ne 200) { return $false }
        # Compare bytes so Windows PowerShell's text-encoding defaults cannot
        # mistake a UTF-8 Chinese page for a different build.
        $hasher = [System.Security.Cryptography.SHA256]::Create()
        $response.RawContentStream.Position = 0
        $servedHash = [Convert]::ToBase64String($hasher.ComputeHash($response.RawContentStream))
        $expectedHash = [Convert]::ToBase64String($hasher.ComputeHash([System.IO.File]::ReadAllBytes($entryPath)))
        return ($servedHash -ceq $expectedHash)
    } catch {
        return $false
    } finally {
        if ($hasher) { $hasher.Dispose() }
    }
}

try {
    if (-not (Test-Path -LiteralPath $entryPath -PathType Leaf)) {
        if ($CheckOnly) { throw 'dist/client/index.html is missing. Run npm run build first.' }
        $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (-not $npmCommand) { throw 'Node.js/npm is required to build the preview. Install dependencies with npm ci, then retry.' }
        Write-Host 'Building the local preview...'
        Push-Location -LiteralPath $projectRoot
        try {
            & $npmCommand.Source run build
            if ($LASTEXITCODE -ne 0) { throw 'The build failed. Check the output above; run npm ci if dependencies are missing.' }
        } finally {
            Pop-Location
        }
        if (-not (Test-Path -LiteralPath $entryPath -PathType Leaf)) {
            throw 'The build did not produce dist/client/index.html.'
        }
    }

    if (Test-PreviewPort) {
        if (-not (Test-ExpectedPreview)) {
            throw "Port $previewPort belongs to a different service. That service was left running; close it before starting this preview."
        }
        Write-Host "Reusing the current local preview: $pageUrl"
        if (-not $NoOpen -and -not $CheckOnly) { Start-Process -FilePath $pageUrl }
        exit 0
    }

    if ($CheckOnly) {
        Write-Host "Build ready: $entryPath"
        Write-Host "Port $previewPort is available. CheckOnly did not start a server."
        exit 0
    }

    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    $pythonPrefix = @()
    if (-not $pythonCommand) {
        $pythonCommand = Get-Command py -ErrorAction SilentlyContinue
        $pythonPrefix = @('-3')
    }
    if (-not $pythonCommand) { throw 'Python 3 is required to serve the built local preview.' }

    # Serve only the built browser assets. The source uses Vite package/WASM imports.
    $serverArguments = $pythonPrefix + @(
        '-m', 'http.server', "$previewPort", '--bind', '127.0.0.1',
        '--directory', ('"{0}"' -f $webRoot)
    )
    $serverProcess = Start-Process -FilePath $pythonCommand.Source -ArgumentList $serverArguments `
        -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($serverProcess.HasExited) { throw 'The local preview server exited before it was ready.' }
        if (Test-ExpectedPreview) { $ready = $true; break }
        Start-Sleep -Milliseconds 200
    }
    if (-not $ready) { throw 'The local preview did not become available.' }

    Write-Host "Local preview: $pageUrl"
    Write-Host "Serving: $webRoot"
    if (-not $NoOpen) { Start-Process -FilePath $pageUrl }
    Read-Host 'Press Enter to stop this preview server' | Out-Null
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally {
    # Stop only the child process started by this invocation; never an existing service.
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue
    }
}
