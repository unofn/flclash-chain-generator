# Chain Studio

FlClash 链式配置生成器：将机场作为第一跳，把已有的 Shadowsocks 2022 节点加入订阅的 AI 策略组。

支持 **TAGMeta（TAG）**、**Nexitally（奶昔）** 预设，也可以自定义策略组。生成的脚本保留机场原有分流规则；实际覆盖哪些服务取决于机场订阅。

## 网页生成

打开 [Chain Studio](https://unofn.github.io/flclash-chain-generator/)，选择机场、填写落地节点并下载脚本。配置在浏览器本地处理，无需上传订阅。

在 FlClash 中打开 **工具 → 进阶配置 → 脚本 → 添加 → 从文件导入**，然后在订阅的 **扩展 → 脚本** 中选择并应用。在 AI 策略组选择落地节点，在「链式入口（机场）」组选择第一跳。应用后可访问 [Net.Coffee IP 分流测试](https://ip.net.coffee/)，检查目标服务的出口 IP。

网页默认保留订阅 DNS；TAGMeta 可选启用 DNS 分流和节点 DNS 修正。启用后国内 DNS 直连，默认境外 DNS 经机场前置组，并清空 `fallback`。

## 本地命令行生成

需要 Node.js 18 或更新版本。命令行适合用本地配置重复生成脚本，或将输出文件固定在供 FlClash 软链接读取的目录。

```sh
git clone https://github.com/unofn/flclash-chain-generator.git
cd flclash-chain-generator

mkdir -p "$HOME/.chain-studio"
cp local-config.example.json "$HOME/.chain-studio/local-config.json"
```

修改 `local-config.json` 中的节点名称、机场策略组和输出文件名。示例包含两个节点，其 `credentials` 分别指向配置文件同目录下的 `exit-a.json` 和 `exit-b.json`；请创建这两个文件，或修改路径。每个凭据文件的格式如下：

```json
{
  "server": "你的服务器地址",
  "port": 443,
  "cipher": "2022-blake3-aes-128-gcm",
  "password": "你的 Base64 密钥"
}
```

```sh
node scripts/generate-local.mjs \
  --config "$HOME/.chain-studio/local-config.json" \
  --output-dir "$HOME/.chain-studio/output" \
  --airport all
```

将 `--output-dir` 换成实际输出目录；`--airport` 可指定配置中的单个机场（如 `tagmeta` 或 `nexitally`），`all` 生成所有未排除的预设。同名文件会被替换；FlClash 使用软链接时，重新应用订阅后读取更新后的脚本。更多参数可运行 `node scripts/generate-local.mjs --help` 查看。

[配置示例](local-config.example.json)中的 TAGMeta 预设启用了 DNS 分流；按需修改 `splitDns` 和 `proxyServerNameserver`。网页与命令行使用不同的节点命名规则，如需保留已有节点名称和软链接，请使用命令行。

## 注意事项

- **生成的脚本包含节点密码**，请妥善保管，不要提交到 Git 或公开分享。命令行的本地配置和凭据也应存放在仓库外。
- 需要已有 `select` 类型的 AI 策略组。若自动识别不到，请填写准确组名；应用后检查实际选择和出口。
- 网页支持 SS 2022 的 128 位和 256 位 AES 密钥；命令行目前支持 `2022-blake3-aes-128-gcm`。不支持带身份密钥的多用户密码格式。
- DNS、TUN 和 WebRTC 的实际路径还受订阅和客户端设置影响，出口不一定一致。

## 开发

修改网页源文件后重新构建，并运行测试：

```sh
node build.mjs
node --test test.cjs local-override.test.cjs local-generator.test.cjs
```

[MIT License](LICENSE)
