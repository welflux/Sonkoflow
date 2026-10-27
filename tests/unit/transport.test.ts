import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
test('provider requests use the inherited HTTP proxy without disabling TLS verification',async()=>{
 const origin=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end('{"ok":true}');});
 origin.listen(0,'127.0.0.1');await once(origin,'listening');const address=origin.address();assert(address&&typeof address!=='string');
 let tunnels=0;
 const proxy=createServer();
 proxy.on('connect',(req,client,head)=>{
  tunnels++;
  assert.equal(req.url,`127.0.0.1:${address.port}`);
  const upstream=connect(address.port,'127.0.0.1',()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});
  upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());client.on('close',()=>upstream.destroy());
 });
 proxy.listen(0,'127.0.0.1');await once(proxy,'listening');const proxyAddress=proxy.address();assert(proxyAddress&&typeof proxyAddress!=='string');
 const names=['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy','NO_PROXY','no_proxy'];
 const saved=new Map(names.map(n=>[n,process.env[n]]));
 for(const name of names)process.env[name]=name.toLowerCase()==='no_proxy'?'':`http://127.0.0.1:${proxyAddress.port}`;
 const transport=await import('../../server/transport.js');
 try{const response=await transport.providerFetch(`http://127.0.0.1:${address.port}/health`);assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});assert.equal(tunnels,1);}
 finally{await transport.closeProviderTransport();for(const[name,value]of saved){if(value===undefined)delete process.env[name];else process.env[name]=value;}origin.close();proxy.close();}
});
