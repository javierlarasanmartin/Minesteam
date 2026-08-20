const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { assertInstancePath, resolveInside } = require('../core/security');
function getOptionsPath(instancePath) { const safe=assertInstancePath(instancePath); return resolveInside(safe,path.join(safe,'.minecraft','options.txt')); }
function readOptions(instancePath) {
  const file=getOptionsPath(instancePath); if(!fs.existsSync(file)) return {file,map:new Map()};
  const map=new Map(); for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){ if(!line || line.startsWith('#')) continue; const i=line.indexOf(':'); if(i>0) map.set(line.slice(0,i),line.slice(i+1)); }
  return {file,map};
}
function recommendations(instancePath) {
  assertInstancePath(instancePath); const totalRamGb=Math.round((os.totalmem()/1024/1024/1024)*10)/10;
  const renderDistance=totalRamGb>=32?16:totalRamGb>=16?12:8;
  return { totalRamGb, profile: totalRamGb>=16?'Equilibrado':'Rendimiento', settings:{ renderDistance, simulationDistance:Math.min(renderDistance,10), entityDistanceScaling:1.0, particles:'decreased', renderClouds:'false', biomeBlendRadius:Math.min(2,renderDistance), graphics_fabulous:'false' } };
}
function apply(instancePath, requested={}) {
  const safe=assertInstancePath(instancePath); const {file,map}=readOptions(safe); const rec=recommendations(safe).settings;
  const values={ renderDistance:String(Number(requested.renderDistance||rec.renderDistance)), simulationDistance:String(Number(requested.simulationDistance||rec.simulationDistance)), entityDistanceScaling:String(Number(requested.entityDistanceScaling||rec.entityDistanceScaling)), particles:String(requested.particles||rec.particles), renderClouds:String(requested.renderClouds ?? rec.renderClouds), biomeBlendRadius:String(Number(requested.biomeBlendRadius||rec.biomeBlendRadius)), graphics_fabulous:String(requested.graphics_fabulous ?? rec.graphics_fabulous) };
  for(const [k,v] of Object.entries(values)) map.set(k,v); fs.ensureDirSync(path.dirname(file)); fs.writeFileSync(file,[...map.entries()].map(([k,v])=>`${k}:${v}`).join('\n')+'\n','utf8');
  return {success:true,path:file,settings:values};
}
function getStatus(instancePath){const {file,map}=readOptions(instancePath);return {exists:fs.existsSync(file),path:file,settings:Object.fromEntries(map)};}
module.exports={recommendations,apply,getStatus};
