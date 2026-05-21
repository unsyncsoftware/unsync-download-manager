import { app, BrowserWindow, ipcMain, Menu } from "electron";
import * as path from "path";
import * as http from "http";
import { DownloadManager } from "./downloadManager";

const manager = new DownloadManager();
let mainWindow: BrowserWindow | null = null;

const AUTH_TOKEN = "local-dev-token";
const MAX_BODY = 1024 * 32;
const ALLOWED_ORIGIN_PREFIX = "chrome-extension://";

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>
): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 800,
    minHeight: 500,
    title: "Unsync Download Manager",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  Menu.setApplicationMenu(null);

  const htmlPath = path.join(__dirname, "renderer", "index.html");
  console.log(`[Unsync Core] UI Window launching from asset path: ${htmlPath}`);

  mainWindow.loadFile(htmlPath).catch((err) => {
    console.error("[Unsync Core] Failed to load renderer:", err);
  });
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || "";

  if (typeof origin === "string" && origin.startsWith(ALLOWED_ORIGIN_PREFIX)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Unsync-Token");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/add-download") {
    res.writeHead(404);
    res.end();
    return;
  }

  const token = req.headers["x-unsync-token"];
  if (token !== AUTH_TOKEN) {
    res.writeHead(401);
    res.end("Unauthorized");
    return;
  }

  let body = "";
  let bodyTooLarge = false;

  req.on("data", (chunk) => {
    body += chunk.toString();

    if (body.length > MAX_BODY) {
      bodyTooLarge = true;
      sendJson(res, 413, { success: false, message: "Request body too large" });
      req.destroy();
    }
  });

  req.on("end", () => {
    if (bodyTooLarge) return;

    try {
      const task = JSON.parse(body);
      console.log("[Unsync Server] Intercepted payload from extension:", task);

      const parsed = new URL(task.url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Invalid protocol");
      }

      if (!mainWindow) {
        sendJson(res, 500, { success: false, message: "MainWindow offline" });
        return;
      }

      const resolvedTask = {
        url: task.url,
        filename: task.filename || task.fileName || "downloaded_file",
        threads: task.threads ?? 4,
        headers: task.headers || {},
      };

      manager.download(resolvedTask, mainWindow).catch((err) => {
        console.error("[Unsync DM] Download failed:", err);
      });

      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.flashFrame(true);

      sendJson(res, 200, { success: true, message: "Download queued" });
    } catch (err: any) {
      console.error("[Unsync Server] Error:", err);
      sendJson(res, 400, {
        success: false,
        message: err.message || "Invalid request",
      });
    }
  });
});

server.listen(3001, "localhost", () => {
  console.log("[Unsync Core] Local communications port bound to http://localhost:3001");
});

ipcMain.on("start-download", async (_event, { url, fileName, threads, headers }) => {
  console.log(`[Unsync DM] Download requested: ${fileName}`);

  if (!mainWindow) return;

  try {
    await manager.download({ url, filename: fileName, threads, headers }, mainWindow);
  } catch (err) {
    console.error("[Unsync DM] Download failed:", err);
  }
});

ipcMain.on("pause-download", (_event, fileName: string) => {
  manager.pause(fileName);
});

ipcMain.on("resume-download", (_event, fileName: string) => {
  if (!mainWindow) return;
  manager.resume(fileName, mainWindow);
});

ipcMain.on("exit-app", () => {
  app.quit();
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  server.close();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
