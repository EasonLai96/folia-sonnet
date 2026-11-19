# Media3 快照生命周期实验

这是单独的 `testOnly` APK（`top.izuna.foliamajor.stemsnapshotplayercheck`），不依赖正式 APK。只编译既有快照 store、DataSource、一个 Android 测试和一个 instrumentation 入口；使用本机 Gradle 缓存与 Android SDK，不启动 Gradle、不下载依赖、不连接设备。构建脚本不包含安装或运行步骤。

在工作树根目录执行：

```powershell
# 内存紧张时先做 Kotlin（-Werror）和 Java 定向编译
& ./android/experiments/stemSnapshotPlayerCheck/build.ps1 -CompileOnly
# 需要 APK 时再运行；只写入 android/build/stemSnapshotPlayerCheck
& ./android/experiments/stemSnapshotPlayerCheck/build.ps1
```

可显式传入 `-Sdk`、`-Jdk`、`-Cache`、`-DebugStore`。APK 构建要求已有本机 Android debug keystore；不创建或修改它。每次调用使用独立的 `android/build/stemSnapshotPlayerCheck/run-<id>/`。只使用本次成功输出中带 SHA-256 的 `Path`；`-CompileOnly` 或失败不会发布 `folia-stem-snapshot-player-test.apk`，不要使用目录中之前留下的同名 APK。脚本在发布前验证签名、对齐，以及编译后 manifest 的包名、`testOnly` 和唯一自指的 `top.izuna.foliamajor.stemsnapshotplayercheck/.StandaloneInstrumentation` 入口。入口预期恰好执行一个测试，无跳过；构建校验不是测试运行。

用例以真实 `ExoPlayer`、`ProgressiveMediaSource` 与 WAV extractor 准备一条暂停的 PCM 流，记录真实 DataSource 读取；将原路径原子替换为等长 B，跳到缓冲范围外的 45 秒，要求实际非零 `DataSpec.position` 重开并读到封存的 A。独立消费者持有同一快照。测试在 seek 读取中制造一个可控阻塞：要求 `player.release()` 和实际 period/source 释放回调之后，loader 仍然持有读取指针、安装租约未归还；解开阻塞后等真实 `ProgressiveMediaExtractor.release()`（Media3 1.11.1 的 `onLoaderReleased` 路径），结合 source 释放和读描述符清零确认快照可安全回收。该回调只观察 extractor 释放，不表示 loader 线程退出。失败路径也解开阻塞并尝试确认 teardown，即使 `player.release()` 抛错也继续等待；保留原失败，附加清理错误。未获确认时保留未归还的租约与夹具目录，不让 JUnit 自动删除。最后一个独立消费者退出后要求回收文件并返还预算。该观察点和单 period 夹具是实验专用，不是生产生命周期实现。

不测实际音频输出、真实生成器或 AAC、四轨/切轨、正式装源与资格授予、双 deck 淡出/取消、迟到结果及真实长曲。此前直接 DataSource 的设备结果不覆盖本用例。
