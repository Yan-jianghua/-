import "./style.css";
import { draw, names, runes, type Side, type Snapshot } from "./board";

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error("缺少界面元素 " + id);
  return node as T;
}
const auth = el<HTMLFormElement>("auth"),
  rooms = el<HTMLFormElement>("rooms");
const canvas = el<HTMLCanvasElement>("board"),
  endpoint = el<HTMLInputElement>("endpoint");
const native = location.hostname === "appassets.androidplatform.net";
el("endpoint-field").hidden = !native;
endpoint.value =
  localStorage.getItem("planet-server") ||
  import.meta.env.VITE_SERVER_URL ||
  "";
let base = location.origin,
  token = "",
  room = "",
  side: Side = "left",
  online = 0;
let ws: WebSocket | null = null,
  state: Snapshot | null = null,
  connecting = false;
const keys = new Set<string>();
let drag: { id: number; x: number; y: number } | null = null;
let stick = { x: 0, y: 0 };
async function api<T>(path: string, body?: object): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(new URL(path, base), {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const data = await res.json();
    if (res.status === 401 && token) {
      token = "";
      showLobby();
      el("error").textContent = "登录已过期，请重新登录。";
    }
    if (!res.ok) throw new Error(data.error || "请求失败");
    return data;
  } finally {
    clearTimeout(timer);
  }
}
function report(e: unknown) {
  return e instanceof TypeError
    ? "无法连接联机服务，请检查地址与网络。"
    : e instanceof Error
      ? e.message
      : "连接失败";
}
function action(id: string, fn: () => Promise<void>) {
  el<HTMLButtonElement>(id).onclick = async (e) => {
    const button = e.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      await fn();
    } catch (err) {
      el(room ? "feedback" : "error").textContent = report(err);
    } finally {
      button.disabled = false;
    }
  };
}
function showLobby() {
  const old = ws;
  ws = null;
  old?.close();
  room = "";
  state = null;
  online = 0;
  clearInput();
  el("play").hidden = true;
  el("lobby").hidden = false;
  auth.hidden = !!token;
  rooms.hidden = !token;
}
auth.onsubmit = async (e) => {
  e.preventDefault();
  const button = (e as SubmitEvent).submitter as HTMLButtonElement;
  if (auth.dataset.busy) return;
  auth.dataset.busy = "1";
  el("error").textContent = "";
  try {
    if (native) {
      const url = new URL(endpoint.value);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error("请输入有效的服务地址");
      base = url.origin;
    }
    const user = el<HTMLInputElement>("user").value.trim(),
      pass = el<HTMLInputElement>("pass");
    const data = await api<{ token: string; username: string }>(
      "/api/auth/" + (button?.value === "register" ? "register" : "login"),
      { username: user, password: pass.value },
    );
    token = data.token;
    pass.value = "";
    if (native) localStorage.setItem("planet-server", base);
    el("account").textContent = data.username;
    showLobby();
  } catch (err) {
    el("error").textContent = report(err);
  } finally {
    delete auth.dataset.busy;
  }
};
async function enter(path: string) {
  const data = await api<{ roomCode: string; playerId: Side }>(path);
  room = data.roomCode;
  side = data.playerId;
  el("room").textContent = "房间 " + room;
  el("identity").textContent = "你是" + names[side];
  el("title").textContent = "连接星图";
  el("clue").textContent = "把房间码告诉搭档";
  el("rule").textContent = "";
  el("received").textContent = "";
  el("signals").hidden = true;
  el("error").textContent = "";
  el("lobby").hidden = true;
  el("play").hidden = false;
  el("again").hidden = true;
  el("pulse").hidden = false;
  el<HTMLButtonElement>("pulse").disabled = true;
  await connect();
}
action("create", () => enter("/api/rooms"));
rooms.onsubmit = async (e) => {
  e.preventDefault();
  try {
    await enter(
      "/api/rooms/" +
        el<HTMLInputElement>("code").value.trim().toUpperCase() +
        "/join",
    );
  } catch (err) {
    el("error").textContent = report(err);
  }
};
el("logout").onclick = () => {
  token = "";
  el("error").textContent = "";
  showLobby();
};
action("exit", async () => {
  await api("/api/room/leave");
  showLobby();
});
async function connect() {
  if (connecting || !room) return;
  connecting = true;
  const expected = room;
  el("retry").hidden = true;
  el("feedback").textContent = "正在连接…";
  try {
    const { ticket } = await api<{ ticket: string }>("/api/room/ticket");
    if (room !== expected) return;
    const url = new URL("/ws", base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("ticket", ticket);
    const socket = new WebSocket(url);
    ws = socket;
    socket.onmessage = (e) => {
      if (socket !== ws) return;
      const msg = JSON.parse(e.data);
      if (msg.type === "signal" && state?.stage === msg.stage) {
        el("received").textContent = "搭档报点：" + runes[msg.rune];
        return;
      }
      if (msg.type !== "snapshot") return;
      const g: Snapshot = msg.state;
      if (state?.stage !== g.stage) el("received").textContent = "";
      state = g;
      online = msg.online;
      el("signals").hidden = g.finished || online < 2;
      el("title").textContent = g.finished
        ? "三座星门已点亮"
        : g.stage + 1 + " / 3 · " + g.name;
      el("clue").textContent = g.finished
        ? "双人通关"
        : "告诉搭档：" +
          runes[g.clue] +
          "，沿「月 → 潮 → 花 → 月」前进 " +
          g.shift +
          " 格";
      el("rule").textContent = g.finished
        ? ""
        : "自己走到搭档解出的" +
          (side === "left" ? "粉色" : "薄荷色") +
          "符文。带长 " +
          g.length +
          " / 目标 " +
          g.range.join("–");
      el("feedback").textContent =
        online < 2
          ? "等待搭档连接，房间进度已保留"
          : (g.notice || "双方就位后，在 300 毫秒内一起共振") +
            " · 失误 " +
            g.mistakes;
      el("again").hidden = !g.finished;
      el("pulse").hidden = g.finished;
      el<HTMLButtonElement>("pulse").disabled = online < 2;
      el<HTMLButtonElement>("again").disabled = online < 2;
      draw(canvas, g, side);
    };
    socket.onclose = (e) => {
      if (ws !== socket) return;
      ws = null;
      online = 0;
      clearInput();
      if (e.code === 4002) {
        showLobby();
        el("error").textContent = "房间已关闭，可以重新组队。";
        return;
      }
      el("feedback").textContent =
        e.code === 4001 ? "此账号已在另一端连接" : "连接已断开，可重连继续";
      el("retry").hidden = false;
      el<HTMLButtonElement>("pulse").disabled = true;
    };
  } catch (err) {
    el("feedback").textContent = report(err);
    el("retry").hidden = false;
  } finally {
    connecting = false;
  }
}
action("retry", connect);
function send(msg: object) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-rune]",
)) {
  button.onclick = () => {
    if (state && online === 2)
      send({
        type: "signal",
        stage: state.stage,
        rune: Number(button.dataset.rune),
      });
  };
}
function pulse() {
  if (online === 2 && state && !state.finished)
    send({ type: "resonate", stage: state.stage });
}
el("pulse").onclick = pulse;
el("again").onclick = () => send({ type: "reset" });
function move() {
  let x =
    stick.x +
    Number(keys.has("ArrowRight") || keys.has("d")) -
    Number(keys.has("ArrowLeft") || keys.has("a"));
  let y =
    stick.y +
    Number(keys.has("ArrowDown") || keys.has("s")) -
    Number(keys.has("ArrowUp") || keys.has("w"));
  if (canvas.clientHeight > canvas.clientWidth) [x, y] = [y, -x];
  send({ type: "input", x, y });
}
function clearInput() {
  keys.clear();
  drag = null;
  stick = { x: 0, y: 0 };
  move();
}
window.onblur = clearInput;
document.onvisibilitychange = () => {
  if (document.hidden) clearInput();
};
window.onkeydown = (e) => {
  if (!room || e.repeat) return;
  if (e.code === "Space" && !(e.target instanceof HTMLButtonElement)) {
    e.preventDefault();
    pulse();
  }
  if (
    [
      "ArrowDown",
      "ArrowUp",
      "ArrowLeft",
      "ArrowRight",
      "w",
      "a",
      "s",
      "d",
    ].includes(e.key)
  ) {
    e.preventDefault();
    keys.add(e.key);
    move();
  }
};
window.onkeyup = (e) => {
  if (keys.delete(e.key)) move();
};
canvas.onpointerdown = (e) => {
  if (drag) return;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
};
canvas.onpointermove = (e) => {
  if (drag?.id !== e.pointerId) return;
  const x = e.clientX - drag.x,
    y = e.clientY - drag.y,
    k = Math.max(32, Math.hypot(x, y));
  stick = { x: x / k, y: y / k };
  move();
};
canvas.onlostpointercapture =
  canvas.onpointercancel =
  canvas.onpointerup =
    (e) => {
      if (drag?.id === e.pointerId) {
        drag = null;
        stick = { x: 0, y: 0 };
        move();
      }
    };
