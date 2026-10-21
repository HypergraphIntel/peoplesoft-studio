/** Native workbench UI checks. CDP is loopback-only in the isolated test host; credential arguments are never logged. */
const fs = require('node:fs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.connectWorkbench = async function (url) {
  let target;
  for (let i = 0; i < 100; i++) {
    const targets = await fetch(url + '/json/list').then((r) => r.json()).catch(() => []);
    target = targets.find((t) => t.type === 'page' && /workbench/.test(t.url));
    if (target) break;
    await sleep(50);
  }
  if (!target) throw new Error('The isolated workbench renderer did not appear.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const waiting = new Map();
  socket.addEventListener('message', (e) => {
    const message = JSON.parse(String(e.data));
    const request = waiting.get(message.id);
    if (!request) return;
    waiting.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`Workbench UI request timed out: ${method}`)); }, 10000);
    waiting.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const window = (await send('Runtime.evaluate', { expression: 'window' })).result.objectId;
  const call = async (fn, ...args) => {
    const result = await send('Runtime.callFunctionOn', { objectId: window, functionDeclaration: String(fn), arguments: args.map((value) => ({ value })), returnByValue: true });
    if (result.exceptionDetails) throw new Error('Workbench UI operation failed.');
    return result.result.value;
  };
  const key = async (name, code) => {
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, ...(name === 'Enter' && type === 'keyDown' ? { text: '\r', unmodifiedText: '\r' } : {}) });
  };
  return {
    async terminalKey(name) {
      if(!['Enter','Escape'].includes(name))throw Error('Unsupported terminal key');
      await call(function(){
        const input=[...document.querySelectorAll('.xterm-helper-textarea')].find(e=>e.getClientRects().length);
        if(!input)throw Error('Visible terminal input missing');input.focus();
      });
      await key(name,name==='Enter'?13:27);
    },
    async webviewAction(match, action = 'inspect', value) {
      const expression = `(() => {
        const docs=[document];for(const f of document.querySelectorAll('iframe')){try{if(f.contentDocument)docs.push(f.contentDocument)}catch{}}
        const doc=docs.find(d=>d.body?.innerText.includes(${JSON.stringify(match)}));if(!doc)return null;
        const action=${JSON.stringify(action)},value=${JSON.stringify(value ?? '')};
        if(action==='expandObjects'){
          for(const row of [...doc.querySelectorAll('tr.obj:not(.open)')])row.click();
        }else if(action==='click'){
          const b=[...doc.querySelectorAll('button')].find(b=>b.textContent.trim()===value||b.dataset.action===value||b.dataset.selectObject===value||b.dataset.select===value);
          if(!b||b.disabled)throw Error('Button unavailable: '+value);const details=b.closest('details');if(details&&!details.open)details.querySelector('summary')?.click();b.scrollIntoView({block:'center'});b.click();
        }else if(action==='agent'){
          const selects=[...doc.querySelectorAll('select.agent')];if(!selects.length)throw Error('Agent picker missing');
          for(const s of selects){s.value=value;s.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));}
        }else if(action==='checkbox'){
          const b=doc.getElementById(value);if(!b||b.type!=='checkbox')throw Error('Checkbox missing');if(!b.checked)b.click();
        }
        return {title:doc.title,selectedTitle:doc.querySelector('main>section>h2')?.textContent,status:doc.body.dataset.reviewStatus,reviewToken:doc.body.dataset.reviewToken,renderNonce:doc.querySelector('script[nonce]')?.nonce,busy:doc.body.getAttribute('aria-busy'),text:doc.body.innerText,checkboxes:[...doc.querySelectorAll('input[type=checkbox]')].map(b=>({id:b.id,checked:b.checked})),buttons:[...doc.querySelectorAll('button')].map(b=>({text:b.textContent.trim(),disabled:b.disabled,action:b.dataset.action,object:b.dataset.selectObject,requestId:b.closest('article')?.dataset.id})),selects:[...doc.querySelectorAll('select')].map(s=>({value:s.value,options:[...s.options].map(o=>o.text)}))};
      })()`;
      const { targetInfos } = await send('Target.getTargets');
      for (const target of targetInfos.filter(t=>t.type==='iframe')) {
        const {sessionId}=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
        try {
          const result=await send('Runtime.evaluate',{expression,returnByValue:true},sessionId);
          if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
          if(result.result.value)return result.result.value;
          const nested=await send('Page.getFrameTree',{},sessionId),frames=[];
          const visit=tree=>{frames.push(tree.frame);(tree.childFrames??[]).forEach(visit)};visit(nested.frameTree);
          for(const frame of frames.slice(1)){
            const {executionContextId}=await send('Page.createIsolatedWorld',{frameId:frame.id,worldName:'build-acceptance'},sessionId);
            const r=await send('Runtime.evaluate',{expression,contextId:executionContextId,returnByValue:true},sessionId);
            if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);
            if(r.result.value)return r.result.value;
          }
        } finally {await send('Target.detachFromTarget',{sessionId}).catch(()=>{});}
      }
      return null;
    },
    async dialogAction(action='inspect', value='') {
      return call(function(action,value){
        const box=document.querySelector('.monaco-dialog-box');if(!box)return null;
        const result={text:box.innerText,buttons:[...box.querySelectorAll('button,.monaco-button')].map(b=>b.textContent.trim())};
        if(action==='click'){const b=[...box.querySelectorAll('button,.monaco-button')].find(b=>b.textContent.trim().replaceAll('&','')===value);if(!b)throw Error('Dialog button missing');b.click();}
        return result;
      },action,value);
    },
    async terminalScreen() {
      return call(function(){return [...document.querySelectorAll('.xterm-accessibility-tree')].filter(e=>e.getClientRects().length).map(e=>e.innerText).join('\n').slice(-20000);});
    },
    async answerInput(expectedTitle, value) {
      const answered = await call(function (title, text) {
        const widget = document.querySelector('.quick-input-widget');
        const input = widget?.querySelector('input');
        if (!input?.getClientRects().length || widget.querySelector('.quick-input-title')?.textContent.trim() !== title) return false;
        input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true })); return true;
      }, expectedTitle, value);
      if (answered) { await sleep(100); await key('Enter', 13); }
      return answered;
    },
    async quickInputState() {
      return call(function(){const w=document.querySelector('.quick-input-widget');if(!w?.getClientRects().length)return null;return {title:w.querySelector('.quick-input-title')?.textContent.trim(),placeholder:w.querySelector('input')?.placeholder,rows:[...w.querySelectorAll('.monaco-list-row')].map(r=>r.innerText)};});
    },
    async screenshot(file) {
      const result = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
    },
    async frameDebug() {
      return { targets: (await send('Target.getTargets')).targetInfos.map(t => ({ type: t.type, url: t.url, id: t.targetId })),
        frames: await send('Page.getFrameTree'), iframes: await call(function () { return [...document.querySelectorAll('iframe')].map(f => ({ src: f.src, tag: f.outerHTML.slice(0, 400) })); }) };
    },
    async packageTree(root, action = 'inspect', name = '') {
      const expression = `(() => {
        const documents=[document];for(const f of document.querySelectorAll('iframe')){try{if(f.contentDocument)documents.push(f.contentDocument)}catch{}}
        const doc=documents.find(d=>d.querySelector('h1')?.textContent===${JSON.stringify(root)});if(!doc||!doc.querySelector('nav button.selected'))return null;
        const action=${JSON.stringify(action)},name=${JSON.stringify(name)};
        if(action==='select'){
          const b=[...doc.querySelectorAll('nav button')].find(b=>(b.querySelector('.node-label')?.textContent??b.textContent.trim().slice(2))===name);
          if(!b)throw Error('tree node missing: '+name);b.click();
        }else if(action!=='inspect'){
          const b=doc.getElementById(action);if(!b||b.disabled)throw Error('action unavailable: '+action);b.click();
        }
        return {text:doc.body.innerText,path:doc.getElementById('path')?.textContent,keys:[...doc.querySelectorAll('nav button')].map(b=>JSON.parse(b.dataset.key))};
      })()`;
      // Electron can host webviews in same-process frames, without an iframe target.
      const { frameTree } = await send('Page.getFrameTree');
      const frames = [];
      const walk = tree => { frames.push(tree.frame); (tree.childFrames ?? []).forEach(walk); };
      walk(frameTree);
      for (const frame of frames.filter(f => f.id !== frameTree.frame.id)) {
        try {
          const { executionContextId } = await send('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'package-acceptance' });
          const result = await send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true });
          if (result.exceptionDetails) throw new Error('Package tree DOM operation failed');
          if (result.result.value) return result.result.value;
        } catch (error) {
          if (!/frame|context/i.test(error.message)) throw error;
        }
      }
      const { targetInfos } = await send('Target.getTargets');
      for (const target of targetInfos.filter(t => t.type === 'iframe')) {
        const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
        try {
          const result = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
          if (result.exceptionDetails) throw new Error((result.exceptionDetails.exception?.description ?? result.exceptionDetails.text) + ': package tree operation failed');
          if (result.result.value) return result.result.value;
          const nested = await send('Page.getFrameTree', {}, sessionId);
          const children = [];
          const visit = tree => { children.push(tree.frame); (tree.childFrames ?? []).forEach(visit); };
          visit(nested.frameTree);
          for (const frame of children.slice(1)) {
            const { executionContextId } = await send('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'package-acceptance' }, sessionId);
            const child = await send('Runtime.evaluate', { expression, contextId: executionContextId, returnByValue: true }, sessionId);
            if (child.exceptionDetails) throw new Error('Package tree frame operation failed');
            if (child.result.value) return child.result.value;
          }
        } finally { await send('Target.detachFromTarget', { sessionId }); }
      }
      return undefined;
    },
    async answerPassword(expectedTitle, password) {
      const answered = await call(function (title, value) {
        const input = document.querySelector('.quick-input-widget input[type="password"]');
        if (!input || !input.getClientRects().length) return false;
        const label = input.closest('.quick-input-widget').querySelector('.quick-input-title')?.textContent.trim();
        if (label !== title) return false;
        input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true })); return true;
      }, expectedTitle, password);
      if (answered) await key('Enter', 13);
      return answered;
    },
    async suggestion(label, file) {
      let visible = false;
      for (let i = 0; i < 100; i++) {
        visible = await call(function (expected) { return [...document.querySelectorAll('.suggest-widget')].some((e) => e.getClientRects().length && e.textContent.includes(expected)); }, label);
        if (visible) break;
        await sleep(50);
      }
      if (!visible) throw new Error(`Suggestion popup did not render ${label}.`);
      const result = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(file, Buffer.from(result.data, 'base64')); await key('Escape', 27);
    },
    async inlineText() {
      return call(function(){return [...document.querySelectorAll('.monaco-editor .view-lines')].filter(e=>e.getClientRects().length).map(e=>e.textContent).join('\n');});
    },
    async editorTab() { await key('Tab',9); },
    async typeInEditor(text) {
      await send('Page.bringToFront');
      let ready=false;
      for(let i=0;i<100;i++) {
        ready=await call(function(){const editor=[...document.querySelectorAll('.monaco-editor')].find(e=>e.getClientRects().length);const input=editor?.querySelector('.native-edit-context, textarea.inputarea, [contenteditable="true"]');if(!input)return false;input.focus();return document.activeElement===input;});
        if(ready)break;await sleep(50);
      }
      if(!ready)throw Error('Visible editor input missing');
      await send('Input.insertText',{text});
    },
    close() { for (const p of waiting.values()) clearTimeout(p.timer); waiting.clear(); socket.close(); }
  };
};
