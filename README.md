# Folia-Sonnet

将 [Folia](https://github.com/chthollyphile/folia-major) 打包到 Android 平台的实验性项目。它不是官方 Android 客户端，也不代表 Folia 主项目的移动端计划；本仓库版本基于 **Folia-major 0.7.18** 正式版。

> [!IMPORTANT]
> **装上去就能用，不需要自建后端。**
>
> 本版本已经内置**本地登录**：网易云、QQ 音乐（QQ 扫码与微信扫码）、酷狗的接口代码都打进了包里，
> 由 Android 原生桥（OkHttp + 系统 Cookie 罐）直接代发请求。扫码登录后，搜索、歌单、歌词、封面、
> 播放地址全部由 App 自己向官方服务器取，**不经过任何第三方中转服务器**。
>
> 所以现在只剩一个可选的后端地址：
>
> - `VITE_FOLIA_API_BASE`：**可选**。只用于 AI 主题生成与少量歌词代理，不填也能正常听歌。
> - `VITE_NETEASE_API_BASE` / `VITE_QQ_API_BASE` / `VITE_KUGOU_API_BASE`：Android 构建会在
>   构建期强制写成 `extension`（走本地桥），你不需要、也不应该再填它们。

## 项目简介

Folia 是一个以全屏沉浸式歌词播放为核心的在线音乐播放器，支持网易云、QQ 音乐、酷狗、Navidrome
与本地音乐库，通过智能歌词匹配、AI 生成配色主题以及多种全屏歌词动画提供独特的听歌体验。

这个仓库做的是同一套 Web 代码的 Android 容器（Capacitor），并补齐移动 / 壁纸场景才需要的那部分：

| 模块 | 说明 |
| --- | --- |
| 本地登录 | 内置接口代码 + 原生桥，扫码登录三家平台，不依赖任何自建后端。 |
| 动态歌词壁纸 | 可作为系统动态壁纸运行；「跟随」模式下壁纸画的就是播放页那套可视化。背景支持模糊封面 / 主题色 / 自选图片 / 自选视频（视频走 GLES 外纹理，静音循环）。 |
| 可视化叠层 | 壁纸之上的一层 WebView，跑的是播放页同一个渲染器，画面与播放页一致。 |
| 音乐锁屏 | 锁屏界面上也挂同一层叠层，与桌面叠层完全一致；底部有封面 / 歌名 / 时长 / 上一首·下一首控制条，退出按钮在左上角；也可以设成「只在锁屏上出现」（受 ROM 限制，见下）。 |
| 手机适配 | 竖屏 / 横屏的紧凑布局，全部由 `<html data-folia-phone-fit>` 门控，关闭时桌面布局一字不变。 |
| 刘海 / 挖孔适配 | 清掉系统垫给 decor 的 cutout padding，沉浸式下不再留黑边。 |
| 状态栏歌词 | 与 Lyricon 同步：换歌、播放暂停、拖动跳变、转屏等事件推送，段内推进归原生。 |
| 前台播放 | 前台服务 + 媒体通知，通知栏 / 锁屏 / 耳机按键的控制回到 App。 |
| 播放时保持常亮 | 可选开关：只在播放中钉住屏幕，暂停 / 退到后台立刻交还给系统。 |

上游 [folia-major](https://github.com/chthollyphile/folia-major) 本身的能力（本仓库跟随同步）：

| 模块 | 说明 |
| --- | --- |
| 在线搜索与播放 | 搜索歌曲、歌手或专辑后即可播放，并自动加载相关封面与歌词。 |
| 本地音乐支持 | 可导入本地音频文件，在本地安全保存索引信息，不上传文件内容。详细用法见 [本地音乐库管理](docs/local-library-management.md)。 |
| 智能歌词匹配 | 本地歌曲可自动匹配在线歌词与封面，也支持手动修正匹配结果。 |
| 本地歌词文件识别 | 自动加载同目录同名 `.lrc`、`.vtt`、`.ttml`、`.qrc`、`.yrc`、`.krc` 歌词文件，或歌词文件内嵌 LRC 歌词。适配 LDDC 生成的增强型逐字歌词格式。 |
| Now Playing 接入 | 支持通过本机 [Now Playing](https://github.com/Widdit/now-playing-service/) 服务接入外部播放器的歌曲、时间轴与歌词信息，并驱动 Folia 的舞台视图与全屏歌词渲染。 |
| AI 主题生成 | 基于歌曲情绪与歌词内容生成沉浸式背景与视觉参数。 |
| 多端体验 | 提供 Web 部署方式，同时支持桌面端打包分发。 |
| 模组系统（实验性） | 桌面版可通过 Folium 模组添加歌词动画、背景、播放页图层、命令等，并从 [模组市场](https://folium-compound.cielaniska.top) 安装官方认证的模组。详见 [模组系统](#模组系统folium-v1x)。 |

## 获取与构建

Releases 中提供调试 APK，安装即可使用。首次使用请在设置里授予「显示在其他应用上层」权限 ——
动态壁纸之上的可视化叠层依赖它（设置页里有一键跳转的授权入口）。

自行构建需要 Node.js 20+、JDK 21、Android SDK：

```bash
npm ci
```

复制 `.env.example` 为 `.env.local`。**什么都不改也能构建**：三家平台的地址在 Android 构建期
会被强制指向本地桥（`vite.config.ts` 里写死为 `extension`），只有想启用 AI 主题时才需要填
`VITE_FOLIA_API_BASE`。

Windows 构建调试 APK：

```bash
npm run build:android:debug
```

macOS / Linux：

```bash
npm run cap:sync:android
cd android
./gradlew assembleDebug
```

输出文件：`android/app/build/outputs/apk/debug/app-debug.apk`。
发布 AAB、签名和完整工具链说明见 [技术与开发说明](docs/technical.md#android--capacitor)。

## 部署 Folia API（可选）

`VITE_FOLIA_API_BASE` 指向本仓库的 Vercel Serverless API，仅用于 AI 主题生成和歌词代理：

1. 将此仓库 fork 到你的 GitHub 账号，在 Vercel 中选择 **Add New → Project** 并导入该 fork；保留仓库中的 `vercel.json` 默认构建配置。
2. 在 Vercel 项目的 **Settings → Environment Variables** 中配置一种 AI 提供商：
   - Gemini：`GEMINI_API_KEY`。
   - OpenAI 兼容服务：`OPENAI_API_KEY`、`OPENAI_API_URL` 和 `OPENAI_API_MODEL`；可选 `OPENAI_API_TEMPERATURE`。
3. 部署完成后，将 Android 本地 `.env.local` 中的值设为：

   ```env
   VITE_FOLIA_API_BASE=https://你的-vercel-项目.vercel.app/api
   ```

4. 重新执行 `npm run build:android:debug`。

密钥只应填写在 Vercel 环境变量中，绝不能写入 `.env.local`、`VITE_*` 或 APK；不要为没有限额或滥用防护的高额度密钥公开部署。

## 范围与限制

- Android 容器基于 Capacitor。不承诺本地音乐扫描、Android Auto 或应用商店发布支持。
- 音乐锁屏注册的是真正的锁屏页面（Activity），部分 ROM 会拦「后台弹出界面」，需要在系统设置里
  给本应用开「锁屏显示」，设置页里有实时诊断提示；那种机型上该项无效。
- 锁屏页会占住触摸（盖在锁屏之上时系统的解锁手势收不到），退出方式是上滑或点左上角的 ✕。
- 本仓库是非官方实验项目，不保证跟随 Folia-major 主仓库更新；请自行 fork、审计并维护你的副本。
- 在线音乐、歌词、封面及其他第三方内容的版权归相应权利人所有。请遵守所在地法律及服务条款，并通过官方渠道支持正版内容。

> [!NOTE]
> 源码本身不含任何内置的第三方后端地址。在线功能由本地登录直连各平台官方服务；未部署
> `VITE_FOLIA_API_BASE` 时只有 AI 主题与歌词代理不可用，其余功能不受影响。
>
> 模组系统是实验性功能，仅桌面版可用，默认关闭，需要在「设置 → 实验室 → 模组系统」中开启。

Folium 是 Folia 的模组平台。模组可以添加新的歌词动画模式和背景类型、在播放页上叠加内容、给进度条加按钮和标记、注册命令与设置分区、在歌词显示前改写歌词，也可以通过 Node 入口调用 ffmpeg 等本地能力。模组以可信代码运行，每个模组在启用前都要在原生窗口中确认，文件变化后需要重新确认。

- **模组市场**：[folium-compound.cielaniska.top](https://folium-compound.cielaniska.top) 提供官方模组和经过审查的社区模组，下载 zip 后拖进模组面板即可安装。
- **官方认证**：市场里的模组都带有 Folium 签名，安装后显示「官方认证」；没有签名的第三方模组显示「未验证」，同样可以使用。
- **开发与贡献**：[模组开发与贡献指南](docs/folium/contributing.md)，从写第一个模组、本地调试，到提交到模组市场、审查与签名、发布更新。
- **API 参考**：[Folium API 参考](docs/folium/api.md)，由契约文件生成的完整接口文档，按注册表、上下文、事件、服务等分类查询。
- **平台规范**：[Folium 规范](mods/README.md)，包括清单字段、权限、注册表语义、事件、安全模型与版本策略。
- **示范模组**：仓库的 [`mods/`](mods/) 目录，覆盖歌词动画、调参、进度条、播放页图层与透明视频导出。

## Sync Server

Folia 提供了可选的官方同步服务端 `sync-server`，用于在多个设备之间同步外观设置与 AI 主题库。服务端由用户自行托管，适合希望跨设备同步配色主题的用户。

支持以下部署方式：

- **Cloudflare Workers / D1**：免服务器运维的 Serverless 部署，推荐使用。
  [![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/chthollyphile/folia-major/tree/main/sync-server)
- **Docker**：镜像与 Compose 入口见 [Docker 部署目录](deploy/docker/README.md)。
- **Node.js 自托管**：使用 SQLite，适合本地或不方便使用 Docker 的环境。

详细的环境变量、Token 配置与部署步骤请参阅 [Sync-Server 部署指南](https://folia-site.cielaniska.top/guide/deploy-sync)。部署完成后，在 Folia 的“存储设置”中填写服务端地址和 `SYNC_TOKEN` 即可启用同步。

## 本地音乐与匹配说明

Folia 会读取音频文件元数据、同目录歌词和封面，并可通过网易云、QQ 音乐或酷狗音乐补全歌曲信息。自动匹配按网易云、QQ、酷狗依次回退；匹配不准确时，可以手动选择候选、恢复首次导入的本地信息，或进一步合并、拆分艺术家与专辑实体。

完整的导入、重扫、匹配、实体编辑、歌单、缓存和故障排查说明见 [本地音乐库管理](docs/local-library-management.md)。

## Community

加入discord社群，共同交流，获得帮助

[![Discord](https://img.shields.io/discord/1541051241822687232?logo=discord&logoColor=white&label=Join%20our%20Discord)](https://discord.gg/dMDBTHxeKd)

## 贡献者

感谢所有为本项目进行 Issue 提交、Bug 报告、想法建议、测试与代码编写的贡献者，均依据 all-contributors 规范进行统计

由于列表过长，贡献记录请见 [贡献者名单](CONTRIBUTORS.md)。

## 法律与免责声明

本项目在 AI 的广泛协助下开发，因此仍可能存在细微或不易察觉的问题。若给你带来不便，敬请理解。

本项目主要用于展示播放动效、界面设计与相关工程实现。本仓库及其源代码仅供个人学习、技术交流与非营利测试使用，请勿将其用于商业盈利用途。

请始终尊重数字版权，并在条件允许时通过官方平台支持正版音乐。

## 许可证

本项目基于 [AGPL-3.0](LICENSE) 许可证开源。使用、修改或分发前请阅读许可证全文。
