/** A scratch native save runner. Only creates the AE shell; its PeopleCode is compiled on the VM. */
import assert from 'node:assert/strict';
import Module,{createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const root=process.cwd();const {createStub}=await import(pathToFileURL(join(root,'scripts/vscode-stub.mjs')).href);const {vscode}=createStub();const original=(Module as any)._load;(Module as any)._load=function(name:string,parent:unknown,main:boolean){return name==='vscode'?vscode:original.call(this,name,parent,main)};
const require=createRequire(join(root,'package.json'));const {DatabaseProvider}=require('./src/providers/database.ts');const {newProgram,newAction}=require('./src/model/aeDocument.ts');
const p=new DatabaseProvider({name:'IB native lab',platform:'oracle',connectString:'127.0.0.1:15210/hrdmo',user:process.env.PSLAB_ACCESSID,password:process.env.PSLAB_ACCESSPSWD});await p.connect();
try{const doc=newProgram('ZZ_IB_NATIVE');assert.equal(await p.readAppEngineDocument(doc.name),undefined,'Scratch runner already exists.');doc.program.descr='IB native save calibration';doc.program.disableRestart=true;doc.sections[0].variants[0].steps[0].actions=[newAction('P')];doc.sections[0].variants[0].steps[0].onReturn='A';await p.saveAppEngineDocument({doc,openedToken:'absent',operatorId:'JARED'});console.log('Created ZZ_IB_NATIVE shell for native VM compilation.');}finally{await p.dispose();}
