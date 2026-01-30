const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec, spawn } = require("child_process");

/**
 * Get path to bundled arduino-cli binary based on OS and architecture
 * Works with Electron packaged apps using extraResources
 */
function getCliPath() {
  const platform = process.platform; // "darwin", "win32", "linux"
  const arch = process.arch;         // "x64", "arm64", etc.

  // Check if we're in development or production mode
  // In development, use the local resources folder
  // In production (packaged), use process.resourcesPath
  const devPath = path.join(__dirname, "resources", "arduino-cli");
  const prodPath = process.resourcesPath ? path.join(process.resourcesPath, "arduino-cli") : null;

  // Use dev path if it exists, otherwise use prod path
  const basePath = fs.existsSync(devPath) ? devPath : prodPath;

  // console.log('CLI Path Debug:', { devPath, prodPath, basePath, exists: fs.existsSync(devPath) });

  let cliPath;

  if (platform === "darwin") {
    cliPath = path.join(basePath, "macos", arch === "arm64" ? "arduino-cli-arm64" : "arduino-cli-x64");
  } else if (platform === "win32") {
    cliPath = path.join(basePath, "windows", "arduino-cli.exe");
  } else if (platform === "linux") {
    cliPath = path.join(basePath, "linux", "arduino-cli");
  } else {
    throw new Error("Unsupported OS for Arduino CLI");
  }

  // Ensure executable permission on macOS/Linux
  if (platform !== "win32") {
    try {
      fs.chmodSync(cliPath, 0o755);
    } catch (err) {
      console.warn("Could not set executable permission:", err.message);
    }
  }

  return cliPath;
}

/**
 * Helper to run a command with progress tracking
 * @param {Array} args - Command arguments
 * @param {Function} onProgress - Progress callback
 * @param {number} timeout - Timeout in ms (default 15 minutes for large downloads)
 */
function runSpawnCommand(args, onProgress, timeout = 900000) {
  const cliPath = getCliPath();

  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args);
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Set timeout for the entire operation
    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      reject(new Error('Client.Timeout: Operation timed out after 15 minutes. The download may resume on retry.'));
    }, timeout);

    child.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;
      if (onProgress) onProgress(chunk);
    });

    child.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      if (onProgress) onProgress(chunk); // Arduino CLI often sends progress to stderr
    });

    child.on("close", (code) => {
      clearTimeout(timeoutId);
      if (timedOut) return; // Already handled

      if (code === 0) {
        resolve({ success: true, output: stdout });
      } else {
        reject(new Error(stderr || stdout || `Command failed with code ${code}`));
      }
    });

    child.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

/**
 * Compile Arduino code using the bundled Arduino CLI
 * @param {string} code - Arduino source code
 * @param {string} board - Fully qualified board name (default: arduino:avr:uno)
 * @returns {Promise<Object>} Compilation result with binary data
 */
async function compileArduino(code, board = "arduino:avr:uno") {
  // Create temporary folder for the sketch
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arduino-"));
  const folderName = path.basename(tmpDir);
  const sketchPath = path.join(tmpDir, `${folderName}.ino`);

  fs.writeFileSync(sketchPath, code);

  // Get platform-specific Arduino CLI path
  const cliPath = getCliPath();
  const cmd = `"${cliPath}" compile --fqbn ${board} "${tmpDir}" --output-dir "${tmpDir}"`;

  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 300000 }, (error, stdout, stderr) => {
      if (error) {
        // Cleanup on error
        try {
          fs.rmSync(tmpDir, { recursive: true });
        } catch (e) { }

        return reject(new Error(stderr || stdout || error.message));
      }

      // Find generated binary
      const files = fs.readdirSync(tmpDir);
      const binFile = files.find(f => f.endsWith(".bin") || f.endsWith(".hex"));

      if (binFile) {
        const binPath = path.join(tmpDir, binFile);
        const binData = fs.readFileSync(binPath, "base64");
        const binSize = fs.statSync(binPath).size;

        // Cleanup
        try {
          fs.rmSync(tmpDir, { recursive: true });
        } catch (e) { }

        resolve({
          success: true,
          message: "Compilation successful!",
          filename: binFile,
          binData,
          binSize,
          board,
          output: stdout
        });
      } else {
        // Cleanup
        try {
          fs.rmSync(tmpDir, { recursive: true });
        } catch (e) { }

        reject(new Error("No binary file generated."));
      }
    });
  });
}

/**
 * Install a board package (e.g., ESP32, ESP8266) with automatic retry
 * @param {string} packageUrl - Additional board manager URL
 * @param {string} packageName - Package name (e.g., esp32:esp32)
 * @param {function} onProgress - Progress callback
 * @returns {Promise<Object>} Installation result
 */
async function installBoardPackage(packageUrl, packageName, onProgress) {
  const cliPath = getCliPath();
  const MAX_RETRIES = 5;

  // Update index first
  if (packageUrl) {
    if (onProgress) onProgress("Updating core index...\n");
    await new Promise((resolve) => {
      exec(`"${cliPath}" core update-index --additional-urls "${packageUrl}"`, { timeout: 300000 }, resolve);
    });
  } else {
    if (onProgress) onProgress("Updating core index...\n");
    await new Promise((resolve) => {
      exec(`"${cliPath}" core update-index`, { timeout: 300000 }, resolve);
    });
  }

  // Install package with retry logic for network timeouts
  const args = ["core", "install", packageName];
  if (packageUrl) {
    args.push("--additional-urls", packageUrl);
  }

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      if (onProgress) onProgress(`\n⟳ Retry attempt ${attempt}/${MAX_RETRIES} (download will resume)...\n`);
    }

    try {
      const result = await runSpawnCommand(args, onProgress);

      // Check if the result contains a timeout error
      if (result.success === false && result.error &&
        (result.error.includes('Client.Timeout') || result.error.includes('context deadline'))) {
        lastError = result.error;
        if (onProgress) onProgress(`\n⚠ Network timeout on attempt ${attempt}. Retrying...\n`);
        continue; // Retry
      }

      return result; // Success or non-timeout error
    } catch (err) {
      if (err.message && (err.message.includes('Client.Timeout') || err.message.includes('context deadline'))) {
        lastError = err.message;
        if (onProgress) onProgress(`\n⚠ Network timeout on attempt ${attempt}. Retrying...\n`);
        continue; // Retry
      }
      throw err; // Non-timeout error, don't retry
    }
  }

  // All retries exhausted
  return {
    success: false,
    error: `Failed after ${MAX_RETRIES} attempts. Last error: ${lastError}`
  };
}

/**
 * Remove a board package (core)
 * @param {string} packageName - Package name (e.g., esp32:esp32)
 * @param {function} onProgress - Progress callback
 * @returns {Promise<Object>} Removal result
 */
async function removeBoardPackage(packageName, onProgress) {
  const args = ["core", "uninstall", packageName];
  return runSpawnCommand(args, onProgress);
}

/**
 * List all installed board packages
 * @returns {Promise<Object>} List of installed boards
 */
async function listInstalledBoards() {
  const cliPath = getCliPath();
  const cmd = `"${cliPath}" board listall --format json`;

  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }

      try {
        const boards = JSON.parse(stdout);
        resolve({
          success: true,
          boards: boards.boards || []
        });
      } catch (e) {
        reject(new Error("Failed to parse board list"));
      }
    });
  });
}

/**
 * Upload compiled code to a board via USB
 * @param {string} sketchPath - Path to compiled sketch directory
 * @param {string} port - Serial port
 * @param {string} board - Board FQBN
 * @returns {Promise<Object>} Upload result
 */
async function uploadToBoard(sketchPath, port, board) {
  const cliPath = getCliPath();
  const cmd = `"${cliPath}" upload --fqbn ${board} --port ${port} "${sketchPath}"`;

  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message));
      } else {
        resolve({
          success: true,
          message: "Upload successful!",
          output: stdout
        });
      }
    });
  });
}

/**
 * Get list of connected boards
 * @returns {Promise<Object>} Connected boards info
 */
async function listConnectedBoards() {
  const cliPath = getCliPath();
  const cmd = `"${cliPath}" board list --format json`;

  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve({
          success: true,
          ports: result.detected_ports || []
        });
      } catch (e) {
        reject(new Error("Failed to parse connected boards"));
      }
    });
  });
}

// Board package configurations for common boards
const BOARD_PACKAGES = {
  esp32: {
    url: "https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json",
    name: "esp32:esp32",
    fqbn: "esp32:esp32:esp32"
  },
  esp8266: {
    url: "http://arduino.esp8266.com/stable/package_esp8266com_index.json",
    name: "esp8266:esp8266",
    fqbn: "esp8266:esp8266:generic"
  },
  arduino_uno: {
    url: null,
    name: "arduino:avr",
    fqbn: "arduino:avr:uno"
  },
  arduino_nano: {
    url: null,
    name: "arduino:avr",
    fqbn: "arduino:avr:nano"
  },
  arduino_mega: {
    url: null,
    name: "arduino:avr",
    fqbn: "arduino:avr:mega"
  }
};

module.exports = {
  compileArduino,
  installBoardPackage,
  listInstalledBoards,
  uploadToBoard,
  listConnectedBoards,
  searchLibraries,
  installLibrary,
  listInstalledLibraries,
  searchBoardPlatforms,
  getCliPath,
  BOARD_PACKAGES
};

/**
 * Search for libraries in the Arduino Library Manager
 * @param {string} query - Search query
 * @returns {Promise<Object>} Search results
 */
async function searchLibraries(query) {
  const cliPath = getCliPath();
  const cmd = `"${cliPath}" lib search "${query}" --format json`;

  return new Promise((resolve, reject) => {
    // Increase maxBuffer to 50MB to handle large library lists
    exec(cmd, { timeout: 60000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !stdout) {
        reject(new Error(stderr || error.message));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        // Post-process libraries to extract latest version and description
        const libraries = (result.libraries || []).map(lib => {
          // Extract all versions
          let allVersions = [];

          if (lib.releases) {
            allVersions = Object.keys(lib.releases).sort((a, b) => {
              // Sort descending (newest first)
              return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
            });
          } else if (lib.latest) {
            allVersions = [lib.latest.version];
          }

          let latest = lib.latest;
          if (!latest && allVersions.length > 0) {
            latest = lib.releases[allVersions[0]];
          }

          return {
            name: lib.name,
            version: latest ? latest.version : 'Unknown',
            versions: allVersions,
            author: latest ? latest.author : lib.author,
            maintainer: latest ? latest.maintainer : lib.maintainer,
            sentence: latest ? latest.sentence : (lib.sentence || ''),
            paragraph: latest ? latest.paragraph : (lib.paragraph || ''),
            website: latest ? latest.website : lib.website,
            category: latest ? latest.category : lib.category,
            architecture: latest ? latest.architecture : lib.architecture,
            types: latest ? latest.types : lib.types,
            installed: false // TODO: Check against installed list
          };
        });

        resolve({
          success: true,
          libraries: libraries
        });
      } catch (e) {
        console.error("Library search parse error:", e);
        // console.log("Stdout was:", stdout); // Commenting out to avoid clutter if stdout is huge
        reject(new Error("Failed to parse library search results: " + e.message));
      }
    });
  });
}

/**
 * Get a list of featured/popular libraries
 * @returns {Promise<Object>} List of featured libraries
 */
async function getFeaturedLibraries() {
  // Use a broad search term that returns many popular/useful libraries
  // "Arduino" returns official and popular community libraries
  try {
    const result = await searchLibraries("Arduino");
    if (result.success && result.libraries.length > 0) {
      // Return top results as "featured"
      return {
        success: true,
        libraries: result.libraries.slice(0, 30)
      };
    }
    // Fallback: try "sensor" which also returns popular libraries
    const fallback = await searchLibraries("sensor");
    return fallback;
  } catch (e) {
    console.error('getFeaturedLibraries error:', e);
    return { success: false, error: e.message, libraries: [] };
  }
}

/**
 * Install a library
 * @param {string} name - Library name
 * @param {string} version - Optional version (defaults to latest)
 * @param {function} onProgress - Callback for progress output
 * @returns {Promise<Object>} Installation result
 */
async function installLibrary(name, version, onProgress) {
  const args = ["lib", "install"];
  if (version) {
    args.push(`${name}@${version}`);
  } else {
    args.push(name);
  }

  return runSpawnCommand(args, onProgress);
}

/**
 * List installed libraries
 * @returns {Promise<Object>} List of installed libraries
 */
async function listInstalledLibraries() {
  const cliPath = getCliPath();
  const cmd = `"${cliPath}" lib list --format json`;

  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve({
          success: true,
          libraries: result.libraries || [] // 'libraries' key might vary based on CLI version
        });
      } catch (e) {
        // Fallback for empty list or parsing error
        resolve({ success: true, libraries: [] });
      }
    });
  });
}

/**
 * Search for board platforms (cores)
 * @param {string} query - Search query
 * @returns {Promise<Object>} Search results
 */
async function searchBoardPlatforms(query) {
  const cliPath = getCliPath();
  const cmd = `"${cliPath}" core search "${query}" --format json`;

  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error && !stdout) {
        reject(new Error(stderr || error.message));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        console.log('Raw search output:', JSON.stringify(result).substring(0, 200) + '...'); // Debug log

        let rawPlatforms = [];
        if (Array.isArray(result)) {
          rawPlatforms = result;
        } else if (result && Array.isArray(result.platforms)) {
          rawPlatforms = result.platforms;
        } else if (result && typeof result === 'object') {
          // Try values if it's a map
          rawPlatforms = Object.values(result).filter(p => p.id); // heuristics
        }

        // Post process platforms
        const platforms = rawPlatforms.map(p => {
          // Extract all versions from releases
          let versions = [];
          if (p.releases) {
            versions = Object.keys(p.releases).sort((a, b) => {
              // Sort descending (newest first)
              return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
            });
          } else if (p.latest) {
            versions = [p.latest];
          }

          const latestVer = p.latest || versions[0];
          let releaseObj = null;
          if (p.releases && latestVer) {
            releaseObj = p.releases[latestVer];
          }

          // Get human readable name from release object, fallback to id
          const prettyName = releaseObj ? releaseObj.name : (p.name || p.id);

          // Generate description from boards list
          let description = '';
          if (releaseObj && releaseObj.boards) {
            const boardNames = releaseObj.boards.map(b => b.name).join(', ');
            description = `Boards included in this package: ${boardNames}`;
          }

          return {
            id: p.id,
            name: prettyName,
            latest: latestVer || 'Unknown',
            versions: versions,
            website: p.website || '',
            maintainer: p.maintainer || 'Unknown',
            description: description,
            installed: false
          };
        });

        resolve({
          success: true,
          platforms: platforms
        });
      } catch (e) {
        console.error('Search parsing error:', e);
        reject(new Error("Failed to parse board search results: " + e.message));
      }
    });
  });
}

/**
 * List installed board platforms (cores)
 * @returns {Promise<Object>} List of installed platforms
 */
async function listInstalledPlatforms() {
  const cliPath = getCliPath();
  const cmd = `"${cliPath}" core list --format json`;

  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error && !stdout) {
        reject(new Error(stderr || error.message));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        console.log('Raw core list output:', JSON.stringify(result, null, 2)); // Debug log

        let platforms = [];
        if (Array.isArray(result)) {
          platforms = result.map(p => ({
            id: p.id,
            name: p.name || p.id,
            version: p.installed_version || p.installed,
            latest: p.latest_version || p.latest
          }));
        } else if (result && typeof result === 'object') {
          // Handle case where it might be wrapped or an object map
          // Some CLI versions might return { "arduino:avr": { ... } } or { "platforms": [...] }
          const list = result.platforms || Object.values(result);
          if (Array.isArray(list)) {
            platforms = list.map(p => ({
              id: p.id,
              name: p.name || p.id,
              version: p.installed_version || p.installed,
              latest: p.latest_version || p.latest
            }));
          }
        }

        console.log('Parsed installed platforms:', platforms); // Debug log

        resolve({
          success: true,
          platforms: platforms
        });
      } catch (e) {
        console.error('Error parsing installed platforms:', e);
        // If no cores installed, it might return empty array or null
        resolve({ success: true, platforms: [] });
      }
    });
  });
}

module.exports = {
  compileArduino,
  installBoardPackage,
  listInstalledBoards,
  uploadToBoard,
  listConnectedBoards,
  searchLibraries,
  installLibrary,
  listInstalledLibraries,
  searchBoardPlatforms,
  listInstalledPlatforms,
  removeBoardPackage,
  getCliPath,
  BOARD_PACKAGES,
  getFeaturedLibraries
};
