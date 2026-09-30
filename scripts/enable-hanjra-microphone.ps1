# Run only following an explicit user request to enable microphone access.
$ErrorActionPreference = 'Stop'
$settings = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone\NonPackaged',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone'
)
$backup = @($settings | ForEach-Object { [pscustomobject]@{ Path = $_; Value = (Get-ItemProperty -LiteralPath $_ -ErrorAction SilentlyContinue).Value } })
$backupRoot = Join-Path $PSScriptRoot '..\data\hanjra-backups'
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$backupPath = Join-Path $backupRoot ('microphone-consent_' + (Get-Date -Format 'yyyyMMdd_HHmmss_fff') + '.json')
$backup | ConvertTo-Json | Set-Content -LiteralPath $backupPath -Encoding UTF8
$results = foreach ($setting in $backup) {
  $errorName = $null
  if ($setting.Value -eq 'Deny') {
    try { Set-ItemProperty -LiteralPath $setting.Path -Name Value -Value 'Allow' -ErrorAction Stop } catch { $errorName = $_.Exception.GetType().Name }
  }
  [pscustomobject]@{ Path = $setting.Path; Before = $setting.Value; After = (Get-ItemProperty -LiteralPath $setting.Path -ErrorAction SilentlyContinue).Value; Error = $errorName }
}
[pscustomobject]@{ Backup = $backupPath; Settings = @($results); UserActionRequired = @($results | Where-Object { $_.After -ne 'Allow' }).Count -gt 0 } | ConvertTo-Json -Depth 4
