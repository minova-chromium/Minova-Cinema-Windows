[CmdletBinding()]
param(
    [string]$Version,
    [string]$CoreSetup,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-Sha256([string]$Path) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $stream = [IO.File]::OpenRead($Path)
        try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
        finally { $stream.Dispose() }
    }
    finally { $sha.Dispose() }
}

$root = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($Version)) { $Version = [string]$package.version }
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') {
    throw 'Version must use semantic versioning, for example 1.0.7.'
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = Join-Path $root 'dist' }
$output = [IO.Path]::GetFullPath($OutputDirectory)
$distRoot = [IO.Path]::GetFullPath((Join-Path $root 'dist'))
if (-not $output.StartsWith($distRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Installer output must remain inside the desktop dist directory.'
}
[IO.Directory]::CreateDirectory($output) | Out-Null

if ([string]::IsNullOrWhiteSpace($CoreSetup)) {
    $CoreSetup = Join-Path $output "Minova-Cinema-Desktop-$Version-Update.exe"
}
$core = (Resolve-Path -LiteralPath $CoreSetup).Path
$coreFile = Get-Item -LiteralPath $core
$coreHash = Get-Sha256 $core

$build = Join-Path $output ".cinema-bootstrapper-$Version"
if (Test-Path -LiteralPath $build) {
    $resolvedBuild = (Resolve-Path -LiteralPath $build).Path
    if (-not $resolvedBuild.StartsWith($distRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to clean a bootstrapper directory outside dist.'
    }
    Remove-Item -LiteralPath $resolvedBuild -Recurse -Force
}
[IO.Directory]::CreateDirectory($build) | Out-Null

$metadata = Join-Path $build 'bootstrapper.properties'
$assemblyInfo = Join-Path $build 'AssemblyInfo.cs'
$logoPng = Join-Path $build 'minova-cinema-logo.png'
$symbolPng = Join-Path $build 'minova-symbol.png'
$wrapperIcon = Join-Path $build 'minova-cinema.ico'
$setup = Join-Path $output "Minova-Cinema-Desktop-$Version-Setup.exe"
if ([IO.Path]::GetFullPath($core) -eq [IO.Path]::GetFullPath($setup)) {
    throw 'The updater core and custom Setup output must use different paths.'
}
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$frameworkDirectory = Split-Path -Parent $compiler
$wpfDirectory = Join-Path $frameworkDirectory 'WPF'
$source = Join-Path $root 'installer\MinovaCinemaBootstrapper.cs'
$sourceIcon = Join-Path $root 'assets\minova-cinema.ico'
$sourceLogo = Join-Path $root 'assets\minova-cinema-wordmark.png'
$sourceSymbol = Join-Path $root 'assets\minova-symbol-color.png'

foreach ($required in @($compiler, $source, $sourceIcon, $sourceLogo, $sourceSymbol)) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required installer file is missing: $required" }
}

@(
    "version=$Version"
    "setupFileName=$($coreFile.Name)"
    "setupBytes=$($coreFile.Length)"
    "setupSha256=$coreHash"
) | Set-Content -LiteralPath $metadata -Encoding ASCII

$numericVersion = ($Version -split '-', 2)[0]
$versionParts = @($numericVersion.Split('.') | ForEach-Object { [int]$_ })
while ($versionParts.Count -lt 4) { $versionParts += 0 }
$assemblyVersion = ($versionParts[0..3] -join '.')
@"
using System.Reflection;
[assembly: AssemblyTitle("Minova Cinema Setup")]
[assembly: AssemblyDescription("Installs or updates Minova Cinema for Windows")]
[assembly: AssemblyCompany("Minova")]
[assembly: AssemblyProduct("Minova Cinema")]
[assembly: AssemblyCopyright("Copyright Minova contributors")]
[assembly: AssemblyVersion("$assemblyVersion")]
[assembly: AssemblyFileVersion("$assemblyVersion")]
[assembly: AssemblyInformationalVersion("$Version")]
"@ | Set-Content -LiteralPath $assemblyInfo -Encoding UTF8

Copy-Item -LiteralPath $sourceLogo -Destination $logoPng -Force
Copy-Item -LiteralPath $sourceSymbol -Destination $symbolPng -Force
Copy-Item -LiteralPath $sourceIcon -Destination $wrapperIcon -Force

$references = @(
    "/reference:$(Join-Path $frameworkDirectory 'System.dll')"
    "/reference:$(Join-Path $frameworkDirectory 'System.Core.dll')"
    "/reference:$(Join-Path $frameworkDirectory 'System.Drawing.dll')"
    "/reference:$(Join-Path $frameworkDirectory 'System.Windows.Forms.dll')"
    "/reference:$(Join-Path $wpfDirectory 'WindowsBase.dll')"
    "/reference:$(Join-Path $wpfDirectory 'PresentationCore.dll')"
    "/reference:$(Join-Path $wpfDirectory 'PresentationFramework.dll')"
    "/reference:$(Join-Path $frameworkDirectory 'System.Xaml.dll')"
)
$arguments = @(
    '/nologo'
    '/target:winexe'
    '/platform:anycpu'
    '/optimize+'
    '/warn:4'
    "/win32icon:$wrapperIcon"
    "/resource:$logoPng,minova.cinema.logo"
    "/resource:$symbolPng,minova.cinema.symbol"
    "/resource:$metadata,minova.cinema.bootstrapper"
    "/resource:$core,minova.cinema.setup"
    "/out:$setup"
) + $references + @($source, $assemblyInfo)

if (Test-Path -LiteralPath $setup) { Remove-Item -LiteralPath $setup -Force }
Write-Host "Compiling the custom Minova Cinema $Version installer..."
& $compiler @arguments
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $setup)) {
    throw 'The custom Minova Cinema installer failed to compile.'
}

$setupHash = Get-Sha256 $setup
try {
    $signature = Get-AuthenticodeSignature -LiteralPath $setup
    if ($signature.Status -eq [Management.Automation.SignatureStatus]::NotSigned) {
        Write-Warning 'The custom installer is not Authenticode signed. Code signing is recommended before a public release.'
    }
}
catch {
    Write-Warning 'Authenticode status could not be checked in this PowerShell host.'
}
Remove-Item -LiteralPath $build -Recurse -Force
Write-Host 'Custom installer ready:'
Write-Host "  $setup"
Write-Host "  SHA-256 $setupHash"

