const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

const isPackaged = app.isPackaged;
const rootDir = isPackaged ? path.join(process.resourcesPath, "app") : __dirname;
const appUrl = "http://127.0.0.1:8000";
let backendProcess = null;
let mainWindow = null;

function getPythonPath() {
  if (process.env.SQL_QUEST_PYTHON) {
    return process.env.SQL_QUEST_PYTHON;
  }

  if (process.platform === "win32") {
    return path.join(process.env.USERPROFILE || "", "scoop", "apps", "python", "current", "python.exe");
  }

  return "python3";
}

function startBackend() {
  const pythonPath = getPythonPath();
  const backendPath = path.join(rootDir, "backend.py");
  const postgresPath = path.join(process.env.USERPROFILE || "", "scoop", "apps", "postgresql", "current", "bin");
  const env = {
    ...process.env,
    PATH: `${path.dirname(pythonPath)};${postgresPath};${process.env.PATH || ""}`,
    PGHOST: "127.0.0.1",
    PGPORT: "55432"
  };

  backendProcess = spawn(pythonPath, ["-u", backendPath], {
    cwd: rootDir,
    env,
    windowsHide: true
  });

  backendProcess.stdout.on("data", (data) => {
    console.log(`[backend] ${data}`);
  });

  backendProcess.stderr.on("data", (data) => {
    console.error(`[backend] ${data}`);
  });

  backendProcess.on("exit", (code) => {
    console.log(`Backend exited with code ${code}`);
  });
}

function waitForBackend(timeoutMs = 45000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(`${appUrl}/api/health`, (response) => {
        response.resume();

        if (response.statusCode === 200) {
          resolve();
          return;
        }

        retry();
      });

      request.on("error", retry);
      request.setTimeout(1000, () => {
        request.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error("Backend did not start in time"));
        return;
      }

      setTimeout(check, 1000);
    };

    check();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "SQL Quest",
    backgroundColor: "#f4f6f8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL(appUrl);
}

app.whenReady().then(async () => {
  startBackend();

  try {
    await waitForBackend();
    createWindow();
  } catch (error) {
    dialog.showErrorBox(
      "SQL Quest не запустился",
      "Backend не смог стартовать. Проверь, что Python и PostgreSQL установлены.\n\n" + error.message
    );
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill();
  }

  app.quit();
});
