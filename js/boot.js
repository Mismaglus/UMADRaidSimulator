"use strict";
/* boot.js — UI 接线 + 启动默认机制 + resize + 主循环(最后加载) */
const BUILD='v17';  // 改 js 时连同 index.html 的 ?v= 一起 +1；面板右上角会显示，便于确认是否加载了新代码
(function(){ const e=$('ver'); if(e) e.textContent=BUILD; })();
$('startBtn').addEventListener('click',()=>{ if($('randSeed').checked) $('seedInp').value=Math.floor(Math.random()*1e9);   // 随机种子开：每次开始换新种子
  const m=SIM.current; m.pauseOnFail=$('pofChk').checked; m.timeScale=parseFloat($('tsSel').value)||1; m.init(parseInt($('seedInp').value)||1); $('pauseBtn').textContent='暂停'; });
$('pauseBtn').addEventListener('click',e=>{ const m=SIM.current; if(m.phase!=='run') return; m.paused=!m.paused; e.target.textContent=m.paused?'继续':'暂停'; });
$('stepBtn').addEventListener('click',()=>{ const m=SIM.current; if(m.phase==='run'){ m.paused=false; m.t=m.subEnd; $('pauseBtn').textContent='暂停'; } });
$('reseedBtn').addEventListener('click',()=>{ $('seedInp').value=Math.floor(Math.random()*1e9); });
$('pofChk').addEventListener('change',e=>{ SIM.current.pauseOnFail=e.target.checked; });
$('tsSel').addEventListener('change',e=>{ SIM.current.timeScale=parseFloat(e.target.value)||1; });
// 机制下拉：按 group 分组(optgroup)填充 + 切换
(function(){ const sel=$('mechSel'), groups={}, gorder=[];
  SIM.order.forEach(m=>{ const g=m.group||'其它'; if(!groups[g]){ groups[g]=[]; gorder.push(g); } groups[g].push(m); });
  gorder.forEach(g=>{ const og=document.createElement('optgroup'); og.label=g;
    groups[g].forEach(m=>{ const o=document.createElement('option'); o.value=m.id; o.textContent=m.name; og.appendChild(o); });
    sel.appendChild(og); });
})();
$('mechSel').addEventListener('change',e=>SIM.select(e.target.value));
SIM.select(FORSAKEN.id);   // 启动默认机制（待命预览，点开始才运行）
$('moveSel').addEventListener('change',e=>{ moveMode=e.target.value; });   // 传统/现代 移动模式
function syncSeedLock(){ const on=$('randSeed').checked; $('seedInp').disabled=on; $('reseedBtn').disabled=on; }   // 随机种子开 → 锁定种子输入框
$('randSeed').addEventListener('change',syncSeedLock); syncSeedLock();
function resize(){
  cssW=window.innerWidth||document.documentElement.clientWidth||1280;
  cssH=window.innerHeight||document.documentElement.clientHeight||720;
  const dpr=Math.min(devicePixelRatio||1, 2);
  glc.width=Math.round(cssW*dpr); glc.height=Math.round(cssH*dpr); glc.style.width=cssW+'px'; glc.style.height=cssH+'px';
  oc.width=Math.round(cssW*dpr); oc.height=Math.round(cssH*dpr); oc.style.width=cssW+'px'; oc.style.height=cssH+'px';
  octx.setTransform(dpr,0,0,dpr,0,0);
}
addEventListener('resize',resize); resize();

let last=performance.now();
function frame(now){
  const dt=clamp((now-last)/1000, 0, 0.05); last=now;
  // 视口拿到真实尺寸后自动校正（应对预览环境初始 0 尺寸）
  if((window.innerWidth&&window.innerWidth!==cssW)||(window.innerHeight&&window.innerHeight!==cssH)) resize();
  pollGamepad(dt);
  updatePlayer(dt);
  tickKB(dt*((SIM.current&&SIM.current.timeScale)||1));   // 击退平滑推进(随机制速度缩放)
  if(Scene.onTick) Scene.onTick(dt);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
