const { app, BrowserWindow, ipcMain, Menu, screen } = require("electron");
const path = require("path");
const fs = require("fs");

const DATA_FILE = () => path.join(app.getPath("userData"), "data.json");
const EMPTY = {
  homework: [],
  goals: [],
  notes: [],
  memos: {},
  planLog: {},
  plannerSubjects: ["국어", "수학", "영어", "과학", "사회"],
  settings: { theme: "dark", widgetOpen: false, widgetOnTop: true, manageDay: 0, uiScale: 1 },
};

let data = null;
let mainWin = null;
let widgetWin = null;

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE(), "utf8"));
    return { ...EMPTY, ...parsed, settings: { ...EMPTY.settings, ...(parsed.settings || {}) } };
  } catch {
    return structuredClone(EMPTY);
  }
}

// Write to a temp file and rename so a crash mid-write never corrupts the data.
function save() {
  const file = DATA_FILE();
  const tmp = file + ".tmp";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function broadcast(except) {
  for (const win of [mainWin, widgetWin]) {
    if (win && !win.isDestroyed() && win.webContents !== except) win.webContents.send("data:changed", data);
  }
}

const webPrefs = {
  preload: path.join(__dirname, "preload.js"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

const ICON = path.join(__dirname, "assets", "icon.png");

// The layout is designed at 1120x740. Bigger windows (maximized, full screen) scale the whole UI up,
// smaller ones scale it down a little; the user's own scale (Ctrl +/-) multiplies on top.
const BASE_W = 1120;
const BASE_H = 740;
function applyZoom() {
  if (!mainWin || mainWin.isDestroyed()) return;
  const [w, h] = mainWin.getContentSize();
  const ratio = Math.min(w / BASE_W, h / BASE_H);
  // Grow a bit slower than the window so big screens also get more room, not just bigger text.
  const auto = ratio >= 1 ? Math.min(1.75, 1 + (ratio - 1) * 0.75) : Math.max(0.9, ratio);
  const f = Math.round(auto * (data.settings.uiScale || 1) * 100) / 100;
  if (Math.abs(mainWin.webContents.getZoomFactor() - f) > 0.005) mainWin.webContents.setZoomFactor(f);
}

function setScale(next) {
  data.settings.uiScale = Math.round(Math.min(1.5, Math.max(0.7, next)) * 10) / 10;
  save();
  applyZoom();
  broadcast();
}

function createMain() {
  const b = data.settings.mainBounds;
  mainWin = new BrowserWindow({
    width: b ? b.width : BASE_W,
    height: b ? b.height : 760,
    x: b ? b.x : undefined,
    y: b ? b.y : undefined,
    minWidth: 820,
    minHeight: 600,
    title: "숙제 & 목표",
    icon: ICON,
    backgroundColor: data.settings.theme === "light" ? "#f4f5fa" : "#14161f",
    autoHideMenuBar: true,
    webPreferences: webPrefs,
  });
  if (data.settings.maximized) mainWin.maximize();
  mainWin.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWin.webContents.setVisualZoomLevelLimits(1, 1);
  mainWin.webContents.on("did-finish-load", applyZoom);
  for (const ev of ["resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
    mainWin.on(ev, () => setImmediate(applyZoom));
  }
  mainWin.on("close", () => {
    data.settings.maximized = mainWin.isMaximized();
    if (!mainWin.isMaximized() && !mainWin.isFullScreen()) data.settings.mainBounds = mainWin.getBounds();
    save();
  });
  mainWin.on("closed", () => {
    mainWin = null;
    if (widgetWin && !widgetWin.isDestroyed()) widgetWin.close();
  });
}

function createWidget() {
  if (widgetWin && !widgetWin.isDestroyed()) {
    widgetWin.show();
    return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const saved = data.settings.widgetBounds;
  widgetWin = new BrowserWindow({
    width: 300,
    height: 420,
    x: saved ? saved.x : area.x + area.width - 320,
    y: saved ? saved.y : area.y + 20,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    icon: ICON,
    alwaysOnTop: data.settings.widgetOnTop,
    transparent: true,
    hasShadow: true,
    webPreferences: webPrefs,
  });
  widgetWin.loadFile(path.join(__dirname, "renderer", "widget.html"));
  widgetWin.on("moved", () => {
    data.settings.widgetBounds = widgetWin.getBounds();
    save();
  });
  widgetWin.on("closed", () => {
    widgetWin = null;
    if (mainWin) {
      data.settings.widgetOpen = false;
      save();
      broadcast();
    }
  });
}

ipcMain.handle("data:get", () => data);

ipcMain.on("data:set", (event, next) => {
  const wasOpen = data.settings.widgetOpen;
  const wasOnTop = data.settings.widgetOnTop;
  data = next;
  save();
  broadcast(event.sender);
  if (data.settings.widgetOpen && !wasOpen) createWidget();
  if (!data.settings.widgetOpen && wasOpen && widgetWin) widgetWin.close();
  if (widgetWin && data.settings.widgetOnTop !== wasOnTop) widgetWin.setAlwaysOnTop(data.settings.widgetOnTop);
});

ipcMain.on("widget:close", () => widgetWin && widgetWin.close());
ipcMain.on("zoom:set", (_e, value) => setScale(value));
ipcMain.on("main:show", () => {
  if (!mainWin) createMain();
  else {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  }
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => mainWin && mainWin.focus());

  app.whenReady().then(() => {
    data = load();
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
        {
          label: "보기",
          submenu: [
            { label: "위젯 열기", click: () => { data.settings.widgetOpen = true; save(); createWidget(); broadcast(); } },
            { type: "separator" },
            { role: "togglefullscreen", label: "전체 화면", accelerator: "F11" },
            { label: "크게", accelerator: "CmdOrCtrl+=", click: () => setScale((data.settings.uiScale || 1) + 0.1) },
            { label: "크게 ", accelerator: "CmdOrCtrl+Plus", visible: false, click: () => setScale((data.settings.uiScale || 1) + 0.1) },
            { label: "작게", accelerator: "CmdOrCtrl+-", click: () => setScale((data.settings.uiScale || 1) - 0.1) },
            { label: "원래 크기", accelerator: "CmdOrCtrl+0", click: () => setScale(1) },
            { type: "separator" },
            { role: "reload", label: "새로고침" },
            { role: "toggleDevTools", label: "개발자 도구" },
          ],
        },
        { role: "editMenu", label: "편집" },
      ])
    );
    createMain();
    if (data.settings.widgetOpen) createWidget();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMain();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
