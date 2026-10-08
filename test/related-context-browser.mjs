// Run: MOBIUS_FRONTEND_NODE_MODULES=/data/platform/frontend/node_modules \
//      CHROMIUM_PATH=/opt/agent-browser/browsers/chrome-154.0.8037.92/chrome \
//      node test/related-context-browser.mjs
// Actual detail component, seeded cache, native Chromium DOM, and a mocked
// related read only. CSP/CDP block external network; the profile is disposable.
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
const fixture = String.raw`import React from 'react';
import {createRoot} from 'react-dom/client';
import {PullRequestDetail} from './ui/PullRequestDetail.jsx';
import {CSS} from './theme.js';
import {WORKSPACE_CSS} from './workspace-theme.js';
const pr={number:7,title:'Example',repository:{nameWithOwner:'team/repo'},headRefOid:'a'.repeat(40),baseRefOid:'b'.repeat(40),baseRefName:'main',url:'https://github.com/team/repo/pull/7'};
const item={__typename:'Issue',number:2,title:'Usable issue',url:'https://github.com/team/repo/issues/2',repository:{nameWithOwner:'team/repo'},relationships:['May close']};
const cache=items=>({entries:{'description:1':{data:{body:'Description'},loading:false},'activity:1':{data:{items:[]},loading:false},'threads:':{data:{threads:[]},loading:false},related:{data:{items,errors:['Cross-references are unavailable.']},loading:false}}});
const calls=[];
window.fetch=(url,options)=>{calls.push({url,query:JSON.parse(options.body).query});if(url!=='/api/github/graphql'||!options.body.includes('closingIssuesReferences'))throw Error('Unexpected read: '+url);return Promise.resolve({ok:true,json:async()=>({data:{repository:{pullRequest:{headRefOid:pr.headRefOid,baseRefOid:pr.baseRefOid,baseRefName:pr.baseRefName,closingIssuesReferences:{pageInfo:{hasNextPage:false},nodes:[item]},timelineItems:{pageInfo:{hasNextPage:false},nodes:[]}}}}})})};
const root=createRoot(document.getElementById('root'));
const pause=()=>new Promise(r=>setTimeout(r,50));
const wait=async(p,label)=>{let end=Date.now()+3000;while(!p()){if(Date.now()>end)throw Error('timeout '+label+' '+document.body.innerText);await new Promise(r=>setTimeout(r,10))}};
const check=(condition,message)=>{if(!condition)throw Error(message+'; DOM='+document.body.innerText)};
window.runWorkspaceChecks=async()=>{const reports=[];try{for(const count of [0,1]){
  calls.length=0;
  root.render(<div className='co-root'><style>{CSS+WORKSPACE_CSS}</style><PullRequestDetail key={count} pr={pr} token='mock-token' cacheStore={cache(count?[item]:[])} /></div>);
  await pause();
  check(document.body.innerText.includes('Cross-references are unavailable.'),'partial warning missing with '+count+' items');
  check(!!document.querySelector('[role="alert"] button'),'related Retry missing');
  check(!![...document.querySelectorAll('a')].find(a=>a.textContent.includes('Open on GitHub')),'fallback missing');
  check(count===0||!![...document.querySelectorAll('a')].find(a=>a.textContent.includes('Usable issue')),'usable link missing');
  check(calls.length===0,'seeded reads unexpectedly fetched');
  document.querySelector('[role="alert"] button').click();
  await wait(()=>!document.body.innerText.includes('Cross-references are unavailable.'),'related retry');
  check(calls.length===1 && calls[0].url==='/api/github/graphql' && calls[0].query.includes('closingIssuesReferences'),'retry not isolated to related read');
  check(!![...document.querySelectorAll('a')].find(a=>a.textContent.includes('Usable issue')),'link absent after retry');
  reports.push({case:count?'partial-items':'zero-items',relatedCalls:calls.length});
}return{status:'pass',reports};}catch(e){return{status:'fail',error:e.stack,reports,dom:document.body.innerText}}};`;

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
