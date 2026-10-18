const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  load: () => ipcRenderer.invoke("data:get"),
  save: (data) => ipcRenderer.send("data:set", data),
  onChange: (fn) => ipcRenderer.on("data:changed", (_e, data) => fn(data)),
  closeWidget: () => ipcRenderer.send("widget:close"),
  showMain: () => ipcRenderer.send("main:show"),
});
