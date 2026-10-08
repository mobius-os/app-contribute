// Run: MOBIUS_FRONTEND_NODE_MODULES=/data/platform/frontend/node_modules \
//      node test/batch-outcome-browser.mjs
// Actual app components, native Chromium DOM, and no live app/backend. The
// browser gets a disposable profile; all transports and host capabilities are
// mocked before mount, with CSP and CDP network blocking as a second boundary.
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const frontendModules = process.env.MOBIUS_FRONTEND_NODE_MODULES

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const ENTRY = '\0workspace-browser-fixture'
const fixture = String.raw`import React,{useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {ContributionRun} from './ui/Feed.jsx';
import {buildContributionRun} from './run.js';
import {TaskContext} from './ui/TaskPane.jsx';
import {CSS} from './theme.js';
import {WORKSPACE_CSS} from './workspace-theme.js';
window.fetch=()=>{throw Error('forbidden transport')};window.mobius={online:true};
const sha='a'.repeat(40);
const rec=(id,status='prepared')=>({id,type:'pr',status,repo:'team/repo',title:id,plan:{action:'pr',title:id,repo:'team/repo',branch:'fix/'+id,head_sha:sha},quality_review:{state:'all_clear',reviewed_head_sha:sha}});
const canonical=(r,status='open')=>({...r,status,number:1,url:'https://github.com/team/repo/pull/1'});
const status={byId:{a:{state:'ready'},b:{state:'ready'}}};
const stack=(id,position)=>({...rec(id),plan:{...rec(id).plan,branch:'stack/chain/'+position,base_sha:position===1?undefined:sha,stack:{id:'chain',name:'Chain',total:2,position,base_branch:position===1?'main':'stack/chain/1',parent_record_id:position===1?'':'a'}}});
let controls={}, release;
function App({mode}){
 const[records,setRecords]=useState(mode==='batch'||mode==='batch-late'||mode==='cancel'?[rec('a'),rec('b')]:mode==='stack'?[stack('a',1),stack('b',2)]:mode==='readyfail'?[{...stack('a',1),status:'draft',number:1,url:'https://github.com/team/repo/pull/1'},{...stack('b',2),status:'draft',number:2,url:'https://github.com/team/repo/pull/2'}]:mode==='ready'?[rec('a','draft')]:[rec('a')]);
 const[activeId,setActiveId]=useState('');const[activation,setActivation]=useState(0);
 const calls=useRef([]);const run=buildContributionRun({records,reviewStatus:status});
 controls={calls:calls.current,records,revision:run.revision,update:(id,patch)=>setRecords(old=>old.map(r=>r.id===id?{...r,...patch}:r)),activate:()=>setActivation(x=>x+1)};
 async function send(record){calls.current.push(record.id);
  if((mode==='batch'||mode==='batch-late') && record.id==='a'){setRecords(old=>old.map(r=>r.id==='a'?canonical(r):r));return {ok:true,record:canonical(record)}}
  if((mode==='batch'||mode==='batch-late') && record.id==='b')return new Promise(resolve=>{release=()=>{if(mode==='batch')setRecords(old=>old.map(r=>r.id==='b'?canonical(r):r));resolve(mode==='batch-late'?{pending:true,record:{...record,status:'submitting'}}:{ok:true,record:canonical(record)})}});
  if(mode==='pending')return {pending:true,record:{...record,status:'submitting'}};
  if(mode==='unknown')return {};
  if(mode==='closed')return {pending:true};
  if(mode==='ready')throw Error('send called for ready request');
  return {ok:true,record:canonical(record)};
 }
 async function ready(record){calls.current.push('ready:'+record.id);if(mode==='readyfail')return {error:'Review changed',failure:{owner:'agent'}};return {pending:true,record:{...record,readying:true}}}
 async function sendStack(records){calls.current.push('stack:'+records.map(r=>r.id).join(','));setRecords(old=>old.map(r=>r.id==='a'?canonical(r):r));return {pending:true,published:1,publishing:1}}
 return <div className='co-root'><style>{CSS+WORKSPACE_CSS}</style><main className='co-page co-workspace'><TaskContext.Provider value={{activeId,explicit:true,open:setActiveId,close:()=>setActiveId('')}}><ContributionRun run={run} reviewStatus={status} publicationPreference='github' githubState='connected' onSend={send} onSendStack={sendStack} onMarkReady={ready}/></TaskContext.Provider></main></div>
}
const root=createRoot(document.getElementById('root'));
const wait=async(p,label)=>{let end=Date.now()+5000;while(!p()){if(Date.now()>end)throw Error('timeout '+label+' '+document.body.innerText);await new Promise(r=>setTimeout(r,10))}};
const button=prefix=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(prefix));
const sendOffer=()=>document.querySelector('.co-run-primary.is-send button');
const sendConfirmation=()=>[...document.querySelectorAll('.co-run-approval-actions button')].find(b=>/^(?:Send|Contribute)(?: |$)/.test(b.textContent.trim()));
const check=(condition,message)=>{if(!condition)throw Error(message+'; DOM='+document.body.innerText)};
const pause=()=>new Promise(r=>setTimeout(r,80));
const approval=()=>!!document.querySelector('.co-run-approval');
async function begin(mode){root.render(<App key={mode} mode={mode}/>);await pause();await wait(()=>!!sendOffer(),mode+' offer');sendOffer().click();await wait(approval,mode+' approval');}
window.runWorkspaceChecks=async()=>{const reports=[];try{
 await begin('cancel');check(controls.calls.length===0,'handler called before confirmation');button('Keep private').click();await pause();check(controls.calls.length===0,'handler called after cancel');reports.push({case:'cancel',calls:[...controls.calls]});
 await begin('batch');const before=controls.revision;sendConfirmation().click();await wait(()=>controls.calls.length===2,'batch b handler');await pause();check(controls.revision!==before,'canonical A did not change run revision');check(approval(),'batch ownership lost after A canonical');check(!sendOffer(),'batch reoffered while B held');check(!button('Done'),'batch completed before B canonical');check(document.body.innerText.includes('a')&&document.body.innerText.includes('b'),'frozen batch rows lost');check(document.body.innerText.includes('Sent to GitHub'),'A not shown done');check(document.body.innerText.includes('Sending'),'B not shown working');controls.activate();await pause();check(controls.calls.join(',')==='a,b','batch handler retried on rerender');check(approval(),'batch approval lost on rerender');release();await wait(()=>!!button('Done'),'batch completion');check(controls.calls.join(',')==='a,b','batch handler repeat');reports.push({case:'batch',calls:[...controls.calls],before,after:controls.revision});
 await begin('batch-late');sendConfirmation().click();await wait(()=>controls.calls.length===2,'batch-late B handler');await pause();check(approval(),'batch-late ownership lost while held');check(!button('Done'),'batch-late completed before B canonical');controls.update('b',{status:'open',number:2,url:'https://github.com/team/repo/pull/2'});await pause();check(approval(),'batch-late ownership lost after canonical');check(!button('Done'),'batch-late completed before held handler response');check(document.querySelectorAll('.co-run-approval-list li')[1]?.innerText.includes('Sending'),'batch-late B not working while handler held');release();await wait(()=>!!button('Done'),'batch-late delayed response');check(document.querySelectorAll('.co-run-approval-list li')[1]?.innerText.includes('Sent to GitHub'),'batch-late old pending receipt shadowed canonical');check(controls.calls.join(',')==='a,b','batch-late handler replayed');reports.push({case:'batch-late',calls:[...controls.calls]});
 await begin('stack');sendConfirmation().click();await wait(()=>controls.calls.length===1,'stack handler');await pause();check(approval(),'stack ownership lost');check(!button('Done'),'stack partial falsely complete');const stackRows=[...document.querySelectorAll('.co-run-approval-list li')].map(li=>li.innerText);check(stackRows.length===2,'stack lost exact rows');check(stackRows[0].includes('Sent to GitHub'),'stack canonical A not done');check(stackRows[1].includes('Checking result'),'stack unresolved B lacks checking status');check(controls.calls[0]==='stack:a,b','stack handler did not receive exact ordered pair');controls.activate();await pause();check(controls.calls.length===1,'stack handler retried');controls.update('b',{status:'open',number:2,url:'https://github.com/team/repo/pull/2'});await wait(()=>!!button('Done'),'stack late B canonical');check(controls.calls.length===1,'stack retried on late canonical');reports.push({case:'stack',calls:[...controls.calls]});
 root.render(<App key='ready' mode='ready'/>);await pause();await wait(()=>!!button('Request review'),'ready offer');button('Request review').click();await wait(approval,'ready approval');check(controls.calls.length===0,'ready handler called before confirmation');button('Request review on GitHub').click();await wait(()=>controls.calls.length===1,'ready handler');await pause();check(approval(),'ready ownership lost');check(!button('Done'),'ready pending falsely complete');check(document.body.innerText.includes('Checking result'),'ready pending lacks checking status');controls.activate();await pause();check(controls.calls.length===1,'ready handler retried');controls.update('a',{status:'open',number:1,url:'https://github.com/team/repo/pull/1',readying:false});await wait(()=>!!button('Done'),'ready late canonical');check(controls.calls.length===1,'ready retried on late canonical');reports.push({case:'ready',calls:[...controls.calls]});
 for(const mode of ['pending','unknown']){await begin(mode);sendConfirmation().click();await wait(()=>controls.calls.length===1,mode+' handler');await pause();check(approval(),mode+' ownership lost');check(!button('Done'),mode+' falsely complete');check(!sendConfirmation(),mode+' send offered while unresolved');check(document.body.innerText.includes('Checking result'),mode+' lacks checking status');controls.activate();await pause();check(controls.calls.length===1,mode+' handler retried on activate');controls.update('a',{status:'open',number:1,url:'https://github.com/team/repo/pull/1'});await wait(()=>!!button('Done'),mode+' late canonical');check(controls.calls.length===1,mode+' retried on late canonical');reports.push({case:mode,calls:[...controls.calls]});}
 await begin('closed');sendConfirmation().click();await wait(()=>controls.calls.length===1,'closed handler');controls.update('a',{status:'closed',number:1,url:'https://github.com/team/repo/pull/1'});await wait(()=>!!button('Done'),'closed terminal');check(document.querySelector('.co-run-approval-list li')?.innerText.includes('Pull request closed'),'closed not labeled distinctly');check(!document.querySelector('.co-run-approval-list li')?.innerText.includes('Sent to GitHub'),'closed falsely labeled sent');reports.push({case:'closed',calls:[...controls.calls]});
 root.render(<App key='readyfail' mode='readyfail'/>);await pause();await wait(()=>!!button('Request review'),'readyfail offer');button('Request review').click();await wait(approval,'readyfail approval');button('Request review for 2 on GitHub').click();await wait(()=>!!button('Done'),'readyfail result');check(controls.calls.join(',')==='ready:a','ready known failure attempted later stack member');const failRows=[...document.querySelectorAll('.co-run-approval-list li')].map(li=>li.innerText);check(failRows.length===2&&failRows[0].includes('Review changed')&&failRows[1].includes('Not requested'),'ready failed/not attempted labels incorrect');reports.push({case:'readyfail',calls:[...controls.calls]});
 return {status:'pass',reports};}catch(e){return{status:'fail',error:e.stack,reports,dom:document.body.innerText}}};`;

async function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  for (const path of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (existsSync(path)) return path
  }
  const directory = '/opt/agent-browser/browsers'
  if (existsSync(directory)) for (const name of (await readdir(directory)).sort().reverse()) {
    const path = join(directory, name, 'chrome')
    if (existsSync(path)) return path
  }
  throw new Error('No installed Chromium found; set CHROMIUM_PATH. This test never installs a browser.')
}

function cdp(browser) {
  let serial = 0, buffer = ''
  const pending = new Map(), events = [], listeners = new Set()
  browser.stdio[4].on('data', chunk => {
    buffer += chunk.toString()
    let end
    while ((end = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1)
      if (message.id) {
        const entry = pending.get(message.id)
        if (!entry) continue
        pending.delete(message.id); clearTimeout(entry.timer)
        message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result)
      } else { events.push(message); for (const listener of listeners) listener(message) }
    }
  })
  return { events, onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener) }, send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++serial
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timed out: ' + method)) }, 45000)
      pending.set(id, { resolve, reject, timer })
      browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })
  } }
}

async function main() {
  if (!frontendModules) throw new Error('MOBIUS_FRONTEND_NODE_MODULES is required')
  const require = createRequire(join(frontendModules, 'package.json'))
  const { rolldown } = await import(pathToFileURL(require.resolve('rolldown')).href)
  const build = await rolldown({ input: ENTRY, platform: 'browser', tsconfig: false,
    transform: { jsx: 'react-jsx', define: { 'process.env.NODE_ENV': JSON.stringify('production') } },
    resolve: { modules: [frontendModules, 'node_modules'] },
    plugins: [{ name: 'workspace-browser-fixture',
      resolveId(id, importer) { if (id === ENTRY) return id; if (importer === ENTRY && id.startsWith('.')) return join(root, id) },
      load(id) { if (id === ENTRY) return { code: fixture, moduleType: 'jsx' } },
    }],
  })
  const { output } = await build.generate({ format: 'iife' })
  await build.close()
  const temporary = await mkdtemp(join(tmpdir(), 'contribute-workspace-browser-'))
  let browser
  try {
    const page = join(temporary, 'fixture.html')
    await writeFile(page, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'">' +
      '<style>:root{--bg:#fff;--surface:#f5f5f5;--surface-2:#eee;--text:#222;--muted:#666;--border:#ddd;--accent:#2454cc;--accent-dim:#eef;--font:Arial}html,body,#root{height:100%;margin:0}</style>' +
      '</head><body><div id="root"></div><script>' + output[0].code.replace(/<\/script/gi, '<\\/script') + '</script></body></html>')
    browser = spawn(await chromiumPath(), ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
      '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-default-apps', '--disable-extensions',
      '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * ~NOTFOUND',
      '--remote-debugging-pipe', '--user-data-dir=' + join(temporary, 'profile'), 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] })
    browser.stderr.resume()
    const protocol = cdp(browser), reports = []
    for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'phone', width: 390, height: 844 }]) {
      const { targetId } = await protocol.send('Target.createTarget', { url: 'about:blank' })
      const { sessionId } = await protocol.send('Target.attachToTarget', { targetId, flatten: true })
      const inputErrors = []
      const unsubscribeInput = protocol.onEvent(event => {
        if (event.sessionId !== sessionId || event.method !== 'Runtime.bindingCalled' || event.params.name !== 'workspaceNativeKey') return
        void (async () => {
          let error = ''
          try {
            const input = JSON.parse(event.params.payload)
            if (!['Space','Escape'].includes(input.code)) throw new Error('Unknown native input request')
            for (const type of ['keyDown', 'keyUp']) await protocol.send('Input.dispatchKeyEvent', {
              type, key: input.key, code: input.code, windowsVirtualKeyCode: input.keyCode, nativeVirtualKeyCode: input.keyCode,
            }, sessionId)
          } catch (failure) { error = failure.message }
          await protocol.send('Runtime.evaluate', { expression: `window.finishNativeKey(${JSON.stringify(error)})` }, sessionId)
        })().catch(error => inputErrors.push(error.message))
      })
      await protocol.send('Runtime.enable', {}, sessionId)
      await protocol.send('Runtime.addBinding', { name: 'workspaceNativeKey' }, sessionId)
      await protocol.send('Network.enable', {}, sessionId)
      await protocol.send('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] }, sessionId)
      await protocol.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.name === 'phone' }, sessionId)
      await protocol.send('Page.enable', {}, sessionId)
      await protocol.send('Page.navigate', { url: pathToFileURL(page).href }, sessionId)
      const evaluated = await protocol.send('Runtime.evaluate', { expression: `new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        function ready() { if (window.runWorkspaceChecks) window.runWorkspaceChecks().then(resolve, reject);
          else if (Date.now() > deadline) reject(new Error('Fixture did not load'));
          else setTimeout(ready, 20); }
        ready();
      })`, awaitPromise: true, returnByValue: true }, sessionId)
      const report = evaluated.result?.value || { status: 'fail', error: evaluated.exceptionDetails || evaluated }
      unsubscribeInput()
      if (inputErrors.length) { report.status = 'fail'; report.nativeInputErrors = inputErrors }
      const network = protocol.events.filter(event => event.sessionId === sessionId && event.method === 'Network.requestWillBeSent'
        && !event.params.request.url.startsWith('file:')).map(event => event.params.request.url)
      if (network.length) { report.status = 'fail'; report.unexpectedNetwork = network }
      reports.push({ viewport, ...report })
      await protocol.send('Target.closeTarget', { targetId })
    }
    const passed = reports.every(report => report.status === 'pass')
    console.log(JSON.stringify({ status: passed ? 'pass' : 'fail', reports }, null, 2))
    if (!passed) process.exitCode = 1
    await protocol.send('Browser.close')
  } finally {
    if (browser && browser.exitCode === null && browser.signalCode === null) {
      // Browser.close owns graceful shutdown, including profile writers. Do
      // not interrupt that shutdown and race its child processes during rm.
      await new Promise(resolve => {
        const timer = setTimeout(() => browser.kill('SIGKILL'), 3000)
        browser.once('exit', () => { clearTimeout(timer); resolve() })
      })
    }
    await rm(temporary, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(JSON.stringify({ status: 'fail', error: error.stack })); process.exitCode = 1 })
