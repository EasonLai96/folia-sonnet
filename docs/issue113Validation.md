# Issue #113：信息条自动反向选项

关联：Refs #113（https://github.com/maimai993/folia-sonnet/issues/113）。基线 dev fd73e486，独立于 #112/#106。

## 实现与兼容性

- 四个方向：auto / auto-reverse / vertical / horizontal，默认 auto-reverse。两个自动档共用高≥宽×1.1 的竖屏判据，结果相反。
- 删除独立反向状态、setter、设置行与导出字段。设置、命令 picker、导入确认共用方向文案/值表。
- 存储：合法方向（包含 auto）优先；缺失/非法方向时，旧 reverse 键仅字符串 false 映射 auto，其余 auto-reverse。旧键只读不写、不删除，保留已发布键契约。
- 旧外观配置：auto+reverse=true→auto-reverse，false→auto；只有旧 flag 的配置也可导入；固定方向与新 auto-reverse 优先；不带 flag 的合法 auto 保留。新导出不含 lwdr/长键 reverse。
- 源码只有 en/zh-CN/in 三份语言，遵循 AGENTS 不手写第四份：繁体由构建插件生成，真实截图显示自动（反向）。

## 验证

- 聚焦 9 文件、176 项测试全部通过，覆盖 store、codec、导出契约、命令面板、设置实际 DOM、迁移边界。
- 真实浏览器组件测试 2 项通过：390×844 与 844×390 下 auto/auto-reverse 方向相反、固定方向与相关面板几何不回归。
- TypeScript、控件/体积、版本、源码与构建产物密钥检查通过；Web build 通过，契约 extract 已执行、manifest 无差异。
- 全量 12659 项：12656 通过、1 失败、2 跳过。唯一失败 Windows modSignature symlink EPERM，未改测试绕过；本轮未修改 fd73e486 对照也重现。
- ci:local 已执行但并非全绿：装入已有 sync-server 依赖后仍在 Windows spawnSync('npm.cmd') 报 EINVAL、编译器未启动。直接执行相同 npm --prefix sync-server run build:node 通过；未把无关启动器修改混入本任务。全量与构建等子项如上单独执行，不能把分项通过说成 ci:local 通过。
- OpenCode 免费模型只读兼容性调查与队友独立生产审查完成，未发现阻塞 correctness 项；Lead 核查差异并运行最终验证。

## 真实渲染

使用仓库 preview/layoutCheck，Microsoft Edge，http://127.0.0.1:5199/，1440×1100，wait-ms=20000；合成种子跳过启动引导并打开主页与歌单设置。PNG 已用图片工具实际打开：四项并排，自动（反向）选中，没有独立反向开关。

方向行 scope [data-settings-row=bravaisSeamDirection]：elements=20、clickables=5、focusables=5、findings=[]。截图在本机 preview/issue113/ 下，布局报告保存在工作区 artifacts；不提交临时产物。

**请人工确认布局是否符合预期，确认前不合并。** 需要提交者审阅最终 diff、核验审查与实际交互。未自动创建 PR、未合并，不把 UI 截图检查代替人工确认。
