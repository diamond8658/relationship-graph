const { app, BrowserWindow, shell, Tray, Menu, nativeImage, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

let mainWindow;
let tray;
let backendProcess;
const PORT = 8000;
const isDev = !app.isPackaged;

// ── Backend ───────────────────────────────────────────────────────────────────

function getBackendPath() {
  if (isDev) return null;
  const ext = process.platform === 'win32' ? 'rg-server.exe' : 'rg-server';
  return path.join(process.resourcesPath, 'backend', ext);
}

function getDbPath() {
  return path.join(app.getPath('userData'), 'relationship_graph.db');
}

function startBackend() {
  if (isDev) {
    console.log('Dev mode: start backend manually with uvicorn');
    return;
  }

  const backendExe = getBackendPath();
  const dbPath = getDbPath();

  // Check the exe actually exists before trying to spawn it
  if (!fs.existsSync(backendExe)) {
    const msg = `Backend executable not found at:\n${backendExe}\n\nThe application may not have installed correctly.`;
    console.error(msg);
    dialog.showErrorBox('Relationship Graph — Startup Error', msg);
    return;
  }

  console.log('Starting backend:', backendExe);
  console.log('DB path:', dbPath);

  backendProcess = spawn(backendExe, [], {
    env: { ...process.env, DB_PATH: dbPath },
    windowsHide: true,
  });

  backendProcess.stdout?.on('data', d => console.log('[backend]', d.toString().trim()));
  backendProcess.stderr?.on('data', d => console.error('[backend stderr]', d.toString().trim()));
  backendProcess.on('error', err => {
    console.error('Backend failed to start:', err);
    dialog.showErrorBox(
      'Relationship Graph — Backend Error',
      `Failed to start backend process:\n${err.message}\n\nPath: ${backendExe}`
    );
  });
  backendProcess.on('exit', (code, signal) => {
    console.log(`Backend exited — code: ${code}, signal: ${signal}`);
    if (mainWindow && code !== 0 && code !== null) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Backend Stopped',
        message: `The backend process stopped unexpectedly (exit code ${code}).\n\nTry restarting the application.`,
      });
    }
  });
}

function stopBackend() {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

// ── Wait for backend to be ready ──────────────────────────────────────────────

function waitForBackend(retries = 40, delay = 500) {
  return new Promise((resolve, reject) => {
    function attempt(remaining) {
      http.get(`http://localhost:${PORT}/people`, res => {
        if (res.statusCode < 500) {
          console.log('Backend ready');
          resolve();
        } else if (remaining > 0) {
          setTimeout(() => attempt(remaining - 1), delay);
        } else {
          reject(new Error(`Backend returned status ${res.statusCode}`));
        }
      }).on('error', err => {
        if (remaining > 0) {
          setTimeout(() => attempt(remaining - 1), delay);
        } else {
          reject(new Error(`Backend unreachable: ${err.message}`));
        }
      });
    }
    attempt(retries);
  });
}

// ── Window ────────────────────────────────────────────────────────────────────

function showLoadingWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 220,
    resizable: false,
    frame: false,
    center: true,
    title: 'Relationship Graph',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    autoHideMenuBar: true,
    backgroundColor: '#f7f7f7',
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(`data:text/html;charset=utf-8,
    <html>
    <body style="margin:0;font-family:system-ui;display:flex;flex-direction:column;
                 align-items:center;justify-content:center;height:100vh;
                 background:%23f7f7f7;color:%23333;user-select:none;">
      <div style="font-size:32px;margin-bottom:16px;">&#128279;</div>
      <div style="font-size:18px;font-weight:600;margin-bottom:8px;">Relationship Graph</div>
      <div style="font-size:13px;color:%23888;">Starting up&hellip;</div>
    </body>
    </html>
  `);
}

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
    autoHideMenuBar: true,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'frontend', 'index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function createTray() {
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
  // Show a loading screen immediately so the user sees something
  showLoadingWindow();

  startBackend();

  try {
    await waitForBackend();
    // Backend is up — close loading screen and open the real app
    if (mainWindow) mainWindow.close();
    mainWindow = null;
    createWindow();
  } catch (e) {
    console.error('Backend failed to become ready:', e.message);
    if (mainWindow) mainWindow.close();
    mainWindow = null;

    const backendExe = getBackendPath();
    dialog.showErrorBox(
      'Relationship Graph — Could Not Start',
      `The backend server did not start in time.\n\n` +
      `Error: ${e.message}\n\n` +
      `Backend path: ${backendExe}\n` +
      `Exists: ${backendExe ? fs.existsSync(backendExe) : 'N/A (dev mode)'}\n\n` +
      `Try restarting the application. If this keeps happening, ` +
      `check that your antivirus is not blocking rg-server.exe.`
    );
    app.quit();
  }

  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Don't hide/quit during startup — let the backend wait logic handle it
  if (!app.isReady()) return;
  if (process.platform !== 'darwin') {
    if (mainWindow) mainWindow.hide();
  }
});

app.on('before-quit', () => {
  stopBackend();
});
