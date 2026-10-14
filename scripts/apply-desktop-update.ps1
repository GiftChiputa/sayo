$ErrorActionPreference = 'Stop'
$desktopRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$version = (Get-Content -LiteralPath (Join-Path $desktopRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid installation version.' }
$payloadPath = Join-Path $desktopRoot 'release\win-unpacked'
if (-not (Test-Path -LiteralPath (Join-Path $payloadPath 'Sayo.exe'))) { throw 'Finish directory packaging before updating.' }
$installBase = Join-Path $env:USERPROFILE '.sayo-app'
$installPath = Join-Path $installBase $version
$releasePath = Join-Path $installPath 'Sayo.exe'
$stableProfilePath = Join-Path $env:USERPROFILE '.sayo'
$profilePath = if (Test-Path -LiteralPath (Join-Path $stableProfilePath 'migration-complete.json')) { $stableProfilePath } else { Join-Path $env:APPDATA 'VOOL' }
$recordPath = Join-Path $profilePath 'recordings'
$recordsBefore = @(if (Test-Path -LiteralPath $recordPath) { Get-ChildItem -LiteralPath $recordPath -Filter '*.json' })
$textBefore = @{}
$successfulAudioBytes = 0L
foreach ($recordFile in $recordsBefore) {
  $recordData = Get-Content -LiteralPath $recordFile.FullName -Raw | ConvertFrom-Json
  $recordState = $recordData.status
  if ($recordState -notin @('completed', 'blocked')) { throw 'Finish the active recording or pending transcription before restarting.' }
  $textBefore[$recordFile.Name] = [string]$recordData.text
  if ($recordState -eq 'completed' -and $recordData.text) {
    foreach ($audioSuffix in @('.wav', '.wav.bak', '.wav.tmp')) {
      $existingAudio = Join-Path $recordPath ($recordFile.BaseName + $audioSuffix)
      if (Test-Path -LiteralPath $existingAudio) { $successfulAudioBytes += (Get-Item -LiteralPath $existingAudio).Length }
    }
  }
}
$keyFile = Join-Path $profilePath 'groq-key.enc'
$settingsFile = Join-Path $profilePath 'settings.json'
$keyHashBefore = if (Test-Path -LiteralPath $keyFile) { (Get-FileHash -LiteralPath $keyFile -Algorithm SHA256).Hash } else { $null }
$settingsBefore = if (Test-Path -LiteralPath $settingsFile) { Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
$toolsFile = Join-Path $profilePath 'writing-tools.json'
$toolsHashBefore = if (Test-Path -LiteralPath $toolsFile) { (Get-FileHash -LiteralPath $toolsFile -Algorithm SHA256).Hash } else { $null }
# Only stop this project's portable app or our own installed app. Preserve other apps.
$oldApps = @(Get-CimInstance Win32_Process -Filter "Name = 'VOOL.exe' OR Name = 'Sayo.exe'" | Where-Object {
  ($_.ExecutablePath -like '*\AppData\Local\Temp\*' -or $_.ExecutablePath.StartsWith($installBase + '\', [StringComparison]::OrdinalIgnoreCase)) -and $_.CommandLine -notmatch '--type='
})
foreach ($oldApp in $oldApps) {
  if ($oldApp.ExecutablePath.StartsWith($installBase + '\', [StringComparison]::OrdinalIgnoreCase)) {
    if ((Split-Path -Leaf (Split-Path -Parent $oldApp.ExecutablePath)) -notmatch '^\d+\.\d+\.\d+$') { throw 'Preserve an unrelated installed app.' }
  } else {
    $oldLauncher = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $oldApp.ParentProcessId)
    $expectedReleaseDirectory = Join-Path $desktopRoot 'release'
    if (-not $oldLauncher.ExecutablePath -or (Split-Path -Parent $oldLauncher.ExecutablePath) -ne $expectedReleaseDirectory -or (Split-Path -Leaf $oldLauncher.ExecutablePath) -notmatch '^(VOOL|Sayo)-[\d.]+-Windows\.exe$') { throw 'Preserve an unrelated running app.' }
  }
  Stop-Process -Id $oldApp.ProcessId
}
Start-Sleep -Seconds 1
New-Item -ItemType Directory -Path $installPath -Force | Out-Null
foreach ($sayoInstallDirectory in @($installBase,$installPath)) {
  if ((Get-Item -LiteralPath $sayoInstallDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Preserve a redirected installation directory.' }
}
Get-ChildItem -LiteralPath $payloadPath | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $installPath -Recurse -Force }
Push-Location -LiteralPath $desktopRoot
try {
  node scripts/check-package.mjs --enable-startup --installed $releasePath
  if ($LASTEXITCODE -ne 0) { throw 'Packaged startup check failed.' }
} finally { Pop-Location }
$profilePath = $stableProfilePath
$recordPath = Join-Path $profilePath 'recordings'
$keyFile = Join-Path $profilePath 'groq-key.enc'
$settingsFile = Join-Path $profilePath 'settings.json'
$toolsFile = Join-Path $profilePath 'writing-tools.json'
$recordsAfter = @(Get-ChildItem -LiteralPath $recordPath -Filter '*.json')
if ($recordsBefore.Count -ne $recordsAfter.Count -or ($recordsBefore.Count -gt 0 -and @(Compare-Object $recordsBefore.Name $recordsAfter.Name).Count)) { throw 'Recording inventory changed unexpectedly.' }
foreach ($recordFile in $recordsAfter) {
  $afterData = Get-Content -LiteralPath $recordFile.FullName -Raw | ConvertFrom-Json
  if ($textBefore[$recordFile.Name] -cne [string]$afterData.text) { throw 'A saved transcript changed unexpectedly.' }
  if ($afterData.status -eq 'completed' -and $afterData.text -and (Test-Path -LiteralPath (Join-Path $recordPath ($recordFile.BaseName + '.wav')))) { throw 'Completed audio was not removed.' }
}
$keyHashAfter = if (Test-Path -LiteralPath $keyFile) { (Get-FileHash -LiteralPath $keyFile -Algorithm SHA256).Hash } else { $null }
if ($keyHashBefore -ne $keyHashAfter) { throw 'Encrypted key changed unexpectedly.' }
$settingsAfter = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json
foreach ($property in $settingsBefore.PSObject.Properties) {
  if ($property.Name -ne 'startAtLogin' -and $property.Value -ne $settingsAfter.($property.Name)) { throw 'An unrelated preference changed unexpectedly.' }
}
if (-not $settingsAfter.startAtLogin) { throw 'Windows sign-in setting was not enabled.' }
$toolsHashAfter = if (Test-Path -LiteralPath $toolsFile) { (Get-FileHash -LiteralPath $toolsFile -Algorithm SHA256).Hash } else { $null }
if ($toolsHashBefore -ne $toolsHashAfter) { throw 'Writing tools changed unexpectedly.' }
$desktopFolder = [Environment]::GetFolderPath('Desktop')
$oldShortcutPath = Join-Path $desktopFolder 'VOOL.lnk'
$newShortcutPath = Join-Path $desktopFolder 'Sayo.lnk'
$shortcutShell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $newShortcutPath) {
  $existingTarget = $shortcutShell.CreateShortcut($newShortcutPath).TargetPath
  if (-not $existingTarget.StartsWith($installBase + '\', [StringComparison]::OrdinalIgnoreCase) -and ((Split-Path -Parent $existingTarget) -ne (Join-Path $desktopRoot 'release') -or (Split-Path -Leaf $existingTarget) -notmatch '^Sayo-[\d.]+-Windows\.exe$')) { throw 'Preserve an unrelated Sayo shortcut.' }
}
if (Test-Path -LiteralPath $oldShortcutPath) {
  $oldShortcut = $shortcutShell.CreateShortcut($oldShortcutPath)
  if ($oldShortcut.TargetPath -ne (Join-Path $desktopRoot 'release\VOOL-0.1.0-Windows.exe')) { throw 'Preserve the unrelated VOOL shortcut.' }
  if (Test-Path -LiteralPath $newShortcutPath) { throw 'Preserve the existing Sayo shortcut.' }
  Move-Item -LiteralPath $oldShortcutPath -Destination $newShortcutPath
}
$shortcut = $shortcutShell.CreateShortcut($newShortcutPath)
$shortcut.TargetPath = $releasePath
$shortcut.WorkingDirectory = $installPath
$shortcut.Description = 'Sayo - personal voice dictation'
$shortcut.IconLocation = $releasePath + ',0'
$shortcut.Save()
$sayoProgramsFolder = [Environment]::GetFolderPath('Programs')
$sayoProgramsShortcut = Join-Path $sayoProgramsFolder 'Sayo.lnk'
if (Test-Path -LiteralPath $sayoProgramsShortcut) {
  $sayoProgramsTarget = $shortcutShell.CreateShortcut($sayoProgramsShortcut).TargetPath
  if (-not $sayoProgramsTarget.StartsWith($installBase + '\', [StringComparison]::OrdinalIgnoreCase) -and -not $sayoProgramsTarget.StartsWith((Join-Path $desktopRoot 'release') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Preserve an unrelated Start menu shortcut.' }
}
$sayoProgramsLink = $shortcutShell.CreateShortcut($sayoProgramsShortcut)
$sayoProgramsLink.TargetPath = $releasePath
$sayoProgramsLink.WorkingDirectory = $installPath
$sayoProgramsLink.Description = 'Sayo - personal voice dictation'
$sayoProgramsLink.IconLocation = $releasePath + ',0'
$sayoProgramsLink.Save()
$releaseHash = (Get-FileHash -LiteralPath $releasePath -Algorithm SHA256).Hash
Set-Content -LiteralPath (Join-Path $desktopRoot 'release\SHA256.txt') -Value ($releaseHash + '  ' + (Split-Path -Leaf $releasePath)) -Encoding ascii
Start-Process -FilePath $releasePath -ArgumentList '--background' -WorkingDirectory $installPath -WindowStyle Hidden
Write-Output ('PASS: installed Sayo started in background; ' + $recordsAfter.Count + ' recordings and encrypted key preserved; startup, desktop and Start menu shortcuts updated.')
Write-Output ('Completed audio removed: ' + [Math]::Round($successfulAudioBytes / 1MB, 2) + ' MiB; transcript text unchanged.')
