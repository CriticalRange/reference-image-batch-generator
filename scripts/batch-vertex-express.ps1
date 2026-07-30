# Batch generate via local API: Vertex Express (authMode=api_key), count=2, first 3 refs.
param(
  [int]$MaxJobs = 999,
  [int]$SleepSec = 25,
  [int]$RequestTimeout = 360,
  [int]$FromIndex = 0,
  [string]$ApiBase = 'http://localhost:3000',
  [string]$UrunlerRoot = "G:\Ortak Drive'lar\Ceneyra\ÜRÜNLER\Ceneyra\KA - Konsol",
  [string]$Model = 'vertex/gemini-2.5-flash-image',
  [string]$AuthMode = 'api_key',
  [int]$Count = 2
)

$ErrorActionPreference = 'Continue'
$rootDir = 'C:\Users\zeytu\Documents\reference-image-batch-generator'
$logPath = Join-Path $rootDir '_batch_express.log'
$statePath = Join-Path $rootDir '_batch_express_state.json'
$resultsPath = Join-Path $rootDir '_batch_express_results.json'

function Log([string]$m) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  Add-Content -Path $logPath -Value $line -Encoding utf8
  Write-Host $line
}

$prompt = 'Analyze the furniture, determine its type and style. Select the most common room in Turkey where this furniture is typically used. Place the product in that environment at a realistic scale. Add a few compatible decorative objects commonly used with this furniture in Turkey. Clean, spacious, modern contemporary Turkish home. Product is the main focal point. Photorealistic sales-oriented e-commerce scene. Do NOT modify the furniture in any way. Design, color, proportions, and details must stay exactly the same. Only create the background and surrounding environment.'

function Get-Mime([string]$path) {
  $ext = [IO.Path]::GetExtension($path).ToLowerInvariant()
  if ($ext -eq '.png') { return 'image/png' }
  if ($ext -eq '.webp') { return 'image/webp' }
  return 'image/jpeg'
}

function Get-PendingJobs {
  $jobs = @()
  $products = @(Get-ChildItem -LiteralPath $UrunlerRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name.TrimEnd().EndsWith('-') } |
    Sort-Object Name)

  foreach ($product in $products) {
    $subdirs = @(Get-ChildItem -LiteralPath $product.FullName -Directory -ErrorAction SilentlyContinue)
    if ($subdirs.Count -gt 0) {
      $dirs = $subdirs
    } else {
      $dirs = @($product)
    }

    foreach ($dir in $dirs) {
      $imgs = @(Get-ChildItem -LiteralPath $dir.FullName -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -match '\.(jpg|jpeg|png|webp)$' -and $_.Name -notmatch '^GEN_' } |
        Sort-Object Name)
      if ($imgs.Count -lt 3) { continue }

      $gens = @(Get-ChildItem -LiteralPath $dir.FullName -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like 'GEN_EXPRESS_*' })
      if ($gens.Count -ge $Count) { continue }

      $label = $dir.Name
      if ($dir.FullName -eq $product.FullName) { $label = 'root' }

      $refPaths = @()
      foreach ($img in ($imgs | Select-Object -First 3)) {
        $refPaths += $img.FullName
      }

      $jobs += [PSCustomObject]@{
        Product  = [string]$product.Name
        Label    = [string]$label
        Path     = [string]$dir.FullName
        RefPaths = $refPaths
      }
    }
  }
  return $jobs
}

function Invoke-GenerateJob($job) {
  $refs = @()
  foreach ($p in $job.RefPaths) {
    if (-not (Test-Path -LiteralPath $p)) {
      return [PSCustomObject]@{ Ok = $false; Saved = 0; Failed = $Count; Sec = 0; Quota = $false; Error = "missing ref: $p" }
    }
    $refs += @{
      base64   = [Convert]::ToBase64String([IO.File]::ReadAllBytes($p))
      mimeType = Get-Mime $p
    }
  }

  $bodyObj = @{
    prompt          = $prompt
    count           = $Count
    model           = $Model
    authMode        = $AuthMode
    aspectRatio     = '2:3'
    referenceImages = $refs
  }
  $json = $bodyObj | ConvertTo-Json -Depth 6 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $uri = $ApiBase.TrimEnd('/') + '/api/generate'
    $resp = Invoke-WebRequest -Uri $uri -Method POST `
      -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec $RequestTimeout -UseBasicParsing
    $sw.Stop()
    $j = $resp.Content | ConvertFrom-Json
    $saved = 0
    $i = 0
    foreach ($r in @($j.results.results)) {
      $i++
      if (-not $r.imageBase64) { continue }
      $ext = 'jpg'
      if ($r.mimeType -match 'png') { $ext = 'png' }
      $name = 'GEN_EXPRESS_{0}.{1}' -f $i, $ext
      $out = Join-Path -Path $job.Path -ChildPath $name
      [IO.File]::WriteAllBytes($out, [Convert]::FromBase64String($r.imageBase64))
      $saved++
      Log ('  saved {0} ({1} bytes)' -f $name, (Get-Item -LiteralPath $out).Length)
    }
    $fail = 0
    if ($j.results) { $fail = [int]$j.results.failedCount }
    $err = $null
    if ($j.error) { $err = [string]$j.error }
    return [PSCustomObject]@{
      Ok     = ($saved -gt 0)
      Saved  = $saved
      Failed = $fail
      Sec    = [math]::Round($sw.Elapsed.TotalSeconds, 1)
      Quota  = $false
      Error  = $err
    }
  } catch {
    $sw.Stop()
    $msg = $_.Exception.Message
    $detail = ''
    if ($_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }
    try {
      $rs = $_.Exception.Response.GetResponseStream()
      if ($rs) { $detail = (New-Object IO.StreamReader($rs)).ReadToEnd() }
    } catch {}
    $full = ($msg + ' ' + $detail).Trim()
    $quota = $false
    if ($full -match '429|quota|exhausted|RESOURCE_EXHAUSTED') { $quota = $true }
    $clip = $full
    if ($clip.Length -gt 800) { $clip = $clip.Substring(0, 800) }
    return [PSCustomObject]@{
      Ok     = $false
      Saved  = 0
      Failed = $Count
      Sec    = [math]::Round($sw.Elapsed.TotalSeconds, 1)
      Quota  = $quota
      Error  = $clip
    }
  }
}

try {
  $null = Invoke-WebRequest -Uri ($ApiBase.TrimEnd('/') + '/api/models') -UseBasicParsing -TimeoutSec 15
} catch {
  Log ('API not reachable at {0} - abort' -f $ApiBase)
  exit 1
}

$all = @(Get-PendingJobs)
Log ('Pending jobs: {0} (from index {1}, max {2})' -f $all.Count, $FromIndex, $MaxJobs)
if ($all.Count -eq 0) {
  Log 'Nothing to do.'
  exit 0
}

# show first few
for ($s = 0; $s -lt [Math]::Min(3, $all.Count); $s++) {
  Log ('  queue[{0}]: {1} / {2}' -f $s, $all[$s].Product, $all[$s].Label)
}

$slice = @($all | Select-Object -Skip $FromIndex -First $MaxJobs)
$okCount = 0
$failCount = 0
$imageCount = 0
$results = @()

$idx = 0
foreach ($job in $slice) {
  $idx++
  if (-not $job.Path) {
    Log ('--- [{0}/{1}] SKIP null path ---' -f $idx, $slice.Count)
    $failCount++
    continue
  }
  Log ('--- [{0}/{1}] {2} / {3} ---' -f $idx, $slice.Count, $job.Product, $job.Label)
  $attempt = 0
  $done = $false
  while ((-not $done) -and ($attempt -lt 3)) {
    $attempt++
    $res = Invoke-GenerateJob $job
    if ($res.Ok) {
      $okCount++
      $imageCount += $res.Saved
      Log ('  OK saved={0} fail={1} sec={2}' -f $res.Saved, $res.Failed, $res.Sec)
      $results += [PSCustomObject]@{
        product = $job.Product
        label   = $job.Label
        path    = $job.Path
        status  = 'ok'
        saved   = $res.Saved
        sec     = $res.Sec
      }
      $done = $true
    } elseif ($res.Quota) {
      Log ('  QUOTA/429 attempt {0}: {1}' -f $attempt, $res.Error)
      if ($attempt -lt 3) {
        $wait = 90 * $attempt
        Log ('  waiting {0}s then retry...' -f $wait)
        Start-Sleep -Seconds $wait
      } else {
        $failCount++
        $results += [PSCustomObject]@{
          product = $job.Product
          label   = $job.Label
          path    = $job.Path
          status  = 'quota'
          error   = $res.Error
        }
        Log '  Stopping batch due to persistent quota.'
        @{ ok = $okCount; fail = $failCount; images = $imageCount; last = ($job.Product + '/' + $job.Label) } |
          ConvertTo-Json | Set-Content $statePath -Encoding utf8
        $results | ConvertTo-Json -Depth 4 | Set-Content $resultsPath -Encoding utf8
        exit 2
      }
    } else {
      $failCount++
      Log ('  FAIL sec={0}: {1}' -f $res.Sec, $res.Error)
      $results += [PSCustomObject]@{
        product = $job.Product
        label   = $job.Label
        path    = $job.Path
        status  = 'fail'
        error   = $res.Error
      }
      $done = $true
    }
  }

  if ($idx -lt $slice.Count) {
    Log ('  sleep {0}s' -f $SleepSec)
    Start-Sleep -Seconds $SleepSec
  }

  @{
    ok      = $okCount
    fail    = $failCount
    images  = $imageCount
    updated = (Get-Date).ToString('o')
    last    = ($job.Product + '/' + $job.Label)
  } | ConvertTo-Json | Set-Content $statePath -Encoding utf8
}

$results | ConvertTo-Json -Depth 4 | Set-Content $resultsPath -Encoding utf8
Log ('DONE ok={0} fail={1} images={2}' -f $okCount, $failCount, $imageCount)
exit 0
