# AGENTS.md

给在这个仓库里改代码的人和 AI 的规矩。先读 `docs/architecture.md` 摸清结构，再动手。

## 动手前

1. 改任何东西之前先跑一遍基线：`pnpm typecheck`（即 `vue-tsc --noEmit`）、`pnpm test`。
2. 找文件用搜索，不要猜路径；界面改动先在 `docs/ui-inventory.md` 里确认有没有现成入口。
3. 涉及安全边界的改动（CSP、IPC、更新、权限、语聊房鉴权）先看 `docs/security.md`。

## 语言与风格

- 代码注释、提交信息、界面文案用中文；标识符用英文。
- 提交信息格式：`类型(范围): 做了什么`，类型用 `feat / fix / style / refactor / docs / test / chore / revert`。
- 不要写「修复了一些问题」这种空话；一句话说清改了什么、为什么。
- 不要擅自改用户已经定过的偏好（例如歌词页布局、快捷键绑定），要改先问。

## 界面规矩

- 颜色、圆角、间距优先用 `src/renderer/style.css` 里的令牌；不要新写死十六进制色值。
- 浮层模糊只用 `--surface-blur-sm/md/lg/xl` 四档，不要再写 `blur(13px)` 这种。
- 图标颜色统一走 `--window-action-color`，不要在组件里单独写死深浅。
- 主动效遵守 `prefers-reduced-motion`。
- 原生元素不允许 `title` 属性（有测试盯着），需要提示就用 `Tooltip` 组件。
- `:deep()` 只能用在该用它的地方：样式写在**拥有该 DOM 的组件**里，不要跨组件用 `:has()` 去改别人的根节点（会被作用域编译破坏，历史事故见 `8746dff` 之前的提交）。

## 加东西的标准路径

**加一个 IPC 通道**

1. `src/main/ipc/*.ts` 里 `ipcRegistry.registerHandler('域:动作', ...)`
2. `src/preload/index.ts` 加类型化方法（不要塞进 `RENDERER_CHANNEL_ALLOWLIST`）
3. `src/renderer/electron.d.ts` 补类型
4. 如果是写文件/删文件/执行命令，必须在主进程校验路径来源

**加一个歌词页皮肤**

1. `src/renderer/views/lyric/builtinSkins.ts` 注册
2. `src/renderer/views/lyric/skins/config.ts` 加 key 与默认配置
3. 皮肤组件用 `useLyricSkin(key, defaults)` 取配置
4. `plugins/lyricsPage.ts` 的 `HostSkinId` 同步扩展
5. 跑 `pnpm test`，`tests/plugin-lyrics-page.test.mjs` 里有内置皮肤数量断言

**加测试**

- 纯函数放 `src/shared` 或 `src/renderer/utils`，测试放 `tests/*.test.ts`，用 `node --test`。
- 涉及组件树/渲染的用 `tests/*.test.mjs` + `@vue/compiler-sfc`。

## 发布流程

发布只在本机做，CI 不参与打包和发布：

```powershell
pnpm build                     # 只打一次包
.\scripts\publish-all.ps1      # 一次分发两边：腾讯云（主源）+ GitHub Release（兜底源）
```

- `publish-all.ps1` 先发腾讯云（内含清单签名与线上校验），再发 GitHub，最后比对两边 `latest.yml` 的 sha512，不一致直接报错
- **不要靠推 tag 让 CI 发 Release**：`.github/workflows/build.yml` 已去掉 tag 自动触发和发布 job，现在只保留手动触发的构建验证。CI 独立构建会产生第二个二进制，同一个版本号就对应两个不同文件了
- 签名私钥 `.keys/build-ed25519.pem` 只在本地，这是发布必须在本机完成的原因
- 客户端更新链路：腾讯云 `dkyy.top/dl/` 是主源，GitHub 与加速地址只在主源不可用时兜底

## 更新日志与界面文案

`CHANGELOG.md` 和 Release 正文是写给用户看的，`提交信息` 是写给接手的人看的，两者的标准不一样。

**CHANGELOG 只写用户能感知到的东西**

- 写：界面怎么变了、行为怎么变了、修了什么毛病、快了多少
- 不写：重构、依赖升级、构建配置、内部参数、启动流程调整、性能优化的实现细节
- 例：「人声分离支持排队」✓　「transcribe 增加 --device 参数」✗

**黑话一律不进 CHANGELOG，也不进界面文案**

CUDA、GPU 推理、preload、IPC、hidden imports、sha512、LRU 这类词，用户不懂，写了等于没写。要么换成大白话（显卡加速 / 处理器运算 / 启动更快），要么整句删掉。

反面例子（曾经写过）：`GPU 加速需另装 CUDA 版引擎` —— 用户不知道 CUDA 是什么，改成「换显卡加速版会后快好几倍」才有人看得懂。

提交信息不受此限，技术细节该写就写。

## 不要做的事

- 不要复制 AGPL 项目的代码（例如 Folia）。借鉴交互可以，代码自己写，并记到 `docs/ui-borrowed.md`。
- 不要动 `.keys/`（构建签名私钥），也不要把它带进仓库或 CI。
- 不要在没跑通 `vue-tsc`、`eslint`、`test` 的情况下说「改好了」。
- 不要为了通过检查去放宽规则（改断言、加 `eslint-disable`）；要么改代码，要么说明理由。

## 交付前自检

```bash
pnpm typecheck      # 类型
pnpm lint           # 风格（会自动修）
pnpm test           # 611+ 断言
pnpm build          # 生产构建
```

四项都绿再说完成；界面改动附一张截图路径。
