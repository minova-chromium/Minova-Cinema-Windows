param(
    [string]$AssetsDirectory = (Join-Path $PSScriptRoot '..\assets')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$assets = [System.IO.Path]::GetFullPath($AssetsDirectory)
$minovaMaster = Join-Path $assets 'minova-master-8000.png'
$cinemaMaster = Join-Path $assets 'minova-cinema-master-8000.png'

foreach ($required in @($minovaMaster, $cinemaMaster)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Missing brand master: $required"
    }
}

function Get-AlphaBounds([System.Drawing.Bitmap]$Bitmap, [int]$Step = 4) {
    $minX = $Bitmap.Width
    $minY = $Bitmap.Height
    $maxX = -1
    $maxY = -1

    for ($y = 0; $y -lt $Bitmap.Height; $y += $Step) {
        for ($x = 0; $x -lt $Bitmap.Width; $x += $Step) {
            if ($Bitmap.GetPixel($x, $y).A -eq 0) { continue }
            if ($x -lt $minX) { $minX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }

    if ($maxX -lt 0 -or $maxY -lt 0) {
        throw 'Brand master has no visible pixels.'
    }

    $padding = [Math]::Max(12, $Step * 4)
    $left = [Math]::Max(0, $minX - $padding)
    $top = [Math]::Max(0, $minY - $padding)
    $right = [Math]::Min($Bitmap.Width - 1, $maxX + $padding)
    $bottom = [Math]::Min($Bitmap.Height - 1, $maxY + $padding)
    return [System.Drawing.Rectangle]::FromLTRB($left, $top, $right + 1, $bottom + 1)
}

function Export-CroppedPng([string]$Source, [string]$Destination) {
    $sourceBitmap = [System.Drawing.Bitmap]::FromFile($Source)
    try {
        $bounds = Get-AlphaBounds $sourceBitmap 4
        $output = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($output)
            try {
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $destinationRectangle = [System.Drawing.Rectangle]::new(0, 0, $bounds.Width, $bounds.Height)
                $graphics.DrawImage($sourceBitmap, $destinationRectangle, $bounds, [System.Drawing.GraphicsUnit]::Pixel)
            } finally {
                $graphics.Dispose()
            }
            $output.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $output.Dispose()
        }
        return $bounds
    } finally {
        $sourceBitmap.Dispose()
    }
}

function Export-MinovaSymbol([string]$WordmarkPath, [string]$Destination) {
    $wordmark = [System.Drawing.Bitmap]::FromFile($WordmarkPath)
    try {
        $visible = Get-AlphaBounds $wordmark 2
        $cyanMaxX = -1
        for ($y = $visible.Top; $y -lt $visible.Bottom; $y += 2) {
            for ($x = $visible.Left; $x -lt $visible.Right; $x += 2) {
                $pixel = $wordmark.GetPixel($x, $y)
                if ($pixel.A -gt 8 -and $pixel.R -lt 80 -and $pixel.G -gt 140 -and $pixel.B -gt 160) {
                    if ($x -gt $cyanMaxX) { $cyanMaxX = $x }
                }
            }
        }
        if ($cyanMaxX -lt 0) { throw 'Could not locate the cyan accent in the Minova O mark.' }

        # The supplied O is circular and the cyan wedge sits at its upper-right edge.
        # Use the visible glyph height as the diameter and the cyan tip to isolate it
        # without carrying parts of the adjacent N or V into the application icon.
        $diameter = $visible.Height
        $right = [Math]::Min($wordmark.Width, $cyanMaxX + [int][Math]::Round($diameter * 0.05))
        $left = [Math]::Max(0, $right - $diameter)
        $glyph = [System.Drawing.Rectangle]::new($left, $visible.Top, [Math]::Min($diameter, $wordmark.Width - $left), $diameter)
        $canvasSize = 1024
        $padding = 86
        $available = $canvasSize - ($padding * 2)
        $scale = [Math]::Min($available / $glyph.Width, $available / $glyph.Height)
        $width = [int][Math]::Round($glyph.Width * $scale)
        $height = [int][Math]::Round($glyph.Height * $scale)
        $left = [int][Math]::Round(($canvasSize - $width) / 2)
        $top = [int][Math]::Round(($canvasSize - $height) / 2)

        $output = [System.Drawing.Bitmap]::new($canvasSize, $canvasSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($output)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $destinationRectangle = [System.Drawing.Rectangle]::new($left, $top, $width, $height)
                $graphics.DrawImage($wordmark, $destinationRectangle, $glyph, [System.Drawing.GraphicsUnit]::Pixel)
            } finally {
                $graphics.Dispose()
            }
            $output.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $output.Dispose()
        }
        return $glyph
    } finally {
        $wordmark.Dispose()
    }
}

function New-ResizedPngBytes([System.Drawing.Image]$Source, [int]$Size) {
    $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.DrawImage($Source, 0, 0, $Size, $Size)
        } finally {
            $graphics.Dispose()
        }
        $memory = [System.IO.MemoryStream]::new()
        try {
            $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
            return $memory.ToArray()
        } finally {
            $memory.Dispose()
        }
    } finally {
        $bitmap.Dispose()
    }
}

function Export-MultiSizeIcon([string]$SymbolPath, [string]$Destination) {
    $source = [System.Drawing.Image]::FromFile($SymbolPath)
    try {
        $sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
        $images = [System.Collections.Generic.List[byte[]]]::new()
        foreach ($size in $sizes) {
            $images.Add([byte[]](New-ResizedPngBytes $source $size))
        }
        $stream = [System.IO.File]::Open($Destination, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
        $writer = [System.IO.BinaryWriter]::new($stream)
        try {
            $writer.Write([UInt16]0)
            $writer.Write([UInt16]1)
            $writer.Write([UInt16]$images.Count)
            $offset = 6 + (16 * $images.Count)
            for ($index = 0; $index -lt $images.Count; $index++) {
                $size = $sizes[$index]
                $writer.Write([Byte]($(if ($size -eq 256) { 0 } else { $size })))
                $writer.Write([Byte]($(if ($size -eq 256) { 0 } else { $size })))
                $writer.Write([Byte]0)
                $writer.Write([Byte]0)
                $writer.Write([UInt16]1)
                $writer.Write([UInt16]32)
                $writer.Write([UInt32]$images[$index].Length)
                $writer.Write([UInt32]$offset)
                $offset += $images[$index].Length
            }
            foreach ($image in $images) { $writer.Write($image) }
        } finally {
            $writer.Dispose()
            $stream.Dispose()
        }
    } finally {
        $source.Dispose()
    }
}

$wordmarkPath = Join-Path $assets 'minova-wordmark.png'
$cinemaWordmarkPath = Join-Path $assets 'minova-cinema-wordmark.png'
$symbolPath = Join-Path $assets 'minova-symbol-color.png'
$iconPath = Join-Path $assets 'minova-cinema.ico'

$wordmarkBounds = Export-CroppedPng $minovaMaster $wordmarkPath
$cinemaBounds = Export-CroppedPng $cinemaMaster $cinemaWordmarkPath
$symbolBounds = Export-MinovaSymbol $wordmarkPath $symbolPath
Export-MultiSizeIcon $symbolPath $iconPath

Write-Host "Generated Minova wordmark $($wordmarkBounds.Width)x$($wordmarkBounds.Height)"
Write-Host "Generated Minova Cinema wordmark $($cinemaBounds.Width)x$($cinemaBounds.Height)"
Write-Host "Generated Minova symbol from glyph $($symbolBounds.Width)x$($symbolBounds.Height)"
Write-Host "Generated multi-size Windows icon at $iconPath"
