# Starts KickOff Tickets: FastAPI backend on :8000 and Vite frontend on :5173.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

if (-not (Test-Path (Join-Path $backend '.venv'))) {
    Write-Host 'Creating Python virtual environment...'
    py -3.12 -m venv (Join-Path $backend '.venv')
    & (Join-Path $backend '.venv\Scripts\python.exe') -m pip install -q -r (Join-Path $backend 'requirements.txt')
}
if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
    Write-Host 'Installing frontend dependencies...'
    Push-Location $frontend; npm install --no-fund --no-audit; Pop-Location
}

Start-Process powershell -WorkingDirectory $backend -ArgumentList '-NoExit', '-Command', '.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000'
Start-Process powershell -WorkingDirectory $frontend -ArgumentList '-NoExit', '-Command', 'npm run dev -- --host 127.0.0.1'

Start-Sleep -Seconds 4
Start-Process 'http://127.0.0.1:5173'
Write-Host 'KickOff Tickets running: UI http://127.0.0.1:5173 · API docs http://127.0.0.1:8000/docs'
