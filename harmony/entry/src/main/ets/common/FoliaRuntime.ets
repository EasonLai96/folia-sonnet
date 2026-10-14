import { hilog } from '@kit.PerformanceAnalysisKit';
import { display, window } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';

// 当前文件：进程内单例。窗口句柄、页面 JS 执行器、安全区都挂在这里，
// 这样 EntryAbility（拿得到窗口）和 Index（拿得到 WebView）不用互相传引用。

const DOMAIN = 0xF01A;
const TAG: string = 'FoliaRuntime';

/** 安全区内缩，单位是 vp —— 与网页里的 CSS px 一一对应。 */
export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface BridgeEnvelope {
  id: number;
  ok: boolean;
  data: Object | null;
  error: string;
}

interface NativeEvent {
  event: string;
  data: Object | null;
}

export class FoliaRuntime {
  private static instance: FoliaRuntime | undefined = undefined;

  private abilityContext: common.UIAbilityContext | undefined = undefined;
  private windowStage: window.WindowStage | undefined = undefined;
  private jsRunner: ((script: string) => void) | undefined = undefined;
  private insets: SafeAreaInsets = { top: 0, bottom: 0, left: 0, right: 0 };

  static get(): FoliaRuntime {
    if (!FoliaRuntime.instance) {
      FoliaRuntime.instance = new FoliaRuntime();
    }
    return FoliaRuntime.instance;
  }

  setContext(context: common.UIAbilityContext): void {
    this.abilityContext = context;
  }

  getContext(): common.UIAbilityContext | undefined {
    return this.abilityContext;
  }

  setWindowStage(stage: window.WindowStage | undefined): void {
    this.windowStage = stage;
  }

  getMainWindow(): window.Window | undefined {
    if (!this.windowStage) {
      return undefined;
    }
    return this.windowStage.getMainWindowSync();
  }

  /** 页面能不能收消息，取决于这条执行器在不在。 */
  setJsRunner(runner: (script: string) => void): void {
    this.jsRunner = runner;
  }

  clearJsRunner(): void {
    this.jsRunner = undefined;
  }

  /** px → vp。网页里的 CSS px 等于 vp，安全区要换算后再给出去。 */
  toVp(px: number): number {
    const density: number = this.getDensity();
    return density > 0 ? px / density : px;
  }

  private getDensity(): number {
    try {
      const density: number = display.getDefaultDisplaySync().densityPixels;
      return density > 0 ? density : 1;
    } catch (err) {
      return 1;
    }
  }

  updateSafeArea(top: number, bottom: number, left: number, right: number): void {
    this.insets = { top: top, bottom: bottom, left: left, right: right };
    this.emitSafeArea();
  }

  getSafeArea(): SafeAreaInsets {
    return this.insets;
  }

  emitSafeArea(): void {
    this.emit('safeArea', this.insets as Object);
  }

  /**
   * 回一次「原生调用」的结果给网页。
   *
   * JSON.stringify 出来的字符串本身是被转义过的双引号字面量，直接拼进 JS 表达式即可，
   * 不需要再做一层引号处理 —— 手工拼引号遇到单引号 / 反斜杠一定会炸。
   */
  settle(id: number, ok: boolean, data: Object | null, error: string): void {
    const envelope: BridgeEnvelope = { id: id, ok: ok, data: data, error: error };
    this.runJs('window.__foliaHarmony && window.__foliaHarmony.settle(' +
      JSON.stringify(envelope as Object) + ')');
  }

  emit(event: string, data: Object | null): void {
    const payload: NativeEvent = { event: event, data: data };
    this.runJs('window.__foliaHarmony && window.__foliaHarmony.onNativeEvent(' +
      JSON.stringify(payload as Object) + ')');
  }

  private runJs(script: string): void {
    if (!this.jsRunner) {
      return;
    }
    try {
      this.jsRunner(script);
    } catch (err) {
      hilog.warn(DOMAIN, TAG, 'runJavaScript failed: %{public}s', JSON.stringify(err));
    }
  }
}
