// src/components/login/loginMethodIcons.ts
// 登录方式的图标。平台只声明图标的名字（LoginMethod.iconKey），这里按名字到 src/assets/providers/
// 里取同名的文件；没有这个文件就没有图标。加一种登录方式的图标只要往那个文件夹放一个文件。
//
// 顺序 svg → png → webp：以前只认 .svg，于是 QQ / 微信扫码那两颗只能用手绘的简笔图
// （两个圆加一撇），跟资料库来源角标、平台记号上那些真机图标（netease / kugou 那些
// .png、.webp）根本不是一回事。现在放进从 App 里抠出来的真图标（.png）就能直接用，
// 手绘那两张 qq.svg / wechat.svg 已经删掉。

const ICONS = import.meta.glob<string>(
    ['../../assets/providers/*.svg', '../../assets/providers/*.png', '../../assets/providers/*.webp'],
    { eager: true, query: '?url', import: 'default' },
);

/** 同名文件可能不止一种格式，按顺序取第一个找得到的。 */
const SUFFIXES = ['.svg', '.png', '.webp'] as const;

export const loginMethodIcon = (iconKey: string): string => {
    for (const suffix of SUFFIXES) {
        const hit = ICONS[`../../assets/providers/${iconKey}${suffix}`];
        if (hit) return hit;
    }
    return '';
};
