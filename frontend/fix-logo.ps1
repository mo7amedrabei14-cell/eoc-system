Add-Type -AssemblyName System.IO.Compression

function Read-UInt32BE($bytes, $offset) {
    return ($bytes[$offset] -shl 24) -bor ($bytes[$offset+1] -shl 16) -bor ($bytes[$offset+2] -shl 8) -bor $bytes[$offset+3]
}

function Write-UInt32BE($val) {
    [byte[]]@(
        [math]::Floor($val / 16777216) -band 255,
        [math]::Floor($val / 65536) -band 255,
        [math]::Floor($val / 256) -band 255,
        $val -band 255
    )
}

# Initialize CRC table
$crcTable = New-Object int[] 256
for ($n = 0; $n -lt 256; $n++) {
    $v = $n
    for ($k = 0; $k -lt 8; $k++) {
        if ($v -band 1) { $v = 0xedb88320 -bxor ($v -shr 1) } else { $v = $v -shr 1 }
    }
    $crcTable[$n] = $v
}

function Get-CRC32([byte[]]$data) {
    [uint32]$c = 0xFFFFFFFF
    foreach ($b in $data) {
        $c = $crcTable[(($c -bxor $b) -band 0xFF)] -bxor ($c -shr 8)
    }
    return ($c -bxor 0xFFFFFFFF)
}

function Paeth($a, $b, $c) {
    $p = $a + $b - $c
    $pa = [math]::Abs($p - $a)
    $pb = [math]::Abs($p - $b)
    $pc = [math]::Abs($p - $c)
    if ($pa -le $pb -and $pa -le $pc) { return $a }
    elseif ($pb -le $pc) { return $b }
    else { return $c }
}

$pngPath = "C:\Users\mo7am\OneDrive\Work\EOC System\frontend\public\Egyptian_Red_Crescent.png"
$buf = [System.IO.File]::ReadAllBytes($pngPath)
Write-Host "Read $($buf.Length) bytes"

# Parse chunks
$off = 8
$width = 0; $height = 0; $colorType = 0
$idatData = @()
$metaChunks = @()

while ($off -lt $buf.Length) {
    $len = Read-UInt32BE $buf $off
    $type = [System.Text.Encoding]::ASCII.GetString($buf, $off + 4, 4)
    $data = $buf[($off+8)..($off+8+$len-1)]
    if ($type -eq "IHDR") {
        $width = Read-UInt32BE $data 0
        $height = Read-UInt32BE $data 4
        $colorType = $data[9]
    } elseif ($type -eq "IDAT") {
        $idatData += $data
    } elseif ($type -ne "IEND") {
        $metaChunks += ,@{ Type = $type; Data = $data }
    }
    if ($type -eq "IEND") { break }
    $off += 12 + $len
}
Write-Host "Canvas: ${width}x${height} colorType=$colorType"

# Decompress IDAT
$compressed = [byte[]]$idatData
$ms = New-Object System.IO.MemoryStream(,$compressed)
$ds = New-Object System.IO.Compression.DeflateStream($ms, [System.IO.Compression.CompressionMode]::Decompress)
$decompressed = New-Object System.IO.MemoryStream
$ds.CopyTo($decompressed)
$raw = $decompressed.ToArray()
Write-Host "Decompressed: $($raw.Length) bytes"

# Unfilter
$bpp = 4
$stride = $width * $bpp + 1
$npixels = $width * $height * $bpp
$pixels = New-Object byte[] $npixels
$prevRow = New-Object byte[] ($width * $bpp)

for ($y = 0; $y -lt $height; $y++) {
    $filter = $raw[$y * $stride]
    $row = $raw[($y*$stride+1)..(($y+1)*$stride-1)]
    $cur = New-Object byte[] ($width * $bpp)
    for ($x = 0; $x -lt $width; $x++) {
        for ($i = 0; $i -lt $bpp; $i++) {
            $idx = $x * $bpp + $i
            $left = if ($x -gt 0) { $cur[$idx - $bpp] } else { 0 }
            $up = $prevRow[$idx]
            $upLeft = if ($x -gt 0) { $prevRow[$idx - $bpp] } else { 0 }
            $rv = $row[$idx]
            switch ($filter) {
                0 { $v = $rv }
                1 { $v = ($rv + $left) -band 0xFF }
                2 { $v = ($rv + $up) -band 0xFF }
                3 { $v = ($rv + (($left + $up) -shr 1)) -band 0xFF }
                4 { $v = ($rv + (Paeth $left $up $upLeft)) -band 0xFF }
            }
            $cur[$idx] = $v
        }
    }
    [Array]::Copy($cur, 0, $pixels, $y * $width * $bpp, $width * $bpp)
    $prevRow = $cur
}

# Find bbox at alpha > 40
$minX = 9999; $maxX = -1
for ($y = 0; $y -lt $height; $y++) {
    for ($x = 0; $x -lt $width; $x++) {
        $a = $pixels[($y*$width+$x)*$bpp + 3]
        if ($a -gt 40) {
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
        }
    }
}
$oldCx = ($minX + $maxX) / 2.0
$canvasCx = ($width - 1) / 2.0
$shift = [math]::Round($oldCx - $canvasCx)
Write-Host "Old bbox x: $minX-$maxX center=$($oldCx.ToString('F1')) shift=${shift}px"

# Shift LEFT
$newPixels = New-Object byte[] $npixels
for ($y = 0; $y -lt $height; $y++) {
    for ($x = 0; $x -lt $width; $x++) {
        $srcX = $x + $shift
        if ($srcX -ge 0 -and $srcX -lt $width) {
            $srcIdx = ($y*$width+$srcX)*$bpp
            $dstIdx = ($y*$width+$x)*$bpp
            [Array]::Copy($pixels, $srcIdx, $newPixels, $dstIdx, $bpp)
        }
    }
}

# Verify new bbox
$newMinX = 9999; $newMaxX = -1
for ($y = 0; $y -lt $height; $y++) {
    for ($x = 0; $x -lt $width; $x++) {
        $a = $newPixels[($y*$width+$x)*$bpp + 3]
        if ($a -gt 40) {
            if ($x -lt $newMinX) { $newMinX = $x }
            if ($x -gt $newMaxX) { $newMaxX = $x }
        }
    }
}
Write-Host "New bbox x: $newMinX-$newMaxX center=$((($newMinX+$newMaxX)/2.0).ToString('F1')) margin L=$newMinX R=$($width-1-$newMaxX)"

# Rebuild: filter=0 rows then deflate
$newStride = $width * $bpp + 1
$rawData = New-Object byte[] ($height * $newStride)
for ($y = 0; $y -lt $height; $y++) {
    $rawData[$y * $newStride] = 0
    [Array]::Copy($newPixels, $y*$width*$bpp, $rawData, $y*$newStride+1, $width*$bpp)
}

$ms2 = New-Object System.IO.MemoryStream
$ds2 = New-Object System.IO.Compression.DeflateStream($ms2, [System.IO.Compression.CompressionLevel]::Optimal, $true)
$ds2.Write($rawData, 0, $rawData.Length)
$ds2.Flush()
$ds2.Dispose()
$compressedOut = $ms2.ToArray()
Write-Host "Compressed: $($compressedOut.Length) bytes"

# Build PNG chunks
$sig = [byte[]]@(137,80,78,71,13,10,26,10)

# IHDR
$ihdrData = New-Object byte[] 13
[Array]::Copy((Write-UInt32BE $width), 0, $ihdrData, 0, 4)
[Array]::Copy((Write-UInt32BE $height), 0, $ihdrData, 4, 4)
$ihdrData[8] = 8; $ihdrData[9] = $colorType

function Make-Chunk([string]$type, [byte[]]$data) {
    $typeBytes = [System.Text.Encoding]::ASCII.GetBytes($type)
    $lenBytes = Write-UInt32BE $data.Length
    $td = New-Object byte[] ($typeBytes.Length + $data.Length)
    [Array]::Copy($typeBytes, 0, $td, 0, $typeBytes.Length)
    [Array]::Copy($data, 0, $td, $typeBytes.Length, $data.Length)
    $crcBytes = Write-UInt32BE (Get-CRC32 $td)
    $chunk = New-Object byte[] (12 + $data.Length)
    [Array]::Copy($lenBytes, 0, $chunk, 0, 4)
    [Array]::Copy($td, 0, $chunk, 4, $td.Length)
    [Array]::Copy($crcBytes, 0, $chunk, 4+$td.Length, 4)
    return $chunk
}

$ihdrChunk = Make-Chunk "IHDR" $ihdrData
$idatChunk = Make-Chunk "IDAT" $compressedOut
$iendChunk = Make-Chunk "IEND" @()

# Assemble
$parts = @($sig, $ihdrChunk)
foreach ($mc in $metaChunks) { $parts += ,(Make-Chunk $mc.Type $mc.Data) }
$parts += $idatChunk, $iendChunk

$ms3 = New-Object System.IO.MemoryStream
foreach ($p in $parts) { $ms3.Write($p, 0, $p.Length) }
$outBytes = $ms3.ToArray()

[System.IO.File]::WriteAllBytes($pngPath, $outBytes)
Write-Host "Wrote $($outBytes.Length) bytes (was $($buf.Length))"
Write-Host "Done - crescent centered!"
