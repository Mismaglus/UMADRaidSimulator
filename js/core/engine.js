"use strict";
/* core/engine.js — 共享引擎：数学/配置/WebGL/网格/Scene/相机/移动/击退/手柄 */
/* ==0 UTIL== 数学（手写 vec3 / mat4，列主序 column-major，WebGL 约定） */
const TAU = Math.PI * 2;
const clamp = (v,a,b)=> v<a?a : v>b?b : v;
const d2r = d=> d*Math.PI/180;
const v3sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const v3dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const v3cross=(a,b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const v3norm=a=>{const l=Math.hypot(a[0],a[1],a[2])||1; return [a[0]/l,a[1]/l,a[2]/l];};

function mPerspective(fovy,aspect,near,far){
  const f=1/Math.tan(fovy/2), nf=1/(near-far), o=new Float32Array(16);
  o[0]=f/aspect; o[5]=f; o[10]=(far+near)*nf; o[11]=-1; o[14]=2*far*near*nf; return o;
}
function mLookAt(eye,center,up){
  const z=v3norm(v3sub(eye,center)), x=v3norm(v3cross(up,z)), y=v3cross(z,x), o=new Float32Array(16);
  o[0]=x[0];o[1]=y[0];o[2]=z[0];o[3]=0;
  o[4]=x[1];o[5]=y[1];o[6]=z[1];o[7]=0;
  o[8]=x[2];o[9]=y[2];o[10]=z[2];o[11]=0;
  o[12]=-v3dot(x,eye);o[13]=-v3dot(y,eye);o[14]=-v3dot(z,eye);o[15]=1; return o;
}
function mMul(a,b){
  const o=new Float32Array(16);
  for(let c=0;c<4;c++)for(let r=0;r<4;r++)
    o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];
  return o;
}
/* model = T(tx,ty,tz) * RotateY(ry) * Scale(sx,sy,sz) */
function mModel(tx,ty,tz,ry,sx,sy,sz){
  const c=Math.cos(ry), s=Math.sin(ry), o=new Float32Array(16);
  o[0]=c*sx; o[2]=-s*sx; o[5]=sy; o[8]=s*sz; o[10]=c*sz; o[12]=tx; o[13]=ty; o[14]=tz; o[15]=1; return o;
}
const MID = mModel(0,0,0,0,1,1,1); // identity (for static meshes already in world units)
/* 世界点 -> 屏幕(CSS px)，用于头顶文字。VP 列主序。 */
function projHead(VP,x,y,z){
  const cx=VP[0]*x+VP[4]*y+VP[8]*z+VP[12];
  const cy=VP[1]*x+VP[5]*y+VP[9]*z+VP[13];
  const cw=VP[3]*x+VP[7]*y+VP[11]*z+VP[15];
  if(cw<=1e-3) return null;
  return [(cx/cw*0.5+0.5)*cssW, (1-(cy/cw*0.5+0.5))*cssH];
}

/* ==1 CONFIG== */
const R = 20;                       // 竞技场半径(m) — 默认/Forsaken
let ARENA_R = R;                    // 当前机制的场地半径(由 SIM.select 设置；地面/网格/边环/场地标点都按它缩放)
const CAM = {fov:50, near:0.1, far:500};
const cam = {yaw:Math.PI, pitch:d2r(55), dist:38, target:[0,0,0]};
const UP = [0,1,0];
const SPEED = 6.5;                  // 玩家移动 m/s
const COL = {
  ground:[0.13,0.15,0.19], grid:[0.32,0.38,0.46],
  MT:[0.231,0.435,0.878], ST:[0.231,0.435,0.878],
  H1:[0.211,0.698,0.353], H2:[0.211,0.698,0.353],
  D1:[0.827,0.227,0.227], D2:[0.827,0.227,0.227], D3:[0.827,0.227,0.227], D4:[0.827,0.227,0.227],
  BOSS:[0.95,0.95,0.95], self:[1.0,0.85,0.2]
};
const roleColor = r => COL[r] || [0.7,0.7,0.7];
/* 贴花样式：mesh 名 + 颜色 + 透明度 + 微抬高度(防 z-fighting) */
const DECAL_STYLE = {
  tower:     {mesh:'annulus', color:[0.95,0.95,0.80], alpha:0.55, y:0.020, thin:false},
  spread:    {mesh:'circle',  color:[0.95,0.80,0.20], alpha:0.33, y:0.030},
  stack:     {mesh:'circle',  color:[0.30,0.70,1.00], alpha:0.33, y:0.030},
  cone:      {mesh:'cone',    color:[1.00,0.55,0.10], alpha:0.42, y:0.035},
  donut:     {mesh:'donut',   color:[0.40,0.62,1.00], alpha:0.34, y:0.028},   // 环形AOE(中心安全)；颜色随属性传入
  halfcleave:{mesh:'half',    color:[0.70,0.20,0.90], alpha:0.30, y:0.015},
  charge:    {mesh:'annulus', color:[1.00,0.85,0.20], alpha:0.60, y:0.040, thin:true},
  bossring:  {mesh:'annulus', color:[0.50,0.55,0.68], alpha:0.50, y:0.014, thin:true}   // boss 身位环
};
/* 场地标点：A 正北(红)，顺时针 1·B·2·C·3·D·4（正点+斜点） */
const WAYMARKS=(()=>{
  const rW=R*0.92, red=[0.95,0.27,0.27], yel=[0.96,0.82,0.22], cyan=[0.30,0.72,1.0], pur=[0.80,0.42,0.96];
  const defs=[['A',0,red],['1',45,red],['B',90,yel],['2',135,yel],['C',180,cyan],['3',225,cyan],['D',270,pur],['4',315,pur]];
  // 注意：默认镜头(南向北)会左右镜像，故 X 取负，使其在玩家视角里"顺时针"。dir=单位方向，绘制时×ARENA_R*0.92(适配不同场地)
  return defs.map(d=>{ const t=d2r(d[1]); return {label:d[0], color:d[2], dir:[-Math.sin(t), Math.cos(t)]}; });
})();

/* ==RENDER setup== WebGL 上下文、着色器、网格 */
const glc = document.getElementById('gl');
const gl = glc.getContext('webgl', {antialias:true, alpha:false});
const oc = document.getElementById('overlay');
const octx = oc.getContext('2d');
let cssW=1, cssH=1;

const VS = `attribute vec3 aPos; attribute float aShade;
  uniform mat4 uMVP; varying float vShade;
  void main(){ gl_Position=uMVP*vec4(aPos,1.0); vShade=aShade; }`;
const FS = `precision mediump float; uniform vec3 uColor; uniform float uAlpha;
  varying float vShade;
  void main(){ gl_FragColor=vec4(uColor*vShade, uAlpha); }`;
function compile(type,src){ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s);
  if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(s); return s; }
const prog = gl.createProgram();
gl.attachShader(prog,compile(gl.VERTEX_SHADER,VS));
gl.attachShader(prog,compile(gl.FRAGMENT_SHADER,FS));
gl.linkProgram(prog); gl.useProgram(prog);
const aPos=gl.getAttribLocation(prog,'aPos'), aShade=gl.getAttribLocation(prog,'aShade');
const uMVP=gl.getUniformLocation(prog,'uMVP'), uColor=gl.getUniformLocation(prog,'uColor'), uAlpha=gl.getUniformLocation(prog,'uAlpha');
gl.enableVertexAttribArray(aPos); gl.enableVertexAttribArray(aShade);

function mkMesh(arr,mode){
  const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(arr),gl.STATIC_DRAW);
  return {buf, count:arr.length/4, mode};
}
function drawMesh(mesh,MVP,color,alpha){
  gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buf);
  gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,16,0);
  gl.vertexAttribPointer(aShade,1,gl.FLOAT,false,16,12);
  gl.uniformMatrix4fv(uMVP,false,MVP);
  gl.uniform3fv(uColor,color); gl.uniform1f(uAlpha,alpha);
  gl.drawArrays(mesh.mode,0,mesh.count);
}

/* ==3 geometry builders== 每顶点 [x,y,z,shade] */
function buildCylinder(N){
  const v=[]; const sb=0.55, st=1.0;
  for(let i=0;i<N;i++){ const a0=i/N*TAU,a1=(i+1)/N*TAU;
    const c0=Math.cos(a0),s0=Math.sin(a0),c1=Math.cos(a1),s1=Math.sin(a1);
    v.push(c0,0,s0,sb, c1,0,s1,sb, c1,1,s1,st);
    v.push(c0,0,s0,sb, c1,1,s1,st, c0,1,s0,st);
  }
  for(let i=0;i<N;i++){ const a0=i/N*TAU,a1=(i+1)/N*TAU; // top cap
    v.push(0,1,0,1.1, Math.cos(a0),1,Math.sin(a0),1.0, Math.cos(a1),1,Math.sin(a1),1.0); }
  return v;
}
function buildDisc(rad,N,y,sh){
  const v=[]; for(let i=0;i<N;i++){ const a0=i/N*TAU,a1=(i+1)/N*TAU;
    v.push(0,y,0,sh, rad*Math.cos(a0),y,rad*Math.sin(a0),sh, rad*Math.cos(a1),y,rad*Math.sin(a1),sh); }
  return v;
}
function buildSector(half,N){ // 扇形：apex 在原点，绕 +Z 张开 ±half
  const v=[]; for(let i=0;i<N;i++){
    const t0=-half+2*half*i/N, t1=-half+2*half*(i+1)/N;
    v.push(0,0,0,1, Math.sin(t0),0,Math.cos(t0),1, Math.sin(t1),0,Math.cos(t1),1); }
  return v;
}
function buildAnnulus(ri,N){
  const v=[]; for(let i=0;i<N;i++){ const a0=i/N*TAU,a1=(i+1)/N*TAU;
    const c0=Math.cos(a0),s0=Math.sin(a0),c1=Math.cos(a1),s1=Math.sin(a1);
    v.push(ri*c0,0,ri*s0,1, c0,0,s0,1, c1,0,s1,1);
    v.push(ri*c0,0,ri*s0,1, c1,0,s1,1, ri*c1,0,ri*s1,1); }
  return v;
}
function buildSphere(rings,segs){   // 单位球(用于踩塔倒计时光球)
  const v=[], P=(ph,th)=>[Math.sin(ph)*Math.cos(th), Math.cos(ph), Math.sin(ph)*Math.sin(th)];
  for(let i=0;i<rings;i++){ const p0=Math.PI*i/rings, p1=Math.PI*(i+1)/rings;
    for(let j=0;j<segs;j++){ const t0=TAU*j/segs, t1=TAU*(j+1)/segs;
      const a=P(p0,t0),b=P(p1,t0),c=P(p1,t1),e=P(p0,t1), sh=0.8;
      v.push(a[0],a[1],a[2],sh, b[0],b[1],b[2],sh, c[0],c[1],c[2],sh);
      v.push(a[0],a[1],a[2],sh, c[0],c[1],c[2],sh, e[0],e[1],e[2],sh); } }
  return v;
}
function buildGrid(rad){
  const v=[], y=0.012, sh=1;
  for(let ring=1;ring<=4;ring++){ const rr=rad*ring/4, seg=72;
    for(let i=0;i<seg;i++){ const a0=i/seg*TAU,a1=(i+1)/seg*TAU;
      v.push(rr*Math.cos(a0),y,rr*Math.sin(a0),sh, rr*Math.cos(a1),y,rr*Math.sin(a1),sh); } }
  for(let k=0;k<8;k++){ const a=k/8*TAU; v.push(0,y,0,sh, rad*Math.cos(a),y,rad*Math.sin(a),sh); }
  return v;
}
const meshes = {
  cyl:     mkMesh(buildCylinder(24), gl.TRIANGLES),
  disc:    mkMesh(buildDisc(1,80,0,1), gl.TRIANGLES),    // 单位圆盘 → 按 ARENA_R 缩放(支持不同机制场地大小)
  grid:    mkMesh(buildGrid(1), gl.LINES),               // 单位网格 → 按 ARENA_R 缩放
  circle:  mkMesh(buildDisc(1,48,0,1), gl.TRIANGLES),
  cone:    mkMesh(buildSector(d2r(45),18), gl.TRIANGLES), // 90° = ±45°
  half:    mkMesh(buildSector(d2r(90),28), gl.TRIANGLES), // 180° = ±90°
  annulus: mkMesh(buildAnnulus(0.88,48), gl.TRIANGLES),   // 细环(塔/冲锋/boss环)
  donut:   mkMesh(buildAnnulus(0.34,48), gl.TRIANGLES),   // 甜甜圈/环形AOE(中心安全, 内0.34外1.0)
  sphere:  mkMesh(buildSphere(10,14), gl.TRIANGLES)
};

/* ==Scene API== 渲染无关边界：引擎(阶段2)只通过这些方法驱动渲染 */
const Scene = (()=>{
  const actors=new Map(); let decals=[]; let hud=[];
  return {
    addActor(a){ actors.set(a.id,a); },
    updateActor(id,p){ const a=actors.get(id); if(a) Object.assign(a,p); },
    removeActor(id){ actors.delete(id); },
    get(id){ return actors.get(id); },
    list(){ return [...actors.values()]; },
    setDecals(d){ decals=d||[]; },
    getDecals(){ return decals; },
    setHUD(lines){ hud=lines||[]; },
    getHUD(){ return hud; },
    setCamera(c){ Object.assign(cam,c); },
    onTick:null
  };
})();

/* ==camera / picking== */
function camEye(){
  const cp=Math.cos(cam.pitch), sp=Math.sin(cam.pitch);
  return [cam.target[0]+cam.dist*cp*Math.sin(cam.yaw),
          cam.target[1]+cam.dist*sp,
          cam.target[2]+cam.dist*cp*Math.cos(cam.yaw)];
}
// 复用 lookAt 的相机基，保证点选/移动与渲染一致
function camBasis(){
  const eye=camEye();
  const z=v3norm(v3sub(eye,cam.target));   // 向后
  const x=v3norm(v3cross(UP,z));           // 屏幕右
  const y=v3cross(z,x);                    // 屏幕上
  const f=v3norm(v3sub(cam.target,eye));   // 视线向前
  return {eye,x,y,f};
}
// (FF14 用 WASD，无点地走位；故不做地面拾取)

/* ==9 MOVEMENT== 玩家（被控职能）走位 */
const keys={}; let humanRole='OB'; let follow=false; let moveMode='legacy'; let playerFacing=0;   // 'OB'=观察；moveMode 两种模式移动方向都跟镜头(W=镜头前方)，区别只在角色"朝向"：legacy传统=朝移动方向 / standard现代=朝镜头
/* ==击退(共享)== 任何机制都可触发；被击退中锁玩家输入，由 tickKB 平滑移动(玩家与NPC通用) */
const KB={};   // role → {fx,fz,tx,tz,t,dur}
function startKBv(role,vx,vz,dur){ const a=Scene.get(role); if(!a) return; let tx=a.pos[0]+vx, tz=a.pos[1]+vz; const m=Math.hypot(tx,tz); if(m>ARENA_R-0.6){ const s=(ARENA_R-0.6)/m; tx*=s; tz*=s; } KB[role]={fx:a.pos[0],fz:a.pos[1],tx,tz,t:0,dur:dur||0.45}; }   // 按向量击退(终点超出场地则贴边)
function clearKB(){ for(const k in KB) delete KB[k]; }
function tickKB(dt){ for(const r in KB){ const k=KB[r], a=Scene.get(r); k.t+=dt; const u=Math.min(1,k.t/k.dur); if(a){ a.pos[0]=k.fx+(k.tx-k.fx)*u; a.pos[1]=k.fz+(k.tz-k.fz)*u; } if(u>=1) delete KB[r]; } }
addEventListener('keydown',e=>{ keys[e.key.toLowerCase()]=true; });
addEventListener('keyup',  e=>{ keys[e.key.toLowerCase()]=false; });

/* ==9b GAMEPAD== 手柄适配（XInput/标准映射）：左摇杆移动 · 右摇杆转视角 · LT/RT缩放 · A开始 · Y跟随 · View重置视角 · Menu暂停 */
const GP={ index:null, deadzone:0.18, lookSpeed:2.8, zoomSpeed:1.6, move:[0,0], prev:{} };   // move=[右,前]，供 updatePlayer 消费
addEventListener('gamepadconnected',   e=>{ GP.index=e.gamepad.index; });
addEventListener('gamepaddisconnected',e=>{ if(GP.index===e.gamepad.index) GP.index=null; });
function gpActive(){
  const pads=navigator.getGamepads?navigator.getGamepads():[];
  if(GP.index!=null && pads[GP.index]) return pads[GP.index];
  for(let i=0;i<pads.length;i++) if(pads[i]){ GP.index=i; return pads[i]; }
  return null;
}
const gpDz=v=> Math.abs(v)<GP.deadzone ? 0 : (v-Math.sign(v)*GP.deadzone)/(1-GP.deadzone);   // 死区 + 重映射，保留模拟量
function gpEdge(gp,i){ const now=!!(gp.buttons[i]&&gp.buttons[i].pressed), was=!!GP.prev[i]; GP.prev[i]=now; return now&&!was; }
/* 每帧轮询手柄：视角/缩放/按键独立于 updatePlayer（OB 观察模式无玩家也能用手柄转视角） */
function pollGamepad(dt){
  GP.move[0]=GP.move[1]=0;
  const gp=gpActive(); if(!gp) return;
  const ax=gp.axes;
  GP.move[0]=gpDz(ax[0]||0);              // 左摇杆 X → 右
  GP.move[1]=-gpDz(ax[1]||0);             // 左摇杆 Y(上为负) → 前
  const lookX=gpDz(ax[2]||0), lookY=gpDz(ax[3]||0);   // 右摇杆转视角（与拖拽同向）
  if(lookX) cam.yaw  -= lookX*GP.lookSpeed*dt;
  if(lookY) cam.pitch = clamp(cam.pitch + lookY*GP.lookSpeed*dt, d2r(12), d2r(85));
  const lt=gp.buttons[6]?gp.buttons[6].value:0, rt=gp.buttons[7]?gp.buttons[7].value:0;   // LT 拉远 / RT 拉近（与滚轮同款指数缩放）
  if(lt||rt) cam.dist=clamp(cam.dist*Math.exp((lt-rt)*GP.zoomSpeed*dt), 12, 90);
  if(gpEdge(gp,0)) $('startBtn').click();    // A：开始/重置
  if(gpEdge(gp,3)) $('followBtn').click();   // Y：切换跟随
  if(gpEdge(gp,8)){ cam.yaw=Math.PI; cam.pitch=d2r(55); cam.dist=38; if(!follow) cam.target=[0,0,0]; }   // View/Back：重置视角
  if(gpEdge(gp,9)) $('pauseBtn').click();     // Menu/Start：暂停/继续
}

function updatePlayer(dt){
  const me=Scene.get(humanRole); if(!me) return;
  if(KB[humanRole]){ if(follow){ cam.target[0]=me.pos[0]; cam.target[2]=me.pos[1]; } return; }   // 被击退中：锁输入(由 tickKB 移动)
  const {x,f}=camBasis();                                    // 两种模式移动方向都跟镜头：W=镜头前方
  const fg=v3norm([f[0],0,f[2]]), rg=v3norm([x[0],0,x[2]]);
  let mx=0,mz=0;
  if(keys['w']){mx+=fg[0];mz+=fg[2];} if(keys['s']){mx-=fg[0];mz-=fg[2];}
  if(keys['d']){mx+=rg[0];mz+=rg[2];} if(keys['a']){mx-=rg[0];mz-=rg[2];}
  if(GP.move[0]||GP.move[1]){ mx+=rg[0]*GP.move[0]+fg[0]*GP.move[1]; mz+=rg[2]*GP.move[0]+fg[2]*GP.move[1]; }   // 手柄左摇杆（保留推杆幅度）
  const ts=(SIM.current&&SIM.current.timeScale)||1;   // 玩家移动也随"速度"倍率(0.25×~2×)缩放，跟上加速后的机制
  if(mx||mz){ const l=Math.hypot(mx,mz), k=l>1?1/l:1;   // 键盘=满速；手柄推杆幅度→对应速度（不强制归一化）
    me.pos[0]+=mx*k*SPEED*dt*ts; me.pos[1]+=mz*k*SPEED*dt*ts;
    if(moveMode==='legacy') playerFacing=Math.atan2(mx,mz); }   // 传统：面朝移动方向(按S=转身后退、A/D=转身侧跑)
  if(moveMode==='standard') playerFacing=Math.atan2(fg[0],fg[2]);   // 现代：永远面朝镜头前方(按S=原地倒退、A/D=横向平移)
  const rr=Math.hypot(me.pos[0],me.pos[1]); if(rr>ARENA_R-0.6){ me.pos[0]*=(ARENA_R-0.6)/rr; me.pos[1]*=(ARENA_R-0.6)/rr; }
  if(follow){ cam.target[0]=me.pos[0]; cam.target[2]=me.pos[1]; }
}


/* 全局便捷选择器 + 角色表 + 通用随机/扇形助手(供各机制复用) */
const $=id=>document.getElementById(id);
const TH=['MT','ST','H1','H2'], DPS=['D1','D2','D3','D4'], ALL=TH.concat(DPS);
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function shuffleR(a,rng){for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));const t=a[i];a[i]=a[j];a[j]=t;}return a;}
function inCone(p,ax,az,facing,range){ const dx=p[0]-ax, dz=p[1]-az, d=Math.hypot(dx,dz); if(d>range||d<0.05) return false;
  let da=((Math.atan2(dx,dz)-facing+Math.PI)%TAU+TAU)%TAU-Math.PI; return Math.abs(da)<=Math.PI/4; }   // 90°扇=±45°
