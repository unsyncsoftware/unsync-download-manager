import { useState, useEffect, useRef } from "react";

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024, sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
function formatSpeed(b) { return formatBytes(b) + "/s"; }
function getFileExt(fileName) {
  return fileName?.split(".").pop()?.toUpperCase() || "FILE";
}
function getFileColor(fileName) {
  const ext = fileName?.split(".").pop()?.toLowerCase();
  const m = {
    mp4:"#e040fb",mkv:"#e040fb",avi:"#e040fb",mov:"#e040fb",
    mp3:"#00bcd4",wav:"#00bcd4",flac:"#00bcd4",
    zip:"#ff9800",rar:"#ff9800","7z":"#ff9800",
    pdf:"#f44336",doc:"#2196f3",docx:"#2196f3",
    jpg:"#4caf50",jpeg:"#4caf50",png:"#4caf50",gif:"#4caf50",
    exe:"#9e9e9e",iso:"#ff5722",
  };
  return m[ext] || "#00b7c3";
}

function useSmoothedSpeeds(downloads) {
  const histRef = useRef({});
  const WINDOW = 6;
  const result = {};
  for (const d of downloads) {
    if (!histRef.current[d.id]) histRef.current[d.id] = [];
    const hist = histRef.current[d.id];
    if (d.speed > 0) hist.push(d.speed);
    if (hist.length > WINDOW) hist.shift();
    result[d.id] = hist.length > 0 ? hist.reduce((a, b) => a + b, 0) / hist.length : 0;
  }
  for (const key of Object.keys(histRef.current)) {
    if (!downloads.find(d => String(d.id) === key)) delete histRef.current[key];
  }
  return result;
}

function isGoogleDriveUrl(url) {
  return url.includes("drive.google.com") || url.includes("docs.google.com");
}
function convertGoogleDriveUrl(url) {
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  const fileId = fileMatch?.[1] || idMatch?.[1];
  if (fileId) return { url: `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`, converted: true };
  return { url, converted: false };
}

const STATUS = { QUEUED:"queued", DOWNLOADING:"downloading", PAUSED:"paused", DONE:"done", ERROR:"error" };
let _id = 1;
const uid = () => _id++;

const NAV_ITEMS = [
  { id:"downloads", label:"Downloads", icon:"⬇" },
  { id:"browser",   label:"Browser Monitoring", icon:"◈" },
  { id:"media",     label:"Media Grabber", icon:"▶" },
  null,
  { id:"settings",  label:"Settings", icon:"⚙" },
  { id:"language",  label:"Language", icon:"◎" },
  { id:"import",    label:"Import", icon:"↙" },
  { id:"export",    label:"Export", icon:"↗" },
  null,
  { id:"help",      label:"Help & Support", icon:"?" },
  { id:"report",    label:"Report a Problem", icon:"⚑" },
  { id:"update",    label:"Check for Update", icon:"↺" },
  { id:"about",     label:"About UDM", icon:"◉" },
  null,
  { id:"exit",      label:"Exit", icon:"✕", danger:true },
];

const COMMAND_VIEWS = {
  browser: {
    title: "Browser Monitoring",
    subtitle: "Chrome extension handoff channel",
    rows: [
      ["Listener", "http://localhost:3001/add-download"],
      ["Authentication", "X-Unsync-Token enabled"],
      ["Capture Flow", "Browser download -> UDM queue -> Chrome item cleanup"],
    ],
    actions: [["test-listener", "Test Listener"], ["open-downloads", "View Queue"]],
  },
  media: {
    title: "Media Grabber",
    subtitle: "Video and audio capture workspace",
    rows: [
      ["Status", "Waiting for browser media download events"],
      ["Supported Types", "MP4, MKV, AVI, MOV, MP3, WAV, FLAC"],
      ["Routing", "Captured files appear in the Downloads queue"],
    ],
    actions: [["open-add", "Add Media URL"], ["open-downloads", "View Queue"]],
  },
  settings: {
    title: "Settings",
    subtitle: "Desktop transfer defaults",
    rows: [
      ["Save Folder", "Downloads\\IDM-Clone"],
      ["Parallel Tasks", "2 active downloads"],
      ["Default Threads", "4 connections when range requests are supported"],
      ["Extension Port", "localhost:3001"],
    ],
    actions: [["clear-done", "Clear Done"], ["open-add", "Add URL"]],
  },
  language: {
    title: "Language",
    subtitle: "Interface language",
    rows: [
      ["Current", "English"],
      ["Available", "English"],
      ["Status", "Additional language packs are not installed"],
    ],
    actions: [["language-english", "Use English"]],
  },
  import: {
    title: "Import",
    subtitle: "Bring external tasks into UDM",
    rows: [
      ["Accepted Input", "Download URLs from the Add URL dialog"],
      ["Extension Input", "Chrome can import authenticated downloads automatically"],
      ["Queue State", "Active downloads are tracked in this session"],
    ],
    actions: [["open-add", "Import URL"], ["open-downloads", "View Queue"]],
  },
  export: {
    title: "Export",
    subtitle: "Queue snapshot",
    rows: [
      ["Format", "JSON queue summary"],
      ["Contents", "Filename, URL, progress, status, and size"],
      ["Scope", "Current visible session"],
    ],
    actions: [["export-queue", "Export Queue"]],
  },
  help: {
    title: "Help & Support",
    subtitle: "Quick operational checks",
    rows: [
      ["Manual Add", "Use + Add URL for direct links"],
      ["Browser Capture", "Keep the Chrome extension enabled"],
      ["Authenticated Files", "The extension forwards cookies and referrer headers"],
      ["Output Folder", "Downloads\\IDM-Clone"],
    ],
    actions: [["open-add", "Add URL"], ["test-listener", "Test Listener"]],
  },
  report: {
    title: "Report a Problem",
    subtitle: "Diagnostics to include",
    rows: [
      ["Desktop Logs", "Copy the latest Unsync Core and DownloadManager lines"],
      ["Extension Logs", "Chrome extension service worker console"],
      ["Failed URL", "Include the source URL and file type"],
    ],
    actions: [["copy-diagnostics", "Copy Diagnostics"]],
  },
  update: {
    title: "Check for Update",
    subtitle: "Installed build status",
    rows: [
      ["Current Version", "0.1.0"],
      ["Channel", "Local development build"],
      ["Update Source", "No remote updater configured"],
    ],
    actions: [["check-update", "Check Now"]],
  },
};

const css = `
@import url('https://fonts.googleapis.com/css2?family=Segoe+UI:wght@200;300;400;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;border-radius:0 !important}
:root{
  --bg:#0d0d0d;
  --surface:#141414;
  --surface2:#1f1f1f;
  --border:#222222;
  --accent:#00b7c3;
  --text:#e0e0e0;
  --text-dim:#a0a0a0;
  --text-muted:#505050;
  --sans:'Segoe UI',system-ui,sans-serif;
  --mono:'IBM Plex Mono',monospace;
}
body{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:13px;-webkit-font-smoothing:antialiased;overflow:hidden;user-select:none}
.app{display:flex;flex-direction:column;height:100vh;position:relative}

/* ── Topbar ── */
.topbar{
  display:flex;align-items:center;
  height:50px;padding:0 16px;gap:12px;
  background:var(--bg);
  border-bottom:1px solid var(--border);
  flex-shrink:0;-webkit-app-region:drag;
}
.topbar-ham{
  -webkit-app-region:no-drag;
  width:32px;height:32px;background:transparent;border:none;
  cursor:pointer;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:4px;padding:0;
}
.topbar-ham:hover span{background:var(--accent)}
.topbar-ham span{display:block;width:16px;height:2px;background:var(--text-dim);transition:background .1s}
.topbar-title{
  font-family:var(--sans);font-size:16px;font-weight:200;
  color:var(--accent);letter-spacing:.08em;text-transform:uppercase;
  flex:1;
}
.topbar-speed{
  -webkit-app-region:no-drag;
  font-family:var(--mono);font-size:11px;color:var(--accent);
  background:transparent;padding:2px 0;letter-spacing:.02em;
}
.topbar-add{
  -webkit-app-region:no-drag;
  background:transparent;color:var(--text);
  border:1px solid var(--border);padding:6px 16px;
  font-family:var(--sans);font-size:11px;font-weight:400;
  letter-spacing:.05em;text-transform:uppercase;
  cursor:pointer;transition:all .1s;
}
.topbar-add:hover{border-color:var(--accent);color:var(--accent)}

/* ── Nav Panel ── */
.nav-overlay{position:fixed;inset:0;z-index:50;display:flex}
.nav-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.4)}
.nav-panel{
  position:relative;z-index:1;width:280px;height:100%;
  background:var(--surface);display:flex;flex-direction:column;
  border-right:1px solid var(--border);
}
.nav-header{
  height:50px;background:var(--surface);
  display:flex;align-items:center;padding:0 16px;gap:12px;
  flex-shrink:0;border-bottom:1px solid var(--border);
}
.nav-header-ham{
  width:32px;height:32px;background:transparent;border:none;
  cursor:pointer;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:4px;padding:0;
}
.nav-header-ham span{display:block;width:16px;height:2px;background:var(--accent)}
.nav-header-title{font-size:15px;font-weight:300;color:var(--text);letter-spacing:.08em;text-transform:uppercase}
.nav-body{flex:1;overflow-y:auto;padding:8px 0}
.nav-body::-webkit-scrollbar{width:3px}
.nav-body::-webkit-scrollbar-thumb{background:var(--border)}
.nav-sep{height:1px;background:var(--border);margin:6px 0}
.nav-item{
  display:flex;align-items:center;gap:14px;padding:11px 20px;
  font-size:12px;font-weight:400;color:var(--text-dim);
  cursor:pointer;border:none;background:none;width:100%;text-align:left;
  transition:all .1s;
}
.nav-item:hover{background:var(--surface2);color:var(--text)}
.nav-item.active{background:var(--surface2);color:var(--accent);font-weight:600}
.nav-item.danger{color:#883333}
.nav-item.danger:hover{background:#1a0c0c;color:#e53935}
.nav-icon{width:18px;text-align:center;font-size:13px;flex-shrink:0}
.nav-footer{padding:12px 20px;border-top:1px solid var(--border);font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:.08em}

/* ── Toolbar ── */
.toolbar{
  display:flex;align-items:center;gap:4px;
  padding:6px 12px;border-bottom:1px solid var(--border);
  background:var(--bg);flex-shrink:0;
}
.tb-btn{
  display:flex;align-items:center;gap:4px;padding:4px 10px;
  font-family:var(--sans);font-size:11px;font-weight:400;
  letter-spacing:.04em;text-transform:uppercase;
  background:transparent;color:var(--text-dim);border:none;cursor:pointer;
  transition:color .1s;
}
.tb-btn:hover:not(:disabled){color:var(--text)}
.tb-btn:disabled{opacity:.15;cursor:not-allowed}
.tb-btn.active-btn{color:var(--accent)}
.tb-sep{width:1px;height:14px;background:var(--border);margin:0 6px;flex-shrink:0}
.tb-right{flex:1;display:flex;justify-content:flex-end}
.tb-search{position:relative;width:180px}
.tb-search input{
  width:100%;background:transparent;border:none;border-bottom:1px solid var(--border);
  padding:4px 8px 4px 20px;color:var(--text);font-family:var(--sans);font-size:11px;
  outline:none;transition:border-color .15s;
}
.tb-search input:focus{border-bottom-color:var(--accent)}
.tb-search input::placeholder{color:var(--text-muted)}
.tb-search .si{position:absolute;left:4px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:12px;pointer-events:none}

/* ── Download List Rows ── */
.list-wrap{flex:1;overflow-y:auto}
.list-wrap::-webkit-scrollbar{width:3px}
.list-wrap::-webkit-scrollbar-thumb{background:var(--border)}
.dl-row{
  display:flex;align-items:center;padding:0;min-height:56px;
  border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s;position:relative;
}
.dl-row:hover{background:var(--surface)}
.dl-row.selected{background:var(--surface2)}
.dl-row.selected::before{content:'';position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--accent)}
.dl-tile{width:54px;height:56px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-right:1px solid var(--border)}
.dl-main{flex:1;min-width:0;padding:8px 14px}
.dl-name{font-size:12px;font-weight:400;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dl-url{font-family:var(--mono);font-size:8px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px}
.dl-meta{display:flex;align-items:center;gap:8px;margin-top:4px}
.dl-size{font-family:var(--mono);font-size:9px;color:var(--text-dim)}
.dl-prog-wrap{width:130px;flex-shrink:0;padding:0 12px}
.dl-prog-track{height:2px;background:var(--border);position:relative}
.dl-prog-fill{height:100%;position:absolute;left:0;top:0}
.dl-prog-pct{font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:4px}
.dl-speed{width:90px;flex-shrink:0;text-align:right;padding-right:12px;font-family:var(--mono);font-size:10px}
.dl-status{width:90px;flex-shrink:0;padding:0 12px}
.st{font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.st.downloading{color:var(--accent)}
.st.done{color:var(--text-dim)}
.st.paused{color:var(--text-muted)}
.st.queued{color:var(--text-muted)}
.st.error{color:#993333}
.dl-actions{width:60px;flex-shrink:0;display:flex;gap:4px;justify-content:center;opacity:0}
.dl-row:hover .dl-actions{opacity:1}
.act-btn{
  width:24px;height:24px;display:flex;align-items:center;justify-content:center;
  background:transparent;border:1px solid var(--border);cursor:pointer;font-size:10px;color:var(--text-dim);
}
.act-btn:hover{border-color:var(--accent);color:var(--accent)}
.act-btn.danger:hover{border-color:#e53935;color:#e53935}

/* ── Empty Canvas State ── */
.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;gap:6px;color:var(--text-muted);background:var(--bg)}
.empty-big{font-size:54px;font-weight:200;color:#1a1a1a;letter-spacing:-0.03em;text-transform:uppercase;line-height:1}
.empty-sub{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)}

/* ── About Canvas View ── */
.about-wrap{flex:1;padding:40px;background:var(--bg);overflow-y:auto;display:flex;flex-direction:column;gap:24px}
.about-header{display:flex;flex-direction:column;gap:4px}
.about-title{font-size:32px;font-weight:200;color:var(--accent);text-transform:uppercase;letter-spacing:.04em}
.about-subtitle{font-size:12px;color:var(--text-dim);letter-spacing:.05em}
.about-divider{height:1px;background:var(--border);width:100%}
.about-grid{display:grid;grid-template-columns:140px 1fr;gap:12px 24px;font-size:13px}
.about-lbl{color:var(--text-dim);text-transform:uppercase;font-size:11px;font-weight:600;letter-spacing:.04em;padding-top:2px}
.about-val{color:var(--text);line-height:1.6}
.about-val span{color:var(--accent);font-family:var(--mono)}
.command-actions{display:flex;gap:8px;flex-wrap:wrap}
.command-note{border:1px solid var(--border);padding:12px 14px;color:var(--text-dim);font-size:12px;line-height:1.6}

/* ── Bottom Status Bar ── */
.statusbar{
  display:flex;align-items:center;height:26px;
  background:var(--bg);border-top:1px solid var(--border);flex-shrink:0;
}
.sb-seg{
  padding:0 16px;height:100%;display:flex;align-items:center;
  font-size:10px;font-weight:400;letter-spacing:.04em;text-transform:uppercase;
  color:var(--text-dim);border-right:1px solid var(--border);
}
.sb-seg span{color:var(--accent);margin-left:6px;font-family:var(--mono)}
.sb-ver{margin-left:auto;padding:0 16px;font-family:var(--mono);font-size:9px;color:var(--text-muted);letter-spacing:.05em}

/* ── Structural Modals ── */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:100}
.modal{background:var(--surface);width:440px;border:1px solid var(--border);box-shadow:none}
.modal-hdr{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 8px}
.modal-title{font-size:14px;font-weight:300;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
.modal-body{padding:0 16px 16px;display:flex;flex-direction:column;gap:12px}
.modal-ftr{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border);background:var(--bg)}
.field{display:flex;flex-direction:column;gap:5px}
.field label{font-size:9px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-dim)}
.field input,.field select{
  background:transparent;border:none;border-bottom:1px solid var(--border);
  padding:6px 4px;color:var(--text);font-family:var(--sans);font-size:12px;outline:none;
}
.field input:focus,.field select:focus{border-bottom-color:var(--accent)}
.field input::placeholder{color:var(--text-muted)}
.field select option{background:var(--surface);color:var(--text)}
.field-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.btn-primary{
  background:transparent;color:var(--accent);border:1px solid var(--accent);
  padding:6px 20px;font-family:var(--sans);font-size:11px;font-weight:400;
  letter-spacing:.05em;text-transform:uppercase;cursor:pointer;transition:all .1s;
}
.btn-primary:hover:not(:disabled){background:var(--accent);color:#000}
.btn-primary:disabled{opacity:.2;border-color:var(--border);color:var(--text-muted);cursor:not-allowed}
.btn-ghost{
  background:transparent;color:var(--text-dim);border:1px solid var(--border);
  padding:6px 16px;font-family:var(--sans);font-size:11px;font-weight:400;
  letter-spacing:.05em;text-transform:uppercase;cursor:pointer;transition:all .1s;
}
.btn-ghost:hover{border-color:var(--text-dim);color:var(--text)}
.act-icon-btn{width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;cursor:pointer;color:var(--text-muted)}
.act-icon-btn:hover{color:var(--text)}
.notice{display:flex;flex-direction:column;gap:2px;padding:8px 10px;font-size:11px;border:1px solid var(--border)}
.notice.cyan{border-left:2px solid var(--accent)}
.notice-label{font-weight:600;letter-spacing:.04em;text-transform:uppercase;font-size:9px;color:var(--accent)}
.notice-url{font-family:var(--mono);font-size:8px;color:var(--text-dim);word-break:break-all}

/* ── Flat Toasts ── */
.toast-wrap{position:fixed;bottom:36px;right:16px;display:flex;flex-direction:column;gap:6px;z-index:300}
.toast{
  background:var(--surface);border:1px solid var(--border);padding:10px 16px;
  font-size:11px;color:var(--text);display:flex;align-items:center;gap:10px;
  letter-spacing:.02em;min-width:240px;
}
.toast.success{border-left:2px solid var(--accent)}
.toast.error{border-left:2px solid #883333}
.toast.info{border-left:2px solid var(--text-dim)}
`;

function Toast({ toasts }) {
  return (
    <div className="toast-wrap">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type}`}>
          <span style={{ fontSize: 9, color: t.type === "success" ? "var(--accent)" : "inherit" }}>
            {t.type === "success" ? "■" : t.type === "error" ? "✕" : "·"}
          </span>
          {t.message}
        </div>
      ))}
    </div>
  );
}

function NavPanel({ activeView, onViewChange, onClose, onClearCompleted }) {
  const handle = (id) => {
    if (id === "exit") { if (window.api?.exit) window.api.exit(); return; }
    if (id === "clear") { onClearCompleted(); onClose(); return; }
    onViewChange(id);
    onClose();
  };

  return (
    <div className="nav-overlay">
      <div className="nav-backdrop" onClick={onClose} />
      <div className="nav-panel">
        <div className="nav-header">
          <button className="nav-header-ham" onClick={onClose}>
            <span /><span /><span />
          </button>
          <span className="nav-header-title">UDM Menu</span>
        </div>
        <div className="nav-body">
          {NAV_ITEMS.map((item, i) =>
            item === null
              ? <div key={i} className="nav-sep" />
              : (
                <button
                  key={item.id}
                  className={`nav-item ${item.danger ? "danger" : ""} ${activeView === item.id ? "active" : ""}`}
                  onClick={() => handle(item.id)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              )
          )}
        </div>
        <div className="nav-footer">UNSYNC SOFTWARE · V0.1.0</div>
      </div>
    </div>
  );
}

function CommandView({ view, onAction }) {
  if (!view) return null;

  return (
    <div className="about-wrap">
      <div className="about-header">
        <div className="about-title">{view.title}</div>
        <div className="about-subtitle">{view.subtitle}</div>
      </div>
      <div className="about-divider" />
      <div className="about-grid">
        {view.rows.map(([label, value]) => (
          <div key={label} style={{ display: "contents" }}>
            <div className="about-lbl">{label}</div>
            <div className="about-val">{value}</div>
          </div>
        ))}
      </div>
      {view.actions?.length > 0 && (
        <div className="command-actions">
          {view.actions.map(([action, label]) => (
            <button key={action} className="btn-primary" onClick={() => onAction(action)}>
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="command-note">
        This panel is wired into the local UDM session and reflects the current desktop integration state.
      </div>
    </div>
  );
}

function AddModal({ onClose, onAdd }) {
  const [rawUrl, setRawUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [threads, setThreads] = useState("4");
  const [conversion, setConversion] = useState(null);

  const handleUrl = (e) => {
    const v = e.target.value;
    setRawUrl(v);
    if (isGoogleDriveUrl(v)) {
      setConversion(convertGoogleDriveUrl(v));
      setFileName("");
    } else {
      setConversion(null);
      if (!fileName) {
        try {
          const parts = new URL(v).pathname.split("/");
          const n = parts[parts.length - 1];
          if (n && n.includes(".")) setFileName(n);
        } catch {}
      }
    }
  };

  const submit = () => {
    if (!rawUrl.trim()) return;
    const finalUrl = conversion ? conversion.url : rawUrl.trim();
    onAdd({ url: finalUrl, fileName: fileName.trim() || rawUrl.split("/").pop() || "download", threads: parseInt(threads) });
    onClose();
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-hdr">
          <span className="modal-title">New Task</span>
          <button className="act-icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Source URL</label>
            <input autoFocus value={rawUrl} onChange={handleUrl} placeholder="https://..." onKeyDown={e => e.key === "Enter" && submit()} />
          </div>
          {conversion?.converted && (
            <div className="notice cyan">
              <div className="notice-label">Google Drive Link Detected</div>
              <div className="notice-url">{conversion.url}</div>
            </div>
          )}
          <div className="field-row">
            <div className="field">
              <label>Save As File Name</label>
              <input value={fileName} onChange={e => setFileName(e.target.value)}
                placeholder={conversion?.converted ? "Filename required" : "Detecting automatically..."}
                style={conversion?.converted && !fileName ? { borderBottomColor: "var(--accent)" } : {}} />
            </div>
            <div className="field">
              <label>Data Connections</label>
              <select value={threads} onChange={e => setThreads(e.target.value)}>
                <option value="1">1 — Isolated</option>
                <option value="2">2 — Dual Pipe</option>
                <option value="4">4 — Quad Split</option>
                <option value="8">8 — Multi Core</option>
              </select>
            </div>
          </div>
        </div>
        <div className="modal-ftr">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={!rawUrl.trim()}>Commit</button>
        </div>
      </div>
    </div>
  );
}

function DlRow({ item, smoothSpeed, selected, onSelect, onPause, onResume, onRemove }) {
  const hasSpeed = smoothSpeed > 0 && item.status === STATUS.DOWNLOADING;
  const color = getFileColor(item.fileName);
  const ext = getFileExt(item.fileName);

  const progColor = {
    downloading: "var(--accent)",
    done: "var(--text-dim)",
    paused: "var(--text-muted)",
    error: "#993333",
    queued: "#222",
  }[item.status] || "var(--accent)";

  return (
    <div className={`dl-row ${selected ? "selected" : ""}`} onClick={() => onSelect(item.id)}>
      <div className="dl-tile" style={{ borderLeft: `3px solid ${color}` }}>
        <span style={{ fontSize: 9, fontWeight: 600, color: "var(--text-dim)", fontFamily: "var(--mono)" }}>
          {ext.slice(0, 3)}
        </span>
      </div>

      <div className="dl-main">
        <div className="dl-name" style={item.status === STATUS.DOWNLOADING ? { color: "var(--accent)" } : {}}>{item.fileName}</div>
        <div className="dl-url">{item.url}</div>
        <div className="dl-meta">
          {item.size > 0 && <span className="dl-size">{formatBytes(item.size)}</span>}
        </div>
      </div>

      <div className="dl-speed" style={{ color: hasSpeed ? "var(--accent)" : "var(--text-muted)" }}>
        {hasSpeed ? formatSpeed(smoothSpeed) : "—"}
      </div>

      <div className="dl-prog-wrap">
        <div className="dl-prog-track">
          <div className="dl-prog-fill" style={{ width: `${item.progress || 0}%`, background: progColor }} />
        </div>
        <div className="dl-prog-pct">{Math.round(item.progress || 0)}%</div>
      </div>

      <div className="dl-status">
        <span className={`st ${item.status}`}>
          {item.status === STATUS.DOWNLOADING ? "Active"
           : item.status === STATUS.DONE ? "Complete"
           : item.status === STATUS.PAUSED ? "Suspended"
           : item.status === STATUS.QUEUED ? "Staged"
           : item.status === STATUS.ERROR ? "Halted" : item.status}
        </span>
      </div>

      <div className="dl-actions">
        {item.status === STATUS.DOWNLOADING && <button className="act-btn" title="Pause" onClick={e => { e.stopPropagation(); onPause(item); }}>⏸</button>}
        {item.status === STATUS.PAUSED && <button className="act-btn" title="Resume" onClick={e => { e.stopPropagation(); onResume(item); }}>▶</button>}
        <button className="act-btn danger" title="Remove" onClick={e => { e.stopPropagation(); onRemove(item.id); }}>✕</button>
      </div>
    </div>
  );
}

export default function App() {
  const [currentView, setCurrentView] = useState("downloads"); // VIEW TRACKING STATE
  const [downloads, setDownloads] = useState([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showNav, setShowNav] = useState(false);
  const [toasts, setToasts] = useState([]);
  const smoothedSpeeds = useSmoothedSpeeds(downloads);

  const toast = (message, type = "info") => {
    const id = uid();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  };

  useEffect(() => {
    if (!window.api) return;
    const unsub = window.api.onDownloadProgress(({ fileName, url, progress, downloadedBytes, totalBytes, speed, status }) => {
      setDownloads(prev => {
        const exists = prev.some(d => d.fileName === fileName);
        if (!exists) {
          const nextStatus =
            status === "done" ? STATUS.DONE :
            status === "error" ? STATUS.ERROR :
            status === "paused" ? STATUS.PAUSED :
            status === "queued" ? STATUS.QUEUED :
            STATUS.DOWNLOADING;

          return [...prev, {
            id: uid(),
            url: url || "",
            fileName,
            threads: 0,
            progress: status === "done" ? 100 : progress || 0,
            status: nextStatus,
            speed: speed || 0,
            size: totalBytes || downloadedBytes || 0,
          }];
        }

        return prev.map(d => {
          if (d.fileName !== fileName) return d;
          if (status === "done")   { toast(`${fileName} — completely verified`, "success"); return { ...d, progress: 100, status: STATUS.DONE, speed: 0, size: totalBytes || d.size, url: url || d.url }; }
          if (status === "error")  { toast(`${fileName} — transfer exception`, "error");    return { ...d, status: STATUS.ERROR, speed: 0, url: url || d.url }; }
          if (status === "paused") return { ...d, status: STATUS.PAUSED, speed: 0, url: url || d.url };
          if (status === "queued") return { ...d, status: STATUS.QUEUED, speed: 0, url: url || d.url };
          return { ...d, progress, status: STATUS.DOWNLOADING, speed: speed || 0, size: totalBytes || d.size, url: url || d.url };
        });
      });
    });
    return unsub;
  }, []);

  const handleAdd = ({ url, fileName, threads }) => {
    if (downloads.find(d => d.fileName === fileName && d.status !== STATUS.DONE)) {
      toast(`Active collision: ${fileName}`, "error"); return;
    }
    setDownloads(prev => [...prev, { id: uid(), url, fileName, threads, progress: 0, status: STATUS.QUEUED, speed: 0, size: 0 }]);
    if (window.api) window.api.startDownload({ url, fileName, threads });
    toast(`Staged item: ${fileName}`);
  };

  const handlePause  = (item) => { if (window.api) window.api.pauseDownload(item.fileName);  setDownloads(p => p.map(d => d.id === item.id ? { ...d, status: STATUS.PAUSED, speed: 0 } : d)); toast(`Suspended: ${item.fileName}`); };
  const handleResume = (item) => { if (window.api) window.api.resumeDownload(item.fileName); setDownloads(p => p.map(d => d.id === item.id ? { ...d, status: STATUS.DOWNLOADING } : d)); toast(`Resumed: ${item.fileName}`); };
  const handleRemove = (id)   => { setDownloads(p => p.filter(d => d.id !== id)); if (selected === id) setSelected(null); };
  const handleClear  = ()     => { setDownloads(p => p.filter(d => d.status !== STATUS.DONE)); toast("Purged all completed operations"); };
  const handleCommand = (action) => {
    if (action === "open-downloads") { setCurrentView("downloads"); return; }
    if (action === "open-add") { setCurrentView("downloads"); setShowModal(true); return; }
    if (action === "clear-done") { handleClear(); return; }
    if (action === "export-queue") {
      const payload = JSON.stringify(downloads.map(({ fileName, url, progress, status, size }) => ({ fileName, url, progress, status, size })), null, 2);
      const blob = new Blob([payload], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "udm-queue.json";
      link.click();
      URL.revokeObjectURL(link.href);
      toast("Queue snapshot exported", "success");
      return;
    }
    if (action === "copy-diagnostics") {
      const text = `UDM v0.1.0 | items=${downloads.length} | active=${activeCount}`;
      navigator.clipboard?.writeText(text).then(
        () => toast("Diagnostics copied", "success"),
        () => toast(text)
      );
      return;
    }
    if (action === "test-listener") { toast("Listener expected at localhost:3001"); return; }
    if (action === "check-update") { toast("No remote updater configured"); return; }
    if (action === "language-english") { toast("English interface active", "success"); return; }
  };

  const filtered = downloads.filter(d => !search || d.fileName.toLowerCase().includes(search.toLowerCase()) || d.url.toLowerCase().includes(search.toLowerCase()));
  const activeCount = downloads.filter(d => d.status === STATUS.DOWNLOADING).length;
  const totalSpeed  = Object.values(smoothedSpeeds).reduce((a, b) => a + b, 0);
  const selItem     = downloads.find(d => d.id === selected);
  const hasCompleted = downloads.some(d => d.status === STATUS.DONE);

  return (
    <>
      <style>{css}</style>
      <div className="app">

        {/* Topbar Layout */}
        <div className="topbar">
          <button className="topbar-ham" onClick={() => setShowNav(true)}>
            <span /><span /><span />
          </button>
          <span className="topbar-title">Unsync Download Manager</span>
          {totalSpeed > 0 && <div className="topbar-speed">↓ {formatSpeed(totalSpeed)}</div>}
          <button className="topbar-add" onClick={() => { setCurrentView("downloads"); setShowModal(true); }}>+ Add URL</button>
        </div>

        {/* CONDITIONALLY RENDER MAIN OPERATIONS OR VIEW PANELS */}
        {currentView === "downloads" && (
          <>
            {/* Flat Toolbar */}
            <div className="toolbar">
              <button className="tb-btn" disabled={!selItem || selItem.status !== STATUS.DOWNLOADING} onClick={() => selItem && handlePause(selItem)}>Pause</button>
              <button className="tb-btn" disabled={!selItem || selItem.status !== STATUS.PAUSED}      onClick={() => selItem && handleResume(selItem)}>Resume</button>
              <div className="tb-sep" />
              <button className="tb-btn" disabled={!selItem} onClick={() => selItem && handleRemove(selItem.id)}>Remove</button>
              <button className="tb-btn" disabled={!hasCompleted} onClick={handleClear}>Clear Done</button>
              <div className="tb-right">
                <div className="tb-search">
                  <span className="si">⌕</span>
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search queue..." />
                </div>
              </div>
            </div>

            {/* Data Context List */}
            {filtered.length === 0 ? (
              <div className="empty">
                <div className="empty-big">UDM</div>
                <div className="empty-sub">No operational tasks active</div>
              </div>
            ) : (
              <div className="list-wrap">
                {filtered.map(item => (
                  <DlRow key={item.id} item={item} smoothSpeed={smoothedSpeeds[item.id] ?? 0}
                    selected={selected === item.id} onSelect={setSelected}
                    onPause={handlePause} onResume={handleResume} onRemove={handleRemove} />
                ))}
              </div>
            )}
          </>
        )}

        {COMMAND_VIEWS[currentView] && (
          <CommandView view={COMMAND_VIEWS[currentView]} onAction={handleCommand} />
        )}

        {/* ── ABOUT CANVAS VIEW MODULE ── */}
        {currentView === "about" && (
          <div className="about-wrap">
            <div className="about-header">
              <div className="about-title">About UDM</div>
              <div className="about-subtitle">Unsync Download Manager Architecture System</div>
            </div>
            <div className="about-divider" />
            <div className="about-grid">
              <div className="about-lbl">Application</div>
              <div className="about-val">Unsync Download Manager (UDM)</div>

              <div className="about-lbl">Build Version</div>
              <div className="about-val"><span>v0.1.0</span> (Stable Desktop Kernel)</div>

              <div className="about-lbl">Framework</div>
              <div className="about-val">Electron / React Environment (Metro UI Specifications)</div>

              <div className="about-lbl">Features</div>
              <div className="about-val">Asynchronous chunked file segmentation, pre-key parallel network pipelines, and automated Google Drive link translation maps.</div>

              <div className="about-lbl">Design Mantra</div>
              <div className="about-val">Zero-data footprint optimization with flat structural edge constraints.</div>
            </div>
          </div>
        )}

        {/* Status Tracebar */}
        <div className="statusbar">
          <div className="sb-seg">Active<span>{activeCount}</span></div>
          <div className="sb-seg">Queued<span>{downloads.filter(d => d.status === STATUS.QUEUED).length}</span></div>
          <div className="sb-seg">Done<span>{downloads.filter(d => d.status === STATUS.DONE).length}</span></div>
          {totalSpeed > 0 && <div className="sb-seg">Throughput<span>{formatSpeed(totalSpeed)}</span></div>}
          <div className="sb-ver">UDM V0.1.0</div>
        </div>
      </div>

      {/* Nav sliding frame overlay */}
      {showNav && (
        <NavPanel 
          activeView={currentView} 
          onViewChange={setCurrentView} 
          onClose={() => setShowNav(false)} 
          onClearCompleted={handleClear} 
        />
      )}

      {/* Management task modal template */}
      {showModal && <AddModal onClose={() => setShowModal(false)} onAdd={handleAdd} />}

      <Toast toasts={toasts} />
    </>
  );
}
