import { getSQL, corsHeaders } from '../_lib/db.js'
import { ensureHireSchema } from '../_lib/hire.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Самодостаточная страница вакансии — для показа под доменом delever.io.
 *
 * Сайт Delever проксирует /jobs/<slug> сюда, а /jobs/_api — в публичный
 * эндпоинт интервью, поэтому кандидат видит только delever.io: ни ссылок,
 * ни ассетов, ни запросов на GFSupport. Страница без фреймворков — один
 * HTML с инлайн-стилями и ванильным JS: нечему конфликтовать с сайтом.
 */

const T: Record<string, Record<string, string>> = {
  ru: {
    apply: 'Откликнуться', name: 'Имя и фамилия', phone: 'Телефон', city: 'Город',
    exp: 'Опыт в ресторанной сфере (где, кем, сколько)', salary: 'Ожидания по зарплате',
    consent: 'Согласен(на) на обработку персональных данных',
    start: 'Начать разговор (5–7 минут)',
    note: 'Дальше — короткий разговор: несколько вопросов, можно отвечать голосом.',
    prep: 'Совет: загляните на <a href="https://delever.io" target="_blank">delever.io</a> — пара вопросов будет о продукте.',
    typing: 'Печатает…', input: 'Ваш ответ…', duties: 'Что делать', reqs: 'Требования',
    offer: 'Условия', q: 'Вопрос', fix: 'фикс', kpi: 'KPI', err: 'Не получилось, попробуйте ещё раз',
  },
  az: {
    apply: 'Müraciət et', name: 'Ad və soyad', phone: 'Telefon', city: 'Şəhər',
    exp: 'Restoran sahəsində təcrübə (harada, kim kimi, nə qədər)', salary: 'Maaş gözləntisi',
    consent: 'Şəxsi məlumatlarımın emalına razıyam',
    start: 'Söhbətə başla (5–7 dəqiqə)',
    note: 'Sonra qısa söhbət olacaq: bir neçə sual, cavabları səslə də vermək olar.',
    prep: 'Məsləhət: <a href="https://delever.io" target="_blank">delever.io</a> saytına baxın — bir neçə sual məhsul haqqında olacaq.',
    typing: 'Yazır…', input: 'Cavabınız…', duties: 'Vəzifə öhdəlikləri', reqs: 'Tələblər',
    offer: 'Nə təklif edirik', q: 'Sual', fix: 'fix', kpi: 'KPI', err: 'Alınmadı, bir daha cəhd edin',
  },
  uz: {
    apply: 'Ariza berish', name: 'Ism va familiya', phone: 'Telefon', city: 'Shahar',
    exp: 'Restoran sohasidagi tajriba (qayerda, kim bo‘lib, qancha)', salary: 'Maosh bo‘yicha kutilma',
    consent: 'Shaxsiy ma’lumotlarimni qayta ishlashga roziman',
    start: 'Suhbatni boshlash (5–7 daqiqa)',
    note: 'Keyin qisqa suhbat bo‘ladi: bir nechta savol, ovozda ham javob berish mumkin.',
    prep: 'Maslahat: <a href="https://delever.io" target="_blank">delever.io</a> saytiga qarang — bir nechta savol mahsulot haqida bo‘ladi.',
    typing: 'Yozmoqda…', input: 'Javobingiz…', duties: 'Vazifalar', reqs: 'Talablar',
    offer: 'Shartlar', q: 'Savol', fix: 'fix', kpi: 'KPI', err: 'Xatolik, yana urinib ko‘ring',
  },
}

const esc = (s: any) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function render(v: any, t: Record<string, string>): string {
  const list = (items: string[], title: string) => items?.length
    ? `<h4>${esc(title)}</h4><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''
  const pay = (Number(v.pay_fix) > 0 || Number(v.pay_kpi) > 0)
    ? `<div class="pay">
        <div><div class="v">${Number(v.pay_fix).toLocaleString('ru-RU')} ${esc(v.currency)}</div><div class="l">${t.fix}</div></div>
        <div><div class="v">${Number(v.pay_kpi).toLocaleString('ru-RU')} ${esc(v.currency)}</div><div class="l">${t.kpi}</div></div>
      </div>` : ''

  return `<!doctype html>
<html lang="${esc(v.lang)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(v.title)} — Delever</title>
<meta name="description" content="${esc(v.intro || v.title)}">
<link rel="icon" type="image/svg+xml" href="https://delever.io/logo/logo-compact.svg">
<link rel="icon" type="image/png" sizes="32x32" href="https://delever.io/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="https://delever.io/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="https://delever.io/apple-touch-icon.png">
<style>
  * { box-sizing:border-box; margin:0 }
  body { background:#f6f7fa; color:#101623; font:15px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;
    display:flex; justify-content:center; padding:20px 12px }
  .card { background:#fff; border:1px solid #e5e9f0; border-radius:14px; width:100%; max-width:640px }
  .inner { padding:26px 24px 30px }
  .brand { font-size:12px; font-weight:700; letter-spacing:.1em; color:#2b5cd9; text-transform:uppercase }
  h1 { font-size:25px; margin:4px 0 2px } .meta { color:#8a94a3; font-size:13px }
  .intro { color:#4b5768; font-size:14px; margin-top:10px }
  .pay { display:flex; gap:1px; background:#e5e9f0; border:1px solid #e5e9f0; border-radius:10px; overflow:hidden; margin:14px 0 }
  .pay>div { flex:1; background:#fff; padding:10px 14px; text-align:center }
  .pay .v { font-size:18px; font-weight:700 } .pay .l { font-size:11.5px; color:#8a94a3 }
  h4 { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:#8a94a3; margin:18px 0 6px }
  ul { padding-left:18px; font-size:13.5px; color:#4b5768 } li { margin:4px 0 }
  .row { display:flex; flex-wrap:wrap; gap:8px }
  input[type=text], input[type=tel] { border:1px solid #d7dde6; border-radius:10px; padding:11px 13px;
    font:inherit; font-size:14px; flex:1 1 45%; min-width:160px }
  .wide { flex:1 1 100% !important }
  label.consent { display:flex; gap:8px; align-items:center; font-size:12.5px; color:#4b5768; margin:12px 0 }
  button.primary { border:none; border-radius:10px; background:#2b5cd9; color:#fff; font-weight:600;
    font-size:15px; padding:13px; width:100%; cursor:pointer }
  button.primary:disabled { opacity:.5 }
  .hint { color:#8a94a3; font-size:12px; margin-top:8px }
  .hint a { color:#2b5cd9 }
  .error { color:#bc3a2e; font-size:13px; margin:8px 0 }
  /* Чат */
  .chatwrap { display:none; flex-direction:column; height:86vh }
  .chead { padding:14px 16px; border-bottom:1px solid #e5e9f0 }
  .chead b { font-size:15px } .chead .no { color:#8a94a3; font-size:12px; margin-left:8px }
  .pbar { height:4px; background:#e5e9f0; border-radius:2px; margin-top:8px; overflow:hidden }
  .pbar i { display:block; height:100%; width:0; background:#2b5cd9; transition:width .3s }
  .chat { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:8px }
  .msg { max-width:86%; padding:9px 12px; border-radius:12px; font-size:14px }
  .msg.ai { background:#f3f5f9; border:1px solid #e5e9f0; align-self:flex-start; border-bottom-left-radius:4px }
  .msg.me { background:#2b5cd9; color:#fff; align-self:flex-end; border-bottom-right-radius:4px }
  .typing { color:#8a94a3; font-size:12.5px }
  .bye { background:#e3f2ec; border:1px solid #0e7a52; color:#0e7a52; border-radius:10px; padding:12px 14px; font-size:14px }
  .composer { display:flex; gap:8px; padding:10px 14px 14px }
  .composer input { flex:1; min-width:0 }
  .composer button { border:none; border-radius:10px; font-weight:600; font-size:15px;
    min-width:46px; cursor:pointer; background:#2b5cd9; color:#fff }
  .composer button.mic { background:#eef2fa; color:#2b5cd9 }
  .composer button.mic.rec { background:#bc3a2e; color:#fff }
</style></head><body>
<div class="card">
  <div class="inner" id="landing">
    <div class="brand">Delever${v.location ? ' · ' + esc(v.location) : ''}</div>
    <h1>${esc(v.title)}</h1>
    ${v.schedule ? `<div class="meta">${esc(v.schedule)}</div>` : ''}
    ${v.intro ? `<p class="intro">${esc(v.intro)}</p>` : ''}
    ${pay}
    ${list(v.duties, t.duties)}
    ${list(v.requirements, t.reqs)}
    ${list(v.offers, t.offer)}
    <h4>${t.apply}</h4>
    <div class="row">
      <input type="text" id="f-name" placeholder="${esc(t.name)}">
      <input type="tel" id="f-phone" placeholder="${esc(t.phone)}">
      <input type="text" id="f-city" placeholder="${esc(t.city)}">
      <input type="text" id="f-salary" placeholder="${esc(t.salary)}">
      <input type="text" id="f-exp" class="wide" placeholder="${esc(t.exp)}">
    </div>
    <label class="consent"><input type="checkbox" id="f-consent"> ${esc(t.consent)}</label>
    <div class="error" id="err" hidden></div>
    <button class="primary" id="startBtn">${esc(t.start)}</button>
    <div class="hint">${esc(t.note)}</div>
    <div class="hint">${t.prep}</div>
  </div>

  <div class="chatwrap" id="chatwrap">
    <div class="chead"><b>Delever · ${esc(v.title)}</b><span class="no" id="qno"></span>
      <div class="pbar"><i id="pfill"></i></div></div>
    <div class="chat" id="chat"></div>
    <div class="composer" id="composer">
      <input type="text" id="answer" placeholder="${esc(t.input)}">
      <button class="mic" id="micBtn">🎙</button>
      <button id="sendBtn">→</button>
    </div>
  </div>
</div>
<script>
var SLUG=${JSON.stringify(v.slug).replace(/</g, '\\u003c')};
var TOTAL=${Number(v.questions_count) || 8};
var TYPING=${JSON.stringify(T[v.lang]?.typing || T.ru.typing)};
var ERRTXT=${JSON.stringify(T[v.lang]?.err || T.ru.err)};
var QLBL=${JSON.stringify(T[v.lang]?.q || T.ru.q)};
// Через сайт страница живёт на delever.io и ходит в /jobs/_api;
// прямое открытие на gfsupport бьёт в API напрямую
var API=location.hostname.indexOf('gfsupport')>-1?'/api/support/public/jobs':'/jobs/_api';
var token=new URLSearchParams(location.search).get('t')||'';
var no=0, waiting=false, rec=null, chunks=[];

function $(id){return document.getElementById(id)}
function show(err){var e=$('err');e.hidden=!err;e.textContent=err||''}
function addMsg(role,text){var d=document.createElement('div');d.className='msg '+role;d.textContent=text;
  $('chat').appendChild(d);$('chat').scrollTop=1e9}
function setTyping(on){var t=$('t-ind');if(on&&!t){t=document.createElement('div');t.id='t-ind';
  t.className='typing';t.textContent=TYPING;$('chat').appendChild(t);$('chat').scrollTop=1e9}
  if(!on&&t)t.remove()}
function setNo(n){no=n;$('qno').textContent=QLBL+' '+Math.min(n,TOTAL)+' / '+TOTAL;
  $('pfill').style.width=Math.round(n/TOTAL*100)+'%'}
function finish(text){setTyping(false);var d=document.createElement('div');d.className='bye';
  d.textContent=text;$('chat').appendChild(d);$('chat').scrollTop=1e9;
  $('composer').style.display='none';$('pfill').style.width='100%'}
function toChat(){$('landing').style.display='none';var w=$('chatwrap');w.style.display='flex'}

function post(body){return fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)}).then(function(r){return r.json()})}

function ask(payload){
  waiting=true;setTyping(true);
  post(payload).then(function(d){
    waiting=false;setTyping(false);
    if(d.transcribed)addMsg('me',d.transcribed);
    if(d.done){finish(d.farewell||'✓');return}
    if(d.error){addMsg('ai',ERRTXT);return}
    addMsg('ai',d.question);setNo(d.no)
  }).catch(function(){waiting=false;setTyping(false);addMsg('ai',ERRTXT)})
}

$('startBtn').onclick=function(){
  var name=$('f-name').value.trim(),phone=$('f-phone').value.trim();
  if(!name||phone.replace(/[^0-9]/g,'').length<9||!$('f-consent').checked)return;
  this.disabled=true;show('');
  post({action:'apply',slug:SLUG,name:name,phone:phone,city:$('f-city').value.trim(),
    salary:$('f-salary').value.trim(),experience:$('f-exp').value.trim(),consent:true})
  .then(function(d){
    if(d.error){show(d.error);$('startBtn').disabled=false;return}
    token=d.token;
    history.replaceState(null,'',location.pathname+'?t='+encodeURIComponent(token));
    toChat();ask({action:'message',token:token,text:''})
  }).catch(function(){show(ERRTXT);$('startBtn').disabled=false})
};

function send(){
  var inp=$('answer'),text=inp.value.trim();
  if(!text||waiting||!token)return;
  addMsg('me',text);inp.value='';
  ask({action:'message',token:token,text:text})
}
$('sendBtn').onclick=send;
$('answer').addEventListener('keydown',function(e){if(e.key==='Enter')send()});

$('micBtn').onclick=function(){
  var btn=this;
  if(rec){rec.stop();return}
  navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
    rec=new MediaRecorder(stream,{mimeType:'audio/webm'});chunks=[];
    rec.ondataavailable=function(e){if(e.data.size)chunks.push(e.data)};
    rec.onstop=function(){
      stream.getTracks().forEach(function(tr){tr.stop()});
      btn.classList.remove('rec');btn.textContent='🎙';
      var blob=new Blob(chunks,{type:'audio/webm'});rec=null;
      if(blob.size<1000||blob.size>2500000)return;
      blob.arrayBuffer().then(function(buf){
        var bytes=new Uint8Array(buf),bin='';
        for(var i=0;i<bytes.length;i+=8192)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));
        ask({action:'voice',token:token,audio:btoa(bin),mime:'audio/webm'})
      })
    };
    rec.start();btn.classList.add('rec');btn.textContent='■'
  }).catch(function(){})
};

// Возврат по ссылке: восстанавливаем диалог с места остановки
if(token){
  fetch(API+'?token='+encodeURIComponent(token)).then(function(r){return r.json()}).then(function(d){
    if(d.error)return;
    toChat();
    (d.messages||[]).forEach(function(m){addMsg(m.role==='ai'?'ai':'me',m.text)});
    setNo(d.questionNo||0);
    if(d.finished)finish(d.farewell||'✓');
    else if(!(d.messages||[]).length)ask({action:'message',token:token,text:''})
  })
}
</script>
</body></html>`
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  const sql = getSQL()
  await ensureHireSchema(sql)
  const url = new URL(req.url)
  const slug = (url.searchParams.get('slug') || '').toLowerCase()
  const [v] = await sql`
    SELECT * FROM hire_vacancies WHERE slug = ${slug} AND status = 'active' LIMIT 1
  `
  if (!v) {
    return new Response('<!doctype html><meta charset="utf-8"><title>Delever</title><body style="font-family:sans-serif;padding:40px">Vakansiya tapılmadı · Вакансия не найдена</body>', {
      status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  const t = T[v.lang] || T.ru
  return new Response(render(v, t), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    },
  })
}
