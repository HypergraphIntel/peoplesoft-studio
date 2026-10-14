/** Compare complete lexical content when native compilation changes quote style or statement layout.
 * Comments and string values stay exact; numbers stay spelled as supplied. Unknown syntax refuses.
 * This is only an extra save check, never a replacement for byte/name-table roundtrip equality.
 */
function tokens(source:string):string[]|undefined {
  const out:string[]=[];
  for(let i=0;i<source.length;){
    if(/\s/.test(source[i])){i++;continue;}
    if(source.startsWith('/*',i)){
      const end=source.indexOf('*/',i+2);if(end<0)return;
      out.push('comment:'+source.slice(i,end+2).replace(/\r\n?/g,'\n'));i=end+2;continue;
    }
    if(source[i]==='"' || source[i]==="'"){
      const quote=source[i++];let value='',closed=false;
      while(i<source.length){
        const c=source[i++];if(c!==quote){value+=c;continue;}
        if(source[i]===quote){value+=quote;i++;continue;}
        closed=true;break;
      }
      if(!closed)return;out.push('string:'+value);continue;
    }
    const word=/^[A-Za-z_%&][A-Za-z0-9_%&]*/.exec(source.slice(i));
    if(word){if(word[0].toLowerCase()==='rem')return;out.push('word:'+word[0].toLowerCase());i+=word[0].length;continue;}
    const number=/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(i));
    if(number){out.push('number:'+number[0]);i+=number[0].length;continue;}
    const operator=/^(?:\*\*|<=|>=|<>|!=|[.,;:()\[\]+*/=<>-])/.exec(source.slice(i));
    if(!operator)return;out.push('operator:'+operator[0]);i+=operator[0].length;
  }
  return out;
}
export function sameLexicalSource(a:string,b:string):boolean {
  const left=tokens(a),right=tokens(b);
  return left!==undefined && right!==undefined && JSON.stringify(left)===JSON.stringify(right);
}
