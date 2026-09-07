import { getSQL, corsHeaders } from '../_lib/db.js'
import { ensureHireSchema } from '../_lib/hire.js'

export const config = { runtime: 'edge', regions: ['fra1'] }

/**
 * Самодостаточная страница вакансии — для показа под доменом delever.io.
 *
 * Сайт Delever проксирует /jobs/<slug> сюда, а /jobs/_api — в публичный
 * эндпоинт интервью: кандидат видит только delever.io.
 *
 * Мультиязычность: у вакансии есть основной язык и переводы (i18n,
 * сгенерированы при сохранении). Кандидат выбирает язык переключателем —
 * на нём рендерится лендинг, анкета и идёт само интервью (выбор уезжает
 * в apply и сохраняется на кандидате).
 */

const T: Record<string, Record<string, string>> = {
  ru: {
    name: 'Имя и фамилия', phone: 'Телефон', city: 'Город',
    exp: 'Опыт работы: где, кем, сколько', salary: 'Ожидания по зарплате',
    consent: 'Согласен(на) на обработку персональных данных',
    start: 'Начать разговор (5–7 минут)', apply: 'Откликнуться',
    note: 'Дальше — короткий разговор: несколько вопросов, можно отвечать голосом.',
    prep: 'Совет: загляните на {site} — пара вопросов будет о продукте.',
    vName: 'Укажите имя и фамилию', vPhone: 'Укажите телефон — минимум 9 цифр', vConsent: 'Нужна галочка согласия на обработку данных',
    typing: 'Печатает…', input: 'Ваш ответ…', duties: 'Что делать', reqs: 'Требования',
    offer: 'Условия', q: 'Вопрос', fix: 'фикс', kpi: 'KPI', err: 'Не получилось, попробуйте ещё раз',
  },
  az: {
    name: 'Ad və soyad', phone: 'Telefon', city: 'Şəhər',
    exp: 'İş təcrübəsi: harada, kim kimi, nə qədər', salary: 'Maaş gözləntisi',
    consent: 'Şəxsi məlumatlarımın emalına razıyam',
    start: 'Söhbətə başla (5–7 dəqiqə)', apply: 'Müraciət et',
    note: 'Sonra qısa söhbət olacaq: bir neçə sual, cavabları səslə də vermək olar.',
    prep: 'Məsləhət: {site} saytına baxın — bir neçə sual məhsul haqqında olacaq.',
    vName: 'Ad və soyadınızı yazın', vPhone: 'Telefon nömrəsini yazın — ən azı 9 rəqəm', vConsent: 'Şəxsi məlumatların emalına razılıq lazımdır',
    typing: 'Yazır…', input: 'Cavabınız…', duties: 'Vəzifə öhdəlikləri', reqs: 'Tələblər',
    offer: 'Nə təklif edirik', q: 'Sual', fix: 'fix', kpi: 'KPI', err: 'Alınmadı, bir daha cəhd edin',
  },
  uz: {
    name: 'Ism va familiya', phone: 'Telefon', city: 'Shahar',
    exp: 'Ish tajribasi: qayerda, kim bo‘lib, qancha', salary: 'Maosh bo‘yicha kutilma',
    consent: 'Shaxsiy ma’lumotlarimni qayta ishlashga roziman',
    start: 'Suhbatni boshlash (5–7 daqiqa)', apply: 'Ariza berish',
    note: 'Keyin qisqa suhbat bo‘ladi: bir nechta savol, ovozda ham javob berish mumkin.',
    prep: 'Maslahat: {site} saytiga qarang — bir nechta savol mahsulot haqida bo‘ladi.',
    vName: 'Ism va familiyangizni yozing', vPhone: 'Telefon raqamini yozing — kamida 9 raqam', vConsent: 'Shaxsiy ma’lumotlarni qayta ishlashga rozilik kerak',
    typing: 'Yozmoqda…', input: 'Javobingiz…', duties: 'Vazifalar', reqs: 'Talablar',
    offer: 'Shartlar', q: 'Savol', fix: 'fix', kpi: 'KPI', err: 'Xatolik, yana urinib ko‘ring',
  },
  kz: {
    name: 'Аты-жөні', phone: 'Телефон', city: 'Қала',
    exp: 'Жұмыс тәжірибесі: қайда, кім болып, қанша', salary: 'Жалақы бойынша күтілім',
    consent: 'Жеке деректерімді өңдеуге келісемін',
    start: 'Әңгімені бастау (5–7 минут)', apply: 'Өтініш беру',
    note: 'Кейін қысқа әңгіме болады: бірнеше сұрақ, дауыспен де жауап беруге болады.',
    prep: 'Кеңес: {site} сайтына қараңыз — бірнеше сұрақ өнім туралы болады.',
    vName: 'Аты-жөніңізді жазыңыз', vPhone: 'Телефон нөмірін жазыңыз — кемінде 9 сан', vConsent: 'Жеке деректерді өңдеуге келісім қажет',
    typing: 'Жазуда…', input: 'Жауабыңыз…', duties: 'Міндеттер', reqs: 'Талаптар',
    offer: 'Шарттар', q: 'Сұрақ', fix: 'фикс', kpi: 'KPI', err: 'Болмады, қайталап көріңіз',
  },
}

const LANG_LABELS: Record<string, string> = {
  ru: 'Русский', az: 'Azərbaycanca', uz: 'O‘zbekcha', kz: 'Қазақша', en: 'English',
}

const esc = (s: any) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const jsSafe = (o: any) => JSON.stringify(o).replace(/</g, '\\u003c')

function render(v: any): string {
  const langs: string[] = (Array.isArray(v.langs) && v.langs.length ? v.langs : [v.lang])
    .filter((l: string) => T[l] || l === v.lang)
  const payload = {
    slug: v.slug,
    primary: v.lang,
    langs,
    total: Number(v.questions_count) || 8,
    payFix: Number(v.pay_fix), payKpi: Number(v.pay_kpi), currency: v.currency,
    content: {
      [v.lang]: {
        title: v.title, intro: v.intro || '', schedule: v.schedule || '',
        location: v.location || '', duties: v.duties || [],
        requirements: v.requirements || [], offers: v.offers || [],
      },
      ...(v.i18n || {}),
    },
  }

  return `<!doctype html>
<html lang="${esc(v.lang)}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(v.title)} — Delever</title>
<meta name="description" content="${esc(v.intro || v.title)}">
<meta property="og:title" content="${esc(v.title)} — Delever">
<meta property="og:description" content="${esc(v.intro || v.title)}">
<link rel="icon" type="image/svg+xml" href="https://delever.io/logo/logo-compact.svg">
<link rel="icon" type="image/png" sizes="32x32" href="https://delever.io/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="https://delever.io/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="https://delever.io/apple-touch-icon.png">
<style>
  * { box-sizing:border-box; margin:0 }
  body { background:#f6f7fa; color:#101623; font:15px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;
    display:flex; justify-content:center; padding:20px 12px }
  .card { background:#fff; border:1px solid #e5e9f0; border-radius:14px; width:100%; max-width:640px }
  .inner { padding:22px 24px 30px }
  .top { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap }
  .brand { font-size:12px; font-weight:700; letter-spacing:.1em; color:#2b5cd9; text-transform:uppercase }
  .langs { display:flex; gap:4px }
  .langs button { border:1px solid #d7dde6; background:#fff; color:#4b5768; border-radius:8px;
    font:600 11.5px/1 -apple-system,sans-serif; padding:6px 9px; cursor:pointer }
  .langs button.on { background:#2b5cd9; border-color:#2b5cd9; color:#fff }
  h1 { font-size:25px; margin:10px 0 2px } .meta { color:#8a94a3; font-size:13px }
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
  .hint { color:#8a94a3; font-size:12px; margin-top:8px } .hint a { color:#2b5cd9 }
  .error { color:#bc3a2e; font-size:13px; margin:8px 0 }
  input.bad { border-color:#bc3a2e !important; background:#fdf6f5 }
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
  <div class="inner" id="landing"></div>
  <div class="chatwrap" id="chatwrap">
    <div class="chead"><b id="ctitle">Delever</b><span class="no" id="qno"></span>
      <div class="pbar"><i id="pfill"></i></div></div>
    <div class="chat" id="chat"></div>
    <div class="composer" id="composer">
      <input type="text" id="answer" placeholder="">
      <button class="mic" id="micBtn">🎙</button>
      <button id="sendBtn">→</button>
    </div>
  </div>
</div>
<script>
var V=${jsSafe(payload)};
var TT=${jsSafe(T)};
var LL=${jsSafe(LANG_LABELS)};
var API=location.hostname.indexOf('gfsupport')>-1?'/api/support/public/jobs':'/jobs/_api';
var params=new URLSearchParams(location.search);
var token=params.get('t')||'';
var lang=params.get('l');
if(!lang||V.langs.indexOf(lang)<0){
  var nav=(navigator.language||'').slice(0,2).toLowerCase();
  lang=V.langs.indexOf(nav)>-1?nav:V.primary;
}
var no=0,waiting=false,rec=null,chunks=[],saved={};

function $(id){return document.getElementById(id)}
function t(){return TT[lang]||TT.ru}
function c(){return V.content[lang]||V.content[V.primary]}
function fmtN(n){return (n||0).toLocaleString('ru-RU')}
function escapeHtml(s){var d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML}

function langBtns(){
  if(V.langs.length<2)return'';
  return '<div class="langs">'+V.langs.map(function(l){
    return '<button data-l="'+l+'" class="'+(l===lang?'on':'')+'">'+escapeHtml(LL[l]||l)+'</button>'
  }).join('')+'</div>'
}
function list(items,title){
  if(!items||!items.length)return'';
  return '<h4>'+escapeHtml(title)+'</h4><ul>'+items.map(function(i){return '<li>'+escapeHtml(i)+'</li>'}).join('')+'</ul>'
}
function renderLanding(){
  var x=c(),tr=t();
  var pay=(V.payFix>0||V.payKpi>0)
    ?'<div class="pay"><div><div class="v">'+fmtN(V.payFix)+' '+escapeHtml(V.currency)+'</div><div class="l">'+tr.fix+'</div></div>'+
     '<div><div class="v">'+fmtN(V.payKpi)+' '+escapeHtml(V.currency)+'</div><div class="l">'+tr.kpi+'</div></div></div>':'';
  var site='<a href="https://delever.io" target="_blank">delever.io</a>';
  $('landing').innerHTML=
    '<div class="top"><div class="brand">Delever'+(x.location?' · '+escapeHtml(x.location):'')+'</div>'+langBtns()+'</div>'+
    '<h1>'+escapeHtml(x.title)+'</h1>'+
    (x.schedule?'<div class="meta">'+escapeHtml(x.schedule)+'</div>':'')+
    (x.intro?'<p class="intro">'+escapeHtml(x.intro)+'</p>':'')+
    pay+list(x.duties,tr.duties)+list(x.requirements,tr.reqs)+list(x.offers,tr.offer)+
    '<h4>'+tr.apply+'</h4>'+
    '<div class="row">'+
      '<input type="text" id="f-name" placeholder="'+tr.name+'">'+
      '<input type="tel" id="f-phone" placeholder="'+tr.phone+'">'+
      '<input type="text" id="f-city" placeholder="'+tr.city+'">'+
      '<input type="text" id="f-salary" placeholder="'+tr.salary+'">'+
      '<input type="text" id="f-exp" class="wide" placeholder="'+tr.exp+'">'+
    '</div>'+
    '<label class="consent"><input type="checkbox" id="f-consent"> '+tr.consent+'</label>'+
    '<div class="error" id="err" hidden></div>'+
    '<button class="primary" id="startBtn">'+tr.start+'</button>'+
    '<div class="hint">'+tr.note+'</div>'+
    '<div class="hint">'+tr.prep.replace('{site}',site)+'</div>';
  // Введённое переживает смену языка — человек не должен набирать заново
  ;['name','phone','city','salary','exp'].forEach(function(k){
    var el=$('f-'+k);if(saved[k])el.value=saved[k];
    el.addEventListener('input',function(){saved[k]=el.value;el.classList.remove('bad');show('')})
  });
  if(saved.consent)$('f-consent').checked=true;
  $('f-consent').addEventListener('change',function(e){saved.consent=e.target.checked});
  $('startBtn').onclick=startApply;
  Array.prototype.forEach.call(document.querySelectorAll('.langs button'),function(b){
    b.onclick=function(){lang=b.getAttribute('data-l');
      params.set('l',lang);history.replaceState(null,'',location.pathname+'?'+params);
      renderLanding()}
  });
  $('ctitle').textContent='Delever · '+c().title;
  $('answer').placeholder=t().input;
  document.documentElement.lang=lang;document.title=c().title+' — Delever';
}

function show(err){var e=$('err');if(e){e.hidden=!err;e.textContent=err||''}}
function addMsg(role,text){var d=document.createElement('div');d.className='msg '+role;d.textContent=text;
  $('chat').appendChild(d);$('chat').scrollTop=1e9}
function setTyping(on){var ti=$('t-ind');if(on&&!ti){ti=document.createElement('div');ti.id='t-ind';
  ti.className='typing';ti.textContent=t().typing;$('chat').appendChild(ti);$('chat').scrollTop=1e9}
  if(!on&&ti)ti.remove()}
function setNo(n){no=n;$('qno').textContent=t().q+' '+Math.min(n,V.total)+' / '+V.total;
  $('pfill').style.width=Math.round(n/V.total*100)+'%'}
function finish(text){setTyping(false);var d=document.createElement('div');d.className='bye';
  d.textContent=text;$('chat').appendChild(d);$('chat').scrollTop=1e9;
  $('composer').style.display='none';$('pfill').style.width='100%'}
function toChat(){$('landing').style.display='none';$('chatwrap').style.display='flex';
  $('ctitle').textContent='Delever · '+c().title;$('answer').placeholder=t().input}

function post(body){return fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)}).then(function(r){return r.json()})}

function ask(payload){
  waiting=true;setTyping(true);
  post(payload).then(function(d){
    waiting=false;setTyping(false);
    if(d.transcribed)addMsg('me',d.transcribed);
    if(d.done){finish(d.farewell||'✓');return}
    if(d.error){addMsg('ai',t().err);return}
    addMsg('ai',d.question);setNo(d.no)
  }).catch(function(){waiting=false;setTyping(false);addMsg('ai',t().err)})
}

function startApply(){
  var tr=t();
  var nameEl=$('f-name'),phoneEl=$('f-phone');
  var name=(nameEl.value||'').trim(),phone=(phoneEl.value||'').trim();
  nameEl.classList.remove('bad');phoneEl.classList.remove('bad');
  var errs=[];
  if(!name){errs.push(tr.vName);nameEl.classList.add('bad')}
  if(phone.replace(/[^0-9]/g,'').length<9){errs.push(tr.vPhone);phoneEl.classList.add('bad')}
  if(!$('f-consent').checked)errs.push(tr.vConsent);
  if(errs.length){show(errs.join('. '));var bad=document.querySelector('input.bad');if(bad)bad.focus();return}
  $('startBtn').disabled=true;show('');
  post({action:'apply',slug:V.slug,name:name,phone:phone,lang:lang,
    city:($('f-city').value||'').trim(),salary:($('f-salary').value||'').trim(),
    experience:($('f-exp').value||'').trim(),consent:true})
  .then(function(d){
    if(d.error){show(d.error);$('startBtn').disabled=false;return}
    token=d.token;
    params.set('t',token);history.replaceState(null,'',location.pathname+'?'+params);
    toChat();ask({action:'message',token:token,text:''})
  }).catch(function(){show(t().err);$('startBtn').disabled=false})
}

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

renderLanding();

// Возврат по ссылке: восстанавливаем диалог с места остановки
if(token){
  fetch(API+'?token='+encodeURIComponent(token)).then(function(r){return r.json()}).then(function(d){
    if(d.error)return;
    if(d.lang&&V.langs.indexOf(d.lang)>-1)lang=d.lang;
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

/** Индекс вакансий: delever.io/jobs без слага — список всех открытых. */
function renderIndex(rows: any[]): string {
  const cards = rows.map(v => {
    const langs = (Array.isArray(v.langs) && v.langs.length ? v.langs : [v.lang])
      .map((l: string) => LANG_LABELS[l] || l).join(' · ')
    const pay = (Number(v.pay_fix) > 0 || Number(v.pay_kpi) > 0)
      ? `${Number(v.pay_fix).toLocaleString('ru-RU')} + ${Number(v.pay_kpi).toLocaleString('ru-RU')} ${esc(v.currency)}`
      : ''
    return `<a class="vac" href="/jobs/${esc(v.slug)}">
      <div class="vt">${esc(v.title)}</div>
      <div class="vm">${[v.location, pay].filter(Boolean).map(esc).join(' · ')}</div>
      <div class="vl">${esc(langs)}</div>
    </a>`
  }).join('')
  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Работа в Delever</title>
<meta name="description" content="Открытые вакансии Delever — международной IT-компании: онлайн-заказы, доставка и QR-меню для ресторанного бизнеса.">
<link rel="icon" type="image/svg+xml" href="https://delever.io/logo/logo-compact.svg">
<link rel="icon" type="image/png" sizes="32x32" href="https://delever.io/favicon-32.png">
<style>
  * { box-sizing:border-box; margin:0 }
  body { background:#f6f7fa; color:#101623; font:15px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;
    display:flex; justify-content:center; padding:28px 12px }
  .wrap { width:100%; max-width:640px }
  .brand { font-size:12px; font-weight:700; letter-spacing:.1em; color:#2b5cd9; text-transform:uppercase }
  h1 { font-size:26px; margin:4px 0 4px }
  .sub { color:#4b5768; font-size:14px; margin-bottom:18px }
  .vac { display:block; background:#fff; border:1px solid #e5e9f0; border-radius:14px;
    padding:16px 18px; margin-bottom:10px; text-decoration:none; color:inherit }
  .vac:hover { border-color:#2b5cd9 }
  .vt { font-size:17px; font-weight:700; color:#101623 }
  .vm { font-size:13px; color:#4b5768; margin-top:2px }
  .vl { font-size:11.5px; color:#8a94a3; margin-top:4px }
  .empty { color:#8a94a3; font-size:14px; background:#fff; border:1px solid #e5e9f0;
    border-radius:14px; padding:24px; text-align:center }
</style></head><body>
<div class="wrap">
  <div class="brand">Delever</div>
  <h1>Работа в Delever</h1>
  <div class="sub">Международная IT-компания: онлайн-заказы, доставка и QR-меню для ресторанного бизнеса.
    Выберите вакансию — отклик и короткое интервью займут 10 минут, язык выбирается на странице.</div>
  ${cards || '<div class="empty">Открытых вакансий сейчас нет · Hozircha ochiq vakansiyalar yo‘q</div>'}
</div>
</body></html>`
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
  const sql = getSQL()
  await ensureHireSchema(sql)
  const url = new URL(req.url)
  const slug = (url.searchParams.get('slug') || '').toLowerCase()

  // Без слага — список открытых вакансий
  if (!slug) {
    const rows = await sql`
      SELECT slug, title, lang, langs, location, pay_fix, pay_kpi, currency
      FROM hire_vacancies WHERE status = 'active' ORDER BY created_at DESC
    `
    return new Response(renderIndex(rows as any[]), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
    })
  }

  const [v] = await sql`
    SELECT * FROM hire_vacancies WHERE slug = ${slug} AND status = 'active' LIMIT 1
  `
  if (!v) {
    return new Response('<!doctype html><meta charset="utf-8"><title>Delever</title><body style="font-family:sans-serif;padding:40px">Vakansiya tapılmadı · Вакансия не найдена</body>', {
      status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  return new Response(render(v), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    },
  })
}
