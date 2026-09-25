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
$assetUrl = "https://github.com/zhongfly/mpv-winbuild/releases/download/2026-09-20-e76a35ec95/$assetName"
$downloadRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'minova-cinema-libmpv'
$archive = Join-Path $downloadRoot $assetName
$extractRoot = Join-Path $downloadRoot 'extract'
$destinationDll = Join-Path $Destination 'libmpv-2.dll'

New-Item -ItemType Directory -Force -Path $downloadRoot, $extractRoot, $Destination | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -UseBasicParsing $assetUrl -OutFile $archive
}

$sha256 = [System.Security.Cryptography.SHA256]::Create()
$stream = [System.IO.File]::OpenRead($archive)
try {
    $actualSha256 = ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '')
} finally {
    $stream.Dispose()
    $sha256.Dispose()
}
if ($actualSha256 -ne $expectedSha256) {
    throw "libmpv archive checksum mismatch. Expected $expectedSha256 but received $actualSha256."
}

if (-not (Test-Path -LiteralPath (Join-Path $extractRoot 'libmpv-2.dll'))) {
    tar -xf $archive -C $extractRoot
}
Copy-Item -LiteralPath (Join-Path $extractRoot 'libmpv-2.dll') -Destination $destinationDll -Force
Write-Host "Pinned libmpv runtime is ready at $destinationDll"
