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
const P3_WIND = p3mech({ id:'p3_wind', name:'混沌之风 / 逆风', attr:'wind',
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
      if(w) return [{label:w==='wind'?'风':'逆风', color:w==='wind'?[0.45,0.9,0.55]:[0.55,0.8,0.98], rem:this.kind==='warn'?Math.max(0,this.subEnd-this.t):0, kind:'debuff'}]; }
    return []; },
  extra(d){ if(this.kind==='warn') d.push({type:'charge',x:0,z:0,radius:6}); },   // 中心=击退源(charge环示意)
  hudLines(){ const L=['P3·一运 — 混沌之风/逆风  场地30m  种子:'+this.seed];
    if(this.kind==='warn'){ L.push('全员: 风=背对中心 / 逆风=正对中心   '+Math.max(0,this.subEnd-this.t).toFixed(1)+'s 后中心击退');
      if(humanRole!=='OB') L.push('你: '+(this.wtype[humanRole]==='wind'?'风 → 背对中心(后背朝boss)':'逆风 → 正对中心(面朝boss)'));
      L.push('朝向错→击退翻倍飞出场外=死；被击退后风水晶点最近2人分摊龙卷风'); }
    else if(this.kind==='knock') L.push('击退中…(被击退即清除风/逆风)');
    else L.push('龙卷风(6m双人分摊)→最近2人: '+(this.windTgt||[]).join(','), '分摊圈内 '+(this.tornadoN||0)+' 人'+((this.tornadoN||0)<2?' (不足!)':''), (this.flewOut&&this.flewOut.length?('飞出场外: '+this.flewOut.join(',')):'点[开始]重练(随机风/逆风+水晶位)'));
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
SIM.register(P3_FIRE); SIM.register(P3_WATER); SIM.register(P3_WIND); SIM.register(P3_LONG); SIM.register(P3_LAT); SIM.register(P3_UMBRAL);
