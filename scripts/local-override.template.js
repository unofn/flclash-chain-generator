// Generated locally. Contains proxy credentials; do not publish or commit.
// FlClash calls main with the latest subscription whenever it applies a profile.
function main(config) {
  const landings = __LANDINGS_JSON__;
  // Remove only nodes managed by this override, including earlier names.
  const landingNames = new Set([...landings.map(node => node.name), ...__LEGACY_NAMES_JSON__]);
  const preferredUpstream = __UPSTREAM_GROUP_JSON__;
  const preferredAIGroup = __AI_GROUP_JSON__;
  const proxyServerNameserver = __PROXY_SERVER_NAMESERVER_JSON__;
  const splitDns = __SPLIT_DNS_JSON__;
  const upstreamGroup = "链式入口（机场）";
  const ownUpstreamNames = new Set([upstreamGroup, "机场前置"]);

  if (!config || !Array.isArray(config.rules)) {
    throw new Error("机场配置缺少 rules，无法保留原分流规则");
  }

  // Remove only this override's entries, so applying it twice is harmless.
  const proxies = (config.proxies || []).filter((p) => !landingNames.has(p.name));
  const groups = (config["proxy-groups"] || []).filter(
    (g) => !ownUpstreamNames.has(g.name),
  );
  // Recognize policy group names, never infer or duplicate their domain rules.
  // AI is token-like so names such as Taiwan and Mail do not match.
  const aiName = /chatgpt|openai|claude|anthropic|gemini|人工智能|智能助手|(?:^|[^a-z0-9])ai(?:$|[^a-z0-9])/i;
  const targets = groups.filter((g) =>
    preferredAIGroup ? g.name === preferredAIGroup : aiName.test(g.name),
  );
  if (!targets.length) {
    throw new Error("未识别到机场 AI 策略组，请使用 --ai-group 指定组名");
  }
  if (targets.some((g) => g.type !== "select")) {
    throw new Error("AI 策略组需为 select 手动选择，避免自动测速改变落地出口");
  }
  const targetNames = new Set(targets.map((g) => g.name));
  const byName = new Map(groups.map((g) => [g.name, g]));
  function unsafeUpstream(name, visited = new Set()) {
    if (targetNames.has(name) || landingNames.has(name) || ownUpstreamNames.has(name)) return true;
    if (visited.has(name)) return false;
    visited.add(name);
    const group = byName.get(name);
    return !!group && (
      group["include-all"] === true || group["include-all-proxies"] === true ||
      (group.proxies || []).some((member) => unsafeUpstream(member, visited))
    );
  }
  const providers = Object.keys(config["proxy-providers"] || {});
  const candidates = preferredUpstream
    ? [preferredUpstream]
    : ["🙂 TAGSS", "Proxies", "PROXY", "🚀 节点选择"];
  const preferred = candidates.find((name) => byName.has(name) && !unsafeUpstream(name));
  if (preferredUpstream && !preferred) {
    throw new Error("前置组不存在或会形成代理循环：" + preferredUpstream);
  }
  const upstream = preferred || groups.find((g) => g.type === "select" && !unsafeUpstream(g.name))?.name;
  const members = [...new Set([...(upstream ? [upstream] : []), ...proxies.map((p) => p.name)])];
  if (!members.length && !providers.length) {
    throw new Error("机场订阅没有可用的前置节点或策略组");
  }

  // The landing node dials THROUGH the airport, not the other way around.
  for (const node of landings) node["dialer-proxy"] = upstreamGroup;
  config.proxies = [...proxies, ...landings];
  config["proxy-groups"] = [
    {
      name: upstreamGroup,
      type: "select",
      ...(members.length ? { proxies: members } : {}),
      ...(providers.length ? { use: providers } : {}),
    },
    ...groups.map((group) => targetNames.has(group.name)
      ? { ...group, proxies: [...landings.map((node) => node.name), ...(group.proxies || []).filter((name) => !landingNames.has(name))] }
      : group),
  ];
  // In a controlled test, TAGMeta's self-referential node DNS coincided with
  // UDP timeouts; changing only that field restored them. Keep other DNS intact.
  const nodeResolvers = config.dns?.["proxy-server-nameserver"];
  if (Array.isArray(proxyServerNameserver) && Array.isArray(nodeResolvers) &&
      ["0.0.0.0:7874", "127.0.0.1:7874"].includes(config.dns.listen) &&
      nodeResolvers.includes("udp://127.0.0.1:7874")) {
    config.dns = { ...config.dns, "proxy-server-nameserver": nodeResolvers.flatMap(
      resolver => resolver === "udp://127.0.0.1:7874" ? proxyServerNameserver : [resolver],
    ) };
  }
  if (splitDns) {
    if (!byName.has(preferredUpstream)) throw new Error("境外 DNS 策略组不存在：" + preferredUpstream);
    const domesticDns = ["https://223.5.5.5/dns-query#DIRECT", "https://doh.pub/dns-query#DIRECT"];
    config.dns = {
      ...(config.dns || {}),
      enable: true,
      nameserver: ["https://1.1.1.1/dns-query#" + preferredUpstream],
      fallback: [],
      "nameserver-policy": {
        ...((config.dns || {})["nameserver-policy"] || {}),
        "geosite:cn": domesticDns,
      },
    };
  }
  // Preserve routing rules and rule providers as-is.
  return config;
}
