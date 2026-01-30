/**
 * Arduino Cloud IDE - Main Process
 * Electron main process with IPC handlers for all services
 */

const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const {
  compileArduino,
  installBoardPackage,
  listInstalledBoards,
  searchLibraries,
  installLibrary,
  listInstalledLibraries,
  searchBoardPlatforms,
  getFeaturedLibraries
} = require("./arduinoHandler");

// Import services
const authService = require("./src/services/authService");

// Terminal support
let pty;
try {
  pty = require('node-pty');
} catch (e) {
  console.log('node-pty not found:', e);
}
const boardService = require("./src/services/boardService");
const firmwareService = require("./src/services/firmwareService");
const provisioningService = require("./src/services/provisioningService");
const { APPWRITE_CONFIG } = require("./src/config/appwriteConfig");

// =============================================================================
// WINDOW MANAGEMENT
// =============================================================================

let mainWindow = null;
let authWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: "Arduino Knurdz IDE",
    backgroundColor: "#1e1e2e",
    show: false,
    maximizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer/index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Create application menu
  createMenu();
}

function createAuthWindow() {
  authWindow = new BrowserWindow({
    width: 500,
    height: 700,
    resizable: true,
    minWidth: 400,
    minHeight: 500,
    title: "Arduino Knurdz IDE - Login",
    backgroundColor: "#1e1e2e",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  authWindow.loadFile(path.join(__dirname, "renderer/auth.html"));

  authWindow.once("ready-to-show", () => {
    authWindow.show();
  });

  authWindow.on("closed", () => {
    authWindow = null;
  });
}

function createMenu() {
  const isMac = process.platform === "darwin";

  // Get recent files from store
  const recentFiles = store.get('recentFiles') || [];

  const recentFilesSubmenu = recentFiles.map(file => ({
    label: path.basename(file),
    click: () => mainWindow?.webContents.send('menu-open-file', file)
  }));

  if (recentFilesSubmenu.length > 0) {
    recentFilesSubmenu.push({ type: 'separator' });
    recentFilesSubmenu.push({
      label: 'Clear Recent',
      click: () => {
        store.set('recentFiles', []);
        createMenu();
      }
    });
  } else {
    recentFilesSubmenu.push({ label: 'No Recent Files', enabled: false });
  }

  // Basic Examples List
  const examplesSubmenu = [
    {
      label: '01.Basics',
      submenu: [
        { label: 'Blink', click: () => loadExample('Blink') },
        { label: 'BareMinimum', click: () => loadExample('BareMinimum') },
        { label: 'AnalogReadSerial', click: () => loadExample('AnalogReadSerial') }
      ]
    },
    {
      label: '02.Digital',
      submenu: [
        { label: 'BlinkWithoutDelay', click: () => loadExample('BlinkWithoutDelay') },
        { label: 'Button', click: () => loadExample('Button') }
      ]
    }
  ];

  const template = [
    // FILE MENU
    {
      label: "File",
      submenu: [
        { label: "New", accelerator: "CmdOrCtrl+N", click: () => mainWindow?.webContents.send("menu-new-sketch") },
        { label: "Open...", accelerator: "CmdOrCtrl+O", click: () => mainWindow?.webContents.send("menu-open-sketch") },
        {
          label: "Open Recent",
          submenu: recentFilesSubmenu
        },
        {
          label: "Sketchbook",
          submenu: [
            // Placeholder: Dynamic list
            { label: "Empty", enabled: false }
          ]
        },
        {
          label: "Examples",
          submenu: examplesSubmenu
        },
        { label: "Close", accelerator: "CmdOrCtrl+W", click: () => mainWindow?.webContents.send("menu-close-sketch") },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: () => mainWindow?.webContents.send("menu-save") },
        { label: "Save As...", accelerator: "CmdOrCtrl+Shift+S", click: () => mainWindow?.webContents.send("menu-save-as") },
        { type: "separator" },
        { label: "Page Setup", click: () => mainWindow?.webContents.send("menu-page-setup") },
        { label: "Print", accelerator: "CmdOrCtrl+P", click: () => mainWindow?.webContents.print() }, // Native print
        { type: "separator" },
        { label: "Preferences", accelerator: "CmdOrCtrl+Comma", click: () => mainWindow?.webContents.send("menu-preferences") },
        { type: "separator" },
        { label: "Quit", role: "quit" }
      ]
    },
    // EDIT MENU
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { label: "Copy for Forum", click: () => mainWindow?.webContents.send("menu-copy-forum") },
        { label: "Copy as HTML", click: () => mainWindow?.webContents.send("menu-copy-html") },
        { role: "paste" },
        { role: "selectall" },
        { type: "separator" },
        { label: "Comment/Uncomment", accelerator: "CmdOrCtrl+/", click: () => mainWindow?.webContents.send("menu-comment") },
        { label: "Increase Indent", accelerator: "Tab", click: () => mainWindow?.webContents.send("menu-indent-increase") },
        { label: "Decrease Indent", accelerator: "Shift+Tab", click: () => mainWindow?.webContents.send("menu-indent-decrease") },
        { type: "separator" },
        { label: "Find...", accelerator: "CmdOrCtrl+F", click: () => mainWindow?.webContents.send("menu-find") },
        { label: "Find Next", accelerator: "CmdOrCtrl+G", click: () => mainWindow?.webContents.send("menu-find-next") },
        { label: "Find Previous", accelerator: "CmdOrCtrl+Shift+G", click: () => mainWindow?.webContents.send("menu-find-previous") }
      ]
    },
    // SKETCH MENU
    {
      label: "Sketch",
      submenu: [
        { label: "Verify/Compile", accelerator: "CmdOrCtrl+R", click: () => mainWindow?.webContents.send("menu-compile") },
        { label: "Upload", accelerator: "CmdOrCtrl+U", click: () => mainWindow?.webContents.send("menu-upload") },
        { label: "Upload Using Programmer", accelerator: "CmdOrCtrl+Shift+U", click: () => mainWindow?.webContents.send("menu-upload-programmer") },
        { label: "Export Compiled Binary", accelerator: "CmdOrCtrl+Alt+S", click: () => mainWindow?.webContents.send("menu-export-binary") },
        { type: "separator" },
        { label: "Show Sketch Folder", accelerator: "CmdOrCtrl+K", click: () => mainWindow?.webContents.send("menu-show-sketch-folder") },
        {
          label: "Include Library",
          submenu: [
            { label: "Manage Libraries...", click: () => mainWindow?.webContents.send("menu-manage-libraries") },
            { label: "Add .ZIP Library...", click: () => mainWindow?.webContents.send("menu-add-zip-library") },
            { type: "separator" }
            // Placeholder: List of installed libraries
          ]
        },
        { label: "Add File...", click: () => mainWindow?.webContents.send("menu-add-file") }
      ]
    },
    // TOOLS MENU
    {
      label: "Tools",
      submenu: [
        { label: "Auto Format", accelerator: "CmdOrCtrl+T", click: () => mainWindow?.webContents.send("menu-auto-format") },
        { label: "Archive Sketch", click: () => mainWindow?.webContents.send("menu-archive-sketch") },
        { label: "Fix Encoding & Reload", click: () => mainWindow?.webContents.send("menu-fix-encoding") },
        { type: "separator" },
        { label: "Serial Monitor", accelerator: "CmdOrCtrl+Shift+M", click: () => mainWindow?.webContents.send("menu-serial-monitor") },
        { type: "separator" },
        {
          label: "Board",
          submenu: [
            { label: "Boards Manager...", click: () => mainWindow?.webContents.send("menu-boards-manager") },
            { type: "separator" }
            // Placeholder: Board selection
          ]
        },
        {
          label: "Port",
          submenu: [
            // Placeholder: Port selection
          ]
        },
        {
          label: "Programmer",
          submenu: [
            // Placeholder: Programmer selection
          ]
        },
        { label: "Burn Bootloader", click: () => mainWindow?.webContents.send("menu-burn-bootloader") }
      ]
    },
    // HELP MENU
    {
      label: "Help",
      submenu: [
        { label: "Getting Started", click: () => require("electron").shell.openExternal("https://docs.arduino.cc/learn/starting-guide/getting-started-arduino") },
        { label: "Environment", click: () => require("electron").shell.openExternal("https://docs.arduino.cc/software/ide-v2") },
        { label: "Troubleshooting", click: () => require("electron").shell.openExternal("https://docs.arduino.cc/learn/starting-guide/troubleshooting") },
        { label: "Reference", click: () => require("electron").shell.openExternal("https://www.arduino.cc/reference/en/") },
        { type: "separator" },
        { label: "Find in Reference", accelerator: "CmdOrCtrl+Shift+F", click: () => mainWindow?.webContents.send("menu-find-reference") },
        { type: "separator" },
        { label: "About Arduino Knurdz IDE", click: () => mainWindow?.webContents.send("menu-about") }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// =============================================================================
// APP LIFECYCLE
// =============================================================================

app.whenReady().then(async () => {
  // Check if user is authenticated
  // const authResult = await authService.getCurrentUser();

  // if (authResult.success && authResult.user) {
  //   createMainWindow();
  // } else {
  //   createAuthWindow();
  // }

  // SKIP LOGIN FOR DEVELOPMENT
  // createAuthWindow();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// =============================================================================
// AUTHENTICATION IPC HANDLERS
// =============================================================================

ipcMain.handle("auth-login", async (event, { email, password }) => {
  const result = await authService.login(email, password);
  if (result.success) {
    // Close auth window and open main window
    if (authWindow) {
      authWindow.close();
    }
    createMainWindow();
  }
  return result;
});

ipcMain.handle("auth-register", async (event, { email, password, name }) => {
  const result = await authService.register(email, password, name);
  if (result.success) {
    // Close auth window and open main window
    if (authWindow) {
      authWindow.close();
    }
    createMainWindow();
  }
  return result;
});

ipcMain.handle("auth-logout", async () => {
  const result = await authService.logout();
  if (result.success) {
    // Close main window and open auth window
    if (mainWindow) {
      mainWindow.close();
    }
    createAuthWindow();
  }
  return result;
});

ipcMain.handle("auth-get-user", async () => {
  return await authService.getCurrentUser();
});

// =============================================================================
// BOARD MANAGEMENT IPC HANDLERS
// =============================================================================

ipcMain.handle("boards-list", async (event) => {
  const userResult = await authService.getCurrentUser();
  if (!userResult.success) {
    return { success: false, error: "Not authenticated" };
  }
  return await boardService.listBoards(userResult.user.$id);
});

ipcMain.handle("boards-create", async (event, boardData) => {
  const userResult = await authService.getCurrentUser();
  if (!userResult.success) {
    return { success: false, error: "Not authenticated" };
  }
  return await boardService.createBoard(userResult.user.$id, boardData);
});

ipcMain.handle("boards-get", async (event, boardId) => {
  return await boardService.getBoard(boardId);
});

ipcMain.handle("boards-update", async (event, { id, data }) => {
  return await boardService.updateBoard(id, data);
});

ipcMain.handle("boards-delete", async (event, boardId) => {
  return await boardService.deleteBoard(boardId);
});

ipcMain.handle("boards-regenerate-token", async (event, boardId) => {
  return await boardService.regenerateToken(boardId);
});

// =============================================================================
// COMPILATION IPC HANDLERS
// =============================================================================

ipcMain.handle("compile-arduino", async (event, { code, board }) => {
  try {
    const result = await compileArduino(code, board);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("install-board-package", async (event, { packageUrl, packageName }) => {
  try {
    const onProgress = (data) => {
      // Send progress to renderer
      event.sender.send("install-progress", data);
    };

    const result = await installBoardPackage(packageUrl, packageName, onProgress);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("list-installed-boards", async () => {
  try {
    const result = await listInstalledBoards();
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});



// =============================================================================
// LIBRARY & BOARD MANAGER IPC HANDLERS
// =============================================================================

ipcMain.handle("libraries-search", async (event, query) => {
  try {
    const result = await searchLibraries(query);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("libraries-install", async (event, { name, version }) => {
  try {
    const result = await installLibrary(name, version);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("libraries-list", async () => {
  try {
    const result = await listInstalledLibraries();
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("libraries-featured", async () => {
  try {
    const result = await getFeaturedLibraries();
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("search-board-platforms", async (event, query) => {
  try {
    const result = await searchBoardPlatforms(query);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("list-installed-platforms", async () => {
  try {
    const result = await require("./arduinoHandler").listInstalledPlatforms();
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("remove-board-package", async (event, { packageName }) => {
  try {
    const onProgress = (data) => {
      event.sender.send("install-progress", data);
    };
    const result = await require("./arduinoHandler").removeBoardPackage(packageName, onProgress);
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// =============================================================================
// FIRMWARE & OTA IPC HANDLERS
// =============================================================================

ipcMain.handle("firmware-upload", async (event, { boardId, code, board, version }) => {
  try {
    // First compile the code
    const compileResult = await compileArduino(code, board);

    if (!compileResult.success) {
      return { success: false, error: compileResult.error || "Compilation failed" };
    }

    // Convert base64 to buffer
    const binaryBuffer = Buffer.from(compileResult.binData, "base64");

    // Upload to cloud
    const uploadResult = await firmwareService.uploadFirmware(
      boardId,
      binaryBuffer,
      version,
      compileResult.filename
    );

    if (!uploadResult.success) {
      return uploadResult;
    }

    // Deploy the firmware
    const deployResult = await firmwareService.deployFirmware(uploadResult.firmware.$id);

    return {
      success: true,
      message: "Firmware compiled and uploaded successfully!",
      firmware: uploadResult.firmware,
      deployed: deployResult.success
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("firmware-history", async (event, boardId) => {
  return await firmwareService.getFirmwareHistory(boardId);
});

ipcMain.handle("firmware-deploy", async (event, firmwareId) => {
  return await firmwareService.deployFirmware(firmwareId);
});

ipcMain.handle("firmware-delete", async (event, firmwareId) => {
  return await firmwareService.deleteFirmware(firmwareId);
});

// =============================================================================
// PROVISIONING IPC HANDLERS
// =============================================================================

ipcMain.handle("ports-list", async () => {
  return await provisioningService.listPorts();
});

ipcMain.handle("provision-board", async (event, { boardId, port }) => {
  // Get board details
  const boardResult = await boardService.getBoard(boardId);

  if (!boardResult.success) {
    return boardResult;
  }

  return await provisioningService.provisionBoard(
    boardResult.board,
    port,
    APPWRITE_CONFIG
  );
});

ipcMain.handle("install-esp32-support", async () => {
  return await provisioningService.installBoardSupport();
});

// =============================================================================
// UTILITY IPC HANDLERS
// =============================================================================

ipcMain.handle("get-app-version", () => {
  return app.getVersion();
});

ipcMain.handle("get-appwrite-config", () => {
  // Return only non-sensitive config
  return {
    endpoint: APPWRITE_CONFIG.endpoint,
    projectId: APPWRITE_CONFIG.projectId
  };
});

// =============================================================================
// FILE SYSTEM IPC HANDLERS
// =============================================================================

const fs = require('fs').promises;
const { dialog, shell } = require('electron');

// electron-store v3+ uses ES module default export
let store;
(async () => {
  const Store = (await import('electron-store')).default;
  store = new Store();
})();

// Open folder dialog
ipcMain.handle("fs-open-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  const folderPath = result.filePaths[0];

  // Save to workspace persistence
  store.set('lastWorkspace', folderPath);

  return { success: true, path: folderPath };
});

// Show save dialog
ipcMain.handle("fs-show-save-dialog", async (event, { defaultPath, filters }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters
  });

  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true };
  }

  return { success: true, path: result.filePath };
});

// Get last opened workspace
ipcMain.handle("fs-get-last-workspace", async () => {
  const lastWorkspace = store.get('lastWorkspace');
  if (lastWorkspace) {
    try {
      await fs.access(lastWorkspace);
      return { success: true, path: lastWorkspace };
    } catch {
      return { success: false };
    }
  }
  return { success: false };
});

// Read directory contents recursively (1 level for performance)
ipcMain.handle("fs-read-directory", async (event, dirPath) => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const items = [];

    for (const entry of entries) {
      // Skip hidden files and common ignore patterns
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const fullPath = path.join(dirPath, entry.name);
      const isDirectory = entry.isDirectory();

      items.push({
        name: entry.name,
        path: fullPath,
        isDirectory,
        extension: isDirectory ? null : path.extname(entry.name).toLowerCase()
      });
    }

    // Sort: folders first, then files alphabetically
    items.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return { success: true, items };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Read file content
ipcMain.handle("fs-read-file", async (event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { success: true, content, path: filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Write file content
ipcMain.handle("fs-write-file", async (event, { filePath, content }) => {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Create new file
ipcMain.handle("fs-create-file", async (event, { folderPath, fileName, content = '' }) => {
  try {
    const filePath = path.join(folderPath, fileName);

    // Check if file exists
    try {
      await fs.access(filePath);
      return { success: false, error: 'File already exists' };
    } catch {
      // File doesn't exist, good to create
    }

    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true, path: filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Create new folder
ipcMain.handle("fs-create-folder", async (event, { parentPath, folderName }) => {
  try {
    const folderPath = path.join(parentPath, folderName);
    await fs.mkdir(folderPath, { recursive: true });
    return { success: true, path: folderPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Delete file or folder
ipcMain.handle("fs-delete", async (event, targetPath) => {
  try {
    const stat = await fs.stat(targetPath);
    if (stat.isDirectory()) {
      await fs.rm(targetPath, { recursive: true });
    } else {
      await fs.unlink(targetPath);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Helper to load example
function loadExample(name) {
  const examples = {
    'Blink': `// Blink\nvoid setup() {\n  pinMode(LED_BUILTIN, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(LED_BUILTIN, HIGH);\n  delay(1000);\n  digitalWrite(LED_BUILTIN, LOW);\n  delay(1000);\n}`,
    'BareMinimum': `void setup() {\n  // put your setup code here, to run once:\n}\n\nvoid loop() {\n  // put your main code here, to run repeatedly:\n}`,
    // Add others as needed
  };

  const content = examples[name] || `// Example ${name} not found`;
  mainWindow?.webContents.send('menu-new-sketch-content', { name, content });
}

// Add to recent files
ipcMain.handle('add-recent-file', (event, filePath) => {
  let recent = store.get('recentFiles') || [];
  // Remove if exists
  recent = recent.filter(p => p !== filePath);
  // Add to top
  recent.unshift(filePath);
  // Limit to 10
  recent = recent.slice(0, 10);
  store.set('recentFiles', recent);
  createMenu(); // Rebuild menu
  return { success: true };
});

// Rename file or folder
ipcMain.handle("fs-rename", async (event, { oldPath, newPath }) => {
  try {
    await fs.rename(oldPath, newPath);
    return { success: true, path: newPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Open file in system default app

ipcMain.on('terminal-write', (event, data) => {
  if (ptyProcess) {
    ptyProcess.write(data);
  }
});

ipcMain.on('terminal-resize', (event, { cols, rows }) => {
  if (ptyProcess) {
    ptyProcess.resize(cols, rows);
  }
});
