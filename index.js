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
  try {
    globalData.eventListeners.forEach((func) => {
      func(data);
    });
  } catch (e) {
    console.log("WTF? Failed to broadcast data!");
  }
}

server.on("connection", (ws, req) => {
  ws.uuid = crypto.randomUUID();
  globalData.connectedClients.push(ws.uuid);

  ws.sendJSON = function (args) {
    this.send(JSON.stringify(args));
  };

  console.log(`${ws.uuid} connected.`);

  globalData.eventListeners.push(async function (i) {
    while (globalData.masterClientUUID == null) {
      await sleep(100);
    }

    if (ws.uuid == globalData.masterClientUUID) {
      if (
        i.type != "connection" ||
        (i.type == "connection" && i.UUID == ws.uuid)
      )
        return;

      ws.sendJSON(i);
    } else if (
      (ws.uuid == i.uuid && i.type == "data_response") ||
      (ws.hostUUID == i.uuid && i.type == "data")
    ) {
      if (i.data == undefined) {
        console.log("%s: I have an undefined message!", i.uuid);
        console.log("%s: Message log:", i.uuid);

        return;
      }

      ws.send(Buffer.from(i.data, "hex"));
    }
  });

  const id = crypto.randomUUID();

  if (req.url.startsWith("/trident/")) {
    const urlSplit = req.url.split("/").filter((element) => {
      return element != "";
    });

    if (urlSplit.length != 3) {
      return ws.close();
    } else if (!config.passwords.includes(urlSplit[2])) {
      return ws.close();
    }

    const find = globalData.broadcastMessages.find(
      (i) => i.type == "tridentCreate" && i.id == urlSplit[1]
    );

    if (find) {
      ws.hostUUID = find.uuid;
      globalData.broadcastMessages.splice(
        globalData.broadcastMessages.indexOf(find),
        1
      );
    } else {
      return ws.close();
    }
  } else if (globalData.masterClientUUID) {
    globalData.broadcastMessages.push({
      type: "tridentCreate",
      uuid: ws.uuid,
      id: id,
    });

    broadcastData({
      type: "connection",
      uuid: ws.uuid,
      id: id,
    });
  }

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
      globalData = JSON.parse(JSON.stringify(globalDefaultData));
    } else {
      broadcastData({
        type: "disconnection",
        uuid: ws.uuid,
      });
    }
  });

  ws.on("message", (message) => {
    const strMessage = message.toString();

    if (!globalData.masterClientUUID) {
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
    } else if (req.url.startsWith("/trident")) {
      broadcastData({
        type: "data_response",
        uuid: ws.hostUUID,
        data: message.toString("hex"),
      });
    } else if (ws.uuid != globalData.masterClientUUID) {
      broadcastData({
        type: "data",
        uuid: ws.uuid,
        data: message.toString("hex"),
      });
    }
  });
});
