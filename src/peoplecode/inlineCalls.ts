import { disabledCommentEnd, isRemCommentStart } from './applicationClassProgram.js';

/** Curated call skeletons, not predicted SQL, variable names or documentation brackets. */
export const INLINE_CALL_SNIPPETS: Readonly<Record<string, string>> = {
  createsql: 'CreateSQL(${1:sqlText}${2:, bindValues})',
  sqlexec: 'SQLExec(${1:sqlText}${2:, bindValues}${3:, outputFields})',
  createrecord: 'CreateRecord(Record.${1:RECORD})',
  getrecord: 'GetRecord(${1:Record.RECORD})',
  getfield: 'GetField(Field.${1:FIELD})',
  getrowset: 'GetRowset(${1:Scroll.RECORD})',
  createrowset: 'CreateRowset(Record.${1:RECORD}${2:, args})',
  msgget: 'MsgGet(${1:setNumber}, ${2:messageNumber}, ${3:defaultText}${4:, args})',
  msggettext: 'MsgGetText(${1:setNumber}, ${2:messageNumber}, ${3:defaultText}${4:, args})',
  messagebox: 'MessageBox(${1:style}, ${2:title}, ${3:setNumber}, ${4:messageNumber}, ${5:defaultText}${6:, args})',
  all: 'All(${1:&field1}${2:, &field2})',
  none: 'None(${1:&field1}${2:, &field2})',
  string: 'String(${1:value})',
  value: 'Value(${1:string})',
  substring: 'Substring(${1:source}, ${2:start}, ${3:length})',
  len: 'Len(${1:string})',
  exact: 'Exact(${1:string1}, ${2:string2})',
  round: 'Round(${1:number}, ${2:places})',
  addtodate: 'AddToDate(${1:date}, ${2:years}, ${3:months}, ${4:days})',
  domodal: 'DoModal(Page.${1:PAGE}, ${2:title}, ${3:xpos}, ${4:ypos}${5:, scrollnum, row})',
  createprocessrequest: 'CreateProcessRequest(${1:processType}${2:, processName})'
};

export const callSnippetText = (snippet: string): string => snippet.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\d+/g, '');
export interface InlineCall { start:number; end:number; snippet:string; text:string }

/** Offset-preserving lexical gate; never propose executable text inside strings or comments. */
function codeAt(source:string, offset:number):boolean {
  for(let i=0;i<offset;) {
    const pair=source.slice(i,i+2);
    if(pair==='<*') {const end=disabledCommentEnd(source,i);if(end<0||end>offset)return false;i=end;continue;}
    if(pair==='/*'||pair==='/+') {const end=source.indexOf(pair==='/*'?'*/':'+/',i+2);if(end<0||end+2>offset)return false;i=end+2;continue;}
    if(pair==='//') {const end=source.indexOf('\n',i+2);if(end<0||end>offset)return false;i=end+1;continue;}
    if(isRemCommentStart(source,i)) {const end=source.indexOf(';',i+3);if(end<0||end>=offset)return false;i=end+1;continue;}
    if(source[i]==='"'||source[i]==="'") {
      const quote=source[i++];let closed=false;
      while(i<offset){if(source[i++]!==quote)continue;if(source[i]===quote){i++;continue;}closed=true;break;}
      if(!closed)return false;continue;
    }
    i++;
  }
  return true;
}

/** Only complete a bare built-in name or an empty call; preserve already authored arguments and surrounding expressions. */
export function inlineCallsAt(source:string, offset:number):InlineCall[] {
  if(!Number.isInteger(offset)||offset<0||offset>source.length)return [];
  const lineStart=source.lastIndexOf('\n',offset-1)+1, prefix=source.slice(lineStart,offset);
  const match=/([A-Za-z_][A-Za-z0-9_]*)[ \t]*(\([ \t]*)?$/.exec(prefix);
  if(!match||match[1].length<3)return [];
  const start=lineStart+match.index, before=source.slice(lineStart,start), previous=source[start-1]??'';
  if(/[\w.&%:#@$]/.test(previous)||/\b(?:function|method|class|interface|property)\s*$/i.test(before))return [];
  let prior=start-1;while(prior>=0&&/\s/.test(source[prior]))prior--;
  if(prior>=0&&/[.:&%]/.test(source[prior]))return [];
  const name=match[1].toLowerCase();
  const candidates=Object.entries(INLINE_CALL_SNIPPETS).filter(([n])=>match[2]?n===name:n.startsWith(name));
  if(!candidates.length||!codeAt(source,start))return [];
  const lineEnd=source.indexOf('\n',offset), tail=source.slice(offset,lineEnd<0?undefined:lineEnd).replace(/\r$/,'');
  const closing=match[2]?/^[ \t]*\)/.exec(tail):/^[ \t]*\([ \t]*\)/.exec(tail);
  // An authored argument or the middle of another word is never replacement material.
  if(match[2]&&!closing&&tail.trim())return [];
  if(match[2]&&!closing&&lineEnd>=0) {
    const next=source.slice(lineEnd+1).trimStart();
    if(next&&!/^(?:end-|Else\b|Until\b|When\b)/i.test(next))return [];
  }
  if(!closing&&tail.trim()&&!/^[ \t]*[),;]/.test(tail))return [];
  if(!match[2]&&!closing&&tail.trim().startsWith('('))return [];
  let end=offset+(closing?.[0].length??0);
  const rest=source.slice(end,lineEnd<0?undefined:lineEnd).replace(/\r$/,'');
  const wholeLine=/^\s*$/.test(before)||/^\s*(?:(?:Local|Global|Component)\s+[\w: ]+\s+)?&[\w#]+\s*=\s*$/i.test(before)||/^\s*Return\s+$/i.test(before);
  const terminate=wholeLine&&/^[ \t]*;?[ \t]*$/.test(rest);
  if(terminate)end+=(/^[ \t]*;/.exec(rest)?.[0].length??0);
  return candidates.map(([,base])=>{const snippet=base+(terminate?';':'')+'$0';return {start,end,snippet,text:callSnippetText(snippet)};});
}
