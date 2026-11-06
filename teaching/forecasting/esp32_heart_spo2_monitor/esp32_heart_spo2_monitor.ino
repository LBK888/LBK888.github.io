/*


For upload file into SPIFFS, see:
https://github.com/earlephilhower/arduino-littlefs-upload?tab=readme-ov-file

*/
#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"
// OLED 128x32 (SSD1306)
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "index_html.h"

// MAX30102 血氧感測器
MAX30105 particleSensor;

// OLED 顯示器參數 (I2C, 128x32)
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 32
#define OLED_RESET    -1
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// WiFi AP 設定
const char* ap_ssid = "ESP32_HeartMonitor";
const char* ap_password = "12345678";

// Web Server
WebServer server(80);

// 心跳偵測相關變數
const byte RATE_SIZE = 4; // 增加到4個樣本以提高精度
long rates[RATE_SIZE]; // 儲存心跳速率
long rateArray[RATE_SIZE];
int rateSpot = 0;
long lastBeat = 0;
int beatsPerMinute;
bool fingerDetected = false;
bool firstDetected = false;  // 開機後是否偵測到手指

// 血氧計算相關變數（串流、非阻塞）
float redMean = 0.0f;
float irMean = 0.0f;
float redVar = 0.0f;   // 近似 AC^2 的指數移動方差
float irVar = 0.0f;
const float meanAlpha = 0.01f; // 平均值 EWMA 系數（越小越平穩）
const float varAlpha  = 0.01f; // 方差 EWMA 系數
float ESpO2 = 95.0f;  // 立即血氧估計
float FSpO2 = 95.0f;  // 平滑後血氧
const float frate = 0.95f; // 低通濾波係數
int temp_int;

// 數據儲存
struct SensorData {
  int heartRate;
  double spO2;
  bool fingerDetected;
  unsigned long timestamp;
};

SensorData currentData = {0, 95.0, false, 0};

// 顯示更新節流
unsigned long lastDisplayUpdate = 0;
const unsigned long displayIntervalMs = 50; // 50ms 更新一次，更順暢

// PPG 波形緩衝與處理（128 點對應整個螢幕寬度）
const uint8_t WAVE_WIDTH = 128;
const uint8_t WAVE_HEIGHT = 24; // 下方 24px 顯示波形（上方 8px 顯示文字）
int16_t waveRaw[WAVE_WIDTH];
uint8_t wavePos = 0;
bool waveWrapped = false;
float irBaseline = 0.0f;           // DC 移除的基線
const float dcAlpha = 0.95f;       // 基線濾波係數（接近 1 => 緩慢變動）
float acSmooth = 0.0f;             // AC 平滑後的值
const float acAlpha = 0.5f;        // AC 平滑係數

inline void recordWaveSample(int16_t sample) {
  waveRaw[wavePos] = sample;
  wavePos = (wavePos + 1) % WAVE_WIDTH;
  if (wavePos == 0) waveWrapped = true;
}

// 更新 OLED 顯示
void updateOLED() {
  if (millis() - lastDisplayUpdate < displayIntervalMs) return;
  lastDisplayUpdate = millis();

  display.clearDisplay();
  // 文字區（8px 高度）
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);

  if (currentData.fingerDetected) {
    display.print("HR:");
    display.print(currentData.heartRate);
    display.print(" BPM  ");
    display.print("SpO2:");
    display.print((int)(currentData.spO2 + 0.5));
    display.print("%");
  } else {
    display.print("Put finger on sensor");
  }

  // 波形區（從 y=8 開始，高度 24px）
  const uint8_t offsetY = 8;
  if (wavePos > 1 || waveWrapped) {
    // 取樣本範圍
    uint8_t count = waveWrapped ? WAVE_WIDTH : wavePos;
    // 計算 min/max 用於縮放
    int16_t minv = 32767;
    int16_t maxv = -32768;
    for (uint8_t i = 0; i < count; i++) {
      int16_t v = waveRaw[i];
      if (v < minv) minv = v;
      if (v > maxv) maxv = v;
    }
    int16_t range = maxv - minv;
    if (range == 0) range = 1;

    // 對齊當前波形索引，讓最新點在右側
    uint8_t start = waveWrapped ? wavePos : 0;
    uint8_t x = 0;
    int16_t prevY = -1;
    for (uint8_t i = 0; i < count && x < WAVE_WIDTH; i++, x++) {
      uint8_t idx = (start + i) % WAVE_WIDTH;
      int16_t v = waveRaw[idx];
      // 映射到 0..WAVE_HEIGHT-1，並反轉 Y 讓波形向上
      int16_t y = (int32_t)(v - minv) * (WAVE_HEIGHT - 1) / range;
      y = (WAVE_HEIGHT - 1) - y;
      // 垂直連線（更像 tinyPulsePPG 的連續波形填充）
      if (prevY < 0) prevY = y;
      if (y > prevY) {
        for (int16_t yy = prevY; yy <= y; yy++) display.drawPixel(x, offsetY + yy, SSD1306_WHITE);
      } else {
        for (int16_t yy = y; yy <= prevY; yy++) display.drawPixel(x, offsetY + yy, SSD1306_WHITE);
      }
      prevY = y;
    }
  }

  display.display();
}

// CORS 標頭設定
void setCORSHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "*");
  server.sendHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  server.sendHeader("Pragma", "no-cache");
  server.sendHeader("Expires", "0");
}

// 處理 OPTIONS 預檢請求
void handleOptions() {
  setCORSHeaders();
  server.send(200, "text/plain", "");
}

// 處理心跳數據請求
void handleHeartRate() {
  setCORSHeaders();
  
  DynamicJsonDocument doc(200);
  doc["heartRate"] = currentData.heartRate;
  doc["fingerDetected"] = currentData.fingerDetected;
  doc["timestamp"] = currentData.timestamp;
  doc["value"] = currentData.heartRate; // 為了相容你的JS函數
  
  String response;
  serializeJson(doc, response);
  server.send(200, "application/json", response);
}

// 處理血氧數據請求
void handleSpO2() {
  setCORSHeaders();
  
  DynamicJsonDocument doc(200);
  doc["spO2"] = currentData.spO2;
  doc["fingerDetected"] = currentData.fingerDetected;
  doc["timestamp"] = currentData.timestamp;
  doc["value"] = currentData.spO2; // 為了相容你的JS函數
  
  String response;
  serializeJson(doc, response);
  server.send(200, "application/json", response);
}

// 處理完整數據請求
void handleAllData() {
  setCORSHeaders();
  
  DynamicJsonDocument doc(300);
  doc["heartRate"] = currentData.heartRate;
  doc["spO2"] = currentData.spO2;
  doc["fingerDetected"] = currentData.fingerDetected;
  doc["timestamp"] = currentData.timestamp;
  
  String response;
  serializeJson(doc, response);
  server.send(200, "application/json", response);
}

// 處理狀態請求
void handleStatus() {
  setCORSHeaders();
  
  DynamicJsonDocument doc(400);
  doc["device"] = "ESP32 Heart & SpO2 Monitor";
  doc["version"] = "1.0";
  doc["uptime"] = millis();
  doc["connected_clients"] = WiFi.softAPgetStationNum();
  doc["sensor_status"] = particleSensor.getINT1() ? "OK" : "Error";
  
  String response;
  serializeJson(doc, response);
  server.send(200, "application/json", response);
}

// 提供簡單的網頁介面
void handleRoot() {
  setCORSHeaders();
  
  String html = R"(
<!DOCTYPE html>
<html>
<head>
    <title>ESP32 心跳血氧監測器</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f0f0f0; }
        .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .sensor-value { font-size: 2em; margin: 10px 0; padding: 15px; border-radius: 5px; text-align: center; }
        .heart-rate { background: #ffebee; color: #c62828; }
        .spo2 { background: #e3f2fd; color: #1565c0; }
        .status { margin: 10px 0; padding: 10px; border-radius: 5px; text-align: center; }
        .online { background: #e8f5e8; color: #2e7d32; }
        .offline { background: #ffebee; color: #c62828; }
        .info { background: #f3e5f5; color: #7b1fa2; margin: 10px 0; padding: 10px; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <h1 style="text-align: center; color: #333;">ESP32 心跳血氧監測器</h1>
        
        <div class="sensor-value heart-rate">
            <div>心跳</div>
            <div id="heartRate">-- BPM</div>
        </div>
        
        <div class="sensor-value spo2">
            <div>血氧濃度</div>
            <div id="spO2">-- %</div>
        </div>
        
        <div id="status" class="status offline">請將手指放在感測器上</div>
        
        <div class="info">
            <h3>API 端點：</h3>
            <p><strong>http://192.168.4.1/hr</strong> - 心跳數據</p>
            <p><strong>http://192.168.4.1/spo2</strong> - 血氧數據</p>
            <p><strong>http://192.168.4.1/data</strong> - 完整數據</p>
            <p><strong>http://192.168.4.1/status</strong> - 設備狀態</p>
        </div>
        
        <div class="info">
            <h3>連接資訊：</h3>
            <p><strong>WiFi名稱：</strong>ESP32_HeartMonitor</p>
            <p><strong>WiFi密碼：</strong>12345678</p>
            <p><strong>設備IP：</strong>192.168.4.1</p>
            <p>連接的設備數量: <span id="clientCount">0</span></p>
            <p>最後更新: <span id="lastUpdate">--</span></p>
        </div>
    </div>

    <script>
        let updateInterval;
        
        async function fetchData() {
            try {
                const response = await fetch('/data', { cache: 'no-store' });
                if (response.ok) {
                    const data = await response.json();
                    
                    document.getElementById('heartRate').textContent = 
                        data.fingerDetected ? data.heartRate + ' BPM' : '-- BPM';
                    
                    document.getElementById('spO2').textContent = 
                        data.fingerDetected ? data.spO2.toFixed(1) + ' %' : '-- %';
                    
                    const statusElement = document.getElementById('status');
                    if (data.fingerDetected) {
                        statusElement.textContent = '感測器運作中';
                        statusElement.className = 'status online';
                    } else {
                        statusElement.textContent = '請將手指放在感測器上';
                        statusElement.className = 'status offline';
                    }
                    
                    document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
                }
                
                // 取得狀態資訊
                const statusResponse = await fetch('/status', { cache: 'no-store' });
                if (statusResponse.ok) {
                    const statusData = await statusResponse.json();
                    document.getElementById('clientCount').textContent = statusData.connected_clients;
                }
            } catch (error) {
                console.error('取得數據失敗:', error);
            }
        }
        
        // 每秒更新數據
        updateInterval = setInterval(fetchData, 1000);
        
        // 頁面載入時立即取得數據
        fetchData();
    </script>
</body>
</html>
  )";
  
  server.send(200, "text/html", html);
}

void handleTest() {
  server.send_P(200, "text/html", index_html);
}




void setup() {
  Serial.begin(115200);
  Serial.println("ESP32 心跳血氧監測器啟動中...");

  // 初始化 I2C
  Wire.begin();
  // 提升 I2C 時脈至 400kHz，提高感測器與顯示吞吐
  Wire.setClock(400000);

  // 初始化 OLED 顯示器
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("找不到 SSD1306 顯示器，請檢查連接！");
  } else {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("ESP32 Heart & SpO2");
    display.println("Starting...");
    display.display();
  }
  
  // 初始化 MAX30102
  if (!particleSensor.begin()) {
    Serial.println("找不到 MAX30102 感測器，請檢查連接！");
    while(1);
  }
  
  // 設定 MAX30102
  particleSensor.setup(); // 使用預設設定
  particleSensor.setPulseAmplitudeRed(0x0A); // 紅光LED電流
  particleSensor.setPulseAmplitudeGreen(0);   // 關閉綠光LED
  
  Serial.println("MAX30102 初始化完成");

  // 啟動頁面後短暫顯示
  delay(500);
  //updateOLED();

  // 設定固定的AP IP地址
  IPAddress local_IP(192, 168, 4, 1);
  IPAddress gateway(192, 168, 4, 1);
  IPAddress subnet(255, 255, 255, 0);
  
  // 設定 WiFi AP 模式
  WiFi.mode(WIFI_AP);
  WiFi.softAPConfig(local_IP, gateway, subnet);
  WiFi.softAP(ap_ssid, ap_password);
  
  IPAddress IP = WiFi.softAPIP();
  Serial.print("AP IP 地址: ");
  Serial.println(IP);
  Serial.println("WiFi AP 名稱: " + String(ap_ssid));
  Serial.println("WiFi 密碼: " + String(ap_password));

  // 設定 Web Server 路由
  server.on("/", handleRoot);
  server.on("/t", handleTest);
  server.on("/heartrate", HTTP_GET, handleHeartRate);
  server.on("/hr", HTTP_GET, handleHeartRate);
  server.on("/spo2", HTTP_GET, handleSpO2);
  server.on("/data", HTTP_GET, handleAllData);
  server.on("/status", HTTP_GET, handleStatus);
  
  // 處理 OPTIONS 請求（CORS 預檢）
  server.on("/heartrate", HTTP_OPTIONS, handleOptions);
  server.on("/hr", HTTP_OPTIONS, handleOptions);
  server.on("/spo2", HTTP_OPTIONS, handleOptions);
  server.on("/data", HTTP_OPTIONS, handleOptions);
  server.on("/status", HTTP_OPTIONS, handleOptions);

  server.begin();
  Serial.println("Web Server 已啟動");
  Serial.println("請連接 WiFi: " + String(ap_ssid));
  Serial.println("然後開啟瀏覽器訪問: http://" + IP.toString());

  display.clearDisplay();
  // 文字區（8px 高度）
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.print("http://"+ IP.toString());
  display.display();
}

void loop() {
  server.handleClient();
  
  // 讀取感測器數據
  long irValue = particleSensor.getIR();
  uint32_t redValueImmediate = particleSensor.getRed();
  
  // 檢查是否有手指放在感測器上
  if (checkForBeat(irValue) == true) {
    firstDetected = true; //第一次偵測到
    fingerDetected = true;
    
    // 計算心跳間隔時間
    long delta = millis() - lastBeat;
    lastBeat = millis();

    // 儲存有效的心跳間隔
    if (delta > 300 && delta < 3000) { // 合理的心跳間隔範圍
      // 計算BPM
      beatsPerMinute = 60 / (delta / 1000.0);

      if (beatsPerMinute < 255 && beatsPerMinute > 20) {
        // 儲存有效的心跳速率
        rates[rateSpot++] = beatsPerMinute;
        rateSpot %= RATE_SIZE;

        // 計算平均心跳
        long total = 0;
        for (byte i = 0; i < RATE_SIZE; i++) {
          total += rates[i];
        }
        beatsPerMinute = total / RATE_SIZE;
      }
    }
  } else {
    // 沒有檢測到手指
    if (irValue < 50000) {
      fingerDetected = false;
      beatsPerMinute = 0;
    }
  }

  // 血氧計算（非阻塞串流）
  if (irValue > 5000) {
    float red = (float)redValueImmediate;
    float irf = (float)irValue;
    // 指數移動平均（估計 DC）
    redMean = (1.0f - meanAlpha) * redMean + meanAlpha * red;
    irMean  = (1.0f - meanAlpha) * irMean  + meanAlpha * irf;
    // 指數移動方差（估計 AC 能量）
    float redAc = red - redMean;
    float irAc  = irf - irMean;
    redVar = (1.0f - varAlpha) * redVar + varAlpha * (redAc * redAc);
    irVar  = (1.0f - varAlpha) * irVar  + varAlpha * (irAc  * irAc);

    // 避免除零
    float redRms = sqrtf(fmaxf(redVar, 1.0f));
    float irRms  = sqrtf(fmaxf(irVar,  1.0f));
    float R = (redRms / fmaxf(redMean, 1.0f)) / (irRms / fmaxf(irMean, 1.0f));

    // 經驗公式
    ESpO2 = -23.3f * (R - 0.4f) + 100.0f;
    if (ESpO2 > 100.0f) ESpO2 = 100.0f;
    if (ESpO2 < 80.0f)  ESpO2 = 95.0f;
    FSpO2 = frate * FSpO2 + (1.0f - frate) * ESpO2;
  } else {
    FSpO2 = 95.0f; // 預設血氧值
  }

  // 產生 PPG AC 訊號並記錄波形
  if (irValue > 5000) {
    // 更新 DC 基線
    irBaseline = dcAlpha * irBaseline + (1.0f - dcAlpha) * (float)irValue;
    float ac = (float)irValue - irBaseline;
    // AC 平滑
    acSmooth = acAlpha * acSmooth + (1.0f - acAlpha) * ac;
    // 將 acSmooth 限制並縮放到合理範圍（像 tinyPulsePPG 以 1/8 比例）
    int16_t scaled = (int16_t)(-acSmooth / 8.0f); // 取負數讓波形「向上」
    // 夾限避免溢位
    if (scaled < -32760) scaled = -32760;
    if (scaled > 32760) scaled = 32760;
    recordWaveSample(scaled);
  }

  // 更新當前數據
  currentData.heartRate = fingerDetected ? beatsPerMinute : 0;
  currentData.spO2 = fingerDetected ? FSpO2 : 95.0;
  currentData.fingerDetected = fingerDetected;
  currentData.timestamp = millis();

  // 週期性更新 OLED 顯示
  if (firstDetected) updateOLED();

  // 序列輸出（用於除錯）- 降低頻率並避免重度字串拼接
  static unsigned long lastPrint = 0;
  if (millis() - lastPrint > 3000) { // 每3秒輸出一次
    Serial.print("手指偵測: ");
    Serial.print(fingerDetected ? "是" : "否");
    if (fingerDetected) {
      Serial.print(", 心跳: ");
      Serial.print(beatsPerMinute);
      Serial.print(" BPM, 血氧: ");
      Serial.print(FSpO2, 0);
      Serial.print("%");
    }
    Serial.print(", 連接設備: ");
    Serial.println(WiFi.softAPgetStationNum());
    lastPrint = millis();
  }

  delay(5); // 降低延遲，讓感測/顯示更即時
}