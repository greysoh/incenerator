const ws = require("ws");

const crypto = require("crypto");

const globalData = {
  broadcastMessages: [],
  masterClientUUID: null,
};

const password = "test"; // Placeholder.

const server = new ws.Server({ port: 8080 });

server.on("connection", (ws) => {
  ws.uuid = crypto.randomUUID();

  ws.sendJSON = function (args) {
    this.send(JSON.stringify(args));
  };

  console.log(`${ws.uuid} connected.`);

  globalData.broadcastMessages.push({
    type: "connection",
    uuid: ws.uuid,
  });

  async function recvData() {
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
            console.log(localData[j], globalData.broadcastMessages[j])
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
            if (k.type == "connection" && k.uuid == ws.uuid) continue;
          
            ws.sendJSON(k);
          }
        } else if (i.uuid == ws.uuid && i.type == "data_response") {
          if (i.data == undefined) {
            console.log("WTF? node-id '%s' has an undefined message!", i.node-id);
            continue;
          }

          ws.send(Buffer.from(Buffer.from(i.data, "hex")));
          delete globalData.broadcastMessages[index];
        }
      }

      await sleep(10);
    }
  }

  recvData();
 
  ws.on("close", function () {
    console.log(`${ws.uuid} disconnected.`);
    
    globalData.broadcastMessages.push({
      type: "disconnection",
      uuid: ws.uuid,
    });
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

        if (bearer == password) {
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
        if (parsedMessage.node == ws.uuid || !parsedMessage.data) {
          ws.sendJSON({
            type: "error",
            message: "Invalid data_response",
          });

          return;
        }

        const regex = /[0-9A-Fa-f]{6}/g;

        if (!regex.test(parsedMessage.data.split(" ").join(""))) {
          ws.sendJSON({
            type: "error",
            message: "Invalid node-id",
          });

          return;
        }

        globalData.broadcastMessages.push(parsedMessage);
      }
    } else {
      globalData.broadcastMessages.push({
        type: "data",
        UUID: ws.uuid,
        data: message.toString("hex"),
      });
    }
  });
});
