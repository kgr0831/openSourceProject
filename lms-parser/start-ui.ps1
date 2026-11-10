param([switch]$VerifyStart)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$lmsJob = $null
$lmsInstaller = $null
$lmsExitCode = 0
$script:lmsCancelled = $false
$script:lmsReady = $false

$lmsForm = New-Object System.Windows.Forms.Form
$lmsForm.Text = 'LMS 모아'
$lmsForm.ClientSize = New-Object System.Drawing.Size(420, 170)
$lmsForm.StartPosition = 'CenterScreen'
$lmsForm.FormBorderStyle = 'FixedDialog'
$lmsForm.MaximizeBox = $false
$lmsForm.BackColor = [System.Drawing.Color]::FromArgb(248, 250, 249)
$lmsForm.Font = New-Object System.Drawing.Font('Malgun Gothic', 10)
$lmsTitle = New-Object System.Windows.Forms.Label
$lmsTitle.Text = '내 공부 자료를 모을 준비 중이에요.'
$lmsTitle.Location = New-Object System.Drawing.Point(28, 25)
$lmsTitle.Size = New-Object System.Drawing.Size(370, 30)
$lmsTitle.Font = New-Object System.Drawing.Font('Malgun Gothic', 12, [System.Drawing.FontStyle]::Bold)
$lmsStatus = New-Object System.Windows.Forms.Label
$lmsStatus.Location = New-Object System.Drawing.Point(28, 65)
$lmsStatus.Size = New-Object System.Drawing.Size(365, 40)
$lmsStatus.Text = '실행에 필요한 항목을 확인하고 있어요.'
$lmsBar = New-Object System.Windows.Forms.ProgressBar
$lmsBar.Location = New-Object System.Drawing.Point(28, 120)
$lmsBar.Size = New-Object System.Drawing.Size(365, 8)
$lmsBar.Style = 'Marquee'
$lmsForm.Controls.AddRange(@($lmsTitle, $lmsStatus, $lmsBar))
$lmsForm.Add_FormClosing({ if (-not $script:lmsReady) { $script:lmsCancelled = $true } })

function Update-LmsStatus([string]$message) {
    $lmsStatus.Text = $message
    [System.Windows.Forms.Application]::DoEvents()
    if ($script:lmsCancelled) { throw '사용자가 실행을 취소했습니다.' }
}

try {
    if (-not $VerifyStart) { $lmsForm.Show() }
    Update-LmsStatus '실행에 필요한 항목을 확인하고 있어요.'
    $lmsNodeCandidates = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
    )
    $lmsNodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($lmsNodeCommand) { $lmsNodeCandidates += $lmsNodeCommand.Source }
    $lmsNode = $lmsNodeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $lmsNode) { throw 'Node.js가 필요해요. nodejs.org에서 권장 버전을 설치한 뒤 이 파일을 다시 열어 주세요.' }
    $lmsVersionText = & $lmsNode --version
    if ($LASTEXITCODE -ne 0 -or [version]$lmsVersionText.TrimStart('v') -lt [version]'20.18.1') { throw 'Node.js 20.18.1 이상이 필요해요. nodejs.org에서 새 버전을 설치해 주세요.' }

    $lmsBrowserCandidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    )
    $lmsBrowser = $lmsBrowserCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $lmsBrowser) { throw 'Google Chrome 또는 Microsoft Edge를 설치한 뒤 다시 열어 주세요.' }

    $lmsPort = 4318
    if ($env:SSU_LMS_PORT -and -not [int]::TryParse($env:SSU_LMS_PORT, [ref]$lmsPort)) { throw '앱 주소 설정이 올바르지 않아요.' }
    if ($lmsPort -lt 1024 -or $lmsPort -gt 65535) { throw '앱 주소 설정이 올바르지 않아요.' }
    $lmsUrl = "http://127.0.0.1:$lmsPort"
    $lmsExisting = $false
    try { $lmsHealth = Invoke-RestMethod -Uri "$lmsUrl/api/health" -TimeoutSec 2; $lmsExisting = $lmsHealth.app -eq 'ssu-lms-moa' } catch { }
    if (-not $lmsExisting) {
        $lmsDependenciesReady = (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules/playwright/package.json')) -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules/cheerio/package.json'))
        if (-not $lmsDependenciesReady) {
            Update-LmsStatus '처음 한 번 필요한 구성 요소를 준비해요. 인터넷에 연결해 주세요.'
            $lmsNpmCandidates = @((Join-Path (Split-Path $lmsNode) 'node_modules/npm/bin/npm-cli.js'))
            $lmsNpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
            if ($lmsNpmCommand) { $lmsNpmCandidates += Join-Path (Split-Path $lmsNpmCommand.Source) 'node_modules/npm/bin/npm-cli.js' }
            $lmsNpm = $lmsNpmCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
            if (-not $lmsNpm) { throw '구성 요소 설치 도구가 없어요. nodejs.org에서 Node.js를 다시 설치해 주세요.' }
            $lmsInstaller = Start-Process -FilePath $lmsNode -ArgumentList @(('"' + $lmsNpm + '"'), 'ci', '--ignore-scripts', '--no-fund', '--no-audit') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
            while (-not $lmsInstaller.HasExited) { Update-LmsStatus '필요한 구성 요소를 준비하고 있어요. 잠시만 기다려 주세요.'; Start-Sleep -Milliseconds 200 }
            $lmsInstaller.WaitForExit()
            $lmsInstaller.Refresh()
            if ($lmsInstaller.ExitCode -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules/playwright/package.json'))) { throw '구성 요소를 준비하지 못했어요. 인터넷 연결을 확인한 뒤 다시 열어 주세요.' }
        }
        Update-LmsStatus '공부 자료를 모을 화면을 열고 있어요.'
        if ($VerifyStart) { $env:SSU_LMS_VERIFY_START = '1' } else { Remove-Item Env:\SSU_LMS_VERIFY_START -ErrorAction SilentlyContinue }
        Add-Type -Path (Join-Path $PSScriptRoot '../timetable-demo/windows-job.cs')
        $lmsJob = New-Object TimetableJob($lmsNode, (Join-Path $PSScriptRoot 'server.mjs'), $PSScriptRoot)
        $lmsDeadline = [DateTime]::UtcNow.AddSeconds(30)
        $lmsServing = $false
        while ([DateTime]::UtcNow -lt $lmsDeadline) {
            if ($lmsJob.Wait(0)) { throw '앱을 열지 못했어요. 이미 열린 창이 있는지 확인한 뒤 다시 실행해 주세요.' }
            try {
                $lmsHealth = Invoke-RestMethod -Uri "$lmsUrl/api/health" -TimeoutSec 1
                if ($lmsHealth.app -eq 'ssu-lms-moa' -and $lmsHealth.pid -eq $lmsJob.ProcessId) { $lmsServing = $true; break }
            } catch { }
            Update-LmsStatus '공부 자료를 모을 화면을 열고 있어요.'
            Start-Sleep -Milliseconds 200
        }
        if (-not $lmsServing) { throw '앱 준비가 늦어지고 있어요. 잠시 후 다시 실행해 주세요.' }
    }
    # This is the user-requested interactive app window, outside the server job.
    if (-not $VerifyStart) { Start-Process -FilePath $lmsBrowser -ArgumentList @('--new-window', $lmsUrl) -WindowStyle Normal }
    $script:lmsReady = $true
    $lmsForm.Close()
    if ($VerifyStart) { Write-Output 'LMS UI startup verified.' }
    elseif ($null -ne $lmsJob) { while (-not $lmsJob.Wait(500)) { } }
} catch {
    $lmsExitCode = 1
    if ($VerifyStart) { Write-Output $_.Exception.Message }
    elseif (-not $script:lmsCancelled) { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'LMS 모아 시작 안내', 'OK', 'Information') | Out-Null }
} finally {
    if ($null -ne $lmsInstaller -and -not $lmsInstaller.HasExited) { $lmsInstaller.Kill() }
    if ($null -ne $lmsJob) { $lmsJob.Dispose() }
    $script:lmsReady = $true
    $lmsForm.Dispose()
}
exit $lmsExitCode
