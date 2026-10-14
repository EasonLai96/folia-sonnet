import { AbilityConstant, ConfigurationConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { FoliaRuntime } from '../common/FoliaRuntime';

// 当前文件：应用入口。负责三件事 —— 边到边布局、系统栏配色、把安全区量出来送给网页。

const DOMAIN = 0xF01A;
const TAG: string = 'FoliaAbility';

export default class EntryAbility extends UIAbility {
  private avoidAreaListener: ((data: window.AvoidAreaOptions) => void) | undefined = undefined;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    try {
      this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
    } catch (err) {
      hilog.warn(DOMAIN, TAG, 'setColorMode failed: %{public}s', JSON.stringify(err));
    }
    FoliaRuntime.get().setContext(this.context);
    hilog.info(DOMAIN, TAG, 'Ability onCreate');
  }

  onDestroy(): void {
    hilog.info(DOMAIN, TAG, 'Ability onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    const runtime: FoliaRuntime = FoliaRuntime.get();
    runtime.setWindowStage(windowStage);

    const mainWindow: window.Window = windowStage.getMainWindowSync();

    // 边到边：内容铺满整屏。系统栏该让出的空间不在这里处理，
    // 而是量成安全区交给网页的 CSS 变量 —— 安卓上也是这个思路（见 --folia-safe-area-*）。
    mainWindow.setWindowLayoutFullScreen(true).catch((err: BusinessError) => {
      hilog.warn(DOMAIN, TAG, 'setWindowLayoutFullScreen failed: %{public}s', JSON.stringify(err));
    });

    // 深色界面配白色图标。
    mainWindow.setWindowSystemBarProperties({
      statusBarColor: '#00000000',
      navigationBarColor: '#00000000',
      statusBarContentColor: '#FFFFFF',
      navigationBarContentColor: '#FFFFFF',
    }).catch((err: BusinessError) => {
      hilog.warn(DOMAIN, TAG, 'setWindowSystemBarProperties failed: %{public}s', JSON.stringify(err));
    });

    const listener = (data: window.AvoidAreaOptions): void => {
      this.refreshSafeArea();
    };
    this.avoidAreaListener = listener;
    mainWindow.on('avoidAreaChange', listener);
    this.refreshSafeArea();

    windowStage.loadContent('pages/Splash', (err: BusinessError) => {
      if (err.code) {
        hilog.error(DOMAIN, TAG, 'loadContent failed: %{public}s', JSON.stringify(err));
        return;
      }
      hilog.info(DOMAIN, TAG, 'loadContent succeeded');
    });
  }

  onWindowStageDestroy(): void {
    const runtime: FoliaRuntime = FoliaRuntime.get();
    const mainWindow: window.Window | undefined = runtime.getMainWindow();
    if (mainWindow && this.avoidAreaListener) {
      mainWindow.off('avoidAreaChange', this.avoidAreaListener);
    }
    runtime.setWindowStage(undefined);
  }

  onForeground(): void {
    hilog.info(DOMAIN, TAG, 'Ability onForeground');
  }

  onBackground(): void {
    hilog.info(DOMAIN, TAG, 'Ability onBackground');
  }

  /**
   * 量一次安全区并推给网页。
   *
   * 鸿蒙的 avoidArea 给的是 px，网页里的 CSS px 等于 vp，必须换算；
   * 底部只认 TYPE_NAVIGATION_INDICATOR —— 三键导航时真正的高度也在这一项里。
   */
  private refreshSafeArea(): void {
    const runtime: FoliaRuntime = FoliaRuntime.get();
    const mainWindow: window.Window | undefined = runtime.getMainWindow();
    if (!mainWindow) {
      return;
    }
    const systemArea: window.AvoidArea = mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
    const indicatorArea: window.AvoidArea =
      mainWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR);
    runtime.updateSafeArea(
      runtime.toVp(systemArea.topRect.height),
      runtime.toVp(indicatorArea.bottomRect.height),
      runtime.toVp(systemArea.leftRect.width),
      runtime.toVp(systemArea.rightRect.width),
    );
  }
}
