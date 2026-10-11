import React from 'react';
import { getProviderAppIcon, PROVIDER_APP_ICONS } from '../../../assets/providers/appIcons';

// src/library/suites/bravais/BravaisProviderAvatar.tsx
// fb8（用户实测：首页窄缝的账户入口与平台列表改成 grid 切换器的「图标 / 头像 + 名称」）：已登录的账户显示头像，
// 没有头像时退回平台徽章。徽章与 grid 的切换器 / 登录选择面板是同一份图：有 App 本尊图的平台
// （netease/qq/kugou/bodian/feiniu）直接亮那颗图标（圆形裁切），其余平台（Folium mod 音源）取名称首字、灰底。
// 图与映射都在 src/assets/providers/appIcons.ts（共享的静态资源模块，不是 suite 之间的互相 import），
// 两边改图标时一起改，别在各自组件里再抄一份 providerId → 文件的对照表。

const FALLBACK_BADGE_COLOR = '#52525b';

/** 平台徽章（没有 App 本尊图时，Folium mod 音源这类）：名称首字 + 灰底。 */
export const resolveBravaisProviderBadge = (_providerId: string, name: string) => ({
    label: Array.from(name)[0] ?? '',
    color: FALLBACK_BADGE_COLOR,
});

/** 网页版把 http 的头像换成 https（与 grid 的切换器一致，避免混合内容被拦）；桌面版原样。 */
const resolveAvatarSrc = (url: string) => (typeof window !== 'undefined' && window.electron ? url : url.replace(/^http:/, 'https:'));

/**
 * 头像、平台图标或平台徽章（圆形，尺寸由 className 定）。装饰性的：可访问名由外面的按钮给，这里 aria-hidden。
 * `data-bravais-account-avatar` 标出画的是哪一种（image 是用户头像 / icon 是平台 App 图标 / badge 是文字徽章 /
 * connect 是「连接在线平台」的插头），用例按它判断。
 */
const BravaisProviderAvatar: React.FC<{ providerId: string; name: string; avatarUrl: string | null; className?: string }> = ({
    providerId,
    name,
    avatarUrl,
    className,
}) => {
    if (avatarUrl) {
        return <img className={`bravais-account-avatar${className ? ` ${className}` : ''}`} src={resolveAvatarSrc(avatarUrl)} alt="" aria-hidden
            draggable={false} data-bravais-account-avatar="image" />;
    }
    if (providerId in PROVIDER_APP_ICONS) {
        return <img className={`bravais-account-avatar is-icon${className ? ` ${className}` : ''}`} src={getProviderAppIcon(providerId)} alt="" aria-hidden
            draggable={false} data-bravais-account-avatar="icon" />;
    }
    const badge = resolveBravaisProviderBadge(providerId, name);
    return (
        <span className={`bravais-account-avatar is-badge${className ? ` ${className}` : ''}`} style={{ backgroundColor: badge.color }} aria-hidden
            data-bravais-account-avatar="badge">
            {badge.label}
        </span>
    );
};

export default BravaisProviderAvatar;
