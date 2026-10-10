import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const args=process.argv.slice(2),root=resolve(args.includes('--built')?'.build/spike':'.');
const base=args.includes('--base')?args[args.indexOf('--base')+1]:'/';
if(!base.startsWith('/')||!base.endsWith('/')||base.includes('..'))throw Error('Invalid server base path');
const host=args.includes('--host')?args[args.indexOf('--host')+1]:'127.0.0.1';
const port=Number(args.includes('--port')?args[args.indexOf('--port')+1]:5173);
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/plain; charset=utf-8'};
const server=createServer(async(req,res)=>{
 try {
  let path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(!path.startsWith(base))throw Error('Outside base path');
  path='/'+path.slice(base.length);
  if(path==='/'){
   if(args.includes('--built')){res.writeHead(200,{'Content-Type':types['.html'],'Cache-Control':'no-store'});res.end(await readFile(resolve(root,'index.html')));}
   else{res.writeHead(302,{Location:base+'web/index.html'});res.end();}
   return;
  }
  if(!/^\/(web\/|dist\/core\/|data\/spike\/|docs\/SPIKE_SCENARIO\.md$)/.test(path))throw Error('Not served');
  const file=resolve(root,'.'+path);
  const normalized='/'+file.slice(root.length+1);
  if(!file.startsWith(root+'/') || !/^\/(web\/|dist\/core\/|data\/spike\/|docs\/SPIKE_SCENARIO\.md$)/.test(normalized) || !(await stat(file)).isFile())throw Error('Not served');
  res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(await readFile(file));
 }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(port,host,()=>process.stdout.write(`Into the Night: http://${host}:${port}\n`));
