[CmdletBinding()]
param(
    [string]$PythonPath = '',
    [string]$DataRoot = 'C:\ProgramData\Atlas\Data\Core',
    [string]$LogRoot = 'C:\ProgramData\Atlas\Logs',
    [ValidateRange(1, 65535)]
    [int]$Port = 80,
    [switch]$LoopbackOnly
)

$ErrorActionPreference = 'Stop'
$launchMutex = [Threading.Mutex]::new($false, 'Local\AtlasHomeLaunch')
$launchLock = $false
try {
try { $launchLock = $launchMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $launchLock = $true }
if (-not $launchLock) { throw 'Atlas Home launcher is already running.' }
if (Test-Path -LiteralPath 'C:\ProgramData\Atlas\Runtime\atlas-recovery-paused.json') {
    Write-Output 'Atlas Home start skipped: planned maintenance is paused.'
    return
}
$orchestratorRoot = Split-Path -Parent $PSScriptRoot
if (-not $PythonPath) { $PythonPath = Join-Path $orchestratorRoot '.venv\Scripts\python.exe' }
$serverEntrypoint = Join-Path $PSScriptRoot 'serve-atlas-current.py'
$statusConfig = Join-Path $orchestratorRoot 'config\atlas-status.json'
$hostAddress = if ($LoopbackOnly) { '127.0.0.1' } else { '0.0.0.0' }
$stdoutLog = Join-Path $LogRoot 'atlas-home-stdout.log'
$stderrLog = Join-Path $LogRoot 'atlas-home-stderr.log'
$runtimeRoot = 'C:\ProgramData\Atlas\Runtime'
$runtimeState = Join-Path $runtimeRoot 'atlas-home-process.json'
$atlasRoot = Split-Path -Parent $orchestratorRoot
$vaultModule = Join-Path $atlasRoot 'scripts\Atlas.CredentialVault.psm1'

foreach ($requiredFile in @($PythonPath, $serverEntrypoint, $statusConfig, $vaultModule)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required Atlas file not found: $requiredFile"
    }
}

$null = New-Item -ItemType Directory -Force -Path $DataRoot, $LogRoot, $runtimeRoot
Import-Module $vaultModule -Force

$existing = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($existing) {
    try {
        $live = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/live" -TimeoutSec 3
        if ($live.status -eq 'alive') {
            Write-Output "Atlas Home OS is already live on port $Port."
            return
        }
    } catch {
        # Fall through to the explicit ownership error below.
    }
    $owners = ($existing | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
    throw "Port $Port is already owned by another listener (PID: $owners)."
}

$env:ATLAS_HOST = $hostAddress
$env:ATLAS_PORT = [string]$Port
$env:ATLAS_DATA_DIR = $DataRoot
$env:ATLAS_STATUS_CONFIG = $statusConfig
$env:ATLAS_GALLEYQUEST_CONFIG = '<galleyquest-source-root>\config.js'
$env:ATLAS_POWERWALL_STATUS_URL = 'http://127.0.0.1:17082/api/powerwall'
$env:ATLAS_HOME_ASSISTANT_URL = 'http://127.0.0.1:17081'
$env:ATLAS_HOME_BACKUP_ROOT = 'C:\ProgramData\Atlas\Data\HomeAssistant'
$env:ATLAS_TRUSTED_NETWORKS = if ($LoopbackOnly) {
    '127.0.0.0/8,::1/128'
} else {
    '127.0.0.0/8,::1/128,<lan-subnet>,100.64.0.0/10'
}
$env:ATLAS_ALLOW_REMOTE_WRITES = '0'
$env:ATLAS_SECRET_SOURCE = 'windows-credential-manager'
# Preserve the local Hermes route during supervised restart and next sign-in.
$env:ATLAS_HERMES_API_URL = [Environment]::GetEnvironmentVariable('ATLAS_HERMES_API_URL', 'User')
$env:ATLAS_HERMES_API_KEY = [Environment]::GetEnvironmentVariable('ATLAS_HERMES_API_KEY', 'User')
$env:ATLAS_HERMES_SESSION_ID = 'atlas-household'
$env:ATLAS_GARAGE_ENTITY_ID = [Environment]::GetEnvironmentVariable('ATLAS_GARAGE_ENTITY_ID', 'User')
if ($env:ATLAS_HERMES_API_URL -and [string]::IsNullOrWhiteSpace($env:ATLAS_HERMES_API_KEY)) {
    throw 'Local Hermes is configured but its saved API key is missing. Refusing a silent route change.'
}
$galleyCredential = 'Atlas/GalleyQuest/SupabaseAnonKey'
$homeAssistantCredential = 'Atlas/Powerwall/HomeAssistantToken'
if (-not (Test-AtlasSecret -Name $galleyCredential)) {
    throw "Required Atlas credential is missing: $galleyCredential"
}
if (-not (Test-AtlasSecret -Name $homeAssistantCredential)) {
    throw "Required Atlas credential is missing: $homeAssistantCredential"
}
$env:ATLAS_GALLEYQUEST_ANON_KEY = Get-AtlasSecret -Name $galleyCredential -AsPlainText
$env:ATLAS_HOME_ASSISTANT_TOKEN = Get-AtlasSecret -Name $homeAssistantCredential -AsPlainText
if ([string]::IsNullOrWhiteSpace($env:ATLAS_OLLAMA_MODEL)) {
    $env:ATLAS_OLLAMA_MODEL = 'gemma4:12b'
}

$process = Start-Process -FilePath $PythonPath `
    -ArgumentList @($serverEntrypoint, '--data-dir', $DataRoot, 'serve') `
    -WorkingDirectory $orchestratorRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru
$env:ATLAS_GALLEYQUEST_ANON_KEY = $null
$env:ATLAS_HOME_ASSISTANT_TOKEN = $null

$deadline = (Get-Date).AddSeconds(20)
do {
    Start-Sleep -Milliseconds 250
    try {
        $live = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/live" -TimeoutSec 2
    } catch {
        $live = $null
    }
} until ($live.status -eq 'alive' -or $process.HasExited -or (Get-Date) -ge $deadline)

if ($live.status -ne 'alive') {
    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
    }
    $detail = Get-Content -LiteralPath $stderrLog -Tail 20 -ErrorAction SilentlyContinue
    throw "Atlas Home OS failed to become live. $detail"
}

@{
    pid = $process.Id
    started_at = (Get-Date).ToString('o')
    host = $hostAddress
    port = $Port
    python = $PythonPath
    source = $orchestratorRoot
    data = $DataRoot
    secret_source = 'windows-credential-manager'
} | ConvertTo-Json | Set-Content -LiteralPath $runtimeState -Encoding utf8

Write-Output "Atlas Home OS started (PID $($process.Id)) at http://127.0.0.1:$Port/."
} finally {
    if ($launchLock) { $launchMutex.ReleaseMutex() }
    $launchMutex.Dispose()
}
