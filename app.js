'use strict';

// This function is serialized into the downloaded FlClash script.
function applyOverride(config, options) {
  const upstreamName = '链式入口（机场）';
  const prefix = '链式落地 · ';
  if (!config || !Array.isArray(config.rules)) throw new Error('订阅缺少 rules，无法保留原有分流规则');
  const existing = config.proxies || [];
  const oldNodes = existing.filter(p => p.name?.startsWith(prefix) && p['dialer-proxy'] === upstreamName);
  const allGroups = config['proxy-groups'] || [];
  if (allGroups.some(g => g.name === upstreamName) && !oldNodes.length) {
    throw new Error('订阅已存在同名的链式入口（机场）策略组，请先更改原策略组名称');
  }
  const oldNames = new Set(oldNodes.map(p => p.name));
  const proxies = existing.filter(p => !oldNames.has(p.name));
  const groups = allGroups.filter(g => g.name !== upstreamName);
  const names = new Set(options.nodes.map(n => n.name));
  if (proxies.some(p => names.has(p.name)) || groups.some(g => names.has(g.name))) {
    throw new Error('落地节点名称与订阅中的节点或策略组重复，请在生成器中修改名称');
  }
  const pattern = /chatgpt|openai|claude|anthropic|gemini|人工智能|智能助手|(?:^|[^a-z0-9])ai(?:$|[^a-z0-9])/i;
  const targets = groups.filter(g => options.aiGroup ? g.name === options.aiGroup : pattern.test(g.name));
  if (!targets.length) throw new Error('未找到 AI 策略组，请在生成器中填写准确的 AI 策略组名称');
  if (targets.some(g => g.type !== 'select')) throw new Error('AI 策略组必须是 select 手动选择类型');
  const targetNames = new Set(targets.map(g => g.name));
  const byName = new Map(groups.map(g => [g.name, g]));
  function unsafe(name, seen = new Set()) {
    if (targetNames.has(name) || names.has(name) || oldNames.has(name) || name === upstreamName) return true;
    if (seen.has(name)) return false;
    seen.add(name);
    const group = byName.get(name);
    return !!group && (group['include-all'] === true || group['include-all-proxies'] === true ||
      (group.proxies || []).some(member => unsafe(member, seen)));
  }
  const candidates = options.upstreamGroup ? [options.upstreamGroup] : ['🙂 TAGSS', 'Proxies', 'PROXY', '🚀 节点选择'];
  const preferred = candidates.find(name => byName.has(name) && !unsafe(name));
  if (options.upstreamGroup && !preferred) throw new Error('机场前置组不存在或可能形成代理循环：' + options.upstreamGroup);
  const upstream = preferred || groups.find(g => g.type === 'select' && !unsafe(g.name))?.name;
  const members = [...new Set([...(upstream ? [upstream] : []), ...proxies.map(p => p.name)])];
  const providers = Object.keys(config['proxy-providers'] || {});
  if (!members.length && !providers.length) throw new Error('订阅没有可用的机场节点或前置组');
  config.proxies = [...proxies, ...options.nodes.map(node => ({ ...node, 'dialer-proxy': upstreamName }))];
  config['proxy-groups'] = [
    { name: upstreamName, type: 'select', ...(members.length ? { proxies: members } : {}), ...(providers.length ? { use: providers } : {}) },
    ...groups.map(group => targetNames.has(group.name)
      ? { ...group, proxies: [...options.nodes.map(n => n.name), ...(group.proxies || []).filter(n => !oldNames.has(n) && !names.has(n))] }
      : group),
  ];
  if (options.tagDns) {
    if (!options.upstreamGroup || !byName.has(options.upstreamGroup)) throw new Error('TAG DNS 分流需要存在的前置组');
    const existingDns = config.dns || {};
    const resolvers = existingDns['proxy-server-nameserver'];
    const fixedResolvers = Array.isArray(resolvers) && ['0.0.0.0:7874', '127.0.0.1:7874'].includes(existingDns.listen)
      ? resolvers.flatMap(r => r === 'udp://127.0.0.1:7874' ? ['https://223.5.5.5/dns-query#DIRECT'] : [r])
      : resolvers;
    config.dns = {
      ...existingDns,
      ...(fixedResolvers === undefined ? {} : { 'proxy-server-nameserver': fixedResolvers }),
      enable: true,
      nameserver: ['https://1.1.1.1/dns-query#' + options.upstreamGroup],
      fallback: [],
      'nameserver-policy': { ...(existingDns['nameserver-policy'] || {}), 'geosite:cn': ['https://223.5.5.5/dns-query#DIRECT', 'https://doh.pub/dns-query#DIRECT'] },
    };
  }
  return config;
}

function makeScript(input) {
  const clean = value => String(value || '').trim();
  const aiGroup = clean(input.aiGroup);
  const upstreamGroup = clean(input.upstreamGroup);
  const tagDns = input.tagDns === true;
  if (tagDns && !upstreamGroup) throw new Error('启用 TAG DNS 分流时必须指定机场前置组');
  if (!Array.isArray(input.nodes) || !input.nodes.length) throw new Error('请至少填写一个落地节点');
  const seen = new Set();
  const nodes = input.nodes.map((entry, index) => {
    const label = `第 ${index + 1} 个节点`;
    const name = clean(entry.name);
    const server = clean(entry.server);
    const port = Number(entry.port);
    const cipher = entry.cipher;
    const password = clean(entry.password);
    if (!name || name.length > 80 || /[\r\n\x00-\x1f]/.test(name)) throw new Error(`${label}：请填写有效的节点名称`);
    if (seen.has(name)) throw new Error(`${label}：节点名称重复`);
    seen.add(name);
    if (!server || server.length > 253 || /[\s/@?#\\]/.test(server)) throw new Error(`${label}：请填写有效的服务器地址，不含协议或端口`);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${label}：端口必须是 1 到 65535 的整数`);
    const bytes = cipher === '2022-blake3-aes-128-gcm' ? 16 : cipher === '2022-blake3-aes-256-gcm' ? 32 : 0;
    if (!bytes) throw new Error(`${label}：不支持的加密方式`);
    try {
      const decoded = atob(password);
      if (decoded.length !== bytes || btoa(decoded) !== password) throw new Error();
    } catch { throw new Error(`${label}：密钥必须是 ${bytes} 字节的标准 Base64`); }
    return { name: '链式落地 · ' + name, type: 'ss', server, port, cipher, password, udp: true };
  });
  const options = JSON.stringify({ aiGroup, upstreamGroup, nodes, tagDns }, null, 2).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return '// 此文件包含节点凭据，请妥善保管，不要公开分享。\n' +
    'const chainOptions = ' + options + ';\n' +
    'const applyChainOverride = ' + applyOverride.toString() + ';\n' +
    'function main(config) { return applyChainOverride(config, chainOptions); }\n';
}

if (typeof module !== 'undefined' && module.exports) module.exports = { makeScript, applyOverride };
if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id);
  const nodes = $('nodes');
  function showMode(mode) {
    const web = mode === 'web';
    $('webPanel').hidden = !web;
    $('cliPanel').hidden = web;
    $('webMode').classList.toggle('active', web);
    $('cliMode').classList.toggle('active', !web);
    $('webMode').setAttribute('aria-pressed', String(web));
    $('cliMode').setAttribute('aria-pressed', String(!web));
  }
  $('webMode').addEventListener('click', () => showMode('web'));
  $('cliMode').addEventListener('click', () => showMode('cli'));
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', async () => {
      const command = $(button.dataset.copy).textContent;
      try {
        await navigator.clipboard.writeText(command);
        $('copyStatus').textContent = '命令已复制。';
        button.textContent = '已复制';
        setTimeout(() => { button.textContent = '复制'; }, 2000);
      } catch {
        $('copyStatus').textContent = '无法自动复制，请手动选中命令复制。';
      }
    });
  }
  const renderIndices = () => [...nodes.children].forEach((node, i) => {
    node.querySelector('.node-index').textContent = String(i + 1).padStart(2, '0');
    node.querySelector('.remove').disabled = nodes.children.length === 1;
  });
  function addNode() {
    const node = $('nodeTemplate').content.firstElementChild.cloneNode(true);
    node.querySelector('.remove').addEventListener('click', () => { node.remove(); renderIndices(); });
    nodes.append(node);
    renderIndices();
  }
  $('addNode').addEventListener('click', addNode);
  $('preset').addEventListener('change', event => {
    const preset = { tagmeta: ['🧲 海外AI', '🙂 TAGSS'], nexitally: ['AI', 'Proxies'], auto: ['', ''], custom: ['', ''] }[event.target.value];
    $('aiGroup').value = preset[0]; $('upstreamGroup').value = preset[1];
    $('tagDnsOption').hidden = event.target.value !== 'tagmeta';
    if (event.target.value !== 'tagmeta') $('tagDns').checked = false;
  });
  $('generator').addEventListener('submit', event => {
    event.preventDefault();
    $('error').hidden = true;
    const input = { aiGroup: $('aiGroup').value, upstreamGroup: $('upstreamGroup').value, tagDns: $('tagDns').checked,
      nodes: [...nodes.children].map(node => Object.fromEntries([...node.querySelectorAll('[name]')].map(field => [field.name, field.value]))) };
    try {
      const script = makeScript(input);
      const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'flclash-chain-override.js'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) { $('error').textContent = error.message; $('error').hidden = false; $('error').scrollIntoView({ block: 'nearest' }); }
  });
  addNode();
}
