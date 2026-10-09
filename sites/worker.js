const ORIGIN = 'https://www.dongqiudi.com';
const MOBILE_ORIGIN = 'https://m.dongqiudi.com';
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_BYTES = 6 * 1024 * 1024;
const pending = new Map();
const localRate = new Map();
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function device(request, override) { return ['pc','mobile'].includes(override) ? override : /Mobile|Android|iPhone|iPod|IEMobile|Opera Mini/i.test(request.headers.get('User-Agent') || '') ? 'mobile' : 'pc'; }
function unescapeJS(s) { return s.replace(/\\u([\da-f]{4})/gi, (_,c)=>String.fromCharCode(parseInt(c,16))).replace(/\\\//g,'/').replace(/\\"/g,'"'); }
export function parseReports(html) {
  const entries = new Map();
  const re = /title:"((?:[^"\\]|\\.)*)"[\s\S]{0,600}?aid:"(\d+)"[\s\S]{0,200}?show_time:(\d+)/g;
  for (const m of html.matchAll(re)) {
    const title = unescapeJS(m[1]);
    if (!title.includes('早报')) continue;
    const date = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Number(m[3])*1000));
    if (!entries.has(date)) entries.set(date,{title,aid:m[2],date});
  }
  const reports = [...entries.values()].sort((a,b)=>b.date.localeCompare(a.date));
  if (!reports.length) throw new Error('暂时无法解析早报列表，请稍后重试，或输入文章号打开。');
  return reports;
}
export function convert(html, version) {
  const origin = version==='mobile' ? MOBILE_ORIGIN : ORIGIN;
  const target = version==='mobile' ? 'https://m.dongqiudi.com/article/' : ORIGIN+'/articles/';
  const slash = '(?:/|\\\\u002[Ff]|\\\\/)';
  html = html.replace(new RegExp('dongqiudi:'+slash+slash+'(?:'+slash+')?news'+slash+'(\\d+)','g'),(_,id)=>target+id+'.html');
  html = html.replace(new RegExp('dongqiudi:'+slash+slash+'article\\?id=(\\d+)','g'),(_,id)=>target+id+'.html');
  html = html.replace(/(src|href)="\/(?!\/)/g,'$1="'+origin+'/').replace(/url\(\/(?!\/)/g,'url('+origin+'/');
  // Keep the article pathname for Nuxt hydration; do not add a base tag.
  return html;
}
async function upstream(path, version='pc') {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),15000);
  try {
    const response = await fetch((version==='mobile' ? MOBILE_ORIGIN : ORIGIN)+path,{headers:{'User-Agent':version==='mobile' ? MOBILE_UA : UA,'Accept-Language':'zh-CN,zh;q=0.9'},signal:controller.signal,redirect:'manual'});
    if (!response.ok) throw new Error('懂球帝暂时无法访问（'+response.status+'），请稍后重试。');
    const type = response.headers.get('Content-Type') || 'application/octet-stream';
    if (Number(response.headers.get('Content-Length') || 0)>MAX_BYTES) throw new Error('页面过大，暂时无法读取。');
    const chunks=[]; let length=0;
    const reader=response.body.getReader();
    while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_BYTES){await reader.cancel();throw new Error('页面过大，暂时无法读取。');}chunks.push(value);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    return {bytes,type};
  } catch(e) { if(e.name==='AbortError') throw new Error('读取早报超时，请稍后重试。'); throw e; }
  finally { clearTimeout(timer); }
}
async function cached(env,key,ttl,load) {
  let saved=null;
  if(env.BUCKET) { try {const object=await env.BUCKET.get(key);if(object)saved=await object.json();}catch(e){console.error('Cache read failed',key,e.message);} }
  if(saved && Date.now()-saved.time<ttl) return {...saved,stale:false};
  if(pending.has(key)) return pending.get(key);
  const work=(async()=>{try {const result={time:Date.now(),value:await load()};if(env.BUCKET){try{await env.BUCKET.put(key,JSON.stringify(result));}catch(e){console.error('Cache write failed',key,e.message);}}return {...result,stale:false};}catch(e){if(saved)return {...saved,stale:true};throw e;}})();
  pending.set(key,work);try{return await work;}finally{pending.delete(key);}
}
const reportsFor = env => cached(env,'reports.json',300000,async()=>parseReports(new TextDecoder().decode((await upstream('/special/48')).bytes)));
const articleFor = (env,aid,version) => cached(env,'articles/v2/'+aid+'-'+version+'.json',1800000,async()=>convert(new TextDecoder().decode((await upstream((version==='mobile' ? '/article/' : '/articles/')+aid+'.html',version)).bytes),version));
function rateLimit(request) {
  const key=request.headers.get('CF-Connecting-IP') || 'local';const now=Date.now();
  if(localRate.size>5000)for(const [k,v]of localRate)if(v.until<now)localRate.delete(k);
  let item=localRate.get(key);if(!item||item.until<now)item={count:0,until:now+60000};
  item.count++;localRate.set(key,item);return item.count>90;
}
const CSS = `:root{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#182a2c;background:#f3f6f5;--green:#076b4f}*{box-sizing:border-box}body{margin:0}a{color:inherit}.top{background:#102d26;color:white}.top-inner{max-width:1040px;margin:auto;padding:24px 28px;display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:12px;font-size:20px;font-weight:750;text-decoration:none}.ball{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#c4ef59;color:#18372b;font-size:24px}.edition{font-size:14px;color:#c4d5ce}main{max-width:1040px;margin:auto;padding:40px 28px 64px}.heading{display:flex;justify-content:space-between;align-items:end;gap:24px;margin-bottom:28px}h1{font-size:36px;letter-spacing:-1px;margin:0 0 10px}p{line-height:1.7}.intro{color:#526760;margin:0}.today{font-size:14px;white-space:nowrap;color:#526760}.layout{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:28px}.panel{background:white;border:1px solid #dce5e0;border-radius:16px;overflow:hidden}.panel-head{padding:21px 24px;border-bottom:1px solid #e6ece8;display:flex;align-items:center;justify-content:space-between}h2{font-size:18px;margin:0}.count{font-size:14px;color:#6b7c74}.report{display:block;padding:23px 24px;border-bottom:1px solid #e6ece8;text-decoration:none;transition:background .15s}.report:last-child{border-bottom:0}.report:hover{background:#f2f8f4}.meta{display:flex;gap:10px;align-items:center;color:#647970;font-size:14px;margin-bottom:9px}.pill{background:#e7f4d7;color:#3f6028;border-radius:5px;padding:3px 7px;font-size:12px}.report-title{font-size:18px;font-weight:650;line-height:1.6}.form-panel{padding:24px;margin-bottom:20px}label{display:block;font-size:14px;margin:20px 0 8px;color:#526760}input,select,button{font:inherit;width:100%;border-radius:8px;padding:12px;border:1px solid #cbd8d0;background:white;min-height:46px}button{background:var(--green);color:white;border:0;cursor:pointer;font-weight:650;margin-top:14px}button:hover{background:#05563e}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #83b939;outline-offset:3px}.hint{font-size:14px;color:#61766c;line-height:1.7;margin:16px 0 0}.notice{padding:16px 20px;background:#fff7da;border:1px solid #e8d69c;border-radius:10px;margin:0 0 24px;color:#795c20;font-size:14px;line-height:1.7}.empty{padding:28px;color:#647970;line-height:1.8}.back{display:inline-block;margin-top:12px;color:var(--green)}footer{border-top:1px solid #dce5e0;margin-top:32px;padding-top:20px;font-size:14px;color:#687d72;line-height:1.8}footer a{color:var(--green)}@media(max-width:720px){.top-inner{padding:18px 20px}.edition{display:none}main{padding:28px 20px 40px}.heading{display:block}h1{font-size:30px}.today{margin-top:14px}.layout{grid-template-columns:1fr}.report{padding:20px}.panel-head{padding:20px}.layout aside{order:0}.heading{margin-bottom:24px}}`;
const favicon='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#076b4f"/><circle cx="20" cy="20" r="13" fill="#c4ef59"/><path d="m20 12 8 6-3 9H15l-3-9z" fill="#163d2d"/></svg>');
function page(body,title='懂球帝早报阅读') {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="按日期阅读懂球帝早报，新闻链接在浏览器中直接打开。"><title>'+escape(title)+'</title><link rel="icon" href="'+escape(favicon)+'"><style>'+CSS+'</style></head><body><header class="top"><div class="top-inner"><a class="brand" href="/"><span class="ball" aria-hidden="true">⚽</span>早报阅读</a><span class="edition">懂球帝 · 每日足球资讯</span></div></header><main>'+body+'<footer>内容来源：<a href="https://www.dongqiudi.com/special/48" target="_blank" rel="noopener noreferrer">懂球帝早报</a>。本站提供浏览器阅读与新闻链接转换。<br>原站内容及交互可能随其更新而变化。</footer></main></body></html>';
}
function htmlResponse(body,status=200){return new Response(body,{status,headers:{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Cache-Control':'no-store'}});}
function failure(message,status=502){return htmlResponse(page('<section class="panel form-panel"><h1>暂时无法打开</h1><p>'+escape(message)+'</p><a class="back" href="/">返回早报列表</a></section>'),status);}
async function home(request,env) {
  let result={value:[],stale:false},error='';try{result=await reportsFor(env);}catch(e){error=e.message;console.error('Reports unavailable',e.message);}
  const rows=result.value.slice(0,14).map((r,i)=>'<a class="report" href="/open?aid='+r.aid+'"><div class="meta"><time datetime="'+r.date+'">'+r.date+'</time>'+(i===0?'<span class="pill">最近一期</span>':'')+'</div><div class="report-title">'+escape(r.title)+'</div></a>').join('');
  const notice=error|| (result.stale?'原站暂时无法连接，当前显示此前缓存的早报。':'');
  const body='<div class="heading"><div><h1>今天的足球，从早报开始</h1><p class="intro">选一期早报，在浏览器里阅读和打开新闻。</p></div><div class="today">北京时间 · '+today()+'</div></div>'+(notice?'<div class="notice" role="status">'+escape(notice)+'</div>':'')+'<div class="layout"><section class="panel"><div class="panel-head"><h2>最近早报</h2><span class="count">'+result.value.slice(0,14).length+' 期</span></div>'+(rows||'<div class="empty">早报列表暂时不可用。你仍可在右侧输入文章号打开早报。</div>')+'</section><aside><section class="panel form-panel"><h2>按日期阅读</h2><form action="/open"><label for="date">早报日期</label><input id="date" name="date" type="date" required value="'+(result.value[0]?.date||today())+'"><button>打开早报</button></form></section><section class="panel form-panel"><h2>文章号直达</h2><form action="/open"><label for="aid">懂球帝文章号</label><input id="aid" name="aid" inputmode="numeric" pattern="[0-9]{1,12}" maxlength="12" required placeholder="例如：6395027"><button>打开文章</button></form><p class="hint">列表尚未更新时，可以输入文章链接里的数字编号。新闻链接会自动适配当前设备。</p></section></aside></div>';
  return htmlResponse(page(body));
}
export default {
  async fetch(request,env={},ctx={waitUntil(){}}) {
    const url=new URL(request.url),path=url.pathname;
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
    if(rateLimit(request))return new Response('访问过于频繁，请稍后重试。',{status:429,headers:{'Retry-After':'60'}});
    try {
      let response;
      if(path==='/') response=await home(request,env);
      else if(path==='/health') response=Response.json({ok:true});
      else if(path==='/open') {
        let aid=url.searchParams.get('aid')?.trim();
        if(aid && !/^\d{1,12}$/.test(aid))return failure('文章号应为 1–12 位数字。',400);
        if(!aid){const date=url.searchParams.get('date')||'';if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return failure('请选择有效日期。',400);const list=await reportsFor(env);aid=list.value.find(r=>r.date===date)?.aid;if(!aid)return failure('没有找到这一天的早报。若文章刚发布，可以使用文章号打开。',404);}
        const version=device(request,url.searchParams.get('version'));
        response=new Response(null,{status:302,headers:{Location:(version==='mobile' ? '/article/' : '/articles/')+aid+'.html?zb='+version,'Cache-Control':'no-store'}});
      } else if(/^\/articles?\/\d{1,12}\.html$/.test(path)) {
        const aid=path.match(/\d+/)[0],version=device(request,url.searchParams.get('zb'));
        const article=await articleFor(env,aid,version);
        response=htmlResponse(article.value);response.headers.set('X-Zaobao-Cache',article.stale?'stale':'fresh');
      } else if(path.startsWith('/api/')||path.startsWith('/images/')) {
        if(path.length>300||url.search.length>2000||/%2f|%5c|\.\.|\\/i.test(path)||!/^\/(api|images)\/[a-zA-Z0-9_./%-]+$/.test(path))return new Response('Invalid path',{status:400});
        if(path.startsWith('/api/')&&/(login|logout|token|password|oauth|register|delete|remove|create|submit|publish|send|follow|unfollow|like|unlike)/i.test(path))return new Response('Unsupported API',{status:403});
        const upstreamResult=await upstream(path+url.search);
        if(!/^(application\/json|text\/json|image\/)/i.test(upstreamResult.type))return new Response('Unsupported upstream content',{status:502});
        response=new Response(upstreamResult.bytes,{headers:{'Content-Type':upstreamResult.type,'X-Content-Type-Options':'nosniff','Cache-Control':path.startsWith('/images/')?'public, max-age=3600':'public, max-age=20'}});
      } else response=failure('页面不存在。',404);
      if(request.method==='HEAD')return new Response(null,{status:response.status,headers:response.headers});
      return response;
    }catch(e){console.error('Request failed',path,e.message);return failure(e.message || '服务暂时不可用，请稍后重试。');}
  }
};
