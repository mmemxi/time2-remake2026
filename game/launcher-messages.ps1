param(
    [string]$Key,
    [string]$Value = ""
)

switch ($Key) {
    "python_missing" {
        Write-Host ""
        Write-Host "『時の封土』の起動に必要なPython 3が見つかりませんでした。"
        Write-Host "この起動ツールから、現在のWindowsユーザー用にPython 3をインストールできます。"
        Write-Host "インストールにはインターネット接続が必要です。"
        Write-Host "Windowsからインストールの確認が表示される場合があります。"
        Write-Host ""
        Write-Host -NoNewline "Python 3をインストールしますか？ [Y/N]: "
    }
    "installing" {
        Write-Host ""
        Write-Host "Windows Package Managerを使用してPython 3をインストールしています…"
    }
    "restart_required" {
        Write-Host ""
        Write-Host "Python 3のインストールは完了しましたが、この画面ではまだ認識できません。"
        Write-Host "この画面を閉じてから、start-server.cmdをもう一度実行してください。"
        Write-Host ""
    }
    "no_winget" {
        Write-Host ""
        Write-Host "このパソコンではWindows Package Manager（winget）を利用できません。"
        Write-Host "Pythonの公式ダウンロードページを開きます。"
        Write-Host "Python 3をインストールするときは『Add Python to PATH』を有効にしてください。"
        Write-Host "インストール後、start-server.cmdをもう一度実行してください。"
        Write-Host ""
    }
    "install_failed" {
        Write-Host ""
        Write-Host "Python 3の自動インストールを完了できませんでした。"
        Write-Host "Pythonの公式ダウンロードページを開きます。"
        Write-Host "Python 3をインストールするときは『Add Python to PATH』を有効にしてください。"
        Write-Host "インストール後、start-server.cmdをもう一度実行してください。"
        Write-Host ""
    }
    "install_cancelled" {
        Write-Host ""
        Write-Host "インストールを中止しました。『時の封土』は起動していません。"
        Write-Host "インストールする準備ができたら、この起動ツールをもう一度実行してください。"
        Write-Host ""
    }
    "starting" {
        Write-Host ""
        Write-Host "$Value を使用して『時の封土』を起動しています…"
    }
    "server_error" {
        Write-Host ""
        Write-Host "『時の封土』のサーバーがエラーコード $Value で終了しました。"
        Write-Host "詳しいエラー内容は、このメッセージより上に表示されています。"
        Write-Host ""
    }
    "wait_key" {
        Write-Host "何かキーを押すと終了します…"
    }
}
