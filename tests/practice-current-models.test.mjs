import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { formatPracticeFeedback } from '../learning-logic.js';

test('wrong choice feedback names the right and wrong answers instead of generic missed-target text', () => {
  const question = { type: 'single', answer: ['bottom'], options: [{id:'bottom',label:'主视图下方'}, {id:'top',label:'主视图上方'}] };
  const feedback = formatPracticeFeedback(question, new Set(['top']));
  assert.match(feedback, /正确答案：主视图下方/);
  assert.match(feedback, /误选：主视图上方/);
  assert.doesNotMatch(feedback, /未命中|不符合的对象|哪一个动作|依据/);
  assert.equal(formatPracticeFeedback(question, ['bottom']), '回答正确。');
});

test('multiple-choice and action feedback identify the concrete remaining correction', () => {
  const question = { type:'multiple',answer:['a','b'], options:[{id:'a',label:'孔轮廓'},{id:'b',label:'直径'},{id:'c',label:'中心位置'}] };
  assert.equal(formatPracticeFeedback(question, ['a','c']), '漏选：直径；误选：中心位置。');
  assert.match(formatPracticeFeedback({type:'click-model', targetComponents:['tower']}, {componentName:'stay_cable'}), /应点击.*塔.*当前选中的是.*索/);
  assert.match(formatPracticeFeedback({type:'rotate-to-view',targetView:'side',targetDirection:[-1,0,0],toleranceDegrees:6}, {direction:[1,0,0]}), /距左视方向还差 180.0°/);
});

const source = await readFile(new URL('../projection-master.js', import.meta.url), 'utf8');
const start = source.indexOf('async function setPracticeModeModel(');
const method = source.slice(start, source.indexOf('\n}', start) + 2);
function harness() {
  let resolve, reject;
  const pending = new Promise((ok, fail) => { resolve=ok; reject=fail; });
  let rebuilds=0, feedback='';
  const question={id:'fresh',modelId:'textbookFlange',showHidden:true,views:['front','top','side'],type:'single',title:'轮盘识图'};
  const deps = { modelLoadRequest:0, practiceModelReady:false, state:{mode:'quiz',currentModel:'old'},
    MODELS:{textbookFlange:{name:'四肋轮盘',load:()=>pending}}, modelGroup:{visible:true}, projectionGroup:{visible:true}, focusGroup:{visible:true},
    projPlanes:{front:{visible:true},top:{visible:true},side:{visible:true}},
    currentPracticeQuestion:()=>question, setPracticeFeedback:value=>{feedback=value;}, updatePracticeSubmitState(){},
    updatePracticeInteractionUI(){}, updatePracticeOptionUI(){}, isChoiceQuestion:()=>true,
    rebuildModel(){rebuilds++;}, updateUnfold(){},fitModelCamera(){},setStatus(){} };
  const run = new Function('deps',`with(deps){${method};return setPracticeModeModel;}`)(deps);
  return { deps, question, run, resolve, reject, get rebuilds(){return rebuilds;},get feedback(){return feedback;} };
}

test('first use waits for the exact textbook model before building the question scene', async () => {
  const h=harness(), promise=h.run(h.question);
  assert.equal(h.rebuilds,0); assert.equal(h.deps.practiceModelReady,false); assert.equal(h.deps.modelGroup.visible,false);
  h.resolve(); assert.equal(await promise,true);
  assert.equal(h.rebuilds,1); assert.equal(h.deps.state.currentModel,'textbookFlange'); assert.equal(h.deps.practiceModelReady,true);
  assert.equal(h.deps.modelGroup.visible,true);
});

test('leaving during model loading cannot replace the restored exploration scene', async () => {
  const h=harness(), promise=h.run(h.question);
  h.deps.modelLoadRequest++; h.deps.state.mode='explore'; h.resolve();
  assert.equal(await promise,false); assert.equal(h.rebuilds,0); assert.equal(h.deps.state.currentModel,'old');
});

test('failed textbook load leaves assessment disabled and shows an actionable load error', async () => {
  const h=harness(), promise=h.run(h.question); h.reject(new Error('unavailable'));
  assert.equal(await promise,false); assert.equal(h.deps.practiceModelReady,false); assert.equal(h.rebuilds,0);
  assert.match(h.feedback,/加载.*退出练习后重试/);
});

test('failed model build hides the incomplete scene and leaves assessment disabled', async () => {
  const h=harness(); h.deps.rebuildModel=()=>{ throw new Error('geometry build failed'); };
  const promise=h.run(h.question); h.resolve();
  assert.equal(await promise,false); assert.equal(h.deps.practiceModelReady,false);
  assert.equal(h.deps.modelGroup.visible,false); assert.equal(h.deps.projectionGroup.visible,false);
  assert.match(h.feedback,/加载.*退出练习后重试/);
});

test('practice camera fits the complete unfolded drawing into its independent narrow or wide canvas', () => {
  const extract = name => {
    const start=source.indexOf(`function ${name}(`);
    return source.slice(start,source.indexOf('\n}',start)+2);
  };
  for (const aspect of [0.55,1.3,2.2]) {
    const state={mode:'quiz',isTiled:false,unfoldProgress:1,planeSize:12,planeGap:3.5};
    const camera=new THREE.PerspectiveCamera(43,aspect,0.05,1000);
    const getModelBounds=()=>new THREE.Box3(new THREE.Vector3(-3,0,-2),new THREE.Vector3(3,4,2));
    const functions=new Function('THREE','state','camera','getModelBounds',`const galleryInspectionHost=null; ${extract('getPlaneLayout')}\n${extract('fittedCameraFrame')}\nreturn {getPlaneLayout,fittedCameraFrame};`)(THREE,state,camera,getModelBounds);
    const frame=functions.fittedCameraFrame(); camera.position.copy(frame.position); camera.lookAt(frame.target); camera.updateMatrixWorld(true);
    const layout=functions.getPlaneLayout();
    for (const view of ['front','top','side']) for (const x of [-6,6]) for (const y of [-6,6]) {
      const projected=new THREE.Vector3(x,y,0).applyEuler(layout[view].rot).add(layout[view].pos).project(camera);
      assert.ok(Math.abs(projected.x)<1 && Math.abs(projected.y)<1,`${view} must be fully visible at aspect ${aspect}`);
    }
  }
});
