$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$demoJob = $null
$exitCode = 0
try {
    Write-Host '시간표 추천 데모를 준비하고 있습니다.' -ForegroundColor Cyan
    Write-Host '이 터미널을 닫으면 데모와 AI 연결 프로세스가 함께 종료됩니다.'
    Write-Host ''

    $nodeCandidates = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
    )
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($nodeCommand) { $nodeCandidates += $nodeCommand.Source }
    $nodePath = $nodeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $nodePath) { throw 'Node.js 20.18.1 이상이 필요합니다.' }
    $nodeVersion = & $nodePath --version
    if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion.TrimStart('v') -lt [version]'20.18.1') { throw 'Node.js 20.18.1 이상이 필요합니다.' }

    & $nodePath (Join-Path $PSScriptRoot 'prepare-dependencies.mjs')
    if ($LASTEXITCODE -ne 0) { throw '데모 구성 요소를 준비하지 못했습니다. 위의 안내를 확인해 주세요.' }
    & $nodePath (Join-Path $PSScriptRoot 'scripts/check-solver.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.10 이상을 설치하고 timetable-demo 폴더에서 npm run setup:solver를 실행해 주세요.' }

    $chromeCandidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe')) {
        $item = Get-Item -LiteralPath $key -ErrorAction SilentlyContinue
        if ($item) { $chromeCandidates += $item.GetValue('') }
    }
    $chromePath = $chromeCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
    if (-not $chromePath) { throw 'Google Chrome을 설치한 뒤 다시 실행해 주세요.' }

    $demoPort = 4317
    if ($env:PORT) {
        if (-not [int]::TryParse($env:PORT, [ref]$demoPort)) { throw 'PORT 값이 올바르지 않습니다.' }
    }
    if ($demoPort -lt 1024 -or $demoPort -gt 65535) { throw 'PORT는 1024~65535 사이여야 합니다.' }
    $localUrl = "http://127.0.0.1:$demoPort"
    $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    if ($listeners | Where-Object { $_.Port -eq $demoPort }) { throw "$demoPort 포트가 사용 중입니다. 기존 데모 터미널을 닫고 다시 실행해 주세요." }

    Add-Type -Path (Join-Path $PSScriptRoot 'windows-job.cs')
    $demoJob = New-Object TimetableJob($nodePath, (Join-Path $PSScriptRoot 'server.mjs'), $PSScriptRoot)
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    $ready = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($demoJob.Wait(0)) { throw '서버가 시작되지 않았습니다. 위의 오류를 확인해 주세요.' }
        try {
            $health = Invoke-RestMethod -Uri "$localUrl/api/health" -TimeoutSec 2
            if ($health.app -eq 'timetable-demo' -and $health.pid -eq $demoJob.ProcessId) { $ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 200
    }
    if (-not $ready) { throw '서버 준비 시간이 초과됐습니다. 다시 실행해 주세요.' }

    Write-Host '기본 추천은 바로 사용할 수 있습니다. AI 추천은 앱에서 연결해 주세요.'
    if ($demoJob.Wait(0)) { throw '서버가 종료됐습니다. 다시 실행해 주세요.' }

    # Chrome is started outside the server's job, preserving other browser windows.
    Start-Process -FilePath $chromePath -ArgumentList @('--new-window', $localUrl)
    Write-Host ''
    Write-Host '준비 완료. 크롬 창을 열었습니다.' -ForegroundColor Green
    Write-Host '사용하는 동안 이 터미널을 열어 두세요. 종료: 창 닫기 또는 Ctrl+C.'
    while (-not $demoJob.Wait(250)) { }
    $exitCode = [int]$demoJob.ExitCode
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    $exitCode = 1
} finally {
    if ($null -ne $demoJob) { $demoJob.Dispose() }
}
exit $exitCode
