param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\assets')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$outputRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputRoot) | Out-Null
$wordmarkPath = Join-Path $outputRoot 'minova-cinema-wordmark.png'

function New-MinovaCanvas([int]$Width, [int]$Height) {
    $bitmap = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $area = [System.Drawing.Rectangle]::new(0, 0, $Width, $Height)
    $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        $area,
        [System.Drawing.Color]::FromArgb(8, 12, 18),
        [System.Drawing.Color]::FromArgb(11, 26, 36),
        62.0
    )
    $graphics.FillRectangle($gradient, $area)
    $gradient.Dispose()
    return @{ Bitmap = $bitmap; Graphics = $graphics }
}

$wordmark = [System.Drawing.Image]::FromFile($wordmarkPath)
try {
    $sidebar = New-MinovaCanvas 164 314
    try {
        $g = $sidebar.Graphics
        $glow = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(38, 22, 216, 228))
        $g.FillEllipse($glow, -72, 128, 250, 250)
        $glow.Dispose()
        $logoWidth = 138
        $logoHeight = [int][Math]::Round($wordmark.Height * ($logoWidth / $wordmark.Width))
        $g.DrawImage($wordmark, 13, 28, $logoWidth, $logoHeight)
        $accent = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(22, 216, 228))
        $g.FillRectangle($accent, 14, 222, 3, 48)
        $accent.Dispose()
        $titleFont = [System.Drawing.Font]::new('Segoe UI Semibold', 11, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $smallFont = [System.Drawing.Font]::new('Segoe UI', 9, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
        $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(247, 250, 252))
        $muted = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(167, 181, 197))
        $g.DrawString("YOUR LIBRARY.`nYOUR SCREEN.", $titleFont, $white, 25, 220)
        $g.DrawString('MINOVA CINEMA FOR WINDOWS', $smallFont, $muted, 14, 286)
        $titleFont.Dispose(); $smallFont.Dispose(); $white.Dispose(); $muted.Dispose()
        $sidebar.Bitmap.Save((Join-Path $outputRoot 'installer-sidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
    } finally {
        $sidebar.Graphics.Dispose(); $sidebar.Bitmap.Dispose()
    }

    $header = New-MinovaCanvas 150 57
    try {
        $g = $header.Graphics
        $logoWidth = 126
        $logoHeight = [int][Math]::Round($wordmark.Height * ($logoWidth / $wordmark.Width))
        $g.DrawImage($wordmark, 12, [int][Math]::Round((57 - $logoHeight) / 2), $logoWidth, $logoHeight)
        $accent = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(22, 216, 228))
        $g.FillRectangle($accent, 0, 55, 150, 2)
        $accent.Dispose()
        $header.Bitmap.Save((Join-Path $outputRoot 'installer-header.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
    } finally {
        $header.Graphics.Dispose(); $header.Bitmap.Dispose()
    }
} finally {
    $wordmark.Dispose()
}

Write-Host "Generated Minova installer artwork in $outputRoot"
