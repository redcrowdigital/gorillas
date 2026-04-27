const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const test = require("node:test");
const WebSocket = require("ws");

const ROOT_DIR = path.join(__dirname, "..");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function getHealth(port) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/healthz`, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on("error", reject);
  });
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited with code ${child.exitCode}`);
    }

    try {
      return await getHealth(port);
    } catch (error) {
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
  }

  throw new Error("server did not become healthy");
}

function createAndJoinRoom(port) {
  return new Promise((resolve, reject) => {
    let first;
    let second;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timed out waiting for room join"));
    }, 3000);

    function cleanup() {
      clearTimeout(timer);
      first?.close();
      second?.close();
    }

    first = new WebSocket(`ws://127.0.0.1:${port}`);
    first.on("error", (error) => {
      cleanup();
      reject(error);
    });
    first.on("open", () => {
      first.send(JSON.stringify({ type: "createRoom" }));
    });
    first.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== "roomCreated") {
        return;
      }

      second = new WebSocket(`ws://127.0.0.1:${port}`);
      second.on("error", (error) => {
        cleanup();
        reject(error);
      });
      second.on("open", () => {
        second.send(JSON.stringify({ type: "joinRoom", code: message.code }));
      });
      second.on("message", (data) => {
        const nextMessage = JSON.parse(data.toString());
        const players = nextMessage.state?.players || [];
        if (nextMessage.type === "state" && players.filter((player) => player.connected).length === 2) {
          cleanup();
          resolve(message.code);
        }
      });
    });
  });
}

test("server exposes health check and supports room joins over WebSocket", async (t) => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT_DIR,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  t.after(() => {
    child.kill();
  });

  const health = await waitForHealth(port, child);
  assert.equal(health.statusCode, 200);
  assert.equal(health.body, "ok\n");

  const roomCode = await createAndJoinRoom(port);
  assert.match(roomCode, /^[A-Z]{4}$/);
  assert.equal(stderr, "");
});
