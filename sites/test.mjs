import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker,{parseReports,convert} from './worker.js';
test('converts DOM and escaped hydration links for both devices',()=>{
  const input=String.raw`<a href="dongqiudi:///news/123">新闻</a><script>{url:"dongqiudi:\u002F\u002F\u002Fnews\u002F456",other:"dongqiudi:\/\/\/news\/789",user:"dongqiudi:///user/5"}</script><script src="/_nuxt/x.js"></script>`;
  for(const version of ['pc','mobile']){const result=convert(input,version);const target=version==='pc'?'https://www.dongqiudi.com/articles/':'/article/';for(const id of ['123','456','789'])assert.ok(result.includes(target+id+'.html'));assert.ok(result.includes('dongqiudi:///user/5'));assert.ok(result.includes((version==='mobile'?'https://m.dongqiudi.com':'https://www.dongqiudi.com')+'/_nuxt/x.js'));assert.ok(!result.includes('<base'));}
});
test('report timestamps use China time and deduplicate dates',()=>{
 const stamp=Math.floor(Date.parse('2026-10-01T23:00:00Z')/1000);
 const reports=parseReports(`title:"早报：足球" aid:"123" show_time:${stamp},title:"早报：另一期" aid:"456" show_time:${stamp}`);
 assert.deepEqual(reports,[{title:'早报：足球',aid:'123',date:'2026-10-02'}]);
});
test('direct links and invalid IDs',async()=>{
 const valid=await worker.fetch(new Request('https://example.test/open?aid=123',{headers:{'User-Agent':'iPhone Mobile'}}));
 assert.equal(valid.status,302);assert.equal(valid.headers.get('Location'),'/article/123.html?zb=mobile');
 assert.equal((await worker.fetch(new Request('https://example.test/open?aid=abc'))).status,400);
 assert.equal((await worker.fetch(new Request('https://example.test/open?date=bad'))).status,400);
 assert.equal((await worker.fetch(new Request('https://example.test/',{method:'POST'}))).status,405);
});
test('proxy does not accept credential APIs or arbitrary destinations',async()=>{
 assert.equal((await worker.fetch(new Request('https://example.test/api/token/issue'))).status,403);
 assert.equal((await worker.fetch(new Request('https://example.test/api/http%3A%2F%2Fexample.com'))).status,400);
});
test('real source list and article conversion',async()=>{
 const original=await fetch('https://www.dongqiudi.com/special/48');assert.equal(original.status,200);
 const reports=parseReports(await original.text());assert.ok(reports.length>0);
 const article=await fetch('https://www.dongqiudi.com/articles/'+reports[0].aid+'.html');assert.equal(article.status,200);
 const html=await article.text();assert.ok(html.includes('__NUXT__'));
 const converted=convert(html,'pc');assert.ok(converted.includes('https://www.dongqiudi.com/articles/'));assert.ok(!/dongqiudi:\/\/\/news\//.test(converted));
 console.log('Latest report:',reports[0].date,reports[0].aid);
});

test('mobile articles fetch the mobile source and convert relative assets',async()=>{
 const original=globalThis.fetch;
 const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response('<html><head><meta name="viewport" content="width=device-width"></head><body><script src="/mobile.js"></script><a href="dongqiudi:///news/456">news</a></body></html>',{headers:{'Content-Type':'text/html'}});};
 try {
  const response=await worker.fetch(new Request('https://example.test/article/123.html?zb=mobile'));
  const html=await response.text();
  assert.equal(response.status,200);
  assert.equal(calls[0].url,'https://m.dongqiudi.com/article/123.html');
  assert.match(calls[0].options.headers['User-Agent'],/Mobile/);
  assert.ok(html.includes('https://m.dongqiudi.com/mobile.js'));
  assert.ok(html.includes('/article/456.html'));
 }finally{globalThis.fetch=original;}
});

// Mobile upstream scripts normalize /article/:id.html to /article/:id.
test('article routes survive mobile URL normalization',async()=>{
 const original=globalThis.fetch;
 const calls=[];
 globalThis.fetch=async url=>{calls.push(url);return new Response('<html><body>article content</body></html>',{headers:{'Content-Type':'text/html'}});};
 try {
  for(const path of ['/article/6441811?zb=mobile','/article/6451239','/articles/6441811?zb=pc']) {
   const response=await worker.fetch(new Request('https://example.test'+path,{headers:{'User-Agent':'Android Mobile'}}));
   assert.equal(response.status,200,path);
   assert.match(await response.text(),/article content/);
  }
  assert.deepEqual(calls,['https://m.dongqiudi.com/article/6441811.html','https://m.dongqiudi.com/article/6451239.html','https://www.dongqiudi.com/articles/6441811.html']);
  assert.equal((await worker.fetch(new Request('https://example.test/article/6441811junk'))).status,404);
 }finally{globalThis.fetch=original;}
});

test('mobile full text and linked news stay in the reader',()=>{
 const input=String.raw`<body><a href="https://m.dongqiudi.com/article/123.html">news</a><script>{url:"https:\u002F\u002Fm.dongqiudi.com\u002Farticle\u002F456"}</script><div class="con">last paragraph</div></body>`;
 const html=convert(input,'mobile');
 assert.ok(html.includes('/article/123.html?zb=mobile'));
 assert.ok(html.includes('/article/456.html?zb=mobile'));
 assert.ok(html.includes('last paragraph'));
 assert.ok(html.includes('max-height:none!important'));
 assert.ok(html.includes('window.__INITIAL_STATE__.openFull=true'));
 assert.equal(convert(input,'pc'),input);
});
