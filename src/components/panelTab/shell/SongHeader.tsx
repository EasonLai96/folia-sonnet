import React, { useRef } from 'react';
import { Disc } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../../types';
import { getProviderSongMetadata } from '../../../services/onlineMusic/songMetadata';
import { getSizedCoverUrl } from '../../../utils/coverUrl';
import { LikeButton, type SongLike } from './LikeButton';
import { useMeasuredSize } from './useMeasuredSize';

// src/components/panelTab/shell/SongHeader.tsx
// The playing song at the top of the panel. On the cover tab it is the large cover with what the
// caller puts under it (title, artists, album, the row of actions). On every other tab it folds to
// one line: a small cover, title, artist and the heart; a press on that line goes to the cover tab.
// Both forms are in the document at once, so the cover can grow and shrink between them.

/** The height of the folded line, and the side of its cover. */
export const FOLDED_PX = 48;
/**
 * 封面与下面文字块之间的距离（上游 14px）。
 *
 * 这几个尺寸一律用 rem，不用 px —— 界面缩放动的是**根字号**：androidPhoneFit.css 里
 * `html` 的 font-size 跟着 `--folia-ui-scale-*` 走，而 Tailwind 的间距、字号、圆角大多
 * 按 rem 算，于是会跟着一起缩。写死 px 的话，滑条拉到底这两处也一动不动：面板缩了、
 * 封面不缩，比例散掉，按钮就叠到一块去了。
 *
 * 数值按 1rem = 16px 折算，与上游原本的 px 一一对齐。
 */
const COVER_GAP = '0.875rem';
/** The large cover is never lower than this, however short the window. */
const MIN_COVER = '6rem';
/**
 * 整个封面页签（大封面 + 下面那块文字）的高度上限。
 *
 * 上游没有这一道：窗口一高，封面就一路顶到 336px，手机上几乎占掉一屏。留着它 ——
 * 这就是「手机没那么大」要的那一下。
 */
const COVER_TAB_MAX = '20.625rem';
/**
 * 大封面的边长上限。上游取 `100cqw`（整个面板内宽，约 336px），偏大；
 * 现在取内宽的 70%，再封顶（约 208px）。
 */
const COVER_MAX = 'min(70cqw, 13rem)';

type SongHeaderProps = {
    /** The cover tab is open: the large form. */
    isBig: boolean;
    currentSong: SongResult | null;
    coverUrl: string | null;
    like: SongLike;
    /** Goes to the cover tab. */
    onShowCover: () => void;
    /** What stands under the large cover. */
    children: React.ReactNode;
};

const SongHeader: React.FC<SongHeaderProps> = ({ isBig, currentSong, coverUrl, like, onShowCover, children }) => {
    const { t } = useTranslation();
    const underRef = useRef<HTMLDivElement>(null);
    const under = useMeasuredSize(underRef);
    const artists = (currentSong ? getProviderSongMetadata(currentSong).artists : []).map(artist => artist.name).join(' / ');
    /*
     * 回到上游的**两段式**：可用高度（--pn-room）先让出文字块那一截，剩下的全给封面，
     * 页签整高 = 封面 + 文字块两段。
     *
     * 之前为了压矮整个页签，把文字挪去压在封面底边上（页签只剩封面那么高）—— 屏一矮，
     * 封面就缩到下限，文字与下面那排按钮挤在同一条里，于是互相重叠。
     * 改回两段：封面归封面，歌名/歌手和那一排按钮排在它下面，各占各的位置。
     *
     * 上面那几个常量用 rem 而不是 px：界面缩放动的是根字号，rem 会跟着一起缩，
     * px 不会 —— 手机上正是这个「各缩各的」把按钮挤到一块的。
     */
    const underPx = `calc(${COVER_GAP} + ${under.height}px)`;
    const coverHeight = `clamp(${MIN_COVER}, calc(min(var(--pn-room), ${COVER_TAB_MAX}) - ${underPx}), ${COVER_MAX})`;

    return (
        <header
            className="st-t-unfold relative shrink-0 overflow-hidden transition-[height]"
            style={{ height: isBig ? `calc(${coverHeight} + ${underPx})` : FOLDED_PX }}
        >
            {/* The cover is where the lessons about this panel's song buttons point (data-ponder-panel-artwork). */}
            <div
                data-ponder-panel-artwork
                onClick={isBig ? undefined : onShowCover}
                // 与上游一致：铺满面板内宽，高度按可用高度算（见 coverHeight 的注释）。
                className={`st-t-unfold absolute left-0 top-0 grid place-items-center overflow-hidden bg-[var(--st-fill)] transition-[width,height,border-radius] ${isBig ? 'rounded-[10px]' : 'cursor-pointer rounded-lg'}`}
                style={isBig ? { width: '100%', height: coverHeight } : { width: FOLDED_PX, height: FOLDED_PX }}
            >
                {coverUrl ? (
                    <img src={getSizedCoverUrl(coverUrl, 512)} alt="Art" decoding="async" className="h-full w-full object-cover" />
                ) : (
                    <Disc size={isBig ? 40 : 20} className="text-[color:var(--st-t3)]" />
                )}
                <span className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_var(--st-line)]" />
            </div>

            <button
                // A new song's line comes in as a page of the kit does.
                key={currentSong?.id ?? ''}
                type="button"
                onClick={onShowCover}
                inert={isBig}
                className={`st-page-in st-t-move absolute left-[60px] right-11 top-[5px] flex flex-col text-left transition-[opacity,translate] ${isBig ? '-translate-y-1 opacity-0' : ''}`}
            >
                <span className="truncate text-sm font-semibold leading-5">{currentSong?.name || t('ui.noTrack')}</span>
                <span className="truncate text-xs leading-[18px] text-[color:var(--st-t2)]">{artists}</span>
            </button>
            <LikeButton
                like={like}
                className={`st-t-move absolute right-0 top-2 transition-[opacity,translate,visibility] ${isBig ? 'invisible -translate-y-1 opacity-0' : ''}`}
            />

            <div
                ref={underRef}
                inert={!isBig}
                className={`absolute inset-x-1 bottom-0 transition-[opacity,translate,visibility] ${isBig ? 'st-t-move' : 'st-t-fast invisible translate-y-2 opacity-0'}`}
            >
                {children}
            </div>
        </header>
    );
};

export default SongHeader;
