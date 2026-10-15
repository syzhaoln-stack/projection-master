/** Canonical teaching geometry. Units m; x longitudinal, y transverse, z up.
 * No renderer, load result or presentation transform is stored in this module.
 * All configurations are original teaching variants, not as-built replicas.
 * stage is installation stage; temporaryUntil is the LAST inclusive visible stage.
 * box.axis is its local x axis; its local y axis is horizontal and perpendicular.
 */
import {decorateMobility} from './mobility.js';

export const parameterDefinitions={
 stayed_spatial:[
  {key:'towerAzimuthDeg',label:'倾塔方位角',unit:'°',min:140,max:220,step:1,default:150,description:'塔脚固定，倾斜方向绕竖向轴旋转；0°朝桥纵向+x，90°朝横向+y。'},
  {key:'towerInclinationDeg',label:'相对竖直倾角',unit:'°',min:8,max:16,step:1,default:12,description:'固定塔顶高程，改变塔顶水平偏移；范围为可观察的教学几何范围，非设计许可。'}
 ]
};
function readParameters(id,options){
 if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('参数须为键值对象');
 const defs=parameterDefinitions[id]||[],result={};
 for(const key of Object.keys(options))if(!defs.some(d=>d.key===key))throw new RangeError(`模型 ${id} 不支持参数 ${key}`);
 for(const d of defs){const v=Object.prototype.hasOwnProperty.call(options,d.key)?options[d.key]:d.default;if(typeof v!=='number'||!Number.isFinite(v)||v<d.min||v>d.max)throw new RangeError(`${d.label}须为 ${d.min} 至 ${d.max} ${d.unit} 的有限数值`);result[d.key]=v;}
 return result;
}

const commonAssumptions = [
  '原创参数化教学模型；来源用于结构概念比较，不是实桥竣工复刻。',
  '尺寸、截面、锚块、基础、材料外观均为教学假设，未进行承载力、稳定性或风振验算。',
  '施工为最终几何的安装与拆除过程示意；各阶段未求平衡索形、预应力及施工变形。',
  '人物统一高1.75 m，仅作真实比例参照；不代表人体标准值。',
  '按模型分别采用人行或车行教学横断面，交通空间仅作几何观察。人物、结构与背景统一米制，不放大人物或索径。'
];
const P=(id,title,family,subtitle,span,width,height,question,loadPath,sourceIds,extra={})=>({id,title,family,subtitle,span,width,height,question,loadPath,sourceIds,assumptions:[...commonAssumptions],...extra});
export const presets = [
 P('girder_reference','梁桥 · 受弯基准','梁桥','简支箱梁 / 从板到梁',24,6,1.2,'没有拉索与拱，跨中的荷载通过什么传到两端？','桥面板 → 封闭箱梁 → 两端支承 → 基础',['cTxm8Y17AWLytFL44JkEBq-M01']),
 P('girder_tree','树形支承梁桥','梁桥','两级分叉 / 空间树状桥墩',36,6,12,'一根主干分成多根枝杈后，荷载在哪里汇合？分叉节点为何重要？','桥面板 → 箱梁 → 枝端支座 → 次级枝杈 → 主分叉 → 树干 → 基础',['v2-tree-sbp']),
 P('stayed_standard','双塔双索面斜拉桥','斜拉桥','半扇形索 / 梁、索、塔协同',120,14,32,'拉索增加后，主梁为什么仍然不能删除？','桥面板 → 主梁与横梁 → 斜拉索 → 塔柱 → 基础',['cTxm8Y17AWLytFL44JkEBq-M97','cTxm8Y17AWLytFL44JkEBq-M100']),
 P('stayed_fan','扇形索斜拉桥','斜拉桥','塔顶集中锚区 / 与竖琴形同尺度',96,8,28,'跨径、塔高与索数相同，把塔端锚点收拢后，索的倾角如何变化？','桥面 → 锚固横梁 → 放射状斜拉索 → 塔顶独立锚具 → 索塔 → 基础',['2VH4JDmRRUTQVmnQu1hxuu']),
 P('stayed_harp','竖琴形索斜拉桥','斜拉桥','平行斜索 / 塔身分散锚固',96,8,28,'平行斜索在塔身逐级锚固，怎样改变塔柱各高度处的受力？','桥面 → 锚固横梁 → 平行斜拉索 → 塔身分散锚具 → 索塔 → 基础',['2VH4JDmRRUTQVmnQu1hxuu']),
 P('stayed_single','独塔倾塔 · 单索面','斜拉桥','中央索面 / 轴压与弯扭',60,6,36,'将两片索面合并到中央，谁来抵抗偏载扭转？','桥面 → 抗扭箱梁 → 中央索面 → 倾塔与边跨 → 基础',['cTxm8Y17AWLytFL44JkEBq-M98','2VH4JDmRRUTQVmnQu1hxuu-M16']),
 P('stayed_spatial','空间曲线斜拉桥','斜拉桥','曲线桥面 / 偏置塔与直线斜索',100,5.5,31,'桥面弯曲且塔偏向一侧时，竖向荷载为何同时引起扭转？','曲线桥面 → 空间箱梁 → 直线斜拉索 → 偏置塔及背索 → 基础',['cTxm8Y17AWLytFL44JkEBq-M102','2VH4JDmRRUTQVmnQu1hxuu-M16','gimsing-katsushika']),
 P('extradosed','矮塔部分斜拉桥','斜拉桥','低塔 / 深梁 / 塔梁固结示意',60,8,9,'塔变矮、索变平，梁需要承担怎样的变化？','桥面 → 深箱梁及部分斜拉索 → 塔梁墩固结区 → 基础',['cTxm8Y17AWLytFL44JkEBq-M99','cTxm8Y17AWLytFL44JkEBq-M122']),
 P('arch_basket','提篮拱桥','拱桥','双拱肋向内倾 / 顶部横联',80,7,18,'双拱肋向内倾后，横向联系怎样把两片拱变成空间体系？','桥面 → 吊杆 → 向内倾斜的双拱肋 → 系梁及端部支承',['cTxm8Y17AWLytFL44JkEBq-M67','cTxm8Y17AWLytFL44JkEBq-M93']),
 P('arch_inclined','单侧倾拱桥','拱桥','单拱肋 / 两侧空间吊杆',72,6.5,18,'一片倾斜拱如何托住整幅桥面？横向力由谁平衡？','桥面 → 两侧空间吊杆 → 倾斜拱肋 → 系梁及端横梁 → 支承',['cTxm8Y17AWLytFL44JkEBq-M74','diagonal-parameter-family']),
 P('arch_network','网状吊杆系杆拱','拱桥','交叉吊杆 / 拱—系杆共同工作',84,7,17,'交叉吊杆相对竖直吊杆，改变了哪些传力路径？','桥面 → 交叉受拉吊杆 → 双拱肋与系杆 → 端部支承',['cTxm8Y17AWLytFL44JkEBq-M89','7Gdua5q7a8eDfhLwkMzTJH:research-assembly']),
 P('suspension_ground','地锚式悬索桥','悬索桥','主缆 / 吊杆 / 大地锚',90,7,11.65,'主缆到桥的两端以后，水平拉力最终去了哪里？','桥面 → 加劲梁 → 吊杆 → 主缆 → 塔与地锚 → 地基',['L04','2VH4JDmRRUTQVmnQu1hxuu-M15']),
 P('suspension_self','自锚式悬索桥','悬索桥','主缆锚在梁端 / 梁受压',84,7,17.25,'不设置独立地锚，主缆的水平分力由什么构件闭合？','桥面 → 吊杆 → 主缆 → 梁端锚固 → 受压加劲梁及塔墩',['2VH4JDmRRUTQVmnQu1hxuu-M15']),
 P('suspension_inclined','倾斜索面悬索桥','悬索桥','外倾主缆平面 / 斜吊杆',90,7,11.65,'吊杆向外倾斜后，桥面横向分力如何传给横梁和两片索面？','桥面 → 加劲梁与横梁 → 外倾吊杆 → 连续主缆 → 索鞍、外倾塔及地锚',['gimsing-youngjong','v2-suspension-sbp']),
 P('underslung_suspension','下承悬索 · 立杆上托梁','悬索桥','桥面下的受拉索 / 受压撑杆',60,5.5,4.2,'主索移到桥面下方后，连接杆为什么由吊杆变为受压撑杆？','桥面 → 主梁与横梁 → 受压撑杆 → 下部悬索 → 梁端自锚与支承',['v3-underdeck-system']),
 P('millennium_low','伦敦千禧桥 · 低位侧索','悬索桥','八根侧索 / Y形支承 / 横向钢臂',144,4,2.3,'主索压低到桥面两侧，钢臂怎样把桥面荷载传向索与低塔？','桥面 → 横向钢臂 → 两侧八根主索 → Y形支承与端部锚固',['v3-millennium-foster','v3-millennium-arup']),
 P('stress_ribbon','应力带人行桥','悬索桥','双钢带 / 顺垂曲面 / 无高塔',50,3.4,0.9,'桥面本身随受拉带下垂时，端部锚固为什么特别重要？','分块桥面板 → 连续受拉钢带 → 两端锚碇 → 地基',['L02','cTxm8Y17AWLytFL44JkEBq-M135']),
 P('hybrid_cable','斜拉—悬索组合桥','组合桥','近塔斜索 + 中央悬吊区',120,8,14.65,'近塔由斜索支承、跨中由主缆支承，交接区需要协调什么？','近塔桥面 → 斜拉索；跨中桥面 → 吊杆与主缆；共同传到塔及锚碇',['cTxm8Y17AWLytFL44JkEBq-M02','gimsing-dischinger']),
 P('hybrid_arch','梁—拱组合桥','组合桥','上承式拱 / 连续梁 / 立柱',80,7,14,'桥面在拱上方时，为什么连接杆是立柱而不叫吊杆？','桥面 → 连续箱梁 → 拱上立柱 → 下部拱肋 → 拱座与地基',['L03','cTxm8Y17AWLytFL44JkEBq-M91']),
 P('fink_inverted','倒置芬克桥','组合桥','分级杆索教学变体 / 无连续上弦',72,6,13,'没有连续上弦，变高压杆与分级拉杆怎样把桥面荷载传回两端？','桥面下弦 → 分级杆索节点 → 受压竖杆与受拉斜杆 → 端部回锚和支承',['v2-fink-lds','v2-fink-istructe','v2-fink-haer'])
];

const lerp=(a,b,t)=>a+(b-a)*t;
const vadd=(a,b)=>a.map((v,i)=>v+b[i]);
const norm=v=>{const n=Math.hypot(...v);return v.map(x=>x/n)};
const sample=(fn,n=40)=>Array.from({length:n+1},(_,i)=>fn(i/n));
const near=(a,b)=>Math.abs(a-b)<1e-7;

export function buildModel(id, options={}) {
 const preset=presets.find(p=>p.id===id); if(!preset) throw new Error(`Unknown teaching model: ${id}`);
 const parameters=readParameters(id,options);
 const model={...preset,parameters,parameterSchema:parameterDefinitions[id]||[],revision:['stayed_standard','stayed_spatial','arch_basket','arch_network','arch_inclined','stress_ribbon','suspension_ground','suspension_self','suspension_inclined','hybrid_cable'].includes(id)?'2':'1',units:'m',axes:{x:'longitudinal',y:'transverse',z:'up'},length:0,deckZ:5,parts:[],members:[],panels:[],people:[],stages:[],assumptions:[...preset.assumptions],sourceIds:[...preset.sourceIds]};
 let auto=0;
 const box=(id,label,category,material,stage,center,size,extra={})=>{const p={id,label,category,material,stage,shape:'box',center,size,...extra};model.parts.push(p);return p;};
 const tube=(id,label,category,material,stage,points,radius,extra={})=>{const p={id,label,category,material,stage,shape:'tube',points,radius,...extra};model.parts.push(p);return p;};
 const member=(part,kind,points,extra={})=>{model.members.push({id:part.id,label:part.label,kind,points:points||part.points,category:part.category,stage:part.stage,...extra});return part;};
 const rod=(id,label,category,points,radius=.12,stage=2,kind='rod',material='steel',extra={})=>member(tube(id,label,category,material,stage,points,radius,extra),kind,points,extra);
 const anchor=(id,p,label='索端锚块',stage=2,size=.48)=>{
   const block=box(id,label,'anchor','steel',stage,p,[size,size,size]);
   if(/梁端索锚块|吊杆下锚|吊杆梁端锚/.test(label)){
    const bottom=model.deckZ-.08,top=Math.max(model.deckZ+.10,p[2]-size/2+.06),seatId=`${id}-seat`;
    box(seatId,'索锚短座 / 连至桥面横梁','anchor','steel',stage,[p[0],p[1],(bottom+top)/2],[size*1.16,size*1.16,top-bottom]);
    block.deckAttachment={surfaceZ:model.deckZ,seatId};
   }
   return block;
 };
 const stay=(id,a,b,stage=2,extra={})=>{
   const p=rod(id,'斜拉索','cable',[a,b],.044,stage,'cable','cable',extra);
   anchor(`${id}-deck-anchor`,a,'梁端索锚块',stage,.44); anchor(`${id}-tower-anchor`,b,'塔端索锚区',stage,.40);return p;
 };
 const support=(id,x,y,z,topZ,width=1.4,depth=1.8)=>{
   box(`${id}-foot`,'基础示意','pier','concrete',0,[x,y,z-.5],[width*2.1,depth*1.8,1]);
   box(id,'桥墩 / 桥台','pier','concrete',0,[x,y,(z+topZ)/2],[width,depth,topZ-z]);
   box(`${id}-bearing`,'支承块','anchor','steel',1,[x,y,topZ+.08],[width*.72,depth*.7,.16],{supportConnection:{pierId:id}});
 };
 const endSupports=(L,W,deckZ,depth=.9)=>[-1,1].forEach(s=>support(`abutment-${s}`,s*L/2,0,0,deckZ-depth-.08,1.8,W+1));
 const tempProp=(id,x,y,topZ,stage=1,until=3)=>{
   box(`${id}-base`,'临时支架基础','temporary','temporary',stage,[x,y,.20],[1.4,1.4,.4],{temporaryUntil:until});
   const p=tube(id,'临时支架 / 完成后拆除','temporary','temporary',stage,[[x,y,.4],[x,y,topZ]],.22,{temporaryUntil:until});
   tube(`${id}-brace`,'临时斜撑','temporary','temporary',stage,[[x-1,y,.4],[x,y,topZ*.72],[x+1,y,.4]],.06,{temporaryUntil:until});return p;
 };
 let path=(x,y=0)=>[x,y,model.deckZ];
 function deck(L,W,{depth=.9,thickness=.18,curveY=x=>0,curveZ=x=>model.deckZ,step=3,stageAt=x=>2,closed=true,ribbon=false}={}) {
  model.length=L;model.width=W;model.girderDepth=depth;model.deckThickness=thickness;
  const n=Math.ceil(L/step),dx=L/n,sideWidth=W-.8;
  path=(x,y=0)=>{const eps=.001,dy=(curveY(x+eps)-curveY(x-eps))/(2*eps),k=Math.sqrt(1+dy*dy);return[x-y*dy/k,curveY(x)+y/k,curveZ(x)];};
  model.deckPath=sample(t=>path((t-.5)*L),n);
  for(let i=0;i<n;i++){
   const xa=-L/2+i*dx,xb=xa+dx,x=(xa+xb)/2,a=path(xa),b=path(xb),axis=norm(b.map((v,k)=>v-a[k])),mid=a.map((v,k)=>(v+b[k])/2),length=Math.hypot(...b.map((v,k)=>v-a[k])),s=stageAt(x),tag=`deck-${String(i).padStart(3,'0')}`;
   const ey=norm([-axis[1],axis[0],0]),ez=[axis[1]*ey[2]-axis[2]*ey[1],axis[2]*ey[0]-axis[0]*ey[2],axis[0]*ey[1]-axis[1]*ey[0]],offset=(transverse,vertical)=>mid.map((v,k)=>v+ey[k]*transverse+ez[k]*vertical);
   box(tag,'桥面板','deck',ribbon?'concrete':'deck',s,offset(0,-thickness/2),[length+.015,W,thickness],{axis});
   model.panels.push({id:tag,label:'桥面板单元',corners:[path(xa,-W/2),path(xb,-W/2),path(xb,W/2),path(xa,W/2)],stage:s});
   if(closed){
    const bot=.12,web=.12,clear=depth-thickness-bot;
    box(`${tag}-bottom`,'箱梁底板','girder','steel',s,offset(0,-depth+bot/2),[length+.015,sideWidth,bot],{axis});
    [-1,1].forEach(side=>{
     const y=side*(sideWidth/2-web/2),p=box(`${tag}-web-${side}`,'箱梁腹板','girder','steel',s,offset(y,-thickness-clear/2),[length+.015,web,clear],{axis});
     member(p,'beam',[vadd(path(xa,y),[0,0,-depth/2]),vadd(path(xb,y),[0,0,-depth/2])]);
    });
   }
  }
  if(closed)for(let x=-L/2;x<=L/2+.01;x+=Math.max(4,L/18))rod(`crossbeam-${auto++}`,'箱梁横隔 / 锚固横梁','bracing',[vadd(path(x,-sideWidth/2),[0,0,-depth*.55]),vadd(path(x,sideWidth/2),[0,0,-depth*.55])],.14,stageAt(x),'beam');
  const railY=W/2-.10;
  const towerExclusions=['stayed_standard','stayed_fan','stayed_harp','extradosed','suspension_ground','suspension_self','suspension_inclined','hybrid_cable'].includes(id)?[-preset.span/2,preset.span/2]:[];
  const breaks=[-L/2,...towerExclusions.flatMap(x=>[x-.80,x+.80]),L/2];
  for(const s of [-1,1]){
   for(const z of [.48,1.1])for(let j=0;j<breaks.length-1;j+=2){const xa=breaks[j],xb=breaks[j+1];tube(`handrail-${s}-${z}-${j}`,'栏杆横杆 / 索塔处避让','railing','steel',4,sample(t=>vadd(path(lerp(xa,xb,t),s*railY),[0,0,z]),Math.max(2,Math.ceil((xb-xa)/dx))),.034);}
   for(let i=0;i<=n;i++){const x=-L/2+i*dx;if(towerExclusions.some(t=>Math.abs(x-t)<.8))continue;const p=path(x,s*railY);tube(`railpost-${s}-${i}`,'栏杆立柱','railing','steel',4,[p,vadd(p,[0,0,1.1])],.027);}
   for(const x of towerExclusions.flatMap(t=>[t-.8,t+.8])){const p=path(x,s*railY);tube(`railpost-tower-${s}-${x}`,'索塔旁收口栏杆柱','railing','steel',4,[p,vadd(p,[0,0,1.1])],.027);}
  }
  const humanCount=Math.max(7,Math.min(14,Math.round(L/12)));
  for(let i=0;i<humanCount;i++){
   let x=-L*.43+L*.86*i/(humanCount-1);if(id==='stayed_standard'&&Math.abs(Math.abs(x)-60)<3)x+=4;
   const y=(i%2?1:-1)*W*.255;
   model.people.push({id:`person-${i}`,position:path(x,y),height:1.75,uniformScale:1,role:'尺度参照',heading:(i%2?0:Math.PI)});
  }
  model.transverseBudget={leftEdge:.7,pedestrianSpace:W-1.4,rightEdge:.7,total:W};
 }
 function stages(type){
  const definitions={
   beam:[['基础与支承','完成两端基础及支承；示意位置不代表地基设计。'],['临时支架','支架先形成安装支承条件。'],['主梁与桥面','分段主梁和桥面在支架上安装。'],['连接与体系形成','完成连接并示意传力体系形成。'],['成桥与拆架','拆除临时支架，设置栏杆与铺装。']],
   stayed:[['基础与桥墩','形成永久塔基、桥墩及端部支承。'],['塔与起始梁段','架设索塔、塔旁梁段及临时稳定构件。'],['梁段与斜索成对安装','示意从塔旁向两侧发展；梁段与其斜索在同一步出现。'],['合龙与体系调整','补齐合龙段；未计算张拉顺序及施工线形。'],['成桥与临时件拆除','移除临时支撑与稳定索，完成栏杆和铺装。']],
   arch:[['端部基础与拱座','形成端部永久支承与拱脚区域。'],['支架与拱肋','临时支架先支承拱肋；本例展示支架拼装法。'],['桥面与连接杆','安装系梁、桥面及吊杆，或安装拱上立柱。'],['连接与荷载转移','拱、梁、连接件闭合后示意体系转换。'],['拆除支架与成桥','临时支架拆除；这是安装逻辑而非阶段平衡验算。']],
   suspension:[['基础、塔墩与锚固区','完成塔墩、桥台以及地锚或梁端锚固准备。'],['塔与主缆准备','完成塔柱，示意猫道及主缆安装。'],['吊杆与加劲梁','主缆体系形成后分段安装吊杆和加劲梁。'],['合龙与调整','完成中央梁段与连接，示意线形和索力调整。'],['拆除猫道与成桥','完成铺装、栏杆，移除临时安装设施。']],
   self:[['基础与永久支承','完成桥墩及端部支承。'],['支架与桥塔','布置临时支架，为先梁后缆提供支承。'],['加劲梁安装','加劲梁在支架上形成连续的受压传力路径。'],['主缆、吊杆与体系转换','主缆锚入梁端；连接吊杆后示意卸架转移荷载。'],['拆架与成桥','拆除支架，主缆水平分力由梁端与加劲梁闭合。']],
   ribbon:[['锚碇及临时工作支架','完成两端锚固区；基础外形仅作示意。'],['架设双钢带','连续钢带跨越桥孔并锚入两端锚碇。'],['安装分块桥面','桥面分块安装，几何采用最终顺垂线形。'],['连接与张拉示意','连接、张拉、线形调整均为过程标签，未求索形。'],['栏杆与成桥','拆除临时工作件，设置人物展示真实尺度。']]
  };
  model.stages=definitions[type].map(([title,text],i)=>({id:i,title,text,prerequisite:i?i-1:null,evidenceType:'teaching_assumption'}));
 }

 if(id==='girder_reference'){
  model.deckZ=5;deck(24,6,{depth:1.2,stageAt:()=>2});endSupports(24,6,5,1.2);[-8,0,8].forEach((x,i)=>tempProp(`falsework-${i}`,x,0,3.8));stages('beam');
  model.parts.filter(p=>p.category==='deck').forEach(p=>{p.material='steel';p.label='钢桥面顶板（计入等效截面）';});
  model.members.push({id:'equivalent-main-beam',label:'等效全截面主梁中心线（示意轴）',kind:'beam',points:[[-12,0,4.4],[12,0,4.4]],category:'girder',stage:2,partIds:model.parts.filter(p=>p.category==='girder'||p.category==='deck').map(p=>p.id)});
  model.analysis={type:'simply-supported-beam',memberId:'equivalent-main-beam',span:24,baselineZ:4.4,section:{topWidth:6,topThickness:.18,bottomWidth:5.2,bottomThickness:.12,webThickness:.12,webClearHeight:.9,totalDepth:1.2},description:'同种材料全钢、等截面简支箱梁的线弹性教学等效；不含铺装参与、局部板弯曲、畸变、剪切滞或稳定问题。'};
  model.assumptions.push('解析基准梁采用同种材料全钢教学等效截面：顶板6×0.18 m，底板5.2×0.12 m，双腹板0.12×0.90 m；此厚板截面用于演示公式，不是实际桥梁经济设计。');
 }
 if(id==='girder_tree'){
  const L=72,W=6,depth=1.15,deckZ=12,tipZ=deckZ-depth-.15;
  model.deckZ=deckZ;model.spanArrangement=[18,36,18];
  deck(L,W,{depth,stageAt:()=>2});endSupports(L,W,deckZ,depth);stages('beam');
  model.stages[1].title='树干、分叉与安装支架';model.stages[1].text='先形成基础、树干与两级分叉，并布置临时安装支架；节点刚度和稳定另需验算。';
  const treeNodes=[],treeConnections=[];
  for(const s of [-1,1]){
   const tx=s*18,root=[tx,0,4.8],trunkId=`tree-trunk-${s}`;
   box(`tree-foundation-${s}`,'树形桥墩基础','pier','concrete',0,[tx,0,-.15],[4.4,4.4,1.1]);
   rod(trunkId,'树形墩主干','pier',[[tx,0,.4],root],.60,1,'beam','concrete');
   anchor(`tree-root-node-${s}`,root,'主干分叉刚接节点（示意）',1,1.05);treeNodes.push({id:`root-${s}`,point:root,level:0});
   for(const d of [-1,1]){
    const fork=[tx+d*6,0,8.0],forkId=`tree-primary-${s}-${d}`;
    rod(forkId,'一级纵向分叉','pier',[root,fork],.36,1,'beam','steel');
    anchor(`tree-fork-node-${s}-${d}`,fork,'二级分叉刚接节点（示意）',1,.70);treeNodes.push({id:`fork-${s}-${d}`,point:fork,level:1});
    treeConnections.push({from:trunkId,to:forkId,point:root});
    for(const dx of [-1,1])for(const dy of [-1,1]){
     const tip=[fork[0]+dx*2.5,dy*2.35,tipZ],branchId=`tree-branch-${s}-${d}-${dx}-${dy}`;
     rod(branchId,'二级空间枝杈','pier',[fork,tip],.20,1,'beam','steel');
     box(`${branchId}-bearing`,'枝端支座 / 接箱梁底','anchor','steel',2,[tip[0],tip[1],tipZ+.075],[.80,.65,.15],{branchConnection:{branchId,point:tip,deckBottomZ:deckZ-depth}});
     treeNodes.push({id:`tip-${s}-${d}-${dx}-${dy}`,point:tip,level:2});treeConnections.push({from:forkId,to:branchId,point:fork});
    }
   }
  }
  for(const x of [-30,-6,6,30])tempProp(`tree-falsework-${x}`,x,0,deckZ-depth,1,3);
  model.geometryContract={type:'tree-supported-girder',branchLevels:2,treeCount:2,tipBearingCount:16,nodes:treeNodes,connections:treeConnections,deckBottomZ:deckZ-depth,spanDefinition:'18+36+18 m 按桥台和树干轴线计；实际梁底支承是另列的16个枝端支座，不等同于三个简支跨。'};
  model.assumptions.push('树形模型为两棵树状桥墩，每棵主干分成两个纵向枝，再分成八个空间枝端；各枝端均通过实体支座接至箱梁底板。','主分叉作为刚接传力节点展示；未据形态自动假定为铰接桁架，也未求节点应力或屈曲承载力。');
 }
 if(id==='stayed_fan'||id==='stayed_harp'){
  const fan=id==='stayed_fan',main=96,side=48,L=192,W=8,H=28,depth=1.30,cy=3.50,deckZ=7,anchorZ=deckZ+.30,n=7,spacing=6,towerOffset=.46;
  model.deckZ=deckZ;model.spanArrangement=[side,main,side];
  const stageAt=x=>Math.min(...[-main/2,main/2].map(t=>Math.abs(x-t)))<5?1:(Math.abs(x)<5||Math.abs(x)>L/2-5?3:2);
  deck(L,W,{depth,stageAt});endSupports(L,W,deckZ,depth);stages('stayed');
  const planes=[];
  for(const s of [-1,1]){
   const tx=s*main/2;support(`comparison-tower-pier-${s}`,tx,0,0,deckZ-depth-.08,2.5,W+1);
   for(const p of [-1,1]){
    rod(`comparison-tower-${s}-${p}`,'同尺度双柱索塔','tower',[[tx,p*cy,deckZ-depth],[tx,p*cy,deckZ+H]],.62,1,'beam','concrete');
    for(const dir of [-1,1]){
     const planeIds=[];
     for(let j=1;j<=n;j++){
      const x=tx+dir*j*spacing,bx=tx+dir*towerOffset,z=fan?deckZ+H-.35-(n-j)*.50:anchorZ+(j*spacing-towerOffset)*(H-.65)/(n*spacing-towerOffset);
      const cId=`stay-comparison-${s}-${p}-${dir}-${j}`,a=[x,p*cy,anchorZ],b=[bx,p*cy,z];
      stay(cId,a,b,stageAt(x),{plane:p,tower:s,side:dir,fanIndex:j});planeIds.push(cId);
      // Explicit anchor crossbeams are shared by the two cable planes at a station.
      if(p===-1)rod(`comparison-anchor-crossbeam-${s}-${dir}-${j}`,'成对索锚横梁','bracing',[[x,-cy,deckZ-.50],[x,cy,deckZ-.50]],.20,stageAt(x),'beam','steel');
     }
     planes.push({tower:s,plane:p,side:dir,cableIds:planeIds});
    }
   }
   rod(`comparison-tower-head-${s}`,'塔顶横梁','tower',[[tx,-cy,deckZ+H-4.2],[tx,cy,deckZ+H-4.2]],.38,1,'beam','concrete');
   rod(`comparison-deck-link-${s}`,'塔梁横向支承联系','bracing',[[tx,-cy,deckZ-.7],[tx,cy,deckZ-.7]],.30,1,'beam','concrete');
   tempProp(`comparison-starter-${s}`,tx-s*3.5,0,deckZ-depth,1,3);
  }
  model.geometryContract={type:fan?'fan-stayed':'harp-stayed',comparisonGroup:'fan-harp-96m',mainSpan:main,sideSpan:side,towerHeight:H,deckWidth:W,cableCount:56,cablePlanes:2,cableAnchorY:cy,railY:W/2-.1,towerAnchorOffset:towerOffset,fanAnchorZoneHeight:fan?3:null,groups:planes};
  model.assumptions.push('扇形与竖琴形比较共用48+96+48 m分跨、8 m桥宽、桥面以上28 m塔高、双索面及56根斜索；只改变塔端锚点的竖向分布。',fan?'扇形索在塔顶3.0 m高锚固区内放射，锚具沿高度间隔0.50 m且左右面分开；这是允许独立锚具的集中扇形教学近似，不将所有索压成一个无尺寸点。':'竖琴索按实际塔端偏置后的水平距离配置锚点高度，使每一方向的7根索严格平行；两侧斜索在索塔不同纵向表面锚固。','本比较没有由索斜率自动计算全桥索力；平行或扇形外观不构成最优性结论。');
 }
 if(id==='stayed_standard'||id==='extradosed'){
  const low=id==='extradosed',main=low?60:120,side=low?36:48,L=main+2*side,W=low?8:14,H=low?9:32,depth=low?1.65:1.35,cy=low?W/2-.5:6.25;
  model.deckZ=low?6:8;model.spanArrangement=[side,main,side];
  const stageAt=x=>Math.min(...[-main/2,main/2].map(t=>Math.abs(x-t)))<8?1:(Math.abs(x)<8||Math.abs(x)>L/2-5?3:2);
  deck(L,W,{depth,stageAt});endSupports(L,W,model.deckZ,depth);stages('stayed');
  const tributary={};
  for(const sign of [-1,1]){
   const tx=sign*main/2;
   support(`tower-pier-${sign}`,tx,0,0,model.deckZ-depth-.08,3,W+1);
   for(const plane of [-1,1]){
    rod(`tower-${sign}-${plane}`,low?'矮塔柱 / 塔梁固结示意':'双柱索塔','tower',[[tx,plane*cy,model.deckZ-depth],[tx,plane*cy,model.deckZ+H]],low?.46:.62,1,'beam','concrete');
    const mainN=low?5:7,mainS=low?4.5:7.5,sideN=low?5:5,sideS=low?5.5:8;
    for(const sideKind of ['main','side']){
     const count=sideKind==='main'?mainN:sideN,spacing=sideKind==='main'?mainS:sideS,dir=sideKind==='main'?-sign:sign;
     for(let j=1;j<=count;j++){
      const x=tx+dir*j*spacing,z=model.deckZ+H*(.65+.35*j/count),a=[x,plane*cy,model.deckZ+.30],b=[tx,plane*cy,z],cId=`stay-${sign}-${plane}-${sideKind}-${j}`;
      stay(cId,a,b,stageAt(x),{tributaryLength:spacing,plane,segment:sideKind});tributary[cId]=spacing;
     }
    }
   }
   rod(`tower-head-${sign}`,'索塔上横梁','tower',[[tx,-cy,model.deckZ+H*.87],[tx,cy,model.deckZ+H*.87]],low?.30:.45,1,'beam','concrete');
   rod(`tower-deck-link-${sign}`,'塔梁横向连接','bracing',[[tx,-cy,model.deckZ-depth*.4],[tx,cy,model.deckZ-depth*.4]],.35,1,'beam','concrete');
   tempProp(`starter-prop-${sign}`,tx-sign*5,0,model.deckZ-depth,1,3);
  }
  if(!low)model.analysis={type:'stay-tributary',cablePlanes:2,tributaryByMember:tributary,coveredLengthPerPlane:185,totalDeckLength:L,unassignedLength:31,description:'逐索分担长度对应局部竖向荷载，主跨两塔分区不重叠；各索面计185 m，余31 m的塔旁、合龙和端部梁区未纳入本局部算例。不是全桥平衡或真实索力。'};
 }
 if(id==='stayed_single'){
  model.deckZ=6;model.spanArrangement=[40,60];const L=100,W=6,tx=-10,top=[-24,0,42];
  deck(L,W,{depth:1.25,stageAt:x=>Math.abs(x-tx)<6?1:(x>43||x<-45?3:2)});endSupports(L,W,6,1.25);support('tower-foundation',tx,0,0,4.67,3,4);
  rod('inclined-tower','倾斜独塔','tower',[[tx,0,4.7],top],.70,1,'beam','steel');
  for(const dir of [-1,1])for(let i=1;i<=(dir<0?5:8);i++){
   const x=tx+dir*i*7,a=[x,0,6.34],t=.62+.36*i/(dir<0?5:8),b=[lerp(tx,top[0],t),0,lerp(4.7,42,t)];stay(`center-stay-${dir}-${i}`,a,b,2);
  }
  [-16,-5].forEach((x,i)=>tempProp(`starter-${i}`,x,0,4.75));
  tube('temporary-stability','临时塔稳定索','temporary','temporary',1,[top,[-48,-5,1]],.04,{temporaryUntil:3});box('temporary-anchor','临时地锚','temporary','temporary',1,[-48,-5,.5],[2,2,1],{temporaryUntil:3});
  model.transverseBudget={leftEdge:.55,leftWalk:2.15,centralAnchors:.60,rightWalk:2.15,rightEdge:.55,total:6};stages('stayed');
 }
 if(id==='stayed_spatial'){
  model.deckZ=7;const L=100,W=5.5,curve=x=>6.5*Math.sin(2*Math.PI*x/L),tx=-16,foot=[tx,-12,0],az=parameters.towerAzimuthDeg*Math.PI/180,tilt=parameters.towerInclinationDeg*Math.PI/180,offset=38*Math.tan(tilt),top=[foot[0]+offset*Math.cos(az),foot[1]+offset*Math.sin(az),38];
  if(parameters.towerAzimuthDeg!==150||parameters.towerInclinationDeg!==12)model.revision+=`:a${parameters.towerAzimuthDeg}:i${parameters.towerInclinationDeg}`;
  model.geometrySignature=`${id}@${model.revision}`;
  model.geometryContract={type:'rotatable-spatial-pylon',towerFoot:foot,towerTop:top,towerHeightAboveFoundation:38,parameterAxes:'azimuth: +x toward +y about +z; inclination: from vertical',azimuthDeg:parameters.towerAzimuthDeg,inclinationDeg:parameters.towerInclinationDeg,parameterScope:'teaching-geometry-only'};
  deck(L,W,{depth:1.10,curveY:curve,step:1.5,stageAt:x=>Math.abs(x-tx)<5?1:(x>43||x<-45?3:2)});
  for(const s of [-1,1])support(`end-${s}`,s*L/2,curve(s*L/2),0,5.82,1.8,W+1);
  box('tower-foot','偏置塔基础','pier','concrete',0,[tx,-12,-.3],[5,5,1.4]);rod('spatial-tower','空间倾塔','tower',[foot,top],.60,1,'beam','steel');
  rod('tower-deck-strut','塔旁梁支承横梁','bracing',[[lerp(foot[0],top[0],6.35/38),lerp(foot[1],top[1],6.35/38),6.35],path(tx,-W/2)],.36,1,'beam','steel');
  for(let i=0;i<13;i++){
   const x=-44+i*7.1,a=vadd(path(x,-W/2+.55),[0,0,.26]),t=(38-Math.abs(6-i)*.65)/38,b=foot.map((v,k)=>lerp(v,top[k],t));stay(`spatial-stay-${i}`,a,b,2);
  }
  const back=[-55,-18,1.5];rod('permanent-backstay','永久背索','cable',[top,back],.085,1,'cable','cable');box('back-anchor','永久背索锚碇','anchor','concrete',0,[-55,-18,.5],[5,4,3]);
  for(const x of [-42,-28,-10,5,20,35])tempProp(`curve-prop-${x}`,x,curve(x),5.9);
  model.assumptions.push('此模型为原创直线斜拉索体系；不是加伦索大街人行桥，不能把该实桥的空间主缆与吊索改称斜拉索。','曲线箱梁的扭转、偏置塔横向弯曲与背索预应力均需空间分析，本模型只展示连接关系。');stages('stayed');
 }
 if(['arch_basket','arch_inclined','arch_network'].includes(id)){
  const network=id==='arch_network',inclined=id==='arch_inclined',L=preset.span,W=preset.width,rise=preset.height;
  model.deckZ=5;deck(L,W,{depth:1.15,stageAt:()=>2});endSupports(L,W,5,1.15);stages('arch');
  const ribs=inclined?[0]:[-1,1],N=20;
  const archPoint=(t,s)=>{const z=5+4*rise*t*(1-t),y=inclined?-W/2-.30+(z-5)*.22:s*(W/2+.28-(id==='arch_basket'?1.7*Math.sin(Math.PI*t):0));return[(t-.5)*L,y,z];};
  for(const s of ribs){
   rod(`arch-${s}`,inclined?'单片倾斜拱肋':'钢拱肋','arch',sample(t=>archPoint(t,s),64),inclined?.48:.34,1,'beam','steel');
   for(const end of [0,1]){
    const a=archPoint(end,s);anchor(`arch-shoe-${s}-${end}`,a,'拱脚连接 / 端横梁节点',1,.85);
    rod(`arch-bearing-${s}-${end}`,'拱脚端部支承连接','bracing',[[a[0],a[1],3.85],a],.30,1,'rod','steel');
    rod(`arch-foot-link-${s}-${end}`,'拱脚与系梁端横梁连接','bracing',[vadd(a,[0,0,-.20]),[(end-.5)*L,0,4.43]],.29,1,'beam');
   }
   for(let i=1;i<N;i++){
    const td=i/N,edges=inclined?[-1,1]:[s];
    for(const edge of edges){
     const shifts=network?[-.115,.115]:[0];
     for(const shift of shifts){
      const ta=inclined&&edge===1?Math.max(.10,Math.min(.90,td)):Math.max(.04,Math.min(.96,td+shift)),a=[(td-.5)*L,edge*(W/2-.55),5.25],b=archPoint(ta,s),tag=`hanger-${s}-${edge}-${i}-${shift}`;
      rod(tag,network?'网状交叉吊杆':'空间吊杆','hanger',[a,b],.038,2,'cable','cable');anchor(`${tag}-a`,a,'吊杆下锚',2,.28);anchor(`${tag}-b`,b,'吊杆上锚',2,.24);
     }
    }
   }
  }
  if(!inclined)for(let i=3;i<=17;i+=2){const t=i/N,a=archPoint(t,-1),b=archPoint(t,1);rod(`arch-cross-${i}`,'拱间横撑','bracing',[a,b],.11,1,'rod');if(i<17)rod(`arch-xbrace-${i}`,'拱间斜撑','bracing',[a,archPoint((i+2)/N,1)],.075,1,'rod');}
  for(const x of [-L*.35,-L*.18,0,L*.18,L*.35]){const t=x/L+.5;for(const s of ribs)tempProp(`arch-falsework-${s}-${x}`,x,archPoint(t,s)[1],archPoint(t,s)[2]-.25);tempProp(`deck-falsework-${x}`,x,0,3.85);}
  if(network)model.assumptions.push('交叉吊杆的相交投影不设连接节点；它们是独立受拉构件。该网形未经吊杆松弛、疲劳及预张力设计。');
 }
 if(id==='suspension_ground'||id==='suspension_self'||id==='hybrid_cable'){
  const self=id==='suspension_self',hybrid=id==='hybrid_cable',main=preset.span,side=self?21:hybrid?42:27,L=main+2*side,W=preset.width,deckZ=7,lowestAboveDeck=self?3.25:2.65,sag=main/(self?6:10),H=sag+lowestAboveDeck,topZ=deckZ+H,cy=W/2-.45,groundSetback=self?0:hybrid?22:18;
  model.deckZ=deckZ;model.height=H;model.heightDefinition='桥面以上主跨索鞍中心高差（塔帽另计）';model.spanArrangement=[side,main,side];model.cableSag=sag;
  const hangerConnections=[],saddleConnections=[],anchorConnections=[],hangerStations=[...new Set([0,...Array.from({length:Math.ceil((main-5)/5)},(_,j)=>-main/2+5+j*5).filter(x=>x<main/2-.1)])].sort((a,b)=>a-b);
  deck(L,W,{depth:self?1.55:1.15,stageAt:x=>self?2:(Math.abs(x)<main*.07?3:2)});endSupports(L,W,deckZ,self?1.55:1.15);stages(self?'self':'suspension');
  for(const s of [-1,1]){
   const tx=s*main/2,depth=self?1.55:1.15;support(`tower-pier-${s}`,tx,0,0,deckZ-depth-.08,2.5,W+1);
   for(const p of [-1,1])rod(`tower-${s}-${p}`,'悬索桥塔柱','tower',[[tx,p*cy,deckZ-depth],[tx,p*cy,topZ+.45]],.50,1,'beam','concrete');
   rod(`tower-head-${s}`,'塔顶横梁','tower',[[tx,-cy,topZ-.6],[tx,cy,topZ-.6]],.30,1,'beam','concrete');
  }
  for(const p of [-1,1]){
   const cablePoint=x=>[x,p*cy,topZ-sag*(1-Math.pow(2*x/main,2))];
   const mainId=`main-cable-${p}`,cableStations=[...new Set([...sample(t=>(t-.5)*main,80),...hangerStations])].sort((a,b)=>a-b);
   rod(mainId,'悬索主缆','cable',cableStations.map(cablePoint),.095,self?3:1,'cable','cable');
   for(const s of [-1,1]){
    const anchorX=s*(L/2+groundSetback),anchorZ=self?deckZ+.35:2.0,a=[anchorX,p*cy,anchorZ],b=[s*main/2,p*cy,topZ];
    rod(`side-cable-${p}-${s}`,self?'锚入梁端的边缆':'锚入地锚的边缆','cable',[a,b],.09,self?3:1,'cable','cable');
    box(`cable-anchor-${p}-${s}`,self?'主缆梁端锚固':'主缆永久地锚','anchor',self?'steel':'concrete',self?2:0,[anchorX,p*cy,self?deckZ+.35:.7],self?[1.6,1.1,1.1]:[4,3,3.5]);
    anchor(`saddle-${p}-${s}`,b,'塔顶索鞍',1,.7);saddleConnections.push({towerId:`tower-${s}-${p}`,point:b,cableId:mainId,sideCableId:`side-cable-${p}-${s}`});anchorConnections.push({anchorId:`cable-anchor-${p}-${s}`,cableId:`side-cable-${p}-${s}`,point:a});
    for(let j=1;j<=Math.floor(side/5);j++){
     const x=s*(main/2+j*5),t=(Math.abs(x)-main/2)/(Math.abs(anchorX)-main/2),z=lerp(topZ,anchorZ,t);if(z>deckZ+.5){const a2=[x,p*cy,deckZ+.25];rod(`side-hanger-${p}-${s}-${j}`,'边跨吊杆','hanger',[a2,[x,p*cy,z]],.034,self?3:2,'cable','cable');anchor(`side-hanger-anchor-${p}-${s}-${j}`,a2,'吊杆梁端锚',self?3:2,.3);hangerConnections.push({hangerId:`side-hanger-${p}-${s}-${j}`,cableId:`side-cable-${p}-${s}`,point:[x,p*cy,z],deckPoint:a2});}
    }
   }
   for(const x of hangerStations){
    if(hybrid&&Math.abs(x)>main*.25)continue;
    const a=[x,p*cy,deckZ+.25],tag=`main-hanger-${p}-${x}`,s=self?3:Math.abs(x)<main*.07?3:2;
    rod(tag,'主跨吊杆','hanger',[a,cablePoint(x)],.034,s,'cable','cable');anchor(`${tag}-anchor`,a,'吊杆梁端锚',s,.30);hangerConnections.push({hangerId:tag,cableId:mainId,point:cablePoint(x),deckPoint:a});
   }
   if(!self)tube(`catwalk-${p}`,'临时猫道导索','temporary','temporary',1,sample(t=>vadd(cablePoint((t-.5)*main),[0,-p*.55,-1.4]),50),.033,{temporaryUntil:3});
  }
  model.geometryContract={type:hybrid?'hybrid-cable-low-suspension-zone':'vertical-plane-suspension',mainSpan:main,mainCableSag:sag,lowestCableAboveDeck:lowestAboveDeck,highestCableAboveDeck:H,saddleZ:topZ,minimumMainCableZ:topZ-sag,measurementScope:'main-span cable only; exclude shore anchor and side spans',deckAnchorZ:deckZ+.25,towerCapAboveSaddle:.45,towerTopAboveDeck:H+.45,hangerConnections,saddleConnections,anchorConnections,groundAnchorSetback:groundSetback,overallAnchorLength:L+2*groundSetback,bridgeEndCableAboveDeck:self?.35:H+(2-topZ)*side/(side+groundSetback),heightEvidence:'source-informed-teaching-transfer',referenceSources:self?[{title:'南浔至临安公路南浔区南浔至练市段工程环境影响报告书',url:'https://zjjcmspublic.oss-cn-hangzhou-zwynet-d01-a.internet.cloud.zj.gov.cn/jcms_files/jcms1/web1756/site/attach/0/3371989344bc46aa8d8c5d6525e50c14.pdf',locator:'PDF第56页 / 印刷46页，日晖桥方案',facts:'48+110+48 m自锚；主缆垂跨比1/6；最短吊索3 m。'}]:[{title:'Forth Road Bridge Facts & Figures',url:'https://control.theforthbridges.org/about-the-forth-bridges/forth-road-bridge/forth-road-bridge-facts-figures/',locator:'Vital Statistics: Shortest hanger rope',facts:'最短吊索8 ft=2.4384 m；这是吊索长度，不是主缆距桥面高度。'},{title:'悬索桥纵向和竖向耦合自振研究',url:'https://pubs.cstam.org.cn/data/article/em/preview/pdf/20120222.pdf',locator:'表1：四渡河大桥算例',facts:'主跨900 m、垂度90 m，垂跨比1/10。'}]};
  model.assumptions.push(self?'自锚教学例参照日晖桥公开方案的1/6垂跨比与3 m最短吊索量级；本例84 m主跨取垂度14 m，下吊点桥面以上0.25 m，主缆低点以上3.25 m。该移植是教学假设，不是日晖桥复刻，也未将吊索长度直接当作桥面高差。':'悬吊区采用公开实桥的短吊索构造量级：福斯公路桥最短吊索8 ft约2.44 m，本教学例主跨跨中吊杆取2.40 m；下吊点在桥面以上0.25 m，所以主缆低点高差为2.65 m。垂跨比取1/10，可对照四渡河桥公开算例。不同跨度的模型不是按比例复刻实桥。',`主跨索鞍中心高差=主索垂度${sag} m+主缆最低点高差${lowestAboveDeck} m=${H} m，塔帽另高0.45 m；主缆低点不等于塔高或垂度。`);
  if(!self)model.assumptions.push(`地锚在桥面端部之外后退${groundSetback} m，以保留边缆通过桥端时的实体净空；该锚距按本模型几何推定，非所引实桥的锚距。桥面总长${L} m，岸端索锚间距${L+2*groundSetback} m。`);
  if(self){for(let x=-L/2+7;x<L/2;x+=10)tempProp(`self-falsework-${x}`,x,0,deckZ-1.55);}
  if(hybrid){
   for(const s of [-1,1])for(const p of [-1,1])for(const dir of [-1,1])for(let j=1;j<=5;j++){
    const x=s*main/2+dir*j*5.5,b=[s*main/2,p*cy,topZ-1-j*.25];stay(`hybrid-stay-${s}-${p}-${dir}-${j}`,[x,p*cy,deckZ+.3],b,2);
   }
   model.assumptions.push('斜拉区与悬吊区在近塔/跨中交界处衔接；图中不据外观分配两系统的真实刚度、内力或协同份额。');
  }
 }
 if(id==='suspension_inclined'){
  const main=90,side=27,L=144,W=7,deckZ=7,lowestAboveDeck=2.65,sag=9,H=sag+lowestAboveDeck,depth=1.15,anchorY=3.05,anchorZ=deckZ+.25,tilt=.13,topZ=deckZ+H;
  const planeY=(sign,z)=>sign*(anchorY+(z-anchorZ)*tilt);
  model.deckZ=deckZ;model.height=H;model.heightDefinition='桥面以上主跨索鞍中心高差';model.spanArrangement=[side,main,side];model.cableSag=sag;
  deck(L,W,{depth,stageAt:x=>Math.abs(x)<7?3:2});endSupports(L,W,deckZ,depth);stages('suspension');
  const hangerConnections=[],saddleConnections=[];
  for(const s of [-1,1]){
   const tx=s*main/2;support(`inclined-tower-pier-${s}`,tx,0,0,deckZ-depth-.08,2.6,9);
   for(const p of [-1,1]){
    const saddle=[tx,planeY(p,topZ),topZ],foot=[tx,p*3.5,deckZ-depth];
    rod(`inclined-suspension-tower-${s}-${p}`,'外倾悬索塔柱','tower',[foot,saddle],.50,1,'beam','concrete');
    anchor(`inclined-saddle-${s}-${p}`,saddle,'塔顶主缆索鞍',1,.72);saddleConnections.push({towerId:`inclined-suspension-tower-${s}-${p}`,point:saddle});
   }
   rod(`inclined-tower-head-${s}`,'外倾索塔顶部横梁','tower',[[tx,planeY(-1,topZ-.8),topZ-.8],[tx,planeY(1,topZ-.8),topZ-.8]],.36,1,'beam','concrete');
  }
  for(const p of [-1,1]){
   const cablePoint=x=>{const z=topZ-sag*(1-(2*x/main)**2);return[x,planeY(p,z),z];};
   const mainId=`inclined-main-cable-${p}`;
   rod(mainId,'外倾索面连续主缆','cable',sample(t=>cablePoint((t-.5)*main),90),.095,1,'cable','cable');
   for(let x=-40;x<=40;x+=5){
    const a=[x,p*anchorY,anchorZ],b=cablePoint(x),tag=`inclined-main-hanger-${p}-${x}`,stage=Math.abs(x)<7?3:2;
    rod(tag,'外倾主跨吊杆 / 上接主缆','hanger',[a,b],.036,stage,'cable','cable');anchor(`${tag}-deck-anchor`,a,'吊杆梁端锚',stage,.30);anchor(`${tag}-cable-clamp`,b,'主缆吊杆索夹',stage,.24);
    hangerConnections.push({hangerId:tag,cableId:mainId,point:b,deckPoint:a});
    if(p===-1)rod(`inclined-anchor-crossbeam-${x}`,'双侧斜吊杆锚固横梁','bracing',[[x,-anchorY,deckZ-.5],[x,anchorY,deckZ-.5]],.19,stage,'beam');
   }
   for(const s of [-1,1]){
    const anchorX=s*(L/2+18),anchorEndZ=2,a=[anchorX,planeY(p,anchorEndZ),anchorEndZ],b=cablePoint(s*main/2),sideId=`inclined-side-cable-${p}-${s}`;
    rod(sideId,'外倾索面地锚边缆','cable',[a,b],.095,1,'cable','cable');
    box(`inclined-ground-anchor-${p}-${s}`,'主缆地锚 / 承受水平分力','anchor','concrete',0,[anchorX,a[1],.7],[4,3,3.5]);
    for(let j=1;j<=5;j++){
     const x=s*(main/2+j*5),t=(Math.abs(x)-main/2)/(Math.abs(anchorX)-main/2),upper=[x,lerp(b[1],a[1],t),lerp(b[2],a[2],t)],lower=[x,p*anchorY,anchorZ],tag=`inclined-side-hanger-${p}-${s}-${j}`;
     rod(tag,'外倾边跨吊杆','hanger',[lower,upper],.036,2,'cable','cable');anchor(`${tag}-deck-anchor`,lower,'吊杆梁端锚',2,.30);anchor(`${tag}-cable-clamp`,upper,'主缆吊杆索夹',2,.24);hangerConnections.push({hangerId:tag,cableId:sideId,point:upper,deckPoint:lower});
    }
   }
   tube(`inclined-catwalk-${p}`,'外侧临时猫道导索','temporary','temporary',1,sample(t=>vadd(cablePoint((t-.5)*main),[0,p*.55,-1.4]),90),.033,{temporaryUntil:3});
  }
  model.geometryContract={type:'inclined-plane-suspension',mainSpan:main,deckAnchorY:anchorY,deckAnchorZ:anchorZ,planeSlopeYperZ:tilt,mainCableSag:sag,saddleZ:topZ,minimumMainCableZ:topZ-sag,measurementScope:'main-span cable only; exclude shore anchor and side spans',lowestCableAboveDeck:lowestAboveDeck,highestCableAboveDeck:H,towerCapAboveSaddle:0,towerTopAboveDeck:H,groundAnchorSetback:18,overallAnchorLength:L+36,bridgeEndCableAboveDeck:H+(2-topZ)*side/(side+18),hangerConnections,saddleConnections,heightEvidence:'source-informed-teaching-transfer',referenceSources:[{title:'Forth Road Bridge Facts & Figures',url:'https://control.theforthbridges.org/about-the-forth-bridges/forth-road-bridge/forth-road-bridge-facts-figures/',locator:'Vital Statistics: Shortest hanger rope',facts:'最短吊索8 ft=2.4384 m；借用短吊索构造量级，不照搬实桥索面。'},{title:'悬索桥纵向和竖向耦合自振研究',url:'https://pubs.cstam.org.cn/data/article/em/preview/pdf/20120222.pdf',locator:'表1：四渡河大桥算例',facts:'主跨900 m、主缆垂度90 m。'}]};
  model.assumptions.push('最低点的吊点竖向高差取2.40 m，配合桥面以上0.25 m下锚点，主缆低点距桥面2.65 m；参照福斯公路桥约2.44 m最短吊索的构造量级，倾斜吊杆实际长度约2.42 m，非实桥移植尺寸。','保留主跨90 m、垂度9 m（1/10），索鞍高差由9+2.65=11.65 m确定；地锚后退18 m，桥端边缆高于桥面约1.66 m，避免压低塔后边缆穿入桥面。','双索面相对竖直面外倾，y方向偏移/高差=0.13；主缆、索夹和吊杆上端严格落在同一倾斜平面中。该角度和全部尺寸为原创教学选择。','桥面荷载先经斜吊杆进入连续曲线主缆，再经索鞍和地锚传递；不将吊杆直接接到塔顶，因此仍为悬索体系。','主缆采用最终状态抛物线教学近似，未由恒载、预张力和空间平衡求解；两侧横向分力由横梁、主梁及横向体系承担，大小未计算。');
 }
 if(id==='underslung_suspension'){
  const L=60,W=5.5,deckZ=10,depth=.85,cy=2.10,cableEndZ=deckZ-depth-.35,sag=4.2,N=20;
  model.deckZ=deckZ;model.cableSag=sag;model.heightDefinition='桥面下主索的端点—跨中垂度';deck(L,W,{depth,stageAt:()=>2});endSupports(L,W,deckZ,depth);stages('self');
  model.stages[1].title='临时支架与梁端锚区';model.stages[2].title='主梁与下部悬索安装';model.stages[3].title='撑杆连接与张拉示意';model.stages[3].text='下部索和压杆连接至横梁，并闭合梁端自锚传力路径；未求张拉力及施工平衡。';
  const compressionConnections=[],anchorageConnections=[];
  for(const plane of [-1,1]){
   const cableId=`underslung-cable-${plane}`,cablePoint=t=>[(t-.5)*L,plane*cy,cableEndZ-4*sag*t*(1-t)];
   rod(cableId,'桥面下连续受拉主索','cable',sample(cablePoint,N*4),.085,2,'cable','cable');
   for(const end of [0,1]){
    const a=cablePoint(end),tag=`underslung-anchor-${plane}-${end}`;
    box(tag,'主索梁端自锚 / 端隔板','anchor','steel',2,[a[0],a[1],deckZ-depth-.05],[.65,.7,.90]);
    anchorageConnections.push({anchorId:tag,cableId,point:a,end});
   }
   for(let i=1;i<N;i++){
    const bottom=cablePoint(i/N),top=[bottom[0],bottom[1],deckZ-depth],tag=`underslung-strut-${plane}-${i}`;
    rod(tag,'下承索上托受压撑杆','bracing',[bottom,top],.10,3,'rod','steel');
    anchor(`${tag}-shoe`,bottom,'撑杆—主索鞍座',3,.24);
    box(`${tag}-head`,'撑杆顶接梁底节点','anchor','steel',3,[top[0],top[1],top[2]],[.44,.40,.24]);
    compressionConnections.push({strutId:tag,cableId,cablePoint:bottom,deckPoint:top,expectedRole:'compression-not-solved'});
    if(plane===-1)rod(`underslung-crossbeam-${i}`,'撑杆顶横梁 / 与箱梁底连接','bracing',[[top[0],-cy,top[2]+.16],[top[0],cy,top[2]+.16]],.17,2,'beam');
   }
  }
  for(const x of [-22,-10,10,22])tempProp(`underslung-falsework-${x}`,x,0,deckZ-depth,1,3);
  model.geometryContract={type:'under-deck-suspension-with-compression-struts',cableSag:sag,cableEndZ,mainCableCount:2,compressionStrutCount:38,compressionConnections,anchorageConnections,anchorSystem:'self-anchored-teaching-assumption',deckBottomZ:deckZ-depth};
  model.assumptions.push('本例是主索下置、撑杆上托桥面的原创教学模型。桥面保持独立平顺主梁；它与桥面直接随受拉带下垂的应力带桥不是同一种几何。','两片下部索在梁端自锚，压杆顶端连接梁底横梁，索端水平分力通过主梁闭合；跨度、垂度、截面及自锚构造均为教学假设。','索与撑杆的拉压名称只表示预期受力角色；尚未计算初始预应力、非线性索形、压杆稳定和整桥内力。');
 }
 if(id==='millennium_low'){
  const spans=[81,144,108],L=333,W=4,deckZ=12,depth=.65,start=-L/2,end=L/2,x1=start+81,x2=x1+144,highZ=deckZ+1.5,lowZ=deckZ-.8,sag=2.3,innerY=3.05;
  model.deckZ=deckZ;model.spanArrangement=spans;model.cableSag=sag;model.heightDefinition='主跨主索最高点—最低点垂度（非塔高）';model.assumptions[0]='伦敦千禧桥的来源约束教学重建；采用已核主要尺寸及构型，缺少完整竣工图的细节为明确教学假设。';deck(L,W,{depth,step:4,stageAt:x=>Math.abs(x-(x1+x2)/2)<8?3:2});endSupports(L,W,deckZ,depth);stages('suspension');
  model.stages[1].title='Y形支承与低位侧索';model.stages[2].title='钢臂与分段桥面';model.stages[3].text='连接钢臂、桥面与两侧索束，示意体系闭合；不模拟实际架设、张拉和减振器调试。';
  const cableZ=x=>x<=x1?lowZ+(highZ-lowZ)*(x-start)/(x1-start):x>=x2?highZ-(highZ-lowZ)*(x-x2)/(end-x2):highZ-4*sag*((x-x1)/144)*(1-(x-x1)/144);
  const armStations=[];for(let x=start+8;x<end-1;x+=8)armStations.push(x);
  const cableStations=[...new Set([start,end,x1,x2,(x1+x2)/2,...armStations,...Array.from({length:145},(_,i)=>x1+i)])].sort((a,b)=>a-b);
  const steelArmConnections=[],saddleConnections=[],groundAnchorConnections=[];
  for(const [j,x] of [x1,x2].entries()){
   box(`millennium-pier-foot-${j}`,'河中Y形支承基础','pier','concrete',0,[x,0,-.2],[6,8,1.4]);
   rod(`millennium-y-trunk-${j}`,'Y形墩下部主干','pier',[[x,0,.5],[x,0,deckZ-3.2]],.8,1,'beam','concrete');
   for(const plane of [-1,1]){
    const head=[x,plane*(innerY+.21),highZ];
    rod(`millennium-y-arm-${j}-${plane}`,'低位Y形支承分叉','tower',[[x,0,deckZ-3.2],head],.30,1,'beam','steel');
    rod(`millennium-saddle-bar-${j}-${plane}`,'索束支承横座','tower',[[x,plane*(innerY-.12),highZ],[x,plane*(innerY+.54),highZ]],.14,1,'beam','steel');
   }
  }
  for(const plane of [-1,1])for(let k=0;k<4;k++){
   const y=plane*(innerY+k*.14),cableId=`millennium-main-cable-${plane}-${k}`;
   rod(cableId,'千禧桥式低位侧主索','cable',cableStations.map(x=>[x,y,cableZ(x)]),.055,1,'cable','cable');
   for(const [j,x] of [x1,x2].entries()){
    const point=[x,y,highZ];anchor(`millennium-saddle-${plane}-${k}-${j}`,point,'侧索索鞍',1,.17);saddleConnections.push({cableId,point,supportId:`millennium-saddle-bar-${j}-${plane}`});
   }
   for(const [j,x] of [start,end].entries()){
    const point=[x,y,lowZ],aId=`millennium-shore-anchor-${plane}-${k}-${j}`;
    box(aId,'岸端混凝土索锚示意','anchor','concrete',0,[x,y,lowZ-.35],[1.4,.25,1.1]);groundAnchorConnections.push({cableId,point,anchorId:aId});
   }
  }
  for(const [i,x] of armStations.entries()){
   for(const plane of [-1,1]){
    const deckPoint=[x,plane*(W/2-.22),deckZ-.42],cablePoint=[x,plane*innerY,cableZ(x)],tag=`millennium-steel-arm-${plane}-${i}`;
    rod(tag,'桥面—侧索横向钢臂','bracing',[deckPoint,cablePoint],.085,2,'beam','steel');
    rod(`${tag}-clampbar`,'四索夹持连接座','bracing',[cablePoint,[x,plane*(innerY+.42),cablePoint[2]]],.085,2,'beam');
    for(let k=0;k<4;k++){
     const point=[x,plane*(innerY+k*.14),cablePoint[2]],cableId=`millennium-main-cable-${plane}-${k}`;
     anchor(`${tag}-clamp-${k}`,point,'主索钢臂夹具',2,.16);steelArmConnections.push({armId:tag,cableId,cablePoint:point,deckPoint});
    }
   }
   rod(`millennium-crossbeam-${i}`,'桥面横梁 / 两侧钢臂连接','bracing',[[x,-W/2+.22,deckZ-.42],[x,W/2-.22,deckZ-.42]],.11,2,'beam');
  }
  for(const j of [0,1])for(const plane of [-1,1]){const x=j===0?start:end;box(`millennium-anchor-base-${j}-${plane}`,'岸端侧索锚固基础示意','pier','concrete',0,[x,plane*(innerY+.21),lowZ/2],[3,1.3,lowZ]);}
  model.geometryContract={type:'millennium-low-side-cable-teaching-reconstruction',mainCableCount:8,cablesPerSide:4,mainCableSag:2.3,mainSpan:144,spanArrangement:spans,deckWidth:4,armNominalSpacing:8,highestCableAboveDeck:1.5,lowestCableAboveDeck:-.8,towerCapAboveSaddle:0,towerTopAboveDeck:1.5,saddleZ:highZ,minimumMainCableZ:lowZ,steelArmConnections,saddleConnections,groundAnchorConnections,profileStatus:'source spans, width, cable count and 2.3 m main-span sag; elevations, cable spacing, sections and shore connection simplified'};
  model.assumptions.push('千禧桥教学重建采用已核实的81+144+108 m跨径、4 m桥面、左右各4根主索及主跨2.3 m垂度。两座Y形支承与约8 m间距钢臂体现其低轮廓悬索特征。','为了清楚显示索与梁的关系，本模型取索鞍高于桥面1.5 m、跨中主索低于桥面0.8 m；该相对高程、索束间距、截面、锚块及梁底细节为教学假设，不能读作竣工尺寸。','两岸锚固采用地锚传力示意。侧索通过横向钢臂与桥面连接，不能把本桥画成高塔加长竖吊杆的普通悬索桥。','本模型不含实际减振器系统和行人横向振动计算，不能以静态外形判断千禧桥的动态舒适性。');
 }
 if(id==='stress_ribbon'){
  const L=50,W=3.4,sag=.9,z=x=>6-sag*(1-Math.pow(2*x/L,2));model.deckZ=6;model.cableSag=sag;
  deck(L,W,{depth:.20,thickness:.14,curveZ:z,step:1,closed:false,ribbon:true,stageAt:()=>2});
  for(const s of [-1,1]){
   box(`ribbon-anchor-${s}`,'钢带端部锚碇','anchor','concrete',0,[s*25,0,2.89],[3.5,5,5.78]);
   for(const edge of [-1,1]){
    const y=edge*.94,points=sample(t=>[(t-.5)*L,y,z((t-.5)*L)-.17],100);
    // Flattened box segments retain the rectangular steel-band section.
    for(let i=0;i<points.length-1;i++){if(s===1)break;const a=points[i],b=points[i+1],axis=norm(b.map((v,k)=>v-a[k]));box(`band-${edge}-${i}`,'连续受拉钢带','cable','steel',1,a.map((v,k)=>(v+b[k])/2),[Math.hypot(...b.map((v,k)=>v-a[k]))+.01,.40,.05],{axis});}
    if(s===-1)model.members.push({id:`band-${edge}`,label:'连续受拉钢带中心线',kind:'cable',points,category:'cable',stage:1,partIds:points.slice(1).map((_,i)=>`band-${edge}-${i}`)});
    anchor(`ribbon-shoe-${s}-${edge}`,[s*25,y,5.83],'钢带端部锚固',1,.28);
   }
  }
  model.assumptions.push('本原创应力带示例L=50 m、垂度0.90 m、桥宽3.40 m；不是恩茨奥恩Ⅲ既有教学重建的尺寸复刻。','钢带采用400×50 mm矩形截面、双带间距1.88 m，为本例假设；其线形未按恒载与预应力求解。');stages('ribbon');
 }
 if(id==='hybrid_arch'){
  const L=80,W=7,rise=14,archL=58;model.deckZ=20;
  deck(L,W,{depth:1.35,stageAt:()=>2});endSupports(L,W,20,1.35);stages('arch');
  const az=x=>2+rise*(1-Math.pow(2*x/archL,2));
  for(const s of [-1,1]){
   const y=s*2.7;rod(`under-arch-${s}`,'上承式拱肋','arch',sample(t=>{const x=(t-.5)*archL;return[x,y,az(x)]},64),.46,1,'beam','concrete');
   for(const end of [-1,1]){box(`arch-foundation-${s}-${end}`,'承受拱推力的拱座','pier','concrete',0,[end*archL/2,y,.7],[4,4,2.6]);anchor(`arch-foot-${s}-${end}`,[end*archL/2,y,2],'拱脚连接',1,.8);}
   for(let x=-24;x<=24;x+=8)rod(`spandrel-${s}-${x}`,'拱上受压立柱','pier',[[x,y,az(x)],[x,y,18.72]],.24,2,'rod','concrete');
   for(const x of [-20,-10,0,10,20])tempProp(`arch-prop-${s}-${x}`,x,y,az(x)-.3);
  }
  for(let x=-24;x<=24;x+=8)rod(`arch-crossbeam-${x}`,'拱间横向联系','bracing',[[x,-2.7,az(x)],[x,2.7,az(x)]],.15,1,'rod','steel');
  for(const x of [-34,34]){for(const y of [-2.7,2.7])support(`approach-support-${x}-${y}`,x,y,0,18.57,1.3,1.3);}
  model.assumptions.push('此为上承式梁—拱组合的原创对照模型，不是博斯特尔拱托钢带桥；两者来源关系在案例卡中分别标注。');
 }
 if(id==='fink_inverted'){
  const L=72,W=6,deckZ=7,depth=1.05,cy=2.60,baseZ=deckZ+.25,stations=[30,18,6],heights=[13,8.5,4.5];
  model.deckZ=deckZ;deck(L,W,{depth,stageAt:()=>2});endSupports(L,W,deckZ,depth);stages('self');
  model.stages[1].title='临时支架与桥面安装准备';model.stages[2].title='桥面刚性弦与分级压杆';model.stages[2].text='桥面箱梁先在支架上形成连续下弦，安装两侧端高、中低的压杆。';
  model.stages[3].title='分级拉杆及回锚连接';model.stages[3].text='各级杆顶以斜拉杆连接相邻桥面节点，外侧最高杆接端部伸臂及地锚；索力和张拉次序未计算。';model.stages[4].text='闭合桥面、杆索和端部回锚传力路径后移除支架；这里只表示安装逻辑。';
  const nodes=[],rods=[],cables=[];
  const addNode=(nodeId,point,kind)=>{nodes.push({id:nodeId,point,kind});return{nodeId,point};};
  const addCable=(cId,a,b,label)=>{
   rod(cId,label,'cable',[a.point,b.point],.042,3,'cable','cable');
   anchor(`${cId}-a`,a.point,a.kind==='deck'?'梁端索锚块':'芬克杆索销接节点',3,.27);anchor(`${cId}-b`,b.point,b.kind==='deck'?'梁端索锚块':'芬克杆索销接节点',3,.27);
   cables.push({id:cId,from:a.nodeId,to:b.nodeId});
  };
  for(const p of [-1,1]){
   const middle={...addNode(`fink-deck-${p}-mid`,[0,p*cy,baseZ],'deck'),kind:'deck'};
   for(const s of [-1,1]){
    const bottoms=stations.map((x,j)=>({...addNode(`fink-deck-${p}-${s}-${j}`,[s*x,p*cy,baseZ],'deck'),kind:'deck'}));
    const tops=stations.map((x,j)=>({...addNode(`fink-top-${p}-${s}-${j}`,[s*x,p*cy,deckZ+heights[j]],'mast_top'),kind:'mast_top'}));
    const bowsprit={...addNode(`fink-bowsprit-${p}-${s}`,[s*43,p*cy,8.5],'bowsprit'),kind:'bowsprit'},ground={...addNode(`fink-ground-${p}-${s}`,[s*47,p*cy,1.4],'ground_anchor'),kind:'ground_anchor'};
    for(let j=0;j<stations.length;j++){
     const mastId=`fink-mast-${p}-${s}-${j}`;
     rod(mastId,'芬克式分级压杆','tower',[bottoms[j].point,tops[j].point],.23-j*.035,2,'rod','steel');
     anchor(`${mastId}-base`,bottoms[j].point,'压杆下节点 / 连接桥面刚性弦',2,.62);
     rods.push({id:mastId,bottom:bottoms[j].nodeId,top:tops[j].nodeId,heightAboveDeck:heights[j],level:j,half:s,plane:p});
     const outboard=j===0?bowsprit:bottoms[j-1],inboard=j===stations.length-1?middle:bottoms[j+1];
     addCable(`fink-tie-${p}-${s}-${j}-out`,outboard,tops[j],'芬克分级回拉杆');
     addCable(`fink-tie-${p}-${s}-${j}-in`,inboard,tops[j],'芬克分级前拉杆');
     if(p===-1)rod(`fink-deck-crossbeam-${s}-${j}`,'芬克压杆与索锚横梁','bracing',[[s*stations[j],-cy,deckZ-.45],[s*stations[j],cy,deckZ-.45]],.22,2,'beam','steel');
    }
    rod(`fink-bowsprit-strut-${p}-${s}`,'端部回锚伸臂 / bowsprit','bracing',[[s*L/2,p*cy,deckZ-.40],bowsprit.point],.25,2,'beam','steel');
    addCable(`fink-ground-tie-${p}-${s}`,ground,bowsprit,'伸臂端永久回锚索');box(`fink-ground-block-${p}-${s}`,'芬克端部永久地锚','anchor','concrete',0,[ground.point[0],ground.point[1],.6],[3.8,3,2.5]);
   }
  }
  for(const x of [-30,-18,-6,6,18,30])tempProp(`fink-falsework-${x}`,x,0,deckZ-depth,1,3);
  model.geometryContract={type:'inverted-fink-rod-cable-teaching-variant',mastCount:12,mastsPerPlane:6,continuousTopChord:false,continuousBottomChord:'deck-girder',nodes,rods,cables,halfStations:stations,heightSequenceFromEnds:heights,groundAnchored:true};
  model.assumptions.push('本模型是倒置芬克式杆索梁的原创教学变体：桥面箱梁作连续下弦，两片索面每片6根变高压杆，由两端向跨中逐级降低；没有连续上弦。','取皇家维多利亚码头桥的变高杆、杆索联系与端部伸臂回锚作为概念参照，并参考Forthside对“桥面下弦、无上弦”的体系描述；不复刻其跨度、杆数、横向倾角或构造尺寸。','各杆顶分别连接前后相邻桥面节点；内侧压杆的底部荷载经前一级拉杆递接，端部最高压杆经伸臂与地锚闭合。不是把普通沃伦桁架或中央单一人字架改名芬克桥。','压杆和拉杆名称表示本教学体系的预期工作角色；真实内力、预张力、非对称荷载及稳定性尚未求解，不能凭颜色或杆件粗细判定应力。');
 }
 // Attach immutable physical defaults and explicit scope. Presentation options never mutate them.
 model.display={memberThicknessFactor:1,personHeight:1.75,deformationFactor:1};
 model.stageConvention='stage <= selectedStage && (temporaryUntil absent || selectedStage <= temporaryUntil)';
 model.geometrySignature=model.geometrySignature||`${model.id}@${model.revision}`;
 model.optionsUsed={...parameters};
 decorateMobility(model);
 return model;
}
