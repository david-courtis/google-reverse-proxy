$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$NodeVersion = "24.11.1"
$NodeDir = ".node"

function Get-NodeMajor {
	$v = (& node --version 2>$null | Out-String).Trim()
	if ($v -match '^v?(\d+)\.') { return [int]$Matches[1] }
	return -1
}

function Test-UsableNode {
	if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
	$major = Get-NodeMajor
	return ($major -ge 22 -and $major -lt 25)
}

function Initialize-Node {
	switch ($env:PROCESSOR_ARCHITECTURE) {
		"AMD64" { $arch = "x64" }
		"ARM64" { $arch = "arm64" }
		default {
			Write-Error "Unsupported CPU for auto-install: $env:PROCESSOR_ARCHITECTURE. Install Node 24 manually."
			exit 1
		}
	}

	$localNode = Join-Path $NodeDir "node-v$NodeVersion-win-$arch"
	$nodeExe = Join-Path $localNode "node.exe"
	if (Test-Path $nodeExe) {
		$env:Path = "$((Resolve-Path $localNode).Path);$env:Path"
		return
	}

	$zip = "node-v$NodeVersion-win-$arch.zip"
	$url = "https://nodejs.org/dist/v$NodeVersion/$zip"
	Write-Host "Node not found - downloading Node $NodeVersion (win-$arch, one-time)..."
	New-Item -ItemType Directory -Force -Path $NodeDir | Out-Null
	$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
	New-Item -ItemType Directory -Force -Path $tmp | Out-Null
	try {
		$zipPath = Join-Path $tmp $zip
		Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
		$shaPath = Join-Path $tmp "SHASUMS256.txt"
		Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -OutFile $shaPath -UseBasicParsing

		$want = (Select-String -Path $shaPath -Pattern ([regex]::Escape("  $zip") + '$') |
			Select-Object -First 1).Line.Split(' ')[0]
		$got = (Get-FileHash -Algorithm SHA256 -Path $zipPath).Hash.ToLower()
		if (-not $want -or $want.ToLower() -ne $got) {
			Write-Error "Checksum verification failed for $zip. Aborting."
			exit 1
		}

		Expand-Archive -Path $zipPath -DestinationPath $NodeDir -Force
		$env:Path = "$((Resolve-Path $localNode).Path);$env:Path"
		Write-Host "Node $NodeVersion ready (local, in .\$NodeDir - not on system PATH)."
	} finally {
		Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
	}
}

if (-not (Test-UsableNode)) {
	Initialize-Node
}

if ((Get-NodeMajor) -ne 24) {
	$ver = (& node --version | Out-String).Trim()
	Write-Host "Warning: running on Node $ver. Node 24 is recommended for byte-identical"
	Write-Host "upstream parity (>=22 <25 works but is not byte-identical)."
}

$depsReady = (Test-Path "node_modules/tsx") -and (Test-Path "node_modules/@google/gemini-cli-core/dist/index.js")
if (-not $depsReady) {
	Write-Host "First run - installing dependencies..."
	npm install --no-audit --no-fund
	if ($LASTEXITCODE -ne 0) { Write-Error "npm install failed"; exit $LASTEXITCODE }
}

npm start
exit $LASTEXITCODE
