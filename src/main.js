const { app, BrowserWindow, ipcMain, Menu, screen } = require("electron");
const path = require("path");
const fs = require("fs");

const DATA_FILE = () => path.join(app.getPath("userData"), "data.json");
const EMPTY = { homework: [], goals: [], notes: [], memos: {}, settings: { theme: "dark", widgetOpen: false, widgetOnTop: true } };

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

function createMain() {
  mainWin = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 820,
    minHeight: 600,
    title: "숙제 & 목표",
    backgroundColor: data.settings.theme === "light" ? "#f4f5fa" : "#14161f",
    autoHideMenuBar: true,
    webPreferences: webPrefs,
  });
  mainWin.loadFile(path.join(__dirname, "renderer", "index.html"));
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
