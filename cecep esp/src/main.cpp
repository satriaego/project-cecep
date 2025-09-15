
#include <Arduino.h>
#include <OneWire.h>
#include <WiFi.h>
#include <Wire.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DallasTemperature.h>
#include <Adafruit_INA219.h>
#include "ACS712.h"

Adafruit_INA219 ina219_1(0x40);
Adafruit_INA219 ina219_2(0x41);
#define Dalas_PIN 4
#define RS485_DIR 27
#define LDR_PIN 34
#define RELAY1_PIN 14
OneWire oneWire(Dalas_PIN);
DallasTemperature sensors(&oneWire);
ACS712  ACS(32, 3.3, 4095, 123.4);


float temperatureC = 0.0;
float temperatureF = 0.0;
float loadVoltage_battery = 0.0;
float loadVoltage_lamp = 0.0;
float A = 0.0;
float vpzem = 0.0;
float ipzem = 0.0;

unsigned int dataCahaya = 0;


bool wifiConnecting = false;
unsigned long wifiStartTime = 0;
unsigned long lastReconnectAttempt = 0;
bool isManual = false;


WiFiClient espClient;
PubSubClient mqttClient(espClient);
void connectToWiFi() {
    if (WiFi.status() == WL_CONNECTED) return;
    WiFi.mode(WIFI_STA);
    WiFi.begin("cecep", "cecep123");
    Serial.println("Connecting to WiFi...");
    wifiConnecting = true;
    wifiStartTime = millis();
}
void reconnectWiFi() {
    if (WiFi.status() != WL_CONNECTED && millis() - lastReconnectAttempt > 5000) {
        lastReconnectAttempt = millis();
        Serial.println("WiFi lost. Trying to reconnect...");
        WiFi.reconnect();
    }
}
void connectToMQTT() {
    Serial.println("Connecting to MQTT...");
    while (!mqttClient.connected()) {
        if (mqttClient.connect("1233132313", "gLy8HNeg4EZOzb4YEMFpkfEJhHugj9pe58KpccbWvYZaVqnzHCk0rI8vcnadgDL3", "123")) {
            Serial.println("Connected to MQTT broker.");
            mqttClient.subscribe("cecep/ta/dataKirim");
            mqttClient.subscribe("cecep/ta/mode");

        } else {
            Serial.print("MQTT connection failed, state: ");
            Serial.println(mqttClient.state());
            delay(2000);
        }
    }
}
void WiFiEvent(WiFiEvent_t event) {
    switch (event) {
        case SYSTEM_EVENT_STA_DISCONNECTED:
            Serial.println("WiFi lost. Reconnecting...");
            wifiConnecting = true;
            wifiStartTime = millis();
            WiFi.reconnect();
            break;
        case SYSTEM_EVENT_STA_GOT_IP:
            Serial.print("Connected! IP: ");
            Serial.println(WiFi.localIP());
            wifiConnecting = false;
            connectToMQTT();
            break;
        default:
            break;
    }
}
void checkMQTTConnection() {
    if (!mqttClient.connected()) {
        Serial.println("MQTT lost. Reconnecting...");
        connectToMQTT();
    }
    mqttClient.loop();
}
void onMQTTMessage(char* topic, byte* payload, unsigned int length) {
  payload[length] = '\0';

  String topicStr = String(topic);

  if (topicStr == "cecep/ta/mode") {
    String mode = String((char*)payload);
    mode.trim();

    if (mode == "manual") {
      isManual = true;
      Serial.println("Mode set to MANUAL");
    } else if (mode == "auto") {
      isManual = false;
      Serial.println("Mode set to AUTO");
    } else {
      Serial.println("Unknown mode received.");
    }

  } else if (topicStr == "cecep/ta/dataKirim") {
    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload);

    if (error) {
      Serial.print("deserializeJson() failed: ");
      Serial.println(error.c_str());
      return;
    }

    const char* relay1 = doc["relay1"];

    if (isManual && relay1) {
      Serial.print("relay1: ");
      Serial.println(relay1);

      if (strcmp(relay1, "1") == 0) {
        digitalWrite(RELAY1_PIN, LOW); 
      } else {
        digitalWrite(RELAY1_PIN, HIGH);
      }
    }
  }
}

void autoControlRelay() {
  if (!isManual) {
    Serial.print("Auto control aktif. dataCahaya = ");
    Serial.println(dataCahaya);

    if (dataCahaya < 3000) {
      Serial.println("Cahaya terang: RELAY OFF");
      digitalWrite(RELAY1_PIN, HIGH);

      JsonDocument doc;
      doc["relay1"] = "0"; 
      char buffer[64];
      serializeJson(doc, buffer);
      mqttClient.publish("cecep/ta/statusRelay", buffer);

    } else {
      Serial.println("Cahaya rendah: RELAY On");
      digitalWrite(RELAY1_PIN, LOW);

      JsonDocument doc;
      doc["relay1"] = "1";
      char buffer[64];
      serializeJson(doc, buffer);
      mqttClient.publish("cecep/ta/statusRelay", buffer);
    }
  } else {
    Serial.println("Mode manual aktif. Auto control dimatikan.");
  }
}

void initSensors() {
  sensors.begin();
  Serial.println("Sensor Dallas Temperature initialized.");
}

void initSerial() {
  Serial.begin(9600);
  Serial2.begin(9600, SERIAL_8N1, 16, 17);
}

void readTemperature() {
  sensors.requestTemperatures();
  temperatureC = sensors.getTempCByIndex(0);
  temperatureF = sensors.getTempFByIndex(0);
}

void readldr() {
  dataCahaya = analogRead(LDR_PIN);
  Serial.print("L: ");
  Serial.println(dataCahaya);
}

void kirimData() {
  JsonDocument doc;
  doc["tempC"] = temperatureC;
  doc["tempF"] = temperatureF;
  doc["lux"] = dataCahaya;
  doc["batteryV"] = loadVoltage_battery;
  doc["load"] = loadVoltage_lamp;
  doc["current"] = A;
  doc["pltV"] = vpzem;
  doc["pltI"] = ipzem;
  char jsonBuffer[128];
  serializeJson(doc, jsonBuffer);

  mqttClient.publish("cecep/ta/dataTerima", jsonBuffer);
}

void readINA219() {
  float shuntvoltage1 = ina219_1.getShuntVoltage_mV();
  float busvoltage1 = ina219_1.getBusVoltage_V();
  loadVoltage_battery = busvoltage1 + (shuntvoltage1 / 1000.0);
  
  float shuntvoltage2 = ina219_2.getShuntVoltage_mV();
  float busvoltage2 = ina219_2.getBusVoltage_V();
  loadVoltage_lamp = busvoltage2 + (shuntvoltage2 / 1000.0);
}

void readACS712() {
  int mA = ACS.mA_DC();
  A = mA / 1000.0; 
  Serial.print("arus: ");
  Serial.print(A, 3); 
  Serial.println(" A");
}

void pzemdc() {
  byte request[] = {0x01, 0x04, 0x00, 0x00, 0x00, 0x02, 0x71, 0xCB};
  digitalWrite(RS485_DIR, HIGH);
  Serial2.write(request, sizeof(request));
  Serial2.flush();
  digitalWrite(RS485_DIR, LOW);
  delay(300);
  byte response[9];
  int len = 0;
  while (Serial2.available() && len < 9) {
    response[len++] = Serial2.read();
  }

  if (len == 9 && response[1] == 0x04) {
    uint16_t voltageRaw = (response[3] << 8) | response[4];
    uint16_t currentRaw = (response[5] << 8) | response[6];

    vpzem = voltageRaw / 100.0; 
    ipzem = currentRaw / 100.0; 

  }
}

void setup() {
  initSerial();
  initSensors();
  WiFi.onEvent(WiFiEvent);
  mqttClient.setServer("mqtt.flespi.io", 1883);
  mqttClient.setCallback(onMQTTMessage);
  connectToWiFi();
  pinMode(RELAY1_PIN, OUTPUT);
  digitalWrite(RELAY1_PIN, HIGH);
  Wire.begin(21, 22); 
  pinMode(RS485_DIR, OUTPUT);
  digitalWrite(RS485_DIR, LOW);
  ina219_1.begin();  
  ina219_2.begin(); 
  ACS.autoMidPoint();
}

void loop() {
  readTemperature();
  readldr();
  pzemdc();
  kirimData();
  checkMQTTConnection();
  autoControlRelay(); 
  readINA219();
  readACS712();
  delay(1000);
}