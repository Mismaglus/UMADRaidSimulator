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
      clearKB(); P3.clearCrystals(); P3.ringActors(11); this.players={}; ALL.forEach(r=>this.players[r]={}); Scene.setDecals([]);
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
SIM.register(P3_FIRE); SIM.register(P3_WATER);
