$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Yellow
Write-Host "  AFILIADO OFERTAS - AMBIENTE LOCAL" -ForegroundColor Yellow
Write-Host "=========================================" -ForegroundColor Yellow
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

$envContent = @"
NEXT_PUBLIC_SUPABASE_URL=https://flicyhbmovfvmvzoilzh.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_8rwFdzOqo0MIuJqi-qqNkg_OeZqvuJI
MERCADO_LIVRE_ACCESS_TOKEN=
ALLOW_DEMO_OFFERS=true
"@

if (-not (Test-Path $envPath)) {
    Set-Content -Path $envPath -Value $envContent -Encoding UTF8
    Write-Host ".env.local criado automaticamente com o Supabase afiliado-ofertas." -ForegroundColor Green
} else {
    $currentEnv = Get-Content -Path $envPath -Raw
    if ($currentEnv -notmatch "flicyhbmovfvmvzoilzh" -or $currentEnv -notmatch "sb_publishable_8rwFdzOqo0MIuJqi-qqNkg_OeZqvuJI") {
        Write-Host ".env.local existente nao corresponde ao projeto afiliado-ofertas." -ForegroundColor Yellow
        $backupPath = Join-Path $projectRoot ".env.local.backup"
        Copy-Item -Path $envPath -Destination $backupPath -Force
        Set-Content -Path $envPath -Value $envContent -Encoding UTF8
        Write-Host "Configuracao atualizada. Backup salvo em .env.local.backup." -ForegroundColor Green
    } else {
        Write-Host ".env.local ja configurado para afiliado-ofertas." -ForegroundColor Green
    }
}

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
