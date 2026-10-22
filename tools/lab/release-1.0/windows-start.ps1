# Run from an authenticated lab SSH session. Database credentials arrive only on stdin.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Security
$root = Join-Path $env:TEMP 'psft-v1-tools/acceptance'
$bridge = Join-Path $root 'credential-bridge.dpapi'
$bytes = [Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd())
$encrypted = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[IO.File]::WriteAllBytes($bridge, $encrypted)
$acl = New-Object Security.AccessControl.FileSecurity
$acl.SetOwner([Security.Principal.NTAccount]::new($env:USERNAME))
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($env:USERNAME, 'FullControl', 'Allow'))
Set-Acl -Path $bridge -AclObject $acl
$node = Join-Path $env:TEMP 'psft-v1-tools/node-v22.23.4-win-x64/node.exe'
$log = Join-Path $root 'interactive-host.log'
$runner = @"
`$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
`$data=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes('$bridge'),`$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
Remove-Item -LiteralPath '$bridge' -Force
`$payload=[Text.Encoding]::UTF8.GetString(`$data)
Set-Location '$root'
`$payload | & '$node' tools/lab/release-1.0/windows-host.mjs *> '$log'
exit `$LASTEXITCODE
"@
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($runner))
$taskName = 'PeopleSoftStudioV1Qualification'
$action = New-ScheduledTaskAction -Execute "$PSHOME/powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 35)
Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Started isolated qualification in the active desktop session. Log: $log"
