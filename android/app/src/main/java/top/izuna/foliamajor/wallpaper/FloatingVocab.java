package top.izuna.foliamajor.wallpaper;

import android.icu.text.BreakIterator;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 悬浮歌词小窗上「下划线拆词」用的小词典：与 Web 侧 promptSegments.ts 同一批词
 * （tokenizer.json 里那 673 条多字中文 token，2–4 字）。
 *
 * 为什么要有它：这层是原生 Canvas 画的，手上只有整行文本 —— 没有 Web 侧那种逐字时间戳，
 * 于是中文只能一个字一个字切（用户原话：只有中文是这样的）。有这份词典，
 * 按最长匹配就能把「想想你天真无邪笑脸」切成词，下划线也就能逐词走了。
 *
 * 词典是**只读常量**：跟着包进来的字符串，不做 IO、不初始化外部资源。
 */
public final class FloatingVocab {

    /** 一段切出来的词，以及它在整行文本里的下标区间（给 measureText 用）。 */
    public static final class Segment {
        public final int start;
        public final int end;

        Segment(int start, int end) {
            this.start = start;
            this.end = end;
        }
    }

    private static final String[] WORDS_ARRAY = {
            "丢失","两个","两个人","两人","两代","两侧","两大","两大类","两天","两头",
            "两家","两岸","两年","两座","两次","两端","两类","两边","两项","严峻",
            "严谨","丧失","个个","个人","丰满","丹麦","为主","为主导","为人","为人类",
            "为代表","为佳","为大","为大家","为好","为己","主人","主任","主宰","主导",
            "主干","主治","主管","主线","举个","举人","举足","书信","书记","买家",
            "交代","交纳","亦称","京津","亮度","亲人","亲身","人为","人人","人以",
            "人们","人们对","人士","人大","人头","人家","人对","人就","人工","人称",
            "人类","人类对","人群","人被","人认为","人说","人身","人马","亿人","代为",
            "代人","代代","代价","代表","代谢","令人","以为","以使","以便","以大",
            "以太","以满足","以示","以西","以身","仪表","仲淹","价款","任课","伤害",
            "估价","估计","伴侣","伸缩","使人","使人们","侥幸","侵害","信仰","信任",
            "信念","信贷","修建","修缮","修补","修订","修身","修饰","填空","填补",
            "士大夫","壮丽","壮大","壮年","声称","大为","大举","大人","大使","大声",
            "大大","大夫","大头","大家","大家对","大山","大德","大桥","大楼","大殿",
            "大水","大海","大禹","大米","大类","大约","大纲","大象","天主","天人",
            "天使","天天","天山","天水","天津","天涯","天祥","天空","天线","太大",
            "太太","太平","太空","夫人","夫妻","失信","失常","失衡","失误","失败",
            "头寸","头顶","夸大","奥巴马","女人","女士","女娲","奶奶","她们","她说",
            "好书","好人","好好","好转","妹妹","嫦娥","审计","审议","客人","客家",
            "客车","宣德","宣称","宣纸","宣讲","室温","宫廷","宫殿","家乡","家人",
            "家家","家谱","容积","容纳","宽容","宽带","宽广","宽度","宿主","寥寥",
            "对个人","对人","对人类","对称","对该","对象","寻常","导弹","导游","导管",
            "导线","尤为","尤以","就以","就好","就对","就已","就没","就被","就让",
            "就说","就读","就象","尴尬","尺寸","尺度","尽头","尽快","尽管","尾巴",
            "屡屡","屡次","履约","山人","山大","山寺","山峰","山水","山河","山海",
            "山西","山谷","山顶","峡谷","工人","工件","工伤","工信","工夫","左侧",
            "左边","巨人","巨大","巨头","差价","已被","已达","巴巴","巴西","巴赫",
            "巴马","带头","带宽","带走","常人","常以","常常","常年","常被","常说",
            "干活","干线","干货","平常","平平","平庸","平淡","平稳","平米","平衡",
            "年为","年人","年代","年份","年就","年年","年幼","年度","年第","年级",
            "年纪","年被","年起","年轻","年轻人","并为","并举","并以","并使","并对",
            "并称","并被","幼年","广为","广大","广度","广西","康德","延伸","延年",
            "延误","建模","建议","建议大家","建设","弥漫","弥补","弯路","弹簧","强壮",
            "强大","强度","强弱","强迫","形似","形容","形象","彼岸","微信","微弱",
            "微微","微波","微课","微软","念头","档次","梯度","楷书","楼梯","模仿",
            "横跨","次年","次第","次级","次贷","欧洲","款项","毫米","水产","水墨",
            "水平","水泥","水泵","水深","水温","水稻","水管","水解","水质","污水",
            "污泥","汽油","汽车","没人","沦为","沧海","沪深","沮丧","河水","河西",
            "河谷","河边","油价","油墨","治好","治水","沿岸","沿海","沿线","泡沫",
            "波士","波士顿","波段","波浪","注解","泰山","津津","津液","津贴","洪水",
            "活泼","派人","浪漫","浪潮","浪费","海岸","海峡","海带","海德","海水",
            "海绵","浸泡","浸润","涡轮","涨价","淡水","淡淡","淤积","淮河","深度",
            "深海","深深","混乱","淹没","渤海","温室","温差","温带","温度","温水",
            "温馨","港澳","游人","游客","游泳","游离","游记","湿度","湿润","溢价",
            "溥仪","溶液","溶解","满满","满足","滴水","潮湿","澳洲","硬件","硬度",
            "确信","确认","碳水","礼仪","礼记","社交","社工","社群","离家","离岸",
            "秦桧","积水","积液","积累","称为","稳妥","稿件","穷人","空头","空置",
            "竣工","童年","笼罩","管仲","管线","类似","精巧","精度","精彩","精油",
            "精深","精确","糯米","紧紧","紧缩","紧缺","紧迫","累积","累累","累计",
            "红楼","红楼梦","红线","纤维","约为","约翰","纪年","纪念","纬度","纯粹",
            "纳米","纵横","纷纷","纸质","纹饰","纽带","纽约","线段","线索","线路",
            "维修","维度","维系","绵延","综述","绿水","缤纷","缩影","缴纳","缴费",
            "缺失","缺氧","缺水","翻身","翻转","补课","补贴","表彰","表示","表象",
            "表达","表述","衰弱","被人","被人们","被害","被害人","被称为","被认为","被贬",
            "被迫","西侧","西山","西欧","西游记","解说","解读","计价","认为","讨论",
            "让人","让人们","让大家","让她","议论","记账","记载","记述","讲座","讲究",
            "讲解","讲讲","讲课","讲述","论治","论述","设置","设置为","设计","该书",
            "该类","该项","详尽","误导","误差","误解","诱导","说说","说起","诵读",
            "请大家","读书","读书人","课件","谢谢","谴责","象形","财产","责令","责任",
            "账款","货款","贪婪","贯彻","贯穿","贷款","赫赫","走访","走路","赶快",
            "赶紧","足以","足迹","跨度","路人","路线","路边","身为","身份","身影",
            "身边","躯干","车主","车身","车轮","车载","车马","轨迹","转为","转弯",
            "转移","转让","转账","转身","转载","转载请","软件","软弱","软骨","轴线",
            "轻度","轻微","轻轻","载人","轿车","辨认","辩论","边形","迫使","迷信",
            "迷失","迹象","追寻","追溯","追究","追赶","追踪","页岩","顶峰","顶端",
            "顶级","项羽","顺便","顺差","顺治","顽强","顾客","饥饿","饮水","饱满",
            "饼干","马路","马车","驱使","驾车","驾驶","骨头","骨干","骨质","骨骼",
            "鱼类","鲤鱼","齿轮",
    };

    private static final Set<String> WORDS = new HashSet<String>(Arrays.asList(WORDS_ARRAY));

    /** 词典里最长的一个词有多长（逐字扫描时最多试这么多次）。 */
    private static final int MAX_WORD = 4;

    private FloatingVocab() {}

    private static boolean isSpace(char c) {
        return Character.isWhitespace(c);
    }

    private static boolean isAscii(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
    }

    private static boolean isCjk(char c) {
        return (c >= '\u4e00' && c <= '\u9fff')
                || (c >= '\u3040' && c <= '\u30ff')
                || (c >= '\uac00' && c <= '\ud7af');
    }

    private static boolean isAsciiInner(char c) {
        return isAscii(c) || c == '\'' || c == '-' || c == '\u2019';
    }

    /**
     * 整行文本 → 词区间。
     *
     * 两条路一起用，因为**哪一条单着都不够**：
     * - ICU（系统自带的分词器）认识「想想 / 天真 / 无邪」这类常用词，但它切不到歌词里的
     *   偏词，而且某些 ROM 上它被裁成了逐字；
     * - 随包那本词典是**分词器自己的 token 表**，覆盖的是另一批词，覆盖率靠它兜底。
     *
     * 所以：先跑 ICU，再把 ICU 切剩下的连续单字交给词典做最长匹配合并（{@link #mergeCjk}）。
     * 返回的区间一定是 [0, text.length) 的连续划分，下游可以直接拿去 `measureText`。
     */
    public static List<Segment> split(String text) {
        if (text == null || text.isEmpty()) return new ArrayList<Segment>();
        List<Segment> icu = splitWithIcu(text);
        if (icu != null && !icu.isEmpty()) return mergeCjk(text, icu);
        return splitWithDict(text);
    }

    /**
     * 系统 ICU 的分词结果。
     *
     * 拿不到（ROM 裁了 ICU 数据 / 版本太老）就返回 null，让调用方退到词典 —— 不要抛出去：
     * 这层每帧都在画，抛一次就是整个悬浮窗黑掉。
     */
    private static List<Segment> splitWithIcu(String text) {
        try {
            BreakIterator iterator = BreakIterator.getWordInstance(Locale.CHINA);
            iterator.setText(text);
            List<Segment> out = new ArrayList<Segment>();
            int start = iterator.first();
            for (int end = iterator.next(); end != BreakIterator.DONE; start = end, end = iterator.next()) {
                if (end <= start) continue;
                out.add(new Segment(start, end));
            }
            return out;
        } catch (Throwable ignored) {
            return null;
        }
    }

    /**
     * ICU 没切开的地方（连续的单字）再拿词典最长匹配合成一遍。
     *
     * 只动**连续的 CJK 单字**那一段：ICU 已经切出来的词（哪怕词典里没有）一律保留 ——
     * 它知道的比这本 673 条的词典多。
     */
    private static List<Segment> mergeCjk(String text, List<Segment> segments) {
        List<Segment> out = new ArrayList<Segment>();
        int count = segments.size();
        int index = 0;
        while (index < count) {
            Segment segment = segments.get(index);
            if (segment.end - segment.start != 1 || !isCjk(text.charAt(segment.start))) {
                out.add(segment);
                index += 1;
                continue;
            }
            int groupEnd = segment.end;
            int cursor = index + 1;
            while (cursor < count) {
                Segment next = segments.get(cursor);
                if (next.end - next.start != 1 || !isCjk(text.charAt(next.start))) break;
                groupEnd = next.end;
                cursor += 1;
            }
            out.addAll(splitWithDict(text, segment.start, groupEnd));
            index = cursor;
        }
        return out;
    }

    /** 词典最长匹配：西文连成词、空白成段、中日韩按词典切（匹配不上就单字）。 */
    private static List<Segment> splitWithDict(String text) {
        return splitWithDict(text, 0, text.length());
    }

    private static List<Segment> splitWithDict(String text, int from, int to) {
        List<Segment> out = new ArrayList<Segment>();
        if (text == null || from >= to) return out;
        int index = from;
        int length = Math.min(to, text.length());
        while (index < length) {
            char head = text.charAt(index);
            if (isSpace(head)) {
                int end = index;
                while (end < length && isSpace(text.charAt(end))) end++;
                out.add(new Segment(index, end));
                index = end;
                continue;
            }
            if (isAscii(head)) {
                int end = index;
                while (end < length && isAsciiInner(text.charAt(end))) end++;
                out.add(new Segment(index, end));
                index = end;
                continue;
            }
            if (isCjk(head)) {
                int size = Math.min(MAX_WORD, length - index);
                for (; size > 1; size--) {
                    if (WORDS.contains(text.substring(index, index + size))) break;
                }
                out.add(new Segment(index, index + size));
                index += size;
                continue;
            }
            out.add(new Segment(index, index + 1));
            index++;
        }
        return out;
    }
}
