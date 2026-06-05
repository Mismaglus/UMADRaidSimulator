"use strict";
/* core/sim.js — 机制注册表 + 切换器(SIM) */
const SIM={
  mechs:{}, order:[], current:null,
  register(m){ this.mechs[m.id]=m; this.order.push(m); },
  select(id){ const m=this.mechs[id]; if(!m) return; this.current=m;
    clearKB(); ARENA_R = m.arenaR||R; cam.dist=clamp(ARENA_R*1.85,12,90);   // 适配场地大小的默认视距
    m.mountOptions ? m.mountOptions($('mechOpts')) : ($('mechOpts').innerHTML='');
    m.reset();   // 切换=复位到该机制待命预览（点开始才运行）
    const pb=$('pauseBtn'); if(pb) pb.textContent='暂停';
  }
};
Scene.onTick = (dt)=>{ if(SIM.current) SIM.current.update(dt); };
