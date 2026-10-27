/**
 * 等原生的「到达信号」：`playFromQueue` 的 `ok` 只代表原生**受理**了这一单，
 * 不代表地址已经装进引擎 —— 它在起解析线程之前就回 true，真正换源要等平台的
 * 地址回来（`FoliaPlaybackService.nativePlayMirrorEntry`）。把 `ok` 当作已起播
 * 直接提交界面，解析失败时就会「名字换了、声音和歌词留在上一首」。
 *
 * 判据是原生快照里的 `songKey` 变成这一首：那是引擎当前真正加载的那一首，
 * 不看缓存状态、不看队列下标。等不到就当没接住，交给调用方回退 Web 全流程。
 */

export type NativeArrivalReadSnapshot = () => Promise<{ songKey?: string } | null | undefined>;

export type NativeArrivalOptions = {
    /** 读一次原生快照（真机上就是 FoliaPlayback.getPlaybackSnapshot）。 */
    readSnapshot: NativeArrivalReadSnapshot;
    /** 期望到达的 songKey。 */
    expectsKey: string;
    /**
     * 这一单还要不要。用户中途点了别的歌就该立刻放下，不再空等 ——
     * 否则等满超时后回退 Web，会把用户后来点的那首抢掉。
     */
    stillWanted?: () => boolean;
    /** 最长等多久，默认 6000ms（原生解析重试退避是 0/400/1200ms）。 */
    timeoutMs?: number;
    /** 两次读取之间的间隔，默认 250ms。 */
    intervalMs?: number;
    /** 现在几点，默认 Date.now；测试可以换掉。 */
    now?: () => number;
    /** 等待，默认 setTimeout；测试可以换掉。 */
    sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_TIMEOUT_MS = 6000;
const DEFAULT_INTERVAL_MS = 250;

/**
 * 等到返回 true，等不到（超时 / 被顶掉 / 读快照出错）返回 false。
 * 读快照出错当作「没到」：桥不可用时应当回退 Web，而不是卡在这里。
 */
export const waitForNativeArrival = async ({
    readSnapshot,
    expectsKey,
    stillWanted,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    intervalMs = DEFAULT_INTERVAL_MS,
    now = Date.now,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: NativeArrivalOptions): Promise<boolean> => {
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
        if (stillWanted && !stillWanted()) return false;
        try {
            const snapshot = await readSnapshot();
            if (snapshot?.songKey === expectsKey) return true;
        } catch {
            return false;
        }
        if (now() >= deadline) return false;
        await sleep(intervalMs);
    }
    return false;
};
