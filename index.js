const ws = require("ws");
const crypto = require("crypto");

const config = require("./config.json");

const defaultGlobalData = {
  connectedClients: [],
  eventListeners: [],
  broadcastMessages: [],
  masterClientUUID: null,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let globalData = JSON.parse(JSON.stringify(defaultGlobalData));

const server = new ws.Server({ port: config.port });

function broadcastData(data) {
  globalData.eventListeners.forEach((func) => {
    func(data);
  });
}

server.on("connection", (ws) => {
  ws.uuid = crypto.randomUUID();
  globalData.connectedClients.push(ws.uuid);

  ws.sendJSON = function (args) {
    this.send(JSON.stringify(args));
  };

  console.log(`${ws.uuid} connected.`);


  globalData.eventListeners.push(async function(i) {
    while (globalData.masterClientUUID == null) {
      await sleep(100);
    };
    
    if (ws.uuid == globalData.masterClientUUID) {
      if (i.type == "connection" && i.uuid == ws.uuid || i.type == "data_response") return;
          
      ws.sendJSON(i);
    } else if (ws.uuid == i.uuid && i.type == "data_response") {
      if (i.data == undefined) {
        console.log("%s: I have an undefined message!", i.uuid);
        console.log("%s: Message log:", i.uuid);

        console.log(i);
        
        return;
      }

      ws.send(Buffer.from(i.data, "hex"));
    }
  });

  broadcastData({
    type: "connection",
    uuid: ws.uuid,
  });

  async function recvData() {
    while (true) {
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
      broadcastData({
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

        broadcastData(parsedMessage);
      }
    } else if (ws.uuid != globalData.masterClientUUID) {
      broadcastData({
        type: "data",
        UUID: ws.uuid,
        data: message.toString("hex"),
      });
    }
  });
});
