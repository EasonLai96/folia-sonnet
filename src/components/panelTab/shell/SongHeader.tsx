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
 * 给封面留的余量 —— 文字块有多高，就从页签的高度里让出多少。
 *
 * 文字现在压在封面底边上、不再占一行（见 coverHeight 的注释），所以这一项**不是**间距了：
 * 它现在的作用只是让封面别因为文字不再占高就跟着胀大 —— 封面还是原来那一块方的大小。
 */
const COVER_RESERVE_PX = 14;
/** The large cover is never lower than this, however short the window. */
const MIN_COVER_PX = 96;
/**
 * 整个封面页签（大封面 + 下面歌名/歌手/专辑和那一排按钮）的高度上限。
 *
 * 光夹封面自己是不够的：窗口够高时 `calc(var(--pn-room) - underPx)` 一路把封面顶到 `COVER_MAX`，
 * 封面是小了，可整块还是快占满一屏。这里连页签一起封顶 —— 封面在剩下的空间里自适应。
 */
const COVER_TAB_MAX_PX = 330;
/**
 * 大封面的上限。以前是 `100cqw`（整个面板内宽）—— 面板一宽，封面就顶到两边，
 * 一屏里几乎只剩封面。现在取内宽的 70%，再封顶 260px：还是那块方的，只是小一圈。
 */
const COVER_MAX = 'min(70cqw, 260px)';

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
     * 文字改成**叠在**封面底边，不再另占一行。
     *
     * 以前 header 是「封面 + 下面整块文字」两段高：封面是个居中的方块（左右各留一块空白），
     * 文字再独占下面一条 —— 于是封面左右那两块、加上封面与文字之间那一整条，看着全是空的。
     *
     * 现在文字压在封面底边上、**横跨整个内宽**，顺手把封面左右那两块空白一起占掉；header
     * 也就只有封面那么高了。
     *
     * 封面自己**不跟着变大**：下面那块的高度照旧从页签高度里让出去（COVER_RESERVE_PX +
     * 文字实测高度），不然文字一不占行，封面就顶上去把整屏撑满。
     */
    const reservedPx = COVER_RESERVE_PX + under.height;
    const coverHeight = `clamp(${MIN_COVER_PX}px, calc(min(var(--pn-room), ${COVER_TAB_MAX_PX}px) - ${reservedPx}px), ${COVER_MAX})`;

    return (
        <header
            className="st-t-unfold relative shrink-0 overflow-hidden transition-[height]"
            style={{ height: isBig ? coverHeight : FOLDED_PX }}
        >
            {/* The cover is where the lessons about this panel's song buttons point (data-ponder-panel-artwork). */}
            <div
                data-ponder-panel-artwork
                onClick={isBig ? undefined : onShowCover}
                // 大封面不再铺满内宽：宽高都取 coverHeight（那块方的边长），左右 auto 居中。
                // 折叠成一行时仍旧靠左。
                className={`st-t-unfold absolute top-0 grid place-items-center overflow-hidden bg-[var(--st-fill)] transition-[width,height,border-radius] ${isBig ? 'left-0 right-0 mx-auto rounded-[10px]' : 'left-0 cursor-pointer rounded-lg'}`}
                style={isBig ? { width: coverHeight, height: coverHeight } : { width: FOLDED_PX, height: FOLDED_PX }}
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
                // 压在封面底边上、横跨整个内宽（见上面 coverHeight 的注释）。字直接落在画面上，
                // 深浅封面都可能，所以带一层阴影；底下再垫一条向上的渐变，别让字糊在亮画面里。
                className={`st-t-move absolute inset-x-1 bottom-0 transition-[opacity,translate,visibility] ${isBig ? '' : 'st-t-fast invisible translate-y-2 opacity-0'}`}
                style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}
            >
                <span className="pointer-events-none absolute inset-x-0 bottom-0 top-[-8px] bg-gradient-to-t from-black/45 to-transparent" aria-hidden />
                <div className="relative">{children}</div>
            </div>
        </header>
    );
};

export default SongHeader;
