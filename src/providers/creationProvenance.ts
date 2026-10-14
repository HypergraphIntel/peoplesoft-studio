import type {DefinitionKey} from '../model/definitions.js';

/** A receipt is useful only while the database still has the version/stamp Studio verified. */
export interface DefinitionStamp {version:number;operator:string;updated:string}
export interface CreationReceipt {scope:string;key:DefinitionKey;createdAt:string;stamp:DefinitionStamp}
export interface CreationStore {
  find(scope:string,key:DefinitionKey):Promise<CreationReceipt|undefined>;
  put(receipt:CreationReceipt):Promise<void>;
}
let store:CreationStore|undefined;
export function setCreationStore(value:CreationStore|undefined):void {store=value;}
export function creationKey(scope:string,key:DefinitionKey):string {return JSON.stringify([scope,key.type,key.parts]);}
export function sameDefinitionStamp(a:DefinitionStamp,b:DefinitionStamp):boolean {
  return a.version===b.version && a.operator===b.operator && a.updated===b.updated;
}
export async function witnessedCreation(scope:string,key:DefinitionKey,stamp:DefinitionStamp):Promise<CreationReceipt|undefined> {
  const receipt=await store?.find(scope,key);
  return receipt && sameDefinitionStamp(receipt.stamp,stamp)?receipt:undefined;
}
export async function recordCreation(scope:string,key:DefinitionKey,stamp:DefinitionStamp,previous?:CreationReceipt):Promise<void> {
  if(!store)return;
  await store.put({scope,key:{type:key.type,parts:[...key.parts]},createdAt:previous?.createdAt??new Date().toISOString(),stamp:{...stamp}});
}
