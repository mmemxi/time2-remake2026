[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$GameFiles = @('start-server.cmd', 'launcher-messages.ps1', 'server.py', 'index.html', 'README.md', 'LICENSE.md')
$GameFolders = @('character', 'html', 'js', 'mp3', 'resource', 'scenario', 'se', 'voice')
$PlayerFiles = @('save-data.json', '.time2-port')
$VersionPattern = '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z'

function Get-GameVersion([string]$Value) {
    if ($Value -cnotmatch $VersionPattern) { throw "Invalid game version: $Value" }
    return [version]$Value
}

function Resolve-GameFile([string]$Root, [string]$Relative) {
    $parts = $Relative.Split('/')
    if (($parts.Count -eq 1 -and $parts[0] -notin $GameFiles) -or
        ($parts.Count -gt 1 -and $parts[0] -notin $GameFolders)) {
        throw "Path outside the distributed game files: $Relative"
    }
    $path = $Root
    foreach ($part in $parts) {
        if ($part -match '[\x00-\x1f<>:"\\|?*]' -or $part -in @('', '.', '..') -or
            $part -match '[. ]\z' -or $part -match '^(CON|PRN|AUX|NUL|COM[0-9\u00b9\u00b2\u00b3]|LPT[0-9\u00b9\u00b2\u00b3])(\.|\z)') {
            throw "Invalid file path: $Relative"
        }
        $path = Join-Path $path $part
        if (Test-Path -LiteralPath $path) {
            if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Linked path is not supported: $path"
            }
        }
    }
    return $path
}

function Invoke-GameUpdate([string]$Root, [string]$Repository, [string]$Active, [string]$Current,
    [scriptblock]$Confirm, [scriptblock]$Report) {
    $ProgressPreference = 'SilentlyContinue'
    $base = "https://raw.githubusercontent.com/$Repository"
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 -Uri "$base/main/updates/latest.json"
    $reader = [IO.StreamReader]::new($response.RawContentStream, [Text.Encoding]::UTF8)
    try { $index = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($index.schemaVersion -ne 1) { throw 'Unsupported update manifest.' }
    $latest = Get-GameVersion $index.version
    if ($Current -and $latest -le (Get-GameVersion $Current)) { return $Active }

    $stageName = 'game-' + [guid]::NewGuid().ToString('N')
    $stage = Join-Path $Root $stageName
    $state = Join-Path $Root 'installed.json'
    $pendingState = Join-Path $Root 'installed.tmp'
    $previousState = Join-Path $Root 'installed.previous'
    $committed = $false
    try {
        [void][IO.Directory]::CreateDirectory($stage)
        $paths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($file in $index.files) {
            $target = Resolve-GameFile $stage $file.path
            if (!$paths.Add($target) -or $file.sha256 -notmatch '^[a-f0-9]{64}\z' -or
                $file.size -isnot [ValueType] -or $file.size -lt 0 -or $file.size -gt 100MB) {
                throw "Invalid manifest entry: $($file.path)"
            }
        }
        $plan = @(foreach ($file in $index.files) {
            $target = Resolve-GameFile $stage $file.path
            $source = $null
            if ($Active) {
                $candidate = Resolve-GameFile $Active $file.path
                if ((Test-Path -LiteralPath $candidate -PathType Leaf) -and
                    (Get-Item -LiteralPath $candidate).Length -eq $file.size -and
                    (Get-FileHash -LiteralPath $candidate).Hash -eq $file.sha256) {
                    $source = $candidate
                }
            }
            @{ file = $file; target = $target; source = $source; folder = ([IO.Path]::GetDirectoryName($file.path) -replace '\\', '/') }
        })
        $requiredDownloads = @($plan | Where-Object { !$_.source })
        $downloadBytes = [long]($requiredDownloads | ForEach-Object { $_.file.size } | Measure-Object -Sum).Sum
        $stageBytes = [long]($plan | ForEach-Object { $_.file.size } | Measure-Object -Sum).Sum
        $saves = @(if ($Active) {
            foreach ($name in $PlayerFiles) {
                $save = Join-Path $Active $name
                if (Test-Path -LiteralPath $save -PathType Leaf) { Get-Item -LiteralPath $save }
            }
        })
        foreach ($save in $saves) { $stageBytes += $save.Length }
        $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($Root))
        $summary = @{ version = "$latest"; free = $drive.AvailableFreeSpace; download = $downloadBytes
            staging = $stageBytes; total = $plan.Count; downloadCount = $requiredDownloads.Count }
        if ($Confirm -and !(& $Confirm $summary)) { return $Active }
        if ($summary.free -lt $stageBytes) { throw 'Not enough disk space for the new installation.' }
        foreach ($save in $saves) { Copy-Item -LiteralPath $save.FullName -Destination $stage -Force }

        $processed = $downloaded = 0
        foreach ($group in ($plan | Group-Object { $_.folder } | Sort-Object Name)) {
            $folderProcessed = $folderDownloaded = 0
            $folderDownloads = @($group.Group | Where-Object { !$_.source }).Count
            $progress = @{ total = $plan.Count; downloadCount = $requiredDownloads.Count; folder = $group.Name
                folderTotal = $group.Count; folderDownloadCount = $folderDownloads; processed = $processed
                downloaded = $downloaded; folderProcessed = 0; folderDownloaded = 0 }
            if ($Report) { & $Report $progress }
            foreach ($item in $group.Group) {
                $file = $item.file
                [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($item.target))
                if ($item.source) { Copy-Item -LiteralPath $item.source -Destination $item.target }
                else {
                    $encoded = ($file.path.Split('/') | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
                    Invoke-WebRequest -UseBasicParsing -TimeoutSec 180 -Uri "$base/game-v$latest/game/$encoded" -OutFile $item.target
                    if ((Get-Item -LiteralPath $item.target).Length -ne $file.size -or
                        (Get-FileHash -LiteralPath $item.target).Hash -ne $file.sha256) { throw "File verification failed: $($file.path)" }
                    $downloaded++
                    $folderDownloaded++
                }
                $processed++
                $folderProcessed++
                $progress.processed = $processed
                $progress.downloaded = $downloaded
                $progress.folderProcessed = $folderProcessed
                $progress.folderDownloaded = $folderDownloaded
                if ($Report) { & $Report $progress }
            }
        }
        foreach ($name in $GameFiles) {
            if (!(Test-Path -LiteralPath (Join-Path $stage $name) -PathType Leaf)) { throw "Required game file is missing: $name" }
        }
        @{ version = $index.version; directory = $stageName } | ConvertTo-Json | Set-Content -LiteralPath $pendingState -Encoding UTF8
        if ([IO.File]::Exists($state)) { [IO.File]::Replace($pendingState, $state, $previousState) }
        else { [IO.File]::Move($pendingState, $state) }
        $committed = $true
        Write-Host "Installed version $latest."
    } finally {
        Remove-Item -LiteralPath $pendingState, $previousState -Force -ErrorAction SilentlyContinue
        if (!$committed) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
    }
    if ($Active) { Remove-Item -LiteralPath $Active -Recurse -Force -ErrorAction SilentlyContinue }
    return $stage
}

function Start-Toki([string]$Root, [scriptblock]$Confirm, [scriptblock]$Report,
    [scriptblock]$Warn, [scriptblock]$Launch) {
    $config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'launcher.json') -Raw | ConvertFrom-Json
    if ($config.repository -notmatch '^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+\z' -or
        $config.repository -eq 'OWNER/REPOSITORY') { throw 'Set repository to your GitHub OWNER/REPOSITORY in launcher.json.' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    [void][IO.Directory]::CreateDirectory($root)
    $lock = [IO.File]::Open((Join-Path $root 'launcher.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    try {
        $active = $current = ''
        $state = Join-Path $root 'installed.json'
        if (Test-Path -LiteralPath $state) {
            $installed = Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
            if ($installed.directory -cnotmatch '^game-[a-f0-9]{32}\z') { throw 'Invalid installed game directory.' }
            $current = (Get-GameVersion $installed.version).ToString()
            $active = Join-Path $root $installed.directory
            if (!(Test-Path -LiteralPath (Join-Path $active 'start-server.cmd') -PathType Leaf)) { throw 'Installed game is incomplete.' }
        }
        try { $active = Invoke-GameUpdate $root $config.repository $active $current $Confirm $Report }
        catch {
            if (!$active) { throw }
            if ($Warn) { & $Warn $current $_.Exception.Message }
            else { Write-Warning "Update failed. Starting version $current. $($_.Exception.Message)" }
        }
        if ($active) { & $Launch $active }
    } finally { $lock.Dispose() }
}
