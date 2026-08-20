$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=========================================" -ForegroundColor DarkYellow
Write-Host "  AFILIADO OFERTAS - AMBIENTE LOCAL" -ForegroundColor DarkYellow
Write-Host "=========================================" -ForegroundColor DarkYellow
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js nao encontrado. Instale o Node.js 22 ou superior antes de continuar." -ForegroundColor Red
    exit 1
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "npm nao encontrado." -ForegroundColor Red
    exit 1
}

$nodeVersion = (node -p "process.versions.node")
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 22) {
    Write-Host "Node.js $nodeVersion encontrado. Use Node.js 22 ou superior." -ForegroundColor Red
    exit 1
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
$envPath = Join-Path $projectRoot ".env.local"

$currentEnv = ""
$mlToken = ""
$encryptionKey = ""

if (Test-Path $envPath) {
    $currentEnv = Get-Content -Path $envPath -Raw
    if ($currentEnv -match '(?m)^MERCADO_LIVRE_ACCESS_TOKEN=(.*)$') {
        $mlToken = $matches[1].Trim()
    }
    if ($currentEnv -match '(?m)^APP_ENCRYPTION_KEY=(.+)$') {
        $encryptionKey = $matches[1].Trim()
    }
}

if ([string]::IsNullOrWhiteSpace($encryptionKey)) {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    $encryptionKey = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
    Write-Host "Chave local de criptografia criada." -ForegroundColor Green
}

$envContent = @"
NEXT_PUBLIC_SUPABASE_URL=https://flicyhbmovfvmvzoilzh.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_8rwFdzOqo0MIuJqi-qqNkg_OeZqvuJI
APP_ENCRYPTION_KEY=$encryptionKey
MERCADO_LIVRE_ACCESS_TOKEN=$mlToken
ALLOW_DEMO_OFFERS=true
"@

if (Test-Path $envPath) {
    Copy-Item -Path $envPath -Destination (Join-Path $projectRoot ".env.local.backup") -Force
}
Set-Content -Path $envPath -Value $envContent -Encoding UTF8
Write-Host ".env.local configurado para o projeto afiliado-ofertas." -ForegroundColor Green

Write-Host ""
Write-Host "Instalando dependencias travadas..." -ForegroundColor Cyan
npm ci

if ($LASTEXITCODE -ne 0) {
    Write-Host "Falha ao instalar dependencias." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Ambiente pronto." -ForegroundColor Green
Write-Host "Abrindo em http://localhost:3000" -ForegroundColor Green
Write-Host "Para encerrar, pressione Ctrl+C nesta janela." -ForegroundColor Gray
Write-Host ""

npm run dev
