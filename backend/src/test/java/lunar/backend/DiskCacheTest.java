package lunar.backend;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DiskCacheTest {
    @TempDir Path dir;

    @Test
    void readersOnlySeeCompleteResponsesDuringReplacement() throws Exception {
        DiskCache cache = new DiskCache(dir);
        String oldText = "a".repeat(1_000_000);
        String newText = "b".repeat(1_000_000);
        cache.put("key", oldText);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        Thread writer = Thread.startVirtualThread(() -> {
            try {
                for (int i = 0; i < 30; i++) cache.put("key", i % 2 == 0 ? newText : oldText);
            } catch (Throwable t) {
                failure.set(t);
            }
        });
        try {
            do {
                String value = cache.get("key");
                assertTrue(oldText.equals(value) || newText.equals(value), "partial cache response");
            } while (writer.isAlive());
        } finally {
            writer.join(10_000);
        }
        assertNull(failure.get());
        try (var files = Files.list(dir)) {
            assertEquals(1, files.count(), "temporary files must be removed");
        }
    }
}
