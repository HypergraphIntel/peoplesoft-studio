import {test} from 'node:test';import assert from 'node:assert/strict';
import {RELEASE_SUPPORT,connectionReleaseSupport,toolReleaseSupport,definitionReleaseSupport} from '../model/releaseSupport.js';
import {DefinitionType as D} from '../model/definitions.js';
import {capabilityCatalog} from '../mcp/capabilityCatalog.js';
import {studioReference} from '../mcp/studioReference.js';
test('support requires observed platform/patch and distinguishes core scope from certification',()=>{
 assert.equal(connectionReleaseSupport('oracle',{status:'available',release:'8.62.09'}).level,'CORE');
 for(const release of ['8.62','8.62.08','8.63.01','8.61.15'])assert.equal(connectionReleaseSupport('oracle',{status:'available',release}).level,'PREVIEW');
 for(const status of ['loading','not-connected','error'])assert.equal(connectionReleaseSupport('oracle',{status}).level,'PREVIEW');
 for(const platform of ['mssql','db2'])assert.equal(connectionReleaseSupport(platform,{status:'available',release:'8.62.09'}).target,'2.0');
 assert.equal(connectionReleaseSupport('projectFile').level,'READ_ONLY');assert.equal(RELEASE_SUPPORT.qualification,'IN_PROGRESS');
});
test('MCP orientation and catalog carry the shared contract without certifying unexposed or runtime paths',()=>{
 assert.deepEqual(studioReference().releaseSupport,RELEASE_SUPPORT);assert.deepEqual(capabilityCatalog().releaseSupport,RELEASE_SUPPORT);
 const process=capabilityCatalog({type:D.ProcessDefinition}).entries[0] as any;
 assert.equal(process.operations.execute.releaseSupport.level,'PREVIEW');assert.equal(process.operations.execute.session,'WRITE_HOST_REQUIRED');
 assert.equal(definitionReleaseSupport(D.Query,'delete',false).level,'NOT_EXPOSED');
 const config=capabilityCatalog({kind:'configuration',query:'Run and Monitor'}).entries.find(e=>(e as any).label==='Run and Monitor') as any;
 assert.deepEqual(config.releaseSupport,toolReleaseSupport('Run and Monitor'));
 assert.equal(toolReleaseSupport('Data Migration Workbench',true).level,'PLANNED');assert.equal(toolReleaseSupport('Data Migration Workbench',true).target,'2.0');
 assert.equal(toolReleaseSupport('Data Mover Scripts').level,'READ_ONLY');
});
