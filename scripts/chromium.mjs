/** Resolve the browser installed by CI or by the developer. Never assume a Linux binary name. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
const exec=promisify(execFile);
export async function chromiumExecutable(){
 const explicit=process.env.PSFT_BROWSER_BIN;
 const windows=[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean)
  .flatMap(base=>[path.join(base,'Google/Chrome/Application/chrome.exe'),path.join(base,'Microsoft/Edge/Application/msedge.exe')]);
 const candidates=explicit?[explicit]:process.platform==='win32'?windows:process.platform==='darwin'?['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']:['chromium','google-chrome','google-chrome-stable','chromium-browser'];
 for(const candidate of candidates){try{const {stdout,stderr}=await exec(candidate,['--version'],{timeout:10000,maxBuffer:64000});if(/Chrom(?:e|ium)|Microsoft Edge/i.test(stdout+stderr))return candidate;}catch{}}
 throw Error(explicit?'PSFT_BROWSER_BIN does not identify a working Chrome/Chromium/Edge executable.':'Install Chrome/Chromium/Edge or set PSFT_BROWSER_BIN to its executable. Browser checks are required, not skipped.');
}
