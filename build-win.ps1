# build-win.ps1
# Run from the root of the relationship-graph directory

$ErrorActionPreference = "Stop"
Write-Host "Building Relationship Graph for Windows..." -ForegroundColor Cyan

# Step 1 — Build React frontend
Write-Host "`n[1/4] Building React frontend..." -ForegroundColor Yellow
Set-Location frontend
npm run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }

# Copy build output to electron/frontend
Write-Host "Copying frontend build to electron..."
if (Test-Path "..\electron\frontend") { Remove-Item "..\electron\frontend" -Recurse -Force }
Copy-Item "build" "..\electron\frontend" -Recurse
Set-Location ..

# Step 2 — Bundle Python backend with PyInstaller
Write-Host "`n[2/4] Bundling Python backend with PyInstaller..." -ForegroundColor Yellow
Set-Location backend
.\venv\Scripts\Activate.ps1
pip install pyinstaller --quiet
pyinstaller backend.spec --clean --noconfirm
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }
Set-Location ..

# Step 3 — Install Electron dependencies
Write-Host "`n[3/4] Installing Electron dependencies..." -ForegroundColor Yellow
Set-Location electron
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

# Step 4 — Build Electron app
Write-Host "`n[4/4] Building Electron installer..." -ForegroundColor Yellow
npm run build:win
if ($LASTEXITCODE -ne 0) { throw "Electron build failed" }
Set-Location ..

Write-Host "`nBuild complete! Installer is in dist/" -ForegroundColor Green
Write-Host "Look for: dist/Relationship Graph Setup*.exe" -ForegroundColor Green
