import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
export async function serve(root,port=0){
 const base=path.resolve(root),mime={'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.html':'text/html','.png':'image/png','.dzi':'application/xml','.jpg':'image/jpeg','.svg':'image/svg+xml'};
 const server=http.createServer((req,res)=>{
  let file;try{file=path.resolve(base,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));}catch{res.writeHead(400).end();return;}
  if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {server,url:`http://127.0.0.1:${server.address().port}`};
}
