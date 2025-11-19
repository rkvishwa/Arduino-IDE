const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");

/**
 * Get path to bundled arduino-cli binary based on OS and architecture
 * Works with Electron packaged apps using extraResources
 */
function getCliPath() {
  const platform = process.platform; // "darwin", "win32", "linux"
  const arch = process.arch;         // "x64", "arm64", etc.

  // Electron extraResources are located in process.resourcesPath
  const basePath = path.join(process.resourcesPath, "arduino-cli");
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
 * Compile Arduino code using the bundled Arduino CLI
 * @param {string} code - Arduino source code
 * @param {string} board - Fully qualified board name (default: arduino:avr:uno)
 */
async function compileArduino(code, board = "arduino:avr:uno") {
  // Create temporary folder for the sketch
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arduino-"));
  const folderName = path.basename(tmpDir);
  const sketchPath = path.join(tmpDir, `${folderName}.ino`);

  fs.writeFileSync(sketchPath, code);

  // Get platform-specific Arduino CLI path
  const cliPath = getCliPath();
  const cmd = `"${cliPath}" compile --fqbn ${board} ${tmpDir} --output-dir ${tmpDir}`;

  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || stdout || error.message));

      // Find generated binary
      const files = fs.readdirSync(tmpDir);
      const binFile = files.find(f => f.endsWith(".bin") || f.endsWith(".hex"));

      if (binFile) {
        const binPath = path.join(tmpDir, binFile);
        const binData = fs.readFileSync(binPath, "base64");
        resolve({
          success: true,
          message: "Compilation successful!",
          filename: binFile,
          binData
        });
      } else {
        reject(new Error("No binary file generated."));
      }
    });
  });
}

module.exports = { compileArduino };
