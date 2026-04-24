param(
    [string]$EnvFile = "finan.env",
    [switch]$StartApp,
    [switch]$SkipDbReset
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-EnvMap {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Env fails nav atrasts: $Path"
    }

    $map = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }

        $pair = $trimmed -split "=", 2
        if ($pair.Count -ne 2) {
            continue
        }

        $key = $pair[0].Trim()
        $value = $pair[1].Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $map[$key] = $value
    }

    return $map
}

function Resolve-PsqlPath {
    $cmd = Get-Command psql -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }

    $common = @()
    foreach ($root in @("C:\Program Files\PostgreSQL", "C:\Program Files (x86)\PostgreSQL")) {
        if (-not (Test-Path -LiteralPath $root)) {
            continue
        }

        $candidates = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName "bin\psql.exe" }

        $common += $candidates
    }

    foreach ($path in $common) {
        if (Test-Path -LiteralPath $path) {
            return $path
        }
    }

    return $null
}

function Resolve-PythonPath {
    $venvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $venvPython) {
        return @($venvPython)
    }

    $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCmd) {
        return @($pythonCmd.Source)
    }

    $pyCmd = Get-Command py -ErrorAction SilentlyContinue
    if ($pyCmd) {
        return @($pyCmd.Source, "-3")
    }

    throw "Python nav atrasts. Uzinstale Python vai aktivize .venv vidi."
}

$envMap = Get-EnvMap -Path $EnvFile
if (-not $envMap.ContainsKey("DATABASE_URL")) {
    throw "DATABASE_URL nav definets faila: $EnvFile"
}

$databaseUrl = $envMap["DATABASE_URL"]
if ($databaseUrl.StartsWith("postgres://")) {
    $databaseUrl = $databaseUrl -replace "^postgres://", "postgresql://"
}

if ($databaseUrl -notmatch "^postgresql(\+psycopg)?://") {
    throw "DATABASE_URL nav PostgreSQL formata: $databaseUrl"
}

$uri = [System.Uri]$databaseUrl
$userInfoParts = $uri.UserInfo -split ":", 2
if ($userInfoParts.Count -lt 1 -or [string]::IsNullOrWhiteSpace($userInfoParts[0])) {
    throw "DATABASE_URL nav noradits lietotajvards."
}

$dbUser = [System.Uri]::UnescapeDataString($userInfoParts[0])
$dbPassword = ""
if ($userInfoParts.Count -eq 2) {
    $dbPassword = [System.Uri]::UnescapeDataString($userInfoParts[1])
}

$dbHost = $uri.Host
$dbPort = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
$dbName = $uri.AbsolutePath.TrimStart("/")

if ([string]::IsNullOrWhiteSpace($dbName)) {
    throw "DATABASE_URL nav noradits datubazes nosaukums."
}

$psql = Resolve-PsqlPath
$quotedDbName = '"' + $dbName.Replace('"', '""') + '"'

Write-Host "Savienojums: $dbUser@$dbHost`:$dbPort / $dbName"

$env:PGPASSWORD = $dbPassword
try {
    if (-not $SkipDbReset) {
        if ($psql) {
            Write-Host "Tiks izmantots psql: $psql"

            & $psql -h $dbHost -p $dbPort -U $dbUser -d postgres -c "DROP DATABASE IF EXISTS $quotedDbName;"
            if ($LASTEXITCODE -ne 0) {
                throw "Neizdevas dzest datubazi $dbName"
            }

            & $psql -h $dbHost -p $dbPort -U $dbUser -d postgres -c "CREATE DATABASE $quotedDbName;"
            if ($LASTEXITCODE -ne 0) {
                throw "Neizdevas izveidot datubazi $dbName"
            }
        }
        else {
            Write-Host "psql nav atrasts. Izmantoju Python psycopg fallback..."
            $pythonArgs = @(Resolve-PythonPath)
            $pythonExe = $pythonArgs[0]
            $pythonExtraArgs = @()
            if ($pythonArgs.Length -gt 1) {
                $pythonExtraArgs = $pythonArgs[1..($pythonArgs.Length - 1)]
            }

            $env:DB_HOST = $dbHost
            $env:DB_PORT = [string]$dbPort
            $env:DB_USER = $dbUser
            $env:DB_PASS = $dbPassword
            $env:DB_NAME = $dbName

            $pyCode = @'
import os
import sys
import psycopg
from psycopg import sql

host = os.environ["DB_HOST"]
port = int(os.environ["DB_PORT"])
user = os.environ["DB_USER"]
password = os.environ.get("DB_PASS", "")
db_name = os.environ["DB_NAME"]

try:
    with psycopg.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        dbname="postgres",
        autocommit=True,
        connect_timeout=5,
    ) as conn:
        with conn.cursor() as cur:
            cur.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(db_name)))
            cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(db_name)))
except Exception as exc:
    print(f"DB connection/create failed: {exc}", file=sys.stderr)
    raise
'@

            $tmpPy = [System.IO.Path]::GetTempFileName() + ".py"
            try {
                Set-Content -LiteralPath $tmpPy -Value $pyCode -Encoding UTF8
                & $pythonExe @pythonExtraArgs $tmpPy
                if ($LASTEXITCODE -ne 0) {
                    throw "Neizdevas izveidot datubazi ar Python psycopg fallback"
                }
            }
            finally {
                Remove-Item -LiteralPath $tmpPy -ErrorAction SilentlyContinue
            }
        }

        Write-Host "Datubaze '$dbName' ir izveidota no jauna."
    }
    else {
        Write-Host "DB reset izlaists (SkipDbReset)."
    }
}
finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:DB_HOST -ErrorAction SilentlyContinue
    Remove-Item Env:DB_PORT -ErrorAction SilentlyContinue
    Remove-Item Env:DB_USER -ErrorAction SilentlyContinue
    Remove-Item Env:DB_PASS -ErrorAction SilentlyContinue
    Remove-Item Env:DB_NAME -ErrorAction SilentlyContinue
}

if ($StartApp) {
    Write-Host "Palaizu aplikaciju..."
    $pythonArgs = @(Resolve-PythonPath)
    $pythonExe = $pythonArgs[0]
    $pythonExtraArgs = @()
    if ($pythonArgs.Length -gt 1) {
        $pythonExtraArgs = $pythonArgs[1..($pythonArgs.Length - 1)]
    }

    & $pythonExe @pythonExtraArgs app.py
}
