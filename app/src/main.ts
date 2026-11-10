import "./style.css";

type PlayerId = "left" | "right";
type Point = { x: number; y: number };
type Ball = Point & { vx: number; vy: number; color: string; glow: string; label: string };
type Control = {
  x: number;
  y: number;
  active: boolean;
  pointerId?: number;
  pointerX: number;
  pointerY: number;
};

const canvasElement = document.querySelector<HTMLCanvasElement>("#game");
const objectiveElement = document.querySelector<HTMLDivElement>("#objective");
const resetButtonElement = document.querySelector<HTMLButtonElement>("#reset");
const playAgainButtonElement = document.querySelector<HTMLButtonElement>("#play-again");
const completePanelElement = document.querySelector<HTMLDivElement>("#complete");

if (!canvasElement || !objectiveElement || !resetButtonElement || !playAgainButtonElement || !completePanelElement) {
  throw new Error("游戏界面初始化失败");
}

const canvas: HTMLCanvasElement = canvasElement;
const objective: HTMLDivElement = objectiveElement;
const resetButton: HTMLButtonElement = resetButtonElement;
const playAgainButton: HTMLButtonElement = playAgainButtonElement;
const completePanel: HTMLDivElement = completePanelElement;
const contextElement = canvas.getContext("2d");
if (!contextElement) throw new Error("当前浏览器不支持 Canvas");
const context: CanvasRenderingContext2D = contextElement;

const world = { width: 1280, height: 720 };
const ballRadius = 25;
const restLength = 170;
const maxLength = 330;
const starRadius = 13;
const starLocations: Point[] = [
  { x: 180, y: 180 },
  { x: 400, y: 520 },
  { x: 640, y: 200 },
  { x: 880, y: 510 },
  { x: 1110, y: 230 },
];
let stars: Point[] = [];

const keys = new Set<string>();
const controls: Record<PlayerId, Control> = {
  left: { x: 0, y: 0, active: false, pointerX: 0, pointerY: 0 },
  right: { x: 0, y: 0, active: false, pointerX: 0, pointerY: 0 },
};

let balls: Record<PlayerId, Ball>;
let collected = 0;
let finished = false;
let lastTime = performance.now();
let viewportScale = 1;

function resetGame(): void {
  balls = {
    left: { x: world.width * 0.38, y: world.height * 0.55, vx: 0, vy: 0, color: "#ffb7c9", glow: "#ff779d", label: "噗噗" },
    right: { x: world.width * 0.62, y: world.height * 0.55, vx: 0, vy: 0, color: "#a9dcff", glow: "#69b9ff", label: "嘟嘟" },
  };
  stars = starLocations.map((star) => ({ ...star }));
  controls.left = { x: 0, y: 0, active: false, pointerX: 0, pointerY: 0 };
  controls.right = { x: 0, y: 0, active: false, pointerX: 0, pointerY: 0 };
  collected = 0;
  finished = false;
  completePanel.hidden = true;
  updateObjective();
}

function updateObjective(): void {
  objective.textContent = finished ? "星尘收集完成" : `一起收集星尘 ${collected} / ${stars.length}`;
}

function resizeCanvas(): void {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(canvas.clientWidth * pixelRatio);
  canvas.height = Math.floor(canvas.clientHeight * pixelRatio);
  viewportScale = Math.min(canvas.clientWidth / world.width, canvas.clientHeight / world.height);
}

function viewportOffset(): Point {
  return {
    x: (canvas.clientWidth - world.width * viewportScale) / 2,
    y: (canvas.clientHeight - world.height * viewportScale) / 2,
  };
}

function inputFor(player: PlayerId): Point {
  const control = controls[player];
  const keyboard = player === "left"
    ? { x: Number(keys.has("d")) - Number(keys.has("a")), y: Number(keys.has("s")) - Number(keys.has("w")) }
    : { x: Number(keys.has("ArrowRight")) - Number(keys.has("ArrowLeft")), y: Number(keys.has("ArrowDown")) - Number(keys.has("ArrowUp")) };
  if (control.active && (control.x !== 0 || control.y !== 0)) return { x: control.x, y: control.y };
  return keyboard;
}

function updateBall(ball: Ball, input: Point, dt: number): void {
  const acceleration = 650;
  const damping = Math.pow(0.0008, dt);
  ball.vx += input.x * acceleration * dt;
  ball.vy += input.y * acceleration * dt;
  ball.vx *= damping;
  ball.vy *= damping;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.x = Math.max(ballRadius, Math.min(world.width - ballRadius, ball.x));
  ball.y = Math.max(ballRadius, Math.min(world.height - ballRadius, ball.y));
}

function applyRibbon(dt: number): void {
  const left = balls.left;
  const right = balls.right;
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const distance = Math.hypot(dx, dy) || 1;
  const extension = distance - restLength;
  if (extension <= 0) return;
  const force = Math.min(extension * 5.2, 1200);
  const nx = dx / distance;
  const ny = dy / distance;
  left.vx += force * nx * dt;
  left.vy += force * ny * dt;
  right.vx -= force * nx * dt;
  right.vy -= force * ny * dt;
  if (distance > maxLength) {
    const midpoint = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
    const half = maxLength / 2;
    left.x = midpoint.x - nx * half;
    left.y = midpoint.y - ny * half;
    right.x = midpoint.x + nx * half;
    right.y = midpoint.y + ny * half;
  }
}

function collectStars(): void {
  const remaining: Point[] = [];
  for (const star of stars) {
    const leftHit = Math.hypot(star.x - balls.left.x, star.y - balls.left.y) < ballRadius + starRadius;
    const rightHit = Math.hypot(star.x - balls.right.x, star.y - balls.right.y) < ballRadius + starRadius;
    if (leftHit || rightHit) collected += 1;
    else remaining.push(star);
  }
  stars = remaining;
  if (collected === 5) {
    finished = true;
    completePanel.hidden = false;
  }
  updateObjective();
}

function update(dt: number): void {
  if (finished) return;
  updateBall(balls.left, inputFor("left"), dt);
  updateBall(balls.right, inputFor("right"), dt);
  applyRibbon(dt);
  collectStars();
}

function drawBackground(): void {
  const gradient = context.createLinearGradient(0, 0, world.width, world.height);
  gradient.addColorStop(0, "#202a5c");
  gradient.addColorStop(0.5, "#18264e");
  gradient.addColorStop(1, "#101934");
  context.fillStyle = gradient;
  context.fillRect(0, 0, world.width, world.height);
  context.fillStyle = "rgba(255, 231, 168, .12)";
  for (let i = 0; i < 40; i += 1) {
    const x = (i * 197) % world.width;
    const y = (i * 113) % world.height;
    const radius = (i % 3) + 1;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
}

function drawRibbon(): void {
  const left = balls.left;
  const right = balls.right;
  const distance = Math.hypot(right.x - left.x, right.y - left.y);
  const tension = Math.min(Math.max((distance - restLength) / (maxLength - restLength), 0), 1);
  context.save();
  context.lineCap = "round";
  context.shadowBlur = 24;
  context.shadowColor = tension > 0.8 ? "#ff9cbb" : "#b3e7ff";
  context.strokeStyle = tension > 0.8 ? "#ff9cbb" : "#c7f1ff";
  context.lineWidth = 10 + tension * 8;
  context.beginPath();
  context.moveTo(left.x, left.y);
  context.lineTo(right.x, right.y);
  context.stroke();
  context.restore();
}

function drawStar(star: Point, index: number): void {
  const pulse = 1 + Math.sin(performance.now() / 380 + index) * 0.12;
  context.save();
  context.translate(star.x, star.y);
  context.scale(pulse, pulse);
  context.shadowBlur = 20;
  context.shadowColor = "#ffe8a6";
  context.fillStyle = "#ffe8a6";
  context.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? 16 : 6;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.closePath();
  context.fill();
  context.restore();
}

function drawBall(ball: Ball): void {
  context.save();
  context.shadowBlur = 28;
  context.shadowColor = ball.glow;
  context.fillStyle = ball.color;
  context.beginPath();
  context.arc(ball.x, ball.y, ballRadius, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = "rgba(255,255,255,.55)";
  context.beginPath();
  context.arc(ball.x - 9, ball.y - 10, 6, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#182143";
  for (const eyeX of [-8, 8]) {
    context.beginPath();
    context.arc(ball.x + eyeX, ball.y - 2, 3.5, 0, Math.PI * 2);
    context.fill();
  }
  context.strokeStyle = "#182143";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(ball.x, ball.y + 4, 8, 0.15, Math.PI - 0.15);
  context.stroke();
  context.fillStyle = "rgba(255,255,255,.78)";
  context.font = "600 14px Nunito, Microsoft YaHei, sans-serif";
  context.textAlign = "center";
  context.fillText(ball.label, ball.x, ball.y + 52);
  context.restore();
}

function drawControls(): void {
  for (const control of Object.values(controls)) {
    if (!control.active) continue;
    context.save();
    context.globalAlpha = 0.22;
    context.fillStyle = "#fff5c4";
    context.beginPath();
    context.arc(control.pointerX, control.pointerY, 42, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

function render(): void {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  const offset = viewportOffset();
  context.save();
  context.translate(offset.x, offset.y);
  context.scale(viewportScale, viewportScale);
  drawBackground();
  for (let i = 0; i < stars.length; i += 1) drawStar(stars[i], i);
  drawRibbon();
  drawBall(balls.left);
  drawBall(balls.right);
  drawControls();
  context.restore();
}

function worldPoint(event: PointerEvent): Point {
  const bounds = canvas.getBoundingClientRect();
  const offset = viewportOffset();
  return {
    x: (event.clientX - bounds.left - offset.x) / viewportScale,
    y: (event.clientY - bounds.top - offset.y) / viewportScale,
  };
}

function setPointerControl(event: PointerEvent, player: PlayerId): void {
  const point = worldPoint(event);
  controls[player] = { x: 0, y: 0, active: true, pointerId: event.pointerId, pointerX: point.x, pointerY: point.y };
  canvas.setPointerCapture(event.pointerId);
}

function releasePointer(event: PointerEvent): void {
  for (const player of ["left", "right"] as const) {
    if (controls[player].pointerId === event.pointerId) controls[player] = { x: 0, y: 0, active: false, pointerX: 0, pointerY: 0 };
  }
}

function updatePointerControl(event: PointerEvent): void {
  const point = worldPoint(event);
  for (const player of ["left", "right"] as const) {
    if (controls[player].pointerId !== event.pointerId) continue;
    controls[player].pointerX = point.x;
    controls[player].pointerY = point.y;
    const center = player === "left" ? { x: world.width * 0.25, y: world.height * 0.82 } : { x: world.width * 0.75, y: world.height * 0.82 };
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.hypot(dx, dy) || 1;
    const strength = Math.min(length / 70, 1);
    controls[player].x = (dx / length) * strength;
    controls[player].y = (dy / length) * strength;
  }
}

window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", (event) => keys.add(event.key));
window.addEventListener("keyup", (event) => keys.delete(event.key));
canvas.addEventListener("pointerdown", (event) => setPointerControl(event, event.clientX < window.innerWidth / 2 ? "left" : "right"));
canvas.addEventListener("pointermove", updatePointerControl);
canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);
resetButton.addEventListener("click", resetGame);
playAgainButton.addEventListener("click", resetGame);

function loop(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.033);
  lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

resetGame();
resizeCanvas();
requestAnimationFrame(loop);
