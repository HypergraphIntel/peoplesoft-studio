import {test} from 'node:test';
import assert from 'node:assert/strict';
import {windowsShimCommand} from '../mcp/clients/common.js';

test('Windows .cmd launchers run through cmd.exe with plain arguments only',()=>{
 const shim=windowsShimCommand('codex.cmd',['mcp','add','peoplesoftStudio','--url','http://127.0.0.1:7337/mcp']);
 assert.deepEqual(shim.args,['/d','/s','/c','codex.cmd mcp add peoplesoftStudio --url http://127.0.0.1:7337/mcp']);
 assert.match(shim.command,/cmd(\.exe)?$/i);
 for(const unsafe of ['a&b','a b','"x"','%PATH%','a|b','a^b'])assert.throws(()=>windowsShimCommand('claude.cmd',['mcp',unsafe]),/cannot be passed safely/);
});
