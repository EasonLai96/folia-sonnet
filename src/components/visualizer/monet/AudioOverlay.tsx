import React, { useEffect, useRef } from 'react';
import type { AudioBands, MonetAudioStyle, Theme } from '../../../types';
import { colorWithAlpha } from '../colorMix';

// src/components/visualizer/monet/AudioOverlay.tsx
// Renders the bottom audio rail for Monet with a lightweight canvas loop in player mode and a static placeholder in preview mode.
interface AudioOverlayProps {
    audioPower: AudioBands['bass'];
    audioBands: AudioBands;
    theme: Theme;
    mode: MonetAudioStyle;
    staticMode?: boolean;
    isPreviewMode?: boolean;
}

const BAR_COUNT = 72;
const MIN_RAW_SPECTRUM_BIN = 6;

/*
 * 下面这三个常量是「频谱为什么看着不动」的关键，别凭手感往回调。
 *
 * 原值是噪声门 16~28、幂 1.8~2.2、低频补偿 0.52 起。典型音乐下（低频 ~205、中频 ~150）
 * 三道压完只剩 0.15 上下，柱子最高只有画布的 **15%~30%** —— 而静态占位条是 44%。
 * 于是真数据在动、看着却像趴着不动，叠层更惨：它的 128 段在原生那边已经平均过一次，
 * 到这里再平均 + 再压一次，实测只有 14.7%。
 *
 * 所以噪声门压到 8~14、幂压到 1.2~1.55、低频不再砍半（0.86 起），
 * 剩下的交给下面那层自动增益按本帧峰值顶上去。
 */
const NOISE_FLOOR_BASE = 8;
const NOISE_FLOOR_TILT = 6;
const COMPRESSION_BASE = 1.2;
const COMPRESSION_TILT = 0.35;
const LOW_COMPENSATION_BASE = 0.86;
const LOW_COMPENSATION_TILT = 0.5;

/** 自动增益的目标峰值、上限与跟随速度。 */
const GAIN_TARGET = 0.78;
const GAIN_MAX = 4.5;
const GAIN_FOLLOW = 0.06;
/**
 * 低于这个峰值就当**没有音频数据**（采集没起来 / 音频没经过 analyser / 蓝牙不给）。
 *
 * 注意不要设高：安静段落的真实数据本身就是小值，被判成"没数据"会整条变成呼吸波。
 */
const IDLE_PEAK = 0.004;

/**
 * 自动增益的状态。
 *
 * 模块级而不是每实例一份：同一时刻通常只有一处在画，而它必须跨帧连续 ——
 * 放进 effect 里每次重挂载都会从 1 开始爬，切歌/切主题时频谱会先矮半截再长回来。
 */
let spectrumGain = 1;

/**
 * 按本帧峰值把频谱顶到一个稳定高度。
 *
 * 各端给的原始量纲差得远：主应用是 `getByteFrequencyData`（dB 域），
 * 叠层是原生 `Visualizer` 的线性幅度经 `DB_REFERENCE` 换算过来的，
 * 同一首歌两边能差一倍。固定增益不可能同时照顾两端 —— 所以让它跟着峰值走。
 * 静音时不放（见 IDLE_PEAK），否则底噪会被放大成一片抖动。
 */
const resolveSpectrumGain = (peak: number): number => {
    const desired = peak > IDLE_PEAK ? Math.min(GAIN_TARGET / peak, GAIN_MAX) : 1;
    spectrumGain += (desired - spectrumGain) * GAIN_FOLLOW;
    return Math.max(1, Math.min(GAIN_MAX, spectrumGain));
};

const buildSpectrumAnchors = (bands: number[]) => {
    const [bass, lowMid, mid, vocal, treble] = bands;
    return [
        bass * 1.08,
        bass * 0.96,
        bass * 0.74 + lowMid * 0.26,
        lowMid,
        lowMid * 0.58 + mid * 0.42,
        mid,
        mid * 0.42 + vocal * 0.58,
        vocal,
        vocal * 0.48 + treble * 0.52,
        treble,
        treble * 0.82,
    ].map(value => Math.max(0, Math.min(1, value)));
};

const sampleSpectrumProfile = (bands: number[], normalizedIndex: number) => {
    const clampedIndex = Math.max(0, Math.min(1, normalizedIndex));
    const anchors = buildSpectrumAnchors(bands);
    const logIndex = Math.log10(1 + clampedIndex * 9);
    const scaledIndex = logIndex * (anchors.length - 1);
    const lowerIndex = Math.floor(scaledIndex);
    const upperIndex = Math.min(lowerIndex + 1, anchors.length - 1);
    const interpolation = scaledIndex - lowerIndex;
    const lowerValue = anchors[lowerIndex] ?? 0;
    const upperValue = anchors[upperIndex] ?? lowerValue;
    const interpolated = lowerValue + (upperValue - lowerValue) * interpolation;

    // Add a fuller contour so the profile reads like a continuous response curve.
    const contour =
        0.92 +
        Math.sin(clampedIndex * Math.PI * 3.4 - Math.PI * 0.3) * 0.08 +
        Math.sin(clampedIndex * Math.PI * 9.2 + Math.PI * 0.2) * 0.035;
    return Math.max(0, Math.min(1, interpolated * contour));
};

const sampleRawSpectrumProfile = (rawSpectrum: Uint8Array, normalizedIndex: number) => {
    if (rawSpectrum.length <= MIN_RAW_SPECTRUM_BIN) {
        return 0;
    }

    const clampedIndex = Math.max(0, Math.min(1, normalizedIndex));
    const usableBinCount = Math.max(1, rawSpectrum.length - MIN_RAW_SPECTRUM_BIN);
    const mappedIndex = Math.expm1(clampedIndex * Math.log(usableBinCount + 1));
    const centerIndex = MIN_RAW_SPECTRUM_BIN + mappedIndex;
    const edgeSoftness = 1 - Math.abs(clampedIndex - 0.5) * 2;
    const windowRadius = Math.max(1, Math.round(5 - edgeSoftness * 3));
    const start = Math.max(MIN_RAW_SPECTRUM_BIN, Math.floor(centerIndex - windowRadius));
    const end = Math.min(rawSpectrum.length - 1, Math.ceil(centerIndex + windowRadius));

    let weightedSum = 0;
    let weightTotal = 0;
    for (let index = start; index <= end; index += 1) {
        const distance = Math.abs(index - centerIndex);
        const weight = Math.max(0.1, 1 - distance / (windowRadius + 1));
        weightedSum += rawSpectrum[index] * weight;
        weightTotal += weight;
    }

    const averaged = weightTotal > 0 ? weightedSum / weightTotal : 0;

    // Noise floor by frequency: a little more at the low end, where the hum sits.
    const noiseFloor = NOISE_FLOOR_BASE + (1 - clampedIndex) * NOISE_FLOOR_TILT;
    const normalized = Math.max(0, Math.min(1, (averaged - noiseFloor) / (255 - noiseFloor)));

    // Mild compression: still separates peaks from the baseline without flattening them.
    const power = COMPRESSION_BASE + (1 - clampedIndex) * COMPRESSION_TILT;
    const processed = Math.pow(normalized, power);

    const lowFrequencyCompensation = LOW_COMPENSATION_BASE + clampedIndex * LOW_COMPENSATION_TILT;
    const presenceLift = 0.96 + Math.sqrt(clampedIndex) * 0.12;
    return Math.max(0, Math.min(1, processed * lowFrequencyCompensation * presenceLift));
};

const drawStaticBars = (context: CanvasRenderingContext2D, width: number, height: number, theme: Theme, mode: MonetAudioStyle) => {
    context.clearRect(0, 0, width, height);
    context.strokeStyle = colorWithAlpha(theme.primaryColor, 0.96);
    context.fillStyle = colorWithAlpha(theme.primaryColor, 0.9);
    context.lineWidth = 1.5;
    context.lineCap = 'round';

    if (mode === 'line') {
        const points: { x: number; y: number }[] = [];
        for (let index = 0; index < BAR_COUNT; index += 1) {
            const x = (index / (BAR_COUNT - 1)) * width;
            const spectrumIndex = index / (BAR_COUNT - 1);
            const envelope = Math.sin(spectrumIndex * Math.PI);
            const val = 0.12 + (Math.sin(index * 0.35) * 0.5 + 0.5) * 0.42;
            const y = height - (height * val * envelope);
            points.push({ x, y });
        }

        const drawCurve = (ctx: CanvasRenderingContext2D) => {
            if (points.length === 0) return;
            ctx.moveTo(points[0].x, points[0].y);
            for (let i = 0; i < points.length - 1; i++) {
                const xc = (points[i].x + points[i + 1].x) / 2;
                const yc = (points[i].y + points[i + 1].y) / 2;
                ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
            }
            ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        };

        // Fill area under the curve
        context.beginPath();
        drawCurve(context);
        context.lineTo(width, height);
        context.lineTo(0, height);
        context.closePath();
        const fillGradient = context.createLinearGradient(0, 0, 0, height);
        fillGradient.addColorStop(0, colorWithAlpha(theme.primaryColor, 0.24));
        fillGradient.addColorStop(1, colorWithAlpha(theme.primaryColor, 0.0));
        context.fillStyle = fillGradient;
        context.fill();

        // Stroke curve
        context.beginPath();
        drawCurve(context);
        context.strokeStyle = colorWithAlpha(theme.primaryColor, 0.96);
        context.lineWidth = 2.0;
        context.stroke();
        return;
    }

    const gap = width / BAR_COUNT;
    for (let index = 0; index < BAR_COUNT; index += 1) {
        const spectrumIndex = index / (BAR_COUNT - 1);
        const envelope = Math.sin(spectrumIndex * Math.PI);
        const val = 0.12 + (Math.sin(index * 0.35) * 0.5 + 0.5) * 0.42;
        const barHeight = height * (0.02 + val * 0.8 * envelope);
        const x = index * gap + gap * 0.14;
        context.fillRect(x, height - barHeight, Math.max(1.35, gap * 0.34), barHeight);
    }
};

const AudioOverlay: React.FC<AudioOverlayProps> = ({
    audioPower,
    audioBands,
    theme,
    mode,
    staticMode = false,
    isPreviewMode = false,
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        const context = canvas.getContext('2d');
        if (!context) {
            return;
        }

        let frameId = 0;
        let canvasWidth = 0;
        let canvasHeight = 0;
        // 每帧采样一次频谱得到的 72 个值。复用同一份数组：这个循环跑在显示刷新率上，
        // 每帧新建一个是稳定态里最无谓的一笔 GC。
        const profileValues = new Float64Array(BAR_COUNT);

        const resizeCanvas = () => {
            const rect = canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const nextWidth = Math.max(1, Math.floor(rect.width * dpr));
            const nextHeight = Math.max(1, Math.floor(rect.height * dpr));
            canvasWidth = rect.width;
            canvasHeight = rect.height;
            if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
                canvas.width = nextWidth;
                canvas.height = nextHeight;
            }
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        // Both gradients depend only on the canvas size and the theme colour (fixed for this effect
        // run), so they are rebuilt when the size changes rather than on every frame.
        let gradientSize = '';
        let inkGradient: CanvasGradient | null = null;
        let areaGradient: CanvasGradient | null = null;
        const resolveGradients = (width: number, height: number) => {
            const size = `${width}x${height}`;
            if (size !== gradientSize || !inkGradient || !areaGradient) {
                gradientSize = size;
                const primaryInk = colorWithAlpha(theme.primaryColor, 0.94);
                const softInk = colorWithAlpha(theme.primaryColor, 0.72);
                inkGradient = context.createLinearGradient(0, 0, width, 0);
                inkGradient.addColorStop(0, softInk);
                inkGradient.addColorStop(0.5, primaryInk);
                inkGradient.addColorStop(1, softInk);
                areaGradient = context.createLinearGradient(0, 0, 0, height);
                areaGradient.addColorStop(0, colorWithAlpha(theme.primaryColor, 0.24));
                areaGradient.addColorStop(1, colorWithAlpha(theme.primaryColor, 0.0));
            }
            return { gradient: inkGradient, fillGradient: areaGradient };
        };

        const draw = () => {
            const width = canvasWidth;
            const height = canvasHeight;
            if (width <= 0 || height <= 0) {
                return;
            }

            context.clearRect(0, 0, width, height);
            const bands = [
                audioBands.bass.get() / 255,
                audioBands.lowMid.get() / 255,
                audioBands.mid.get() / 255,
                audioBands.vocal.get() / 255,
                audioBands.treble.get() / 255,
            ];
            const rawSpectrum = audioBands.spectrum?.get() ?? new Uint8Array(0);
            const hasRawSpectrum = rawSpectrum.length > MIN_RAW_SPECTRUM_BIN;
            const energy = Math.min(1, Math.max(0.08, audioPower.get() / 255));
            const { gradient, fillGradient } = resolveGradients(width, height);
            context.fillStyle = gradient;
            context.strokeStyle = gradient;
            context.lineWidth = 1.5;
            context.lineCap = 'round';

            // Sampled once per frame, then reused by both shapes below.
            let peak = 0;
            for (let index = 0; index < BAR_COUNT; index += 1) {
                const spectrumIndex = index / (BAR_COUNT - 1);
                const value = hasRawSpectrum
                    ? sampleRawSpectrumProfile(rawSpectrum, spectrumIndex)
                    : sampleSpectrumProfile(bands, spectrumIndex);
                profileValues[index] = value;
                if (value > peak) {
                    peak = value;
                }
            }
            const gain = resolveSpectrumGain(peak);
            /*
             * 一点音频数据都没有（采集没起来 / 声音不在这一层 / 蓝牙不给）时的兜底。
             *
             * 那时柱子会全趴在底边上，看着就像这个功能坏了。给一条极缓的呼吸波，
             * 幅度只有静态占位的一半左右 —— 一眼能看出"现在没有音频"，又不至于像死了。
             * 主应用那边无声时本来就在写呼吸值（usePlaybackVisualizerBridge），这里是同一件事。
             */
            const idleBreath = peak <= IDLE_PEAK;
            const idlePhase = performance.now() * 0.0011;

            if (mode === 'line') {
                const points: { x: number; y: number }[] = [];
                for (let index = 0; index < BAR_COUNT; index += 1) {
                    const x = (index / (BAR_COUNT - 1)) * width;
                    const spectrumIndex = index / (BAR_COUNT - 1);
                    const band = idleBreath
                        ? 0.05 + (Math.sin(index * 0.32 + idlePhase) * 0.5 + 0.5) * 0.13
                        : profileValues[index] * gain;
                    const wave =
                        Math.sin(index * 0.24 + performance.now() * 0.004) * 0.08 +
                        Math.sin(index * 0.68 + performance.now() * 0.0028) * 0.05;

                    const envelope = Math.sin(spectrumIndex * Math.PI);
                    const amplitude = energy * 0.04 + band * 0.8 + wave * 0.04;
                    const y = height - Math.max(0, height * amplitude * envelope);
                    points.push({ x, y });
                }

                const drawCurve = (ctx: CanvasRenderingContext2D) => {
                    if (points.length === 0) return;
                    ctx.moveTo(points[0].x, points[0].y);
                    for (let i = 0; i < points.length - 1; i++) {
                        const xc = (points[i].x + points[i + 1].x) / 2;
                        const yc = (points[i].y + points[i + 1].y) / 2;
                        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
                    }
                    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
                };

                // Fill area under the curve
                context.beginPath();
                drawCurve(context);
                context.lineTo(width, height);
                context.lineTo(0, height);
                context.closePath();
                context.fillStyle = fillGradient;
                context.fill();

                // Stroke top curve
                context.beginPath();
                drawCurve(context);
                context.strokeStyle = gradient;
                context.lineWidth = 2.0;
                context.stroke();
            } else {
                const gap = width / BAR_COUNT;
                for (let index = 0; index < BAR_COUNT; index += 1) {
                    const spectrumIndex = index / (BAR_COUNT - 1);
                    const band = idleBreath
                        ? 0.05 + (Math.sin(index * 0.32 + idlePhase) * 0.5 + 0.5) * 0.13
                        : profileValues[index] * gain;
                    const pulse = Math.sin(index * 0.45 + performance.now() * 0.006) * 0.5 + 0.5;
                    
                    const envelope = Math.sin(spectrumIndex * Math.PI);
                    const barHeight = height * (0.02 + (energy * 0.04 + band * 0.82 + pulse * 0.02) * envelope);
                    const x = index * gap + gap * 0.14;
                    context.fillRect(x, height - barHeight, Math.max(1.35, gap * 0.34), barHeight);
                }
            }
        };

        const handleResize = () => {
            resizeCanvas();
            if ((staticMode || isPreviewMode) && canvasWidth > 0 && canvasHeight > 0) {
                drawStaticBars(context, canvasWidth, canvasHeight, theme, mode);
            }
        };

        resizeCanvas();
        window.addEventListener('resize', handleResize);

        if (staticMode || isPreviewMode) {
            if (canvasWidth > 0 && canvasHeight > 0) {
                drawStaticBars(context, canvasWidth, canvasHeight, theme, mode);
            }
            return () => window.removeEventListener('resize', handleResize);
        }

        const loop = () => {
            draw();
            frameId = window.requestAnimationFrame(loop);
        };

        loop();
        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('resize', handleResize);
        };
    }, [audioBands, audioPower, isPreviewMode, mode, staticMode, theme]);

    return <canvas ref={canvasRef} className="h-full w-full" />;
};

export default AudioOverlay;
