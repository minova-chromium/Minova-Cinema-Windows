$ErrorActionPreference = 'Stop'

$desktopRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $desktopRoot 'native-host\LibMpvHost.cs'
$outputDirectory = Join-Path $desktopRoot 'vendor\native-host'
$output = Join-Path $outputDirectory 'MinovaCinema.LibMpvHost.exe'
$libMpv = Join-Path $outputDirectory 'libmpv-2.dll'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not (Test-Path -LiteralPath $libMpv)) {
    & (Join-Path $PSScriptRoot 'Get-LibMpv.ps1') -Destination $outputDirectory
}
if (-not (Test-Path -LiteralPath $compiler)) {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $compiler)) {
    throw 'The Windows C# compiler was not found.'
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
& $compiler /nologo /target:exe /optimize+ /reference:System.Drawing.dll "/out:$output" $source
if ($LASTEXITCODE -ne 0) { throw "Embedded libmpv host compilation failed with exit code $LASTEXITCODE." }

$built = Get-Item -LiteralPath $output
Write-Host "Built $($built.FullName) ($($built.Length) bytes)"
