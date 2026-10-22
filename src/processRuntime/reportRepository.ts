import type {RuntimeCredentials,RuntimeReport} from './protocol.js';
export async function boundedBody(response:Response,maxBytes:number):Promise<Uint8Array>{
 if(Number(response.headers.get('content-length')??0)>maxBytes){await response.body?.cancel();throw Error('The native response exceeds the size limit.');}
 const reader=response.body?.getReader();if(!reader)return new Uint8Array();const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maxBytes){await reader.cancel();throw Error('The native response exceeds the size limit.');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let i=0;for(const chunk of chunks){bytes.set(chunk,i);i+=chunk.length;}return bytes;
}
const decode=(s:string)=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi,(_,v:string)=>v[0]==='#'?String.fromCodePoint(parseInt(v.slice(v[1].toLowerCase()==='x'?2:1),v[1].toLowerCase()==='x'?16:10)):({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'} as Record<string,string>)[v.toLowerCase()]);
const attributes=(tag:string)=>Object.fromEntries([...tag.matchAll(/\s([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1].toLowerCase(),decode(m[2]??m[3])]));
/** Strictly bounded support for the delivered repository's form sign-in. No script execution or cross-origin credentials. */
export function reportSignIn(html:string,current:URL,original:URL):{url:URL;values:URLSearchParams}|undefined{
 if(html.length>2*1024*1024)return;
 const form=[...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi)].find(m=>{const a=attributes(' '+m[1]);return a.id==='login'&&a.name==='login'&&a.method?.toLowerCase()==='post';});
 if(!form)return;const a=attributes(' '+form[1]),url=new URL(a.action??'',current),base=/^(\/psreports\/[^/]+\/)/.exec(original.pathname)?.[1];
 if(!base||url.origin!==original.origin||url.protocol!=='https:'||url.username||url.password||url.hash||url.searchParams.get('cmd')!=='login'||![original.pathname,base].includes(url.pathname))throw Error('The native report sign-in target is unsupported. Open the report in PeopleSoft.');
 const inputs=[...form[2].matchAll(/<input\b[^>]*>/gi)].map(m=>attributes(m[0]));
 if(!inputs.some(i=>i.name==='userid')||!inputs.some(i=>i.name==='pwd'&&i.type==='password')||!inputs.some(i=>i.name==='lcsrf_token'&&i.value))return;
 const values=new URLSearchParams();for(const i of inputs)if(i.type==='hidden'&&i.name&&i.value!==undefined)values.set(i.name,i.value);
 values.set('Submit','Sign In');return {url,values};
}
interface Cookie {name:string;value:string;path:string;secure:boolean;expires:number;}
/** Cookies stay only in this operator client's memory and are sent only to the configured HTTPS origin. */
export class ReportRepository {
 private readonly cookies=new Map<string,Cookie>();private signingIn?:Promise<void>;private refused=false;
 constructor(private readonly origin:string,private readonly credentials:RuntimeCredentials,private readonly transport:typeof fetch){}
 private capture(response:Response,url:URL):void{
  for(const raw of response.headers.getSetCookie()){
   const [pair,...attrs]=raw.split(';'),equal=pair.indexOf('=');if(equal<1)continue;const name=pair.slice(0,equal).trim(),value=pair.slice(equal+1).trim();if(!/^[\w.-]+$/.test(name)||/[\r\n;]/.test(value))continue;
   let path=url.pathname.slice(0,url.pathname.lastIndexOf('/')+1)||'/',secure=false,expires=Infinity;
   for(const attr of attrs){const [k,...rest]=attr.trim().split('='),v=rest.join('=');if(k.toLowerCase()==='path'&&v.startsWith('/'))path=v;if(k.toLowerCase()==='secure')secure=true;if(k.toLowerCase()==='max-age')expires=Date.now()+Number(v)*1000;if(k.toLowerCase()==='expires'&&expires===Infinity)expires=Date.parse(v);}
   if(this.cookies.size>=40)this.cookies.clear();this.cookies.set(name+'\n'+path,{name,value,path,secure,expires});
  }
 }
 private async request(url:URL,init?:RequestInit):Promise<{response:Response;url:URL}>{
  for(let redirects=0;redirects<6;redirects++){
   if(url.origin!==this.origin||url.protocol!=='https:'||url.username||url.password)throw Error('Native report redirects must stay on the configured HTTPS origin.');
   const cookie=[...this.cookies.values()].filter(c=>c.expires>Date.now()&&(url.pathname===c.path||url.pathname.startsWith(c.path.endsWith('/')?c.path:c.path+'/'))&&(!c.secure||url.protocol==='https:')).map(c=>c.name+'='+c.value).join('; ');
   const response=await this.transport(url,{...init,headers:{...init?.headers,...(cookie?{cookie}:{})},redirect:'manual',signal:AbortSignal.timeout(45000)});this.capture(response,url);
   if([301,302,303,307,308].includes(response.status)){
    const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('Native report redirect has no location.');
    // Credentials are never replayed on redirects, including 307/308.
    if(init?.method==='POST'&&[307,308].includes(response.status))throw Error('The report sign-in requested a credential redirect. Open the report in PeopleSoft.');
    url=new URL(location,url);init=undefined;continue;
   }return {response,url};
  }throw Error('Too many native report redirects. Open the report in PeopleSoft.');
 }
 async download(report:RuntimeReport):Promise<Uint8Array>{
  const original=new URL(report.url);if(original.origin!==this.origin||original.protocol!=='https:')throw Error('This report uses another origin. Open it through the native report browser.');
  let {response,url}=await this.request(original),bytes=await boundedBody(response,20*1024*1024);
  const html=()=>/text\/html/i.test(response.headers.get('content-type')??'')||/^\s*(?:<!doctype html|<html)/i.test(new TextDecoder().decode(bytes.subarray(0,400)));
  if(response.ok&&html()){
   if(this.signingIn){await this.signingIn;}else{
    const form=reportSignIn(new TextDecoder().decode(bytes),url,original);
    if(!form||this.refused)throw Error('The report repository requires a browser sign-in. Open this file in PeopleSoft, then download it there.');
    form.values.set('userid',this.credentials.operatorId);form.values.set('pwd',this.credentials.password);
    this.signingIn=(async()=>{const result=await this.request(form.url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',origin:this.origin,referer:url.href},body:form.values.toString()});const body=new TextDecoder().decode(await boundedBody(result.response,2*1024*1024));
     if(!result.response.ok||reportSignIn(body,result.url,original)){this.refused=true;throw Error('The report repository did not accept this sign-in. Open the report in PeopleSoft.');}
    })();try{await this.signingIn;}finally{this.signingIn=undefined;}
   }
   ({response,url}=await this.request(original));bytes=await boundedBody(response,20*1024*1024);
  }
  if(!response.ok||html()||/Site name is not valid|Sign in to/i.test(new TextDecoder().decode(bytes.subarray(0,400))))throw Error('The native report repository returned a sign-in or error page. Open the file in PeopleSoft.');
  return bytes;
 }
}
