# Chain Studio

一个在浏览器本地生成 FlClash 链式覆写脚本的小工具。它将机场作为第一跳，将你已有的 Shadowsocks 2022 节点作为落地出口，加入订阅的 AI 策略组。

## 支持的订阅

目前提供 **TAGMeta（TAG）** 和 **Nexitally（奶昔）** 的订阅预设，预设填写对应的 AI 策略组和机场前置组名称。订阅更新或组名变化后，请以实际配置为准。其他订阅可以尝试自动识别或自定义策略组，兼容性未逐一验证。

## 使用

在线使用：[打开 Chain Studio](https://unofn.github.io/flclash-chain-generator/)（配置在浏览器本地处理）。

1. 下载此仓库（GitHub 上选择 **Code → Download ZIP**），解压后用浏览器打开 `index.html`。无需安装或启动服务器。
2. 选择机场预设，或填写 AI 策略组及机场前置组的准确名称；留空时尝试自动识别。至少填写一个已有的 SS 2022 落地节点并下载脚本。
3. FlClash → 工具 → 进阶配置 → 脚本 → 添加 → 从文件导入下载的脚本。在对应订阅的「扩展 → 脚本」中选择并应用。
4. 在 AI 策略组选择 `链式落地 · 节点名称`，在 `链式入口（机场）` 策略组选择第一跳。检查实际选择及目标服务的出口。

脚本按照当前订阅动态生成策略组，订阅更新后重新应用时会使用更新后的节点与规则。节点凭据或策略组名称变更时，需要重新生成并导入脚本。

## 工作方式与限制

- 页面不请求网络、不上传或持久化输入；生成完全在浏览器完成。浏览器自身的表单自动填充、下载历史等行为由浏览器控制。
- **下载的脚本包含节点密码**。请勿公开分享、提交 Git 或发给无权使用该节点的人；使用后自行妥善保管或删除。
- 需要已有 SS 2022 节点：支持 `2022-blake3-aes-128-gcm` 和 `2022-blake3-aes-256-gcm`，密码分别为标准 Base64 编码的 16、32 字节密钥。工具不提供或部署节点，也不支持带身份密钥的多用户 SS 2022 密码格式。
- 需要订阅已有 `select` 类型的 AI 策略组。自动识别基于名称；机场命名不常见时请填写准确名称。节点默认放在 AI 组前面，已有的客户端选择可能保留，请应用后核对。
- 不增加 AI 域名规则，服务覆盖范围由机场规则决定；默认保留订阅的 DNS；TUN、WebRTC 按客户端设置运行，出口不一定一致。TAGMeta 预设提供可选的 DNS 分流及节点 DNS 修正，默认关闭；启用后国内 DNS 直连，默认境外 DNS 走指定前置组，并清空 fallback。
- 脚本会新建「链式入口（机场）」策略组，名称与订阅已有组冲突时会报错。为减少代理循环，显式指定的前置组不能直接或间接引用 AI 策略组或包含全部本地代理；仍需自行核对复杂订阅及最终出口。
- 本工具从 FlClash 0.9.2 / mihomo 1.19.33 的使用场景提取；其他版本和订阅的兼容性未逐一验证。代理本身可能不支持 UDP，脚本开启 UDP 不代表链路或 WebRTC 一定可用。

## 本地命令行生成

命令行生成器可读取保存在仓库外的本地配置和凭据，向指定目录生成兼容原有节点名称的脚本，适合用软链接供 FlClash 读取。配置示例见 [local-config.example.json](local-config.example.json)；请将副本和凭据存放在 Git 忽略的本地目录，并根据实际情况修改。凭据文件使用 `server`、`port`、`cipher`、`password` 字段，本地命令行兼容生成器支持 16 字节 Base64 密钥的 `2022-blake3-aes-128-gcm`。

```sh
node scripts/generate-local.mjs --config /path/to/local-config.json --output-dir /path/to/output --airport all
```

`--airport` 可指定配置中的一个机场，`all` 批量生成（跳过 `includeInAll: false` 的预设）；单个机场可用 `--ai-group`、`--upstream-group` 覆盖策略组名。每次生成会原子替换指定目录下的同名文件；若 FlClash 软链接指向它们，后续重新应用订阅时将读取新脚本。运行前确认输出目录，生成文件包含密钥。

本地配置的 `legacyNames` 用于清理旧脚本节点，`splitDns` 和 `proxyServerNameserver` 控制 TAG DNS 分流与特定自引用节点 DNS 修正。网页与本地命令行使用不同的节点命名规则；如需保留已有 FlClash 选择及软链接，使用本地命令行生成器。

## 开发与测试

`index.html` 是构建好的独立文件。修改 `app.js`、`styles.css` 或 `index.template.html` 后，使用 Node.js 18 或更新版本重新构建并测试：

```sh
node build.mjs
node --test test.cjs local-override.test.cjs local-generator.test.cjs
```

## 许可证

[MIT](LICENSE)
