const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { makeScript } = require('./app.js');
const node = { name: '示例', server: 'example.invalid', port: '443', cipher: '2022-blake3-aes-128-gcm', password: Buffer.alloc(16).toString('base64') };
const input = { nodes: [node], aiGroup: 'AI', upstreamGroup: 'Proxies' };
const subscription = () => ({ proxies: [{ name: 'airport', type: 'ss' }], 'proxy-groups': [{ name: 'Proxies', type: 'select', proxies: ['airport'] }, { name: 'AI', type: 'select', proxies: ['Proxies'] }], rules: ['MATCH,Proxies'], dns: { nameserver: ['system'] }, tun: { enable: true } });
const execute = (source, config) => JSON.parse(vm.runInNewContext(source + '\nJSON.stringify(main(config))', { config }));
test('generated script keeps rules, DNS and TUN, and chains via airport', () => {
  const source = makeScript(input); const original = subscription(); const result = execute(source, structuredClone(original));
  assert.deepEqual(result.rules, original.rules); assert.deepEqual(result.dns, original.dns); assert.deepEqual(result.tun, original.tun);
  assert.equal(result.proxies.at(-1)['dialer-proxy'], '链式入口（机场）');
  assert.equal(result['proxy-groups'].find(g => g.name === 'AI').proxies[0], '链式落地 · 示例');
  assert.equal(result['proxy-groups'][0].proxies[0], 'Proxies');
  assert.deepEqual(execute(source, structuredClone(result)), result);
});
test('renaming and removing generated nodes clears old entries', () => {
  const first = execute(makeScript(input), subscription());
  const second = execute(makeScript({ ...input, nodes: [{ ...node, name: '新节点' }] }), first);
  assert.ok(!second.proxies.some(p => p.name === '链式落地 · 示例'));
  assert.deepEqual(second['proxy-groups'].find(g => g.name === 'AI').proxies, ['链式落地 · 新节点', 'Proxies']);
});
test('rejects cycles, missing and incompatible groups, and namespace collisions', () => {
  const script = makeScript(input);
  const cyclic = subscription(); cyclic['proxy-groups'][0].proxies = ['AI'];
  assert.throws(() => execute(script, cyclic), /代理循环/);
  const includeAll = subscription(); includeAll['proxy-groups'][0]['include-all-proxies'] = true;
  assert.throws(() => execute(script, includeAll), /代理循环/);
  const nonselect = subscription(); nonselect['proxy-groups'][1].type = 'url-test';
  assert.throws(() => execute(script, nonselect), /select/);
  assert.throws(() => execute(script, { rules: [], 'proxy-groups': [] }), /未找到/);
  const collision = subscription(); collision['proxy-groups'].push({ name: '链式入口（机场）', type: 'select' });
  assert.throws(() => execute(script, collision), /同名/);
  const nodeCollision = subscription(); nodeCollision.proxies.push({ name: '链式落地 · 示例' });
  assert.throws(() => execute(script, nodeCollision), /重复/);
});
test('supports provider-backed AI groups and avoids matching Taiwan', () => {
  const config = { 'proxy-providers': { airport: {} }, 'proxy-groups': [{ name: 'Taiwan', type: 'select' }, { name: 'Work', type: 'select', use: ['airport'] }], rules: [] };
  assert.throws(() => execute(makeScript({ ...input, aiGroup: '', upstreamGroup: '' }), structuredClone(config)), /未找到/);
  const result = execute(makeScript({ ...input, aiGroup: 'Work', upstreamGroup: '' }), config);
  assert.deepEqual(result['proxy-groups'][0].use, ['airport']);
  assert.deepEqual(result['proxy-groups'].find(g => g.name === 'Work').use, ['airport']);
});
test('validates nodes, secrets, duplicates, and port', () => {
  for (const change of [{ port: '0' }, { port: '2.2' }, { password: 'invalid' }, { server: 'https://example.com' }, { name: '' }, { cipher: 'bad' }]) {
    assert.throws(() => makeScript({ ...input, nodes: [{ ...node, ...change }] }));
  }
  assert.throws(() => makeScript({ ...input, nodes: [node, node] }), /重复/);
  assert.doesNotThrow(() => makeScript({ ...input, nodes: [{ ...node, cipher: '2022-blake3-aes-256-gcm', password: Buffer.alloc(32).toString('base64') }] }));
  assert.throws(() => makeScript({ ...input, nodes: [{ ...node, cipher: '2022-blake3-aes-256-gcm' }] }), /32 字节/);
});
test('values are serialized as data rather than executable code', () => {
  const special = { ...node, name: '"; globalThis.injected = true; //' };
  const result = execute(makeScript({ ...input, nodes: [special] }), subscription());
  assert.equal(result.proxies.at(-1).name, '链式落地 · ' + special.name);
});


test('TAG DNS is opt-in, splits DNS and fixes only self-referential proxy DNS', () => {
  const source = subscription();
  source.dns = { listen: '127.0.0.1:7874', nameserver: ['old'], fallback: ['old'],
    'proxy-server-nameserver': ['udp://127.0.0.1:7874', '223.6.6.6'],
    'nameserver-policy': { '+.example.test': ['original'] } };
  const result = execute(makeScript({ ...input, tagDns: true }), structuredClone(source));
  assert.deepEqual(result.dns.nameserver, ['https://1.1.1.1/dns-query#Proxies']);
  assert.deepEqual(result.dns.fallback, []);
  assert.deepEqual(result.dns['proxy-server-nameserver'], ['https://223.5.5.5/dns-query#DIRECT', '223.6.6.6']);
  assert.deepEqual(result.dns['nameserver-policy']['+.example.test'], ['original']);
  assert.deepEqual(result.dns['nameserver-policy']['geosite:cn'], ['https://223.5.5.5/dns-query#DIRECT', 'https://doh.pub/dns-query#DIRECT']);
  assert.deepEqual(execute(makeScript({ ...input, tagDns: true }), structuredClone(result)), result);
  assert.deepEqual(execute(makeScript(input), structuredClone(source)).dns, source.dns);
  assert.throws(() => makeScript({ ...input, tagDns: true, upstreamGroup: '' }), /前置组/);
});
