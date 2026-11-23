/** @param {string} id @returns {any} */
const $ = (id) => document.getElementById(id);
/** @type {any} */
const state = { key:'', asset:null, result:null, running:false, request:null, cancelled:false, activeHistoryId:null, historyUrls:[] };
const defaults = ['flux2','gpt_image_2','mango','nano_banana_v2','seedream','guava','minimax_h3_image'];
/** @param {string} s */
function setStatus(s) { $('status').textContent = s; }
/** @param {Uint8Array} bytes */
function encode(bytes) { let s=''; for(let i=0;i<bytes.length;i+=0x8000) s+=String.fromCharCode(...bytes.subarray(i,i+0x8000)); return btoa(s); }
/** @param {string} s */
function decode(s) { const raw=atob(s); const out=new Uint8Array(raw.length); for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i); return out; }
/** @param {string} path @param {any} [payload] */
async function local(path, payload) {
  const r=await fetch(path,payload===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
  return r.json();
}
/** @param {string} key */
async function setting(key) { return (await local('/_api/settings/'+encodeURIComponent(key))).value; }
/** @param {any} themeData */
function renderTheme(themeData) {
  if (!themeData) return;
  const sysDark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  const useDark = themeData.mode === 'dark' || (themeData.mode !== 'light' && sysDark);
  const variant = useDark ? themeData.dark : themeData.light;
  if (!variant?.colors) return;
  const root = document.documentElement;
  root.style.colorScheme = variant.dark ? 'dark' : 'light';
  const c = variant.colors;
  const vars = {
    '--bg': c.bg,
    '--sidebar': c.sidebar,
    '--surface': c.surface,
    '--surface2': c.surface2,
    '--text': c.text,
    '--muted': c.muted,
    '--faint': c.faint,
    '--hairline': c.hairline,
    '--hover': c.hover,
    '--accent': c.accent,
    '--on-accent': c.onAccent,
    '--warning': c.warning,
  };
  for (const [k, v] of Object.entries(vars)) {
    if (v) root.style.setProperty(k, v);
  }
  if (variant.radius?.button) root.style.setProperty('--button-radius', `${variant.radius.button}px`);
  if (variant.radius?.menu) root.style.setProperty('--menu-radius', `${variant.radius.menu}px`);
}
async function applyTheme() {
  try {
    const themeData = await local('/_api/theme');
    renderTheme(themeData);
    globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => renderTheme(themeData));
  } catch {}
}
/** @param {string} url @param {string} [method] @param {any} [body] @param {Record<string,string>} [headers] */
async function request(url, method='GET', body, headers={}) {
  const data=body===undefined?'':typeof body==='string'?encode(new TextEncoder().encode(body)):encode(body);
  const res=await local('/_api/network',{url,method,headers,bodyBase64:data});
  const bytes=decode(res.bodyBase64);
  if(res.status<200 || res.status>=300) {
    let message=new TextDecoder().decode(bytes);
    try { const e=JSON.parse(message); message=e.error?.message || e.error || (e instanceof Error ? e.message : String(e)) || message; } catch {}
    throw new Error(`Mage API (${res.status}): ${message || '请求失败'}`);
  }
  return {bytes, contentType:res.contentType, text:()=>new TextDecoder().decode(bytes), json:()=>JSON.parse(new TextDecoder().decode(bytes))};
}
function auth(extra={}) { return {Authorization:`Bearer ${state.key}`,...extra}; }
async function models() {
  /** @type {any[]} */
  let items=defaults.map(id=>({id,name:id}));
  if(state.key) {
    try {
      const data=(await request('https://api.mage.space/v1/architectures','GET',undefined,auth())).json();
      const list=(data.architectures||[]).filter(/** @param {any} x */ x=>x.type==='image' && x.id && x.image_inputs?.references?.field);
      if(list.length) items=list;
    } catch(e) { setStatus(`模型列表加载失败，使用内置列表：${(e instanceof Error ? e.message : String(e))}`); }
  }
  const configured=(await setting('defaultArchitecture').catch(()=> '')).trim();
  if(configured && !items.some(x=>x.id===configured)) items.unshift({id:configured,name:configured});
  $('model').replaceChildren(...items.map(m=>{const o=document.createElement('option');o.value=m.id;o.textContent=m.name||m.id;o.dataset.modelId=m.base_config?.model_id||'';return o;}));
  if(configured) $('model').value=configured;
  if(state.key) try { const account=(await request('https://api.mage.space/v1/account','GET',undefined,auth())).json(); const n=account.gems??account.gems_balance??account.balance??account.billing?.gems; if(typeof n==='number') $('balance').textContent=`${n} Gems`; } catch {}
}
async function loadAsset() {
  state.asset=await local('/_api/asset');
  $('source').src=URL.createObjectURL(new Blob([decode(state.asset.bodyBase64)],{type:state.asset.mimeType||'image/png'}));
  $('source').style.display='block';$('source-empty').style.display='none';$('source-name').textContent=state.asset.name||state.asset.filename;
  await renderHistory();
}

const HISTORY_DB = 'mage_studio_history';
const HISTORY_STORE = 'generations';
const MAX_HISTORY_PER_ASSET = 30;

/** @returns {Promise<IDBDatabase>} */
function openHistoryDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HISTORY_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        const store = db.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
        store.createIndex('assetId', 'assetId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** @param {string} assetId @returns {Promise<any[]>} */
async function listHistory(assetId) {
  const db = await openHistoryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, 'readonly');
    const idx = tx.objectStore(HISTORY_STORE).index('assetId');
    const req = idx.getAll(assetId);
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.createdAt - a.createdAt));
    req.onerror = () => reject(req.error);
  });
}

/** @param {any} entry */
async function addHistoryEntry(entry) {
  const db = await openHistoryDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, 'readwrite');
    tx.objectStore(HISTORY_STORE).put(entry);
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
  const all = await listHistory(entry.assetId);
  if (all.length > MAX_HISTORY_PER_ASSET) {
    const tx = db.transaction(HISTORY_STORE, 'readwrite');
    const store = tx.objectStore(HISTORY_STORE);
    for (const old of all.slice(MAX_HISTORY_PER_ASSET)) {
      store.delete(old.id);
    }
  }
}

/** @param {string} id */
async function removeHistoryEntry(id) {
  const db = await openHistoryDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, 'readwrite');
    tx.objectStore(HISTORY_STORE).delete(id);
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
}

/** @param {string} assetId */
async function clearHistoryForAsset(assetId) {
  const items = await listHistory(assetId);
  if (!items.length) return;
  const db = await openHistoryDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_STORE, 'readwrite');
    const store = tx.objectStore(HISTORY_STORE);
    for (const item of items) store.delete(item.id);
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
}

/** @param {any} entry */
function applyHistoryEntry(entry) {
  const bytes = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes);
  state.result = { bytes, contentType: entry.contentType || 'image/png' };
  state.activeHistoryId = entry.id;
  $('result').src = URL.createObjectURL(new Blob([bytes], { type: state.result.contentType }));
  $('result').style.display = 'block';
  $('result-empty').style.display = 'none';
  $('save-new').disabled = false;
  $('save-page').disabled = false;
  $('replace').disabled = false;
  if (entry.prompt) $('prompt').value = entry.prompt;
  if (entry.architecture) {
    const hasModel = Array.from($('model').options).some((/** @type {any} */ o) => o.value === entry.architecture);
    if (hasModel) {
      $('model').value = entry.architecture;
      $('architecture').value = '';
    } else {
      $('architecture').value = entry.architecture;
    }
  }
  renderHistory();
}

async function renderHistory() {
  const listEl = $('history-list');
  const clearBtn = $('clear-history');
  if (!listEl || !state.asset?.id) return;
  for (const url of state.historyUrls) URL.revokeObjectURL(url);
  state.historyUrls = [];
  let items = [];
  try { items = await listHistory(state.asset.id); } catch { items = []; }
  clearBtn.disabled = items.length === 0;
  if (!items.length) {
    const empty = document.createElement('span');
    empty.className = 'hint';
    empty.textContent = '当前素材暂无生成历史';
    listEl.replaceChildren(empty);
    return;
  }
  const cards = items.map((entry) => {
    const card = document.createElement('div');
    card.className = 'history-card' + (entry.id === state.activeHistoryId ? ' active' : '');
    const bytes = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(entry.bytes);
    const url = URL.createObjectURL(new Blob([bytes], { type: entry.contentType || 'image/png' }));
    state.historyUrls.push(url);
    const img = document.createElement('img');
    img.src = url;
    img.alt = entry.prompt || 'History';
    const meta = document.createElement('div');
    meta.className = 'history-meta';
    const promptEl = document.createElement('div');
    promptEl.className = 'history-prompt';
    promptEl.textContent = entry.prompt || '(无提示词)';
    const infoEl = document.createElement('div');
    infoEl.textContent = `${entry.architecture || ''} · ${new Date(entry.createdAt).toLocaleTimeString()}`;
    meta.append(promptEl, infoEl);
    const del = document.createElement('button');
    del.className = 'history-del';
    del.title = '删除';
    del.textContent = '×';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      await removeHistoryEntry(entry.id);
      if (state.activeHistoryId === entry.id) state.activeHistoryId = null;
      await renderHistory();
    });
    card.addEventListener('click', () => applyHistoryEntry(entry));
    card.append(img, meta, del);
    return card;
  });
  listEl.replaceChildren(...cards);
}
async function imageInput() {
  let data=decode(state.asset.bodyBase64); let type=state.asset.mimeType||'image/png';
  if(!['image/jpeg','image/png'].includes(type)) {
    const image=new Image(); const url=URL.createObjectURL(new Blob([data],{type}));
    try {
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('无法读取原图格式'));image.src=url;});
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');if(!context)throw new Error('无法创建画布');context.drawImage(image,0,0);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if(!blob)throw new Error('无法转换原图');data=new Uint8Array(await blob.arrayBuffer());type='image/png';
    } finally { URL.revokeObjectURL(url); }
  }
  if(data.length<=2*1024*1024) return `data:${type};base64,${encode(data)}`;
  setStatus('正在申请上传地址…');
  const ticket=(await request('https://api.mage.space/v1/uploads','POST',JSON.stringify({content_type:type}),auth({'Content-Type':'application/json'}))).json();
  await request(ticket.upload_url,ticket.method||'PUT',data,ticket.headers||{});
  return ticket.url;
}
async function run() {
  if(state.running) return;
  if(!state.key) { setStatus('请先在插件设置中填写 Mage API Key。'); return; }
  if(!state.asset) { setStatus('请先在主界面选择图片，然后重新打开窗口。'); return; }
  const prompt=$('prompt').value.trim(); if(!prompt) { setStatus('请输入修改提示词。'); return; }
  const arch=$('architecture').value.trim()||$('model').value; if(!arch) { setStatus('请输入架构 ID。'); return; }
  state.running=true;state.cancelled=false;state.request=null;$('run').disabled=true;$('cancel').disabled=false;
  try {
    const image=await imageInput(); if(state.cancelled)return;
    /** @type {Record<string, any>} */
    const body={prompt,image}; const custom=$('model-id').value.trim(); const selected=$('model').selectedOptions[0];
    const model=custom||(!$('architecture').value.trim()?selected?.dataset.modelId:''); if(model)body.model_id=model;
    if($('ratio').value)body.aspect_ratio=$('ratio').value;
    if($('seed').value.trim())body.seed=Number($('seed').value);
    setStatus('正在提交任务…');
    let task=(await request(`https://api.mage.space/v1/${encodeURIComponent(arch)}/generate`,'POST',JSON.stringify(body),auth({'Content-Type':'application/json','Idempotency-Key':globalThis.crypto?.randomUUID?.() || `bb-${Date.now()}-${Math.random().toString(36).slice(2)}`}))).json();
    state.request=task;
    const deadline=Date.now()+300000;
    while(!['completed','failed','cancelled'].includes(task.status)) {
      if(state.cancelled)return; if(Date.now()>deadline) throw new Error('生成超时，请稍后重试。');
      setStatus(`生成状态：${task.status}`); await new Promise(resolve=>setTimeout(resolve,2500)); if(state.cancelled)return;
      task=(await request(task.status_url,'GET',undefined,auth())).json();state.request=task;
    }
    if(task.status!=='completed') throw new Error(task.error?.message||`任务${task.status}`);
    if(!task.result?.url)throw new Error('响应中没有结果图片。');
    setStatus('正在下载结果…'); const result=await request(task.result.url);
    if(state.cancelled)return;
    state.result=result; $('result').src=URL.createObjectURL(new Blob([result.bytes],{type:result.contentType||'image/png'}));
    $('result').style.display='block';$('result-empty').style.display='none';$('save-new').disabled=false;$('save-page').disabled=false;$('replace').disabled=false;
    if (state.asset?.id) {
      const entry = {
        id: globalThis.crypto?.randomUUID?.() || `hist-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        assetId: state.asset.id,
        prompt,
        architecture: arch,
        modelId: model || '',
        ratio: $('ratio').value || '',
        seed: $('seed').value.trim(),
        contentType: result.contentType || 'image/png',
        bytes: result.bytes,
        createdAt: Date.now(),
      };
      state.activeHistoryId = entry.id;
      try { await addHistoryEntry(entry); await renderHistory(); } catch {}
    }
    setStatus(`完成${task.billing?.gems_charged ? `，消耗 ${task.billing.gems_charged} Gems` : ''}`);
  } catch(e) { if(!state.cancelled)setStatus((e instanceof Error ? e.message : String(e))); }
  finally { state.running=false;$('run').disabled=false;$('cancel').disabled=true; }
}
/** @param {string} mode */
async function save(mode) {
  if(!state.result)return;
  if(mode==='replace'&&!confirm('替换当前素材？App 会保留原图历史版本。'))return;
  try { setStatus('正在保存…');const type=(state.result.contentType||'').split(';')[0];const ext=type==='image/jpeg'?'jpg':type==='image/webp'?'webp':'png';await local('/_api/asset/save',{mode,filename:`mage-result.${ext}`,bodyBase64:encode(state.result.bytes),prompt:$('prompt').value});setStatus('保存成功。'); } catch(e) { setStatus(`保存失败：${(e instanceof Error ? e.message : String(e))}`); }
}
$('run').addEventListener('click',run);
$('save-new').addEventListener('click',()=>save('create'));
$('save-page').addEventListener('click',()=>save('page'));
$('replace').addEventListener('click',()=>save('replace'));
$('clear-history').addEventListener('click',async()=>{if(!state.asset?.id)return;await clearHistoryForAsset(state.asset.id);state.activeHistoryId=null;await renderHistory();});
$('cancel').addEventListener('click',async()=>{state.cancelled=true;setStatus('已取消');if(state.request?.cancel_url)try{await request(state.request.cancel_url,'POST','',auth());}catch(e){setStatus(`本地已取消，远程取消失败：${(e instanceof Error ? e.message : String(e))}`);}});
(async()=>{await applyTheme();try{state.key=await setting('apiKey');await models();await loadAsset();}catch(e){setStatus((e instanceof Error ? e.message : String(e)));}})();
