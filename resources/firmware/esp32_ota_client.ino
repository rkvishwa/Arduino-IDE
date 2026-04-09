/**
 * ESP32 OTA Client Firmware
 *
 * Placeholders replaced during provisioning:
 * - {{WIFI_SSID}}
 * - {{WIFI_PASSWORD}}
 * - {{API_TOKEN}}
 * - {{BOARD_ID}}
 * - {{APPWRITE_ENDPOINT}}
 * - {{APPWRITE_PROJECT_ID}}
 * - {{DEVICE_GATEWAY_FUNCTION_ID}}
 */

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <Preferences.h>
#include <WiFi.h>

const char* WIFI_SSID = "{{WIFI_SSID}}";
const char* WIFI_PASSWORD = "{{WIFI_PASSWORD}}";
const char* API_TOKEN = "{{API_TOKEN}}";
const char* BOARD_ID = "{{BOARD_ID}}";
const char* APPWRITE_ENDPOINT = "{{APPWRITE_ENDPOINT}}";
const char* APPWRITE_PROJECT_ID = "{{APPWRITE_PROJECT_ID}}";
const char* DEVICE_GATEWAY_FUNCTION_ID = "{{DEVICE_GATEWAY_FUNCTION_ID}}";

const char* FIRMWARE_VERSION = "1.0.0";

const unsigned long UPDATE_CHECK_INTERVAL = 30000;
const unsigned long HEARTBEAT_INTERVAL = 60000;
const unsigned long WIFI_RETRY_DELAY = 5000;
const int MAX_WIFI_RETRIES = 20;

Preferences preferences;
unsigned long lastUpdateCheck = 0;
unsigned long lastHeartbeat = 0;
bool otaInProgress = false;

bool executeGatewayFunction(const char* functionPath, JsonDocument& payload, DynamicJsonDocument& responseDoc) {
  HTTPClient http;
  String url = String(APPWRITE_ENDPOINT) + "/functions/" + DEVICE_GATEWAY_FUNCTION_ID + "/executions";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Appwrite-Project", APPWRITE_PROJECT_ID);

  String payloadText;
  serializeJson(payload, payloadText);

  DynamicJsonDocument executionDoc(2048);
  executionDoc["async"] = false;
  executionDoc["path"] = functionPath;
  executionDoc["method"] = "POST";
  JsonObject headers = executionDoc.createNestedObject("headers");
  headers["content-type"] = "application/json";
  executionDoc["body"] = payloadText;

  String requestBody;
  serializeJson(executionDoc, requestBody);

  int httpCode = http.POST(requestBody);
  if (httpCode != HTTP_CODE_CREATED && httpCode != HTTP_CODE_OK) {
    Serial.print("Function execution failed. HTTP code: ");
    Serial.println(httpCode);
    Serial.println(http.getString());
    http.end();
    return false;
  }

  String executionResponse = http.getString();
  http.end();

  DynamicJsonDocument parsedExecution(4096);
  DeserializationError executionError = deserializeJson(parsedExecution, executionResponse);
  if (executionError) {
    Serial.print("Failed to parse execution response: ");
    Serial.println(executionError.c_str());
    return false;
  }

  int responseStatusCode = parsedExecution["responseStatusCode"] | 500;
  const char* responseBody = parsedExecution["responseBody"];
  if (responseStatusCode >= 400 || responseBody == nullptr) {
    Serial.print("Gateway function returned an error. Status: ");
    Serial.println(responseStatusCode);
    Serial.println(responseBody == nullptr ? "No body returned." : responseBody);
    return false;
  }

  DeserializationError bodyError = deserializeJson(responseDoc, responseBody);
  if (bodyError) {
    Serial.print("Failed to parse function body: ");
    Serial.println(bodyError.c_str());
    return false;
  }

  bool ok = responseDoc["ok"] | false;
  if (!ok) {
    const char* errorMessage = responseDoc["error"] | "Unknown function error.";
    Serial.print("Gateway function reported an error: ");
    Serial.println(errorMessage);
    return false;
  }

  return true;
}

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
  } else {
    Serial.println();
    Serial.println("ERROR: Failed to connect to WiFi.");
    delay(5000);
    ESP.restart();
  }
}

void performOTAUpdate(const char* downloadUrl, const char* newVersion) {
  Serial.println("Starting OTA update...");
  otaInProgress = true;

  preferences.putString("prev_version", FIRMWARE_VERSION);
  preferences.putString("next_version", newVersion);

  WiFiClient client;
  httpUpdate.rebootOnUpdate(true);

  httpUpdate.onStart([]() {
    Serial.println("OTA update started.");
  });

  httpUpdate.onEnd([]() {
    Serial.println("OTA update completed.");
  });

  httpUpdate.onProgress([](int current, int total) {
    int percent = total > 0 ? (current * 100) / total : 0;
    Serial.printf("Progress: %d%% (%d / %d bytes)\n", percent, current, total);
  });

  httpUpdate.onError([](int error) {
    Serial.printf("OTA Error[%d]: %s\n", error, httpUpdate.getLastErrorString().c_str());
  });

  t_httpUpdate_return result = httpUpdate.update(client, downloadUrl);

  switch (result) {
    case HTTP_UPDATE_FAILED:
      Serial.printf(
        "OTA Failed! Error (%d): %s\n",
        httpUpdate.getLastError(),
        httpUpdate.getLastErrorString().c_str()
      );
      otaInProgress = false;
      break;
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("No update needed.");
      otaInProgress = false;
      break;
    case HTTP_UPDATE_OK:
      Serial.println("OTA Success! Rebooting...");
      break;
  }
}

void checkForUpdates() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Cannot check for updates without WiFi.");
    return;
  }

  StaticJsonDocument<256> payload;
  payload["boardId"] = BOARD_ID;
  payload["apiToken"] = API_TOKEN;
  payload["currentVersion"] = FIRMWARE_VERSION;

  DynamicJsonDocument responseDoc(4096);
  if (!executeGatewayFunction("/check-update", payload, responseDoc)) {
    return;
  }

  bool updateAvailable = responseDoc["data"]["updateAvailable"] | false;
  if (!updateAvailable) {
    Serial.println("Firmware is up to date.");
    return;
  }

  const char* nextVersion = responseDoc["data"]["firmware"]["version"] | "";
  const char* downloadUrl = responseDoc["data"]["firmware"]["downloadUrl"] | "";

  if (strlen(downloadUrl) == 0 || strlen(nextVersion) == 0) {
    Serial.println("Update metadata was incomplete.");
    return;
  }

  Serial.print("Update available: ");
  Serial.println(nextVersion);
  performOTAUpdate(downloadUrl, nextVersion);
}

void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Cannot send heartbeat without WiFi.");
    return;
  }

  StaticJsonDocument<384> payload;
  payload["boardId"] = BOARD_ID;
  payload["apiToken"] = API_TOKEN;
  payload["version"] = FIRMWARE_VERSION;
  payload["rssi"] = WiFi.RSSI();
  payload["freeHeap"] = ESP.getFreeHeap();
  payload["uptime"] = millis() / 1000;

  DynamicJsonDocument responseDoc(1024);
  if (executeGatewayFunction("/heartbeat", payload, responseDoc)) {
    Serial.println("Heartbeat sent.");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println();
  Serial.println("===========================================");
  Serial.println("          Tantalum IDE OTA Client          ");
  Serial.println("===========================================");
  Serial.print("Board ID: ");
  Serial.println(BOARD_ID);
  Serial.print("Firmware Version: ");
  Serial.println(FIRMWARE_VERSION);

  preferences.begin("tantalum-ota", false);
  connectToWiFi();
  sendHeartbeat();
  checkForUpdates();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectToWiFi();
  }

  if (otaInProgress) {
    delay(100);
    return;
  }

  unsigned long now = millis();
  if (now - lastUpdateCheck >= UPDATE_CHECK_INTERVAL) {
    lastUpdateCheck = now;
    checkForUpdates();
  }

  if (now - lastHeartbeat >= HEARTBEAT_INTERVAL) {
    lastHeartbeat = now;
    sendHeartbeat();
  }

  delay(100);
}
