import {DefinitionType as D} from './definitions.js';
/** Product scope is separate from connection authorization and from an individual native trial. */
export type ReleaseLevel='CORE'|'PREVIEW'|'READ_ONLY'|'PLANNED'|'NOT_EXPOSED';
export interface ReleaseSupport {level:ReleaseLevel;label:string;detail:string;target:'1.0'|'1.5'|'2.0';}
const core=(detail:string):ReleaseSupport=>({level:'CORE',label:'1.0 core candidate',detail,target:'1.0'});
const preview=(detail:string,target:'1.5'|'2.0'='1.5'):ReleaseSupport=>({level:'PREVIEW',label:'Preview',detail,target});
export const RELEASE_SUPPORT={
 target:'1.0',qualification:'IN_PROGRESS',
 primary:{database:'Oracle',toolsRelease:'8.62',nativePatch:'8.62.09',clients:['Linux x64','Windows x64']},
 compatibility:'PeopleTools 8.61.15 retains its documented bounded compatibility; it is not full 8.62 Query parity.',
 experimental:'SQL Server/DB2 and unqualified releases/patches remain experimental. macOS has no installed acceptance claim.',
 principle:'Core identifies release scope, not completed certification or permission. Exact native/installed evidence, connection gates and operation limits still apply.',
 coreWorkflows:[
  'Connect, search and open implemented definitions and project exports',
  'Authoritative-source PeopleCode editing, supported compilation, diagnostics and navigation',
  'Bounded SQL/HTML/freeform CSS editing and native readback',
  'Oracle 8.62 Query authoring and read-only execution within the calibrated scope',
  'Calibrated Record/field, AE, Page and Process metadata workflows and Oracle physical build',
  'Current bounded Change Review, history, typed inverse/redo and supported Oracle migration packages'
 ],
 limits:[
  'Structural Page/Record/AE review expansion and class lifecycle are 1.5 work; existing legacy save confirmations still apply outside review adapters.',
  'Separate-environment promotion requires its own 1.5 acceptance; package import does not copy application data or make DDL/data reversible.',
  'Run and Monitor is preview with native acceptance deferred as Low priority.',
  'Production SQL Server/DB2, cross-platform promotion, Data Migration Workbench and broader security/designer parity target 2.0.'
 ]
} as const;
export function connectionReleaseSupport(kind:string,environment?:{status:string;release?:string}):ReleaseSupport{
 if(kind==='projectFile')return {level:'READ_ONLY',label:'Project export · read only',detail:'Scope is the file; no database writes or release certification.',target:'1.0'};
 if(kind!=='oracle')return preview('Native PeopleSoft platform save/recovery certification is incomplete; documented experimental paths only.','2.0');
 if(environment?.status!=='available')return preview('Connect or test this Oracle connection to inspect its native PeopleTools release.');
 if(environment.release==='8.62.09')return core('Primary Oracle/PeopleTools profile. Qualification is in progress; bounded operation checks and native permissions still apply.');
 if(environment.release==='8.61.15')return preview(RELEASE_SUPPORT.compatibility);
 return preview('This release/patch is not the primary native qualification profile. Schema compatibility and compiler support do not certify every operation.');
}
export function toolReleaseSupport(label:string,planned=false):ReleaseSupport{
 if(planned)return {level:'PLANNED',label:'Planned',detail:'No implemented workflow; no authority to write.',target:label==='Data Migration Workbench'?'2.0':'1.5'};
 if(['PS Query','Process Definitions','Import Migration Package…'].includes(label))return core(label==='Import Migration Package…'?'Bounded Oracle definition packages and review; separate-environment promotion remains preview.':'Bounded Oracle metadata/query workflow; runtime submission is separate.');
 if(label==='Run and Monitor')return preview('Native scheduler acceptance is deferred as Low priority. Do not infer runtime acceptance from metadata or fixture tests.');
 if(label==='Data Mover Scripts')return {level:'READ_ONLY',label:'Templates only',detail:'Creates local script templates; Studio does not execute Data Mover.',target:'1.0'};
 return preview('Available within documented native limits; not part of the primary core qualification contract.',label==='SAML'?'2.0':'1.5');
}
const coreTypes=new Set([D.Record,D.Field,D.TranslateValue,D.Page,D.Query,D.ProcessDefinition,D.SqlDefinition,D.HtmlDefinition,D.StyleSheet,D.AppEngineProgram,D.AppEngineSection,D.Project,D.RecordPeopleCode,D.MenuPeopleCode,D.PagePeopleCode,D.ComponentPeopleCode,D.ComponentRecordPeopleCode,D.ComponentRecordFieldPeopleCode,D.AppEnginePeopleCode,D.ApplicationClassPeopleCode]);
export function definitionReleaseSupport(type:D,operation:string,exposed:boolean):ReleaseSupport{
 if(!exposed)return {level:'NOT_EXPOSED',label:'Not exposed',detail:'No tool route is available for this operation.',target:'1.5'};
 if(operation==='execute'&&(type===D.ProcessDefinition||type===D.AppEngineProgram))return toolReleaseSupport('Run and Monitor');
 if(operation==='migrate')return core('Bounded Oracle package adapters retain their recorded native scope. Separate-environment promotion remains preview pending its own 1.5 qualification.');
 if(type===D.ApplicationClassPeopleCode&&['create','copy','rename','delete'].includes(operation))return preview('Standalone class lifecycle review needs combined package/class metadata and parent side effects. Bounded package migration has a separate contract.');
 if([D.MenuPeopleCode,D.ComponentRecordPeopleCode].includes(type)&&['create','edit','copy','rename','delete'].includes(operation))return preview('This event writer retains its existing guards, but standalone installed/native reviewed save acceptance is not recorded. Menu migration has separate native evidence.');
 if(coreTypes.has(type))return core('Bounded operations on the declared Oracle profile; consult the exact tool schema and documented review/legacy-save limits. Core qualification is in progress.');
 return preview('A routed tool is not certification. Consult the family reference and native evidence.');
}
