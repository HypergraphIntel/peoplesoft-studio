import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newQueryDocument,applyQueryOp} from '../model/queryDocument.js';
import {renderQueryDesigner} from '../editors/queryDesignerHtml.js';
import {readFileSync} from 'node:fs';

const metadata={DESCR:{type:0,length:30,decimalPositions:0,format:6,shortName:'Descr',longName:'Description',useEdit:0,editTable:'',labels:[{id:'DESCR',isDefault:true,shortName:'Descr',longName:'Description'}]}};
test('query grids escape stored text and returned data; host messages expose operations, never raw SQL',()=>{
 let view=applyQueryOp(newQueryDocument('ZZ_QUERY','JARED','AAP_TBL'),{kind:'select',field:'DESCR',selected:true},metadata);
 view=applyQueryOp(view,{kind:'heading',field:'DESCR',mode:'text',text:'</script><img src=x onerror=alert(1)>'},metadata);
 const html=renderQueryDesigner('ZZ_QUERY','HRDMO',view,metadata,{editable:true,result:{sql:'SELECT A.DESCR FROM PS_AAP_TBL A',rows:[{DESCR:'<script>bad()</script>'}],truncated:false,maxRows:500,ms:1}});
 assert(!html.includes('<img src=x'));
 assert(!html.includes('<script>bad()'));
 assert(html.includes('&lt;script&gt;bad()&lt;/script&gt;'));
 assert(html.includes("kind:'run',values,limit:"));
 assert(!html.includes("kind:'run',sql:"));
 assert(html.includes('data-select="DESCR"'));
 const readOnly=renderQueryDesigner('ZZ_QUERY','HRDMO',view,metadata);
 assert(!readOnly.includes('data-select="DESCR"'));
 assert(readOnly.includes('Read only'));
});

test('result cells follow native projection names for aggregates, expressions, translates and duplicate fields',()=>{
 let view=newQueryDocument('ZZ_QUERY','JARED','AAP_TBL');
 view=applyQueryOp(view,{kind:'select',field:'DESCR',selected:true},metadata);
 const fields=[view.fields[0],{...view.fields[0],FIELDNAME:'FEMALE_GOAL',COLUMNNUM:2},{...view.fields[0],FIELDNAME:' ',COLUMNNUM:3},{...view.fields[0],FIELDNAME:'EFF_STATUS',COLUMNNUM:4},{...view.fields[0],COLUMNNUM:5}];
 const html=renderQueryDesigner('ZZ_QUERY','HRDMO',{...view,fields},metadata,{plan:{sql:'SELECT ...',columns:fields,prompts:[]},result:{sql:'SELECT ...',rows:[{DESCR:'First','AVG(A.FEMALE_GOAL)':1.5,'A.FEMALE_GOAL*2':46,XLATSHORTNAME:'Active',DESCR_1:'Second'}],columnNames:['DESCR','AVG(A.FEMALE_GOAL)','A.FEMALE_GOAL*2','XLATSHORTNAME','DESCR_1'],truncated:false,maxRows:500,ms:1}});
 assert(html.includes('<td>First</td><td>1.5</td><td>46</td><td>Active</td><td>Second</td>'));
});

test('expression submit reads the length input despite the native form collection length property',()=>{
 const {runInNewContext}=require('node:vm') as typeof import('node:vm');
 const html=renderQueryDesigner('ZZ_QUERY','HRDMO',newQueryDocument('ZZ_QUERY','JARED','AAP_TBL'),metadata,{editable:true});
 let submit: (e: unknown)=>void=()=>{throw Error('Expression submit listener missing');};
 const messages: unknown[]=[];
 const document={body:{setAttribute:()=>{}},querySelectorAll:()=>[],querySelector:(selector: string)=>selector==='#expression'?{addEventListener:(_kind: string,fn: typeof submit)=>submit=fn}:selector==='#status'?{hidden:true,textContent:''}:null};
 runInNewContext(/<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)![1],{document,window:{},acquireVsCodeApi:()=>({getState:()=>({}),setState:()=>{},postMessage:(m: unknown)=>messages.push(m)})});
 const controls={length:5,text:{value:'A.FEMALE_GOAL * 2'},type:{value:'number'},decimals:{value:'2'},namedItem:(name: string)=>name==='length'?{value:'7'}:null};
 submit({preventDefault:()=>{},target:{elements:controls}});
 assert.deepEqual(JSON.parse(JSON.stringify(messages)),[{kind:'op',op:{kind:'expression',text:'A.FEMALE_GOAL * 2',type:'number',length:7,decimalPositions:2}}]);
});

test('designer edits joins, unions, subqueries, aggregates, translates and expressions as typed operations',()=>{
 const load=(name: string)=>{const t=JSON.parse(readFileSync(`src/test/fixtures/query/${name}-after.json`,'utf8')).tables;
  return {query:t.PSQRYDEFN[0],selects:t.PSQRYSELECT,records:t.PSQRYRECORD,fields:t.PSQRYFIELD,criteria:t.PSQRYCRITERIA,expressions:t.PSQRYEXPR,binds:t.PSQRYBIND};};
 const f=(type: number, length: number, longName: string)=>({type,length,decimalPositions:0,format:0,shortName:longName,longName,useEdit:0,editTable:'',labels:[]});
 const year={ESTABID:f(0,12,'Establishment ID'),START_DT:f(4,10,'Start Date'),FEMALE_GOAL:f(2,6,'Female Goal')};
 const tbl={ESTABID:f(0,12,'Establishment ID'),DESCR:f(0,30,'Description')};
 const sub=renderQueryDesigner('ZZ_QRY_SUB01','HRDMO',load('qsq02-exists'),year,{editable:true,records:{AAP_YEAR:year,AAP_TBL:tbl}});
 assert.match(sub,/data-criteria="criteria" data-sel="1"/);
 assert.match(sub,/data-criteria="having" data-sel="1"/);
 assert(sub.includes('"subquery":{"record":"AAP_TBL","field":"ESTABID","criteria":[{"operator":"equal","field":"ESTABID","value":{"field":"A.ESTABID"}}]}'));
 assert(!sub.includes('data-select="B.ESTABID"'),'subquery records are edited through their operand');
 const agg=renderQueryDesigner('ZZ_QRY_AGG01','HRDMO',load('qag05-where-and-having'),year,{editable:true,records:{AAP_YEAR:year}});
 assert.match(agg,/data-aggregate="FEMALE_GOAL"[^]*<option value="average" selected>/);
 assert.match(agg,/data-distinct="1" checked/);
 const union=renderQueryDesigner('ZZ_QRY_UNION01','HRDMO',load('qun01-union'),tbl,{editable:true,records:{AAP_TBL:tbl,AAP_YEAR:year}});
 assert(union.includes('data-select="B.ESTABID" checked'));
 assert.match(union,/data-criteria="criteria" data-sel="2"/);
 const estab={ESTABID:f(0,12,'Establishment ID'),EFFDT:f(4,10,'Effective Date'),EFF_STATUS:f(0,1,'Status')};
 const xlat=renderQueryDesigner('ZZ_QRY_XLAT01','HRDMO',load('qxl01-translate'),estab,{editable:true,records:{ESTAB_TBL:estab}});
 assert.match(xlat,/data-translate="EFF_STATUS"[^]*<option value="long" selected>[^]*<option value="EFFDT" selected>/);
 const expr=renderQueryDesigner('ZZ_QRY_EXPR01','HRDMO',load('qex03-expression-criterion'),year,{editable:true,records:{AAP_YEAR:year}});
 assert(expr.includes('"expression":"5 * 2"'));
 assert(expr.includes('Num7'));
});

// Run the rendered criteria editor script against a minimal DOM: it must rebuild the stored criteria
// as rows and post them back unchanged as a typed operation, and an added row must post too.
test('rendered criteria editor posts the described criteria back as a typed criteria operation',()=>{
 const {runInNewContext}=require('node:vm') as typeof import('node:vm');
 const t=JSON.parse(readFileSync('src/test/fixtures/query/qsq02-exists-after.json','utf8')).tables;
 const view={query:t.PSQRYDEFN[0],selects:t.PSQRYSELECT,records:t.PSQRYRECORD,fields:t.PSQRYFIELD,criteria:t.PSQRYCRITERIA,expressions:t.PSQRYEXPR,binds:t.PSQRYBIND};
 const f=(type: number, length: number)=>({type,length,decimalPositions:0,format:0,shortName:'x',longName:'x',useEdit:0,editTable:'',labels:[]});
 const html=renderQueryDesigner('ZZ_QRY_SUB01','HRDMO',view,{ESTABID:f(0,12)},{editable:true,records:{AAP_YEAR:{ESTABID:f(0,12)},AAP_TBL:{ESTABID:f(0,12)}}});
 class El {
  children: El[]=[]; attrs: Record<string,string>={}; listeners: Record<string,(e?: unknown)=>void>={}; value=''; checked=false; hidden=false; textContent=''; parent?: El;
  dataset: Record<string,string>={};
  constructor(public tag: string, public name='') {}
  set innerHTML(markup: string) { const m=/<(input|select|button)\b([^>]*)>/.exec(markup); if (m) this.append(new El(m[1],/name="([^"]+)"/.exec(m[2])?.[1] ?? '')); }
  append(...els: El[]) { for (const el of els) { el.parent=this; this.children.push(el); } }
  remove() { if (this.parent) this.parent.children=this.parent.children.filter(c=>c!==this); }
  all(): El[] { return this.children.flatMap(c=>[c,...c.all()]); }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel: string): El[] { const name=/^\[name=(\w+)\]$/.exec(sel); return this.all().filter(e=>name ? e.name===name[1] : sel==='tr' ? e.tag==='tr' : sel==='button' ? e.tag==='button' : sel==='tbody' ? e.tag==='tbody' : sel==='[data-add-row]' ? e.dataset.addRow!==undefined : sel==='[data-apply-criteria]' ? e.dataset.applyCriteria!==undefined : false); }
  addEventListener(kind: string, fn: (e?: unknown)=>void) { this.listeners[kind]=fn; }
  setAttribute(k: string, v: string) { this.attrs[k]=v; }
 }
 const sections=[...html.matchAll(/<section class="criteria-editor" data-criteria="(\w+)" data-sel="(\d+)">/g)].map(m=>{
  const s=new El('section'); s.dataset={criteria:m[1],sel:m[2]}; const body=new El('tbody'), add=new El('button'), apply=new El('button');
  add.dataset={addRow:''}; apply.dataset={applyCriteria:''}; s.append(body,add,apply); return s;
 });
 const status=new El('div'), messages: unknown[]=[];
 const document={body:new El('body'),createElement:(tag: string)=>new El(tag),
  querySelector:(sel: string)=>sel==='#status'?status:null,
  querySelectorAll:(sel: string)=>sel==='[data-criteria]'?sections:[]};
 const script=/<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)![1];
 runInNewContext(script,{document,window:{},JSON,Number,String,Object,acquireVsCodeApi:()=>({postMessage:(m: unknown)=>messages.push(m),getState:()=>({}),setState:()=>{}})});
 const where=sections.find(s=>s.dataset.criteria==='criteria')!;
 assert.equal(where.querySelectorAll('tr').length,2);
 where.querySelector('[data-apply-criteria]')!.listeners.click();
 const posted=JSON.parse(JSON.stringify(messages.pop())) as {kind:string;op:{kind:string;criteria:unknown}};
 assert.deepEqual(posted,{kind:'op',op:{kind:'criteria',criteria:[
  {operator:'inList',field:'ESTABID',value:{subquery:{record:'AAP_TBL',field:'ESTABID'}}},
  {operator:'exists',logical:'AND',value:{subquery:{record:'AAP_TBL',field:'ESTABID',criteria:[{operator:'equal',field:'ESTABID',value:{field:'A.ESTABID'}}]}}}]}});
 where.querySelector('[data-add-row]')!.listeners.click();
 const row=where.querySelectorAll('tr')[2], q=(n: string)=>row.querySelector(`[name=${n}]`)!;
 q('field').value='a.estabid'; q('operator').value='like'; q('kind').value='constant'; q('value').value='K%'; q('logical').value='OR';
 where.querySelector('[data-apply-criteria]')!.listeners.click();
 const again=JSON.parse(JSON.stringify(messages.pop())) as {op:{criteria:unknown[]}};
 assert.deepEqual(again.op.criteria[2],{operator:'like',field:'A.ESTABID',logical:'OR',value:{constant:'K%'}});
});
