package top.izuna.foliamajor;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Choreographer;

/**
 * ⚠️ **临时诊断用**，定位完整个文件一起删。
 *
 * 主界面「歌词可视化每隔几秒顿一下」的那个停顿，量出来的形状是：
 *   · 掉帧打点里 `heapMB` 恒定不回落 —— **不是 GC**（GC 的话堆会掉）；
 *   · `workMs` 恒为 0 —— 卡的那段时间里**不含任何 JS**；
 *   · `[FoliaTick]`（宏任务定时器）跟着一起脏 —— **渲染进程那条主线程在忙**，不是在等
 *     BeginFrame；
 *   · 只在原生播放打开时出现，关掉原生 200ms 以上的大停顿整个消失。
 *
 * 这里补的是原生那一半：给主线程的 Looper 挂一个 Printer，逐条称每条消息的耗时，超过
 * 阈值的把**那条消息自己的描述**打出来（`>>>>> Dispatching to Handler (…)` 里带 handler
 * 类名、callback 与 what）。已经靠它抓到两条：
 *
 *   · `msg 181ms Handler (com.android.internal.os.HandlerCaller$MyHandler) null: 10`
 *   · `msg 263ms Handler (android.app.ActivityThread$H) null: 159`
 *
 * ⭐ 但「handler + what」只说得出**是谁在派发**，说不出**它派发的那一笔到底在跑什么**
 * —— `ActivityThread$H` 的 159 是 `EXECUTE_TRANSACTION`，里面装的是哪个生命周期项光看
 * 消息头看不出来。所以再加一个**主线程栈采样器**：另一条线程每 SAMPLE_INTERVAL_MS 拍一次
 * 主线程的栈并留一小圈，等某条消息称出「慢」，就把那段时间里最接近的一栈打出来。
 *
 * 用法：`logcat | grep FoliaMainLooper`；手机上通过开发者表 / 控制台的 `[FoliaLooper]` 看。
 */
public final class FoliaMainLooperWatchdog {

    private static final String TAG = "FoliaMainLooper";

    /** 单条主线程消息超过这么久就打一条。正常一帧 16ms，40ms 以上就有存在感了。 */
    private static final long SLOW_MESSAGE_MS = 60L;
    /** 主线程上两帧之间超过这么久就打一条。与 JS 侧 FoliaHitch 的阈值一致。 */
    private static final long SLOW_FRAME_MS = 80L;
    /** 主线程栈的采样间隔。12ms 足够撞进 60ms 以上的停顿里。 */
    private static final long SAMPLE_INTERVAL_MS = 12L;
    /** 留多少拍栈。12ms × 32 ≈ 380ms 的窗口，比要抓的停顿长一点就够。 */
    private static final int SAMPLE_CAPACITY = 32;
    /** 一栈最多打多少帧。再往下都是 Looper / Binder 的底，没信息量。 */
    private static final int STACK_FRAMES = 8;

    private static boolean installed = false;
    /** 当前正在派发的那条消息的描述（Printer 是成对的，中间不会插进别的消息）。 */
    private static String pending = null;
    /** 上面那条消息的来源 key，见 {@link #targetKey(String)}。 */
    private static String pendingKey = null;
    private static long pendingAtMs = 0L;
    private static long lastFrameAtMs = 0L;

    /**
     * 最近这几条留给**开发者表 / 控制台**读的。
     *
     * 真机常常不在 adb 上，而这条日志是原生 `Log.w` —— 只写在 logcat 里的话，
     * 屏幕上根本看不到。所以这里另外攒一份，由 Web 层每秒取走一次（drain）。
     *
     * ⚠️ 取走即清空：攒着不取会一直堆在这里，也省得界面上翻到几分钟前的旧账。
     */
    private static final int BUFFER_CAPACITY = 12;
    private static final Object BUFFER_LOCK = new Object();
    private static final java.util.ArrayDeque<String> BUFFER = new java.util.ArrayDeque<>();

    private FoliaMainLooperWatchdog() {}

    public static synchronized void install() {
        if (installed) {
            return;
        }
        installed = true;
        Looper.getMainLooper().setMessageLogging(new Printer());
        new Handler(Looper.getMainLooper()).post(() -> Choreographer.getInstance().postFrameCallback(new FrameWatch()));
        startSampler();
        Log.w(TAG, "installed");
    }

    // ---------------------------------------------------------------- 栈采样

    private static final class Sample {
        final long atMs;
        final StackTraceElement[] stack;

        Sample(long atMs, StackTraceElement[] stack) {
            this.atMs = atMs;
            this.stack = stack;
        }
    }

    private static final Object SAMPLE_LOCK = new Object();
    private static final java.util.ArrayDeque<Sample> SAMPLES = new java.util.ArrayDeque<>();
    private static volatile Thread mainThread = null;

    /**
     * 开一条线程定期拍主线程的栈。
     *
     * `Thread.getStackTrace()` 会让目标线程短暂挂起，所以这本身是有开销的 —— 只为一版
     * 诊断跑，量级是每 12ms 零点几毫秒，且它只影响「我们正在量的这个停顿」以外的时间。
     * 采样必须**一直开着**：停顿只有在结束那一刻才被称出来，那时再抓栈已经晚了。
     */
    private static void startSampler() {
        mainThread = Looper.getMainLooper().getThread();
        Thread sampler = new Thread(() -> {
            while (true) {
                try {
                    StackTraceElement[] stack = mainThread.getStackTrace();
                    long atMs = android.os.SystemClock.uptimeMillis();
                    synchronized (SAMPLE_LOCK) {
                        SAMPLES.addLast(new Sample(atMs, stack));
                        while (SAMPLES.size() > SAMPLE_CAPACITY) {
                            SAMPLES.removeFirst();
                        }
                    }
                    sampleGcStats();
                    flushBusyBucket();
                    Thread.sleep(SAMPLE_INTERVAL_MS);
                } catch (Throwable ignored) {
                    // 采样挂了不该带崩进程，也不该刷屏。
                }
            }
        }, "folia-looper-sampler");
        sampler.setDaemon(true);
        sampler.start();
    }

    // ------------------------------------------------------------ ART 的 GC

    private static long lastGcCount = -1L;
    private static long lastGcTimeMs = -1L;
    private static long lastBlockingCount = -1L;
    private static long lastBlockingTimeMs = -1L;

    /**
     * 盯 ART 的 GC（**这一条是「主线程干净却还是卡」的唯一解释**）。
     *
     * 前面已经把三条路都排除了：不是 GC in 渲染进程（JS 堆恒定不回落）、不是我们的 JS
     * （`workMs` 恒为 0）、不是 App 主线程（Looper 里除了开页那次 WebView 引擎启动，
     * 一条慢消息都没有）。剩下一种能同时满足这三条的：
     *
     * **App 进程里发生了一次阻塞式 GC。**
     *
     * 它停顿的是 App 进程自己的线程，而 WebView 的**浏览器侧**（合成器、帧提交）就跑在
     * App 进程里 —— 那边一停，渲染进程拿不到提交，rAF 与宏任务定时器一起停，
     * 于是 JS 侧看到的就是「两帧之间隔了几百毫秒、而自己一毫秒都没花」。
     * ⭐ 而 Looper 打印机**称不到它**：GC 停顿大多发生在主线程空闲（epoll）的时候，
     * 不属于任何一条消息的耗时 —— 这正好解释了为什么主线程记录是干净的。
     *
     * 判据用 `Debug.getRuntimeStat("art.gc.blocking-gc-count")` 这一对累计值：
     * 计数跳了就是发生过一次，配 `blocking-gc-time` 的增量就是那一次的总停顿。
     */
    private static void sampleGcStats() {
        long count = parseStat("art.gc.gc-count");
        long timeMs = parseStat("art.gc.gc-time");
        long blockingCount = parseStat("art.gc.blocking-gc-count");
        long blockingTimeMs = parseStat("art.gc.blocking-gc-time");
        if (count < 0 && blockingCount < 0) {
            return; // 这个 ROM 不给，认了。
        }
        boolean first = lastGcCount < 0 && lastBlockingCount < 0;
        boolean changed = lastGcCount >= 0 && (count != lastGcCount || blockingCount != lastBlockingCount);
        if (first) {
            lastGcCount = count;
            lastGcTimeMs = timeMs;
            lastBlockingCount = blockingCount;
            lastBlockingTimeMs = blockingTimeMs;
            return;
        }
        if (!changed) {
            return;
        }
        long deltaBlocking = blockingTimeMs >= 0 && lastBlockingTimeMs >= 0
                ? blockingTimeMs - lastBlockingTimeMs : -1L;
        long deltaTotal = timeMs >= 0 && lastGcTimeMs >= 0 ? timeMs - lastGcTimeMs : -1L;
        record("gc +" + (blockingCount >= 0 && lastBlockingCount >= 0 ? blockingCount - lastBlockingCount : -1L)
                + " blocking, pause " + deltaBlocking + "ms (all gc " + deltaTotal + "ms), heap "
                + heapText());
        lastGcCount = count;
        lastGcTimeMs = timeMs;
        lastBlockingCount = blockingCount;
        lastBlockingTimeMs = blockingTimeMs;
    }

    private static long parseStat(String name) {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.M) {
            return -1L; // getRuntimeStat 是 API 23 才有的。
        }
        try {
            String raw = android.os.Debug.getRuntimeStat(name);
            return raw == null || raw.isEmpty() ? -1L : Long.parseLong(raw.trim());
        } catch (Throwable error) {
            return -1L;
        }
    }

    private static String heapText() {
        Runtime runtime = Runtime.getRuntime();
        long usedMb = (runtime.totalMemory() - runtime.freeMemory()) / 1048576L;
        long maxMb = runtime.maxMemory() / 1048576L;
        return usedMb + "/" + maxMb + "MB";
    }

    /** 取离这个时刻最近的一拍栈；没有就给 null。 */
    private static StackTraceElement[] stackNear(long atMs) {
        Sample best = null;
        long bestDelta = Long.MAX_VALUE;
        synchronized (SAMPLE_LOCK) {
            for (Sample sample : SAMPLES) {
                long delta = Math.abs(sample.atMs - atMs);
                if (delta < bestDelta) {
                    bestDelta = delta;
                    best = sample;
                }
            }
        }
        // 差得太远说明那一拍根本没采到，别拿一栈不相干的来误导。
        return best == null || bestDelta > 2 * SAMPLE_INTERVAL_MS ? null : best.stack;
    }

    /**
     * 栈拼成一串 `类.方法:行 <- …`。
     *
     * 自家的包名统一剥掉（`top.izuna.foliamajor.`）—— 一栈八帧里多半是自家代码，
     * 留着包名会把整行撑到看不完，而系统那几帧才是要认的。
     */
    private static String formatStack(StackTraceElement[] stack) {
        if (stack == null || stack.length == 0) return "?";
        StringBuilder joined = new StringBuilder();
        int count = Math.min(STACK_FRAMES, stack.length);
        for (int i = 0; i < count; i += 1) {
            if (i > 0) {
                joined.append(" <- ");
            }
            String owner = stack[i].getClassName();
            if (owner.startsWith("top.izuna.foliamajor.")) {
                owner = owner.substring("top.izuna.foliamajor.".length());
            }
            joined.append(owner)
                    .append('.')
                    .append(stack[i].getMethodName())
                    .append(':')
                    .append(stack[i].getLineNumber());
        }
        return joined.toString();
    }

    // ------------------------------------------------------------ 主线程占用率

    /** 这一桶（约 1 秒）里主线程一共被消息占了多少毫秒、跑了多少条。 */
    private static long bucketBusyMs = 0L;
    private static long bucketCount = 0L;
    private static long bucketStartMs = 0L;

    /**
     * 这一桶里**谁**在派发：key → `{条数, 耗时毫秒}`。
     *
     * ⭐ 占用率只说得出「主线程很忙」，说不出「忙在谁身上」。而看到 `307 msgs/秒` 之后，
     * 唯一能省下下一轮瞎猜的办法就是把来源直接列出来 —— `ActivityThread$H` 那种笼统的
     * 目标名没有信息量，真正有用的是 **callback 的类名**
     * （`ViewRootImpl$TraversalRunnable` / `FrameDisplayEventReceiver` / 自家的 Runnable）。
     *
     * 每桶清空；条目数封顶，免得某个一次性的东西把表撑爆。
     */
    private static final java.util.HashMap<String, long[]> bucketTargets = new java.util.HashMap<>();
    private static final int TARGET_TABLE_CAP = 48;
    private static final int TARGET_REPORT_TOP = 5;

    /** 统计窗口（约 1 秒）与「忙到值得记一行」的下限（20% 以上才算忙）。 */
    private static final long BUSY_BUCKET_MS = 1000L;
    private static final long BUSY_REPORT_MS = 200L;

    /**
     * 主线程**占用率**，而不是单条消息的耗时。
     *
     * 上面那个 `msg …ms` 只抓单条超过 60ms 的，可主线程完全可能是被**一大堆十几毫秒
     * 的消息**占满的 —— 那种情况下：
     *   · 一条 `msg` 都不会记（每条都不够长），主线程记录看着干干净净；
     *   · 但 App 主线程一直在忙，WebView 的帧提交（`ViewRootImpl.draw`）排不进去；
     *   · 渲染进程于是拿不到新帧，rAF 与宏任务定时器一起停 ——
     *     就是 JS 侧看到的那些笔，`posAgeMs` 也会时不时超过 500ms 的通知间隔。
     *
     * 所以按秒累计「被占用多少毫秒 / 跑了多少条」，忙的秒记一行，并附上**耗时前几名**。
     */
    private static void flushBusyBucket() {
        long nowMs = android.os.SystemClock.uptimeMillis();
        if (bucketStartMs == 0L) {
            bucketStartMs = nowMs;
            return;
        }
        long elapsed = nowMs - bucketStartMs;
        // 采样线程自己被饿住过（超过 5 秒没轮到）就别报了，那不是主线程的事。
        if (elapsed < BUSY_BUCKET_MS || elapsed > 5000L) {
            return;
        }
        if (bucketBusyMs >= BUSY_REPORT_MS) {
            record("busy " + bucketBusyMs + "ms/" + elapsed + "ms, " + bucketCount + " msgs"
                    + topTargets());
        }
        bucketStartMs = nowMs;
        bucketBusyMs = 0L;
        bucketCount = 0L;
        bucketTargets.clear();
    }

    /** 把这一桶里最费时间的那几个来源拼成一串，接在 `busy` 后面。 */
    @SuppressWarnings("unchecked")
    private static String topTargets() {
        if (bucketTargets.isEmpty()) {
            return "";
        }
        java.util.Map.Entry<String, long[]>[] entries =
                bucketTargets.entrySet().toArray(new java.util.Map.Entry[0]);
        java.util.Arrays.sort(entries, (left, right) -> Long.compare(right.getValue()[1], left.getValue()[1]));
        StringBuilder joined = new StringBuilder(" |");
        int count = Math.min(TARGET_REPORT_TOP, entries.length);
        for (int i = 0; i < count; i += 1) {
            joined.append(' ')
                    .append(entries[i].getKey())
                    .append(' ')
                    .append(entries[i].getValue()[1])
                    .append("ms/")
                    .append(entries[i].getValue()[0]);
            if (i < count - 1) {
                joined.append(',');
            }
        }
        return joined.toString();
    }

    /**
     * 从 `>>>>> Dispatching to Handler (com.foo.Bar) {1a2b} null: 159` 里抽出**有信息量的那个名字**。
     *
     * Looper 打的是 `msg.target + " " + msg.callback + ": " + msg.what`：
     *   · **有 callback** 时它才是真正在跑的东西（`ViewRootImpl$TraversalRunnable`、
     *     `Choreographer$FrameDisplayEventReceiver` …），`what` 恒为 0 —— 这时候答案在 callback 里；
     *   · **没 callback**（`null`）时只能靠 target + what，两个一起才有意义
     *     （`ActivityThread$H:159` 是 `EXECUTE_TRANSACTION`，单说 159 谁都认不出来）。
     */
    private static String targetKey(String line) {
        int closeBrace = line.indexOf("} ");
        int whatColon = line.lastIndexOf(": ");
        String target = simpleName(slice(line, line.indexOf('(') + 1, line.indexOf(')')));
        if (closeBrace > 0 && whatColon > closeBrace) {
            String callback = line.substring(closeBrace + 2, whatColon).trim();
            if (!callback.isEmpty() && !"null".equals(callback)) {
                return simpleName(callback);
            }
            return target + ":" + line.substring(whatColon + 2).trim();
        }
        return target;
    }

    /** 取 `[from, to)`；下标不合法时给空串（诊断代码不该为一条畸形日志抛异常）。 */
    private static String slice(String text, int from, int to) {
        return from > 0 && to > from ? text.substring(from, to) : "?";
    }

    /** 只留最后一段（`android.view.ViewRootImpl$TraversalRunnable` → `ViewRootImpl$TraversalRunnable`）。 */
    private static String simpleName(String name) {
        int dot = name.lastIndexOf('.');
        return dot >= 0 ? name.substring(dot + 1) : name;
    }

    // ---------------------------------------------------------------- 记与取

    /**
     * 攒一份给开发者表 / 控制台，见 BUFFER 那段。
     *
     * 调用方有两条线程（主线程与采样线程），所以下面进 buffer 要加锁；不带栈的版本给
     * GC 那类「跟某条消息无关」的记录用。
     */
    private static void record(String body) {
        record(body, null);
    }

    private static void record(String body, StackTraceElement[] stack) {
        /*
         * 行首带上墙钟的后六位（毫秒）。
         *
         * 这份东西最终要跟 JS 侧 `[FoliaTick]` / `[FoliaHitch]` 按时间对上，而那边的
         * `atMs` 是 `performance.now()`（**页面自己的**时间原点），跟这里任何一个钟都
         * 对不齐。两边都改成「墙钟后六位」就能直接比 —— 六位够覆盖十几分钟，一次
         * 排查用不完，也短得能塞进开发者表那一格。
         */
        String line = (System.currentTimeMillis() % 1000000L) + " " + body
                + (stack == null ? "" : " | " + formatStack(stack));
        Log.w(TAG, line);
        synchronized (BUFFER_LOCK) {
            BUFFER.addLast(line);
            while (BUFFER.size() > BUFFER_CAPACITY) {
                BUFFER.removeFirst();
            }
        }
    }

    /**
     * 取走攒下的那些（取走即清空）。
     *
     * 拼成一个串而不是数组：桥上多一个结构化字段就要多一份类型声明，而这里只是
     * 「给人看的一行行字」，一个字符串足够，也不必为临时诊断动 `foliaNative.ts` 的类型。
     */
    public static String drain() {
        synchronized (BUFFER_LOCK) {
            if (BUFFER.isEmpty()) {
                return "";
            }
            StringBuilder joined = new StringBuilder();
            boolean first = true;
            for (String line : BUFFER) {
                if (!first) {
                    joined.append(" ¶ ");
                }
                first = false;
                joined.append(line);
            }
            BUFFER.clear();
            return joined.toString();
        }
    }

    private static final class Printer implements android.util.Printer {
        @Override
        public void println(String x) {
            if (x == null) {
                return;
            }
            if (x.startsWith(">>>>>")) {
                pending = x;
                // 在开头就算好 key：结尾那一下要称耗时，别让字符串处理挤进秤上。
                pendingKey = targetKey(x);
                pendingAtMs = android.os.SystemClock.uptimeMillis();
                return;
            }
            if (x.startsWith("<<<<<") && pending != null) {
                long cost = android.os.SystemClock.uptimeMillis() - pendingAtMs;
                bucketBusyMs += cost;
                bucketCount += 1L;
                accumulate(pendingKey, cost);
                if (cost >= SLOW_MESSAGE_MS) {
                    // 取停顿正中间那一拍：开头那一拍可能还排在前一条消息的尾巴上。
                    record("msg " + cost + "ms " + shorten(pending), stackNear(pendingAtMs + cost / 2));
                }
                pending = null;
            }
        }
    }

    /** 把这一条计进本桶的来源表。key 为 null 时归到 `?`（不该发生）。 */
    private static void accumulate(String key, long costMs) {
        if (key == null) {
            return;
        }
        long[] slot = bucketTargets.get(key);
        if (slot == null) {
            // 封顶：一次性的东西太多就别再收新键了，已有的照常累计。
            if (bucketTargets.size() >= TARGET_TABLE_CAP) {
                slot = bucketTargets.get("others");
                if (slot == null) {
                    slot = new long[2];
                    bucketTargets.put("others", slot);
                }
            } else {
                slot = new long[2];
                bucketTargets.put(key, slot);
            }
        }
        slot[0] += 1L;
        slot[1] += costMs;
    }

    /**
     * 描述里那串对象哈希（`{1a2b3c}`）每次都不一样，留着只会让 logcat 去重失效、
     * 也没法一眼看出「还是同一条」，所以截掉。
     */
    private static String shorten(String line) {
        String text = line;
        // 去掉 ">>>>> Dispatching to " 这个前缀：开发者表那一格只有一两行宽。
        final String dispatchPrefix = ">>>>> Dispatching to ";
        if (text.startsWith(dispatchPrefix)) {
            text = text.substring(dispatchPrefix.length());
        }
        int brace = text.indexOf('{');
        if (brace >= 0) {
            int end = text.indexOf('}', brace);
            if (end > brace) {
                text = text.substring(0, brace) + text.substring(end + 1);
            }
        }
        return text.length() > 160 ? text.substring(0, 160) : text;
    }

    private static final class FrameWatch implements Choreographer.FrameCallback {
        @Override
        public void doFrame(long frameTimeNanos) {
            long nowMs = android.os.SystemClock.uptimeMillis();
            if (lastFrameAtMs != 0L) {
                long gap = nowMs - lastFrameAtMs;
                if (gap >= SLOW_FRAME_MS) {
                    record("frame " + gap + "ms", stackNear((lastFrameAtMs + nowMs) / 2));
                }
            }
            lastFrameAtMs = nowMs;
            Choreographer.getInstance().postFrameCallback(this);
        }
    }
}
