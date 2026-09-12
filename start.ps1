<#
.SYNOPSIS
Starts a Node.js web app with `npm run dev` in the project directory.
Logs output to a file and hides the console window.
#>

# --- CONFIG ---
$projectPath = "C:\Users\Owner\claude\openplex"  # Replace with your project folder
$logFile     = "$projectPath\npm-dev.log"
$npmCmd      = "npm run dev"

# --- SCRIPT ---
Set-Location -Path $projectPath -ErrorAction Stop

# Hide the console window (optional)
$windowCode = @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
Add-Type -TypeDefinition $windowCode -ErrorAction SilentlyContinue
$null = [Win32]::ShowWindow((Get-Process -Id $PID).MainWindowHandle, 0)

# Start npm and log output
Write-Output "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Starting $npmCmd..." | Out-File -FilePath $logFile -Append
& $npmCmd *>&1 | Out-File -FilePath $logFile -Append -NoNewline
