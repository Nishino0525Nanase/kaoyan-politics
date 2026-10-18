import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
const js = fs.readFileSync(path.join(root,'dist/app.js'),'utf8');
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
  click(){if(!this.disabled)this.dispatch('click');}scrollIntoView(){}showModal(){this.open=true;}close(){this.open=false;}getBoundingClientRect(){return {left:0,right:100,top:0,bottom:100};}
}
const persistent = new Map();
async function launch(){
  const elements=[],byId=new Map();
  for(const match of html.matchAll(/<([a-z][\w-]*)([^>]*)>/gi)){
    const node=new Element(match[1]);for(const a of match[2].matchAll(/([\w-]+)="([^"]*)"/g)){node.setAttribute(a[1],a[2]);if(a[1]==='id')byId.set(a[2],node);}
    node.hidden=/\bhidden\b/.test(match[2]);elements.push(node);
  }
  const query=s=>{if(s.startsWith('.'))return elements.filter(n=>n.classList.contains(s.slice(1)));const m=s.match(/^\[([^\]]+)\]$/);return m?elements.filter(n=>m[1] in n.attrs):[];};
  const errors=[];
  const context={document:{body:new Element('body'),createElement:t=>new Element(t),getElementById:id=>byId.get(id)||null,querySelector:s=>query(s)[0]||null,querySelectorAll:query},localStorage:{getItem:k=>persistent.get(k)||null,setItem:(k,v)=>persistent.set(k,String(v))},location:{href:'https://example.test/'},URL,Blob,console:{log(){},warn(){},error:(...args)=>errors.push(args)},fetch:async()=>({ok:true,json:async()=>structuredClone(data)}),setTimeout:()=>1,clearTimeout(){},Date,Math};
  context.globalThis=context;
  const instrument=js.replace(/\n  init\(\);\n\}\)\(\);\s*$/,`\n  globalThis.__qa={init,applyFilters,viewChange,submit,selfRate,next,importBackup,get queue(){return queue;},get current(){return queue[index];},get state(){return state;},setFilter(values){filter={...filter,...values};applyFilters();}};\n})();`);
  assert.notEqual(instrument,js,'QA instrumentation target missing');
  vm.runInNewContext(instrument,context,{filename:'app.js'});
  await context.__qa.init();assert.equal(errors.length,0,JSON.stringify(errors));
  return {app:context.__qa,$:id=>byId.get(id),elements,errors};
}
const {$,app}=await launch();
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
console.log(JSON.stringify({questions:760,years:20,checks:['DOM references','complete papers','initial hidden answers','single grading','multiple exact match','retry and wrong-book update','favorites','whole paper ordering','analysis drafts and self rating','subject/topic/search filters','resume after reload','backup unknown-ID validation'],result:'PASS'},null,2));
