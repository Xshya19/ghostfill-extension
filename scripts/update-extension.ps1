param(
    [string]$PackagePath = '',
    [string]$InstallDirectory = (Split-Path -Parent $PSScriptRoot),
    [switch]$Automatic
)

$ErrorActionPreference = 'Stop'
$workRoot = $null
$updateLock = $null
. (Join-Path $PSScriptRoot 'auto-update-common.ps1')

function Read-GhostFillManifest([string]$Directory) {
    $manifest = Get-Content -LiteralPath (Join-Path $Directory 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.manifest_version -ne 3 -or $manifest.name -ne '__MSG_extensionName__' -or
        $manifest.background.service_worker -ne 'background.js' -or $manifest.action.default_popup -ne 'popup.html') {
        throw 'This is not a built GhostFill extension folder.'
    }
    $null = [version]$manifest.version
    foreach ($name in @('background.js', 'content.js', 'content.css', 'popup.html', 'popup.js', 'popup.css',
        'options.html', 'options.js', 'options.css', 'offscreen.html', 'offscreen.js', 'vendor.js')) {
        $file = Get-Item -LiteralPath (Join-Path $Directory $name)
        if ($file.PSIsContainer -or $file.Length -eq 0) { throw "The built package is missing $name." }
    }
    return $manifest
}

try {
    $InstallDirectory = Resolve-GhostFillInstallDirectory $InstallDirectory
    $current = Read-GhostFillManifest $InstallDirectory
    $parent = Split-Path -Parent $InstallDirectory
    $updateLock = Open-GhostFillUpdateLock $InstallDirectory
    # Re-read after acquiring the shared lock in case another updater completed
    # between folder validation and lock acquisition.
    $current = Read-GhostFillManifest $InstallDirectory
    $state = Read-GhostFillUpdateState $InstallDirectory $current.version
    if ($Automatic) {
        if ($PackagePath) { throw 'Automatic checks use only the fixed stable GitHub release source.' }
        if (-not $current.oauth2.client_id) { throw 'Automatic Windows updates support the Gmail-enabled build profile.' }
        if (-not $state.autoUpdateEnabled -or $state.taskName -cne (Get-GhostFillAutomaticTaskName $InstallDirectory)) {
            Write-Host 'Automatic updates are not enabled for this installation and Windows user.'
            exit 0
        }
        $now = [DateTimeOffset]::UtcNow
        if ($state.lastCheckedAt) {
            $lastChecked = [DateTimeOffset]::Parse($state.lastCheckedAt)
            if ($lastChecked -gt $now.AddMinutes(5)) { throw 'The previous automatic-check timestamp is invalid.' }
            if (($now - $lastChecked).TotalHours -lt 6) {
                Write-Host 'The automatic check interval has not elapsed.'
                exit 0
            }
        }
        $state.lastCheckedAt = $now.ToString('o')
        Write-GhostFillUpdateState $InstallDirectory $state
    }

    if (-not $PackagePath) {
        Write-Host "Installed version: $($current.version). Checking published releases..."
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/Xshya19/ghostfill-extension/releases/latest' -UserAgent 'GhostFill-Updater' -TimeoutSec 20
        $tag = [regex]::Match([string]$release.tag_name, '^v(\d+\.\d+\.\d+)$')
        if (-not $tag.Success -or $release.draft -or $release.prerelease) { throw 'No valid stable release is available.' }
        $releaseVersion = $tag.Groups[1].Value
        if ([version]$releaseVersion -le [version]$current.version) {
            Write-Host "No newer published version. Installed: $($current.version); published: $releaseVersion."
            exit 0
        }
        $zipName = "ghostfill-extension-v$releaseVersion.zip"
        if (-not ($release.assets | Where-Object { $_.name -eq $zipName }) -or
            -not ($release.assets | Where-Object { $_.name -eq "$zipName.sha256" })) {
            throw 'The release is missing its built ZIP or checksum. The installed extension was left unchanged.'
        }
    } else {
        $PackagePath = (Resolve-Path -LiteralPath $PackagePath).Path
        $zipName = [IO.Path]::GetFileName($PackagePath)
        $tag = [regex]::Match($zipName, '^ghostfill-extension-v(\d+\.\d+\.\d+)\.zip$')
        if (-not $tag.Success) { throw 'Choose a built ghostfill-extension-v<version>.zip, not the GitHub source ZIP.' }
        $releaseVersion = $tag.Groups[1].Value
    }

    $workRoot = [IO.Path]::GetFullPath((Join-Path $parent ('.ghostfill-update-' + [guid]::NewGuid().ToString('N'))))
    $parentPrefix = $parent.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $workRoot.StartsWith($parentPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe update directory.' }
    $null = New-Item -ItemType Directory -Path $workRoot
    if (-not $PackagePath) {
        Write-Host "Downloading GhostFill $releaseVersion..."
        $PackagePath = Join-Path $workRoot $zipName
        $releaseUrl = "https://github.com/Xshya19/ghostfill-extension/releases/download/v$releaseVersion/$zipName"
        Invoke-WebRequest -UseBasicParsing -Uri $releaseUrl -OutFile $PackagePath -TimeoutSec 60
        Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl.sha256" -OutFile "$PackagePath.sha256" -TimeoutSec 30
    }
    $checksum = Get-Content -LiteralPath "$PackagePath.sha256" -Raw
    $digest = [regex]::Match($checksum, '\A([a-fA-F0-9]{64})[ \t]+\*?([^\r\n]+)\r?\n?\z')
    $zipStream = [IO.File]::OpenRead($PackagePath)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { $fileHash = [BitConverter]::ToString($hasher.ComputeHash($zipStream)).Replace('-', '') }
    finally { $hasher.Dispose(); $zipStream.Dispose() }
    if (-not $digest.Success -or $digest.Groups[2].Value -cne $zipName -or
        $fileHash -ine $digest.Groups[1].Value) {
        throw 'The ZIP checksum does not match. Download the ZIP and its matching .sha256 file again.'
    }

    $payload = Join-Path $workRoot 'payload'
    $payloadPrefix = $payload + [IO.Path]::DirectorySeparatorChar
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($PackagePath)
    try {
        # ponytail: 64 MB unpacked cap; raise only if approved package assets outgrow it.
        if ($archive.Entries.Count -gt 5000 -or ($archive.Entries | Measure-Object Length -Sum).Sum -gt 64MB) {
            throw 'This ZIP exceeds the extension package size limit.'
        }
        foreach ($entry in $archive.Entries) {
            $entryPath = [IO.Path]::GetFullPath((Join-Path $payload $entry.FullName))
            if ([IO.Path]::IsPathRooted($entry.FullName) -or $entry.FullName.Contains(':') -or
                -not $entryPath.StartsWith($payloadPrefix, [StringComparison]::OrdinalIgnoreCase) -or
                (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) {
                throw 'This ZIP contains an unsafe path or folder link.'
            }
        }
    } finally { $archive.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($PackagePath, $payload)
    $incoming = Read-GhostFillManifest $payload
    if ($incoming.version -ne $releaseVersion -or [version]$incoming.version -lt [version]$current.version) {
        throw 'The package version is invalid or older than the installed version.'
    }
    if ($incoming.key -ne $current.key) { throw 'This package changes the extension identity. The installed version was left unchanged.' }
    if ([bool]$incoming.oauth2.client_id -ne [bool]$current.oauth2.client_id) { throw 'Use the same build profile: Gmail-enabled and temporary-email-only packages cannot be swapped by this updater.' }
    if ($state.autoUpdateEnabled) {
        foreach ($helper in @('auto-update-common.ps1', 'auto-update-extension.ps1', 'setup-auto-updates.ps1', 'update-extension.ps1')) {
            $file = Get-Item -LiteralPath (Join-Path $payload ('scripts/' + $helper))
            if ($file.PSIsContainer -or $file.Length -eq 0) { throw 'The new release is missing its automatic update helpers.' }
        }
    }
    # Replace any package-default status with this installation's opt-in state.
    # It retains the previous success version/ID until promotion completes.
    Write-GhostFillUpdateState $payload $state

    $backup = [IO.Path]::GetFullPath((Join-Path $parent ('.ghostfill-backup-' + $current.version + '-' + [guid]::NewGuid().ToString('N'))))
    if (-not $backup.StartsWith($parentPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe backup directory.' }
    # The published build has self-contained background/content/offscreen
    # entries and an initial vendor.js bundle, with no lazy chunk files.
    # Loaded runtimes retain their code until the extension reloads when idle.
    Move-Item -LiteralPath $InstallDirectory -Destination $backup
    try {
        if (Test-Path -LiteralPath $InstallDirectory) { throw 'The installed folder changed during the update.' }
        Move-Item -LiteralPath $payload -Destination $InstallDirectory
        $state.installedVersion = [string]$incoming.version
        $state.updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
        $state.updateId = [guid]::NewGuid().ToString('N')
        Write-GhostFillUpdateState $InstallDirectory $state
    } catch {
        # A status-write failure is part of promotion failure. Move only this
        # verified incoming folder back into staging before restoring backup.
        if ((Test-Path -LiteralPath $InstallDirectory) -and -not (Test-Path -LiteralPath $payload)) {
            Move-Item -LiteralPath $InstallDirectory -Destination $payload
        }
        if (-not (Test-Path -LiteralPath $InstallDirectory)) { Move-Item -LiteralPath $backup -Destination $InstallDirectory }
        throw "Update could not be applied. Previous files are restored or retained at: $backup. $($_.Exception.Message)"
    }
    Write-Host "Updated GhostFill to $($incoming.version)." -ForegroundColor Green
    Write-Host "Previous files: $backup"
    Write-Host 'Open chrome://extensions, click Reload on GhostFill, then refresh signup tabs.'
    exit 0
} catch {
    Write-Host "Update failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'You can also use the manual update steps in README.md.'
    exit 1
} finally {
    if ($updateLock) { $updateLock.Dispose() }
    if ($workRoot -and (Test-Path -LiteralPath $workRoot)) {
        # Delete only this run's verified staging directory, never the installation or backup.
        if ($workRoot.StartsWith($parentPrefix, [StringComparison]::OrdinalIgnoreCase) -and
            (Split-Path -Leaf $workRoot) -match '^\.ghostfill-update-[a-f0-9]{32}$') {
            Remove-Item -LiteralPath $workRoot -Recurse -Force
        }
    }
}
