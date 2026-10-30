# Issue #112：锁屏叠层宿主生命周期

关联：Closes #112（https://github.com/maimai993/folia-sonnet/issues/112）。目标 dev，基线 fd73e486。

## 范围与原因

维护者指出：解锁时 LockScreenMusicActivity 通常只到 STOPPED，并不立即销毁；只在 onDestroy 清宿主不足以移除仍挂在有效 token 上的 PANEL。

修复仅在 onStop 无条件 setLockScreenHost(null)，onResume 仍沿原路径重新交接，onDestroy 保留兜底。不改变正常桌面歌词的显示条件，不加入 #106 播放状态修改，也不混入 #113 设置变更。

## 验证

- 新增 3 项源码生命周期契约测试。先在未修复实现验证：1 失败、2 通过（缺少 onStop 清理）；修复后 3 通过。它是静态回归，不是 Android 行为证明。
- 聚焦 3 文件、10 项测试通过；TypeScript、git diff --check、源码密钥检查通过。
- Android JVM 测试与 debug assemble 通过，Capacitor Web 构建通过。
- 全量单测：12620 项，12617 通过、1 失败、2 跳过。唯一失败是 Windows modSignature symlink EPERM；本轮未修改 fd73e486 对照也重现，未更改测试规避。
- OpenCode 免费模型独立只读调查确认根因与最小修复；队友实现，Lead 检查最终差异。

## 雷电测试及限制

只使用 Folia-Issue106-isolated 隔离副本，最多运行一台；未修改原实例资料。安装测试 debug 包，用合成歌词/原生插件触发；日志见到锁屏宿主交接、宿主归 null、detach，但本轮未稳定捕获 STOPPED 而未销毁的完整解锁路径。无密码 keyguard、锁屏权限、模拟器 ADB 连接行为影响了复现。因此不宣称已完成动态验收，仍需真机验证：

1. 音乐播放 + 音乐锁屏开启，息屏→亮屏→解锁桌面，反复执行。
2. 解锁后无整屏 App/PANEL 残留，桌面图标/手势可用。
3. 仅锁屏模式不留桌面叠层；正常桌面歌词按原显示规则恢复。
4. 再锁屏能重新挂回，包括快速解锁与锁屏暂停。

测试曾在隔离副本临时设置 PIN 1122，已确认系统返回 Lock credential cleared；随后 set-disabled true 并读回 true，恢复原无锁屏设置，测试实例已关闭。未读取/变更用户账号凭据。

注意现有 decorView.post 的宿主交接和独立控制面板生命周期是待动态关注点；本次不凭推测扩大修改。

交付为修复分支；不新开重复 Issue，不自动创建 PR 或合并。人工创建 PR 时保留 Closes #112 并加 bug 标签。提交者需审阅和人工核验，不能用工具结论代替。
