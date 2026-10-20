const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#12141c",
    title: "가위바위보 배틀",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

Menu.setApplicationMenu(null);
app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
