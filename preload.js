const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  compileArduino: (data) => ipcRenderer.invoke("compile-arduino", data),
});
