const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const SERVE_HOST = process.env.KODA_SERVE_HOST || '127.0.0.1';
const UI_PATH = path.join(__dirname, 'ui', 'index.html');
const CONFIG_FILE = 'koda-desktop.json';

let serveProcess = null;
let mainWindow = null;
let servePort = 8787;
let authToken = '';
let repoPath = '';

function configPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function loadSavedProject() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    const data = JSON.parse(raw);
    if (data.repoPath && fs.existsSync(data.repoPath)) return data.repoPath;
  } catch {
    // no saved project
  }
  return null;
}

function saveProject(nextRepoPath) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify({ repoPath: nextRepoPath }, null, 2));
}

function getKodaRuntime() {
  if (app.isPackaged) {
    const root = path.join(process.resourcesPath, 'koda');
    return {
      engineRoot: root,
      entry: path.join(root, 'bin', 'koda.js'),
      nodeBin: process.execPath,
      electronAsNode: true,
    };
  }

  const engineRoot = path.resolve(__dirname, '..', '..');
  return {
    engineRoot,
    entry: path.join(engineRoot, 'bin', 'koda.js'),
    nodeBin: process.platform === 'win32' ? 'node.exe' : 'node',
    electronAsNode: false,
  };
}

function stopServe() {
  if (!serveProcess) return;
  serveProcess.kill();
  serveProcess = null;
}

async function waitForHealth(baseUrl, attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function startServe(nextRepoPath) {
  stopServe();

  const runtime = getKodaRuntime();
  if (!fs.existsSync(runtime.entry)) {
    throw new Error('Koda engine not found. Run `pnpm build` at the repo root, then retry.');
  }

  authToken = crypto.randomBytes(24).toString('hex');
  servePort = 8787 + Math.floor(Math.random() * 200);
  repoPath = nextRepoPath;

  const args = [
    runtime.entry,
    'serve',
    '--host', SERVE_HOST,
    '--port', String(servePort),
    '--root', repoPath,
    '--token', authToken,
  ];

  const env = { ...process.env, NODE_ENV: 'production' };
  if (runtime.electronAsNode) env.ELECTRON_RUN_AS_NODE = '1';

  serveProcess = spawn(runtime.nodeBin, args, {
    cwd: runtime.engineRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  serveProcess.stderr.on('data', (buf) => {
    console.error(buf.toString());
  });

  const serverUrl = `http://${SERVE_HOST}:${servePort}`;
  const healthy = await waitForHealth(serverUrl);
  if (!healthy) {
    stopServe();
    throw new Error('Koda engine failed to start. Check that the project folder is valid.');
  }

  const statusRes = await fetch(`${serverUrl}/api/status`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!statusRes.ok) {
    stopServe();
    throw new Error(`Could not read project status (${statusRes.status}).`);
  }

  const status = await statusRes.json();
  saveProject(repoPath);

  return {
    serverUrl,
    token: authToken,
    repoPath,
    repoName: status.repoName,
    branch: status.branch,
    model: status.model,
    provider: status.provider,
    indexStatus: status.indexStatus,
    fileCount: status.fileCount,
    chunkCount: status.chunkCount,
    symbolCount: status.symbolCount,
    hasConfig: status.hasConfig,
  };
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function openProject(folderPath) {
  if (!folderPath) return;

  send('koda-session-loading');

  try {
    const session = await startServe(folderPath);
    send('koda-session-ready', session);
  } catch (err) {
    send('koda-session-error', err.message || 'Failed to open project.');
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 920,
    minHeight: 640,
    title: 'Koda',
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(UI_PATH);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  ipcMain.handle('koda-open-project', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open project folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    await openProject(result.filePaths[0]);
    return result.filePaths[0];
  });

  ipcMain.handle('koda-open-initial', async () => {
    const saved = loadSavedProject();
    if (saved) {
      await openProject(saved);
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopServe();
});
