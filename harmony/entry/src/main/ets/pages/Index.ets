import { webview } from '@kit.ArkWeb';
import { common, abilityAccessCtrl, Permissions } from '@kit.AbilityKit';
import { promptAction } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { picker } from '@kit.CoreFileKit';
import { FoliaConfig } from '../common/FoliaConfig';
import { FoliaRuntime } from '../common/FoliaRuntime';
import { LocalAssetServer } from '../asset/LocalAssetServer';
import { FoliaHarmonyBridge } from '../bridge/FoliaNativeBridge';

// 当前文件：WebView 主页。页面本体是 rawfile 里的前端产物，这里只负责：
// 把它喂进去（拦截请求）、把原生能力挂上去、处理返回键与加载失败。

@Entry
@Component
struct Index {
  private controller: webview.WebviewController = new webview.WebviewController();
  private assetServer: LocalAssetServer = new LocalAssetServer();
  private nativeBridge: FoliaHarmonyBridge = new FoliaHarmonyBridge();
  @State private lastBackTime: number = 0;
  @State private loadFailed: boolean = false;

  aboutToAppear(): void {
    // 原生异步结果只能靠这个执行器回到页面，页面销毁后要摘掉。
    FoliaRuntime.get().setJsRunner((script: string): void => {
      this.controller.runJavaScript(script);
    });
    this.requestPermissions();
  }

  aboutToDisappear(): void {
    FoliaRuntime.get().clearJsRunner();
  }

  async requestPermissions(): Promise<void> {
    const permissions: Permissions[] = ['ohos.permission.READ_IMAGEVIDEO'];
    try {
      const atManager: abilityAccessCtrl.AtManager = abilityAccessCtrl.createAtManager();
      const context: common.UIAbilityContext = FoliaRuntime.get().getContext() as common.UIAbilityContext;
      await atManager.requestPermissionsFromUser(context, permissions);
    } catch (err) {
      console.error('权限申请失败: ' + JSON.stringify(err));
    }
  }

  /**
   * 返回键：网页里还有历史就后退（关弹层、回上一页都在这一层）；
   * 到顶了再按一次才退出 —— 这是个播放器，误触把歌停掉很难受。
   */
  onBackPress(): boolean {
    if (this.controller.accessBackward()) {
      this.controller.backward();
      return true;
    }
    const now: number = Date.now();
    if (now - this.lastBackTime < 2000) {
      return false;
    }
    this.lastBackTime = now;
    promptAction.showToast({
      message: $r('app.string.press_back_again_to_exit'),
      duration: 2000,
    });
    return true;
  }

  build() {
    Stack() {
      Web({ src: FoliaConfig.ENTRY_URL, controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .databaseAccess(true)
        .fileAccess(true)
        .imageAccess(true)
        // 播放器要能自动接上下一首，不能要求每次都先点一下屏幕。
        .mediaPlayGestureAccess(false)
        // 酷狗那套接口是 http 的，页面却是 https 源，不放行会被当成混合内容拦掉。
        .mixedMode(MixedMode.All)
        .cacheMode(CacheMode.Default)
        .backgroundColor(FoliaConfig.BACKGROUND)
        // 调试期开着，出包前关掉（DevTools: chrome://inspect 走 hdc 端口转发）。
        .webDebuggingAccess(true)
        .javaScriptProxy({
          object: this.nativeBridge,
          name: 'FoliaHarmonyNative',
          methodList: ['call'],
          controller: this.controller,
        })
        .onInterceptRequest((event) => {
          if (!event) {
            return null;
          }
          return this.assetServer.handle(event.request.getRequestUrl());
        })
        .onPermissionRequest((event) => {
          if (event) {
            event.request.grant(event.request.getAccessibleResource());
          }
        })
        .onShowFileSelector((event: OnShowFileSelectorEvent) => {
          const fileSelectorResult: FileSelectorResult = event.result;
          try {
            const photoSelectOptions = new picker.PhotoSelectOptions();
            photoSelectOptions.MIMEType = picker.PhotoViewMIMETypes.IMAGE_TYPE;
            photoSelectOptions.maxSelectNumber = 1;
            const photoPicker = new picker.PhotoViewPicker();
            photoPicker.select(photoSelectOptions).then((result: picker.PhotoSelectResult) => {
              if (result && result.photoUris && result.photoUris.length > 0) {
                fileSelectorResult.handleFileList(result.photoUris);
              } else {
                fileSelectorResult.handleFileList([]);
              }
            }).catch((err: BusinessError) => {
              console.error('图片选择失败: ' + JSON.stringify(err));
              fileSelectorResult.handleFileList([]);
            });
          } catch (err) {
            console.error('Picker 异常: ' + JSON.stringify(err));
            fileSelectorResult.handleFileList([]);
          }
          return true;
        })
        .onPageEnd(() => {
          // 页面刚就绪时补推一次安全区：启动阶段的推送可能发生在 document 就绪之前。
          FoliaRuntime.get().emitSafeArea();
        })
        .onErrorReceive((event) => {
          if (event && event.request.getRequestUrl().startsWith(FoliaConfig.ORIGIN)) {
            this.loadFailed = true;
          }
        })
        .width('100%')
        .height('100%')

      if (this.loadFailed) {
        Column() {
          Text($r('app.string.web_load_failed'))
            .fontSize(16)
            .fontColor('#F5F5F7')
            .margin({ bottom: 16 })
          Button($r('app.string.web_retry'))
            .onClick(() => {
              this.loadFailed = false;
              this.controller.loadUrl(FoliaConfig.ENTRY_URL);
            })
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .backgroundColor(FoliaConfig.BACKGROUND)
      }
    }
    .width('100%')
    .height('100%')
  }
}
