[CmdletBinding()]
param(
    [string]$AtlasRoot = '<atlas-source-root>',
    [string]$DestinationRoot = 'C:\ProgramData\Atlas\Backups\Config',
    [ValidateRange(1, 365)]
    [int]$RetentionCount = 30
)

$ErrorActionPreference = 'Stop'
$atlasRoot = (Resolve-Path -LiteralPath $AtlasRoot).Path
$orchestratorRoot = Join-Path $atlasRoot 'orchestrator'
$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$destination = Join-Path $DestinationRoot "config-$runId"

$excludedSegments = @(
    '.git', '.pytest_cache', '.venv', '__pycache__', 'node_modules', 'data', 'logs', 'BACKUP'
)
$excludedNames = @(
    '.env', 'config.js', 'private.pem', 'public.pem'
)
$excludedRootPrefixes = @(
    '_atlas-', '_energy-', '_evidence-', '_grafana-', '_notification-',
    '_ntfy-', '_ollama-', '_open-webui-', '_orchestrator-', '_rollback-',
    '_scheduler-', '_service-', '_signal-', '_stability-', '_superseded'
)
$rootPatterns = @('*.md', '*.yaml', '*.yml')
$orchestratorFiles = @('README.md', 'pyproject.toml', 'uv.lock')
$orchestratorTrees = @('config', 'scripts', 'src', 'tests')
$projectTrees = @('deploy', 'scripts', 'services')

New-Item -ItemType Directory -Path $destination -Force | Out-Null

function Test-ExcludedPath {
    param([string]$RelativePath)
    $segments = $RelativePath -split '[\\/]'
    foreach ($segment in $segments) {
        if ($excludedSegments -contains $segment) { return $true }
    }
    $leaf = Split-Path -Leaf $RelativePath
    if ($excludedNames -contains $leaf) { return $true }
    if ($leaf -match '\.(key|pem|pfx|p12)$') { return $true }
    return $false
}

function Copy-SnapshotFile {
    param(
        [string]$Source,
        [string]$RelativePath
    )
    if (Test-ExcludedPath $RelativePath) { return }
    $target = Join-Path $destination $RelativePath
    $targetParent = Split-Path -Parent $target
    New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $target -Force
}

foreach ($pattern in $rootPatterns) {
    Get-ChildItem -LiteralPath $atlasRoot -Filter $pattern -File | ForEach-Object {
        $excluded = $false
        foreach ($prefix in $excludedRootPrefixes) {
            if ($_.Name.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
                $excluded = $true
                break
            }
        }
        if (-not $excluded) {
            Copy-SnapshotFile -Source $_.FullName -RelativePath $_.Name
        }
    }
}

foreach ($name in $orchestratorFiles) {
    $source = Join-Path $orchestratorRoot $name
    if (Test-Path -LiteralPath $source) {
        Copy-SnapshotFile -Source $source -RelativePath (Join-Path 'orchestrator' $name)
    }
}

foreach ($tree in $orchestratorTrees) {
    $treeRoot = Join-Path $orchestratorRoot $tree
    if (-not (Test-Path -LiteralPath $treeRoot)) { continue }
    Get-ChildItem -LiteralPath $treeRoot -File -Recurse | ForEach-Object {
        $relativeToOrchestrator = $_.FullName.Substring($orchestratorRoot.Length).TrimStart('\')
        Copy-SnapshotFile -Source $_.FullName -RelativePath (Join-Path 'orchestrator' $relativeToOrchestrator)
    }
}

foreach ($tree in $projectTrees) {
    $treeRoot = Join-Path $atlasRoot $tree
    if (-not (Test-Path -LiteralPath $treeRoot)) { continue }
    Get-ChildItem -LiteralPath $treeRoot -File -Recurse | ForEach-Object {
        $relativeToAtlas = $_.FullName.Substring($atlasRoot.Length).TrimStart('\')
        Copy-SnapshotFile -Source $_.FullName -RelativePath $relativeToAtlas
    }
}

$manifest = Get-ChildItem -LiteralPath $destination -File -Recurse | Sort-Object FullName | ForEach-Object {
    [pscustomobject]@{
        path = $_.FullName.Substring($destination.Length).TrimStart('\')
        bytes = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
}
$manifestPath = Join-Path $destination 'MANIFEST.json'
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding utf8

$completion = [ordered]@{
    schema_version = 1
    status = 'complete'
    created_at = (Get-Date).ToUniversalTime().ToString('o')
    source = $atlasRoot
    destination = $destination
    file_count = @($manifest).Count
    manifest_sha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash
    exclusions = @('runtime databases', 'logs', 'caches', 'models', 'dependencies', 'evidence folders', 'rollback folders', 'secrets')
}
$completion | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $destination 'COMPLETE.json') -Encoding utf8

# Retain a bounded set of complete snapshots. Resolve and validate every deletion target;
# only strict config-YYYYMMDD-HHMMSS children of the selected backup root are eligible.
$resolvedDestinationRoot = [IO.Path]::GetFullPath($DestinationRoot).TrimEnd('\')
$expired = Get-ChildItem -LiteralPath $resolvedDestinationRoot -Directory -Filter 'config-*' |
    Where-Object { $_.Name -match '^config-\d{8}-\d{6}$' } |
    Sort-Object Name -Descending |
    Select-Object -Skip $RetentionCount
foreach ($directory in $expired) {
    $resolvedCandidate = [IO.Path]::GetFullPath($directory.FullName).TrimEnd('\')
    $resolvedParent = [IO.Path]::GetFullPath($directory.Parent.FullName).TrimEnd('\')
    if ($resolvedParent -ne $resolvedDestinationRoot -or $resolvedCandidate -eq $destination) {
        throw "Refusing to remove unvalidated backup path: $resolvedCandidate"
    }
    Remove-Item -LiteralPath $resolvedCandidate -Recurse -Force
}

Write-Output "[OK] Atlas configuration snapshot: $destination"
Write-Output "[OK] Files captured: $(@($manifest).Count)"
Write-Output "[OK] Manifest: $manifestPath"
Write-Output "[OK] Retention: newest $RetentionCount configuration snapshots"
