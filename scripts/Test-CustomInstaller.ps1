[CmdletBinding()]
param(
    [string]$InstallerPath,
    [ValidateSet('Fresh', 'Update', 'Updater', 'Auto')]
    [string]$Mode = 'Auto'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
    $version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
    $InstallerPath = Join-Path $root "dist\Minova-Cinema-Desktop-$version-Setup.exe"
}
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$effectiveMode = $Mode
$arguments = @('/test')
if ($Mode -eq 'Fresh') { $arguments += '/fresh' }
elseif ($Mode -eq 'Update') { $arguments += '/update' }
elseif ($Mode -eq 'Updater') { $arguments += @('--updated', '--force-run') }
else {
    $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\5a97384b-a65f-520d-b1b6-0fe6fca644df'
    $fallbackExe = Join-Path $env:LOCALAPPDATA 'Programs\Minova Cinema\Minova Cinema.exe'
    $effectiveMode = if ((Test-Path -LiteralPath $uninstallKey) -or (Test-Path -LiteralPath $fallbackExe)) { 'Update' } else { 'Fresh' }
}
$effectiveMode = if ($Mode -eq 'Updater') { 'Update' } else { $effectiveMode }
$primaryLabel = if ($effectiveMode -eq 'Fresh') { 'Install Minova Cinema' } else { 'Update Minova Cinema' }
$completeLabel = if ($effectiveMode -eq 'Fresh') { 'Minova Cinema is ready' } else { "You're now up to date" }
$process = Start-Process -FilePath $installer -ArgumentList $arguments -PassThru
try {
    $handle = [IntPtr]::Zero
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        Start-Sleep -Milliseconds 100
        $process.Refresh()
        if ($process.HasExited) { throw "Installer exited early with code $($process.ExitCode)." }
        if ($process.MainWindowHandle -ne [IntPtr]::Zero) { $handle = $process.MainWindowHandle; break }
    }
    if ($handle -eq [IntPtr]::Zero) { throw 'Custom installer window was not found.' }
    $window = [Windows.Automation.AutomationElement]::FromHandle($handle)
    $name = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, $primaryLabel)
    $type = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Button)
    $button = $window.FindFirst([Windows.Automation.TreeScope]::Descendants, (New-Object Windows.Automation.AndCondition($name, $type)))
    if (-not $button) { throw "Primary action '$primaryLabel' was not found." }
    $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()

    $completed = $false
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        Start-Sleep -Milliseconds 100
        $condition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, $completeLabel)
        if ($window.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)) { $completed = $true; break }
    }
    if (-not $completed) { throw "Installer did not reach '$completeLabel'." }
    Write-Host "Custom installer $Mode-mode UI test passed (detected $effectiveMode)."
}
finally {
    $process.Refresh()
    if (-not $process.HasExited) {
        $null = $process.CloseMainWindow()
        Start-Sleep -Milliseconds 300
        $process.Refresh()
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
    }
}

