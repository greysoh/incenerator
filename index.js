const ws = require("ws");
const crypto = require("crypto");

const config = require("./config.json");

let globalData = {
  connectedClients: [],
  broadcastMessages: [],
  masterClientUUID: null,
};

const server = new ws.Server({ port: config.port });

server.on("connection", (ws) => {
  ws.uuid = crypto.randomUUID();
  globalData.connectedClients.push(ws.uuid);

  ws.sendJSON = function (args) {
    this.send(JSON.stringify(args));
  };

  console.log(`${ws.uuid} connected.`);

  globalData.broadcastMessages.push({
    type: "connection",
    uuid: ws.uuid,
  });

  async function recvData() {
    const latencyTimer = config.latencyTimer;

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    let localData = [];

    while (true) {
      for (const index in globalData.broadcastMessages) {
        const i = globalData.broadcastMessages[index];

        if (ws.uuid == globalData.masterClientUUID) {
          // FIXME: Running a for loop inside a thing that does not in any cases need it is redundant.

          if (JSON.stringify(globalData.broadcastMessages) == JSON.stringify(localData)) continue;

          const diffArr = [];

          for (const j in globalData.broadcastMessages) {
            if (
              localData.length <= j ||
              JSON.stringify(localData[j]) !==
              JSON.stringify(globalData.broadcastMessages[j])
            ) {
              diffArr.push(globalData.broadcastMessages[j]);
            }
          }

          // Attempt to patch the diff
          localData = JSON.parse(JSON.stringify(globalData.broadcastMessages));

          for (const k of diffArr) {
            if (!k) continue;
            if (k.type == "connection" && k.uuid == ws.uuid || k.type == "data_response") continue;
          
            ws.sendJSON(k);
          }
        } else if (i.type == "data_response") {
          if (ws.uuid != i.uuid) continue;

          if (i.data == undefined) {
            console.log("%s: I have an undefined message!", i.uuid);
            continue;
          }

          ws.send(Buffer.from(Buffer.from(i.data, "hex")));
          delete globalData.broadcastMessages[index];
        }
      }

      if (!globalData.connectedClients.includes(ws.uuid)) ws.close();

      await sleep(config.latencyTimer);
    }
  }

  recvData();
 
  ws.on("close", function () {
    console.log(`${ws.uuid} disconnected.`);

    if (ws.uuid == globalData.masterClientUUID) {
      globalData = {
        connectedClients: [],
        broadcastMessages: [],
        masterClientUUID: null,
      };
    } else {
      globalData.broadcastMessages.push({
        type: "disconnection",
        uuid: ws.uuid,
      });
    }
  });

  ws.on("message", (message) => {
    const strMessage = message.toString();

    if (globalData.masterClientUUID === null) {
      if (strMessage.startsWith("Accept: isInceneratorOpen")) {
        ws.send("AcceptResponse isInceneratorOpen: true");
      } else if (strMessage.startsWith("Accept: Bearer ")) {
        const bearer = strMessage
          .substring("Accept: Bearer ".length)
          .replaceAll("\n", "")
          .replaceAll("\r", "");

        if (config.passwords.includes(bearer)) {
          globalData.masterClientUUID = ws.uuid;
          ws.send("AcceptResponse Bearer: true");
        } else {
          ws.send("AcceptResponse Bearer: false");
        }
      } else {
        ws.send("AcceptResponse: false");
      }
    } else if (globalData.masterClientUUID == ws.uuid) {
      try {
        JSON.parse(strMessage);
      } catch (e) {
        ws.sendJSON({
          type: "error",
          message: "Invalid JSON",
        });

        return;
      }

      const parsedMessage = JSON.parse(strMessage);

      if (parsedMessage.type == "data_response") {
        if (parsedMessage.uuid == ws.uuid) {
          ws.sendJSON({
            type: "error",
            message: "Invalid data_response",
          });

          return;
        }

        try {
          Buffer.from(parsedMessage.data, "hex");
        } catch (e) {
          ws.sendJSON({
            type: "error",
            message: "Invalid data"
          });

          return;
        }

        globalData.broadcastMessages.push(parsedMessage);
      }
    } else if (ws.uuid != globalData.masterClientUUID) {
      globalData.broadcastMessages.push({
        type: "data",
        UUID: ws.uuid,
        data: message.toString("hex"),
      });
    }
  });
});
