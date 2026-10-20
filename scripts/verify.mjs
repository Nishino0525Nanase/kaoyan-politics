import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
const js = fs.readFileSync(process.env.ZHIZHENG_JS_PATH || path.join(root,'dist/app.js'),'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root,'dist/questions.json'),'utf8'));
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
for(const m of js.matchAll(/\$\('([^']+)'\)/g)) assert(ids.has(m[1]), `Missing DOM id: ${m[1]}`);
assert.equal(data.questions.length,760);
assert.equal(new Set(data.questions.map(q=>q.id)).size,760);
assert(new Set(data.questions.map(q=>q.topic)).size<=60,'Topics must be grouped for usable专题 practice');
assert(data.questions.every(q=>q.knowledgePoint),'Keep detailed knowledge points searchable');
for(let year=2007;year<=2026;year++){
  const qs=data.questions.filter(q=>q.year===year);
  assert.equal(qs.length,38, `${year} paper incomplete`);
  assert.deepEqual(qs.map(q=>q.number).sort((a,b)=>a-b),Array.from({length:38},(_,i)=>i+1));
  assert.equal(qs.filter(q=>q.type==='single').length,16);
  assert.equal(qs.filter(q=>q.type==='multiple').length,17);
  assert.equal(qs.filter(q=>q.type==='analysis').length,5);
}
class Element {
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.listeners={};this.attrs={};this.dataset={};this.style={};this.hidden=false;this.disabled=false;this.value='';this._text='';this._class='';this.classList={add:(...n)=>{const s=new Set(this._class.split(' ').filter(Boolean));n.forEach(v=>s.add(v));this._class=[...s].join(' ');},remove:(...n)=>{this._class=this._class.split(' ').filter(v=>!n.includes(v)).join(' ');},toggle:(n,force)=>{const has=this._class.split(' ').includes(n);const use=force===undefined?!has:force;use?this.classList.add(n):this.classList.remove(n);return use;},contains:n=>this._class.split(' ').includes(n)};}
  set className(v){this._class=v;} get className(){return this._class;}
  set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent??String(c)).join('');}
  append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this._text='';this.children=[...nodes];}
  setAttribute(k,v){this.attrs[k]=String(v);if(k==='class')this.className=String(v);if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(v);}
  getAttribute(k){return this.attrs[k];} addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}
  dispatch(k,extra={}){for(const fn of this.listeners[k]??[])fn({target:this,...extra});}
  click(){if(!this.disabled){this.clickCount=(this.clickCount||0)+1;this.dispatch('click');}}scrollIntoView(){}showModal(){this.open=true;}close(){this.open=false;}getBoundingClientRect(){return {left:0,right:100,top:0,bottom:100};}
}
const persistent = new Map();
async function launch({nativeMode=false,beforeInit,storage=persistent}={}){
  const elements=[],byId=new Map();
  for(const match of html.matchAll(/<([a-z][\w-]*)([^>]*)>/gi)){
    const node=new Element(match[1]);for(const a of match[2].matchAll(/([\w-]+)="([^"]*)"/g)){node.setAttribute(a[1],a[2]);if(a[1]==='id')byId.set(a[2],node);}
    node.hidden=/\bhidden\b/.test(match[2]);elements.push(node);
  }
  const query=s=>{
    // The native labels use a few static descendant/last-child selectors; no layout engine is needed.
    const last=s.trim().split(/\s+|\s*>\s*/).filter(Boolean).at(-1), lastChild=last.endsWith(':last-child');
    const simple=last.replace(/:last-child$/,''); let found=[];
    if(simple.startsWith('.'))found=elements.filter(n=>n.classList.contains(simple.slice(1)));
    else {const m=simple.match(/^\[([^\]]+)\]$/);found=m?elements.filter(n=>m[1] in n.attrs):elements.filter(n=>n.tagName===simple.toUpperCase());}
    return lastChild?found.slice(-1):found;
  };
  const errors=[];
  const bridgeCalls={exports:[],imports:0,blobCreates:0,downloadBlobs:[],storageWrites:0},globalListeners={};
  class MockBlob extends Blob {constructor(...args){super(...args);bridgeCalls.blobCreates++;}}
  class MockURL extends URL {static createObjectURL(blob){bridgeCalls.downloadBlobs.push(blob);return 'blob:qa-backup';}static revokeObjectURL(){}}
  const context={document:{body:new Element('body'),documentElement:new Element('html'),createElement:t=>new Element(t),getElementById:id=>byId.get(id)||null,querySelector:s=>query(s)[0]||null,querySelectorAll:query},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{storage.set(k,String(v));bridgeCalls.storageWrites++;}},location:{href:nativeMode?'https://appassets.androidplatform.net/index.html':'https://example.test/'},URL:MockURL,Blob:MockBlob,console:{log(){},warn(){},error:(...args)=>errors.push(args)},fetch:async()=>({ok:true,json:async()=>structuredClone(data)}),setTimeout:()=>1,clearTimeout(){},Date,Math,addEventListener:(event,listener)=>{(globalListeners[event]??=[]).push(listener);}};
  if(nativeMode)context.AndroidBridge={exportBackup:json=>bridgeCalls.exports.push(json),importBackup:()=>{bridgeCalls.imports++;}};
  context.globalThis=context;
  context.window=context;
  const instrument=js.replace(/\n  init\(\);\n\}\)\(\);\s*$/,`\n  globalThis.__qa={init,applyFilters,viewChange,submit,selfRate,next,importBackup,get queue(){return queue;},get current(){return queue[index];},get state(){return state;},setFilter(values){filter={...filter,...values};applyFilters();}};\n})();`);
  assert.notEqual(instrument,js,'QA instrumentation target missing');
  vm.runInNewContext(instrument,context,{filename:'app.js'});
  if(beforeInit)await beforeInit({app:context.__qa,nativeApp:context.ZhizhengApp,storage});
  await context.__qa.init();assert.equal(errors.length,0,JSON.stringify(errors));
  return {app:context.__qa,nativeApp:context.ZhizhengApp,$:id=>byId.get(id),elements,errors,bridgeCalls,context,storage,globalListeners};
}
const web=await launch(),{$,app}=web;
assert.equal(app.queue.length,760);assert.equal($('answer-panel').hidden,true);
assert.equal($('question-card').hidden,false);
let current=app.current;assert.equal(current.type,'single');
const choose=letters=>{for(const letter of letters){const n=$('question-options').children.find(n=>n.children[0]?.textContent===letter);assert(n);n.click();}};
choose(current.answer);$('submit-answer').click();assert.equal(app.state.records[current.id].correct,true);assert.equal($('answer-panel').hidden,false);
app.setFilter({year:'2026',type:'multiple'});current=app.current;
choose(current.answer.slice(0,1));$('submit-answer').click();assert.equal(app.state.records[current.id].correct,false,'partial multiple answer must be wrong');
assert.equal(Number($('wrong-count').textContent),1);
$('retry-answer').click();choose(current.answer);$('submit-answer').click();assert.equal(app.state.records[current.id].correct,true);assert.equal(Number($('wrong-count').textContent),0);
$('favorite-button').click();app.viewChange('favorite');assert.equal(app.queue.length,1);assert.equal(app.current.id,current.id);
app.viewChange('paper');assert.equal(app.queue.length,38);assert.equal(app.current.number,1);
app.setFilter({type:'analysis'});current=app.current;assert.equal($('answer-panel').hidden,true);
$('analysis-answer').value='测试作答草稿';$('analysis-answer').dispatch('input');$('submit-answer').click();assert.equal(app.state.records[current.id].text,'测试作答草稿');
app.selfRate(false);assert.equal(app.state.records[current.id].correct,false);app.selfRate(true);assert.equal(app.state.records[current.id].correct,true);
app.setFilter({view:'all',subject:'马原',year:'all',type:'all'});assert(app.queue.length>0);assert(app.queue.every(q=>q.subjectKey==='马原'));
const topic=app.current.topic;app.setFilter({topic});assert(app.queue.every(q=>q.topic===topic||q.tags.includes(topic)));
app.setFilter({subject:'all',topic:'all',keyword:'不会存在的筛选词1234567'});assert.equal(app.queue.length,0);assert.equal($('empty-state').hidden,false);
app.viewChange('all');app.next(7);const resumeId=app.current.id;
const again=await launch();assert.equal(again.app.current.id,resumeId,'resume should survive reload');
const saved=Object.keys(app.state.records).length;
await app.importBackup({size:1,text:async()=>JSON.stringify({records:{'unknown-id':{correct:true}},favorites:['unknown-id']})});assert.equal(Object.keys(app.state.records).length,saved);
// Capture the real web export format, then migrate it through the native string callback.
$('export-backup').click();assert.equal(web.bridgeCalls.downloadBlobs.length,1,'web export should still use a downloadable Blob');
const webBackup=await web.bridgeCalls.downloadBlobs[0].text(),webPayload=JSON.parse(webBackup);
const nativeStorage=new Map(),native=await launch({nativeMode:true,storage:nativeStorage});
assert(native.context.document.body.classList.contains('native-app'),'native mode should activate Android styling');
assert.equal(native.$('page-description').textContent,'760 道真题 · 53 个专题 · 无需联网');
native.app.setFilter({year:'2007',type:'single'});const nativeOnly=native.app.current;
for(const letter of nativeOnly.answer){const option=native.$('question-options').children.find(n=>n.children[0]?.textContent===letter);assert(option);option.click();}
native.$('submit-answer').click();assert.equal(native.app.state.records[nativeOnly.id].correct,true);
const nativeBlobCount=native.bridgeCalls.blobCreates;
native.$('export-backup').click();assert.equal(native.bridgeCalls.exports.length,1,'Android export should call its bridge');
assert.equal(typeof native.bridgeCalls.exports[0],'string');assert.equal(JSON.parse(native.bridgeCalls.exports[0]).records[nativeOnly.id].correct,true);
assert.equal(native.bridgeCalls.blobCreates,nativeBlobCount,'Android export must not create a web Blob');
assert.equal(native.bridgeCalls.downloadBlobs.length,0,'Android export must not trigger a Blob download');
native.$('import-backup').click();assert.equal(native.bridgeCalls.imports,1,'Android import button should open the native picker');
assert.equal(native.$('backup-file').clickCount||0,0,'Android import should not click the browser file input');
await native.nativeApp.onImportBackup(webBackup);
for(const [id,record] of Object.entries(webPayload.records))assert.equal(native.app.state.records[id].correct,record.correct,`web-to-native record ${id}`);
assert.equal(native.app.state.records[nativeOnly.id].correct,true,'native import must merge rather than replace existing records');
for(const id of webPayload.favorites)assert(native.app.state.favorites.includes(id),'web favorites should migrate');
const flushFavorite=data.questions.find(q=>!native.app.state.favorites.includes(q.id)).id;
native.app.state.favorites.push(flushFavorite);const writesBefore=native.bridgeCalls.storageWrites;
native.nativeApp.flushState();assert.equal(native.bridgeCalls.storageWrites,writesBefore+1,'flushState must persist current state');
assert(JSON.parse(nativeStorage.get('zhizheng-politics-v1')).favorites.includes(flushFavorite));
assert.equal(native.globalListeners.pagehide.length,1,'Android pagehide should register the persistence hook');
const nativeReload=await launch({nativeMode:true,storage:nativeStorage});assert(nativeReload.app.state.favorites.includes(flushFavorite),'native records should survive a reload');
const early=await launch({nativeMode:true,storage:new Map(),beforeInit:({app,nativeApp,storage})=>{
  nativeApp.onImportBackup(webBackup);assert.equal(Object.keys(app.state.records).length,0,'pre-init callback must queue records');assert.equal(storage.size,0,'pre-init callback must not save against an empty question list');
}});
for(const [id,record] of Object.entries(webPayload.records))assert.equal(early.app.state.records[id].correct,record.correct,`queued native import ${id}`);
assert.equal(Object.keys(early.app.state.records).length,Object.keys(webPayload.records).length,'queued import should merge after all question IDs are available');
assert.equal(early.app.queue.length,760);
console.log(JSON.stringify({questions:760,years:20,checks:['DOM references','complete papers','initial hidden answers','single grading','multiple exact match','retry and wrong-book update','favorites','whole paper ordering','analysis drafts and self rating','subject/topic/search filters','resume after reload','backup unknown-ID validation','web export format','Android bridge export without Blob download','Android bridge import picker','web-to-Android backup merge','pre-init native import queue','native flushState and reload persistence'],result:'PASS'},null,2));
