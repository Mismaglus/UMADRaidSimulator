"use strict";
/* core/render.js — 渲染器 + 2D 叠加(场地标点/头顶点名/小队列表/读条) */
/* ==11 RENDERER== 每帧绘制 */
function render(){
  const eye=camEye();
  const view=mLookAt(eye,cam.target,UP);
  const proj=mPerspective(d2r(CAM.fov), cssW/cssH, CAM.near, CAM.far);
  const VP=mMul(proj,view);

  gl.viewport(0,0,glc.width,glc.height);
  gl.clearColor(0.055,0.065,0.085,1);
  gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);

  // 地面 + 网格（按当前机制场地半径 ARENA_R 缩放单位网格）
  gl.depthMask(true);
  const FM=mModel(0,0,0,0,ARENA_R,1,ARENA_R);
  drawMesh(meshes.disc, mMul(VP,FM), COL.ground, 1);
  drawMesh(meshes.grid, mMul(VP,FM), COL.grid, 0.5);
  // 边缘亮环
  drawMesh(meshes.annulus, mMul(VP, mModel(0,0.013,0,0,ARENA_R,1,ARENA_R)), [0.55,0.62,0.72], 0.8);
  // 场地标点不画地面环，改为 overlay 里的立体字母（见 drawOverlay）

  // 贴花（不写深度，按顺序混合）
  gl.depthMask(false);
  for(const d of Scene.getDecals()){
    const st=DECAL_STYLE[d.type]; if(!st) continue;
    const r=d.radius||3, sc=st.thin? r : r;
    const M=mModel(d.x, st.y, d.z, d.facing||0, r, 1, r);
    drawMesh(meshes[st.mesh], mMul(VP,M), d.color||st.color, d.alpha!=null?d.alpha:st.alpha);
  }
  // 机制专属"地面层"特效（不写深度，混合）：如 Forsaken 开场紫色冲击波
  if(SIM.current && SIM.current.drawGround) SIM.current.drawGround(VP);
  // 被控职能脚下高亮环
  const me=Scene.get(humanRole);
  if(me){ drawMesh(meshes.annulus, mMul(VP, mModel(me.pos[0],0.05,me.pos[1],0,1.1,1,1.1)), COL.self, 0.9); }

  // 演员（不透明先画，半透明克隆后画）
  gl.depthMask(true);
  for(const a of Scene.list()){ if((a.alpha==null||a.alpha>=1)) drawActor(VP,a); }
  if(me){ const fnx=Math.sin(playerFacing), fnz=Math.cos(playerFacing);   // 被控职能"朝向鼻子"：现代朝镜头/传统朝移动方向
    drawMesh(meshes.sphere, mMul(VP, mModel(me.pos[0]+fnx*0.85, 1.25, me.pos[1]+fnz*0.85, 0, 0.34,0.34,0.34)), COL.self, 1); }
  // 机制专属"空中层"特效（写深度，在不透明演员之后）：如 Forsaken 踩塔倒计时光球
  if(SIM.current && SIM.current.drawAir) SIM.current.drawAir(VP);
  gl.depthMask(false);
  for(const a of Scene.list()){ if(a.alpha!=null&&a.alpha<1) drawActor(VP,a); }
  gl.depthMask(true);

  drawOverlay(VP);
}
function drawActor(VP,a){
  const M=mModel(a.pos[0],0,a.pos[1],0, a.radius,a.height,a.radius);
  drawMesh(meshes.cyl, mMul(VP,M), a.color, a.alpha==null?1:a.alpha);
}
function drawOverlay(VP){
  octx.clearRect(0,0,cssW,cssH);
  // 开场 AOE 不再全屏闪（改为 render() 里从 boss 扩散的紫圈）
  // 场地标点：立体字母/数字（始终朝向镜头，按距离缩放，带挤出阴影）
  octx.textAlign='center'; octx.textBaseline='middle';
  for(const w of WAYMARKS){
    const wx=w.dir[0]*ARENA_R*0.92, wz=w.dir[1]*ARENA_R*0.92;
    const pB=projHead(VP, wx,0.3,wz), pT=projHead(VP, wx,3.9,wz); if(!pB||!pT) continue;
    const px=Math.hypot(pT[0]-pB[0], pT[1]-pB[1]); if(px<7) continue;          // 世界高 3.6m 投到屏幕的像素 = 字号
    const cx=(pB[0]+pT[0])/2, cy=(pB[1]+pT[1])/2, ext=Math.max(1, Math.round(px*0.07));
    octx.font='900 '+px.toFixed(0)+'px system-ui,sans-serif';
    octx.fillStyle='rgba(0,0,0,0.5)'; for(let k=ext;k>0;k--) octx.fillText(w.label, cx+k*0.7, cy+k*0.8);   // 挤出感
    octx.lineWidth=Math.max(2, px*0.05); octx.strokeStyle='rgba(0,0,0,0.9)'; octx.strokeText(w.label, cx, cy);
    octx.fillStyle='rgb('+w.color.map(c=>(c*255)|0).join(',')+')'; octx.fillText(w.label, cx, cy);
  }
  // 头顶职能文字 + 点名标记
  octx.textAlign='center'; octx.textBaseline='bottom'; octx.font='bold 13px system-ui,sans-serif';
  for(const a of Scene.list()){
    if(a.kind==='clone' || !a.role) continue;
    const s=projHead(VP, a.pos[0], a.height+0.7, a.pos[1]);
    if(s){ octx.lineWidth=3; octx.strokeStyle='rgba(0,0,0,0.85)'; octx.strokeText(a.role,s[0],s[1]);
      octx.fillStyle = a.role===humanRole? '#ffe27a' : '#ffffff'; octx.fillText(a.role,s[0],s[1]); }
    if(a.marker){ const m=projHead(VP, a.pos[0], a.height+3.4, a.pos[1]); if(m) drawMarker(octx, m[0], m[1], a.marker, a.markerColor); }   // 图标放大后抬高一点,避免压住职能名
  }
  // 机制专属 2D 叠加（如 Forsaken 的 boss 读条/顶端读条）
  if(SIM.current && SIM.current.drawHud) SIM.current.drawHud(octx, VP);
  // 通用小队列表（右侧, 垂直居中, 全机制共享）
  drawPartyList();
  // HUD（右上）
  octx.textAlign='right'; octx.textBaseline='top'; octx.font='12px ui-monospace,monospace'; octx.fillStyle='#9fb3c8';
  let y=10; for(const line of Scene.getHUD()){ octx.fillText(line, cssW-12, y); y+=16; }
}
/* 通用小队列表（右侧）：8 行 MT ST H1 H2 D1 D2 D3 D4，每行=职能色块+名+buff栏；buff 经 SIM.current.buffsOf(role) 读取(可选接口) */
function drawPartyList(){
  const PO=['MT','ST','H1','H2','D1','D2','D3','D4'];
  const rh=clamp(cssH*0.045, 22, 34), gap=Math.max(2,rh*0.12), nameW=rh*1.7;   // 行高随屏幕缩放
  const rowW=clamp(cssH*0.30, 170, 260), bh=rh-gap, by=rh+(rh-bh)/2;
  const totalH=PO.length*rh, x0=cssW-rowW-10, y0=(cssH-totalH)/2;   // 贴右边、垂直居中(避开右上 HUD)
  const cur = (SIM.current && SIM.current.buffsOf) ? SIM.current.buffsOf.bind(SIM.current) : null;
  octx.save();
  // 整体半透明底板
  octx.fillStyle='rgba(12,15,22,0.55)'; octx.fillRect(x0-4, y0-4, rowW+8, totalH+8);
  for(let i=0;i<PO.length;i++){
    const role=PO[i], y=y0+i*rh, c=roleColor(role), self=(role===humanRole);
    if(self){ octx.fillStyle='rgba(255,226,122,0.22)'; octx.fillRect(x0-4, y, rowW+8, rh); }   // 高亮被控职能行
    octx.fillStyle='rgba(20,24,32,0.66)'; octx.fillRect(x0, y+1, rowW, rh-2);
    // 职能色块
    const sw=rh*0.5, sx=x0+rh*0.22, sy=y+(rh-sw)/2;
    octx.fillStyle='rgb('+c.map(v=>(v*255)|0).join(',')+')'; octx.fillRect(sx, sy, sw, sw);
    octx.lineWidth=1; octx.strokeStyle='rgba(0,0,0,0.55)'; octx.strokeRect(sx+0.5, sy+0.5, sw-1, sw-1);
    // 职能名
    octx.textAlign='left'; octx.textBaseline='middle'; octx.font='bold '+(rh*0.42|0)+'px system-ui,sans-serif';
    octx.fillStyle = self?'#ffe27a':'#dde6f0'; octx.fillText(role, sx+sw+rh*0.22, y+rh/2);
    // buff 栏（右侧）：小色块 + 剩余秒
    const buffs=cur?(cur(role)||[]):[]; const bs=rh-gap*2; let bx=x0+nameW+rh*0.4;
    for(let k=0;k<buffs.length && bx+bs<=x0+rowW-3; k++){ const bf=buffs[k], col=bf.color||[0.8,0.8,0.8];
      octx.fillStyle='rgb('+col.map(v=>clamp(v,0,1)*255|0).join(',')+')'; octx.fillRect(bx, y+gap, bs, bs);
      octx.lineWidth=1; octx.strokeStyle='rgba(0,0,0,0.6)'; octx.strokeRect(bx+0.5, y+gap+0.5, bs-1, bs-1);
      if(bf.label){ octx.textAlign='center'; octx.textBaseline='middle'; octx.font='bold '+(bs*0.5|0)+'px system-ui,sans-serif';
        octx.lineWidth=2.4; octx.strokeStyle='rgba(0,0,0,0.85)'; octx.strokeText(bf.label, bx+bs/2, y+gap+bs*0.42);
        octx.fillStyle='#fff'; octx.fillText(bf.label, bx+bs/2, y+gap+bs*0.42); }
      if(bf.rem!=null){ const rt=bf.rem.toFixed(bf.rem<10?1:0); octx.textAlign='center'; octx.textBaseline='alphabetic'; octx.font='bold '+(bs*0.42|0)+'px ui-monospace,monospace';
        octx.lineWidth=2.4; octx.strokeStyle='rgba(0,0,0,0.9)'; octx.strokeText(rt, bx+bs/2, y+gap+bs-1.5);
        octx.fillStyle='#ffe9a8'; octx.fillText(rt, bx+bs/2, y+gap+bs-1.5); }
      bx+=bs+3; }
  }
  octx.restore();
}
/* 头顶点名图标（2D 叠加层 = 始终面向镜头）：分摊=四角星 / 扇形=尖端朝下扇 / 钢铁=环+心点 */
function drawMarker(ctx,x,y,shape,mode){
  const col = '#f2cf3a';   // 头顶点名全程黄色(不再随刷新变蓝、不再让扇/摊用棕色)
  ctx.save(); ctx.translate(x,y);
  const g = shape==='cone' ? 3.0 : 1.5;   // 头顶机制图标整体放大1.5×；扇形再翻倍(≈3×)
  ctx.scale(g,g);
  ctx.lineWidth=2; ctx.strokeStyle='rgba(0,0,0,0.6)';
  if(shape==='stack'){           // 分摊：上下左右四个 >> 朝内，组成十字
    ctx.strokeStyle=col; ctx.lineWidth=2.8; ctx.lineCap='round'; ctx.lineJoin='round';
    for(let k=0;k<4;k++){ ctx.save(); ctx.rotate(k*Math.PI/2);
      for(const o of [0, 5.5]){ const tip=4.5+o, base=10+o, s=6.2;   // 两层(>>)，尖端朝中心
        ctx.beginPath(); ctx.moveTo(-s,-base); ctx.lineTo(0,-tip); ctx.lineTo(s,-base); ctx.stroke(); }
      ctx.restore(); }
  } else if(shape==='cone'){
    ctx.beginPath(); ctx.moveTo(0,11); ctx.lineTo(-10,-5); ctx.quadraticCurveTo(0,-12,10,-5); ctx.closePath(); ctx.fillStyle=col; ctx.fill(); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(0,0,10,0,TAU); ctx.lineWidth=3.4; ctx.strokeStyle=col; ctx.stroke();
    ctx.beginPath(); ctx.arc(0,0,3.4,0,TAU); ctx.fillStyle=col; ctx.fill();
  }
  ctx.restore();
}

/* 读条进度条（boss 头顶 + 屏幕顶端复用）：标题(日+英) / 进度填充 / 剩余秒 */
function drawCastBar(cx, yb, bw, bh, jp, en, col, prog, rem){
  const x=cx-bw/2;
  octx.textAlign='center'; octx.textBaseline='bottom'; octx.font='bold '+(bh+2)+'px system-ui,sans-serif';
  octx.lineWidth=4; octx.strokeStyle='rgba(0,0,0,0.92)'; octx.strokeText(jp+'　'+en, cx, yb-5);
  octx.fillStyle='#fff'; octx.fillText(jp+'　'+en, cx, yb-5);
  octx.fillStyle='rgba(0,0,0,0.55)'; octx.fillRect(x-2,yb-2,bw+4,bh+4);
  octx.fillStyle='rgba(28,28,38,0.95)'; octx.fillRect(x,yb,bw,bh);
  octx.fillStyle=col; octx.fillRect(x,yb,bw*prog,bh);
  octx.lineWidth=2; octx.strokeStyle='rgba(255,255,255,0.75)'; octx.strokeRect(x,yb,bw,bh);
  octx.textBaseline='middle'; octx.font='bold '+((bh*0.7)|0)+'px ui-monospace,monospace'; octx.fillStyle='#fff';
  octx.fillText(rem.toFixed(1), cx, yb+bh/2+0.5);
}

