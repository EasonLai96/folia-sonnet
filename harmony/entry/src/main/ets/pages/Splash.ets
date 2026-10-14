import { router } from '@kit.ArkUI';

// 当前文件：启动页。深色底 + 图标，停留时长与 Capacitor 的 launchShowDuration 对齐（900ms）。

const SPLASH_DURATION_MS: number = 900;

@Entry
@Component
struct Splash {
  private timerId: number = 0;

  aboutToAppear(): void {
    this.timerId = setTimeout(() => {
      router.replaceUrl({ url: 'pages/Index' });
    }, SPLASH_DURATION_MS);
  }

  aboutToDisappear(): void {
    clearTimeout(this.timerId);
  }

  build() {
    Column() {
      Image($r('app.media.startIcon'))
        .width($r('app.float.splash_icon_size'))
        .height($r('app.float.splash_icon_size'))
        .borderRadius(24)

      Text($r('app.string.app_name'))
        .fontSize($r('app.float.splash_text_size'))
        .fontColor($r('app.color.splash_text'))
        .margin({ top: 16 })
        .fontWeight(FontWeight.Medium)
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .backgroundColor($r('app.color.splash_background'))
  }
}
