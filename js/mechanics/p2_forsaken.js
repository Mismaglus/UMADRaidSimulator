"use strict";
/* mechanics/p2_forsaken.js — P2 遗弃末世 脑死法(自注册) */
const PRIO={H2:0,H1:1,ST:2,MT:3, D4:0,D3:1,D2:2,D1:3};   // (旧优先级，保留备用)
const PAIROF={H1:'H',H2:'H', MT:'T',ST:'T', D1:'A',D2:'A', D3:'B',D4:'B'};  // 固定搭档对
const LEFTMEM={H1:1,MT:1,D1:1,D3:1};   // 组内"左"(奇数)成员；其余为"右"(偶数)
const ROUND_1234={   // 脑死法：TH 踩 1·2·3·4 塔，DPS 踩 5·6·7·8 塔
  1:{job:'TH', parity:'odd',  ord:1, stacks:1},
  2:{job:'TH', parity:'even', stacks:0, charge:true},
  3:{job:'TH', parity:'odd',  ord:2, stacks:2, cleave:true},
  4:{job:'TH', parity:'even', stacks:0, charge:true},
  5:{job:'DPS',parity:'odd',  ord:1, stacks:1, cleave:true},
  6:{job:'DPS',parity:'even', stacks:0, charge:true},
  7:{job:'DPS',parity:'odd',  ord:2, stacks:2, cleave:true},
  8:{job:'DPS',parity:'even', stacks:0, charge:true}
};
const ROUND_1256={   // 1256 打法：TH 踩 1·2·5·6 塔，DPS 踩 3·4·7·8 塔（=34塔与56塔互换；奇偶/冲锋/半场刀仍按轮号不变）
  1:{job:'TH', parity:'odd',  ord:1, stacks:1},
  2:{job:'TH', parity:'even', stacks:0, charge:true},
  3:{job:'DPS',parity:'odd',  ord:1, stacks:1, cleave:true},
  4:{job:'DPS',parity:'even', stacks:0, charge:true},
  5:{job:'TH', parity:'odd',  ord:2, stacks:2, cleave:true},
  6:{job:'TH', parity:'even', stacks:0, charge:true},
  7:{job:'DPS',parity:'odd',  ord:2, stacks:2, cleave:true},
  8:{job:'DPS',parity:'even', stacks:0, charge:true}
};
const STRATS={ '1234':ROUND_1234, '1256':ROUND_1256 };
let ROUND=ROUND_1234;   // 当前打法（下拉菜单切换，切换后重置）
/* 相对坐标 / 时序（占位值，阶段3 标定） */
const EG={ ringR:7, halfSep:5.6, towerR:4.2, bossHitR:6, soakSide:1.7, soakOut:1.7, coneRange:10, chargeR:6.5, baitR:2.2,
           spreadR:4.3, orbHigh:7, effectT:0.9, towerWindow:10, aoeT:2,   // 塔=4.2(放大·原3.3)；boss环=6(放大·原5)；分摊/钢/冲锋=4.3(受偶数轮冲锋"2×baitR>spreadR不重叠"所限,不随塔放大)；接形人推距已随塔加大
           moveT:4.0, chargeT:7, cleaveT:6, flash:0.05, enrageT:2.0, npcSpeed:7.5 };   // 终结读条 -7s / 消灭之脚 -6s（落在 10s 塔窗口内，判定=塔判定）
/* ==机制：P2 Forsaken== 脑死法时间轴 + NPC 自动走位（实现统一机制接口：init/update/drawGround/drawAir/drawHud/mountOptions/reset，仅通过 Scene.* 驱动渲染） */
const FORSAKEN={ id:'p2_forsaken', name:'脑死法（全程）', group:'P2 · 遗弃末世 Forsaken', arenaR:20, phase:'idle', round:0, kind:'', t:0, subEnd:0, steps:[], stepIdx:0,
  rng:null, seed:1, rotationDir:1, coneJob:'TH', pendingPolarity:null,
  players:{}, LT:null, RT:null, towersActive:false, chargeRingActive:false, clonesActive:false, cleaveActive:false, cleaveFacing:0,
  orbT:0, orbTotal:1, orbY:0, orbActive:false, fxAoes:[], fxT:0, cleaveFxT:0, aoeFlash:0, bossFacing:0, cleaveTarget:null,
  paused:false, pauseOnFail:true, timeScale:1, failLog:[], lastFail:'', win:false,

  init(seed){
    this.seed=seed>>>0; this.rng=mulberry32(this.seed);
    this.rotationDir=this.rng()<0.5?1:-1;
    this.players={}; ALL.forEach(r=>this.players[r]={layers:4,shape:null,target:null,vuln:false,soakCount:0,marker:null,markerColor:'normal',markerT:0});
    this.initShapes(); this.pairTower={};
    ALL.forEach((r,i)=>{ Scene.get(r).pos=[ i<4?-2.6:2.6, [-9,-11,-13,-15][i%4] ]; });   // 支援列(左)/DPS列(右) 在 C 侧竖排
    ALL.forEach(r=>{ const p=this.players[r]; p.marker=p.shape; p.markerColor='normal'; p.markerT=4; });   // 开局所有人点名显示 4s
    this.despawnClones();
    this.steps=this.buildSteps(); this.stepIdx=0; this.t=0;
    this.phase='run'; this.paused=false; this.pendingPolarity=null; this.failLog=[]; this.lastFail=''; this.win=false;
    this.towersActive=false; this.chargeRingActive=false; this.cleaveActive=false;
    this.orbY=0; this.orbActive=false; this.fxAoes=[]; this.fxT=0;
    this.enterStep(this.steps[0]);
  },
  initShapes(){
    const thS=TH[Math.floor(this.rng()*4)], dpsS=DPS[Math.floor(this.rng()*4)];
    this.coneJob=this.rng()<0.5?'TH':'DPS';
    TH.forEach(r=> this.players[r].shape = r===thS?'stack':(this.coneJob==='TH'?'cone':'circle'));
    DPS.forEach(r=> this.players[r].shape = r===dpsS?'stack':(this.coneJob==='DPS'?'cone':'circle'));
  },
  buildSteps(){
    const s=[{r:0,kind:'aoe',dur:EG.aoeT}];   // 开场：AOE 全屏特效(无判定)
    for(let r=1;r<=8;r++){ const inf=ROUND[r];
      const extra=(inf.charge?EG.chargeT:0)+(inf.cleave?EG.cleaveT:0);
      s.push({r,kind:'move',dur:EG.towerWindow-extra});   // move+charge+cleave 合计=10s(光球下落)
      if(inf.charge) s.push({r,kind:'charge',dur:EG.chargeT});
      if(inf.cleave) s.push({r,kind:'cleave',dur:EG.cleaveT});
      s.push({r,kind:'soak',dur:EG.flash});
    }
    s.push({r:9,kind:'finalmove',dur:4});   // 8塔判定后 ~4s 间隔(全员集合躲)，之后才开始读最终消灭之脚
    s.push({r:9,kind:'finalcleave',dur:EG.cleaveT});
    s.push({r:10,kind:'enrage',dur:EG.enrageT});
    s.push({r:99,kind:'result',dur:1e9});
    return s;
  },
  roundAngle(r){ return d2r(this.rotationDir*45*(r-1)); },
  toWorld(side,out,A){ return [Math.cos(A)*side+Math.sin(A)*out, -Math.sin(A)*side+Math.cos(A)*out]; },

  resolveTargets(r){
    const inf=ROUND[r], A=this.roundAngle(r), P=this.players;
    this.LT=this.toWorld(-EG.halfSep,EG.ringR,A); this.RT=this.toWorld(EG.halfSep,EG.ringR,A);
    // 塔内对角点：上下 = 两塔连线中点⊥指向boss（=全局径向 -out，两塔共用同一个"上"）；左右 = 沿两塔连线(切向)
    // tw=-1左/+1右; ss=左右(-1左/+1右); os=上下(-1上/朝boss · +1下/背向)
    const inT=(tw,ss,os)=>this.toWorld(tw*EG.halfSep + ss*EG.soakSide, EG.ringR + os*EG.soakOut, A);
    const atB=(ds,dz)=>this.toWorld(ds,dz,A);
    const set=(role,xz)=>{ if(P[role]) P[role].target=xz; };
    const soak=inf.job==='TH'?TH:DPS, other=inf.job==='TH'?DPS:TH;
    const ox=Math.sin(A), oz=Math.cos(A);   // 盘外(+out)单位向量
    // 组首踩塔(各组第一次踩=ord1)锁定：含分摊的固定对 → 右塔；搭档对 → 左塔（脑死法=1/5轮；1256=1/3轮）
    if(inf.ord===1){ const sh=soak.find(x=>P[x].shape==='stack'), sp=PAIROF[sh];
      const pids=[...new Set(soak.map(x=>PAIROF[x]))];
      this.pairTower[sp]='R'; this.pairTower[pids.find(p=>p!==sp)]='L'; }
    if(inf.parity==='odd'){
      const handler = inf.job==='TH'?'D3':'H2';   // 接形人：1-4轮 D3(仍有点名,免扇) / 5-8轮 H2(已清,真吃扇1下)
      const hMarked = inf.job==='TH';
      const stk=soak.filter(x=>P[x].shape==='stack'), cone=soak.filter(x=>P[x].shape==='cone'), circ=soak.filter(x=>P[x].shape==='circle');
      const sTw = stk.length>=2 ? [-1,1] : [1];     // 3/7轮两分摊一左一右；1/5轮单分摊→右塔
      stk.forEach((s,i)=> set(s, (stk.length<2) ? inT(1,-1,-1) : inT(sTw[i], sTw[i], -1)) );   // 1/5轮单分摊→右塔"内·上(左上)"；3/7轮两分摊→各自外侧·上(朝boss)
      const host = stk[0], hostTw = sTw[0];          // 扇贴这个分摊进圈
      const oneStk=stk.length<2;
      if(oneStk){ const hpartner=ALL.find(r=>r!==host && PAIROF[r]===PAIROF[host]);   // 1/5轮：摊的搭档跟摊去同一塔(右)、另一对去左塔——搭档不拆(修D3点摊D4没跟去右塔)
        [cone,circ].forEach(arr=>{ const k=arr.indexOf(hpartner); if(k>=0){ arr.splice(k,1); arr.unshift(hpartner);
          const rest=arr.slice(1).sort((a,b)=>(LEFTMEM[b]?1:0)-(LEFTMEM[a]?1:0)); rest.forEach((r,j)=>arr[1+j]=r); } }); }   // 组首轮：余下另一对按组内奇位(左)/偶位(右)
      cone.forEach((c,i)=>{ if(i===0 && host){
          if(oneStk) set(c, inT(hostTw, hostTw, +1));   // 1/5轮：扇放摊塔"外·下(右下)" → 扇朝正下打、下方接形人接（与左上的分摊错开）
          else { const hp=P[host].target; set(c,[hp[0]+ox*3.6, hp[1]+oz*3.6]); } }   // 3/7轮：扇放分摊"正下方(+out)"、仍进分摊圈(凑人头) → 扇朝正下打、下方接形人接（塔放大后下移到3.6，让接形人仍是扇的最近目标）
        else set(c, inT(-hostTw, i===1?-1.75:-1.25, i===1?0.6:1.25)); });   // 1/5轮左塔双扇(另一对,已按ORDER排序)：i=1更左→靠左 / i=2→靠右(左下45°)
      circ.forEach((c,i)=>{ if(stk.length>=2) set(c, inT(1,-1,+1));   // 3/7轮：单个钢→右塔内下(远离分摊)
        else { const sp=[[1,1,1],[-1,-1,-1],[-1,1,1]][i%3]; set(c, inT(sp[0],sp[1],sp[2])); } });   // 1/5轮：3钢不重叠(摊塔搭档→右下,对角于左上分摊 / 左塔外上 / 左塔内下)
      if(P[handler]){
        if(oneStk){ const bs=cone[0]||circ[0], bp=bs?P[bs].target:this.RT;   // 1/5轮：接形人站"摊塔底侧那人(钢/扇)正下方(+out)" → 引导扇形/接钢
          P[handler].target=[ bp[0]+ox*3.6, bp[1]+oz*3.6 ]; }
        else if(cone[0] && host){ const hp=P[host].target, sx=Math.cos(A), sz=-Math.sin(A);   // 3/7轮有扇：接形人站扇的左下、明显往左上收(-out上 / -side左2.6)，落在左塔环外的左下角 → 扇朝左下打到他、只吃1下
          P[handler].target=[ hp[0]+ox*4.8 - sx*2.6, hp[1]+oz*4.8 - sz*2.6 ]; }
        else { const ap=circ[0]?P[circ[0]].target:this.RT;   // 兜底
          const atc=Math.hypot(ap[0]-this.LT[0],ap[1]-this.LT[1])<Math.hypot(ap[0]-this.RT[0],ap[1]-this.RT[1])?this.LT:this.RT;
          let ax=ap[0]-atc[0], az=ap[1]-atc[1], am=Math.hypot(ax,az)||1; P[handler].target=[ ap[0]+ax/am*4.7, ap[1]+az/am*4.7 ]; } }
      // 垫分摊：按"每座分摊还差几人"分配；全部推到塔环外(仍在 2.6 分摊圈内) → 塔里只有 2 个踩塔者
      const pads = other.filter(rr=>rr!==handler);
      const partner = pads.find(r => PAIROF[r]===PAIROF[handler]);   // 接形人的搭档(同对的另一人)
      if(partner){ const k=pads.indexOf(partner); pads.splice(k,1); pads.unshift(partner); }   // 搭档优先垫"左塔(扇)分摊"(stk[0],need=1) → 3轮=D4 / 7轮=H1；完整的另一对一起垫右塔
      const need = stk.map(s=>{ let b=1; cone.forEach(c=>{ if(Math.hypot(P[c].target[0]-P[s].target[0],P[c].target[1]-P[s].target[1])<=EG.spreadR) b++; }); return Math.max(1,3-b); });
      const assign=[]; stk.forEach((s,si)=>{ for(let n=0;n<need[si];n++) assign.push(si); }); while(assign.length<pads.length) assign.push(0);
      const pc={};
      pads.forEach((role,i)=>{ const si=assign[i]||0, h=stk[si]||soak[0], hp=P[h].target, k=(pc[si]=(pc[si]||0)+1)-1, tg=(k-0.5)*1.4;
        set(role, [ hp[0]-ox*3.3 + (-oz)*tg, hp[1]-oz*3.3 + ox*tg ]); });   // 朝boss侧(-out)推出塔环、仍在4.3分摊圈内 → 避开盘外的扇楔形
    } else {
      // 偶数轮(过去/未来终焉=跳跃)：每塔 1扇形+1钢铁。左右塔 = 上一轮(同组奇数轮)踩塔的相对左右(面向boss)
      const Aprev=this.roundAngle(r-1), sidePrev=role=>{const p=Scene.get(role).pos; return Math.cos(Aprev)*p[0]-Math.sin(Aprev)*p[1];};   // 上一轮坐标投到上一轮切向轴：小=更左
      const cones=soak.filter(x=>P[x].shape==='cone').sort((a,b)=>sidePrev(a)-sidePrev(b));   // [0]=上一轮更左→左塔, [1]→右塔
      const circs=soak.filter(x=>P[x].shape==='circle').sort((a,b)=>sidePrev(a)-sidePrev(b));
      // 扇形→各自塔"外·上角"(塔与boss环夹角)，楔形朝场外(由引导人作最近目标)
      if(cones[0]) set(cones[0], inT(-1,-1,-1)); if(cones[1]) set(cones[1], inT(+1,+1,-1));
      // 钢铁→各自塔"正下方"(沿中轴远离boss, 仍在塔内)
      if(circs[0]) set(circs[0], inT(-1,0,+1.8)); if(circs[1]) set(circs[1], inT(+1,0,+1.8));
      // 不踩塔组：TL/TR 两人留 boss 附近引导跳跃；BL/BR 两人(D3/D4 或 H1/H2)出到扇形外侧引导扇形
      const cs=EG.halfSep+EG.soakSide, gdist=4.5;   // 引导人=扇形再往外 gdist：<钢铁距(确保是扇形最近目标→楔形朝外)、>分摊半径(不吃扇形者的跳跃)
      const map=inf.job==='TH'?{D1:'TL',D2:'TR',D3:'L',D4:'R'}:{MT:'TL',ST:'TR',H1:'L',H2:'R'};
      other.forEach(role=>{ const m=map[role];
        if(m==='TL') set(role, atB(-EG.baitR,-EG.baitR));
        else if(m==='TR') set(role, atB(EG.baitR,-EG.baitR));
        else if(m==='L') set(role, this.toWorld(-(cs+gdist), EG.ringR-EG.soakOut, A));   // 左扇外侧引导
        else if(m==='R') set(role, this.toWorld(cs+gdist, EG.ringR-EG.soakOut, A)); });   // 右扇外侧引导
    }
    // 消灭之脚引导：cleave 轮先聚到引导点(过去→两塔中间 +out / 未来→对面 -out)，读条开始后再散到踩塔/垫人位(enterStep)
    if(inf.cleave){ const front=this.pendingPolarity==='past'?1:-1;
      ALL.forEach((role,i)=>{ const p=P[role]; if(!p) return; p.soakT=p.target;
        p.target=this.toWorld((i%4-1.5)*1.1, front*EG.ringR*0.7, A); }); }
  },

  spawnClones(){ const b=Scene.get('BOSS').pos; for(let i=0;i<3;i++){ const a=i/3*TAU; Scene.addActor({id:'C'+i,kind:'clone',role:'',pos:[b[0]+Math.cos(a)*0.7,b[1]+Math.sin(a)*0.7],color:[1,1,1],radius:2.0,height:4.0,alpha:0.32}); } this.clonesActive=true; },
  despawnClones(){ for(let i=0;i<3;i++) Scene.removeActor('C'+i); this.clonesActive=false; },

  enterStep(st){
    this.round=st.r; this.kind=st.kind; this.t=0; this.subEnd=st.dur;
    this.orbActive=(st.r>=1&&st.r<=8)&&(st.kind==='move'||st.kind==='charge'||st.kind==='cleave');
    if(st.kind==='aoe'){ /* 开场 AOE = render() 里从 boss 快速扩散的紫色冲击波，不再全屏闪 */ }
    else if(st.kind==='move'){ this.resolveTargets(st.r); this.towersActive=true;
      this.orbTotal=EG.towerWindow; this.orbT=0; this.orbY=EG.orbHigh; }
    else if(st.kind==='finalmove'){ this.towersActive=false;   // 8塔后间隔：塔消失，全员去"第8组塔中间"引导(无论过去/未来都先到这)，还没开始读条
      const A=this.roundAngle(8), gx=Math.sin(A)*EG.ringR, gz=Math.cos(A)*EG.ringR;   // 两塔正中间(+out)
      ALL.forEach((r,i)=>this.players[r].target=[gx+(i%4-1.5)*0.7, gz+(i<4?-0.7:0.7)]); }
    else if(st.kind==='charge'){ this.spawnClones(); this.chargeRingActive=true; this.pendingPolarity=this.rng()<0.5?'past':'future'; }
    else if(st.kind==='cleave'||st.kind==='finalcleave'){ this.cleaveActive=true;
      const A=this.roundAngle(st.r===9?8:st.r); this.cleaveFacing=A+Math.PI;   // 致命半场 = 背离本组两塔（踩塔/垫人天然在安全半）
      this.bossFacing=(this.pendingPolarity==='future')? this.cleaveFacing : this.cleaveFacing+Math.PI;   // 未来=面前挨刀(boss 面朝致命半)；过去=背后挨刀(boss 背朝致命半)
      let best='MT',bd=9; for(const r of ALL){ const p=Scene.get(r).pos, a=Math.atan2(p[0],p[1]); const d=Math.abs(((a-this.bossFacing+Math.PI)%TAU+TAU)%TAU-Math.PI); if(d<bd){bd=d;best=r;} }
      this.cleaveTarget=best;   // 读条开始随机锁定一名玩家，boss 转向他（取最接近朝向者）
      if(st.kind==='cleave'){ ALL.forEach(role=>{ const p=this.players[role]; if(p&&p.soakT) p.target=p.soakT; }); }   // 引导完→散开到踩塔/垫人位
      if(st.kind==='finalcleave'){ const past=this.pendingPolarity==='past';   // 引导完：过去=原地不动(中间就安全)；未来=对穿到对面
        this.cleaveFacing = past ? A+Math.PI : A;   // 过去=打背面(致命半=-out,两塔中间安全)；未来=打正面(致命半=+out,中间挨刀→必须对穿)
        const d = past ? EG.ringR : -EG.ringR, gx=Math.sin(A)*d, gz=Math.cos(A)*d;   // 过去→留两塔中间(+out)；未来→对穿到对面(-out)
        ALL.forEach((r,i)=>this.players[r].target=[gx+(i%4-1.5)*0.7, gz+(i<4?-0.7:0.7)]); } }
    else if(st.kind==='soak'){ this.resolveAOEs(st.r); this.detonate(st.r); }   // 光球落地=踩塔判定：只结算 AOE 命中(死人=吃到≥2伤害)，不再判"是否到位"
    else if(st.kind==='enrage'){ this.towersActive=false; }
  },
  exitStep(st){
    if(st._done) return; st._done=true;
    if(st.kind==='charge'){ this.applyVuln(); this.chargeRingActive=false; }
    else if(st.kind==='cleave'||st.kind==='finalcleave'){ this.checkCleave(); this.despawnClones(); this.cleaveActive=false; this.cleaveFxT=1.2; }   // 读条结束=伤害判定 → 这时才闪现命中半场范围1.2s
    else if(st.kind==='enrage'){ this.checkEnrage(); }
  },

  applyVuln(){ const b=ROUND[this.round].job==='TH'?DPS:TH; b.forEach(r=>this.players[r].vuln=true); },
  detonate(r){ const inf=ROUND[r], soak=inf.job==='TH'?TH:DPS;
    soak.forEach(role=>{ this.players[role].layers--; this.players[role].soakCount++; });
    if(this.players[soak[0]].layers>0){ const bag=inf.parity==='odd'?['circle','circle','cone','cone']:['circle','cone','stack','stack']; shuffleR(bag,this.rng);
      soak.forEach((role,i)=>{ const p=this.players[role]; p.shape=bag[i]; p.marker=bag[i]; p.markerColor='blue'; p.markerT=4; }); }   // 踩塔者刷新 → 蓝色点名 4s
    else soak.forEach(role=>{ const p=this.players[role]; p.shape=null; p.marker=null; p.markerT=0; });
  },
  checkHuman(){
    const meA=Scene.get(humanRole); if(!meA) return;   // OB 模式无玩家
    const me=meA.pos, t=this.players[humanRole].target;
    if(t){ const d=Math.hypot(me[0]-t[0],me[1]-t[1]); if(d>2.8) this.fail('('+humanRole+') 未到指定位置 (差 '+d.toFixed(1)+'m)'); }
  },
  /* 踩塔判定瞬间：结算各 AOE 命中 + 失败检测 */
  resolveAOEs(r){
    const inf=ROUND[r], soak=inf.job==='TH'?TH:DPS, soakSet=new Set(soak), aoes=[];
    for(const role of soak){ const p=this.players[role], a=Scene.get(role).pos;
      if(p.shape==='circle') aoes.push({kind:'spread',x:a[0],z:a[1],radius:EG.spreadR,owner:role});
      else if(p.shape==='stack') aoes.push({kind:'stack',x:a[0],z:a[1],radius:EG.spreadR,owner:role});
      else if(p.shape==='cone'){ let bx=a[0],bz=a[1]+1,bd=1e18;   // 扇形：锁定最近一人，从自己朝他打出（90°）
        for(const o of ALL){ if(o===role) continue; const q=Scene.get(o).pos, dd=(q[0]-a[0])*(q[0]-a[0])+(q[1]-a[1])*(q[1]-a[1]); if(dd<bd){bd=dd; bx=q[0]; bz=q[1];} }
        aoes.push({kind:'cone',x:a[0],z:a[1],facing:Math.atan2(bx-a[0],bz-a[1]),owner:role}); } }
    if(inf.charge){ const bp=Scene.get('BOSS').pos;   // 过去/未来终焉：boss+3分身冲锋"最近4人"(各落一个跳跃圈)；扇形者在塔(次近)会吃到, 外侧引导人不吃
      const near=ALL.slice().sort((x,y)=>{const px=Scene.get(x).pos,py=Scene.get(y).pos; return Math.hypot(px[0]-bp[0],px[1]-bp[1])-Math.hypot(py[0]-bp[0],py[1]-bp[1]);}).slice(0,4);
      for(const role of near){ const a=Scene.get(role).pos; aoes.push({kind:'charge',x:a[0],z:a[1],radius:EG.spreadR,owner:role}); } }
    this.fxAoes=aoes; this.fxT=EG.effectT;
    const hit={}; ALL.forEach(x=>hit[x]=0);
    for(const ao of aoes){ for(const role of ALL){ const p=Scene.get(role).pos; let inside;
      if(ao.kind==='cone') inside = (this.players[role].shape==null) && role!==ao.owner && inCone(p,ao.x,ao.z,ao.facing,EG.coneRange);  // 扇形只打"无点名"的人
      else inside = Math.hypot(p[0]-ao.x,p[1]-ao.z)<=ao.radius;
      if(inside) hit[role]++; } }
    for(const role of ALL) if(hit[role]>=2) this.fail('('+role+') 同时吃到 '+hit[role]+' 个伤害');   // 3.1
    for(const ao of aoes){ if(ao.kind!=='stack') continue; let n=0; for(const role of ALL){ const p=Scene.get(role).pos; if(Math.hypot(p[0]-ao.x,p[1]-ao.z)<=ao.radius) n++; } if(n<3) this.fail('分摊('+ao.owner+') 只有 '+n+' 人 (<3)'); }   // 3.2
    for(const T of [['左',this.LT],['右',this.RT]]){ const c=T[1]; let n=0,who=[]; for(const role of ALL){ const p=Scene.get(role).pos; if(Math.hypot(p[0]-c[0],p[1]-c[1])<=EG.towerR){ n++; who.push(role); } } if(n!==2) this.fail(T[0]+'塔内 '+n+' 人 ['+who.join(',')+']（塔里只能 2 人踩塔）'); }   // 3.3 塔内总人数(踩塔会放buff,只能2人)
  },
  checkCleave(){ const meA=Scene.get(humanRole); if(!meA) return;   // OB 模式无玩家
    const dir=[Math.sin(this.cleaveFacing),Math.cos(this.cleaveFacing)], me=meA.pos;
    if(me[0]*dir[0]+me[1]*dir[1] > 0.5) this.fail('('+humanRole+') 站在消灭之脚命中半场'); },
  checkEnrage(){ const bad=ALL.filter(r=>this.players[r].layers>0); if(bad.length) this.fail('制裁之光: '+bad.join(',')+' 仍有咏唱危机层 → 碎屏'); this.win=this.failLog.length===0; this.phase='done'; },
  fail(msg){ this.failLog.push({msg,round:this.round}); this.lastFail=msg; if(this.pauseOnFail) this.paused=true; },

  seek(role,dt){ const a=Scene.get(role), p=this.players[role]; if(!a||!p||!p.target) return;
    const dx=p.target[0]-a.pos[0], dz=p.target[1]-a.pos[1], d=Math.hypot(dx,dz); if(d<0.05) return;
    const s=Math.min(d,EG.npcSpeed*dt); a.pos[0]+=dx/d*s; a.pos[1]+=dz/d*s; },

  update(dt){
    if(this.phase==='idle'){ this.setHUD(); return; }
    if(this.phase==='run' && !this.paused){
      const sdt=dt*this.timeScale;
      for(const role of ALL){ const p=this.players[role]; if(p.markerT>0) p.markerT-=sdt; }   // 点名 4s 倒计时
      if(this.orbActive){ this.orbT+=sdt; this.orbY=EG.orbHigh*(1-Math.min(1,this.orbT/this.orbTotal)); }   // 光球下落
      if(this.fxT>0) this.fxT-=sdt;   // AOE 特效残留
      if(this.cleaveFxT>0) this.cleaveFxT-=sdt;   // 消灭之脚"命中半场"特效残留(读条结束才闪)
      if(this.aoeFlash>0) this.aoeFlash-=sdt;   // 开场全屏闪衰减
      this.t += sdt;
      for(const role of ALL) if(role!==humanRole) this.seek(role, sdt);
      let guard=0;
      while(this.phase==='run' && !this.paused && this.t>=this.subEnd && guard++<20){
        const st=this.steps[this.stepIdx], over=this.t-this.subEnd;
        this.exitStep(st); if(this.paused) break;
        this.stepIdx++; if(this.stepIdx>=this.steps.length){ this.phase='done'; break; }
        this.enterStep(this.steps[this.stepIdx]); this.t=over;
      }
    }
    this.buildDecals(); this.setHUD();
  },
  buildDecals(){
    const d=[];
    const bb=Scene.get('BOSS'); if(bb) d.push({type:'bossring',x:bb.pos[0],z:bb.pos[1],radius:EG.bossHitR});   // boss 身位环(常显)
    if(this.towersActive && this.LT){ d.push({type:'tower',x:this.LT[0],z:this.LT[1],radius:EG.towerR},{type:'tower',x:this.RT[0],z:this.RT[1],radius:EG.towerR}); }
    // 头顶点名：同步到 actor，由 overlay 以面向镜头的图标绘制（不再在地面画形状）
    for(const role of ALL){ const a=Scene.get(role), p=this.players[role]; if(a&&p){ a.marker=(p.markerT>0?p.marker:null); a.markerColor=p.markerColor; } }
    if(this.fxT>0){ for(const ao of this.fxAoes){   // AOE 特效(命中瞬间的爆点)
      if(ao.kind==='cone') d.push({type:'cone',x:ao.x,z:ao.z,facing:ao.facing,radius:EG.coneRange,color:[1,0.5,0.12],alpha:0.5});
      else if(ao.kind==='stack') d.push({type:'stack',x:ao.x,z:ao.z,radius:ao.radius,color:[0.35,0.72,1],alpha:0.6});
      else if(ao.kind==='spread') d.push({type:'spread',x:ao.x,z:ao.z,radius:ao.radius,color:[1,0.8,0.2],alpha:0.6});
      else if(ao.kind==='charge') d.push({type:'charge',x:ao.x,z:ao.z,radius:ao.radius,color:[1,0.45,0.45],alpha:0.7}); } }
    if(this.chargeRingActive){ const b=Scene.get('BOSS').pos; d.push({type:'charge',x:b[0],z:b[1],radius:EG.chargeR}); }
    if(this.cleaveFxT>0) d.push({type:'halfcleave',x:0,z:0,radius:36,facing:this.cleaveFacing});   // 消灭之脚只在读条结束(伤害判定)瞬间显示范围，读条过程中不显示
    // （不再显示"该去哪"的目标残影——判定只看有没有人吃到 2 个伤害/死人）
    Scene.setDecals(d);
  },
  setHUD(){
    const L=[], inf=ROUND[this.round];
    L.push((humanRole==='OB'?'OB 观察 · 8 人自动':'我: '+humanRole)+'   种子: '+this.seed);
    if(this.phase==='idle') L.push('点 [开始/重置] 运行脑死法');
    else{
      L.push('轮 '+(this.round<=8?this.round:(this.round===9?'终结':this.round===10?'制裁':'结束'))+'  '+this.kind+(inf?('  '+inf.job+'/'+inf.parity):''));
      L.push('旋向 '+(this.rotationDir>0?'CW':'CCW')+'   扇组 '+this.coneJob+(this.pendingPolarity?('   '+(this.pendingPolarity==='past'?'过去':'未来')):''));
      L.push('T 层 '+TH.map(r=>this.players[r].layers).join(' ')+'    D 层 '+DPS.map(r=>this.players[r].layers).join(' '));
    }
    if(this.paused) L.push('⏸ 已暂停'+(this.lastFail?('  ✖ '+this.lastFail):''));
    if(this.phase==='done') L.push(this.win?'✅ 通关（全员清层）':('❌ 失败 ×'+this.failLog.length));
    Scene.setHUD(L);
  },
  /* ===== 统一机制接口 ===== */
  reset(){   // 切到本机制 / 待命预览：复位场景到开局列队、清贴花，phase=idle（点开始才 init 运行）
    this.phase='idle'; this.round=0; this.kind=''; this.t=0; this.subEnd=0;
    this.despawnClones(); this.towersActive=false; this.chargeRingActive=false; this.cleaveActive=false;
    this.orbActive=false; this.orbY=0; this.fxT=0; this.cleaveFxT=0; this.pendingPolarity=null;
    ALL.forEach((r,i)=>{ const a=Scene.get(r); if(a){ a.pos=[i<4?-2.6:2.6,[-9,-11,-13,-15][i%4]]; a.marker=null; } });
    Scene.setDecals([]); this.setHUD();
  },
  buffsOf(role){   // 通用小队列表 buff 数据：头顶点名形状(分摊/扇形/钢铁) + 剩余咏唱危机层数
    const p=this.players&&this.players[role]; if(!p) return [];
    const b=[];
    if(p.markerT>0 && p.marker){ const SH={stack:{cn:'分摊',col:[0.30,0.72,1.0]},cone:{cn:'扇形',col:[1.0,0.55,0.12]},circle:{cn:'钢铁',col:[0.96,0.80,0.20]}};
      const s=SH[p.marker]; if(s) b.push({label:s.cn, color:s.col, rem:Math.max(0,p.markerT), kind:'debuff'}); }
    if(p.layers>0) b.push({label:'危'+p.layers, color:[0.62,0.40,0.92], kind:'debuff'});   // 剩余咏唱危机层数
    return b; },
  drawGround(VP){   // 开场 AOE：从 boss 快速扩散的紫色冲击波（地面层，不写深度）
    if(this.kind!=='aoe') return;
    const p=Math.min(1, this.t/0.9), a=Math.min(1, 2.6*(1-p));
    if(a>0){ const rr=Math.max(0.5,p*R);
      drawMesh(meshes.circle,  mMul(VP, mModel(0,0.04,0,0,rr,1,rr)), [0.50,0.20,0.92], 0.22*a);
      drawMesh(meshes.annulus, mMul(VP, mModel(0,0.06,0,0,rr,1,rr)), [0.72,0.42,1.0], 0.9*a); }
  },
  drawAir(VP){   // 踩塔倒计时光球（在两塔正中下落，空中层，写深度）
    if(this.orbActive && this.LT && this.orbY>0.1){
      for(const T of [this.LT, this.RT]) drawMesh(meshes.sphere, mMul(VP, mModel(T[0], this.orbY+0.6, T[1], 0, 0.75,0.75,0.75)), [1.0,0.96,0.62], 0.95);
    }
  },
  drawHud(octx, VP){   // boss 头顶 + 屏幕顶端读条（終焉 -7s / 消滅の脚 -6s）
    if(this.kind==='charge'||this.kind==='cleave'||this.kind==='finalcleave'){
      let jp,en,col;
      if(this.kind==='charge'){ const past=this.pendingPolarity==='past'; jp=past?'過去の終焉':'未来の終焉'; en=past?"Past's End":"Future's End"; col='#b06bff'; }
      else { jp='消滅の脚'; en='All things Ending'; col='#ff5d5d'; }
      const prog=Math.max(0,Math.min(1, this.t/Math.max(0.01,this.subEnd))), rem=Math.max(0,this.subEnd-this.t);
      drawCastBar(cssW/2, 48, 380, 22, jp, en, col, prog, rem);   // 顶端固定读条（跟随视角也可见）
      const ba=Scene.get('BOSS'), s=ba&&projHead(VP, ba.pos[0],(ba.height||4)+2.4, ba.pos[1]);
      if(s) drawCastBar(s[0], s[1], 250, 15, jp, en, col, prog, rem);   // boss 头顶读条
    }
  },
  mountOptions(el){   // 机制专属 UI：打法（脑死法 / 1256）
    el.innerHTML = '<div>打法：<select id="stratSel">'
      + '<option value="1234">脑死法（TH 1·2·3·4 / DPS 5·6·7·8）</option>'
      + '<option value="1256">1256（TH 1·2·5·6 / DPS 3·4·7·8）</option>'
      + '</select></div>';
    const self=this;
    $('stratSel').value = (ROUND===ROUND_1256?'1256':'1234');
    $('stratSel').addEventListener('change', e=>{ ROUND=STRATS[e.target.value]||ROUND_1234; self.init(parseInt($('seedInp').value)||1); $('pauseBtn').textContent='暂停'; });   // 切换打法→重置本把
  }
};
SIM.register(FORSAKEN);
