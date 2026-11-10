import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

import { promisify } from "node:util";
import { Game, type Side } from "./game.js";

const derive = promisify(scrypt);
type UserRecord = {
  id: string;
  username: string;
  salt: string;
  passwordHash: string;
};
type Session = { userId: string; username: string; expiresAt: number };
type Room = {
  code: string;
  players: Record<Side, string | null>;
  game: Game;
  sockets: Map<WebSocket, Side>;
  idleSince: number;
};
type JsonRecord = Record<string, unknown>;

const tickMs = 50;
const port = Number(process.env.PORT ?? 8787);
const here = dirname(fileURLToPath(import.meta.url));
const dataFile =
  process.env.ACCOUNTS_FILE ?? resolve(here, "../data/accounts.json");

const users = loadUsers();
const sessions = new Map<string, Session>();
const rooms = new Map<string, Room>();
const tickets = new Map<
  string,
  { room: Room; side: Side; expiresAt: number }
>();
const webSockets = new WebSocketServer({ noServer: true, maxPayload: 1024 });

function loadUsers(): UserRecord[] {
  if (!existsSync(dataFile)) return [];
  return JSON.parse(readFileSync(dataFile, "utf8")) as UserRecord[];
}

function saveUsers(records: UserRecord[]): void {
  mkdirSync(dirname(dataFile), { recursive: true });
  writeFileSync(dataFile + ".tmp", JSON.stringify(records), { mode: 0o600 });
  renameSync(dataFile + ".tmp", dataFile);
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: JsonRecord,
): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  response.end(JSON.stringify(body));
}

function sendSocket(socket: WebSocket, body: JsonRecord): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(body));
}

async function parseJsonBody(request: IncomingMessage): Promise<JsonRecord> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of request) {
    size += part.length;
    if (size > 4096) throw new Error("请求内容过长");
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
}

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

function authenticatedUser(request: IncomingMessage): Session | null {
  const token = bearerToken(request);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (session) sessions.delete(token);
    return null;
  }
  return session;
}

function newToken(user: UserRecord): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, {
    userId: user.id,
    username: user.username,
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7,
  });
  return token;
}

async function passwordHash(password: string, salt: string): Promise<string> {
  return ((await derive(password, salt, 64)) as Buffer).toString("hex");
}

function validCredentials(
  username: unknown,
  password: unknown,
): username is string {
  return (
    typeof username === "string" &&
    /^[a-zA-Z0-9_\u4e00-\u9fff]{3,24}$/.test(username.trim()) &&
    typeof password === "string" &&
    password.length >= 6
  );
}

function createRoom(): Room {
  let code = "";
  while (!code || rooms.has(code))
    code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
  const room: Room = {
    code,
    players: { left: null, right: null },
    game: new Game(),
    idleSince: Date.now(),
    sockets: new Map(),
  };
  rooms.set(code, room);
  return room;
}

function findRoomByUser(userId: string): { room: Room; playerId: Side } | null {
  for (const room of rooms.values()) {
    for (const playerId of ["left", "right"] as const) {
      if (room.players[playerId] === userId) return { room, playerId };
    }
  }
  return null;
}

function handleSocket(room: Room, socket: WebSocket, playerId: Side): void {
  for (const [old, seat] of room.sockets) {
    if (seat === playerId) {
      room.sockets.delete(old);
      old.close(4001, "Account connected elsewhere");
    }
  }
  room.game.inputs[playerId] = { x: 0, y: 0 };
  room.sockets.set(socket, playerId);
  let lastSignal = 0;
  sendSocket(socket, { type: "welcome", roomCode: room.code, playerId });
  socket.on("error", () => socket.terminate());
  socket.on("message", (raw) => {
    if (!room.sockets.has(socket) || room.sockets.size !== 2) return;
    try {
      const msg = JSON.parse(raw.toString()) as JsonRecord;
      if (
        msg.type === "input" &&
        typeof msg.x === "number" &&
        typeof msg.y === "number" &&
        Number.isFinite(msg.x) &&
        Number.isFinite(msg.y)
      ) {
        room.game.inputs[playerId] = {
          x: Math.max(-1, Math.min(1, msg.x)),
          y: Math.max(-1, Math.min(1, msg.y)),
        };
      } else if (
        msg.type === "signal" &&
        !room.game.finished &&
        msg.stage === room.game.stage &&
        typeof msg.rune === "number" &&
        [0, 1, 2].includes(msg.rune) &&
        Date.now() - lastSignal >= 300
      ) {
        lastSignal = Date.now();
        for (const [peer, side] of room.sockets) {
          if (side !== playerId)
            sendSocket(peer, {
              type: "signal",
              rune: msg.rune,
              stage: room.game.stage,
            });
        }
      } else if (msg.type === "resonate" && msg.stage === room.game.stage) {
        room.game.resonate(playerId, performance.now());
      } else if (msg.type === "reset" && room.game.finished) {
        room.game = new Game();
      }
    } catch {
      sendSocket(socket, { type: "error", message: "无效操作" });
    }
  });
  socket.on("close", () => {
    if (!room.sockets.delete(socket)) return;
    room.idleSince = Date.now();
    room.game.pause();
  });
}

function closeRoom(room: Room) {
  rooms.delete(room.code);
  for (const socket of room.sockets.keys()) socket.close(4002, "Room closed");
  room.sockets.clear();
}

async function handleHttp(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const requestUrl = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }
  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, rooms: rooms.size });
    return;
  }
  if (
    request.method === "POST" &&
    requestUrl.pathname === "/api/auth/register"
  ) {
    const body = await parseJsonBody(request);
    const username =
      typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!validCredentials(username, password)) {
      sendJson(response, 400, {
        error: "用户名需为 3–24 个字母、数字、下划线或中文，密码至少 6 位",
      });
      return;
    }
    if (
      users.some(
        (user) => user.username.toLowerCase() === username.toLowerCase(),
      )
    ) {
      sendJson(response, 409, { error: "用户名已存在" });
      return;
    }
    const salt = randomBytes(16).toString("hex");
    const user: UserRecord = {
      id: randomUUID(),
      username,
      salt,
      passwordHash: await passwordHash(password, salt),
    };
    if (
      users.some(
        (record) => record.username.toLowerCase() === username.toLowerCase(),
      )
    ) {
      sendJson(response, 409, { error: "用户名已存在" });
      return;
    }
    saveUsers([...users, user]);
    users.push(user);
    sendJson(response, 201, { token: newToken(user), username: user.username });
    return;
  }
  if (request.method === "POST" && requestUrl.pathname === "/api/auth/login") {
    const body = await parseJsonBody(request);
    const username =
      typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const user = users.find(
      (candidate) =>
        candidate.username.toLowerCase() === username.toLowerCase(),
    );
    if (!user) {
      sendJson(response, 401, { error: "用户名或密码错误" });
      return;
    }
    const expected = Buffer.from(user.passwordHash, "hex");
    const actual = Buffer.from(await passwordHash(password, user.salt), "hex");
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      sendJson(response, 401, { error: "用户名或密码错误" });
      return;
    }
    sendJson(response, 200, { token: newToken(user), username: user.username });
    return;
  }
  const user = authenticatedUser(request);
  if (!user) {
    sendJson(response, 401, { error: "请先登录" });
    return;
  }
  if (request.method === "POST" && requestUrl.pathname === "/api/rooms") {
    const existing = findRoomByUser(user.userId);
    if (existing) {
      sendJson(response, 200, {
        roomCode: existing.room.code,
        playerId: existing.playerId,
      });
      return;
    }
    const room = createRoom();
    room.players.left = user.userId;
    sendJson(response, 201, { roomCode: room.code, playerId: "left" });
    return;
  }
  if (request.method === "POST" && requestUrl.pathname === "/api/room/leave") {
    const member = findRoomByUser(user.userId);
    if (member) closeRoom(member.room);
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method === "POST" && requestUrl.pathname === "/api/room/ticket") {
    const member = findRoomByUser(user.userId);
    if (!member) {
      sendJson(response, 404, { error: "房间已关闭" });
      return;
    }
    const ticket = randomBytes(24).toString("hex");
    tickets.set(ticket, {
      room: member.room,
      side: member.playerId,
      expiresAt: Date.now() + 15000,
    });
    sendJson(response, 200, { ticket });
    return;
  }
  const joinMatch = requestUrl.pathname.match(
    /^\/api\/rooms\/([A-Z0-9]{6})\/join$/,
  );
  if (request.method === "POST" && joinMatch) {
    const code = joinMatch[1];
    const room = rooms.get(code);
    if (!room) {
      sendJson(response, 404, { error: "房间不存在或已过期" });
      return;
    }
    const existing = findRoomByUser(user.userId);
    if (existing && existing.room.code === code) {
      sendJson(response, 200, { roomCode: code, playerId: existing.playerId });
      return;
    }
    if (existing) {
      sendJson(response, 409, { error: "请先退出当前房间" });
      return;
    }
    if (room.players.right) {
      sendJson(response, 409, { error: "房间已经有两名玩家" });
      return;
    }
    room.players.right = user.userId;
    sendJson(response, 200, { roomCode: code, playerId: "right" });
    return;
  }
  sendJson(response, 404, { error: "接口不存在" });
}

const httpServer = createServer((request, response) => {
  handleHttp(request, response).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "服务器错误";
    sendJson(response, 400, { error: message });
  });
});

httpServer.on("upgrade", (request, socket, head) => {
  const requestUrl = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );
  if (requestUrl.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  const key = requestUrl.searchParams.get("ticket") ?? "";
  const ticket = tickets.get(key);
  tickets.delete(key);
  if (
    !ticket ||
    ticket.expiresAt <= Date.now() ||
    rooms.get(ticket.room.code) !== ticket.room
  ) {
    socket.destroy();
    return;
  }
  webSockets.handleUpgrade(request, socket, head, (ws) =>
    handleSocket(ticket.room, ws, ticket.side),
  );
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (!room.sockets.size && Date.now() - room.idleSince > 600000)
      closeRoom(room);
    if (room.sockets.size === 2)
      room.game.step(tickMs / 1000, performance.now());
    for (const [socket, side] of room.sockets) {
      if (socket.bufferedAmount > 65536) continue;
      sendSocket(socket, {
        type: "snapshot",
        online: room.sockets.size,
        state: room.game.view(side),
      });
    }
  }
}, tickMs);
setInterval(() => {
  for (const [key, value] of tickets)
    if (value.expiresAt <= Date.now()) tickets.delete(key);
  for (const [key, value] of sessions)
    if (value.expiresAt <= Date.now()) sessions.delete(key);
}, 60000).unref();

httpServer.listen(port, process.env.HOST ?? "127.0.0.1", () => {
  console.log("联机服务已启动", httpServer.address());
});
