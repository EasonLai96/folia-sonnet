package top.izuna.foliamajor.automix

// Prove a zero-based, native-rate PCM timeline before handing a window to SCNet.
internal class FourStemPcmTimeline(private val channels: Int) {
    var frames = 0L
        private set

    fun accept(size: Int, ptsUs: Long): Boolean {
        if (channels !in 1..2 || size <= 0 || size % (channels * 2) != 0 ||
            !matchesFrameTime(frames, ptsUs)
        ) return false
        val next = frames + size / (channels * 2)
        if (next > MAX_FRAMES) return false
        frames = next
        return true
    }

    fun complete(durationUs: Long) = frames > 0 && matchesFrameTime(frames, durationUs)

    companion object {
        const val RATE = 44_100
        const val MAX_FRAMES = RATE * 30L * 60

        // A strict native-rate timeline can only end at the unique frame count compatible with this duration.
        // This is a necessary condition, not evidence that the extractor will really deliver that many frames.
        fun framesForDuration(durationUs: Long): Long? {
            if (durationUs !in 1..(MAX_FRAMES * 1_000_000L / RATE)) return null
            val nearest = (durationUs * RATE + 500_000) / 1_000_000
            return nearest.takeIf { it > 0 && matchesFrameTime(it, durationUs) }
        }

        // Allow only floor/ceil to the nearest integral timestamp unit, not a whole audio frame.
        fun matchesFrameTime(frames: Long, timeUs: Long): Boolean {
            if (frames !in 0..MAX_FRAMES) return false
            val scaled = frames * 1_000_000L
            return timeUs in (scaled / RATE)..((scaled + RATE - 1) / RATE)
        }
    }
}
