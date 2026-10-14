import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { Want } from '@kit.AbilityKit';
import { promptAction, window } from '@kit.ArkUI';
import { FoliaRuntime } from '../common/FoliaRuntime';
import { performHttpRequest } from './NativeHttp';
import type { HttpRequestOptions, NativeHttpResult } from './NativeHttp';

// 当前文件：网页那边所有「原生能力」的落点。
//
// 网页调用的是 Capacitor 的插件（FoliaNative.httpRequest 之类），桥接脚本把名字原样转过来，
// 这里按名字分派。做不到的能力要明确 reject 成 Unimplemented，不能悄悄 resolve ——
// 悄悄成功会让界面以为壁纸已经设好了。

const DOMAIN = 0xF01A;
const TAG: string = 'FoliaBridge';

interface ImmersiveOptions {
  immersive: boolean;
}

interface AwakeOptions {
  awake: boolean;
}

export class FoliaHarmonyBridge {
  /**
   * 网页同步调用进来，立刻返回一个「收到了」；真正的结果稍后通过 runJavaScript 送回去。
   *
   * 之所以不直接返回 Promise：注对象跨语言的返回类型在各版本上支持程度不一致，
   * 而 runJavaScript 这条路在所有版本上都是稳的。
   */
  call(id: number, op: string, payload: string): boolean {
    void this.dispatch(id, op, payload);
    return true;
  }

  private async dispatch(id: number, op: string, payload: string): Promise<void> {
    try {
      const data: Object | null = await this.execute(op, payload);
      FoliaRuntime.get().settle(id, true, data, '');
    } catch (err) {
      const message: string = this.describe(err);
      hilog.warn(DOMAIN, TAG, 'op failed: %{public}s -> %{public}s', op, message);
      FoliaRuntime.get().settle(id, false, null, message);
    }
  }

  private async execute(op: string, payload: string): Promise<Object | null> {
    switch (op) {
      case 'FoliaNative.httpRequest':
        return await this.httpRequest(payload);
      case 'FoliaNative.exitApp':
        return this.exitApp();
      case 'FoliaNative.moveToBackground':
        return await this.moveToBackground();
      case 'FoliaNative.setImmersive':
        return this.setImmersive(payload);
      case 'FoliaNative.setScreenAwake':
        return this.setScreenAwake(payload);
      case 'FoliaNative.addListener':
        // 只登记不派发：目前没有原生事件要往网页送，给个 id 让调用方拿到 remove() 即可。
        return 'harmony-listener';
      case 'FoliaNative.removeListener':
        return null;
      case 'FoliaNative.downloadUpdate':
      case 'FoliaNative.installUpdate':
        throw this.unimplemented('应用内更新（鸿蒙版请用应用市场更新）');
      case 'FoliaPlayback.update':
      case 'FoliaPlayback.setState':
      case 'FoliaPlayback.stop':
      case 'FoliaPlayback.addListener':
      case 'FoliaPlayback.removeListener':
        // 通知栏媒体控制还没做。这里必须「成功但什么都不做」：
        // 播放桥接是每次切歌都调的，抛错会在界面上炸出一堆红字。
        return op === 'FoliaPlayback.addListener' ? 'harmony-listener' : null;
      case 'system.getSafeArea':
        return FoliaRuntime.get().getSafeArea() as Object;
      case 'system.toast':
        return this.toast(payload);
      default:
        throw this.unimplemented(op);
    }
  }

  private async httpRequest(payload: string): Promise<Object> {
    const options: HttpRequestOptions = JSON.parse(payload) as HttpRequestOptions;
    if (!options.url) {
      throw new Error('缺少请求地址');
    }
    const result: NativeHttpResult = await performHttpRequest(options);
    return result as Object;
  }

  private exitApp(): null {
    const context = FoliaRuntime.get().getContext();
    if (context) {
      context.terminateSelf().catch((err: BusinessError) => {
        hilog.warn(DOMAIN, TAG, 'terminateSelf failed: %{public}s', JSON.stringify(err));
      });
    }
    return null;
  }

  /**
   * 把任务挪到后台（相当于按 Home）。播放器按返回键应该走这条，
   * 直接杀进程的话歌也跟着停了。
   */
  private async moveToBackground(): Promise<null> {
    const context = FoliaRuntime.get().getContext();
    if (!context) {
      return null;
    }
    try {
      const want: Want = { action: 'action.system.home', entities: ['entity.system.home'] };
      await context.startAbility(want);
    } catch (err) {
      // 隐式拉起桌面在部分版本上会被拒绝。失败就留在原地，总比杀掉播放强。
      hilog.warn(DOMAIN, TAG, 'moveToBackground failed: %{public}s', JSON.stringify(err));
    }
    return null;
  }

  private setImmersive(payload: string): null {
    const options: ImmersiveOptions = JSON.parse(payload) as ImmersiveOptions;
    this.setSystemBarsVisible(!options.immersive);
    return null;
  }

  private setScreenAwake(payload: string): null {
    const options: AwakeOptions = JSON.parse(payload) as AwakeOptions;
    const mainWindow: window.Window | undefined = FoliaRuntime.get().getMainWindow();
    if (!mainWindow) {
      return null;
    }
    mainWindow.setWindowKeepScreenOn(options.awake === true).catch((err: BusinessError) => {
      hilog.warn(DOMAIN, TAG, 'setWindowKeepScreenOn failed: %{public}s', JSON.stringify(err));
    });
    return null;
  }

  private toast(payload: string): null {
    const options: { message: string } = JSON.parse(payload) as { message: string };
    promptAction.showToast({ message: options.message, duration: 2000 });
    return null;
  }

  private setSystemBarsVisible(visible: boolean): void {
    const mainWindow: window.Window | undefined = FoliaRuntime.get().getMainWindow();
    if (!mainWindow) {
      return;
    }
    // 逐条写死：这个参数在不同 SDK 版本上既有枚举也有字面量联合，别去猜类型名。
    mainWindow.setSpecificSystemBarEnabled('status', visible).catch((err: BusinessError) => {
      hilog.warn(DOMAIN, TAG, 'setSpecificSystemBarEnabled failed: %{public}s', JSON.stringify(err));
    });
    mainWindow.setSpecificSystemBarEnabled('navigation', visible).catch((err: BusinessError) => {
      hilog.warn(DOMAIN, TAG, 'setSpecificSystemBarEnabled failed: %{public}s', JSON.stringify(err));
    });
    mainWindow.setSpecificSystemBarEnabled('navigationIndicator', visible).catch((err: BusinessError) => {
      hilog.warn(DOMAIN, TAG, 'setSpecificSystemBarEnabled failed: %{public}s', JSON.stringify(err));
    });
  }

  private unimplemented(op: string): Error {
    return new Error('鸿蒙版暂未实现该能力：' + op);
  }

  private describe(err: Object): string {
    if (err instanceof Error) {
      return err.message;
    }
    return JSON.stringify(err);
  }
}
