/** Original teaching traffic fit-out. Canonical metres: x longitudinal, y transverse, z up.
 * Corridors are continuous observation envelopes, not certification of code compliance.
 * Furniture and illustrated vehicles are excluded from the analytical member inventory.
 */
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const mul=(v,s)=>v.map(x=>x*s);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const norm=v=>mul(v,1/Math.hypot(...v));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);

export function deckFrame(model,x,offset=0,lift=0){
 const points=model.deckPath;
 let i=points.findIndex(p=>p[0]>=x);if(i<0)i=points.length-1;else if(i===0)i=1;
 const a=points[i-1],b=points[i],t=Math.max(0,Math.min(1,(x-a[0])/(b[0]-a[0]))),c=mix(a,b,t),axis=norm(sub(b,a));
 const normal=norm([-axis[1],axis[0],0]);
 return {point:add(add(c,mul(normal,offset)),[0,0,lift]),axis,normal,heading:Math.atan2(axis[1],axis[0])};
}
function line(model,offset,lift=0,step=1){
 const n=Math.max(2,Math.ceil(model.length/step));
 return Array.from({length:n+1},(_,i)=>deckFrame(model,(i/n-.5)*model.length,offset,lift).point);
}
function walkway(model,id,offset,width,lift=0){return{id,label:offset===0?'连续人行净空':offset<0?'左侧连续人行净空':'右侧连续人行净空',offset,width,height:2.2,surfaceLift:lift,centerline:line(model,offset,lift),evidenceType:'teaching_observation_envelope'};}

export function decorateMobility(model){
 if(model.mobility)return model;
 const road=model.id==='stayed_standard',last=model.stages.length-1;
 const box=(id,label,material,center,size,extra={})=>model.parts.push({id:`traffic-${id}`,label,category:'road-furniture',material,stage:last,shape:'box',center,size,...extra});
 const tube=(id,label,material,points,radius)=>model.parts.push({id:`traffic-${id}`,label,category:'road-furniture',material,stage:last,shape:'tube',points,radius});
 function strip(id,label,material,offset,width,lift,thickness,x0=-model.length/2,x1=model.length/2){
  const n=Math.max(1,Math.ceil((x1-x0)/3));
  for(let i=0;i<n;i++){const xa=x0+(x1-x0)*i/n,xb=x0+(x1-x0)*(i+1)/n,a=deckFrame(model,xa,offset,lift-thickness/2).point,b=deckFrame(model,xb,offset,lift-thickness/2).point;
   box(`${id}-${i}`,label,material,mix(a,b,.5),[Math.hypot(...sub(b,a))+.005,width,thickness],{axis:norm(sub(b,a))});}
 }
 let walkways;
 if(road){
  if(Math.abs(model.width-14)>1e-6)throw new Error('Road teaching section requires the agreed 14 m deck width.');
  walkways=[walkway(model,'walk-left',-4.2,1.75,.14),walkway(model,'walk-right',4.2,1.75,.14)];
  // 6.00 carriageway + 2 × (0.325 separator + 1.75 sidewalk + 1.925 services) = 14.00 m.
  model.transverseBudget={leftServices:1.925,leftWalk:1.75,leftSeparator:.325,carriageway:6,rightSeparator:.325,rightWalk:1.75,rightServices:1.925,total:14};
  strip('asphalt','沥青铺装 / 双向两车道','asphalt',0,6,.018,.018);
  for(const side of [-1,1]){
   strip(`sidewalk-${side}`,'抬高人行道 / 1.75 m 连续净宽','paving',side*4.2,1.75,.14,.14);
   strip(`curb-inner-${side}`,'人行道内侧路缘石','curb',side*3.2,.24,.18,.18);
   strip(`curb-outer-${side}`,'人行道外侧路缘石','curb',side*5.20,.24,.18,.18);
   strip(`edge-line-${side}`,'车行道边缘实线','marking',side*2.86,.12,.024,.006);
   tube(`barrier-${side}`,'车行道与人行道分隔防撞横梁（外形示意）','barrier',line(model,side*3.16,.76,2),.095);
   tube(`barrier-low-${side}`,'防撞护栏下横梁（外形示意）','barrier',line(model,side*3.16,.48,2),.065);
   for(let x=-model.length/2+1;x<model.length/2;x+=3){const a=deckFrame(model,x,side*3.16,.17).point,b=add(a,[0,0,.68]);tube(`barrier-post-${side}-${x}`,'防撞护栏立柱','barrier',[a,b],.060);}
   // Lamp poles are outside the clear sidewalk, and away from tower stations.
   let j=0;for(let x=-model.length/2+12;x<model.length/2-6;x+=24){if((model.spanArrangement||[]).length===3&&Math.abs(Math.abs(x)-model.span/2)<4)continue;
    const f=deckFrame(model,x,side*5.52,.16),base=f.point,top=add(base,[0,0,5.2]),tip=add(top,mul(f.normal,-side*.70));
    tube(`lamp-pole-${side}-${j}`,'人行道外侧路灯杆','lamp',[base,top],.065);tube(`lamp-arm-${side}-${j}`,'路灯悬臂','lamp',[top,tip],.045);
    box(`lamp-head-${side}-${j}`,'道路照明灯头','lamp',add(tip,[0,0,-.06]),[.74,.30,.13],{axis:f.axis});
    box(`lamp-emitter-${side}-${j}`,'灯头发光面','lampGlow',add(tip,[0,0,-.13]),[.60,.23,.015],{axis:f.axis});j++;
   }
  }
  for(let x=-model.length/2+1;x<model.length/2-1;x+=7)strip(`centerline-${x}`,'双向车道中心虚线','marking',0,.12,.024,.006,x,Math.min(x+3,model.length/2-1));
 }else{
  if(model.id==='stayed_single')walkways=[walkway(model,'walk-left',-1.78,1.50),walkway(model,'walk-right',1.78,1.50)];
  else if(model.id==='stayed_spatial')walkways=[walkway(model,'walk-main',.55,3.0)];
  else if(model.id==='arch_inclined')walkways=[walkway(model,'walk-main',-.40,2.60)];
  else {
   const widths={stayed_fan:5.4,stayed_harp:5.4,extradosed:5.4,arch_basket:4.7,arch_network:4.7,suspension_ground:4.8,suspension_self:4.7,suspension_inclined:4.8,fink_inverted:4.3,hybrid_cable:5.8,stress_ribbon:2.2,millennium_low:3.2,underslung_suspension:3.4};
   walkways=[walkway(model,'walk-main',0,widths[model.id]??Math.max(1.5,model.width-1.5))];
  }
 }
 const vehicles=road?[-.34,-.09,.20,.39].map((u,i)=>{
  const direction=i%2?1:-1,laneOffset=direction===1?-1.5:1.5,f=deckFrame(model,u*model.length,laneOffset,.018);
  return{id:`vehicle-${i}`,label:'原创小客车 · 外廓 4.50 × 1.80 × 1.45 m',position:f.point,heading:f.heading+(direction<0?Math.PI:0),direction,laneOffset,length:4.50,width:1.80,height:1.45,wheelbase:2.65,speedMps:7.5,color:['#cf584a','#3d7891','#e5dcc8','#5c7870'][i],evidenceType:'teaching_assumption',isLoadCase:false};
 }):[];
 model.mobility={use:road?'road':'pedestrian',walkways,lanes:road?[-1,1].map(s=>({id:`lane-${s}`,offset:s*1.5,width:3,direction:-s,centerline:line(model,s*1.5,.018)})):[],vehicles,transverseBudget:model.transverseBudget,personHeight:1.75,clearanceHeight:2.2,surfaceConvention:'人物及车辆 position 为脚底或轮胎接触面；包络由该通行面竖向上延。',scope:'连续通行包络用于观察结构侵入，宽度与净高为本教学布置假设；不是规范符合性、无障碍或交通安全验收。'};
 const count=Math.max(7,Math.min(14,Math.round(model.length/12)));
 model.people=Array.from({length:count},(_,i)=>{
  const w=walkways[i%walkways.length],x=-model.length*.43+model.length*.86*i/(count-1),offset=w.offset+(walkways.length===1?(i%2?.27:-.27):0),f=deckFrame(model,x,offset,w.surfaceLift),direction=i%2?1:-1;
  return{id:`person-${i}`,position:f.point,height:1.75,uniformScale:1,heading:f.heading+(direction<0?Math.PI:0),role:'1.75 m 人物尺度参照',walkwayId:w.id,style:i%3};
 });
 model.assumptions=model.assumptions.filter(s=>!/人物统一高|人行展示横断面/.test(s));
 model.assumptions.push('人物为原创圆润动漫风尺度参照，脚底至最高发顶严格 1.75 m，不单独放大。',model.mobility.scope);
 if(road)model.assumptions.push('本例采用14 m教学车行横断面：双向两条3.00 m车道，两条1.75 m连续人行道，余宽用于分隔护栏、路缘石、路灯与索塔锚固设备带；小客车和防撞护栏仅为外形及尺度示意，不作为计算荷载或碰撞性能设计。');
 model.display={...(model.display||{}),personHeight:1.75};
 return model;
}

function bounds(points){return{min:[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max:[0,1,2].map(k=>Math.max(...points.map(p=>p[k])))};}
function boxCorners(p){const x=p.axis?norm(p.axis):[1,0,0],y=norm([-x[1],x[0],0]),z=cross(x,y),out=[];for(const a of [-1,1])for(const b of [-1,1])for(const c of [-1,1])out.push(add(p.center,add(add(mul(x,a*p.size[0]/2),mul(y,b*p.size[1]/2)),mul(z,c*p.size[2]/2))));return out;}
function intersects(a,b,lo,hi){let t0=0,t1=1;for(let k=0;k<3;k++){const d=b[k]-a[k];if(Math.abs(d)<1e-10){if(a[k]<lo[k]||a[k]>hi[k])return false;}else{let u=(lo[k]-a[k])/d,v=(hi[k]-a[k])/d;if(u>v)[u,v]=[v,u];t0=Math.max(t0,u);t1=Math.min(t1,v);if(t0>t1)return false;}}return true;}

/** Conservative piecewise-prism check. Tubes use exact segment/prism clipping after
 * radius inflation; boxes use transformed bounding boxes, which can over-report a
 * grazing rotated box. Final-stage structure only. Not an engineering clearance certificate. */
export function auditMobility(model){
 const issues=[],allowed=new Set(['tower','cable','hanger','arch','anchor','bracing','pier','railing','road-furniture']);
 const candidates=model.parts.filter(p=>allowed.has(p.category)&&p.stage<=model.stages.length-1&&(p.temporaryUntil==null||p.temporaryUntil>=model.stages.length-1));
 const prepared=candidates.map(p=>({p,corners:p.shape==='box'?boxCorners(p):null}));
 for(const w of model.mobility.walkways){const hitIds=new Map();
  for(let i=0;i<w.centerline.length-1;i++){
   const a=w.centerline[i],b=w.centerline[i+1],horizontal=Math.hypot(b[0]-a[0],b[1]-a[1]);if(horizontal<1e-8)continue;
   const ex=[(b[0]-a[0])/horizontal,(b[1]-a[1])/horizontal,0],ey=[-ex[1],ex[0],0],slope=(b[2]-a[2])/horizontal;
   const tf=p=>{const q=sub(p,a),u=dot(q,ex);return[u,dot(q,ey),q[2]-u*slope];};
   const low=[0,-w.width/2,.055],high=[horizontal,w.width/2,w.height];
   for(const {p,corners} of prepared){if(hitIds.has(p.id))continue;let collision=false;
    if(corners){const bb=bounds(corners.map(tf));collision=bb.min.every((v,k)=>v<high[k]-1e-6&&bb.max[k]>low[k]+1e-6);}
    else if(p.points){const radius=p.radius||0,lo=low.map(v=>v-radius),hi=high.map(v=>v+radius);for(let j=0;j<p.points.length-1&&!collision;j++)collision=intersects(tf(p.points[j]),tf(p.points[j+1]),lo,hi);}
    if(collision)hitIds.set(p.id,{walkwayId:w.id,partId:p.id,label:p.label,category:p.category,stationX:Math.round(a[0]*100)/100});
   }
  }
  issues.push(...hitIds.values());
 }
 return{modelId:model.id,units:'m',method:'全程分段通行棱柱；圆管膨胀半径裁剪；箱体采用保守局部包围盒。',walkways:model.mobility.walkways.map(w=>({id:w.id,width:w.width,height:w.height,segments:w.centerline.length-1})),issues,pass:issues.length===0,limits:'只核教学模型成桥几何与设置的观察包络；未验无障碍、护栏性能、事故工况或规范符合性。'};
}
