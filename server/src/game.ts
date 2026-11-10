import { randomInt } from "node:crypto";

export type Side = "left" | "right";
export type Point = { x: number; y: number };
type Ball = Point & { vx: number; vy: number };
type Pad = Point & { rune: number };
export const sides = ["left", "right"] as const;
export const partner = (id: Side): Side => (id === "left" ? "right" : "left");
const stages = [
  {
    name: "回声井",
    left: [300, 210],
    right: [480, 210],
    range: [165, 200],
    shift: 0,
  },
  {
    name: "逆相潮",
    left: [880, 310],
    right: [760, 310],
    range: [100, 136],
    shift: 1,
  },
  {
    name: "天琴塔",
    left: [640, 405],
    right: [640, 650],
    range: [222, 263],
    shift: 2,
  },
];

function makePads(center: number[], vertical: boolean): Pad[] {
  const runes = [0, 1, 2];
  const offsets = [-90, 0, 90];
  // Move the correct pad within the constellation each round.
  const winningSlot = randomInt(3);
  return offsets.map((offset) => {
    const delta = offset - offsets[winningSlot];
    return {
      x: center[0] + (vertical ? delta : 0),
      y: center[1] + (vertical ? 0 : delta),
      rune: runes.splice(randomInt(runes.length), 1)[0],
    };
  });
}

function makeStage(index: number) {
  const spec = stages[index];
  const pads = {
    left: makePads(spec.left, index === 2),
    right: makePads(spec.right, index === 2),
  };
  function target(side: Side) {
    return pads[side].find(
      (p) => p.x === spec[side][0] && p.y === spec[side][1],
    )!;
  }
  return { ...spec, pads, target };
}

export class Game {
  balls: Record<Side, Ball> = {
    left: { x: 520, y: 360, vx: 0, vy: 0 },
    right: { x: 760, y: 360, vx: 0, vy: 0 },
  };
  inputs: Record<Side, Point> = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
  stage = 0;
  mistakes = 0;
  notice = "";
  puzzle = makeStage(0);
  pending: { side: Side; at: number } | null = null;
  get finished() {
    return this.stage === stages.length;
  }
  get length() {
    return Math.hypot(
      this.balls.right.x - this.balls.left.x,
      this.balls.right.y - this.balls.left.y,
    );
  }
  pause() {
    this.pending = null;
    for (const side of sides) {
      this.inputs[side] = { x: 0, y: 0 };
      this.balls[side].vx = this.balls[side].vy = 0;
    }
  }
  step(dt: number, now: number) {
    if (this.finished) return;
    if (this.pending && now - this.pending.at > 300)
      this.fail("回声已散。约好节拍，再一起按。");
    const left = this.balls.left,
      right = this.balls.right;
    const length = this.length || 1;
    const nx = (right.x - left.x) / length,
      ny = (right.y - left.y) / length;
    const pull = Math.max(0, length - 170) * 4;
    for (const side of sides) {
      const ball = this.balls[side],
        input = this.inputs[side],
        sign = side === "left" ? 1 : -1;
      const magnitude = Math.max(1, Math.hypot(input.x, input.y));
      const damp = Math.exp(-7 * dt);
      ball.vx =
        (ball.vx + ((1700 * input.x) / magnitude + sign * nx * pull) * dt) *
        damp;
      ball.vy =
        (ball.vy + ((1700 * input.y) / magnitude + sign * ny * pull) * dt) *
        damp;
      ball.x = Math.max(25, Math.min(1255, ball.x + ball.vx * dt));
      ball.y = Math.max(25, Math.min(695, ball.y + ball.vy * dt));
    }
    const stretched = this.length;
    if (stretched > 330) {
      const ratio = (stretched - 330) / (2 * stretched);
      const dx = (right.x - left.x) * ratio,
        dy = (right.y - left.y) * ratio;
      left.x += dx;
      right.x -= dx;
      left.y += dy;
      right.y -= dy;
    }
  }
  private fail(message: string) {
    this.mistakes++;
    this.pending = null;
    this.notice = message;
  }
  resonate(side: Side, now: number) {
    if (this.finished || this.pending?.side === side) return;
    const bothReady = sides.every((s) => {
      const target = this.puzzle.target(s),
        ball = this.balls[s];
      return Math.hypot(ball.x - target.x, ball.y - target.y) <= 35;
    });
    if (!bothReady)
      return this.fail("符文未对齐。交换线索，站到各自的符文中心。");
    const [min, max] = this.puzzle.range;
    if (this.length < min || this.length > max)
      return this.fail("光带长度超出刻度。微调位置后再试。");
    if (!this.pending) {
      this.pending = { side, at: now };
      return;
    }
    if (now - this.pending.at > 300)
      return this.fail("回声错拍。约好节拍再试。");
    this.stage++;
    this.pending = null;
    this.notice = this.finished
      ? "三座星门已点亮"
      : "星门已点亮，下一段星图已展开";
    if (!this.finished) this.puzzle = makeStage(this.stage);
  }
  view(side: Side) {
    const p = this.puzzle;
    return {
      balls: this.balls,
      stage: this.stage,
      name: p.name,
      finished: this.finished,
      pads: p.pads,
      range: p.range,
      length: Math.round(this.length),
      shift: p.shift,
      clue: (p.target(partner(side)).rune - p.shift + 3) % 3,
      mistakes: this.mistakes,
      notice: this.notice,
    };
  }
}
