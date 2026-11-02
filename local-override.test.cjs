const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");

const landingName = "sample-a · SS2022链式";
function apply(config, preferred = "", aiGroup = "", ss2022 = null, proxyServerNameserver = null, splitDns = false) {
  const code = readFileSync(join(__dirname, "scripts/local-override.template.js"), "utf8")
    .replace("__LANDINGS_JSON__", JSON.stringify([{ name: landingName, type: "ss" }, ...(ss2022 ? [ss2022] : [])]))
    .replace("__LEGACY_NAMES_JSON__", JSON.stringify(["sample-a · AI链式", "sample-a · REALITY链式", "sample-a · SS2022链式", "sample-b · SS2022链式"]))
    .replace("__PROXY_SERVER_NAMESERVER_JSON__", JSON.stringify(proxyServerNameserver))
    .replace("__SPLIT_DNS_JSON__", JSON.stringify(splitDns))
    .replace("__UPSTREAM_GROUP_JSON__", JSON.stringify(preferred))
    .replace("__AI_GROUP_JSON__", JSON.stringify(aiGroup));
  return JSON.parse(vm.runInNewContext(code + "\nJSON.stringify(main(input))", { input: config }));
}

test("splits domestic DNS from proxied default DNS without changing node bootstrap", () => {
  const source = subscription();
  source.dns = { enable: true, nameserver: ["old"], fallback: ["old-fallback"],
    "proxy-server-nameserver": ["223.5.5.5"],
    "nameserver-policy": { "+.captive.apple.com": ["original"] } };
  const result = apply(source, "Proxies", "", null, null, true);
  assert.deepEqual(result.dns.nameserver, ["https://1.1.1.1/dns-query#Proxies"]);
  assert.deepEqual(result.dns.fallback, []);
  assert.deepEqual(result.dns["proxy-server-nameserver"], ["223.5.5.5"]);
  assert.deepEqual(result.dns["nameserver-policy"]["+.captive.apple.com"], ["original"]);
  assert.deepEqual(result.dns["nameserver-policy"]["geosite:cn"],
    ["https://223.5.5.5/dns-query#DIRECT", "https://doh.pub/dns-query#DIRECT"]);
  assert.deepEqual(apply(structuredClone(result), "Proxies", "", null, null, true), result);
});

test("adds both chain nodes without an upstream loop and keeps the first exit as the first option", () => {
  const ss = { name: "sample-b · SS2022链式", type: "ss" };
  const once = apply(subscription(), "", "", ss);
  const group = once["proxy-groups"].find(g => g.name === "🧲 海外AI");
  assert.deepEqual(group.proxies.slice(0, 2), [landingName, ss.name]);
  assert.equal(once.proxies.find(p => p.name === ss.name)["dialer-proxy"], "链式入口（机场）");
  assert.ok(!once["proxy-groups"][0].proxies.includes(ss.name));
  assert.deepEqual(apply(structuredClone(once), "", "", ss), once);
  const withoutSs = apply(structuredClone(once));
  assert.ok(!withoutSs.proxies.some(p => p.name === ss.name));
  assert.ok(!withoutSs["proxy-groups"].find(g => g.name === "🧲 海外AI").proxies.includes(ss.name));
});
function subscription(aiName = "🧲 海外AI") {
  return {
    proxies: [{ name: "airport-A", type: "ss" }],
    "proxy-groups": [
      { name: "Proxies", type: "select", proxies: ["airport-A"] },
      { name: aiName, type: "select", proxies: ["Proxies", "airport-A"] },
      { name: "Taiwan", type: "select", proxies: ["airport-A"] },
      { name: "Mail", type: "select", proxies: ["airport-A"] },
    ],
    rules: ["DOMAIN-SUFFIX,example.cn,DIRECT", `DOMAIN-SUFFIX,ai.example,${aiName}`, "MATCH,Proxies"],
    "rule-providers": { ai: { type: "http", url: "https://example.com/ai" } },
    dns: { enable: true },
  };
}

test("preserves the airport rules and groups without injecting a STUN rule", () => {
  const original = subscription();
  // Preserve even a STUN-specific rule supplied by the airport itself.
  original.rules.unshift("DOMAIN,stun.airport.example,DIRECT");
  const result = apply(structuredClone(original));
  assert.deepEqual(result.rules, original.rules);
  assert.deepEqual(result["rule-providers"].ai, original["rule-providers"].ai);
  for (const group of original["proxy-groups"]) {
    const actual = result["proxy-groups"].find(g => g.name === group.name);
    assert.deepEqual(actual, group.name === "🧲 海外AI" ? { ...group, proxies: [landingName, ...group.proxies] } : group);
  }
  assert.equal(result.proxies.at(-1)["dialer-proxy"], "链式入口（机场）");
  assert.equal(result["proxy-groups"][0].proxies[0], "Proxies");
  assert.ok(!result["proxy-groups"][0].proxies.includes(landingName));
});

test("preserves subscription DNS and TUN settings unchanged", () => {
  const source = subscription();
  source.dns = {
    nameserver: ["system"], fallback: ["114.114.114.114"],
    "nameserver-policy": { "+.example.com": ["223.5.5.5"] },
    "proxy-server-nameserver": ["udp://127.0.0.1:7874"],
    "proxy-server-nameserver-policy": { "+.example.com": ["system"] },
    "direct-nameserver": ["system"], "fake-ip-filter": ["*.lan"],
  };
  source.tun = { enable: true, stack: "mixed" };
  const originalDns = structuredClone(source.dns);
  const result = apply(source);
  assert.deepEqual(result.dns, originalDns);
  assert.deepEqual(result.tun, { enable: true, stack: "mixed" });
  const noDns = subscription();
  delete noDns.dns;
  assert.equal(Object.hasOwn(apply(noDns), "dns"), false);
});

test("only corrects TAGMeta's self-referential node DNS", () => {
  const source = subscription();
  source.dns = { listen: "0.0.0.0:7874", nameserver: ["original"],
    "nameserver-policy": { "+.example": ["original"] },
    "proxy-server-nameserver": ["udp://127.0.0.1:7874"] };
  const expected = structuredClone(source.dns);
  expected["proxy-server-nameserver"] = ["https://223.5.5.5/dns-query#DIRECT"];
  const result = apply(source, "", "", null, ["https://223.5.5.5/dns-query#DIRECT"]);
  assert.deepEqual(result.dns, expected);
  const mixed = subscription();
  mixed.dns = { listen: "127.0.0.1:7874", "proxy-server-nameserver": ["udp://127.0.0.1:7874", "223.6.6.6"] };
  assert.deepEqual(apply(mixed, "", "", null, ["https://223.5.5.5/dns-query#DIRECT"]).dns["proxy-server-nameserver"],
    ["https://223.5.5.5/dns-query#DIRECT", "223.6.6.6"]);
  const nonSelf = subscription();
  nonSelf.dns = { listen: "127.0.0.1:7874", "proxy-server-nameserver": ["223.6.6.6"] };
  const original = structuredClone(nonSelf.dns);
  assert.deepEqual(apply(nonSelf, "", "", null, ["https://223.5.5.5/dns-query#DIRECT"]).dns, original);
});

test("recognizes airport and service policy group names without a fixed domain list", () => {
  for (const name of ["AI", "海外AI", "🤖 AI服务", "ChatGPT", "OpenAI", "Claude", "Gemini", "人工智能"]) {
    const result = apply(subscription(name));
    assert.equal(result["proxy-groups"].find(g => g.name === name).proxies[0], landingName);
  }
});

test("new subscription rules and nodes stay current and repeated application is harmless", () => {
  const fresh = subscription();
  fresh.proxies.push({ name: "airport-new", type: "trojan" });
  fresh.rules.unshift("DOMAIN,new-ai.example,🧲 海外AI");
  const expectedRules = [...fresh.rules];
  const once = apply(fresh);
  assert.ok(once["proxy-groups"][0].proxies.includes("airport-new"));
  assert.deepEqual(once.rules, expectedRules);
  assert.deepEqual(apply(structuredClone(once)), once);
});

test("supports provider-backed AI groups and explicit names", () => {
  const source = { "proxy-providers": { airport: { type: "http" } }, "proxy-groups": [{ name: "Work", type: "select", use: ["airport"] }], rules: ["MATCH,Work"] };
  const result = apply(source, "", "Work");
  assert.deepEqual(result["proxy-groups"][0].use, ["airport"]);
  assert.deepEqual(result["proxy-groups"][1].proxies, [landingName]);
  assert.deepEqual(result["proxy-groups"][1].use, ["airport"]);
  assert.deepEqual(result.rules, ["MATCH,Work"]);
});

test("avoids front groups which transitively reach an AI group or include all local proxies", () => {
  for (const dangerous of [{ proxies: ["AI"] }, { "include-all-proxies": true }, { "include-all": true }]) {
    const source = subscription("AI");
    Object.assign(source["proxy-groups"][0], dangerous);
    assert.throws(() => apply(structuredClone(source), "Proxies"), /代理循环/);
    const result = apply(source);
    assert.ok(!result["proxy-groups"][0].proxies.includes("Proxies"));
    assert.ok(!result["proxy-groups"][0].proxies.includes("AI"));
  }
});

test("fails clearly on absent AI groups, absent upstream, or automatic AI selectors", () => {
  assert.throws(() => apply(subscription(), "renamed"), /不存在/);
  assert.throws(() => apply(subscription(), "", "nonexistent"), /未识别/);
  assert.throws(() => apply({ rules: [], "proxy-groups": [] }), /未识别/);
  const source = subscription(); source["proxy-groups"][1].type = "url-test";
  assert.throws(() => apply(source), /select/);
});

test("preserves airport rule providers and DNS for mixed AI rules", () => {
  const source = subscription("AI");
  source["rule-providers"].remote = { type: "http", behavior: "domain", url: "https://example.com/list" };
  source.rules.unshift("DOMAIN,exact.example,AI", "DOMAIN-KEYWORD,example-ai,AI", "RULE-SET,remote,AI", "GEOSITE,openai,AI", "PROCESS-NAME,Claude,AI");
  const original = structuredClone(source);
  const result = apply(source);
  assert.deepEqual(result["rule-providers"], original["rule-providers"]);
  assert.deepEqual(result.rules, original.rules);
  assert.deepEqual(result.dns, original.dns);
});

test("renaming removes the legacy generated group and keeps repeated application stable", () => {
  const source = subscription();
  source["proxy-groups"].unshift({ name: "机场前置", type: "select", proxies: ["Proxies"] });
  source.proxies.push({ name: landingName, type: "vless", "dialer-proxy": "机场前置" });
  const result = apply(source);
  assert.ok(!result["proxy-groups"].some(g => g.name === "机场前置"));
  assert.equal(result["proxy-groups"][0].name, "链式入口（机场）");
  assert.deepEqual(apply(structuredClone(result)), result);
});

test("removes legacy managed REALITY nodes without changing airport nodes", () => {
  const source = subscription();
  source.proxies.push({ name: "sample-a · AI链式", type: "vless", "dialer-proxy": "链式入口（机场）" },
    { name: "sample-a · REALITY链式", type: "vless" }, { name: "airport-REALITY", type: "vless" });
  source["proxy-groups"].find(g => g.name === "🧲 海外AI").proxies.unshift("sample-a · AI链式", "sample-a · REALITY链式", "airport-REALITY");
  const result = apply(source);
  assert.ok(!result.proxies.some(p => p.name === "sample-a · AI链式"));
  assert.ok(result.proxies.some(p => p.name === landingName));
  assert.ok(!result["proxy-groups"].find(g => g.name === "🧲 海外AI").proxies.includes("sample-a · AI链式"));
  assert.ok(result.proxies.some(p => p.name === "airport-A"));
  assert.ok(!result.proxies.some(p => p.name === "sample-a · REALITY链式"));
  assert.ok(result.proxies.some(p => p.name === "airport-REALITY"));
  assert.ok(result["proxy-groups"].find(g => g.name === "🧲 海外AI").proxies.includes("airport-REALITY"));
});
