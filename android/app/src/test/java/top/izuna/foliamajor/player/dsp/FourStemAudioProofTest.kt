package top.izuna.foliamajor.player.dsp

import java.io.File
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import top.izuna.foliamajor.automix.FourStemLocalInput
import top.izuna.foliamajor.automix.FourStemPcmTimeline

// Pure policy tests; no Android extractor, codecs or device are exercised.
class FourStemAudioProofTest {
    @get:Rule val temp = TemporaryFolder()

    @Test fun rejectsNonLocalAndNonPrivateUris() {
        val root = temp.newFolder()
        val privateFile = File(root, "a b.wav").apply { writeText("fixture") }
        assertEquals(privateFile, FourStemLocalInput.privatePath(privateFile.toURI().toString(), root))
        for (uri in listOf("http://example.invalid/a.wav", "content://local/a.wav", "file://host/a.wav",
            temp.newFile().toURI().toString(), privateFile.toURI().toString() + "?other")) {
            assertNull(uri, FourStemLocalInput.privatePath(uri, root))
        }
    }

    @Test fun rejectsUnknownChannelLayoutOffsetsGapsOverlapsAndShortPcm() {
        for (channels in listOf(0, 3, 6)) assertFalse(FourStemPcmTimeline(channels).accept(channels * 2, 0))
        for (channels in 1..2) {
            val timeline = FourStemPcmTimeline(channels)
            val bytes = 441 * channels * 2
            assertFalse(timeline.accept(bytes, 1))
            assertFalse(timeline.accept(bytes - 1, 0))
            assertTrue(timeline.accept(bytes, 0))
            assertFalse(timeline.accept(bytes, 10_023))
            assertFalse(timeline.accept(bytes, 9_977))
            assertFalse(timeline.complete(20_000))
            assertTrue(timeline.accept(bytes, 10_000))
            assertTrue(timeline.complete(20_000))
        }
    }

    @Test fun strictDurationGivesOneCandidateButDoesNotProveActualPcmLength() {
        assertEquals(1024L, FourStemPcmTimeline.framesForDuration(23_219))
        assertEquals(1024L, FourStemPcmTimeline.framesForDuration(23_220))
        assertNull(FourStemPcmTimeline.framesForDuration(23_221))
        assertNull(FourStemPcmTimeline.framesForDuration(Long.MAX_VALUE))
        val tenMinutes = checkNotNull(FourStemPcmTimeline.framesForDuration(600_000_000))
        assertEquals(26_460_000L, tenMinutes)
        assertFalse(FourStemAacTimeline.aligned(tenMinutes))
        val pcm = FourStemPcmTimeline(1)
        assertTrue(pcm.accept(1023 * 2, 0))
        assertFalse(pcm.complete(23_219))
    }

    @Test fun rejectsUnprovenTrimNonAlignedTailUnequalDurationAndMissingOrExtraAacUnits() {
        val timeline = FourStemAacTimeline(2048)
        assertFalse(timeline.allows(46_439, null, null))
        assertFalse(timeline.allows(46_439, 2112, 0))
        assertFalse(timeline.allows(46_439, 0, 1))
        assertFalse(timeline.allows(46_440, 0, 0))
        assertFalse(FourStemAacTimeline(2047).allows(46_417, 0, 0))
        assertTrue(timeline.allows(46_439, 0, 0))
        assertFalse(timeline.accept(1))
        assertTrue(timeline.accept(0))
        assertFalse(timeline.complete())
        assertFalse(timeline.accept(23_221))
        assertTrue(timeline.accept(23_220))
        assertTrue(timeline.complete())
        assertFalse(timeline.accept(46_439))
    }
}
