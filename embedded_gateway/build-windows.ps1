param(
  [string]$Python = "python",
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$vendor = Join-Path $root "vendor\chatgpt2api"
$dist = if ($OutputDirectory) {
  [System.IO.Path]::GetFullPath($OutputDirectory)
} else {
  Join-Path $root "dist"
}
$work = Join-Path $root ".build"
$pythonCommand = Get-Command $Python -ErrorAction Stop
$resolvedPython = $pythonCommand.Source
$buildPython = $resolvedPython

$ErrorActionPreference = "Continue"
& $buildPython -m pip --version *> $null
$pipAvailable = $LASTEXITCODE -eq 0
$ErrorActionPreference = "Stop"
if (-not $pipAvailable) {
  $venv = Join-Path $work ".venv"
  $venvPython = Join-Path $venv "Scripts\python.exe"
  if (-not (Test-Path -LiteralPath $venvPython)) {
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    if (Get-Command uv -ErrorAction SilentlyContinue) {
      & uv venv --python $resolvedPython $venv
    } else {
      & $resolvedPython -m venv $venv
    }
    if ($LASTEXITCODE -ne 0) {
      throw "Python at '$resolvedPython' has no pip and an isolated build environment could not be created."
    }
  }
  $buildPython = $venvPython
}
if (Get-Command uv -ErrorAction SilentlyContinue) {
  & uv pip install --python $buildPython -r (Join-Path $root "requirements-build.txt")
} else {
  & $buildPython -m pip install --disable-pip-version-check -r (Join-Path $root "requirements-build.txt")
}
if ($LASTEXITCODE -ne 0) { throw "Gateway build dependencies failed to install." }

Push-Location $vendor
try {
  & $buildPython -m PyInstaller `
    --noconfirm `
    --clean `
    --onedir `
    --noconsole `
    --name "langbai_chatgpt_gateway" `
    --distpath $dist `
    --workpath $work `
    --specpath $work `
    --paths $vendor `
    --collect-all curl_cffi `
    --collect-all tiktoken `
    --hidden-import uvicorn.logging `
    --hidden-import uvicorn.loops.auto `
    --hidden-import uvicorn.protocols.http.auto `
    --hidden-import uvicorn.protocols.websockets.auto `
    --hidden-import uvicorn.lifespan.on `
    (Join-Path $root "launcher.py")
  if ($LASTEXITCODE -ne 0) { throw "PyInstaller gateway build failed." }
} finally {
  Pop-Location
}

$exe = Join-Path $dist "langbai_chatgpt_gateway\langbai_chatgpt_gateway.exe"
if (-not (Test-Path -LiteralPath $exe)) {
  throw "Gateway executable was not produced: $exe"
}
Write-Output $exe
