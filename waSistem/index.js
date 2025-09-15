import QRCode from "qrcode";
import { DisconnectReason, makeWASocket, useMultiFileAuthState } from "baileys";
import mqtt from "mqtt";
let sock;
let systemStatus = {
  mode: "otomatis",
};
const relayStatus = {
  relay1: "0",
  relay2: "0",
  relay3: "0",
  relay4: "0",
};

let mqttData = {
  //   voltage: { value: 0, suffix: "V" },
  //   current: { value: 0, suffix: "A" },
  pltV: { value: 0, suffix: "V" },
  pltI: { value: 0, suffix: "I" },
  current: { value: 0, suffix: "I" },
  load: { value: 0, suffix: "V" },
  tempC: { value: 0, suffix: "°C" },
  tempF: { value: 0, suffix: "°F" },
  batteryV: { value: 0, suffix: "V" },
  lux: { value: 0, suffix: "Lux" },
};

let reconnectTimeout = null;
let mqttConnected = false;

function updateRelayStatusmanual(relayNumber, newStatus) {
  const relayKey = `relay${relayNumber}`;

  // Relay 1–3: hanya satu boleh aktif
  if (["1", "2", "3"].includes(relayNumber) && newStatus === "1") {
    ["relay1", "relay2", "relay3"].forEach((key) => {
      relayStatus[key] = "0";
    });
  }

  if (relayStatus.hasOwnProperty(relayKey)) {
    relayStatus[relayKey] = newStatus;

    if (relayNumber === "1") {
      return newStatus === "1" ? "✅ Beban Dinyalakan" : "❌ Beban Dimatikan";
    }

    return `Speed ${relayNumber} ${
      newStatus === "1" ? "Dinyalakan" : "Dimatikan"
    }`;
  } else {
    return "Relay tidak ditemukan";
  }
}
async function sendMessageWithContext(jid, message, context) {
  await sock.sendMessage(jid, {
    text: message,
    contextInfo: context,
  });
}
function connectMQTT() {
  console.log("[MQTT] Connecting to broker...");

  const client = mqtt.connect("mqtt://mqtt.flespi.io", {
    username:
      "gLy8HNeg4EZOzb4YEMFpkfEJhHugj9pe58KpccbWvYZaVqnzHCk0rI8vcnadgDL3",
    keepalive: 30,
    reconnectPeriod: 0,
  });

  // Event: Connected
  client.on("connect", () => {
    mqttConnected = true;
    console.log("[MQTT] Connected successfully ✅");
    client.subscribe("cecep/ta/dataTerima", (err) => {
      if (!err)
        console.log(`[MQTT] Subscribed to topic: ${"cecep/ta/dataTerima"}`);
      else console.error("[MQTT] Subscription failed:", err);
    });
    client.subscribe("cecep/ta/statusRelay", (err) => {
      if (!err) {
        console.log(`[MQTT] Subscribed to topic: cecep/ta/statusRelay`);
      }
    });

    // Clear any pending reconnect attempts
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  });
  function limitDecimals(obj) {
    for (const key in obj) {
      if (obj[key] && typeof obj[key].value === "number") {
        obj[key].value = Number(obj[key].value.toFixed(2));
      }
    }
  }
  // Event: Message received
  client.on("message", (topic, message) => {
    try {
      const data = JSON.parse(message.toString());

      // Update only the `value`, keeping the `suffix`
      Object.keys(mqttData).forEach((key) => {
        if (data[key] !== undefined) {
          mqttData[key].value = data[key];
        }
      });

      //   // Manually map "count" to "people"
      //   if (data.count !== undefined) {
      //     mqttData.people.value = data.count;
      //   }

      // Update relayStatus if the topic is statusRelay
      if (topic === "cecep/ta/statusRelay") {
        Object.keys(data).forEach((key) => {
          if (relayStatus.hasOwnProperty(key)) {
            relayStatus[key] = data[key];
          }
        });
      }

      limitDecimals(mqttData);
      // console.log(mqttData.current.value);
      // console.log(relayStatus.relay1);
      
      if (mqttData.current.value <= 0 && relayStatus.relay1 === "1") {
        const warningMessage = "⚠️ *BAHAYA!* \n Ada yang salah!";
        const targetJid = "6285708210771@s.whatsapp.net"; // nomor tujuan
        if (sock) {
          sock.sendMessage(targetJid, { text: warningMessage });
        }
      }
    
    } catch (error) {
      console.error("[MQTT] Error parsing message:", error);
    }
  });

  // Event: Disconnected
  client.on("close", () => {
    console.warn("[MQTT] Disconnected ❌");
    mqttConnected = false;
    attemptReconnect();
  });

  // Event: Error
  client.on("error", (error) => {
    console.error("[MQTT] Connection error:", error);
    client.end();
    mqttConnected = false;
    attemptReconnect();
  });

  return client;
}
// Function to attempt reconnection
function attemptReconnect() {
  if (!mqttConnected && !reconnectTimeout) {
    console.log("[MQTT] Reconnecting in 5 seconds...");
    reconnectTimeout = setTimeout(() => {
      console.log("[MQTT] Attempting to reconnect...");
      mqttClient = connectMQTT();
    }, 5000);
  }
}

let mqttClient = connectMQTT();

async function startsock() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  sock = makeWASocket({ auth: state });
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log(await QRCode.toString(qr, { type: "terminal", small: true }));
    }
    if (
      connection === "close" &&
      lastDisconnect?.error?.output?.statusCode ===
        DisconnectReason.restartRequired
    ) {
      startsock();
    }
  });

  // Helper function for context
  function address(m, key) {
    return {
      quotedMessage: m.messages[0].message,
      participant: key.participant || key.remoteJid,
      stanzaId: key.id,
      remoteJid: key.remoteJid,
    };
  }
  function getFormattedDateTime() {
    const currentDate = new Date();

    const dateString = currentDate.toLocaleDateString("id-ID", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const timeString = currentDate.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    });

    return { dateString, timeString };
  }
  function getSpeedLevel(status) {
    if (status.relay1 === "1") return "Load On";

    return "Load Off";
  }
  function generateStatusMessage(status) {
    const { dateString, timeString } = getFormattedDateTime();
    const speedLevel = getSpeedLevel(status);

    return `> *${timeString}*\n> *---*\n> \`Load Status: ${speedLevel}\``;
  }
  // Utility function for adding reactions
  async function addReact(jid, key, emoji) {
    await sock.sendMessage(jid, {
      react: { text: emoji, key },
    });
  }
  // Utility function to send a message with context

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("messages.upsert", async (m) => {
    if (m.messages[0].key.fromMe) return;
    const msgText = m.messages[0].message?.conversation || "";
    const input = msgText.toLocaleLowerCase();
    const key = m.messages[0].key;
    const context = address(m, key);
    const jid = key.remoteJid;
    if (systemStatus.mode === "manual" && input.includes("ld")) {
      let relayNumber = "1";
      let currentStatus = relayStatus[`relay${relayNumber}`];
      let newStatus = currentStatus === "0" ? "1" : "0";
      let responseMessage = updateRelayStatusmanual(relayNumber, newStatus);
      mqttClient.publish("cecep/ta/dataKirim", JSON.stringify(relayStatus));
      await addReact(jid, key, "⚡");
      await sendMessageWithContext(jid, responseMessage, context);
    } else if (input.includes("md")) {
      let newMode;

      if (systemStatus.mode === "otomatis") {
        newMode = "manual";
      } else if (systemStatus.mode === "manual") {
        newMode = "auto"; 
      } else {
        newMode = "manual";
      }

      systemStatus.mode = newMode;
      mqttClient.publish("cecep/ta/mode", newMode);
      await addReact(jid, key, newMode === "manual" ? "🤖" : "🧠");
      await sendMessageWithContext(jid, `Mode dirubah ke ${newMode}`, context);

    } else if (msgText.toLowerCase() === "rp") {
      let { dateString, timeString } = getFormattedDateTime();
      const keyDescriptions = {
        tempC: "Suhu (°C)",
        lux: "Intensitas Cahaya",
        pltV: "Tegangan Panel Surya",
        pltI: "Arus Panel Surya",
        load: "Tegangan Beban",
        current: "Arus Beban",
        batteryV: "Tegangan Baterai",
      };

      let reportSections = {
        Environmental: ["tempC", "lux"],
        Electrical: ["pltV", "pltI", "load","current", "batteryV"],
      };

      let reportLines = [
        `> *Laporan Data*`,
        `> *${dateString}*`,
        `> *${timeString}*`,
        `> *-------------------------------*`,
      ];

      let sectionCount = 0;

      Object.entries(reportSections).forEach(([section, keys]) => {
        let sectionLines = [];

        keys.forEach((key) => {
          if (mqttData[key]) {
            sectionLines.push(
              `> ${keyDescriptions[key]}: ${mqttData[key].value} ${mqttData[key].suffix}`
            );
          }
        });

        if (sectionLines.length > 0) {
          if (sectionCount > 0)
            reportLines.push(`> ---------------------------------`);
          reportLines.push(...sectionLines);
          sectionCount++;
        }
      });

      let report = reportLines.join("\n");
      await addReact(jid, key, "📋"); // Add reaction
      await sendMessageWithContext(jid, report, context);
    } else if (input.includes("li")) {
      let statusMessage = generateStatusMessage(relayStatus);
      await addReact(jid, key, "⚡"); // Add reaction
      await sendMessageWithContext(jid, statusMessage, context);
    } else {
    // Jika tidak ada command yang cocok, kirim list command
      const commandList = 
        `*📋 Daftar Command:*\n` +
        `\n *ld*   - Nyalakan/Mematikan Beban` +
        `\n *md* - Ganti Mode Manual/Otomatis` +
        `\n *rp*   - Laporan Data Sensor` +
        `\n *li*     - Status Beban\n`+
        `\n *catatan* : perintah *ld* hanya bisa digunakan saat mode manual\n`;
        
      await addReact(jid, key, "⁉️");
      await sendMessageWithContext(jid, commandList, context);
    }
  });
}

startsock();
