const { app, BrowserWindow, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let tray;
let backendProcess;
const PORT = 8000;
const isDev = !app.isPackaged;

// ── Backend ───────────────────────────────────────────────────────────────────

function getBackendPath() {
  if (isDev) {
    // In dev, run python directly
    return null;
  }
  // In production, use the bundled exe (Windows) or binary (Mac)
  const ext = process.platform === 'win32' ? 'rg-server.exe' : 'rg-server';
  return path.join(process.resourcesPath, 'backend', ext);
}

function getDbPath() {
  // Store DB in user data directory so it persists across updates
  return path.join(app.getPath('userData'), 'relationship_graph.db');
}

function startBackend() {
  if (isDev) {
    console.log('Dev mode: start backend manually with uvicorn');
    return;
  }

  const backendExe = getBackendPath();
  const dbPath = getDbPath();

  console.log('Starting backend:', backendExe);

  backendProcess = spawn(backendExe, [], {
    env: {
      ...process.env,
      DB_PATH: dbPath,
    },
    windowsHide: true,
  });

  backendProcess.stdout?.on('data', d => console.log('[backend]', d.toString()));
  backendProcess.stderr?.on('data', d => console.error('[backend]', d.toString()));
  backendProcess.on('error', err => console.error('Backend failed to start:', err));
  backendProcess.on('exit', code => console.log('Backend exited with code:', code));
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

// ── Wait for backend to be ready ──────────────────────────────────────────────

function waitForBackend(retries = 30, delay = 500) {
  return new Promise((resolve, reject) => {
    function attempt(remaining) {
      http.get(`http://localhost:${PORT}/people`, res => {
        if (res.statusCode < 500) resolve();
        else if (remaining > 0) setTimeout(() => attempt(remaining - 1), delay);
        else reject(new Error('Backend did not start in time'));
      }).on('error', () => {
        if (remaining > 0) setTimeout(() => attempt(remaining - 1), delay);
        else reject(new Error('Backend did not start in time'));
      });
    }
    attempt(retries);
  });
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Relationship Graph',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    // Remove default menu bar
    autoHideMenuBar: true,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'frontend', 'index.html'));
  }

  // Open external links in browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
  // Simple tray icon — blank 16x16 for now
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  const menu = Menu.buildFromTemplate([
    { label: 'Open', click: () => { if (mainWindow) mainWindow.show(); else createWindow(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setToolTip('Relationship Graph');
  tray.setContextMenu(menu);
  tray.on('click', () => { if (mainWindow) mainWindow.show(); });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  startBackend();

  try {
    await waitForBackend();
  } catch (e) {
    console.error('Backend unavailable:', e.message);
  }

  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // On Mac, keep app running in tray
  if (process.platform !== 'darwin') {
    // On Windows/Linux, hide to tray instead of quitting
    if (mainWindow) mainWindow.hide();
  }
});

app.on('before-quit', () => {
  stopBackend();
});
