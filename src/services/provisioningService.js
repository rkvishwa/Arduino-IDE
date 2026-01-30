/**
 * Provisioning Service
 * Handles initial board setup via USB with OTA-ready firmware
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

class ProvisioningService {
    constructor() {
        this.firmwareTemplatePath = path.join(__dirname, '../../resources/firmware/esp32_ota_client.ino');
    }

    /**
     * Generate provisioning firmware with board credentials
     * @param {Object} config - Provisioning configuration
     * @returns {Promise<Object>} Generated firmware path
     */
    async generateProvisioningFirmware(config) {
        const {
            boardId,
            apiToken,
            wifiSSID,
            wifiPassword,
            appwriteEndpoint,
            firmwareBucketId
        } = config;

        try {
            // Read template firmware
            let firmware = fs.readFileSync(this.firmwareTemplatePath, 'utf-8');

            // Replace placeholders with actual values
            firmware = firmware.replace('{{WIFI_SSID}}', wifiSSID);
            firmware = firmware.replace('{{WIFI_PASSWORD}}', wifiPassword);
            firmware = firmware.replace('{{API_TOKEN}}', apiToken);
            firmware = firmware.replace('{{BOARD_ID}}', boardId);
            firmware = firmware.replace('{{APPWRITE_ENDPOINT}}', appwriteEndpoint);
            firmware = firmware.replace('{{FIRMWARE_BUCKET_ID}}', firmwareBucketId);

            // Create temp directory for the sketch
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-'));
            const sketchDir = path.join(tmpDir, 'esp32_ota_client');
            fs.mkdirSync(sketchDir);

            const sketchPath = path.join(sketchDir, 'esp32_ota_client.ino');
            fs.writeFileSync(sketchPath, firmware);

            return { success: true, sketchPath, sketchDir };
        } catch (error) {
            console.error('Generate provisioning firmware error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get list of available serial ports
     * @returns {Promise<Object>} List of ports
     */
    async listPorts() {
        try {
            const { SerialPort } = require('serialport');
            const ports = await SerialPort.list();

            // Filter for common ESP32/Arduino ports
            const filteredPorts = ports.filter(port => {
                const name = (port.manufacturer || '').toLowerCase();
                const path = (port.path || '').toLowerCase();

                return name.includes('silicon') ||
                    name.includes('ftdi') ||
                    name.includes('ch340') ||
                    name.includes('cp210') ||
                    name.includes('usb') ||
                    path.includes('com') ||
                    path.includes('tty');
            });

            return {
                success: true,
                ports: filteredPorts.map(p => ({
                    path: p.path,
                    manufacturer: p.manufacturer || 'Unknown',
                    vendorId: p.vendorId,
                    productId: p.productId
                }))
            };
        } catch (error) {
            console.error('List ports error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get Arduino CLI path based on platform
     * @returns {string} CLI path
     */
    getCliPath() {
        const platform = process.platform;
        const arch = process.arch;

        // Check if we're in development or production mode
        const devPath = path.join(__dirname, '../../resources/arduino-cli');
        const prodPath = process.resourcesPath ? path.join(process.resourcesPath, 'arduino-cli') : null;
        const basePath = fs.existsSync(devPath) ? devPath : prodPath;

        if (platform === 'darwin') {
            return path.join(basePath, 'macos', arch === 'arm64' ? 'arduino-cli-arm64' : 'arduino-cli-x64');
        } else if (platform === 'win32') {
            return path.join(basePath, 'windows', 'arduino-cli.exe');
        } else if (platform === 'linux') {
            return path.join(basePath, 'linux', 'arduino-cli');
        }

        throw new Error('Unsupported platform');
    }

    /**
     * Upload provisioning firmware to board via USB
     * @param {string} sketchDir - Path to sketch directory
     * @param {string} port - Serial port
     * @param {string} boardType - Board FQBN
     * @returns {Promise<Object>} Upload result
     */
    async uploadToBoard(sketchDir, port, boardType = 'esp32:esp32:esp32') {
        return new Promise((resolve) => {
            try {
                const cliPath = this.getCliPath();

                // Compile and upload in one command
                const cmd = `"${cliPath}" compile --upload --fqbn ${boardType} --port ${port} "${sketchDir}"`;

                exec(cmd, { timeout: 120000 }, (error, stdout, stderr) => {
                    if (error) {
                        resolve({
                            success: false,
                            error: stderr || stdout || error.message,
                            output: stdout
                        });
                    } else {
                        resolve({
                            success: true,
                            message: 'Provisioning firmware uploaded successfully!',
                            output: stdout
                        });
                    }
                });
            } catch (error) {
                resolve({ success: false, error: error.message });
            }
        });
    }

    /**
     * Full provisioning workflow
     * @param {Object} board - Board document from database
     * @param {string} port - Serial port
     * @param {Object} appwriteConfig - Appwrite configuration
     * @returns {Promise<Object>} Provisioning result
     */
    async provisionBoard(board, port, appwriteConfig) {
        try {
            // Step 1: Generate firmware with credentials
            const firmwareResult = await this.generateProvisioningFirmware({
                boardId: board.$id,
                apiToken: board.apiToken,
                wifiSSID: board.wifiSSID,
                wifiPassword: board.wifiPassword,
                appwriteEndpoint: appwriteConfig.endpoint,
                firmwareBucketId: appwriteConfig.firmwareBucketId
            });

            if (!firmwareResult.success) {
                return firmwareResult;
            }

            // Step 2: Upload to board
            const uploadResult = await this.uploadToBoard(
                firmwareResult.sketchDir,
                port,
                board.boardType
            );

            // Step 3: Cleanup temp files
            try {
                fs.rmSync(firmwareResult.sketchDir, { recursive: true });
            } catch (e) {
                console.warn('Cleanup warning:', e.message);
            }

            return uploadResult;
        } catch (error) {
            console.error('Provision board error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Install ESP32 board support if not present
     * @returns {Promise<Object>} Installation result
     */
    async installBoardSupport() {
        return new Promise((resolve) => {
            try {
                const cliPath = this.getCliPath();

                // Add ESP32 board index
                const updateCmd = `"${cliPath}" core update-index --additional-urls https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`;

                exec(updateCmd, (err1, stdout1, stderr1) => {
                    if (err1) {
                        console.warn('Update index warning:', stderr1);
                    }

                    // Install ESP32 core
                    const installCmd = `"${cliPath}" core install esp32:esp32 --additional-urls https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`;

                    exec(installCmd, { timeout: 900000 }, (err2, stdout2, stderr2) => {
                        if (err2) {
                            resolve({
                                success: false,
                                error: stderr2 || err2.message
                            });
                        } else {
                            resolve({
                                success: true,
                                message: 'ESP32 board support installed successfully!',
                                output: stdout2
                            });
                        }
                    });
                });
            } catch (error) {
                resolve({ success: false, error: error.message });
            }
        });
    }
}

module.exports = new ProvisioningService();
