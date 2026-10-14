import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newQueryDocument,applyQueryOp} from '../model/queryDocument.js';
import {renderQueryDesigner} from '../editors/queryDesignerHtml.js';

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
