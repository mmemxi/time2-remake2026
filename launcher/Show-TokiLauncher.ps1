Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

function New-LauncherWindow([string]$Title, [int]$Height) {
    $window = [Windows.Forms.Form]::new()
    $window.Text = $Title
    $window.StartPosition = 'CenterScreen'
    $window.FormBorderStyle = 'FixedDialog'
    $window.MaximizeBox = $false
    $window.MinimizeBox = $false
    $window.ClientSize = [Drawing.Size]::new(620, $Height)
    return $window
}

function Add-LauncherControl($Window, $Control, [int]$Left, [int]$Top, [int]$Width, [int]$Height, [string]$Text = '') {
    $Control.SetBounds($Left, $Top, $Width, $Height)
    $Control.Text = $Text
    $Window.Controls.Add($Control)
    return $Control
}

function Select-InstallRoot {
    $window = New-LauncherWindow '時の封土 — インストール先' 140
    try {
        [void](Add-LauncherControl $window ([Windows.Forms.Label]::new()) 16 17 588 22 'インストール先を指定してください。')
        $path = Add-LauncherControl $window ([Windows.Forms.TextBox]::new()) 16 48 474 26 (Join-Path "$env:SystemDrive\" 'time2-remake2026')
        $browse = Add-LauncherControl $window ([Windows.Forms.Button]::new()) 502 46 102 29 '参照…'
        $next = Add-LauncherControl $window ([Windows.Forms.Button]::new()) 384 92 104 30 '次へ'
        $cancel = Add-LauncherControl $window ([Windows.Forms.Button]::new()) 500 92 104 30 'キャンセル'
        $cancel.DialogResult = 'Cancel'
        $window.AcceptButton = $next
        $window.CancelButton = $cancel
        $browse.Add_Click({
            $dialog = [Windows.Forms.FolderBrowserDialog]::new()
            try {
                $dialog.Description = '時の封土をインストールするフォルダーを選択してください。'
                $dialog.SelectedPath = $path.Text
                if ($dialog.ShowDialog($window) -eq 'OK') { $path.Text = $dialog.SelectedPath }
            } finally { $dialog.Dispose() }
        })
        $next.Add_Click({
            try {
                $candidate = $path.Text.Trim()
                if ($candidate -notmatch '^[A-Za-z]:[\\/]') { throw 'ドライブ名から始まるフォルダーを指定してください。' }
                $candidate = [IO.Path]::GetFullPath($candidate)
                $driveRoot = [IO.Path]::GetPathRoot($candidate)
                if ($candidate -eq $driveRoot) { throw 'ドライブの直下にあるフォルダーを指定してください。' }
                if (!([IO.DriveInfo]::new($driveRoot)).IsReady) { throw '指定されたドライブは使用できません。' }
                $path.Text = $candidate
                $window.DialogResult = 'OK'
            } catch { [void][Windows.Forms.MessageBox]::Show($window, $_.Exception.Message, 'インストール先') }
        })
        if ($window.ShowDialog() -eq 'OK') { return $path.Text }
    } finally { $window.Dispose() }
}

function Format-Capacity([long]$Bytes) {
    if ($Bytes -ge 1GB) { return '{0:N2} GiB' -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return '{0:N2} MiB' -f ($Bytes / 1MB) }
    if ($Bytes -ge 1KB) { return '{0:N2} KiB' -f ($Bytes / 1KB) }
    return "$Bytes B"
}

function Get-Percent([int]$Done, [int]$Total) {
    if (!$Total) { return 100 }
    return [int][math]::Floor(100 * $Done / $Total)
}

function Show-TokiLauncher {
    $settings = Join-Path $env:LOCALAPPDATA 'Time2Remake2026Launcher/install-location.txt'
    $legacy = Join-Path $PSScriptRoot 'GameData'
    $root = if (Test-Path -LiteralPath $settings -PathType Leaf) { [IO.File]::ReadAllText($settings).Trim() }
        elseif (Test-Path -LiteralPath (Join-Path $legacy 'installed.json') -PathType Leaf) { $legacy }
        else { Select-InstallRoot }
    if (!$root) { return }
    $firstInstall = !(Test-Path -LiteralPath (Join-Path $root 'installed.json') -PathType Leaf)

    $window = New-LauncherWindow '時の封土 — ランチャー' 267
    $window.ControlBox = $false
    $status = Add-LauncherControl $window ([Windows.Forms.Label]::new()) 16 16 588 23 '最新版を確認しています…'
    $capacity = Add-LauncherControl $window ([Windows.Forms.Label]::new()) 16 44 588 24 ''
    $overall = Add-LauncherControl $window ([Windows.Forms.Label]::new()) 16 78 588 22 '全体の進捗'
    $overallBar = Add-LauncherControl $window ([Windows.Forms.ProgressBar]::new()) 16 102 588 18
    $globalDownload = Add-LauncherControl $window ([Windows.Forms.Label]::new()) 16 132 588 22 'ダウンロード済み（全体）'
    $globalBar = Add-LauncherControl $window ([Windows.Forms.ProgressBar]::new()) 16 156 588 18
    $folder = Add-LauncherControl $window ([Windows.Forms.Label]::new()) 16 186 588 43 '処理中のフォルダー'
    $folder.AutoEllipsis = $true
    $folderBar = Add-LauncherControl $window ([Windows.Forms.ProgressBar]::new()) 16 234 588 18

    $messages = [Collections.Concurrent.ConcurrentQueue[object]]::new()
    $decision = [hashtable]::Synchronized(@{ proceed = $false })
    $ready = [Threading.ManualResetEventSlim]::new($false)
    $worker = [PowerShell]::Create()
    $script = {
        param($Updater, $Root, $Messages, $Decision, $Ready)
        . $Updater
        Start-Toki $Root {
            param($summary)
            $Messages.Enqueue(@{ kind = 'summary'; data = $summary })
            $Ready.Wait()
            return $Decision.proceed
        } {
            param($progress)
            $Messages.Enqueue(@{ kind = 'progress'; data = $progress.Clone() })
        } {
            param($version, $reason)
            $Messages.Enqueue(@{ kind = 'warning'; version = $version; reason = $reason })
        } {
            param($game)
            $Messages.Enqueue(@{ kind = 'launch' })
            $process = Start-Process -FilePath $env:ComSpec -ArgumentList '/d', '/c', 'start-server.cmd' -WorkingDirectory $game -WindowStyle Normal -PassThru
            try { $process.WaitForExit() } finally { $process.Dispose() }
        }
    }
    [void]$worker.AddScript($script.ToString()).AddArgument((Join-Path $PSScriptRoot 'Update-Toki.ps1')).AddArgument($root).AddArgument($messages).AddArgument($decision).AddArgument($ready)
    try {
        $window.Show()
        $task = $worker.BeginInvoke()
        do {
            $message = $null
            while ($messages.TryDequeue([ref]$message)) {
                switch ($message.kind) {
                    'summary' {
                        $data = $message.data
                        $free = Format-Capacity $data.free
                        $download = Format-Capacity $data.download
                        $staging = Format-Capacity $data.staging
                        $capacity.Text = "空き容量 $free    ダウンロード容量 $download"
                        $status.Text = "バージョン $($data.version) · 全 $($data.total) ファイル"
                        if ($firstInstall -or $data.free -lt $data.staging) {
                            $details = "インストール先  $root`n空き容量  $free`nダウンロード容量  $download（$($data.downloadCount) ファイル）`n展開に必要な空き容量  $staging"
                            if ($data.free -lt $data.staging) {
                                [void][Windows.Forms.MessageBox]::Show($window, "$details`n`n空き容量が不足しています。", '空き容量の確認', 'OK', 'Warning')
                            } else {
                                $decision.proceed = [Windows.Forms.MessageBox]::Show($window, "$details`n`nインストールを開始しますか？", '容量の確認', 'OKCancel', 'Information') -eq 'OK'
                            }
                        } else { $decision.proceed = $true }
                        $ready.Set()
                    }
                    'progress' {
                        $data = $message.data
                        $percent = Get-Percent $data.processed $data.total
                        $overall.Text = "全体の進捗  $percent%  ($($data.processed) / $($data.total) ファイル)"
                        $overallBar.Value = $percent
                        $globalDownload.Text = "ダウンロード済み（全体）  $($data.downloaded) / $($data.downloadCount)"
                        $globalBar.Value = Get-Percent $data.downloaded $data.downloadCount
                        $folderName = if ($data.folder) { $data.folder } else { 'ルートフォルダー' }
                        $folder.Text = "$folderName  ($($data.folderProcessed) / $($data.folderTotal) ファイル処理済み)`nダウンロード済み（このフォルダー）  $($data.folderDownloaded) / $($data.folderDownloadCount)"
                        $folderBar.Value = Get-Percent $data.folderDownloaded $data.folderDownloadCount
                    }
                    'warning' {
                        [void][Windows.Forms.MessageBox]::Show($window, "更新に失敗したため、バージョン $($message.version) を起動します。`n$($message.reason)", '時の封土', 'OK', 'Warning')
                    }
                    'launch' {
                        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($settings))
                        [IO.File]::WriteAllText($settings, $root)
                        $window.Hide()
                    }
                }
            }
            [Windows.Forms.Application]::DoEvents()
            Start-Sleep -Milliseconds 30
        } while (!$task.IsCompleted -or !$messages.IsEmpty)
        [void]$worker.EndInvoke($task)
        if ($worker.HadErrors) { throw $worker.Streams.Error[0] }
    } finally {
        $ready.Set()
        $worker.Dispose()
        $ready.Dispose()
        $window.Dispose()
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try { Show-TokiLauncher }
    catch { [void][Windows.Forms.MessageBox]::Show($_.Exception.Message, '時の封土 — エラー', 'OK', 'Error') }
}
