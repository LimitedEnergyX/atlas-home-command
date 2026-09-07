"use strict";
const assert=require('node:assert/strict'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-adapter-test-'));
const env={...process.env,HOST:'127.0.0.1',PORT:'0',ATLAS_POWERWALL_ENV_PATH:path.join(temp,'absent.env'),ATLAS_POWERWALL_DATA_DIR:temp,ATLAS_POWERWALL_LIVE:'0',ATLAS_POWERWALL_ALLOW_COMMANDS:'0',ATLAS_INFLUX_ENABLED:'0'};
// Ask the OS for a free port before starting the isolated child.
const net=require('node:net');
(async()=>{
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));env.PORT=String(socket.address().port);await new Promise(r=>socket.close(r));
 const child=spawn(process.execPath,['server.js'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Startup timeout')),5000);child.stdout.on('data',b=>{if(b.toString().includes('adapter ->')){clearTimeout(t);resolve();}});child.on('exit',code=>{clearTimeout(t);reject(new Error('Child exited '+code));});});
  const base='http://127.0.0.1:'+env.PORT;
  const health=await(await fetch(base+'/api/health')).json();assert.equal(health.authorization,'disabled');assert.equal(health.poll_ready,false);
  for(const route of ['/api/powerwall','/api/calendar-history','/auth/start'])assert.equal((await fetch(base+route)).status,503);
  for(const route of ['/api/reserve','/api/mode','/api/storm','/api/max-backup','/api/restore','/api/month-seed','/api/set-bank'])assert.equal((await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/health',{headers:{Origin:'https://example.com'}})).status,403);
  console.log('Adapter: live reads disabled, all command routes disabled, cross-origin access rejected.');
 }finally{child.kill();await new Promise(r=>child.once('close',r));fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
