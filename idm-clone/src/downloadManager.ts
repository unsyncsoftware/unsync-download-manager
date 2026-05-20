import * as fs from "fs";
import * as path from "path";
import axios, { CancelTokenSource } from "axios";
import { app, BrowserWindow } from "electron";
import { httpClient } from "./httpClient"; // ◄ Imports your new stateful session engine

export interface DownloadTask {
  url: string;
  filename: string;
  threads: number;
  headers?: Record<string, string>; // ◄ Handles incoming authentication headers/cookies cleanly
}

interface ChunkState {
  index: number;
  start: number;
  end: number;
  downloaded: number;
  done: boolean;
  cancelSource?: CancelTokenSource;
}

interface ActiveDownload {
  task: DownloadTask;
  totalBytes: number;
  chunks: ChunkState[];
  filePath: string;
  tempDir: string;
  paused: boolean;
  aborted: boolean;
  lastSampleTime: number;
  lastSampleBytes: number;
}

const PROGRESS_THROTTLE_MS = 300;
const MAX_CONCURRENT = 2;

function parseTotalBytes(headers: Record<string, any>, supportsRange: boolean): number {
  const contentRange = String(headers["content-range"] || "");
  const match = contentRange.match(/\/(\d+)$/);
  if (match) return parseInt(match[1], 10);

  if (!supportsRange) {
    return parseInt(headers["content-length"] || "0", 10);
  }

  return 0;
}

// ── Google Drive helpers ───────────────────────────────────────────────────────

function isGoogleDriveUrl(url: string): boolean {
  return url.includes("drive.google.com") || url.includes("drive.usercontent.google.com");
}

function extractFileId(url: string): string | null {
  const patterns = [
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
    /\/open\?id=([a-zA-Z0-9_-]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * Converts any Google Drive share URL into a direct download URL.
 * Uses the usercontent.google.com endpoint which handles large files
 * without the virus-scan confirmation wall.
 */
function buildDriveDirectUrl(fileId: string): string {
  return `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`;
}

async function resolveGoogleDriveUrl(url: string): Promise<string> {
  const fileId = extractFileId(url);

  if (!fileId) {
    console.warn("[DownloadManager] Could not extract Drive file ID from URL:", url);
    return url;
  }

  const directUrl = buildDriveDirectUrl(fileId);
  console.log(`[DownloadManager] Drive file ID: ${fileId}`);
  console.log(`[DownloadManager] Resolved to: ${directUrl}`);
  return directUrl;
}

// ── DownloadManager ───────────────────────────────────────────────────────────

export class DownloadManager {
  private active = new Map<string, ActiveDownload>();
  private queue: Array<{ task: DownloadTask; win: BrowserWindow }> = [];
  private running = 0;
  private lastProgressEmit = new Map<string, number>();

  async download(task: DownloadTask, win: BrowserWindow): Promise<void> {
    if (this.active.has(task.filename)) return;

    if (this.running >= MAX_CONCURRENT) {
      this.queue.push({ task, win });
      win.webContents.send("download-progress", {
        fileName: task.filename, url: task.url, progress: 0,
        downloadedBytes: 0, totalBytes: 0, speed: 0, status: "queued",
      });
      console.log(`[DownloadManager] Queued: ${task.filename}`);
      return;
    }

    await this.runDownload(task, win);
  }

  pause(fileName: string): void {
    const dl = this.active.get(fileName);
    if (!dl || dl.paused) return;
    dl.paused = true;
    for (const chunk of dl.chunks) {
      if (!chunk.done && chunk.cancelSource) chunk.cancelSource.cancel("paused");
    }
    console.log(`[DownloadManager] Paused: ${fileName}`);
  }

  async resume(fileName: string, win: BrowserWindow): Promise<void> {
    const dl = this.active.get(fileName);
    if (dl) {
      dl.paused = false;
      this.running++;
      try {
        await this.downloadAllChunks(dl, win);
        await this.mergeChunks(dl);
        this.cleanup(dl);
        this.active.delete(fileName);
        this.emitProgress(win, dl, "done");
      } catch (err) {
        if (dl.paused) { this.saveResumeState(dl); this.emitProgress(win, dl, "paused"); }
        else this.emitError(win, fileName, err);
      } finally {
        this.running--;
        this.processQueue();
      }
      return;
    }

    // Restore from disk
    const saveDir = this.getSaveDir();
    const decodedFilename = decodeURIComponent(fileName);
    const safeName = decodedFilename.replace(/[?%=&/\\:*"<>|]/g, "_");
    const statePath = path.join(saveDir, `.tmp_${safeName}`, "state.json");
    if (!fs.existsSync(statePath)) return;

    try {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      const restored: ActiveDownload = {
        ...state, paused: false, aborted: false,
        lastSampleTime: Date.now(),
        lastSampleBytes: state.chunks.reduce((s: number, c: ChunkState) => s + c.downloaded, 0),
      };
      this.active.set(fileName, restored);
      this.running++;
      try {
        await this.downloadAllChunks(restored, win);
        await this.mergeChunks(restored);
        this.cleanup(restored);
        this.active.delete(fileName);
        this.emitProgress(win, restored, "done");
      } catch (err) {
        if (restored.paused) { this.saveResumeState(restored); this.emitProgress(win, restored, "paused"); }
        else this.emitError(win, fileName, err);
      } finally {
        this.running--;
        this.processQueue();
      }
    } catch (err) {
      this.emitError(win, fileName, err);
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async runDownload(task: DownloadTask, win: BrowserWindow): Promise<void> {
    this.running++;
    try {
      await this.doDownload(task, win);
    } finally {
      this.running--;
      this.processQueue();
    }
  }

  private processQueue(): void {
    if (this.queue.length === 0 || this.running >= MAX_CONCURRENT) return;
    const next = this.queue.shift()!;
    console.log(`[DownloadManager] Dequeuing: ${next.task.filename}`);
    this.runDownload(next.task, next.win);
  }

  private async doDownload(task: DownloadTask, win: BrowserWindow): Promise<void> {
    const threads = task.threads ?? 4;
    
    // Clean up percent-encoding strings like %20 into clean local space bars
    const decodedFilename = decodeURIComponent(task.filename);
    const safeName = decodedFilename.replace(/[?%=&/\\:*"<>|]/g, "_");
    
    const saveDir = this.getSaveDir();
    const filePath = path.join(saveDir, safeName);
    const tempDir = path.join(saveDir, `.tmp_${safeName}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // Resolve Google Drive URLs
    let resolvedUrl = task.url;
    if (isGoogleDriveUrl(task.url)) {
      resolvedUrl = await resolveGoogleDriveUrl(task.url);
    }

    // HEAD request via stateful client
    let totalBytes = 0;
    let supportsRange = false;
    try {
      // ◄ FIXED: Uses stateful httpClient and merges dynamic extension headers over defaults
      const probeResponse = await httpClient.get(resolvedUrl, {
        responseType: "stream",
        timeout: 15_000,
        headers: {
          ...task.headers,
          Range: "bytes=0-0",
          "Accept-Encoding": "identity",
        },
        maxRedirects: 10,
        decompress: false,
      });
      probeResponse.data.destroy();
      supportsRange =
        probeResponse.status === 206 ||
        probeResponse.headers["accept-ranges"] === "bytes" ||
        Boolean(probeResponse.headers["content-range"]);
      totalBytes = parseTotalBytes(probeResponse.headers, supportsRange);

      console.log("[DownloadManager] Range support:", supportsRange);
      console.log("[DownloadManager] Content-Type:", probeResponse.headers["content-type"]);
      console.log("[DownloadManager] Content-Length:", totalBytes || probeResponse.headers["content-length"]);
    } catch (err) {
      console.warn("[DownloadManager] Range probe failed, falling back to single stream:", err);
    }

    const numChunks = supportsRange ? threads : 1;
    const chunks = this.buildChunks(numChunks, totalBytes);

    const dl: ActiveDownload = {
      task: { ...task, url: resolvedUrl },
      totalBytes, chunks, filePath, tempDir,
      paused: false, aborted: false,
      lastSampleTime: Date.now(), lastSampleBytes: 0,
    };
    this.active.set(task.filename, dl);
    this.emitProgress(win, dl, "downloading");

    try {
      await this.downloadAllChunks(dl, win);
    } catch (err) {
      if (dl.paused) { this.saveResumeState(dl); this.emitProgress(win, dl, "paused"); return; }
      this.cleanup(dl);
      this.emitError(win, task.filename, err);
      throw err;
    }

    if (dl.paused || dl.aborted) return;

    await this.mergeChunks(dl);
    this.cleanup(dl);
    this.active.delete(task.filename);
    this.emitProgress(win, dl, "done");
    console.log(`[DownloadManager] ✓ ${task.filename} → ${filePath}`);
  }

  private buildChunks(numChunks: number, totalBytes: number): ChunkState[] {
    if (numChunks === 1 || totalBytes === 0) {
      return [{ index: 0, start: 0, end: totalBytes - 1, downloaded: 0, done: false }];
    }
    const size = Math.floor(totalBytes / numChunks);
    return Array.from({ length: numChunks }, (_, i) => ({
      index: i,
      start: i * size,
      end: i === numChunks - 1 ? totalBytes - 1 : (i + 1) * size - 1,
      downloaded: 0,
      done: false,
    }));
  }

  private async downloadAllChunks(dl: ActiveDownload, win: BrowserWindow): Promise<void> {
    const pending = dl.chunks.filter(c => !c.done);
    if (pending.length === 0) return;
    await Promise.all(pending.map(chunk => this.downloadChunk(dl, chunk, win)));
  }

  private async downloadChunk(dl: ActiveDownload, chunk: ChunkState, win: BrowserWindow): Promise<void> {
    if (dl.paused || dl.aborted) return;
    const chunkPath = path.join(dl.tempDir, `chunk_${chunk.index}`);
    const startByte = chunk.start + chunk.downloaded;

    // ◄ FIXED: Inherit extension auth context while appending multi-threading segment instructions
    const requestHeaders: Record<string, string> = { ...dl.task.headers };
    if (dl.chunks.length > 1 || chunk.downloaded > 0) {
      requestHeaders["Range"] = `bytes=${startByte}-${chunk.end >= 0 ? chunk.end : ""}`;
    }

    const cancelSource = axios.CancelToken.source();
    chunk.cancelSource = cancelSource;

    try {
      // ◄ FIXED: Stream segment through the same stateful httpClient wrapper
      const res = await httpClient.get(dl.task.url, {
        responseType: "stream",
        headers: requestHeaders,
        cancelToken: cancelSource.token,
        timeout: 60_000,
        maxRedirects: 15,
        decompress: false, // Forces raw binary chunk buffering without triggering Zlib data errors
      });

      // Guard: if Google returned HTML, the token didn't work
      const ct = res.headers["content-type"] || "";
      if (ct.includes("text/html")) {
        throw new Error(
          "Received an HTML page instead of the file. " +
          "The Google Drive file may be private or require sign-in to download."
        );
      }

      const writer = fs.createWriteStream(chunkPath, { flags: chunk.downloaded > 0 ? "a" : "w" });
      await new Promise<void>((resolve, reject) => {
        let inspectedFirstChunk = chunk.downloaded > 0;
        res.data.on("data", (data: Buffer) => {
          if (dl.paused || dl.aborted) { res.data.destroy(); writer.close(); resolve(); return; }

          if (!inspectedFirstChunk) {
            inspectedFirstChunk = true;
            const firstChunk = data.slice(0, 512).toString("utf8").toLowerCase();
            if (firstChunk.includes("<html") || firstChunk.includes("<!doctype")) {
              res.data.destroy();
              writer.destroy();
              reject(new Error("Received an HTML page instead of the file."));
              return;
            }
          }

          chunk.downloaded += data.length;
          writer.write(data);
          this.onChunkData(dl, win);
        });
        res.data.on("end", () => writer.end(() => { if (!dl.paused && !dl.aborted) chunk.done = true; resolve(); }));
        res.data.on("error", (err: Error) => { writer.destroy(); reject(err); });
        writer.on("error", reject);
      });
    } catch (err) {
      if (axios.isCancel(err)) return;
      throw err;
    }
  }

  private onChunkData(dl: ActiveDownload, win: BrowserWindow): void {
    const now = Date.now();
    const last = this.lastProgressEmit.get(dl.task.filename) ?? 0;
    if (now - last < PROGRESS_THROTTLE_MS) return;
    this.lastProgressEmit.set(dl.task.filename, now);
    this.emitProgress(win, dl, "downloading");
  }

  private emitProgress(win: BrowserWindow, dl: ActiveDownload, status: "downloading" | "paused" | "done"): void {
    if (!win || win.isDestroyed()) return;
    const downloadedBytes = dl.chunks.reduce((s, c) => s + c.downloaded, 0);
    const progress = dl.totalBytes > 0 ? Math.min((downloadedBytes / dl.totalBytes) * 100, 100) : 0;
    const now = Date.now();
    const elapsed = (now - dl.lastSampleTime) / 1000;
    let speed = 0;
    if (elapsed > 0.5) {
      speed = (downloadedBytes - dl.lastSampleBytes) / elapsed;
      dl.lastSampleTime = now;
      dl.lastSampleBytes = downloadedBytes;
    }
    win.webContents.send("download-progress", {
      fileName: dl.task.filename,
      url: dl.task.url,
      progress: status === "done" ? 100 : progress,
      downloadedBytes, totalBytes: dl.totalBytes,
      speed: status === "downloading" ? Math.max(0, speed) : 0,
      status,
    });
  }

  private emitError(win: BrowserWindow, fileName: string, err: unknown): void {
    if (!win || win.isDestroyed()) return;
    win.webContents.send("download-progress", {
      fileName, progress: 0, downloadedBytes: 0, totalBytes: 0, speed: 0, status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  private async mergeChunks(dl: ActiveDownload): Promise<void> {
    const writer = fs.createWriteStream(dl.filePath);
    for (const chunk of dl.chunks) {
      const chunkPath = path.join(dl.tempDir, `chunk_${chunk.index}`);
      await new Promise<void>((resolve, reject) => {
        const reader = fs.createReadStream(chunkPath);
        reader.pipe(writer, { end: false });
        reader.on("end", resolve);
        reader.on("error", reject);
      });
    }
    await new Promise<void>((resolve, reject) => { writer.end(resolve); writer.on("error", reject); });
  }

  private saveResumeState(dl: ActiveDownload): void {
    const statePath = path.join(dl.tempDir, "state.json");
    fs.writeFileSync(statePath, JSON.stringify({
      task: dl.task, totalBytes: dl.totalBytes, filePath: dl.filePath, tempDir: dl.tempDir,
      chunks: dl.chunks.map(c => ({ index: c.index, start: c.start, end: c.end, downloaded: c.downloaded, done: c.done })),
    }, null, 2));
  }

  private cleanup(dl: ActiveDownload): void {
    try { if (fs.existsSync(dl.tempDir)) fs.rmSync(dl.tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  private getSaveDir(): string {
    const dir = path.join(app.getPath("home"), "Downloads", "IDM-Clone");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
}
