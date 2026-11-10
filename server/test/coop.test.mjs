import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocket } from "ws";
import { Game } from "../dist/game.js";

test("符文、光带、同步及双端私有线索", () => {
  const g = new Game();
  g.resonate("left",0);
  assert.equal(g.mistakes,1);
  for(const stage of [0,1,2]){
    for(const [side,other] of [["left","right"],["right","left"]]){
      const view=g.view(other);
      const target=view.pads[side].find(p=>p.rune===(view.clue+view.shift)%3);
      Object.assign(g.balls[side], target);
    }
    if(stage===0){
      g.balls.left.x-=31; g.balls.right.x+=31;
      g.resonate("left",0);
      assert.match(g.notice,/长度/);g.balls.left.x+=31;g.balls.right.x-=31;
    }
    g.resonate("left",1000);g.step(0,1301);
    assert.equal(g.stage,stage);
    g.resonate("right",2000);g.resonate("left",2300);
    assert.equal(g.stage,stage+1);
  }
  assert.equal(g.finished,true);
});

test("真实双账号通过 HTTP 和 WebSocket 完成三关，断线可重连", { timeout: 90000 }, async t => {
  const dir=await mkdtemp(join(tmpdir(),"qiuqiu-"));
  const processHandle=spawn(process.execPath,["dist/index.js"],{env:{...process.env,PORT:"0",ACCOUNTS_FILE:join(dir,"accounts.json")},stdio:["ignore","pipe","inherit"]});
  const sockets=[];
  t.after(async()=>{
    for(const ws of sockets)ws.terminate();
    const closed=once(processHandle,"close");processHandle.kill();await closed;
    await rm(dir,{recursive:true,force:true});
  });
  const [ready]=await once(processHandle.stdout,"data");
  const port=String(ready).match(/port: (\d+)/)[1];
  const host="127.0.0.1:"+port;
  async function api(path,token,body){
    const r=await fetch("http://"+host+"/api/"+path,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+(token||"")},body:JSON.stringify(body||{})});
    return {status:r.status,...await r.json()};
  }
  const tokens=[];
  for(const username of ["PilotA","PilotB","PilotC"]){
    const credentials={username,password:randomBytes(16).toString("hex")};
    assert.equal((await api("auth/register",null,credentials)).status,201);
    const login=await api("auth/login",null,credentials);
    assert.equal(login.status,200);tokens.push(login.token);
  }
  const room=await api("rooms",tokens[0]);
  const joinPath="rooms/"+room.roomCode+"/join";
  assert.equal(room.playerId,"left");assert.equal((await api(joinPath,tokens[1])).playerId,"right");
  assert.equal((await api(joinPath,tokens[2])).status,409);
  assert.equal((await api("room/ticket",tokens[2])).status,404);
  async function connect(token){
    const {ticket}=await api("room/ticket",token);
    const ws=new WebSocket("ws://"+host+"/ws?ticket="+ticket);sockets.push(ws);
    const client={ws,msg:null,send:m=>ws.send(JSON.stringify(m))};
    ws.on("message",data=>{const m=JSON.parse(data);if(m.type==="snapshot")client.msg=m;});
    await once(ws,"open");return client;
  }
  const left=await connect(tokens[0]);let right=await connect(tokens[1]);
  async function until(fn,ms=3000){
    const end=Date.now()+ms;
    while(!fn()){if(Date.now()>end)throw Error("等待联机状态超时");await sleep(20);}
  }
  await until(()=>left.msg?.online===2 && right.msg?.online===2);
  const pos=right.msg.state.balls.left.x;
  left.send({type:"input",x:1,y:0,playerId:"right"});
  await until(()=>right.msg.state.balls.left.x>pos+10);
  right.ws.close();await until(()=>left.msg.online===1);
  const paused=left.msg.state.balls;await sleep(180);assert.deepEqual(left.msg.state.balls,paused);
  right=await connect(tokens[1]);await until(()=>right.msg?.online===2 && left.msg.online===2);
  for(const stage of [0,1,2]){
    const deadline=Date.now()+20000;
    while(true){
      const state=left.msg.state;
      const targets={};
      for(const [seat,other] of [["left",right],["right",left]]){
        const clue=other.msg.state;
        targets[seat]=state.pads[seat].find(p=>p.rune===(clue.clue+clue.shift)%3);
      }
      const close=["left","right"].every(seat=>Math.hypot(targets[seat].x-state.balls[seat].x,targets[seat].y-state.balls[seat].y)<9);
      if(close && state.length>=state.range[0] && state.length<=state.range[1])break;
      assert.ok(Date.now()<deadline,"通过正常输入到达节点 "+stage);
      for(const [seat,client] of [["left",left],["right",right]]){
        const target=targets[seat],ball=state.balls[seat],other=state.balls[seat==="left"?"right":"left"];
        const length=Math.max(1,state.length),pull=Math.max(0,length-170)*4;
        client.send({type:"input",x:(target.x-ball.x)/38-(other.x-ball.x)*pull/length/1700,
          y:(target.y-ball.y)/38-(other.y-ball.y)*pull/length/1700});
      }
      await sleep(50);
    }
    left.send({type:"resonate",stage});right.send({type:"resonate",stage});
    await until(()=>left.msg.state.stage===stage+1 && right.msg.state.stage===stage+1);
  }
  assert.ok(left.msg.state.finished && right.msg.state.finished);
  left.send({type:"reset"});await until(()=>right.msg.state.stage===0 && !right.msg.state.finished);
  assert.equal((await api("room/leave",tokens[1])).status,200);
  await until(()=>left.ws.readyState===WebSocket.CLOSED);
});
