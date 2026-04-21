# Stops typical CastVoice dev listeners (Next.js + Uvicorn).
$ports = 8000, 3000, 3001
foreach ($port in $ports) {
    Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | ForEach-Object {
        $id = $_.OwningProcess
        if ($id) {
            Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
            Write-Host "Stopped PID $id (port $port)"
        }
    }
}
Write-Host "Done. Ports 8000 / 3000 / 3001 should be free (ignore stale netstat rows)."
