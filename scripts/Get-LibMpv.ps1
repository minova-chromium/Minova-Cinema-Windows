[CmdletBinding()]
param(
    [string]$Destination
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Destination)) {
    $Destination = Join-Path $PSScriptRoot '..\vendor\native-host'
}
$assetName = 'mpv-dev-x86_64-20260920-git-e76a35ec95.7z'
$expectedSha256 = '5B4DE3EBB3717BBA282668BBA5A00E2435B42EB7E51381045A61665B308EE90A'
$expectedDllSha256 = 'B9BE86FE134546D5897D83AC21ABDD12FF38F7C373D517CB24A769FB5415839D'
$assetUrl = "https://github.com/zhongfly/mpv-winbuild/releases/download/2026-09-20-e76a35ec95/$assetName"
$downloadRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'minova-cinema-libmpv'
$archive = Join-Path $downloadRoot $assetName
$extractRoot = Join-Path $downloadRoot 'extract'
$destinationDll = Join-Path $Destination 'libmpv-2.dll'

function Get-Sha256([string]$Path) {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '')
    } finally {
        $stream.Dispose()
        $sha256.Dispose()
    }
}

New-Item -ItemType Directory -Force -Path $downloadRoot, $extractRoot, $Destination | Out-Null
if (Test-Path -LiteralPath $destinationDll) {
    $installedDllSha256 = Get-Sha256 $destinationDll
    if ($installedDllSha256 -eq $expectedDllSha256) {
        Write-Host "Verified pinned libmpv runtime at $destinationDll"
        return
    }
}

if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -UseBasicParsing $assetUrl -OutFile $archive
}

$actualSha256 = Get-Sha256 $archive
if ($actualSha256 -ne $expectedSha256) {
    throw "libmpv archive checksum mismatch. Expected $expectedSha256 but received $actualSha256."
}

if (-not (Test-Path -LiteralPath (Join-Path $extractRoot 'libmpv-2.dll'))) {
    tar -xf $archive -C $extractRoot
}
Copy-Item -LiteralPath (Join-Path $extractRoot 'libmpv-2.dll') -Destination $destinationDll -Force
$installedDllSha256 = Get-Sha256 $destinationDll
if ($installedDllSha256 -ne $expectedDllSha256) {
    throw "Extracted libmpv runtime checksum mismatch. Expected $expectedDllSha256 but received $installedDllSha256."
}
Write-Host "Pinned libmpv runtime is ready at $destinationDll"
