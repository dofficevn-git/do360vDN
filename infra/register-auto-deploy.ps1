# Đăng ký tác vụ Windows Task Scheduler chạy infra/auto-deploy.sh và infra/healthcheck.sh mỗi 5 phút bằng Git Bash.
# Chạy một lần trong PowerShell (không cần quyền quản trị):  powershell -ExecutionPolicy Bypass -File infra\register-auto-deploy.ps1
# Gỡ:  Unregister-ScheduledTask -TaskName "DO360 auto-deploy" -Confirm:$false ; Unregister-ScheduledTask -TaskName "DO360 healthcheck" -Confirm:$false
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$bash = 'C:\Program Files\Git\bin\bash.exe'
if (-not (Test-Path $bash)) { throw "Không thấy Git Bash tại $bash" }
# bộ khởi chạy ẩn cửa sổ (wscript) — ghép đường dẫn bằng Combine để không dính chuỗi "\r" trong mã nguồn
$launcher = [System.IO.Path]::Combine($root, 'infra', 'run-hidden.vbs')
if (-not (Test-Path $launcher)) { throw "Không thấy $launcher" }
function Register-Do360Task($name, $script, $offsetMinutes) {
  # chạy qua wscript + run-hidden.vbs để KHÔNG hiện cửa sổ console mỗi 5 phút
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $launcher + '" ' + $script) -WorkingDirectory $root
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes($offsetMinutes) -RepetitionInterval (New-TimeSpan -Minutes 5)
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 40) -MultipleInstances IgnoreNew -StartWhenAvailable -Hidden
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
}
Register-Do360Task 'DO360 auto-deploy' 'auto-deploy.sh' 1
Register-Do360Task 'DO360 healthcheck' 'healthcheck.sh' 3
Write-Host "Đã đăng ký 'DO360 auto-deploy' và 'DO360 healthcheck' (mỗi 5 phút, chạy ẩn cửa sổ khi tài khoản này đăng nhập Windows)."
Write-Host "Nhật ký: $root\infra\logs\deploy.log và health.log. Kiểm tra: Get-ScheduledTask -TaskName 'DO360*'"
