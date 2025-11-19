const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { compileArduino } = require("./arduinoHandler");

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.loadFile(path.join(__dirname, "renderer/index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// IPC listener for compile requests
ipcMain.handle("compile-arduino", async (event, { code, board }) => {
  try {
    const result = await compileArduino(code, board);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});
