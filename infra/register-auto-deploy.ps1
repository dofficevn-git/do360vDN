# Đăng ký tác vụ Windows Task Scheduler chạy infra/auto-deploy.sh mỗi 5 phút (và healthcheck.sh) bằng Git Bash.
# Chạy một lần trong PowerShell (không cần quyền quản trị):  powershell -ExecutionPolicy Bypass -File infra\register-auto-deploy.ps1
# Gỡ:  schtasks /delete /tn "DO360 auto-deploy" /f ; schtasks /delete /tn "DO360 healthcheck" /f
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$bash = 'C:\Program Files\Git\bin\bash.exe'
if (-not (Test-Path $bash)) { throw "Không thấy Git Bash tại $bash" }
$posix = ($root -replace '\\', '/') -replace '^([A-Za-z]):', { '/' + $_.Groups[1].Value.ToLower() }
$deploy = "`"$bash`" -lc `"cd $posix && bash infra/auto-deploy.sh`""
$health = "`"$bash`" -lc `"cd $posix && bash infra/healthcheck.sh`""
schtasks /create /f /tn "DO360 auto-deploy" /sc minute /mo 5 /tr $deploy | Out-Null
schtasks /create /f /tn "DO360 healthcheck" /sc minute /mo 5 /st 00:02 /tr $health | Out-Null
Write-Host "Đã đăng ký: 'DO360 auto-deploy' và 'DO360 healthcheck' (mỗi 5 phút, chạy khi tài khoản này đăng nhập Windows)."
Write-Host "Nhật ký: $root\infra\logs\deploy.log và health.log. Kiểm tra: schtasks /query /tn `"DO360 auto-deploy`""
