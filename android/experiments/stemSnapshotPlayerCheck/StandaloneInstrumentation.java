package top.izuna.foliamajor.stemsnapshotplayercheck;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import org.junit.internal.TextListener;
import org.junit.runner.JUnitCore;
import org.junit.runner.Result;
import org.junit.runners.BlockJUnit4ClassRunner;
import top.izuna.foliamajor.player.dsp.FourStemSnapshotPlayerTest;

// Runs the Android lifecycle experiment in this APK's own app process and cache directory.
public final class StandaloneInstrumentation extends Instrumentation {
    private static final int EXPECTED_TESTS = 1;

    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        InstrumentationRegistry.registerInstance(this, arguments == null ? new Bundle() : arguments);
        start();
    }

    @Override public void onStart() {
        Bundle report = new Bundle();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        boolean passed = false;
        try (PrintStream stream = new PrintStream(bytes)) {
            try {
                JUnitCore junit = new JUnitCore();
                junit.addListener(new TextListener(stream));
                Result result = junit.run(new BlockJUnit4ClassRunner(FourStemSnapshotPlayerTest.class));
                report.putInt("runCount", result.getRunCount());
                report.putInt("failureCount", result.getFailureCount());
                report.putInt("ignoreCount", result.getIgnoreCount());
                report.putInt("assumptionFailureCount", result.getAssumptionFailureCount());
                passed = result.wasSuccessful() && result.getRunCount() == EXPECTED_TESTS
                        && result.getIgnoreCount() == 0 && result.getAssumptionFailureCount() == 0;
                if (!passed) stream.println("Expected all " + EXPECTED_TESTS + " tests to pass without skips.");
            } catch (Exception | LinkageError error) {
                error.printStackTrace(stream);
            }
        }
        report.putString("stream", "\n" + bytes);
        finish(passed ? Activity.RESULT_OK : Activity.RESULT_CANCELED, report);
    }
}
