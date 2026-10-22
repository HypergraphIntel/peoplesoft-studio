import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {RuntimeRequest,RuntimeRun} from './protocol.js';
import {syncDirectory} from '../util/syncDirectory.js';
export interface RuntimeIntent {
 schema:1; id:string; connection:string; endpoint:string; operator:string; identity:string;
 request:RuntimeRequest; afterInstance:number; baselineToken:string; description:string; created:string; expires:string; confirmationHash:string;
 state:'PREPARED'|'CANCELLED'|'INVALIDATED'|'SUBMITTING'|'SUBMITTED'|'UNCERTAIN';
 instance?:number; run?:RuntimeRun; error?:string; updated:string;
}
export function confirmationHash(intent:Pick<RuntimeIntent,'id'|'connection'|'endpoint'|'operator'|'identity'|'request'|'baselineToken'|'afterInstance'|'created'|'expires'>):string{
 return createHash('sha256').update(JSON.stringify([intent.id,intent.connection,intent.endpoint,intent.operator,intent.identity,intent.request,intent.baselineToken,intent.afterInstance,intent.created,intent.expires])).digest('hex');
}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
/** Durable runtime history. A live/unknown process lock is never removed. */
export class RuntimeStore {
 constructor(readonly root:string){}
 private location(id:string):string{if(!/^[0-9a-f-]{36}$/.test(id))throw Error('Invalid process request ID.');return path.join(this.root,id+'.json');}
 async init():Promise<void>{await fs.mkdir(this.root,{recursive:true,mode:0o700});}
 async exclusive<T>(fn:()=>Promise<T>):Promise<T>{
  await this.init();const lock=path.join(this.root,'writer.lock');let handle;
  try{handle=await fs.open(lock,'wx',0o600);}catch(e){
   if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;
   const recovery=path.join(this.root,'lock-recovery');try{await fs.mkdir(recovery,{mode:0o700});}catch{throw Error('Process runtime history is locked.');}
   try{const owner=await fs.readFile(lock,'utf8');if(!/^[1-9][0-9]*$/.test(owner))throw Error('Unknown runtime lock owner; inspect before retrying.');
    try{process.kill(Number(owner),0);throw Error('Another runtime action is still active.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}
    await fs.unlink(lock);handle=await fs.open(lock,'wx',0o600);
   }finally{await fs.rmdir(recovery);}
  }
  await handle.writeFile(String(process.pid));await handle.sync();
  try{return await fn();}finally{await handle.close();await fs.unlink(lock);}
 }
 async put(value:RuntimeIntent):Promise<void>{
  await this.init();if(confirmationHash(value)!==value.confirmationHash)throw Error('Process confirmation integrity mismatch.');
  const file=this.location(value.id),temp=file+'.'+randomUUID()+'.tmp',text=JSON.stringify({checksum:hash(value),value});
  if(Buffer.byteLength(text)>128*1024)throw Error('Process runtime history limit exceeded.');
  const handle=await fs.open(temp,'wx',0o600);try{await handle.writeFile(text);await handle.sync();}finally{await handle.close();}
  await fs.rename(temp,file);await syncDirectory(this.root);
 }
 async get(id:string):Promise<RuntimeIntent>{
  let envelope:any;try{envelope=JSON.parse(await fs.readFile(this.location(id),'utf8'));}catch{throw Error('Process request history was not found.');}
  const value=envelope.value;if(value?.schema!==1||value.id!==id||hash(value)!==envelope.checksum||confirmationHash(value)!==value.confirmationHash)throw Error('Process request history failed its integrity check.');return value;
 }
 async list(connection:string,operator:string):Promise<RuntimeIntent[]>{
  await this.init();const entries:RuntimeIntent[]=[];
  for(const file of await fs.readdir(this.root))if(/^[0-9a-f-]{36}\.json$/.test(file)){
   const value=await this.get(file.slice(0,-5));if(value.connection===connection&&value.operator===operator)entries.push(value);
  }return entries.sort((a,b)=>b.created.localeCompare(a.created)).slice(0,100);
 }
}
