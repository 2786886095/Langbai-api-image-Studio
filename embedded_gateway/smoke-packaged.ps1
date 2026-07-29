param(
  [Parameter(Mandatory = $true)]
  [string]$Executable
)

$ErrorActionPreference = "Stop"
$exe = [System.IO.Path]::GetFullPath($Executable)
if (-not (Test-Path -LiteralPath $exe)) {
  throw "Gateway executable was not found: $exe"
}

$listener = [System.Net.Sockets.TcpListener]::new(
  [System.Net.IPAddress]::Loopback,
  0
)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

$apiKey = -join ((1..64) | ForEach-Object { "0123456789abcdef"[(Get-Random -Maximum 16)] })
$bridgeSecret = -join ((1..64) | ForEach-Object { "0123456789abcdef"[(Get-Random -Maximum 16)] })
$dataDir = Join-Path $env:TEMP "langbai-gateway-smoke-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$smokeImage = Join-Path $dataDir "images\smoke\route-check.png"
New-Item -ItemType Directory -Force -Path (Split-Path $smokeImage) | Out-Null
[System.IO.File]::WriteAllBytes(
  $smokeImage,
  [byte[]](137, 80, 78, 71, 13, 10, 26, 10, 76, 65, 78, 71, 66, 65, 73, 45, 82, 79, 85, 84, 69)
)

$oldEnvironment = @{}
$gatewayEnvironment = @{
  CHATGPT2API_AUTH_KEY = $apiKey
  LANGBAI_WEB_BRIDGE_SECRET = $bridgeSecret
  CHATGPT2API_DATA_DIR = $dataDir
  CHATGPT2API_CONFIG_FILE = (Join-Path $dataDir "config.json")
  LANGBAI_GATEWAY_PORT = "$port"
  LANGBAI_PARENT_PID = "$PID"
  PYTHONUTF8 = "1"
}
foreach ($entry in $gatewayEnvironment.GetEnumerator()) {
  $oldEnvironment[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, "Process")
  [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
}

$process = $null
try {
  $process = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -WindowStyle Hidden -PassThru
  $base = "http://127.0.0.1:$port"
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  $health = $null
  while ([DateTime]::UtcNow -lt $deadline -and -not $process.HasExited) {
    try {
      $health = Invoke-RestMethod "$base/healthz" -TimeoutSec 2
      if ($health.status -eq "ok") { break }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if ($process.HasExited) {
    throw "Gateway exited during smoke test with code $($process.ExitCode)."
  }
  if ($health.status -ne "ok" -or $health.service -ne "langbai-chatgpt-web-image-gateway") {
    throw "Gateway health response was invalid."
  }

  $downloadedImage = Join-Path $dataDir "downloaded-route-check.png"
  Invoke-WebRequest "$base/images/smoke/route-check.png" -OutFile $downloadedImage -TimeoutSec 5
  $sourceHash = (Get-FileHash -LiteralPath $smokeImage -Algorithm SHA256).Hash
  $downloadHash = (Get-FileHash -LiteralPath $downloadedImage -Algorithm SHA256).Hash
  if ($sourceHash -ne $downloadHash) {
    throw "Gateway image route did not return the persisted image bytes."
  }

  $missingImageStatus = 0
  try {
    Invoke-WebRequest "$base/images/smoke/missing.png" -TimeoutSec 5 | Out-Null
    $missingImageStatus = 200
  } catch {
    $missingImageStatus = [int]$_.Exception.Response.StatusCode
  }
  if ($missingImageStatus -ne 404) {
    throw "Missing gateway image must return HTTP 404; got $missingImageStatus."
  }

  $headers = @{ Authorization = "Bearer $apiKey" }
  $capabilities = Invoke-RestMethod "$base/v1/image-capabilities" -Headers $headers -TimeoutSec 5
  if (-not $capabilities.image_only -or -not $capabilities.async_tasks -or $capabilities.models -notcontains "gpt-image-2") {
    throw "Gateway image capabilities were invalid."
  }

  $payloadJson = @{
    exp = [DateTimeOffset]::UtcNow.AddMinutes(10).ToUnixTimeSeconds()
    sub = "smoke-user"
  } | ConvertTo-Json -Compress
  $payloadSegment = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payloadJson)).TrimEnd("=").Replace("+", "-").Replace("/", "_")
  $sessionToken = "eyJhbGciOiJub25lIn0.$payloadSegment.signature"
  $sessionHeaders = @{
    "X-Langbai-Bridge-Secret" = $bridgeSecret
    "Content-Type" = "application/json"
  }
  $sessionBody = @{
    access_token = $sessionToken
    account_id = "11111111-1111-4111-8111-111111111111"
  } | ConvertTo-Json -Compress
  $session = Invoke-RestMethod "$base/session-bridge/v1/token" -Method Post -Headers $sessionHeaders -Body $sessionBody -TimeoutSec 5
  if ($session.status -ne "ok" -or -not $session.session.available) {
    throw "Gateway session bridge did not accept the isolated smoke account."
  }

  $textStatus = 0
  try {
    Invoke-WebRequest "$base/v1/chat/completions" -Method Post -Headers $headers -ContentType "application/json" -Body "{}" -TimeoutSec 5 | Out-Null
    $textStatus = 200
  } catch {
    $textStatus = [int]$_.Exception.Response.StatusCode
  }
  if ($textStatus -ne 404) {
    throw "Text API must remain absent; got HTTP $textStatus."
  }

  Write-Host "Embedded gateway smoke passed: port=$port image_route=ok image_only=$($capabilities.image_only) text_http=$textStatus"
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
  foreach ($entry in $oldEnvironment.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
  }
  Remove-Item -LiteralPath $dataDir -Recurse -Force -ErrorAction SilentlyContinue
}
