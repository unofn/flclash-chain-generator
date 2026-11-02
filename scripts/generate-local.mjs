#!/usr/bin/env node
// The local configuration and generated scripts contain private details; keep them outside the repository.
import { readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node scripts/generate-local.mjs --config PATH --output-dir DIR [--airport NAME|all] [--ai-group NAME] [--upstream-group NAME]');
  process.exit(0);
}
try {
  const options = { '--config': '', '--output-dir': '', '--airport': 'all', '--ai-group': '', '--upstream-group': '' };
  for (let i = 0; i < args.length; i += 2) {
    if (!Object.hasOwn(options, args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('未知参数或缺少参数值');
    options[args[i]] = args[i + 1];
  }
  if (!options['--config'] || !options['--output-dir']) throw new Error('请指定 --config 和 --output-dir');
  const configPath = resolve(options['--config']);
  const data = JSON.parse(readFileSync(configPath, 'utf8'));
  const outputDir = resolve(options['--output-dir']);
  if (!Array.isArray(data.landings) || !data.landings.length || !data.airports || typeof data.airports !== 'object') throw new Error('本地配置缺少落地节点或机场预设');
  if (!Array.isArray(data.legacyNames) || data.legacyNames.some(n => typeof n !== 'string' || !n)) throw new Error('legacyNames 必须是字符串数组');
  const landings = data.landings.map(item => {
    if (typeof item.name !== 'string' || !item.name.trim() || typeof item.credentials !== 'string' || !item.credentials) throw new Error('节点缺少名称或凭据文件路径');
    const secret = JSON.parse(readFileSync(resolve(dirname(configPath), item.credentials), 'utf8'));
    if (typeof secret.server !== 'string' || !secret.server.trim() || !Number.isInteger(secret.port) || secret.port < 1 || secret.port > 65535 || secret.cipher !== '2022-blake3-aes-128-gcm' || typeof secret.password !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(secret.password) || Buffer.from(secret.password, 'base64').length !== 16 || Buffer.from(secret.password, 'base64').toString('base64') !== secret.password) throw new Error('SS 2022 凭据格式无效');
    return { name: item.name, type: 'ss', server: secret.server, port: secret.port, cipher: secret.cipher, password: secret.password, udp: true };
  });
  if (new Set(landings.map(n => n.name)).size !== landings.length) throw new Error('节点名称不能重复');
  const selected = options['--airport'];
  if (selected === 'all' && (options['--ai-group'] || options['--upstream-group'])) throw new Error('批量生成时不能覆盖策略组名称');
  const jobs = selected === 'all' ? Object.entries(data.airports).filter(([, job]) => job.includeInAll !== false) : [[selected, data.airports[selected]]];
  if (!jobs.length || jobs.some(([, job]) => !job)) throw new Error('找不到指定的机场预设');
  const template = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'local-override.template.js'), 'utf8');
  const outputs = jobs.map(([key, originalJob]) => {
    const job = { ...originalJob, aiGroup: options['--ai-group'] || originalJob.aiGroup, upstreamGroup: options['--upstream-group'] || originalJob.upstreamGroup };
    if (typeof job.filename !== 'string' || basename(job.filename) !== job.filename || !job.filename.endsWith('.js')) throw new Error('输出文件名无效：' + key);
    if (typeof job.aiGroup !== 'string' || typeof job.upstreamGroup !== 'string') throw new Error('缺少策略组名称：' + key);
    if (job.splitDns && !job.upstreamGroup) throw new Error('DNS 分流需要指定前置组：' + key);
    if (job.proxyServerNameserver != null && (!Array.isArray(job.proxyServerNameserver) || job.proxyServerNameserver.some(x => typeof x !== 'string'))) throw new Error('代理节点 DNS 格式无效：' + key);
    const replacements = { '__LANDINGS_JSON__': landings, '__LEGACY_NAMES_JSON__': data.legacyNames, '__UPSTREAM_GROUP_JSON__': job.upstreamGroup, '__AI_GROUP_JSON__': job.aiGroup, '__PROXY_SERVER_NAMESERVER_JSON__': job.proxyServerNameserver || null, '__SPLIT_DNS_JSON__': job.splitDns === true };
    let script = template;
    for (const [placeholder, value] of Object.entries(replacements)) script = script.replace(placeholder, () => JSON.stringify(value, null, placeholder === '__LANDINGS_JSON__' ? 2 : undefined));
    return { filename: job.filename, script };
  });
  if (new Set(outputs.map(o => o.filename)).size !== outputs.length) throw new Error('输出文件名不能重复');
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  for (const output of outputs) {
    const path = join(outputDir, output.filename);
    const temp = join(outputDir, '.' + output.filename + '.' + randomBytes(8).toString('hex') + '.tmp');
    try { writeFileSync(temp, output.script, { mode: 0o600, flag: 'wx' }); renameSync(temp, path); }
    finally { try { unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    console.log('已生成：' + path);
  }
} catch (error) { console.error('生成失败：' + error.message); process.exitCode = 1; }
