"use strict";
/* core/host.js — 相机/UI输入监听 + AOE预览 + 初始演员 */
/* ==12 HOST / BOOT== 装配：相机输入、UI、初始场景、主循环 */
glc.style.touchAction='none';
let down=false, lx=0, ly=0;
glc.addEventListener('pointerdown',e=>{ down=true; lx=e.clientX; ly=e.clientY; glc.setPointerCapture(e.pointerId); });
glc.addEventListener('pointermove',e=>{ if(!down) return;
  const dx=e.clientX-lx, dy=e.clientY-ly;
  cam.yaw-=dx*0.005; cam.pitch=clamp(cam.pitch+dy*0.005, d2r(12), d2r(85)); lx=e.clientX; ly=e.clientY; });
glc.addEventListener('pointerup',()=>{ down=false; });
glc.addEventListener('wheel',e=>{ e.preventDefault(); cam.dist=clamp(cam.dist*Math.exp(e.deltaY*0.001), 12, 90); }, {passive:false});
addEventListener('contextmenu', e=>e.preventDefault());   // 屏蔽右键菜单（方便右键拖拽转视角）

document.getElementById('roleSel').addEventListener('change',e=>{ humanRole=e.target.value; });
document.getElementById('resetCam').addEventListener('click',()=>{ cam.yaw=Math.PI; cam.pitch=d2r(55); cam.dist=38; cam.target=[0,0,0]; });
document.getElementById('followBtn').addEventListener('click',e=>{ follow=!follow; e.target.textContent='跟随：'+(follow?'开':'关'); if(!follow) cam.target=[0,0,0]; });

const sampleToggles={tower:false,cone:false,spread:false,stack:false,halfcleave:false,charge:false};
document.querySelectorAll('#ui input[data-d]').forEach(cb=>{
  cb.addEventListener('change',()=>{ sampleToggles[cb.dataset.d]=cb.checked; rebuildDecals(); });
});
function rebuildDecals(){
  const d=[];
  if(sampleToggles.tower){ d.push({type:'tower',x:-6,z:8,radius:3},{type:'tower',x:6,z:8,radius:3}); }
  if(sampleToggles.cone){ d.push({type:'cone',x:-10,z:6,radius:9,facing:d2r(215)}); }
  if(sampleToggles.spread){ d.push({type:'spread',x:9,z:3,radius:3}); }
  if(sampleToggles.stack){ d.push({type:'stack',x:0,z:11,radius:5}); }
  if(sampleToggles.halfcleave){ d.push({type:'halfcleave',x:0,z:0,radius:34,facing:0}); }
  if(sampleToggles.charge){ d.push({type:'charge',x:0,z:0,radius:5}); }
  Scene.setDecals(d);
}

// 初始演员：BOSS 居中，8 名玩家环绕（阶段2 会由引擎重排）
Scene.addActor({id:'BOSS',kind:'boss',role:'',pos:[0,0],color:COL.BOSS,radius:2.0,height:4.0,alpha:1});
['MT','ST','H1','H2','D1','D2','D3','D4'].forEach((r,i)=>{
  // 开场：支援列(MT ST H1 H2)在 boss 左、DPS 列在 boss 右，朝 C 竖排
  Scene.addActor({id:r,kind:'player',role:r,pos:[i<4?-2.6:2.6, [-9,-11,-13,-15][i%4]],color:roleColor(r),radius:0.6,height:2.2,alpha:1});
});

