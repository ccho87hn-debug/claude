const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen } = require("electron");
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
  settings: { theme: "dark", widgetOpen: false, widgetOnTop: true, manageDay: 0, uiScale: 1, autoStart: false },
};

let data = null;
let mainWin = null;
let widgetWin = null;
let tray = null;

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
    backgroundColor: require("./renderer/themes.js").byId(data.settings.theme).bg,
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
  // Closing the main window leaves the widget running; the tray icon reopens the app or quits it.
  mainWin.on("closed", () => {
    mainWin = null;
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
  // Only the user's own close (widget X, tray, settings) turns the widget off. A quit or a
  // Windows shutdown also closes this window, and the widget should come back next time.
  widgetWin.on("closed", () => {
    widgetWin = null;
    updateTray();
  });
  updateTray();
}

function showMain() {
  if (!mainWin) createMain();
  else {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
  }
}

function setWidget(open) {
  data.settings.widgetOpen = open;
  save();
  if (open) createWidget();
  else if (widgetWin) widgetWin.close();
  broadcast();
}

// Tray icon: the way back to the app (and the way to quit) while only the widget is open.
function updateTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
    tray.setToolTip("숙제 & 목표");
    tray.on("click", showMain);
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "앱 열기", click: showMain },
    { label: widgetWin ? "위젯 닫기" : "위젯 열기", click: () => setWidget(!widgetWin) },
    { type: "separator" },
    { label: "종료", click: () => app.quit() },
  ]));
}

// Start with Windows (or macOS login) so the widget comes back after a restart.
function applyAutoStart() {
  if (!app.isPackaged) return; // dev runs (npm start) would register the bare Electron binary
  app.setLoginItemSettings({ openAtLogin: !!data.settings.autoStart, args: ["--hidden"] });
}

ipcMain.handle("data:get", () => data);

ipcMain.on("data:set", (event, next) => {
  const wasOpen = data.settings.widgetOpen;
  const wasOnTop = data.settings.widgetOnTop;
  const wasAuto = data.settings.autoStart;
  data = next;
  save();
  broadcast(event.sender);
  if (data.settings.widgetOpen && !wasOpen) createWidget();
  if (!data.settings.widgetOpen && wasOpen && widgetWin) widgetWin.close();
  if (widgetWin && data.settings.widgetOnTop !== wasOnTop) widgetWin.setAlwaysOnTop(data.settings.widgetOnTop);
  if (data.settings.autoStart !== wasAuto) applyAutoStart();
});

ipcMain.on("widget:close", () => setWidget(false));
ipcMain.on("zoom:set", (_e, value) => setScale(value));
ipcMain.on("main:show", showMain);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showMain);

  app.whenReady().then(() => {
    data = load();
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
        {
          label: "보기",
          submenu: [
            { label: "위젯 열기", click: () => setWidget(true) },
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
    // Started at login: show just the widget if it was on, so the desktop isn't covered by the app.
    const hidden = process.argv.includes("--hidden");
    if (!hidden || !data.settings.widgetOpen) createMain();
    if (data.settings.widgetOpen) createWidget();
    updateTray();
    applyAutoStart();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createMain();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
