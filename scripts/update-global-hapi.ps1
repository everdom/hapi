param(
    [switch]$NoBuild,
    [switch]$NoRestart,
    [switch]$Force,
    [string]$GlobalHapiPath,
    [string]$Bun = "bun"
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Resolve-GlobalHapiPath {
    if ($GlobalHapiPath) {
        return [System.IO.Path]::GetFullPath($GlobalHapiPath)
    }

    $cmd = Get-Command hapi.exe -CommandType Application -ErrorAction SilentlyContinue
    if (-not $cmd) {
        $cmd = Get-Command hapi -CommandType Application -ErrorAction SilentlyContinue
    }
    if ($cmd -and $cmd.Source) {
        return $cmd.Source
    }

    return Join-Path $env:APPDATA "npm\hapi.exe"
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$sourcePath = Join-Path $repoRoot "cli\dist-exe\bun-windows-x64\hapi.exe"
$targetPath = Resolve-GlobalHapiPath

Write-Step "Repo"
Write-Host $repoRoot

if (-not $NoBuild) {
    Write-Step "Build single exe"
    Push-Location $repoRoot
    try {
        & $Bun run build:single-exe
        if ($LASTEXITCODE -ne 0) {
            throw "Build failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Build output not found: $sourcePath"
}

Write-Step "Paths"
Write-Host "Source: $sourcePath"
Write-Host "Target: $targetPath"

$targetDir = Split-Path -Parent $targetPath
if (-not (Test-Path -LiteralPath $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir | Out-Null
}

$running = @(
    Get-CimInstance Win32_Process |
        Where-Object { $_.ExecutablePath -eq $targetPath }
)

if ($running.Count -gt 0) {
    Write-Step "Running hapi processes"
    $running | Select-Object ProcessId, CommandLine | Format-Table -AutoSize

    if (-not $Force) {
        $answer = Read-Host "Stop these processes and replace global hapi.exe? This interrupts active HAPI sessions. Type YES"
        if ($answer -ne "YES") {
            Write-Host "Cancelled."
            exit 1
        }
    }

    Write-Step "Stop hapi processes"
    $running | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
    }
    Start-Sleep -Seconds 2
}

Write-Step "Backup and replace"
if (Test-Path -LiteralPath $targetPath) {
    $backupPath = "$targetPath.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
    Copy-Item -LiteralPath $targetPath -Destination $backupPath -Force
    Write-Host "Backup: $backupPath"
}

Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
Write-Host "Replaced: $targetPath"

Write-Step "Verify hash"
$sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
$targetHash = (Get-FileHash -LiteralPath $targetPath -Algorithm SHA256).Hash
Write-Host "Source: $sourceHash"
Write-Host "Target: $targetHash"
if ($sourceHash -ne $targetHash) {
    throw "Hash mismatch after copy"
}

if (-not $NoRestart) {
    Write-Step "Restart hub and runner"
    Start-Process -FilePath $targetPath -ArgumentList @("hub") -WindowStyle Hidden
    Start-Process -FilePath $targetPath -ArgumentList @("runner", "start-sync") -WindowStyle Hidden
    Start-Sleep -Seconds 3

    Get-CimInstance Win32_Process |
        Where-Object {
            $_.ExecutablePath -eq $targetPath -and (
                $_.CommandLine -like "* hub*" -or
                $_.CommandLine -like "*runner start-sync*"
            )
        } |
        Select-Object ProcessId, CommandLine |
        Format-Table -AutoSize
}

Write-Step "Done"
