const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
test('local generator writes private, compatible scripts and rejects unsafe paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-studio-'));
  try {
    const creds = path.join(dir, 'credential.json');
    fs.writeFileSync(creds, JSON.stringify({server:'example.invalid',port:443,cipher:'2022-blake3-aes-128-gcm',password:Buffer.alloc(16).toString('base64')}));
    const cfg = path.join(dir, 'local.json');
    const spec = { landings:[{name:'示例出口',credentials:'credential.json'}], legacyNames:['旧出口'], airports:{tagmeta:{filename:'tag.js',aiGroup:'AI',upstreamGroup:'Proxies',splitDns:true,proxyServerNameserver:['https://223.5.5.5/dns-query#DIRECT']},nexitally:{filename:'other.js',aiGroup:'AI',upstreamGroup:'Proxies'}} };
    fs.writeFileSync(cfg, JSON.stringify(spec));
    const output = path.join(dir, 'out');
    const run = (...args) => spawnSync(process.execPath,[path.join(__dirname,'scripts/generate-local.mjs'),'--config',cfg,'--output-dir',output,...args],{encoding:'utf8'});
    assert.equal(run().status, 0);
    const code = fs.readFileSync(path.join(output,'tag.js'),'utf8');
    assert.equal(fs.statSync(path.join(output,'tag.js')).mode & 0o777,0o600);
    const input = {rules:['MATCH,AI'],proxies:[{name:'airport'}], 'proxy-groups':[{name:'Proxies',type:'select',proxies:['airport']},{name:'AI',type:'select',proxies:['Proxies']}],dns:{nameserver:['original']}};
    const result = JSON.parse(vm.runInNewContext(code+'\nJSON.stringify(main(input))',{input}));
    assert.equal(result.proxies.at(-1).name,'示例出口');
    assert.deepEqual(result.dns.nameserver,['https://1.1.1.1/dns-query#Proxies']);
    assert.notEqual(run('--airport','absent').status, 0);
    spec.airports.tagmeta.filename = '../escape.js'; fs.writeFileSync(cfg,JSON.stringify(spec));
    assert.notEqual(run().status,0);
    assert.equal(fs.existsSync(path.join(dir,'escape.js')),false);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
