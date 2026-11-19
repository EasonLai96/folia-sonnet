package top.izuna.foliamajor.player.dsp

import top.izuna.foliamajor.automix.FourStemPcmTimeline

// Deliberately only support AAC-LC 1024-sample access units with explicitly zero trim.
internal class FourStemAacTimeline(private val frames: Long) {
    private var seen = 0L

    fun allows(durationUs: Long, delay: Int?, padding: Int?): Boolean =
        aligned(frames) &&
            delay == 0 && padding == 0 && durationUs == frames * 1_000_000L / FourStemPcmTimeline.RATE

    fun accept(ptsUs: Long): Boolean {
        if (seen >= frames || !FourStemPcmTimeline.matchesFrameTime(seen, ptsUs)) return false
        seen += AU_FRAMES
        return true
    }

    fun complete() = seen > 0 && seen == frames

    companion object {
        private const val AU_FRAMES = 1024

        fun aligned(frames: Long) = frames in 1..FourStemPcmTimeline.MAX_FRAMES && frames % AU_FRAMES == 0L
    }
}
