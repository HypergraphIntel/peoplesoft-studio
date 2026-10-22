import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {replaceFile} from '../util/replaceFile.js';

test('atomic publication keeps the prior history until a Windows sharing conflict clears',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'psft-replace-')),old=path.join(root,'history'),next=path.join(root,'next');
 await fs.writeFile(old,'retained checkpoint');await fs.writeFile(next,'new checkpoint');
 const rename=fs.rename;let calls=0;
 fs.rename=async(from,to)=>{calls++;if(calls===1){assert.equal(await fs.readFile(old,'utf8'),'retained checkpoint');throw Object.assign(new Error('Sharing conflict'),{code:'EPERM'});}return rename(from,to);};
 try{
  if(process.platform==='win32'){await replaceFile(next,old);assert.equal(await fs.readFile(old,'utf8'),'new checkpoint');assert.equal(calls,2);}
  else{await assert.rejects(replaceFile(next,old),{code:'EPERM'});assert.equal(calls,1);assert.equal(await fs.readFile(old,'utf8'),'retained checkpoint');}
 }finally{fs.rename=rename;await fs.rm(root,{recursive:true,force:true});}
});
test('permanent storage errors preserve both files and are never retried',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'psft-replace-')),old=path.join(root,'history'),next=path.join(root,'next');
 await fs.writeFile(old,'retained checkpoint');await fs.writeFile(next,'new checkpoint');const rename=fs.rename;let calls=0;
 fs.rename=async()=>{calls++;throw Object.assign(new Error('Device error'),{code:'EIO'});};
 try{await assert.rejects(replaceFile(next,old),{code:'EIO'});assert.equal(calls,1);assert.equal(await fs.readFile(old,'utf8'),'retained checkpoint');assert.equal(await fs.readFile(next,'utf8'),'new checkpoint');}
 finally{fs.rename=rename;await fs.rm(root,{recursive:true,force:true});}
});
