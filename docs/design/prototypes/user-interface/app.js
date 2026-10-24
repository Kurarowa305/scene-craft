/* PROTOTYPE — in-memory scripted responses. No LLM, Blender, Git, or filesystem mutations. */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  plus:'M8 2v12M2 8h12', chat:'M2 3h12v9H6l-4 3z', leaf:'M3 13C0 5 6 1 14 2c0 8-3 13-11 11ZM3 13l8-8',
  settings:'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8 1v2m0 10v2M1 8h2m10 0h2M3 3l1 1m8 8 1 1M3 13l1-1m8-8 1-1',
  folder:'M1 4h5l2 2h7v8H1z', history:'M3 4a6 6 0 1 1-1 5M1 1v4h4M8 4v4l3 2',
  shield:'M8 1 14 4v5c0 3-6 6-6 6S2 12 2 9V4zM5 8l2 2 4-4', image:'M1 2h14v12H1zM2 11l4-4 3 3 2-2 4 4M11 5h.1',
  attach:'m5 8 5-5a3 3 0 0 1 4 4l-7 7a4 4 0 0 1-6-6l7-7m-4 9 7-7', arrow:'M3 8h10M9 4l4 4-4 4',
};
const icon = (name) => `<span class="icon"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="${icons[name] || icons.chat}"/></svg></span>`;
const artifactData = {
  base:{id:'base',title:'基準シーン',file:'shiomi_base.blend',state:'S0',time:'14:12',kind:'baseline'},
  plants:{id:'plants',title:'案A · 植物と小物',file:'shiomi_plants_A.blend',state:'S1',time:'14:28',kind:''},
  light:{id:'light',title:'案B · 青みのある照明',file:'shiomi_light_B.blend',state:'S2',time:'14:31',kind:'cool'},
};
let seq = 10;
const id = () => `demo-${++seq}`;
const user = (text) => ({role:'user',text});
const agent = (text,refs=[]) => ({role:'assistant',text,refs});
const makeChat = (title,messages=[],stage='植物・小物配置') => ({id:id(),title,messages,stage,model:'既定モデル',status:'normal',detail:'作業なし',draft:'',source:'base',reference:null,attachments:[],side:null,recordMode:false,request:null,protectedPermission:false});
const firstChat = makeChat('駅前の植栽と小物',[
  user('駅舎のまわりに植物を置いて。使い込まれたベンチも少し。\n静けさを残したいので、密度は低めに。カメラは変えないで。'),
  agent('駅舎への視線を残しながら、道沿いに低い草と松を配置しました。ベンチは入口の手前に置いています。\n\n案Aは植物と小物の変更です。照明を調整した案Bも別に用意しました。それぞれ独立して採用できます。\n\nカメラの位置・レンズは変更していません。保護検査は通過しています。まずはプレビューを開いて確認してください。',['plants','light']),
]);
firstChat.source='plants';
const makeProject = (name,intent,chats,artifacts=Object.values(artifactData).map(a=>({...a}))) => ({id:id(),name,intent,chats,artifacts,accepted:'base',style:'静かな風景 · 5f91881',guards:[{id:id(),title:'Camera_Main',detail:'位置・回転・レンズ・被写界深度'},{id:id(),title:'駅舎の外壁',detail:'材質・UV・画像テクスチャ'}],history:[{id:'base',label:'基準シーン',reason:'取り込み時点。理由は未入力。'},{id:'plants',label:'案A · 植物と小物',reason:'駅舎への視線を残し、道沿いの密度を抑える。'},{id:'light',label:'案B · 照明',reason:'空気感を比較するため、照明だけを調整。'}].filter(n=>artifacts.some(a=>a.id===n.id))});
const project = makeProject('海辺の小さな駅','静かな午後。海からの風と、人の気配が残る小さな駅。',[firstChat,makeChat('構図とシーン計画',[agent('駅舎と海を主役にした構図を採用しています。制作意図は作品全体で共有されています。')],'シーン計画'),makeChat('光と空の検討',[agent('このチャットでは光と空を検討します。採用状態は作品と共有します。')],'空・海・照明')]);
const other = makeProject('雨上がりの路地','濡れた路面の反射と、夕方の暖かな窓明かり。',[makeChat('参考資料の整理',[agent('こちらは別作品の制作会話です。駅の会話や成果物を混ぜずに進めます。')],'参考調査')],[{...artifactData.base,title:'路地 · 基準シーン',file:'alley_base.blend'}]);
const state = {projects:[project,other],projectId:project.id,chatId:firstChat.id,tabs:[{id:'artifact:plants',type:'artifact',key:'plants',label:'案A · 植物と小物',projectId:project.id}],activeTab:'artifact:plants',variant:['A','B','C'].includes(new URLSearchParams(location.search).get('variant'))?new URLSearchParams(location.search).get('variant'):'A',mobile:'chat',drawer:false,offline:false,previewFailure:false,historyNode:'plants',operation:'',settingsPage:'backup',zoom:1,panX:0,panY:0,mainWidth:47};
const currentProject = () => state.projects.find(p=>p.id===state.projectId);
const currentChat = () => currentProject().chats.find(c=>c.id===state.chatId);
const art = (key,p=currentProject()) => p.artifacts.find(a=>a.id===key);
const activeTab = () => state.tabs.find(t=>t.id===state.activeTab && t.projectId===state.projectId);
const labels = {A:'横タブ · 標準',B:'縦タブ · リスト',C:'グループ · ワークスペース'};
const now = () => new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
function statusIcon(c){return `<span class="state-icon ${c.status==='stopping'?'running':c.status}" title="${esc(c.detail)}" aria-label="${esc(c.detail)}">${{normal:'',running:'',stopping:'',attention:'!',stopped:'Ⅱ'}[c.status]||''}</span>`;}
function artifactLink(key,p=currentProject()){
  const a=art(key,p); if(!a)return '';
  return `<button class="artifact-link" data-action="artifact" data-key="${esc(key)}">${a.previewMissing?'<span class="icon">▧</span>':`<img class="${a.kind||''}" src="scene.svg" alt="">`}<span><strong>${esc(a.title)}</strong><small>${esc(a.file)} · ${esc(a.state)}</small></span><span class="arrow">↗</span></button>`;
}
function messageHTML(m,p=currentProject()){
  return `<article class="message ${m.role}">${m.role==='assistant'?'<div class="message-label"><span class="assistant-dot">∿</span> scene-craft <span class="tiny muted">デモ応答</span></div>':''}<div class="message-body">${esc(m.text)}</div>${(m.refs||[]).map(r=>artifactLink(r,p)).join('')}${m.time?`<div class="timestamp">${esc(m.time)}</div>`:''}</article>`;
}
function render(){
  const p=currentProject(),c=currentChat();
  document.body.dataset.mobile=state.mobile;
  document.documentElement.style.setProperty('--main',`${state.mainWidth}%`);
  $('#app').innerHTML=`<div class="shell variant-${state.variant.toLowerCase()}">
    <aside class="sidebar"><div class="brand"><span class="brand-mark">∿</span><span class="brand-name">scene-craft</span><small>STUDIO</small></div>
    <div class="sidebar-tools"><button class="nav-button" data-action="new-project">${icon('plus')}<span>作品を作成</span></button><button class="nav-button" data-action="new-chat">${icon('chat')}<span>新しいチャット</span></button></div>
    <div class="nav-label">WORKS / 作品</div><div class="projects">${state.projects.map(pr=>`<section class="project">${pr.isReview?'<div class="nav-label">REFLECTIONS / 作品横断</div>':''}<button class="project-title" data-action="project" data-key="${pr.id}"><span class="folder">▱</span>${esc(pr.name)}</button>${pr.chats.map(ch=>`<button class="chat-link ${ch.id===c.id?'active':''}" data-action="chat" data-key="${ch.id}" data-project="${pr.id}" title="${esc(ch.title)}"><span class="chat-title">${esc(ch.title)}</span>${statusIcon(ch)}<span class="mobile-toggle">◦</span></button>`).join('')}</section>`).join('')}</div>
    <div class="sidebar-footer"><button class="nav-button" data-action="reflection">${icon('leaf')}<span>作品を振り返る</span></button><button class="nav-button" data-action="settings">${icon('settings')}<span>設定・保存データ</span></button><div class="profile"><span class="avatar">K</span><span>ローカルワークスペース<br><span class="tiny">${state.offline?'LLM 利用不可（デモ）':'UI PROTOTYPE · 接続なし'}</span></span></div></div></aside>
    <main class="workspace"><header class="topbar"><div><div class="crumb">作品 <span>/</span> ワークスペース</div><span class="work-title">${esc(p.name)}</span></div><div class="row"><span class="accepted"><i></i>${p.isReview?'対象：'+(c.scope?.length||0)+'作品':'現在採用：'+esc(art(p.accepted)?.title||'制作データなし')}</span><button class="icon mobile-toggle" data-action="mobile" aria-label="チャットとタブを切り替え">⇄</button></div></header>
    <div class="workspace-body"><section class="main-chat" aria-label="メインチャット"><div class="chat-heading"><div><h1>${esc(c.title)}</h1><small>${esc(c.detail)}${state.offline?' · LLM利用不可':''}</small></div><button class="icon" title="サイドチャットを開く" aria-label="サイドチャットを開く" data-action="side">${icon('chat')}</button></div>
    <div class="messages" id="main-messages"><div class="date-divider">今日 / ${esc(p.name)}</div>${c.messages.map(m=>messageHTML(m)).join('')}${c.status==='running'?'<div class="row muted tiny"><span class="state-icon running"></span>現在の作業を進めています…（デモ）</div>':''}</div>
    <div class="composer-area"><div class="quick-prompts"><button data-action="prompt" data-text="この案を採用して">この案を採用</button><button data-action="prompt" data-text="ベンチを手修正したので、ここまでを記録して。">手作業を記録</button><button data-action="side">操作方法を相談</button></div>
    <div class="composer">${c.reference?`<div class="composer-context"><span>↳</span><span>参照：${esc(art(c.reference)?.title||c.reference)}</span><button data-action="clear-ref" aria-label="参照を外す">×</button></div>`:''}
    <select id="source" class="source-select" aria-label="成果物を選択"><option value="">成果物を選択・添付</option>${p.artifacts.filter(a=>!a.deleted).map(a=>`<option value="${a.id}" ${c.source===a.id?'selected':''}>${esc(a.file)} · ${esc(a.time)} · ${esc(a.title)}</option>`).join('')}</select>
    <textarea id="main-input" aria-label="メッセージ" placeholder="${state.offline?'対象と作業内容を入力して、記録として送信':'制作の依頼や、作業の記録を…'}">${esc(c.draft)}</textarea>
    ${c.attachments.length?`<div class="attachments">添付：${c.attachments.map(esc).join(' / ')} <button data-action="clear-files" aria-label="添付を外す">×</button></div>`:''}
    <div class="composer-tools"><div class="composer-selects"><button class="icon" data-action="attach" title="ファイル・画像を添付" aria-label="ファイル・画像を添付">${icon('attach')}</button><select id="stage" aria-label="工程">${['参考調査','シーン計画','仮形状・モデリング','アセット検索','植物・小物配置','UV・テクスチャ','空・海・照明','レンダー出力','振り返り'].map(s=>`<option ${s===c.stage?'selected':''}>${s}</option>`).join('')}</select><select id="model" aria-label="モデル"><option>既定モデル</option><option ${c.model==='別モデル（デモ）'?'selected':''}>別モデル（デモ）</option></select><select id="send-mode" aria-label="送信方法"><option value="chat" ${!c.recordMode&&!state.offline?'selected':''}>会話で送信</option><option value="record" ${c.recordMode||state.offline?'selected':''}>記録として送信</option></select></div>
    <button class="send ${c.status==='running'||c.status==='stopping'?'stop':''}" data-action="${c.status==='running'?'stop':'send'}" ${c.status==='stopping'?'disabled':''} aria-label="${c.status==='running'?'現在の作業を停止':'送信'}">${c.status==='running'?'■':c.status==='stopping'?'…':'↑'}</button></div></div><div class="composer-footnote">保存済みデータが対象 · 添付は名前のみ使用 · データは再読み込みでリセット</div></div></section>
    <div class="resize-handle" role="separator" aria-label="チャットとタブの表示幅" aria-orientation="vertical" tabindex="0"></div>
    <aside class="inspector" aria-label="成果物と相談タブ"><nav class="tabs" aria-label="タブ">${state.tabs.filter(t=>t.projectId===p.id).map(t=>`<div class="tab ${t.id===state.activeTab?'active':''}"><button class="tab-open" role="tab" aria-selected="${t.id===state.activeTab}" data-action="tab" data-key="${t.id}">${esc(t.label)}</button><button class="tab-close" data-action="close-tab" data-key="${t.id}" aria-label="${esc(t.label)}を閉じる">×</button></div>`).join('')}<button class="icon tab-add" data-action="tab-menu" title="タブを開く" aria-label="タブを開く">＋</button></nav>
    <section class="panel-content">${panelHTML()}</section><nav class="tab-shortcuts"><button data-action="side">◌ 相談</button><button data-action="history">⑂ 制作履歴</button><button data-action="guards">◇ 保護一覧</button><button data-action="style">✳ 作風・制作方針</button></nav></aside></div></main></div>
    <footer class="prototype-bar"><div class="row"><span class="tag">PROTOTYPE / #12</span><span class="prototype-description">合意した導線を試す · 外部接続なし</span></div><div class="variant-switch"><button data-action="prev-variant" aria-label="前のレイアウト">←</button><span>${state.variant} · ${labels[state.variant]}</span><button data-action="next-variant" aria-label="次のレイアウト">→</button></div><button data-action="demo">${state.drawer?'閉じる':'シナリオ・内部状態'}</button></footer>${state.drawer?demoHTML():''}`;
  bindPointer();
  const m=$('#main-messages');m.scrollTop=m.scrollHeight;
  const sm=$('.side-messages');if(sm)sm.scrollTop=sm.scrollHeight;
}
function panelHTML(){
  const tab=activeTab();if(!tab)return '<div class="empty"><div style="font-size:32px">↗</div><p>チャット内の成果物リンクから<br>ここにタブを開きます。</p><button class="secondary" data-action="side">サイドチャットを開く</button></div>';
  if(tab.type==='artifact')return previewHTML(tab.key);
  if(tab.type==='side')return sideHTML(tab);
  if(tab.type==='history')return historyHTML();
  if(tab.type==='guards')return guardsHTML();
  if(tab.type==='style')return styleHTML();
  return '';
}
function previewHTML(key){
  const a=art(key);if(!a)return '<div class="empty">成果物が見つかりません</div>';
  return `<div class="preview-wrap"><div class="panel-top"><div><h2>${esc(a.file)}</h2><span class="muted">${esc(a.state)} · 保存済みの状態</span></div><span class="badge">${a.deleted?'実体削除済み':a.previewMissing?'プレビュー未取得':'デモ画像'}</span></div>${a.deleted?'<div class="empty"><p>実体は削除済みです。<br>会話・理由・分岐の記録は残っています。</p></div>':a.previewMissing?`<div class="empty"><p>プレビューは未取得です。<br>制作ファイルと本文の記録は残っています。</p><button class="secondary" data-action="supplement-preview" data-key="${a.id}">プレビューを補う（デモ）</button></div>`:`<div class="preview-canvas"><img id="preview-image" class="${a.kind||''}" draggable="false" src="scene.svg" alt="海辺の駅のプレビューを模した説明用イラスト" style="transform:translate(${state.panX}px,${state.panY}px) scale(${state.zoom})"><span class="preview-corner">Camera_Main · F1 · 1200 × 850 · イラストによるデモ</span></div>`}<div class="preview-toolbar"><span>スクロールで拡大 / ドラッグで移動</span><div class="row"><button data-action="zoom-out" aria-label="縮小">−</button><span id="zoom-label">${Math.round(state.zoom*100)}%</span><button data-action="zoom-in" aria-label="拡大">＋</button><button data-action="zoom-fit">フィット</button></div></div></div>`;
}
function sideHTML(tab){
  const ch=currentProject().chats.find(c=>c.id===tab.chatId);const side=ch.side;
  return `<div class="side-chat"><div class="panel-top"><h2>サイドチャット</h2><span class="badge">相談専用</span></div><div class="side-context"><div class="row between"><span>開始時の文脈：${esc(side.topic)}</span><button data-action="side-context" data-chat="${ch.id}">＋ 参照を追加</button></div><div class="context-tags">${side.refs.map(r=>`<span>${esc(r)}</span>`).join('')}</div></div><div class="side-messages">${side.messages.map(m=>messageHTML(m)).join('')}${side.busy?'<div class="tiny muted">回答を作成しています…（デモ）</div>':''}</div><div class="side-composer"><div class="composer"><textarea id="side-input" data-chat="${ch.id}" aria-label="サイドチャットのメッセージ" placeholder="操作方法や、気になることを相談…">${esc(side.draft)}</textarea><div class="row between"><span class="tiny muted">${state.offline?'LLM利用不可 · 相談は送信できません':'制作データ・記録は変更しません'}</span><button class="send ${side.busy?'stop':''}" data-action="${side.busy?'side-stop':'side-send'}" data-chat="${ch.id}" aria-label="${side.busy?'相談を停止':'相談を送信'}">${side.busy?'■':'↑'}</button></div></div></div></div>`;
}
function historyHTML(){
  const p=currentProject(),node=p.history.find(n=>n.id===state.historyNode)||p.history[0];
  return `<div class="panel-page"><div class="eyebrow">PRODUCTION HISTORY</div><h2>制作履歴</h2><p class="intro">節点にカーソルを重ねると理由を表示。クリックで参照する状態を選択します。</p><svg viewBox="0 0 450 300" class="history-graph" aria-label="保存状態のブランチグラフ"><path d="M75 45v75q0 30 70 30h10v70"/><path class="alt-line" d="M75 70q0 35 210 35v115"/>${p.history.slice(0,3).map((n,i)=>`<g data-action="history-node" data-key="${n.id}" role="button" tabindex="0" class="${node?.id===n.id?'selected':''}"><title>${esc(n.reason)}</title><circle cx="${[75,155,285][i]}" cy="${[45,220,220][i]}" r="7"/><text x="${[95,173,303][i]}" y="${[49,224,224][i]}">${esc(n.label)}</text></g>`).join('')}</svg>${node?`<div class="node-detail"><span class="badge">${esc(node.id===p.accepted?'現在採用':'保存状態')}</span><h3 style="margin-top:8px">${esc(node.label)}</h3><p>${esc(node.reason)}</p>${artifactLink(node.id)}<button class="secondary" style="margin-top:12px" data-action="reference" data-key="${node.id}">メインチャットに参照を添える ↗</button></div>`:''}${p.history.slice(3).map(n=>`<div class="list-row"><div><strong>${esc(n.label)}</strong><p>${esc(n.reason)}</p></div><button class="secondary" data-action="reference" data-key="${n.id}">参照</button></div>`).join('')}</div>`;
}
function guardsHTML(){return `<div class="panel-page"><div class="eyebrow">PROTECTION</div><h2>保護一覧</h2><p class="intro">AIに変更させない対象と項目。今回だけの許可はメインチャットで伝えます。</p>${currentProject().guards.map(g=>`<div class="list-row"><div><strong>◇ ${esc(g.title)}</strong><p>${esc(g.detail)}</p></div><button class="icon danger" data-action="delete-guard" data-key="${g.id}" aria-label="${esc(g.title)}の保護を削除">×</button></div>`).join('')||'<p class="muted">保護指定はありません。</p>'}<p class="note">保護の削除は継続的な解除です。成果物は削除されません。</p></div>`;}
function styleHTML(){return `<div class="panel-page"><div class="eyebrow">STYLE & DIRECTION</div><h2>作風・制作方針</h2><p class="intro">作品の制作意図は、一般的な制作方針より優先します。</p><div class="list-row"><div><strong>この作品の制作意図</strong><p>${esc(currentProject().intent)}</p></div></div><div class="field"><label for="style-version">この作品に適用する版</label><select id="style-version"><option ${currentProject().style==='静かな風景 · 5f91881'?'selected':''}>静かな風景 · 5f91881</option><option ${currentProject().style==='余白と光 · a1f75a5'?'selected':''}>余白と光 · a1f75a5</option><option ${currentProject().style==='作風なし'?'selected':''}>作風なし</option></select></div><p class="tiny muted">現在：${esc(currentProject().style)}</p><div class="style-item">主役への視線を遮らず、余白と空気感を残す。</div><div class="style-item">人の気配は少数の小物で表現する。</div><span class="badge">採用済みの制作方針 · デモ内容</span><div class="rule"></div><p class="tiny muted">仮説：暖色を控えめに使う傾向があります。<br>この仮説は制作方針に未採用です。</p><button class="secondary" data-action="apply-style" style="margin-top:18px">選んだ版を作品に適用</button><p class="note">Git参照は表示用サンプル。実際のGit操作は行いません。</p></div>`;}
function demoHTML(){
  return `<aside class="demo-drawer"><div class="eyebrow">PROTOTYPE CONTROLS</div><h3>シナリオを試す</h3><p class="tiny muted">任意の文章に対するAI応答はありません。対応するキーワードと下のシナリオで導線を確認できます。</p><div class="demo-options">${[['start','制作を開始'],['record','手作業の記録'],['conflict','保護の競合'],['unknown','状態確認が必要'],['reconcile','停止を照合'],['offline','LLM利用不可'],['preview-failure','プレビュー失敗'],['reflection','複数作品の振り返り']].map(([k,l])=>`<button data-action="scenario" data-key="${k}" class="${k==='offline'&&state.offline||k==='preview-failure'&&state.previewFailure?'selected':''}">${l}${k==='offline'?`：${state.offline?'ON':'OFF'}`:k==='preview-failure'?`：${state.previewFailure?'ON':'OFF'}`:''}</button>`).join('')}</div><div class="row between"><span class="tiny muted">関連する内部状態（全てメモリ上）</span><button class="tiny" data-action="reset">初期化</button></div><pre class="sample-state">${esc(JSON.stringify({project:currentProject().name,chat:currentChat().title,accepted:currentProject().accepted,status:currentChat().status,detail:currentChat().detail,request:currentChat().request,reference:currentChat().reference,tabs:state.tabs.filter(t=>t.projectId===state.projectId).map(t=>t.label),sideChat:currentChat().side?'相談専用':'未作成',llmUnavailable:state.offline,previewFailure:state.previewFailure},null,2))}</pre></aside>`;
}
function toast(text){const el=$('#toast');el.textContent=text;el.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('visible'),3200);}
function saveDrafts(){const c=currentChat();if($('#main-input'))c.draft=$('#main-input').value;const si=$('#side-input');if(si){const ch=currentProject().chats.find(ch=>ch.id===si.dataset.chat);ch.side.draft=si.value;}}
function openTab(type,key,label,extra={}){saveDrafts();const tid=`${type}:${key}`;if(!state.tabs.some(t=>t.id===tid&&t.projectId===state.projectId))state.tabs.push({id:tid,type,key,label,projectId:state.projectId,...extra});state.activeTab=tid;state.mobile='panel';state.zoom=1;state.panX=state.panY=0;render();}
function openArtifact(key){const a=art(key);if(a){currentChat().source=key;openTab('artifact',key,a.title);}}
function openSide(){const c=currentChat(),p=currentProject();if(!c.side)c.side={topic:c.title,refs:[p.intent,art(c.source)?.file||'成果物未選択'],draft:'',busy:false,messages:[agent('制作の横で、気になることを相談できます。\nたとえば「ベンチの位置をBlenderで手調整するには？」と聞いてみてください。')]};openTab('side',c.id,'相談 · '+c.title,{chatId:c.id});}
function append(ch,text,refs=[]){ch.messages.push({...agent(text,refs),time:now()});}
function record(ch,text){
  const p=currentProject(),source=art(ch.reference||ch.source);if(!source&&!ch.attachments.length){append(ch,'記録する制作ファイルをプルダウンで選ぶか、保存したファイルを添付してください。');return;}
  const a={id:id(),title:'手修正 · '+now(),file:ch.attachments.find(f=>/\.(blend|psd|psb)$/i.test(f))||'shiomi_hand_edit.blend（デモ）',state:'S'+seq,time:now(),kind:source?.kind||''};a.previewMissing=state.previewFailure||!(/\.blend(?:$|（)/i.test(a.file));p.artifacts.push(a);p.history.push({id:a.id,label:a.title,reason:text});ch.source=a.id;
  append(ch,`手修正を記録しました（デモ）。\n変更元：${source?.file||'添付ファイル'}\n作業内容：${text}\n理由：未入力。後から補記できます。\n${a.previewMissing?'プレビューは未取得です。制作ファイルと本文は記録済みです。後から画像を補えます。'+(state.previewFailure?'プレビュー生成に失敗しました。':'PSD/PSB等は人間が保存したプレビューを添付してください。'):'Camera_Main・F1・1200 × 850でプレビューを生成しました（デモ画像）。'}\n${state.offline||ch.recordMode?'LLMによる要約は行っていません。':''}`,[a.id]);ch.attachments=[];
}
function startWork(ch){if(state.offline){append(ch,'LLMを利用できません。閲覧・記録として送信・バックアップは使えます。');return;}
  ch.status='running';ch.detail='植物の配置を調整中';ch.request=ch.request||{id:id(),retries:0};append(ch,'保存済みのデータを使って制作を始めました（デモ）。入力欄右下で停止できます。\nこのデモでは自動完了しないため、停止・明示再開を自由に確認できます。');}
function sendMain(){saveDrafts();const c=currentChat(),p=currentProject(),text=c.draft.trim();if(!text)return;
  if(['running','stopping'].includes(c.status)){toast('現在の作業を止めてから、次のメッセージを送信してください。');return;}
  c.messages.push({...user(text),time:now()});c.draft='';
  if(c.recordMode||/記録|登録/.test(text))record(c,text);
  else if(state.offline)append(c,'LLMを利用できません。手作業は「記録として送信」から登録できます。');
  else if(/続け|再開/.test(text)){
    if(c.status==='attention'&&c.detail==='状態確認が必要')append(c,'結果がまだ不明です。照合が終わるまで再開できません。デモ操作の「停止を照合」で確認後の状態を試せます。');
    else if(c.status==='stopped'){startWork(c);append(c,`元の作業を再開しました。依頼ID：${c.request?.id}。累積再実行回数は維持しています（このデモは未着手部分の続行です）。`);}
    else append(c,'再開対象の停止した作業がありません。新しい制作内容を指定してください。');
  }else if(/今回だけ|今回.*許可/.test(text)){c.protectedPermission=true;c.status='normal';c.detail='依頼限定の許可を記録（デモ）';append(c,'今回の依頼に限って、指定されたカメラ項目の変更を許可しました。継続的な保護は維持します。新しい依頼には引き継ぎません。');}
  else if(/方針.*採用|コミット/.test(text)){append(c,'制作方針の採用とコミットを模擬しました。作品への適用は別操作です。作風・制作方針タブで版を選んでください。');}
  else if(/不採用/.test(text)){const a=art(c.reference||c.source);append(c,`${a?.title||'指定の案'}を不採用として記録しました。成果物・理由・分岐は残し、現在採用状態は変えません。`);}
  else if(/採用/.test(text)){
    const a=art(c.reference||c.source);if(!a||a.id==='base')append(c,'どの編集案を採用しますか？成果物のプルダウンで対象を選び、採用する範囲を伝えてください。');
    else if(a.deleted)append(c,'この案の実体は削除済みのため、採用できません。');
    else if(c.status==='attention'&&c.detail==='状態確認が必要')append(c,'状態の照合が必要です。現在状態を変更しません。');
    else{p.accepted=a.id;c.status='normal';c.detail='採用・適用済み（デモ）';append(c,`${a.title}・${a.state}を採用し、現在状態に適用しました（デモ）。\n他の案は未選択のまま残します。採用理由は未入力です。`,[a.id]);}
  }else if(/戻し|戻って|復元/.test(text)){
    const ref=c.reference;if(!ref)append(c,'制作履歴タブで戻したい節点を選び、参照を添えてください。');
    else if(!art(ref)||art(ref).deleted)append(c,'復元元の実体がありません。現在状態は維持します。');
    else if(/実行/.test(text)){const before=p.accepted;p.accepted=ref;p.history.push({id:id(),label:'過去状態から復元',reason:`直前 ${before} / 復元元 ${ref}。履歴は保持（デモ）。`});append(c,'指定した状態に復元しました（デモ）。直前の状態・復元元・後続の履歴を残しています。');}
    else append(c,`${art(ref).title}へ戻します。現在の状態と後続の履歴は残ります。\n手修正の保存と登録を済ませたら「復元を実行して」と伝えてください。`);
  }else if(/別作品|派生/.test(text)){
    const a=art(c.reference||c.source);if(!a||a.deleted)append(c,'利用可能な保存状態を指定してください。');else{const np=makeProject(p.name+' · 派生',p.intent,[makeChat('派生作品の制作',[agent(`元作品「${p.name}」の${a.title}から始めました。独立した作品です（デモ）。作風は別途選択してください。`)])],[{...a}]);np.accepted=a.id;np.style='作風なし';state.projects.push(np);append(c,`「${np.name}」を作成しました（デモ）。左側の一覧から開けます。元作品は変更しません。`);}
  }else if(/補記|訂正|理由/.test(text)){append(c,'指定した記録への補記として保存しました（デモ）。以前の文章と記入時刻は保持し、通常表示は最新の内容を使います。');}
  else if(/作って|配置|調整|明るく|開始/.test(text))startWork(c);
  else append(c,'これは入力を試すためのデモ応答です。\n「この案を採用して」「ここまでを記録して」「続けて」などを試せます。その他のシナリオは右下の「シナリオ・内部状態」から選べます。');
  render();$('#main-input').focus();
}
function stopMain(){const c=currentChat();c.status='stopping';c.detail='停止待ち · 安全な停止を確認中';append(c,'停止要求を受け付けました。新しい操作を始めず、停止を確認しています。');render();setTimeout(()=>{if(c.status!=='stopping')return;c.status='stopped';c.detail='中断 · 人間による停止';append(c,'作業を停止しました（デモ）。検証済みの途中成果は保持しています。再開する場合は「続けて」と伝えてください。');render();},900);}
function sendSide(chatId){saveDrafts();const ch=currentProject().chats.find(c=>c.id===chatId),side=ch.side,text=side.draft.trim();if(!text||side.busy)return;if(state.offline){toast('LLM利用不可のため相談できません。メインの記録として送信は利用できます。');return;}
  side.messages.push(user(text));side.draft='';side.busy=true;const token=id();side.token=token;render();setTimeout(()=>{if(side.token!==token||!side.busy)return;side.busy=false;side.messages.push(agent(/採用|記録|依頼|削除|変更して/.test(text)?'このサイドチャットは相談専用です。記録・採否・制作操作やメインへの依頼は行えません。\n操作の考え方や手順については説明できます。':/Photoshop|フォトショップ|レイヤー/i.test(text)?'Photoshopでは、まず元のPSDを別名保存してから作業すると区切りを残しやすくなります。\n対象レイヤーを選び、調整レイヤーを使えば元画像を残して調整できます。作業後はPSDとプレビューを保存してください。\n\nこれは操作相談のデモ応答です。実際の画面やファイルは操作していません。':'Blenderでベンチの位置を調整する例です。\n\n1. 対象のベンチを選択します。\n2. Gキーで移動し、X・Y・Zで軸を指定します。\n3. 左クリックで確定します。\n4. 保存して、メインチャットで作業を記録できます。\n\nこれは定型のデモ説明です。選択中のファイルを操作したり、作業記録を作成したりはしません。'));render();},1100);}
function modal(title,body,action,label='作成'){const d=$('#dialog');d.innerHTML=`<div class="row between"><h2>${title}</h2><button class="icon" data-action="close-dialog" aria-label="閉じる">×</button></div>${body}<div class="dialog-footer"><button class="secondary" data-action="close-dialog">キャンセル</button>${action?`<button class="primary" data-action="${action}">${label}</button>`:''}</div>`;d.showModal();}
function settings(){state.operation='';renderSettings();}
function renderSettings(){
  let content='';const page=state.settingsPage;
  if(page==='backup')content=`<p class="muted tiny">全作品・会話・履歴と制作データを書き出します。LLMは使いません。</p><div class="field"><label>保存先（表示のみ）</label><input id="backup-path" value="D:/scene-craft-backups/2026-10-25"></div><p class="note">Git実体・認証情報は含みません。未登録・未保存のGUI内容も対象外です。</p><div class="row"><button class="primary" data-action="backup">全体バックアップを作成</button><button class="secondary" data-action="restore-backup">バックアップから復元</button></div>`;
  if(page==='data')content=`<p class="muted tiny">会話・理由・履歴は削除しません。現在採用中など、必要な実体は保護します。</p>${currentProject().artifacts.map(a=>`<div class="list-row"><div><strong>${esc(a.file)}</strong><p>${a.deleted?'削除済み · 復元できません':a.id===currentProject().accepted?'現在採用中 · 保護されています':'未採用の実体 · 128 MB（デモ）'}</p></div><button class="secondary danger" data-action="delete-artifact" data-key="${a.id}" ${a.deleted||a.id===currentProject().accepted||currentChat().status==='running'?'disabled':''}>削除</button></div>`).join('')}`;
  if(page==='runtime')content=`<div class="field"><label>モデル既定値</label><select><option>既定モデル（デモ）</option></select></div><div class="field"><label>エージェント定義の版</label><select><option>main · 5f91881（サンプル）</option></select></div><div class="field"><label>Git保存先</label><input value="GitHub / 定義・作風リポジトリ（デモ）"></div><p class="tiny muted">リモート未保存 · 最終確認なし</p><button class="secondary" data-action="publish-git" style="margin-top:12px">対象タグを明示して保存</button><div class="rule"></div><button class="secondary" data-action="migrate">保存形式の移行を確認</button>`;
  const d=$('#dialog');d.innerHTML=`<div class="row between"><h2>設定・保存データ</h2><button class="icon" data-action="close-dialog" aria-label="閉じる">×</button></div><div class="settings-nav">${[['backup','バックアップ'],['data','保存データ'],['runtime','モデル・版']].map(([k,l])=>`<button class="${page===k?'active':''}" data-action="settings-page" data-key="${k}">${l}</button>`).join('')}</div>${content}${state.operation?`<div class="operation-result" role="status">${esc(state.operation)}</div>`:''}<p class="tiny muted" style="margin-top:20px">全てデモです。ファイルの読み書き・削除・Git通信は行いません。</p>`;if(!d.open)d.showModal();
}
function scenario(key){saveDrafts();const c=currentChat();
  if(key==='start')startWork(c);
  if(key==='offline'){state.offline=!state.offline;if(state.offline){for(const p of state.projects)for(const ch of p.chats){if(ch.status==='running'||ch.status==='stopping'){ch.status='stopped';ch.detail='中断 · 利用上限（デモ）';append(ch,'利用上限のため作業を中断しました。回復後も明示的な再開が必要です。');}if(ch.side){ch.side.busy=false;ch.side.token=id();}}c.recordMode=true;}else c.recordMode=false;}
  if(key==='preview-failure')state.previewFailure=!state.previewFailure;
  if(key==='record'){c.draft='ベンチの位置を手修正しました。ここまでを記録して。';c.source='plants';state.mobile='chat';}
  if(key==='unknown'){c.status='attention';c.detail='状態確認が必要';c.request=c.request||{id:id(),retries:1};append(c,'外部処理の結果が不明です。照合できるまで競合する作業を開始しません（デモ）。');}
  if(key==='reconcile'){c.status='stopped';c.detail='中断 · 照合で停止確認済み';append(c,'操作の停止と途中成果を照合しました（デモ）。「続けて」で再開できます。');}
  if(key==='conflict'){c.status='attention';c.detail='確認待ち · カメラの保護と競合';c.request=c.request||{id:id(),retries:0};append(c,'依頼を進めるにはCamera_Mainの位置を変更する必要があります。現在は位置が保護されています。\n今回の依頼だけ認める場合は「今回はカメラの位置変更を許可して」と伝えてください。継続的な解除は保護一覧から行えます。');}
  if(key==='reflection'){reflection();return;}
  render();
}
function reflection(){modal('作品を振り返る',`<p class="muted tiny">対象作品と履歴の範囲を選び、専用チャットを始めます。</p><div class="field">${state.projects.filter(p=>!p.isReview).map(p=>`<label><input type="checkbox" name="reflection-work" value="${p.id}" checked> ${esc(p.name)}</label>`).join('')}</div><div class="field"><label for="reflection-scope">履歴の範囲</label><select id="reflection-scope"><option>現在採用状態までの分岐・採否・手修正</option><option>選択中の保存状態と、そこまでの履歴</option></select></div>`,'create-reflection','振り返りを開始');}
document.addEventListener('input',e=>{if(e.target.id==='main-input')currentChat().draft=e.target.value;if(e.target.id==='side-input'){const ch=currentProject().chats.find(c=>c.id===e.target.dataset.chat);ch.side.draft=e.target.value;}});
document.addEventListener('change',e=>{const c=currentChat();if(e.target.id==='source')c.source=e.target.value;if(e.target.id==='stage')c.stage=e.target.value;if(e.target.id==='model')c.model=e.target.value;if(e.target.id==='send-mode')c.recordMode=e.target.value==='record';});
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-action]');if(!el)return;const action=el.dataset.action,k=el.dataset.key;saveDrafts();
  if(action==='artifact')openArtifact(k);
  else if(action==='tab'){state.activeTab=k;render();}
  else if(action==='close-tab'){state.tabs=state.tabs.filter(t=>!(t.id===k&&t.projectId===state.projectId));if(state.activeTab===k)state.activeTab=state.tabs.filter(t=>t.projectId===state.projectId).at(-1)?.id;render();}
  else if(action==='side')openSide();
  else if(['history','guards','style'].includes(action))openTab(action,action,{history:'制作履歴',guards:'保護一覧',style:'作風・制作方針'}[action]);
  else if(action==='tab-menu')modal('タブを開く',`<div class="demo-options"><button class="secondary" data-action="side">相談</button><button class="secondary" data-action="history">制作履歴</button><button class="secondary" data-action="guards">保護一覧</button><button class="secondary" data-action="style">作風・制作方針</button></div>`);
  else if(action==='send')sendMain();
  else if(action==='stop')stopMain();
  else if(action==='side-send')sendSide(el.dataset.chat);
  else if(action==='side-stop'){const side=currentProject().chats.find(c=>c.id===el.dataset.chat).side;side.busy=false;side.token=id();side.messages.push(agent('相談の回答を停止しました。メインの制作作業は止まりません。'));render();}
  else if(action==='side-context'){const side=currentProject().chats.find(c=>c.id===el.dataset.chat).side;side.refs.push(`追加参照：${art(currentChat().source)?.file||'現在の話題'} / ${now()}`);render();toast('選択中の成果物を相談の参照に追加しました。');}
  else if(action==='prompt'){currentChat().draft=el.dataset.text;state.mobile='chat';render();$('#main-input').focus();}
  else if(action==='clear-ref'){currentChat().reference=null;render();}
  else if(action==='reference'){currentChat().reference=k;currentChat().source=art(k)?k:currentChat().source;state.mobile='chat';render();toast('メインチャットに参照を添えました。');}
  else if(action==='history-node'){state.historyNode=k;render();}
  else if(action==='chat'||action==='project'){state.projectId=el.dataset.project||k;state.chatId=action==='chat'?k:currentProject().chats[0].id;state.activeTab=state.tabs.filter(t=>t.projectId===state.projectId).at(-1)?.id;state.mobile='chat';render();}
  else if(action==='new-project')modal('作品を作成',`<div class="field"><label for="project-name">作品名</label><input id="project-name" placeholder="作品の名前"></div><div class="field"><label for="project-intent">制作意図（後から補えます）</label><textarea id="project-intent" placeholder="描きたい景色、空気感など"></textarea></div><div class="field"><label for="project-style">作風の版</label><select id="project-style"><option>作風なし</option><option>静かな風景 · 5f91881</option></select></div><div class="field"><label for="project-file">既存ファイルから始める（任意・名前のみ使用）</label><input id="project-file" type="file" accept=".blend,.psd,.psb"></div>`,'create-project');
  else if(action==='create-project'){const name=$('#project-name').value.trim();if(!name){$('#project-name').focus();return;}const file=$('#project-file').files[0];const np=makeProject(name,$('#project-intent').value,[makeChat('最初の制作チャット',[agent(file?`${file.name}の取り込みを模擬しました。実ファイルは読み込みません。`:'制作意図と最初の工程を伝えてください。')])],file?[{...artifactData.base,file:file.name}]:[]);np.style=$('#project-style').value;state.projects.push(np);state.projectId=np.id;state.chatId=np.chats[0].id;state.activeTab=null;$('#dialog').close();render();}
  else if(action==='new-chat')modal('新しいチャット',`<div class="field"><label for="chat-name">チャット名</label><input id="chat-name" placeholder="検討したいテーマ"></div><div class="field"><label for="chat-stage">工程</label><select id="chat-stage"><option>参考調査</option><option>シーン計画</option><option>植物・小物配置</option><option>レンダー出力</option></select></div>`,'create-chat');
  else if(action==='create-chat'){const c=makeChat($('#chat-name').value.trim()||'新しいチャット',[],$('#chat-stage').value);currentProject().chats.push(c);state.chatId=c.id;$('#dialog').close();render();}
  else if(action==='attach'){const input=document.createElement('input');input.type='file';input.multiple=true;const ch=currentChat();input.onchange=()=>{ch.attachments=Array.from(input.files).map(f=>f.name);render();};input.click();}
  else if(action==='clear-files'){currentChat().attachments=[];render();}
  else if(action==='delete-guard')modal('保護を削除',`<p>「${esc(currentProject().guards.find(g=>g.id===k)?.title)}」の保護を継続的に解除します。<br>今回だけ許可したい場合は、メインチャットで伝えてください。</p><input id="guard-to-delete" type="hidden" value="${k}">`,'confirm-delete-guard','保護を削除');
  else if(action==='confirm-delete-guard'){const key=$('#guard-to-delete').value;currentProject().guards=currentProject().guards.filter(g=>g.id!==key);$('#dialog').close();render();toast('保護を解除しました（デモ）。');}
  else if(action==='supplement-preview'){const a=art(k);if(state.previewFailure)toast('プレビュー取得に失敗しました（デモ）。元の記録は保持しています。');else{a.previewMissing=false;render();toast('プレビューの追加を模擬しました。');}}
  else if(action==='apply-style'){const selected=$('#style-version').value;currentProject().style=selected;toast('選んだ版をこの作品へ適用しました（デモ）。');render();}
  else if(action==='reflection')reflection();
  else if(action==='create-reflection'){const chosen=[...document.querySelectorAll('[name=reflection-work]:checked')].map(x=>state.projects.find(p=>p.id===x.value));if(!chosen.length){toast('作品を一つ以上選んでください。');return;}const names=chosen.map(p=>p.name).join('・');const scope=$('#reflection-scope').value;const c=makeChat(`振り返り · ${chosen.length}作品`,[user(`対象：${names}\n範囲：${scope}`),agent('対象と履歴範囲を固定して振り返りました（デモ）。\n\n仮説：少数の小物で人の気配を表し、主役のまわりに余白を残す傾向があります。根拠は駅の案Aへの修正です。\n理由未入力の部分は意図を断定していません。制作方針に採用する項目は会話で指定してください。')],'振り返り');c.scope=chosen.map(p=>p.id);if(chosen.length===1){state.projectId=chosen[0].id;currentProject().chats.push(c);}else{let group=state.projects.find(p=>p.isReview);if(!group){group=makeProject('作品横断の振り返り','指定した作品を横断して振り返る。',[],[]);group.isReview=true;state.projects.push(group);}group.chats.push(c);state.projectId=group.id;state.activeTab=null;}state.chatId=c.id;state.mobile='chat';$('#dialog').close();render();}
  else if(action==='settings')settings();
  else if(action==='settings-page'){state.settingsPage=k;state.operation='';renderSettings();}
  else if(action==='backup'){const busy=state.projects.some(p=>p.chats.some(c=>['running','stopping'].includes(c.status)||c.detail==='状態確認が必要'||c.side?.busy));state.operation=busy?'実行中または結果不明の作業があります。安全な停止と照合を確認してから書き出します。\n該当のチャットで作業を止めて、もう一度操作してください。':'全体バックアップを模擬しました。制作ファイル・会話・履歴が対象です。\nGit参照：リモート未保存。Git実体・認証情報は対象外。\n実際の書き出しは行っていません。';renderSettings();}
  else if(action==='restore-backup'){state.operation='空の保存先への復元を模擬しました。既存環境には合流しません。\nGit復旧と認証は別途必要です。制作は自動再開しません。\n実ファイルの取得・コピーは行っていません。';renderSettings();}
  else if(action==='publish-git'){state.operation='対象の保持用タグと保存先の確認を模擬しました。\nこのプロトタイプから実際のpushは行いません。';renderSettings();}
  else if(action==='migrate'){state.operation='移行前の確認：対象はローカル記録形式。退避先と必要容量を確認し、退避・検証後に移行します。\nここでは確認画面のみを模擬しています。';renderSettings();}
  else if(action==='delete-artifact'){const a=art(k);modal('実体を削除',`<p>${esc(a.file)}を削除すると、この保存状態は復元できなくなります。会話・理由・分岐は残ります。</p><input type="hidden" id="artifact-to-delete" value="${k}">`,'confirm-delete-artifact','実体を削除（デモ）');}
  else if(action==='confirm-delete-artifact'){const a=art($('#artifact-to-delete').value);if(a.id!==currentProject().accepted)a.deleted=true;state.operation='実体を削除済みとして表示しました（デモ）。履歴は保持しています。';renderSettings();render();}
  else if(action==='close-dialog')$('#dialog').close();
  else if(action==='demo'){state.drawer=!state.drawer;render();}
  else if(action==='scenario')scenario(k);
  else if(action==='prev-variant'||action==='next-variant')setVariant(action==='next-variant'?1:-1);
  else if(action==='mobile'){state.mobile=state.mobile==='chat'?'panel':'chat';render();}
  else if(action==='reset'){location.reload();}
  else if(['zoom-in','zoom-out','zoom-fit'].includes(action)){if(action==='zoom-fit'){state.zoom=1;state.panX=state.panY=0;}else state.zoom=Math.max(.4,Math.min(4,state.zoom+(action==='zoom-in'?.2:-.2)));updateZoom();}
  if(['side','history','guards','style'].includes(action)&&$('#dialog').open)$('#dialog').close();
});
function setVariant(delta){saveDrafts();state.variant=['A','B','C'][(['A','B','C'].indexOf(state.variant)+delta+3)%3];const url=new URL(location.href);url.searchParams.set('variant',state.variant);history.replaceState(null,'',url);render();}
document.addEventListener('keydown',e=>{const editing=e.target.matches('input,textarea,select,[contenteditable]');if(editing&&e.key==='Enter'&&!e.shiftKey&&e.target.id==='main-input'&&!e.isComposing){e.preventDefault();sendMain();}if(editing&&e.key==='Enter'&&!e.shiftKey&&e.target.id==='side-input'&&!e.isComposing){e.preventDefault();sendSide(e.target.dataset.chat);}if(!editing&&!$('#dialog').open&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();setVariant(e.key==='ArrowRight'?1:-1);}if(e.target.matches('[data-action][role=button]')&&['Enter',' '].includes(e.key)){e.preventDefault();e.target.click();}});
function updateZoom(){const im=$('#preview-image');if(im)im.style.transform=`translate(${state.panX}px,${state.panY}px) scale(${state.zoom})`;if($('#zoom-label'))$('#zoom-label').textContent=Math.round(state.zoom*100)+'%';}
function bindPointer(){
  const canvas=$('.preview-canvas');if(canvas){let start;canvas.addEventListener('wheel',e=>{e.preventDefault();state.zoom=Math.max(.4,Math.min(4,state.zoom-e.deltaY*.002));updateZoom();},{passive:false});canvas.addEventListener('pointerdown',e=>{start={x:e.clientX,y:e.clientY,px:state.panX,py:state.panY};canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointermove',e=>{if(start){state.panX=start.px+e.clientX-start.x;state.panY=start.py+e.clientY-start.y;updateZoom();}});canvas.addEventListener('pointerup',()=>start=null);canvas.addEventListener('pointercancel',()=>start=null);}
  const handle=$('.resize-handle');if(handle){let dragging=false;handle.addEventListener('pointerdown',e=>{dragging=true;handle.setPointerCapture(e.pointerId);});handle.addEventListener('pointermove',e=>{if(!dragging)return;const rect=$('.workspace-body').getBoundingClientRect();state.mainWidth=Math.max(30,Math.min(65,(e.clientX-rect.left)/rect.width*100));document.documentElement.style.setProperty('--main',state.mainWidth+'%');});handle.addEventListener('pointerup',()=>dragging=false);handle.addEventListener('pointercancel',()=>dragging=false);handle.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();state.mainWidth=Math.max(30,Math.min(65,state.mainWidth+(e.key==='ArrowRight'?2:-2)));document.documentElement.style.setProperty('--main',state.mainWidth+'%');}});}
}
render();
