"use strict";
/* mechanics/p3_yiyun.js — P3 一运 机制组(自注册) */
/* ====== 机制组：P3 · 一运（每个机制独立练习，不串完整时间轴；场地 30m）====== */
const P3 = {
  arenaR: 30,
  ATTR: { fire:{cn:'炎',col:[1.0,0.45,0.18]}, water:{cn:'水',col:[0.32,0.62,1.0]}, wind:{cn:'风',col:[0.45,0.9,0.55]} },
  diagPos(i,rad){ const t=d2r([45,135,225,315][((i%4)+4)%4]); return [-Math.sin(t)*rad, Math.cos(t)*rad]; },   // i=0..3 → 斜点 1/2/3/4 (NE/SE/SW/NW)
  clearCrystals(){ for(const a of Scene.list()) if(a.kind==='crystal') Scene.removeActor(a.id); },
  spawnCrystal(id,attr,pos){ Scene.addActor({id,kind:'crystal',role:'',pos:pos.slice(),color:this.ATTR[attr].col,radius:1.3,height:3.4,alpha:1,attr}); },
  ringActors(rad){ ALL.forEach((r,i)=>{ const a=Scene.get(r), ang=i/8*TAU-Math.PI/2; if(a){ a.pos=[Math.cos(ang)*rad, Math.sin(ang)*rad]; a.marker=null; } }); },
  nearest(x,z,pool){ let best=null,bd=1e18; for(const r of (pool||ALL)){ const p=Scene.get(r).pos, dx=p[0]-x, dz=p[1]-z, d=dx*dx+dz*dz; if(d<bd){bd=d;best=r;} } return best; },
  nearestN(x,z,n,pool){ return (pool||ALL).slice().sort((a,b)=>{const pa=Scene.get(a).pos,pb=Scene.get(b).pos; return (Math.hypot(pa[0]-x,pa[1]-z))-(Math.hypot(pb[0]-x,pb[1]-z));}).slice(0,n); },   // 最近 n 人(按到 x,z 距离)
  farthest(x,z,pool){ let best=null,bd=-1; for(const r of (pool||ALL)){ const p=Scene.get(r).pos, dx=p[0]-x, dz=p[1]-z, d=dx*dx+dz*dz; if(d>bd){bd=d;best=r;} } return best; },
  pick(rng,arr,n){ const a=arr.slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));const t=a[i];a[i]=a[j];a[j]=t;} return a.slice(0,n); },
  hitCircle(p,x,z,r){ return Math.hypot(p[0]-x,p[1]-z)<=r; },
  hitDonut(p,x,z,r){ const d=Math.hypot(p[0]-x,p[1]-z); return d>=r*0.34 && d<=r; },   // 0.34=donut 内半径比例(与 meshes.donut 一致)
  knockFrom(aoes){ for(const r of ALL){ const p=Scene.get(r).pos; let vx=0,vz=0;   // 被带 kb 标记的 AOE 命中→从该 AOE 中心向外击退(多个则矢量相加)
    for(const ao of aoes){ if(!ao.kb) continue; const ins=ao.type==='donut'?this.hitDonut(p,ao.x,ao.z,ao.radius):this.hitCircle(p,ao.x,ao.z,ao.radius);
      if(ins){ let dx=p[0]-ao.x, dz=p[1]-ao.z, d=Math.hypot(dx,dz)||1; vx+=dx/d*(ao.kbDist||10); vz+=dz/d*(ao.kbDist||10); } }
    if(vx||vz) startKBv(r,vx,vz); } }
};
/* 统一机制接口的基底：子机制提供 setup()/tick()/hudLines()/extra()/resolve() */
function p3mech(def){
  return Object.assign({
    group:'P3 · 一运', arenaR:P3.arenaR,
    phase:'idle', seed:1, paused:false, pauseOnFail:true, timeScale:1, win:false, lastFail:'', failLog:[],
    t:0, subEnd:0, kind:'', rng:null, players:{}, fxAoes:null, fxT:0, hitSet:[],
    fail(msg){ if(!this.lastFail) this.lastFail=msg; this.failLog.push({msg}); if(this.pauseOnFail) this.paused=true; },
    reset(){ this.phase='idle'; this.t=0; this.kind=''; this.win=false; this.paused=false; this.failLog=[]; this.lastFail=''; this.fxAoes=null; this.fxT=0; this.hitSet=[];
      clearKB(); P3.clearCrystals(); const _bb=Scene.get('BOSS'); if(_bb) _bb.pos=[0,0];   // 复位 boss 到中心(本影爆碎会移动它)
      P3.ringActors(11); this.players={}; ALL.forEach(r=>this.players[r]={}); Scene.setDecals([]);
      if(this.onReset) this.onReset(); this.hud(); },
    init(seed){ this.seed=seed>>>0; this.rng=mulberry32(this.seed); this.reset(); this.phase='run'; this.t=0; this.setup(); this.hud(); },
    update(dt){
      if(this.phase!=='run'||this.paused){ this.hud(); return; }
      const sdt=dt*this.timeScale; this.t+=sdt; if(this.fxT>0) this.fxT-=sdt;
      for(const r of ALL){ const tg=this.players[r]&&this.players[r].target; if(r!==humanRole&&!KB[r]&&tg){ const a=Scene.get(r), dx=tg[0]-a.pos[0], dz=tg[1]-a.pos[1], d=Math.hypot(dx,dz); if(d>0.05){ const s=Math.min(d,7.5*sdt); a.pos[0]+=dx/d*s; a.pos[1]+=dz/d*s; } } }
      if(this.tick) this.tick(sdt);
      this.buildDecals(); this.hud();
    },
    buildDecals(){ const d=[]; if(this.fxT>0&&this.fxAoes) for(const ao of this.fxAoes) d.push(ao); if(this.extra) this.extra(d); Scene.setDecals(d); },
    buffsOf(role){   // 通用小队列表 buff 数据：warn 阶段被点到属性 debuff 的人 → 显示该机制属性(炎/水) + 剩余秒
      if(this.kind==='warn' && this.marked && this.marked.indexOf(role)>=0){
        const at=P3.ATTR[this.attr]||P3.ATTR.fire;
        return [{label:at.cn, color:at.col, rem:Math.max(0,this.subEnd-this.t), kind:'debuff'}]; }
      return []; },
    judge(aoes){ const hit={}; ALL.forEach(r=>hit[r]=0);
      for(const ao of aoes){ for(const r of ALL){ const p=Scene.get(r).pos; const ins = ao.type==='donut'?P3.hitDonut(p,ao.x,ao.z,ao.radius):P3.hitCircle(p,ao.x,ao.z,ao.radius); if(ins) hit[r]++; } }
      this.hitSet=ALL.filter(r=>hit[r]>0);
      if(humanRole!=='OB' && hit[humanRole]>0) this.fail('('+humanRole+') 被命中 '+hit[humanRole]+' 个 AOE'); },
    hud(){ Scene.setHUD(this.hudLines?this.hudLines():[this.name]); }
  }, def);
}
/* 混沌之炎：N人火debuff→到期各放5m圆；火水晶→最近玩家10m环形【烈焰】(中心安全, 附击退) */
const P3_FIRE = p3mech({ id:'p3_fire', name:'混沌之炎（火）', attr:'fire',
  setup(){ const di=Math.floor(this.rng()*4); this.crPos=P3.diagPos(di,this.arenaR*0.6); P3.spawnCrystal('CR0','fire',this.crPos);
    this.marked=[P3.pick(this.rng,TH,1)[0],P3.pick(this.rng,DPS,1)[0]]; this.subEnd=9; this.kind='warn'; },
  tick(){ if(this.kind==='warn'&&this.t>=this.subEnd) this.resolve(); if(this.kind==='hit'&&this.fxT<=0) this.kind='done'; },
  resolve(){ this.kind='hit'; const aoes=[];
    this.marked.forEach(r=>{ const p=Scene.get(r).pos; aoes.push({type:'spread',x:p[0],z:p[1],radius:5,color:P3.ATTR.fire.col,alpha:0.42}); });
    this.blazeTgt=P3.nearestN(this.crPos[0],this.crPos[1],2);   // 火水晶点名最近2人，各放一个10m环形烈焰(中心安全, 命中者被击退)
    this.blazeTgt.forEach(r=>{ const tp=Scene.get(r).pos; aoes.push({type:'donut',x:tp[0],z:tp[1],radius:10,color:[1,0.5,0.15],alpha:0.4,kb:true,kbDist:15}); });
    this.fxAoes=aoes; this.fxT=1.6; this.judge(aoes); P3.knockFrom(aoes); },
  extra(d){ if(this.kind==='warn') this.marked.forEach(r=>{ const p=Scene.get(r).pos; d.push({type:'spread',x:p[0],z:p[1],radius:5,color:P3.ATTR.fire.col,alpha:0.13}); }); },
  hudLines(){ const L=['P3·一运 — 混沌之炎（火）  场地30m  种子:'+this.seed];
    if(this.kind==='warn') L.push('火点名: '+this.marked.join(' / ')+'    '+Math.max(0,this.subEnd-this.t).toFixed(1)+'s 到期','到期: 本人 5m 圆(+4s魔易)；火水晶→最近2人 各 10m 环形【烈焰】(中心安全,会击退)');
    else L.push('烈焰命中最近2人: '+(this.blazeTgt||[]).join(','), this.hitSet.length?('被命中: '+this.hitSet.join(',')):'无人被命中','点[开始]重练(随机点名/水晶位)');
    if(this.lastFail) L.push('✖ '+this.lastFail); return L; }
});
/* 混沌之水：N人水debuff→到期各放10m环形(中心安全)；水水晶→最近玩家5m圆【海啸】 */
const P3_WATER = p3mech({ id:'p3_water', name:'混沌之水（水）', attr:'water',
  setup(){ const di=Math.floor(this.rng()*4); this.crPos=P3.diagPos(di,this.arenaR*0.6); P3.spawnCrystal('CR0','water',this.crPos);
    this.marked=[P3.pick(this.rng,TH,1)[0],P3.pick(this.rng,DPS,1)[0]]; this.subEnd=9; this.kind='warn'; },
  tick(){ if(this.kind==='warn'&&this.t>=this.subEnd) this.resolve(); if(this.kind==='hit'&&this.fxT<=0) this.kind='done'; },
  resolve(){ this.kind='hit'; const aoes=[];
    this.marked.forEach(r=>{ const p=Scene.get(r).pos; aoes.push({type:'donut',x:p[0],z:p[1],radius:10,color:P3.ATTR.water.col,alpha:0.4}); });
    this.tsuTgt=P3.nearestN(this.crPos[0],this.crPos[1],2);   // 水水晶点名最近2人，各放一个5m圆海啸(命中者被击退)
    this.tsuTgt.forEach(r=>{ const tp=Scene.get(r).pos; aoes.push({type:'spread',x:tp[0],z:tp[1],radius:5,color:[0.3,0.7,1],alpha:0.44,kb:true,kbDist:15}); });
    this.fxAoes=aoes; this.fxT=1.6; this.judge(aoes); P3.knockFrom(aoes); },
  extra(d){ if(this.kind==='warn') this.marked.forEach(r=>{ const p=Scene.get(r).pos; d.push({type:'donut',x:p[0],z:p[1],radius:10,color:P3.ATTR.water.col,alpha:0.13}); }); },
  hudLines(){ const L=['P3·一运 — 混沌之水（水）  场地30m  种子:'+this.seed];
    if(this.kind==='warn') L.push('水点名: '+this.marked.join(' / ')+'    '+Math.max(0,this.subEnd-this.t).toFixed(1)+'s 到期','到期: 本人 10m 环形(中心安全)；水水晶→最近2人 各 5m 圆【海啸】(+4s魔易)');
    else L.push('海啸命中最近2人: '+(this.tsuTgt||[]).join(','), this.hitSet.length?('被命中: '+this.hitSet.join(',')):'无人被命中','点[开始]重练(随机点名/水晶位)');
    if(this.lastFail) L.push('✖ '+this.lastFail); return L; }
});
/* 混沌之风/逆风：全员随机 风(背对击退源)/逆风(正对击退源)；boss中心击退→朝向对=正常,错=翻倍飞出场=死；
   被击退(清除风)后连锁→风水晶点名最近2人 6m双人分摊【龙卷风】(<2人伤害暴涨)。正/背面arc=90°(±45°) */
const P3_WIND = p3mech({ id:'p3_wind', name:'混沌之顺风 / 逆风', attr:'wind',
  onReset(){ this.wtype={}; this.flewOut=[]; this.windTgt=null; this.tornadoN=0; },
  setup(){ const di=Math.floor(this.rng()*4); this.crPos=P3.diagPos(di,this.arenaR*0.6); P3.spawnCrystal('CR0','wind',this.crPos);
    this.wtype={}; ALL.forEach(r=>{ this.wtype[r]=this.rng()<0.5?'wind':'counter'; });   // 全员随机 风/逆风
    this.subEnd=9; this.kind='warn'; this.flewOut=[]; },
  tick(){
    if(this.kind==='warn' && this.t>=this.subEnd) this.doKnock();
    else if(this.kind==='knock' && this.t>=this.kbEnd) this.doTornado();
    else if(this.kind==='tornado' && this.fxT<=0) this.kind='done';
  },
  doKnock(){ this.kind='knock'; this.flewOut=[];
    for(const r of ALL){ const p=Scene.get(r).pos, away=Math.atan2(p[0],p[1]);   // away=远离boss(中心)的朝向
      let correct=true;
      if(r===humanRole){ const want=this.wtype[r]==='wind'?away:away+Math.PI;   // 风=背对(面朝away) / 逆风=正对(面朝中心)
        let da=((playerFacing-want+Math.PI)%TAU+TAU)%TAU-Math.PI; correct=Math.abs(da)<=Math.PI/4; }
      const dist=correct?15:30; startKBv(r, Math.sin(away)*dist, Math.cos(away)*dist);   // 朝外击退; 错向=翻倍
      if(!correct) this.flewOut.push(r);
    }
    if(humanRole!=='OB' && this.flewOut.indexOf(humanRole)>=0) this.fail('('+humanRole+') 朝向错误→击退翻倍飞出场外=死');
    this.kbEnd=this.t+0.6;
  },
  doTornado(){ this.kind='tornado'; this.windTgt=P3.nearestN(this.crPos[0],this.crPos[1],2);   // 连锁风水晶→点名最近2人
    const a=Scene.get(this.windTgt[0]).pos, b=Scene.get(this.windTgt[1]).pos, cx=(a[0]+b[0])/2, cz=(a[1]+b[1])/2;
    this.fxAoes=[{type:'stack',x:cx,z:cz,radius:6,color:P3.ATTR.wind.col,alpha:0.42}]; this.fxT=1.6;
    let n=0; for(const r of ALL){ const p=Scene.get(r).pos; if(Math.hypot(p[0]-cx,p[1]-cz)<=6) n++; } this.tornadoN=n;
    if(humanRole!=='OB' && n<2) this.fail('龙卷风分摊不足2人('+n+')→伤害暴涨');
  },
  buffsOf(role){ if((this.kind==='warn'||this.kind==='knock') && this.wtype){ const w=this.wtype[role];
      if(w) return [{label:w==='wind'?'顺风':'逆风', color:w==='wind'?[0.45,0.9,0.55]:[0.55,0.8,0.98], rem:this.kind==='warn'?Math.max(0,this.subEnd-this.t):0, kind:'debuff'}]; }
    return []; },
  extra(d){ if(this.kind==='warn') d.push({type:'charge',x:0,z:0,radius:6}); },   // 中心=击退源(charge环示意)
  hudLines(){ const L=['P3·一运 — 混沌之顺风/逆风  场地30m  种子:'+this.seed];
    if(this.kind==='warn'){ L.push('全员: 顺风=背对中心 / 逆风=正对中心   '+Math.max(0,this.subEnd-this.t).toFixed(1)+'s 后中心击退');
      if(humanRole!=='OB') L.push('你: '+(this.wtype[humanRole]==='wind'?'顺风 → 背对中心(后背朝boss)':'逆风 → 正对中心(面朝boss)'));
      L.push('朝向错→击退翻倍飞出场外=死；被击退后风水晶点最近2人分摊龙卷风'); }
    else if(this.kind==='knock') L.push('击退中…(被击退即清除顺风/逆风)');
    else L.push('龙卷风(6m双人分摊)→最近2人: '+(this.windTgt||[]).join(','), '分摊圈内 '+(this.tornadoN||0)+' 人'+((this.tornadoN||0)<2?' (不足!)':''), (this.flewOut&&this.flewOut.length?('飞出场外: '+this.flewOut.join(',')):'点[开始]重练(随机顺风/逆风+水晶位)'));
    if(this.lastFail) L.push('✖ '+this.lastFail); return L; }
});
/* 经度/纬度聚爆：boss 中心两波 90°十字扇。经度=先前后(N/S)→左右(E/W); 纬度=先左右→前后 */
function p3coneBurst(id,name,firstHorizontal){
  const V=[0,Math.PI], H=[Math.PI/2,Math.PI*1.5];                 // 前后 / 左右 各两扇朝向
  const w1=firstHorizontal?H:V, w2=firstHorizontal?V:H, ax1=firstHorizontal?'左右':'前后', ax2=firstHorizontal?'前后':'左右';
  return p3mech({ id, name,
    setup(){ this.subEnd=4; this.kind='tele1'; },
    tick(){
      if(this.kind==='tele1' && this.t>=this.subEnd) this.fire(1);
      else if(this.kind==='hit1' && this.fxT<=0){ this.kind='tele2'; this.t2=this.t; }
      else if(this.kind==='tele2' && this.t>=this.t2+2.5) this.fire(2);
      else if(this.kind==='hit2' && this.fxT<=0) this.kind='done';
    },
    fire(w){ this.kind='hit'+w; const fac=w===1?w1:w2;
      this.fxAoes=fac.map(f=>({type:'cone',x:0,z:0,facing:f,radius:this.arenaR,color:[1,0.5,0.12],alpha:0.42}));
      this.fxT=1.3;
      if(humanRole!=='OB'){ const me=Scene.get(humanRole).pos;
        for(const ao of this.fxAoes){ if(inCone(me,0,0,ao.facing,ao.radius)){ this.fail('('+humanRole+') 站在第'+w+'波('+(w===1?ax1:ax2)+')扇形内'); break; } } }
    },
    extra(d){ if(this.kind==='tele1') w1.forEach(f=>d.push({type:'cone',x:0,z:0,facing:f,radius:this.arenaR,color:[1,0.5,0.12],alpha:0.12}));
      if(this.kind==='tele2') w2.forEach(f=>d.push({type:'cone',x:0,z:0,facing:f,radius:this.arenaR,color:[1,0.5,0.12],alpha:0.12})); },
    hudLines(){ const L=['P3·一运 — '+name+'  场地30m  种子:'+this.seed];
      if(this.kind==='tele1') L.push('第1波将打 '+ax1+' 90°扇 → 站到 '+ax2+'   '+Math.max(0,this.subEnd-this.t).toFixed(1)+'s');
      else if(this.kind==='hit1') L.push('第1波('+ax1+')命中! 移到 '+ax1+'(躲第2波'+ax2+')');
      else if(this.kind==='tele2') L.push('第2波将打 '+ax2+' → 站到 '+ax1);
      else L.push('两波结束','点[开始]重练');
      if(this.lastFail) L.push('✖ '+this.lastFail); return L; }
  });
}
const P3_LONG = p3coneBurst('p3_long','经度聚爆（先前后→左右）', false);
const P3_LAT  = p3coneBurst('p3_lat', '纬度聚爆（先左右→前后）', true);
/* 本影爆碎：boss 超级跳【最远】玩家落点 + 距离衰减AOE(越近伤害越高, 核心<8m致命) */
const P3_UMBRAL = p3mech({ id:'p3_umbral', name:'本影爆碎（超级跳·距离衰减）',
  onReset(){ this.farTgt=null; this.myDist=null; },
  setup(){ this.subEnd=5; this.kind='warn'; },
  tick(){ if(this.kind==='warn'&&this.t>=this.subEnd) this.resolve(); if(this.kind==='hit'&&this.fxT<=0) this.kind='done'; },
  resolve(){ this.kind='hit'; this.farTgt=P3.farthest(0,0); const fp=Scene.get(this.farTgt).pos.slice();
    const bb=Scene.get('BOSS'); if(bb) bb.pos=fp.slice();   // 超级跳到最远者落点
    this.fxAoes=[ {type:'spread',x:fp[0],z:fp[1],radius:8, color:[0.88,0.2,0.96],alpha:0.5},    // 核心致命
                  {type:'donut', x:fp[0],z:fp[1],radius:16,color:[0.7,0.25,0.95],alpha:0.26},
                  {type:'donut', x:fp[0],z:fp[1],radius:26,color:[0.55,0.3,0.9], alpha:0.15} ];  // 外圈递减
    this.fxT=1.9;
    if(humanRole!=='OB'){ const me=Scene.get(humanRole).pos; this.myDist=Math.hypot(me[0]-fp[0],me[1]-fp[1]);
      if(this.myDist<=8) this.fail('('+humanRole+') 在本影核心(<8m)→致命'); }
  },
  hudLines(){ const L=['P3·一运 — 本影爆碎  场地30m  种子:'+this.seed];
    if(this.kind==='warn') L.push('boss 将超级跳【最远】玩家落点, 距离衰减(越近越痛)', Math.max(0,this.subEnd-this.t).toFixed(1)+'s', '尽量远离将成为最远的那名玩家');
    else L.push('跳向最远: '+this.farTgt, (this.myDist!=null?('你距落点 '+this.myDist.toFixed(1)+'m'+(this.myDist<=8?' (核心!)':'')):''),'点[开始]重练');
    if(this.lastFail) L.push('✖ '+this.lastFail); return L; }
});
/* 深层痛楚：开场全体魔法伤(奶检, 无站位需求) */
const P3_DEEPPAIN = p3mech({ id:'p3_deeppain', name:'深层痛楚（全体魔法伤·奶检）',
  setup(){ this.subEnd=5; this.kind='warn'; },
  tick(){ if(this.kind==='warn'&&this.t>=this.subEnd){ this.kind='hit'; this.fxT=1.0; } else if(this.kind==='hit'&&this.fxT<=0) this.kind='done'; },
  extra(d){ if(this.kind==='hit') d.push({type:'spread',x:0,z:0,radius:this.arenaR,color:[0.6,0.3,0.9],alpha:0.18}); },   // 全场紫脉冲
  hudLines(){ const L=['P3·一运 — 深层痛楚（开场全体魔法伤）  种子:'+this.seed];
    if(this.kind==='warn') L.push('全体魔法伤(奶检), '+Math.max(0,this.subEnd-this.t).toFixed(1)+'s'); else L.push('全体伤判定(无站位, 减伤/奶量)','点[开始]重练');
    return L; }
});
/* 暴雷：连黑洞→钢铁(boss自身11m圆,全员出圈) 然后 不连→死刑(一仇坦克, 雷属性易伤) —— 两段都打 */
const P3_BOLT = p3mech({ id:'p3_bolt', name:'暴雷（钢铁→死刑）',
  setup(){ this.subEnd=7; this.kind='warn'; this.dsTgt='MT';   // 死刑→一仇(MT)
    ALL.forEach((r,i)=>{ const ang=i/8*TAU-Math.PI/2; this.players[r].target=[Math.cos(ang)*16, Math.sin(ang)*16]; }); },   // NPC 预走出 11m
  tick(){ if(this.kind==='warn'&&this.t>=this.subEnd) this.fireSteel();
    else if(this.kind==='steel'&&this.fxT<=0){ this.kind='warn2'; this.t2=this.t; }
    else if(this.kind==='warn2'&&this.t>=this.t2+4) this.fireDeath();
    else if(this.kind==='death'&&this.fxT<=0) this.kind='done'; },
  fireSteel(){ this.kind='steel'; this.fxAoes=[{type:'spread',x:0,z:0,radius:11,color:[1,0.9,0.3],alpha:0.4}]; this.fxT=1.4; this.judge(this.fxAoes); },
  fireDeath(){ this.kind='death'; const tp=Scene.get(this.dsTgt).pos; this.fxAoes=[{type:'spread',x:tp[0],z:tp[1],radius:6,color:[0.95,0.85,0.2],alpha:0.45}]; this.fxT=1.6;
    if(humanRole!=='OB' && humanRole!==this.dsTgt){ const me=Scene.get(humanRole).pos; if(Math.hypot(me[0]-tp[0],me[1]-tp[1])<=6) this.fail('('+humanRole+') 站进死刑('+this.dsTgt+')范围'); } },
  extra(d){ if(this.kind==='warn') d.push({type:'spread',x:0,z:0,radius:11,color:[1,0.9,0.3],alpha:0.12});
    if(this.kind==='warn2'){ const tp=Scene.get(this.dsTgt).pos; d.push({type:'spread',x:tp[0],z:tp[1],radius:6,color:[0.95,0.85,0.2],alpha:0.14}); } },
  hudLines(){ const L=['P3·一运 — 暴雷（钢铁→死刑）  场地30m  种子:'+this.seed];
    if(this.kind==='warn') L.push('钢铁: boss 连黑洞→自身 11m 圆, 全员出圈   '+Math.max(0,this.subEnd-this.t).toFixed(1)+'s');
    else if(this.kind==='steel') L.push('钢铁(11m)判定! '+(this.hitSet.length?('被命中: '+this.hitSet.join(',')):'安全'),'准备死刑(一仇坦克)');
    else if(this.kind==='warn2') L.push('死刑: 不连黑洞→对一仇('+this.dsTgt+')雷属性死刑, 其他人离开');
    else L.push('死刑→'+this.dsTgt+'(坦克承受+雷易伤)','点[开始]重练');
    if(this.lastFail) L.push('✖ '+this.lastFail); return L; }
});
/* 真空波：boss 中心全场击退(全程里=清"风/逆风"的击退源) */
const P3_VACUUM = p3mech({ id:'p3_vacuum', name:'真空波（中心全场击退）',
  setup(){ this.subEnd=8; this.kind='warn'; },
  tick(){ if(this.kind==='warn'&&this.t>=this.subEnd) this.fire(); else if(this.kind==='knock'&&this.t>=this.kbEnd) this.kind='done'; },
  fire(){ this.kind='knock';
    for(const r of ALL){ const p=Scene.get(r).pos; let ang=Math.atan2(p[0],p[1]); if(Math.hypot(p[0],p[1])<0.5) ang=ALL.indexOf(r)/8*TAU; startKBv(r, Math.sin(ang)*18, Math.cos(ang)*18); }
    this.kbEnd=this.t+0.8; this.fxAoes=[{type:'charge',x:0,z:0,radius:8}]; this.fxT=0.8; },
  extra(d){ if(this.kind==='warn') d.push({type:'charge',x:0,z:0,radius:8}); },
  hudLines(){ const L=['P3·一运 — 真空波（中心全场击退）  场地30m  种子:'+this.seed];
    if(this.kind==='warn') L.push('boss 中心全场击退, '+Math.max(0,this.subEnd-this.t).toFixed(1)+'s','全程中=清「风/逆风」的击退源；提前抗击退/选落点');
    else L.push('击退!(全程中此击退清除风/逆风)','点[开始]重练');
    return L; }
});
/* 究极冲击波：无读条、有方向的旋转半场波。随机起点(8个正/斜点之一)+随机顺/逆, 共8击每2s一次、每次转45°(满360°), 中途不反向。
   躲法=站在波动【对侧】半场, 跟着同向转。特效=深蓝色半场波(持续扫场) */
const P3_SHOCKWAVE = p3mech({ id:'p3_shock', name:'究极冲击波（场边波·8击）',
  setup(){ this.start=Math.floor(this.rng()*8)*45; this.dir=this.rng()<0.5?1:-1; this.subEnd=2;
    this.hitN=0; this.kind='sweep'; this.flash=0; this.DR=this.arenaR+2; },   // DR=来波侧危险半径(近半场); 站对面场边躲
  edgePt(n){ const A=d2r(this.start + this.dir*45*n); return [Math.sin(A)*this.arenaR, Math.cos(A)*this.arenaR]; },   // 第n击的场边来源点
  tick(sdt){ if(this.flash>0) this.flash-=sdt; if(this.kind!=='sweep') return;
    if(this.t>=this.subEnd){ this.t-=this.subEnd; this.doHit(); } },
  doHit(){ const P=this.edgePt(this.hitN); this.flash=0.45;
    if(humanRole!=='OB'){ const me=Scene.get(humanRole).pos; if(Math.hypot(me[0]-P[0],me[1]-P[1])<=this.DR) this.fail('('+humanRole+') 第'+(this.hitN+1)+'击被场边波卷到'); }
    this.hitN++; if(this.hitN>=8) this.kind='done'; },
  extra(d){ if(this.kind!=='sweep') return; const P=this.edgePt(this.hitN), r=this.DR*Math.min(1,this.t/this.subEnd);   // 深蓝波从场边点涌入(sweep)
    d.push({type:'spread',x:P[0],z:P[1],radius:Math.max(0.6,r),color:[0.12,0.34,0.80],alpha:this.flash>0?0.5:0.28}); },
  hudLines(){ const L=['P3·一运 — 究极冲击波（场边波·每2s共8击）  种子:'+this.seed];
    if(this.kind==='sweep') L.push('波从场边 '+(((this.start+this.dir*45*this.hitN)%360)+360)%360+'° 涌入 · '+(this.dir>0?'顺':'逆')+'时针 · '+this.hitN+'/8','站到【对面场边】(远离来波侧), 同向跟着转 45°/击');
    else L.push('8 击结束','点[开始]重练');
    if(this.lastFail) L.push('✖ '+this.lastFail); return L; }
});
/* ★ 一运·全程：按真实时间轴(秒)串起所有机制。
   0 深层痛楚/上debuff/出3水晶 · 12 暴雷读 · 19 钢铁(boss11m)+19s水炎解除(本体AOE+火/水水晶点最近2+击退) · 23 死刑(一仇) ·
   36 经度/纬度聚爆读 · 38 波1 · 41 波2 · 46 46s炎水解除 · 57 真空波+本影读+究极冲击波起 · 62 本影(距离衰减) · 65 真空波(击退清风+龙卷风) · 57~71 究极冲击波8击 */
const P3_FULL = p3mech({ id:'p3_full', name:'★ 一运 · 全程（完整时间轴）',
  onReset(){ this.fxList=[]; this.evi=0; this.shockOn=false; this.dispA=0; this.windType={}; this.elem={}; this.phaseTxt='待命'; this.steelTele=false; this.burstTele=0; this.windCleared=false; this._torUntil=0; this._tornadoAt=0; },
  setup(){ this.fxList=[]; this.evi=0; this.shockOn=false; this.t=0; this.subEnd=1e9; this.kind='run'; this.endT=73; this.phaseTxt='深层痛楚'; this.windCleared=false; this._torUntil=0; this._tornadoAt=0; this.dsTgt='MT';
    var ds=P3.pick(this.rng,[0,1,2,3],3).sort((a,b)=>a-b), mid=ds[1], ends=[ds[0],ds[2]]; if(this.rng()<0.5) ends.reverse();   // 3斜点, 风夹中间
    this.crystalPos={ wind:P3.diagPos(mid,this.arenaR*0.62), fire:P3.diagPos(ends[0],this.arenaR*0.62), water:P3.diagPos(ends[1],this.arenaR*0.62) };
    P3.spawnCrystal('CRw','wind',this.crystalPos.wind); P3.spawnCrystal('CRf','fire',this.crystalPos.fire); P3.spawnCrystal('CRr','water',this.crystalPos.water);
    var t19=[P3.pick(this.rng,TH,1)[0],P3.pick(this.rng,DPS,1)[0]];                                   // 19s: 1TN+1DPS (1水1炎)
    var t46=[P3.pick(this.rng,TH.filter(r=>r!==t19[0]),1)[0], P3.pick(this.rng,DPS.filter(r=>r!==t19[1]),1)[0]];  // 46s: 另1TN+1DPS
    this.elem={}; var self=this;
    (this.rng()<0.5?['water','fire']:['fire','water']).forEach((e,i)=>self.elem[t19[i]]=e);
    (this.rng()<0.5?['water','fire']:['fire','water']).forEach((e,i)=>self.elem[t46[i]]=e);
    this.t19=t19; this.t46=t46;
    this.windType={}; ALL.forEach(r=>self.windType[r]=self.rng()<0.5?'wind':'counter');               // 全员 风/逆风
    this.burstHoriz=this.rng()<0.5;                                                                    // true=纬度(先左右) / false=经度(先前后)
    var V=[0,Math.PI], H=[Math.PI/2,Math.PI*1.5], w1=this.burstHoriz?H:V, w2=this.burstHoriz?V:H;
    this.schedule=[
      {t:3,  lbl:'深层痛楚(全体魔法伤)', fn(){ self.addFx([{type:'spread',x:0,z:0,radius:self.arenaR,color:[0.6,0.3,0.9],alpha:0.18}],1.0); }},
      {t:12, lbl:'暴雷读条→钢铁', fn(){ self.steelTele=true; }},
      {t:19, lbl:'钢铁(11m)+19s水炎解除', fn(){ self.steelTele=false; self.fireSteel(); self.elemResolve(self.t19); }},
      {t:23, lbl:'死刑→一仇坦克', fn(){ self.fireDeath(); }},
      {t:36, lbl:(self.burstHoriz?'纬度':'经度')+'聚爆读条', fn(){ self.burstTele=1; }},
      {t:38, lbl:'聚爆 第1波', fn(){ self.burstTele=0; self.fireCones(w1,1); }},
      {t:41, lbl:'聚爆 第2波', fn(){ self.fireCones(w2,2); }},
      {t:46, lbl:'46s 炎水解除', fn(){ self.elemResolve(self.t46); }},
      {t:57, lbl:'真空波+本影读·究极冲击波起', fn(){ self.shockOn=true; self.shockStart=Math.floor(self.rng()*8)*45; self.shockDir=self.rng()<0.5?1:-1; self.shockN=0; self.shockNextT=57; self.dispA=d2r(self.shockStart); }},
      {t:62, lbl:'本影爆碎(距离衰减)', fn(){ self.fireUmbral(); }},
      {t:65, lbl:'真空波(击退清风)+龙卷风', fn(){ self.fireVacuum(); }}
    ];
  },
  tick(sdt){
    while(this.evi<this.schedule.length && this.t>=this.schedule[this.evi].t){ this.phaseTxt=this.schedule[this.evi].lbl; this.schedule[this.evi].fn(); this.evi++; }
    if(this.shockOn && this.t>=this.shockNextT && this.shockN<8){ var A=d2r(this.shockStart + this.shockDir*45*this.shockN), P=[Math.sin(A)*this.arenaR,Math.cos(A)*this.arenaR];   // 究极冲击波: 每2s一击共8次, 波从场边涌入
        this.addFx([{type:'spread',x:P[0],z:P[1],radius:this.arenaR+2,color:[0.12,0.34,0.80],alpha:0.5}],0.4);
        if(humanRole!=='OB'){ var me=Scene.get(humanRole).pos; if(Math.hypot(me[0]-P[0],me[1]-P[1])<=this.arenaR+2) this.fail('究极冲击波第'+(this.shockN+1)+'击 ('+humanRole+')'); }
        this.shockN++; this.shockNextT+=2; if(this.shockN>=8) this.shockOn=false; }
    if(this.t>=this.endT && this.kind!=='done'){ this.kind='done'; this.win=this.failLog.length===0; }
  },
  addFx(decals,dur){ for(var i=0;i<decals.length;i++) this.fxList.push({ao:decals[i],until:this.t+dur}); },
  buildDecals(){ var d=[]; this.fxList=this.fxList.filter(f=>f.until>this.t); for(var i=0;i<this.fxList.length;i++) d.push(this.fxList[i].ao); if(this.extra) this.extra(d); Scene.setDecals(d); },
  fireSteel(){ this.addFx([{type:'spread',x:0,z:0,radius:11,color:[1,0.9,0.3],alpha:0.4}],1.4);
    if(humanRole!=='OB'){ var me=Scene.get(humanRole).pos; if(Math.hypot(me[0],me[1])<=11) this.fail('暴雷钢铁(11m) ('+humanRole+')'); } },
  fireDeath(){ var tp=Scene.get(this.dsTgt).pos; this.addFx([{type:'spread',x:tp[0],z:tp[1],radius:6,color:[0.95,0.85,0.2],alpha:0.45}],1.4);
    if(humanRole!=='OB'&&humanRole!==this.dsTgt){ var me=Scene.get(humanRole).pos; if(Math.hypot(me[0]-tp[0],me[1]-tp[1])<=6) this.fail('死刑波及 ('+humanRole+')'); } },
  fireCones(fac,w){ var aoes=fac.map(f=>({type:'cone',x:0,z:0,facing:f,radius:this.arenaR,color:[1,0.5,0.12],alpha:0.42})); this.addFx(aoes,1.3);
    if(humanRole!=='OB'){ var me=Scene.get(humanRole).pos; for(var i=0;i<aoes.length;i++) if(inCone(me,0,0,aoes[i].facing,aoes[i].radius)){ this.fail('聚爆第'+w+'波 ('+humanRole+')'); break; } } },
  elemResolve(pair){ var aoes=[], self=this;
    pair.forEach(function(r){ var p=Scene.get(r).pos; aoes.push(self.elem[r]==='fire'?{type:'spread',x:p[0],z:p[1],radius:5,color:P3.ATTR.fire.col,alpha:0.42}:{type:'donut',x:p[0],z:p[1],radius:10,color:P3.ATTR.water.col,alpha:0.4}); });
    P3.nearestN(this.crystalPos.fire[0],this.crystalPos.fire[1],2).forEach(r=>{ var tp=Scene.get(r).pos; aoes.push({type:'donut',x:tp[0],z:tp[1],radius:10,color:[1,0.5,0.15],alpha:0.4,kb:true,kbDist:15}); });   // 火水晶烈焰 最近2
    P3.nearestN(this.crystalPos.water[0],this.crystalPos.water[1],2).forEach(r=>{ var tp=Scene.get(r).pos; aoes.push({type:'spread',x:tp[0],z:tp[1],radius:5,color:[0.3,0.7,1],alpha:0.44}); });   // 水水晶海啸 最近2
    this.addFx(aoes,1.6);
    if(humanRole!=='OB'){ var me=Scene.get(humanRole).pos, hit=0; aoes.forEach(a=>{ if(a.type==='donut'?P3.hitDonut(me,a.x,a.z,a.radius):P3.hitCircle(me,a.x,a.z,a.radius)) hit++; }); if(hit>0) this.fail('元素解除命中×'+hit+' ('+humanRole+')'); }
    P3.knockFrom(aoes); },
  fireUmbral(){ this.umbralTgt=P3.farthest(0,0); var fp=Scene.get(this.umbralTgt).pos.slice(), bb=Scene.get('BOSS'); if(bb)bb.pos=fp.slice();
    this.addFx([{type:'spread',x:fp[0],z:fp[1],radius:8,color:[0.88,0.2,0.96],alpha:0.5},{type:'donut',x:fp[0],z:fp[1],radius:16,color:[0.7,0.25,0.95],alpha:0.26},{type:'donut',x:fp[0],z:fp[1],radius:26,color:[0.55,0.3,0.9],alpha:0.15}],1.8);
    if(humanRole!=='OB'){ var me=Scene.get(humanRole).pos; if(Math.hypot(me[0]-fp[0],me[1]-fp[1])<=8) this.fail('本影核心(<8m) ('+humanRole+')'); } },
  fireVacuum(){ for(var i=0;i<ALL.length;i++){ var r=ALL[i], p=Scene.get(r).pos, away=Math.atan2(p[0],p[1]), correct=true;
      if(r===humanRole){ var want=this.windType[r]==='wind'?away:away+Math.PI, da=((playerFacing-want+Math.PI)%TAU+TAU)%TAU-Math.PI; correct=Math.abs(da)<=Math.PI/4; }
      startKBv(r, Math.sin(away)*15*(correct?1:2), Math.cos(away)*15*(correct?1:2));
      if(r===humanRole && !correct) this.fail('真空波: 风/逆风朝向错→翻倍飞出场 ('+humanRole+')'); }
    this.windCleared=true; this._tornadoAt=this.t+0.7; this.addFx([{type:'charge',x:0,z:0,radius:8}],0.7); },
  extra(d){
    if(this.steelTele) d.push({type:'spread',x:0,z:0,radius:11,color:[1,0.9,0.3],alpha:0.12});
    if(this.burstTele===1){ var V=[0,Math.PI],H=[Math.PI/2,Math.PI*1.5]; (this.burstHoriz?H:V).forEach(f=>d.push({type:'cone',x:0,z:0,facing:f,radius:this.arenaR,color:[1,0.5,0.12],alpha:0.12})); }
    if(this.shockOn && this.shockN<8){ var sA=d2r(this.shockStart+this.shockDir*45*this.shockN), sP=[Math.sin(sA)*this.arenaR,Math.cos(sA)*this.arenaR], sr=(this.arenaR+2)*Math.max(0,Math.min(1,(this.t-(this.shockNextT-2))/2));
      d.push({type:'spread',x:sP[0],z:sP[1],radius:Math.max(0.6,sr),color:[0.12,0.34,0.80],alpha:0.22}); }   // 下一击场边波涌入预告
    if(this._tornadoAt && this.t>=this._tornadoAt){ this._tornadoAt=0; var wa=P3.nearestN(this.crystalPos.wind[0],this.crystalPos.wind[1],2), a=Scene.get(wa[0]).pos, b=Scene.get(wa[1]).pos; this._torC=[(a[0]+b[0])/2,(a[1]+b[1])/2]; this._torUntil=this.t+1.6; }
    if(this._torUntil && this.t<this._torUntil) d.push({type:'stack',x:this._torC[0],z:this._torC[1],radius:6,color:P3.ATTR.wind.col,alpha:0.42});
  },
  buffsOf(role){ var out=[], e=this.elem&&this.elem[role];
    if(e){ var rem = (this.t19&&this.t19.indexOf(role)>=0)?19-this.t:((this.t46&&this.t46.indexOf(role)>=0)?46-this.t:0); if(rem>0) out.push({label:P3.ATTR[e].cn,color:P3.ATTR[e].col,rem:rem,kind:'debuff'}); }
    var w=this.windType&&this.windType[role]; if(w && !this.windCleared && this.t<68) out.push({label:w==='wind'?'顺风':'逆风',color:w==='wind'?[0.45,0.9,0.55]:[0.55,0.8,0.98],rem:Math.max(0,68-this.t),kind:'debuff'});
    return out; },
  hudLines(){ var L=['P3·一运 ★全程  场地30m  种子:'+this.seed, '⏱ '+this.t.toFixed(0)+'s · '+this.phaseTxt+' · 速度可调(2×更快)'];
    if(humanRole!=='OB'){ var me=[]; if(this.elem[humanRole]) me.push(P3.ATTR[this.elem[humanRole]].cn); if(this.windType[humanRole]&&!this.windCleared) me.push(this.windType[humanRole]==='wind'?'顺风(真空波背对中心)':'逆风(真空波正对中心)'); if(me.length) L.push('你: '+me.join(' + ')); }
    if(this.kind==='done') L.push(this.failLog.length?('❌ 失败 ×'+this.failLog.length):'✅ 全程无伤通过','点[开始]重练');
    else if(this.lastFail) L.push('✖ '+this.lastFail);
    return L; }
});
SIM.register(P3_FULL); SIM.register(P3_DEEPPAIN); SIM.register(P3_BOLT); SIM.register(P3_FIRE); SIM.register(P3_WATER); SIM.register(P3_LONG); SIM.register(P3_LAT); SIM.register(P3_WIND); SIM.register(P3_VACUUM); SIM.register(P3_SHOCKWAVE); SIM.register(P3_UMBRAL);
