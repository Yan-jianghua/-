export type Side = "left" | "right";
type Point = { x: number; y: number };
type Pad = Point & { rune: number };
export type Snapshot = {
  balls: Record<Side, Point>; pads: Record<Side, Pad[]>; stage: number; name: string;
  finished: boolean; range: number[]; length: number; shift: number; clue: number;
  notice: string; mistakes: number;
};
export const runes = ["月", "潮", "花"];
export const names = { left: "噗噗", right: "嘟嘟" };
const colors = { left: "#ffb3a9", right: "#94e3dc" };

export function draw(canvas: HTMLCanvasElement, game: Snapshot, me: Side) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const dpr = Math.min(devicePixelRatio, 2);
  if (canvas.width !== Math.round(w*dpr) || canvas.height !== Math.round(h*dpr)) {
    canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr);
  }
  const upright = h > w;
  const width = upright ? 720 : 1280, height = upright ? 1280 : 720;
  const scale = Math.min(w/width, h/height);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  ctx.translate((w-width*scale)/2,(h-height*scale)/2);
  ctx.scale(scale,scale);
  const project = (p: Point) => upright ? { x: 720-p.y, y: p.x } : p;
  function circle(p: Point, radius: number) {
    ctx!.beginPath(); ctx!.arc(p.x,p.y,radius,0,Math.PI*2);
  }
  const bg = ctx.createRadialGradient(width*.65,height*.4,20,width*.4,height*.5,width*.85);
  bg.addColorStop(0,"#354658"); bg.addColorStop(1,"#12243b");
  ctx.fillStyle=bg; ctx.fillRect(0,0,width,height);
  ctx.strokeStyle="#b3ceca20";
  for(let i=0;i<5;i++){
    ctx.beginPath();ctx.ellipse(width*.55,height*.5,125+i*100,70+i*65,-.3,0,Math.PI*2);ctx.stroke();
  }
  ctx.fillStyle="#d7dfb9aa";
  for(let i=1;i<=70;i++){circle(project({x:i*277%1280,y:i*i*37%720}),i%3+1);ctx.fill();}
  ctx.textAlign="center"; ctx.textBaseline="middle";
  for(const side of ["left","right"] as const){
    for(const pad of game.pads[side]){
      const p=project(pad); circle(p,35);ctx.fillStyle="#16263a";ctx.fill();
      ctx.strokeStyle=colors[side];ctx.lineWidth=4;ctx.stroke();
      ctx.fillStyle=colors[side];ctx.font="bold 28px sans-serif";ctx.fillText(runes[pad.rune],p.x,p.y);
    }
  }
  const a=project(game.balls.left), b=project(game.balls.right);
  ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
  ctx.strokeStyle="#ece9ac";ctx.lineWidth=7;ctx.lineCap="round";ctx.stroke();
  for(const side of ["left","right"] as const){
    const p=project(game.balls[side]);circle(p,23);ctx.fillStyle=colors[side];ctx.fill();
    if(side===me){circle(p,29);ctx.strokeStyle="#fffbe3";ctx.lineWidth=2;ctx.stroke();}
    ctx.fillStyle="#23304d"; for(const dx of [-8,8]){circle({x:p.x+dx,y:p.y-2},3.5);ctx.fill();}
    ctx.beginPath();ctx.arc(p.x,p.y+3,6,.2,Math.PI-.2);ctx.lineWidth=2;ctx.strokeStyle="#23304d";ctx.stroke();
  }
}
