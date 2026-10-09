import http from 'node:http';
import worker from './worker.js';
const store=new Map();
const env={BUCKET:{async get(key){const value=store.get(key);return value?{async json(){return JSON.parse(value)}}:null},async put(key,value){store.set(key,value)}}};
http.createServer(async(req,res)=>{try{const response=await worker.fetch(new Request('http://127.0.0.1:8787'+req.url,{method:req.method,headers:req.headers}),env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(e){res.writeHead(500);res.end('Unavailable');console.error(e.message);}}).listen(8787,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:8787'));
