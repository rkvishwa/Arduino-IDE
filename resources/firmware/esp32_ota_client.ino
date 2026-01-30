/**
 * ESP32 OTA Client Firmware
 * 
 * This firmware is flashed to ESP32 boards during initial provisioning.
 * It handles:
 * - WiFi connection
 * - Polling for firmware updates from Appwrite cloud
 * - OTA firmware updates
 * - Heartbeat reporting to cloud
 * 
 * Placeholders are replaced during provisioning:
 * - {{WIFI_SSID}}
 * - {{WIFI_PASSWORD}}
 * - {{API_TOKEN}}
 * - {{BOARD_ID}}
 * - {{APPWRITE_ENDPOINT}}
 * - {{FIRMWARE_BUCKET_ID}}
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <ArduinoJson.h>
#include <Preferences.h>

// =============================================================================
// CONFIGURATION - These values are injected during provisioning
// =============================================================================

const char* WIFI_SSID = "{{WIFI_SSID}}";
const char* WIFI_PASSWORD = "{{WIFI_PASSWORD}}";
const char* API_TOKEN = "{{API_TOKEN}}";
const char* BOARD_ID = "{{BOARD_ID}}";
const char* APPWRITE_ENDPOINT = "{{APPWRITE_ENDPOINT}}";
const char* FIRMWARE_BUCKET_ID = "{{FIRMWARE_BUCKET_ID}}";

// =============================================================================
// FIRMWARE VERSION - Increment this with each update
// =============================================================================

const char* FIRMWARE_VERSION = "1.0.0";

// =============================================================================
// TIMING CONFIGURATION
// =============================================================================

const unsigned long UPDATE_CHECK_INTERVAL = 30000;  // Check for updates every 30 seconds
const unsigned long HEARTBEAT_INTERVAL = 60000;     // Send heartbeat every 60 seconds
const unsigned long WIFI_RETRY_DELAY = 5000;        // Wait 5 seconds between WiFi retries
const int MAX_WIFI_RETRIES = 20;                    // Max WiFi connection attempts

// =============================================================================
// GLOBAL VARIABLES
// =============================================================================

Preferences preferences;
unsigned long lastUpdateCheck = 0;
unsigned long lastHeartbeat = 0;
bool otaInProgress = false;

// =============================================================================
// SETUP
// =============================================================================

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println();
  Serial.println("===========================================");
  Serial.println("  ESP32 OTA Client");
  Serial.println("  Arduino Knurdz IDE");
  Serial.println("===========================================");
  Serial.print("Firmware Version: ");
  Serial.println(FIRMWARE_VERSION);
  Serial.print("Board ID: ");
  Serial.println(BOARD_ID);
  Serial.println();

  // Initialize preferences for storing rollback info
  preferences.begin("ota", false);
  
  // Connect to WiFi
  connectToWiFi();
  
  // Send initial heartbeat
  sendHeartbeat();
  
  // Check for updates immediately on boot
  checkForUpdates();

  Serial.println();
  Serial.println("Setup complete! Entering main loop...");
  Serial.println("===========================================");
}

// =============================================================================
// MAIN LOOP
// =============================================================================

void loop() {
  // Maintain WiFi connection
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected! Reconnecting...");
    connectToWiFi();
  }

  // Don't do anything else during OTA
  if (otaInProgress) {
    delay(100);
    return;
  }

  unsigned long currentMillis = millis();

  // Check for firmware updates periodically
  if (currentMillis - lastUpdateCheck >= UPDATE_CHECK_INTERVAL) {
    lastUpdateCheck = currentMillis;
    checkForUpdates();
  }

  // Send heartbeat periodically
  if (currentMillis - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    lastHeartbeat = currentMillis;
    sendHeartbeat();
  }

  // Your custom code can go here!
  // This section runs continuously on the board
  // ----------------------------------------
  
  // Example: Blink built-in LED
  // digitalWrite(LED_BUILTIN, HIGH);
  // delay(500);
  // digitalWrite(LED_BUILTIN, LOW);
  // delay(500);

  // ----------------------------------------

  delay(100);  // Small delay to prevent watchdog issues
}

// =============================================================================
// WIFI CONNECTION
// =============================================================================

void connectToWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < MAX_WIFI_RETRIES) {
    delay(WIFI_RETRY_DELAY);
    Serial.print(".");
    retries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("WiFi connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("Signal Strength: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  } else {
    Serial.println();
    Serial.println("ERROR: Failed to connect to WiFi!");
    Serial.println("Restarting in 10 seconds...");
    delay(10000);
    ESP.restart();
  }
}

// =============================================================================
// CHECK FOR FIRMWARE UPDATES
// =============================================================================

void checkForUpdates() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Cannot check for updates - WiFi not connected");
    return;
  }

  Serial.println();
  Serial.println("Checking for firmware updates...");

  HTTPClient http;
  
  // Build the update check URL
  // This endpoint should be an Appwrite Function or your backend
  String url = String(APPWRITE_ENDPOINT) + "/functions/check-update";
  
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Appwrite-Project", getProjectId());

  // Send current version and API token
  StaticJsonDocument<256> requestDoc;
  requestDoc["apiToken"] = API_TOKEN;
  requestDoc["currentVersion"] = FIRMWARE_VERSION;
  requestDoc["boardId"] = BOARD_ID;
  
  String requestBody;
  serializeJson(requestDoc, requestBody);

  int httpCode = http.POST(requestBody);

  if (httpCode == HTTP_CODE_OK) {
    String response = http.getString();
    
    StaticJsonDocument<512> responseDoc;
    DeserializationError error = deserializeJson(responseDoc, response);
    
    if (!error) {
      bool updateAvailable = responseDoc["updateAvailable"] | false;
      
      if (updateAvailable) {
        const char* newVersion = responseDoc["firmware"]["version"];
        const char* downloadUrl = responseDoc["firmware"]["downloadUrl"];
        int size = responseDoc["firmware"]["size"];
        const char* checksum = responseDoc["firmware"]["checksum"];
        
        Serial.println("===========================================");
        Serial.println("  UPDATE AVAILABLE!");
        Serial.println("===========================================");
        Serial.print("Current Version: ");
        Serial.println(FIRMWARE_VERSION);
        Serial.print("New Version: ");
        Serial.println(newVersion);
        Serial.print("Size: ");
        Serial.print(size);
        Serial.println(" bytes");
        Serial.println();
        
        // Perform OTA update
        performOTAUpdate(downloadUrl, newVersion);
      } else {
        Serial.println("Firmware is up to date.");
      }
    } else {
      Serial.print("JSON parsing error: ");
      Serial.println(error.c_str());
    }
  } else {
    Serial.print("Update check failed. HTTP code: ");
    Serial.println(httpCode);
  }

  http.end();
}

// =============================================================================
// PERFORM OTA UPDATE
// =============================================================================

void performOTAUpdate(const char* downloadUrl, const char* newVersion) {
  Serial.println("Starting OTA update...");
  Serial.print("Download URL: ");
  Serial.println(downloadUrl);
  
  otaInProgress = true;

  // Store current version for potential rollback
  preferences.putString("prev_version", FIRMWARE_VERSION);
  preferences.putString("new_version", newVersion);

  WiFiClient client;
  
  // Configure HTTP Update
  httpUpdate.setLedPin(LED_BUILTIN, LOW);
  httpUpdate.rebootOnUpdate(true);

  // Set update callbacks
  httpUpdate.onStart([]() {
    Serial.println("OTA update started...");
  });

  httpUpdate.onEnd([]() {
    Serial.println("OTA update completed!");
    Serial.println("Rebooting...");
  });

  httpUpdate.onProgress([](int current, int total) {
    int percent = (current * 100) / total;
    Serial.printf("Progress: %d%% (%d / %d bytes)\n", percent, current, total);
  });

  httpUpdate.onError([](int error) {
    Serial.printf("OTA Error[%d]: %s\n", error, httpUpdate.getLastErrorString().c_str());
  });

  // Perform the update
  t_httpUpdate_return result = httpUpdate.update(client, downloadUrl);

  switch (result) {
    case HTTP_UPDATE_FAILED:
      Serial.printf("OTA Failed! Error (%d): %s\n", 
        httpUpdate.getLastError(), 
        httpUpdate.getLastErrorString().c_str());
      otaInProgress = false;
      break;
      
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("No update needed.");
      otaInProgress = false;
      break;
      
    case HTTP_UPDATE_OK:
      Serial.println("OTA Success! Rebooting...");
      // Device will reboot automatically
      break;
  }
}

// =============================================================================
// SEND HEARTBEAT
// =============================================================================

void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Cannot send heartbeat - WiFi not connected");
    return;
  }

  Serial.print("Sending heartbeat... ");

  HTTPClient http;
  
  // Build the heartbeat URL
  String url = String(APPWRITE_ENDPOINT) + "/functions/heartbeat";
  
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Appwrite-Project", getProjectId());

  // Send heartbeat data
  StaticJsonDocument<384> doc;
  doc["apiToken"] = API_TOKEN;
  doc["boardId"] = BOARD_ID;
  doc["version"] = FIRMWARE_VERSION;
  doc["rssi"] = WiFi.RSSI();
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["uptime"] = millis() / 1000;  // Uptime in seconds
  
  String requestBody;
  serializeJson(doc, requestBody);

  int httpCode = http.POST(requestBody);

  if (httpCode == HTTP_CODE_OK) {
    Serial.println("OK");
  } else {
    Serial.print("Failed! HTTP code: ");
    Serial.println(httpCode);
  }

  http.end();
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

String getProjectId() {
  // Extract project ID from endpoint
  // Format: https://cloud.appwrite.io/v1 -> need to get from config
  // For now, return empty - this would be set during provisioning
  return "";
}

// =============================================================================
// USER CODE SECTION
// =============================================================================
// Add your custom setup code here
void userSetup() {
  // Example: Initialize sensors, set pin modes, etc.
  // pinMode(LED_BUILTIN, OUTPUT);
}

// Add your custom loop code here
void userLoop() {
  // Example: Read sensors, control outputs, etc.
  // This runs in the main loop alongside OTA checks
}
