const $ = (id) => document.getElementById(id);
const state = { key:'', asset:null, result:null, running:false, request:null, cancelled:false };
const defaults = ['flux2','gpt_image_2','mango','nano_banana_v2','seedream','guava','minimax_h3_image'];
function status(s) { $('status').textContent = s; }
function encode(bytes) { let s=''; for(let i=0;i<bytes.length;i+=0x8000) s+=String.fromCharCode(...bytes.subarray(i,i+0x8000)); return btoa(s); }
function decode(s) { const raw=atob(s); const out=new Uint8Array(raw.length); for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i); return out; }
async function local(path, payload) {
  const r=await fetch(path,payload===undefined?undefined:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
  return r.json();
}
async function setting(key) { return (await local('/_api/settings/'+encodeURIComponent(key))).value; }
async function request(url, method='GET', body, headers={}) {
  const data=body===undefined?'':typeof body==='string'?encode(new TextEncoder().encode(body)):encode(body);
  const res=await local('/_api/network',{url,method,headers,bodyBase64:data});
  const bytes=decode(res.bodyBase64);
  if(res.status<200 || res.status>=300) {
    let message=new TextDecoder().decode(bytes);
    try { const e=JSON.parse(message); message=e.error?.message || e.error || e.message || message; } catch {}
    throw new Error(`Mage API (${res.status}): ${message || '请求失败'}`);
  }
  return {bytes, contentType:res.contentType, text:()=>new TextDecoder().decode(bytes), json:()=>JSON.parse(new TextDecoder().decode(bytes))};
}
function auth(extra={}) { return {Authorization:`Bearer ${state.key}`,...extra}; }
async function models() {
  let items=defaults.map(id=>({id,name:id}));
  if(state.key) {
    try {
      const data=(await request('https://api.mage.space/v1/architectures','GET',undefined,auth())).json();
      const list=(data.architectures||[]).filter(x=>x.type==='image' && x.id && x.image_inputs?.references?.field);
      if(list.length) items=list;
    } catch(e) { status(`模型列表加载失败，使用内置列表：${e.message}`); }
  }
  $('model').replaceChildren(...items.map(m=>{const o=document.createElement('option');o.value=m.id;o.textContent=m.name||m.id;o.dataset.modelId=m.base_config?.model_id||'';return o;}));
  const configured=await setting('defaultArchitecture').catch(()=> '');
  if(items.some(x=>x.id===configured)) $('model').value=configured;
  if(state.key) try { const account=(await request('https://api.mage.space/v1/account','GET',undefined,auth())).json(); const n=account.gems??account.gems_balance??account.balance??account.billing?.gems; if(typeof n==='number') $('balance').textContent=`${n} Gems`; } catch {}
}
async function loadAsset() {
  state.asset=await local('/_api/asset');
  $('source').src=URL.createObjectURL(new Blob([decode(state.asset.bodyBase64)],{type:state.asset.mimeType||'image/png'}));
  $('source').style.display='block';$('source-empty').style.display='none';$('source-name').textContent=state.asset.name||state.asset.filename;
}
async function imageInput() {
  let data=decode(state.asset.bodyBase64); let type=state.asset.mimeType||'image/png';
  if(!['image/jpeg','image/png'].includes(type)) {
    const image=new Image(); const url=URL.createObjectURL(new Blob([data],{type}));
    try {
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('无法读取原图格式'));image.src=url;});
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if(!blob)throw new Error('无法转换原图');data=new Uint8Array(await blob.arrayBuffer());type='image/png';
    } finally { URL.revokeObjectURL(url); }
  }
  if(data.length<=2*1024*1024) return `data:${type};base64,${encode(data)}`;
  status('正在申请上传地址…');
  const ticket=(await request('https://api.mage.space/v1/uploads','POST',JSON.stringify({content_type:type}),auth({'Content-Type':'application/json'}))).json();
  await request(ticket.upload_url,ticket.method||'PUT',data,ticket.headers||{});
  return ticket.url;
}
async function run() {
  if(state.running) return;
  if(!state.key) { status('请先在插件设置中填写 Mage API Key。'); return; }
  if(!state.asset) { status('请先在主界面选择图片，然后重新打开窗口。'); return; }
  const prompt=$('prompt').value.trim(); if(!prompt) { status('请输入修改提示词。'); return; }
  const arch=$('architecture').value.trim()||$('model').value; if(!arch) { status('请输入架构 ID。'); return; }
  state.running=true;state.cancelled=false;state.request=null;$('run').disabled=true;$('cancel').disabled=false;
  try {
    const image=await imageInput(); if(state.cancelled)return;
    const body={prompt,image}; const custom=$('model-id').value.trim(); const selected=$('model').selectedOptions[0];
    const model=custom||(!$('architecture').value.trim()?selected?.dataset.modelId:''); if(model)body.model_id=model;
    if($('ratio').value)body.aspect_ratio=$('ratio').value;
    if($('seed').value.trim())body.seed=Number($('seed').value);
    status('正在提交任务…');
    let task=(await request(`https://api.mage.space/v1/${encodeURIComponent(arch)}/generate`,'POST',JSON.stringify(body),auth({'Content-Type':'application/json','Idempotency-Key':globalThis.crypto?.randomUUID?.() || `bb-${Date.now()}-${Math.random().toString(36).slice(2)}`}))).json();
    state.request=task;
    const deadline=Date.now()+300000;
    while(!['completed','failed','cancelled'].includes(task.status)) {
      if(state.cancelled)return; if(Date.now()>deadline) throw new Error('生成超时，请稍后重试。');
      status(`生成状态：${task.status}`); await new Promise(resolve=>setTimeout(resolve,2500)); if(state.cancelled)return;
      task=(await request(task.status_url,'GET',undefined,auth())).json();state.request=task;
    }
    if(task.status!=='completed') throw new Error(task.error?.message||`任务${task.status}`);
    if(!task.result?.url)throw new Error('响应中没有结果图片。');
    status('正在下载结果…'); const result=await request(task.result.url);
    if(state.cancelled)return;
    state.result=result; $('result').src=URL.createObjectURL(new Blob([result.bytes],{type:result.contentType||'image/png'}));
    $('result').style.display='block';$('result-empty').style.display='none';$('save-new').disabled=false;$('replace').disabled=false;
    status(`完成${task.billing?.gems_charged ? `，消耗 ${task.billing.gems_charged} Gems` : ''}`);
  } catch(e) { if(!state.cancelled)status(e.message); }
  finally { state.running=false;$('run').disabled=false;$('cancel').disabled=true; }
}
async function save(mode) {
  if(!state.result)return;
  if(mode==='replace'&&!confirm('替换当前素材？App 会保留原图历史版本。'))return;
  try { status('正在保存…');const type=(state.result.contentType||'').split(';')[0];const ext=type==='image/jpeg'?'jpg':type==='image/webp'?'webp':'png';await local('/_api/asset/save',{mode,filename:`mage-result.${ext}`,bodyBase64:encode(state.result.bytes),prompt:$('prompt').value});status('保存成功。'); } catch(e) { status(`保存失败：${e.message}`); }
}
$('run').addEventListener('click',run);
$('save-new').addEventListener('click',()=>save('create'));
$('replace').addEventListener('click',()=>save('replace'));
$('cancel').addEventListener('click',async()=>{state.cancelled=true;status('已取消');if(state.request?.cancel_url)try{await request(state.request.cancel_url,'POST','',auth());}catch(e){status(`本地已取消，远程取消失败：${e.message}`);}});
(async()=>{try{state.key=await setting('apiKey');await models();await loadAsset();}catch(e){status(e.message);}})();
