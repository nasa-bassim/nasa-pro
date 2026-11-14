package lunar.backend;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class EphemerisServiceTest {
    static final Path FIXTURES = Path.of("..", "pipeline", "tests", "fixtures");

    @TempDir
    Path cacheDir;

    AtomicInteger calls;
    ConcurrentLinkedQueue<Long> callTimes;
    String canned;

    @BeforeEach
    void setUp() throws IOException {
        calls = new AtomicInteger();
        callTimes = new ConcurrentLinkedQueue<>();
        canned = Files.readString(FIXTURES.resolve("im2_sun.txt"));
    }

    private EphemerisService service(UpstreamClient upstream) {
        return new EphemerisService(new DiskCache(cacheDir), new HorizonsQueue(upstream, 2000));
    }

    private UpstreamClient fakeUpstream() {
        return params -> {
            calls.incrementAndGet();
            callTimes.add(System.currentTimeMillis());
            return canned;
        };
    }

    @Test
    void upstreamCallsAreSpacedAtLeastTwoSeconds() {
        EphemerisService svc = service(fakeUpstream());
        svc.ephemeris(-84.78, 29.13, "sun");
        svc.ephemeris(-84.78, 29.13, "earth");
        List<Long> times = new ArrayList<>(callTimes);
        assertEquals(2, times.size());
        assertTrue(times.get(1) - times.get(0) >= 2000,
                "gap was " + (times.get(1) - times.get(0)) + " ms");
    }

    @Test
    void concurrentRequestsForSameKeyShareOneUpstreamCall() throws Exception {
        CountDownLatch upstreamStarted = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger writes = new AtomicInteger();
        DiskCache cache = new DiskCache(cacheDir) {
            @Override
            public void put(String key, String text) {
                writes.incrementAndGet();
                super.put(key, text);
            }
        };
        try (HorizonsQueue queue = new HorizonsQueue(params -> {
            calls.incrementAndGet();
            upstreamStarted.countDown();
            if (!release.await(5, TimeUnit.SECONDS)) throw new IOException("test timed out");
            return canned;
        }, 0)) {
            EphemerisService svc = new EphemerisService(cache, queue);
            var results = new ConcurrentLinkedQueue<Map<String, Object>>();
            var errors = new ConcurrentLinkedQueue<Throwable>();
            Runnable call = () -> {
                try {
                    results.add(svc.ephemeris(-84.78, 29.13, "sun"));
                } catch (Throwable t) {
                    errors.add(t);
                }
            };
            Thread a = Thread.startVirtualThread(call);
            Thread b = null;
            try {
                assertTrue(upstreamStarted.await(5, TimeUnit.SECONDS));
                b = Thread.startVirtualThread(call);
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
                while (b.getState() != Thread.State.WAITING && System.nanoTime() < deadline) {
                    Thread.sleep(1);
                }
                assertEquals(Thread.State.WAITING, b.getState(), "second caller must overlap");
            } finally {
                release.countDown();
                a.join(10_000);
                if (b != null) b.join(10_000);
            }
            assertTrue(errors.isEmpty(), () -> "errors: " + errors);
            assertEquals(1, calls.get());
            assertEquals(1, writes.get());
            assertEquals(2, results.size());
        }
    }

    @Test
    void cacheHitNeverCallsUpstreamAndRoundsToFourDecimals() {
        EphemerisService svc = service(fakeUpstream());
        svc.ephemeris(-84.78, 29.13, "sun");
        // 29.1300001 rounds to 29.13: same cache key, no second upstream call.
        Map<String, Object> doc = svc.ephemeris(-84.7800001, 29.13, "sun");
        assertEquals(1, calls.get());
        assertEquals("sun", doc.get("body"));
        assertEquals(-84.78, (double) doc.get("lat"), 1e-9);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> samples = (List<Map<String, Object>>) doc.get("samples");
        assertEquals("2026-11-14T00:00:00Z", samples.get(0).get("t"));
        // A fresh service over the same cache dir still hits disk, not upstream.
        EphemerisService svc2 = service(fakeUpstream());
        svc2.ephemeris(-84.78, 29.13, "sun");
        assertEquals(1, calls.get());
    }

    @Test
    void invalidInputIsRejected() {
        EphemerisService svc = service(fakeUpstream());
        assertThrows(BadRequestException.class, () -> svc.ephemeris(-91.0, 0.0, "sun"));
        assertThrows(BadRequestException.class, () -> svc.ephemeris(0.0, 361.0, "sun"));
        assertThrows(BadRequestException.class, () -> svc.ephemeris(0.0, 0.0, "moon"));
        assertThrows(BadRequestException.class, () -> svc.ephemeris(null, 0.0, "sun"));
        assertEquals(0, calls.get());
    }

    @Test
    void upstreamFailureReturns502AndIsNotCached() {
        AtomicInteger n = new AtomicInteger();
        UpstreamClient flaky = params -> {
            n.incrementAndGet();
            throw new IOException("upstream down");
        };
        EphemerisService svc = service(flaky);
        assertThrows(HorizonsException.class, () -> svc.ephemeris(0.0, 0.0, "sun"));
        // Not cached: a healthy upstream on the next try is really called.
        assertThrows(HorizonsException.class, () -> svc.ephemeris(0.0, 0.0, "sun"));
        assertEquals(2, n.get());
    }

    @Test
    void unparseableResponseReturns502AndIsNotCached() {
        UpstreamClient bad = params -> "API ERROR: bad input";
        EphemerisService svc = service(bad);
        assertThrows(HorizonsException.class, () -> svc.ephemeris(0.0, 0.0, "sun"));
        try {
            assertEquals(0, Files.list(cacheDir).count());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Test
    void errorBodyIsNotCachedSoNextRequestCallsUpstreamAgain() {
        AtomicInteger n = new AtomicInteger();
        UpstreamClient bad = params -> {
            n.incrementAndGet();
            return "API ERROR: bad input";
        };
        EphemerisService svc = service(bad);
        assertThrows(HorizonsException.class, () -> svc.ephemeris(0.0, 0.0, "sun"));
        assertThrows(HorizonsException.class, () -> svc.ephemeris(0.0, 0.0, "sun"));
        assertEquals(2, n.get());
    }

    @Test
    void errorBodyThenGoodResponseReturnsDataAndCaches() {
        AtomicInteger n = new AtomicInteger();
        UpstreamClient flaky = params -> {
            if (n.incrementAndGet() == 1) {
                return "API ERROR: bad input";
            }
            return canned;
        };
        EphemerisService svc = service(flaky);
        assertThrows(HorizonsException.class, () -> svc.ephemeris(0.0, 0.0, "sun"));
        Map<String, Object> doc = svc.ephemeris(0.0, 0.0, "sun");
        assertEquals("sun", doc.get("body"));
        assertEquals(2, n.get());
        // The good response was cached: no third upstream call.
        svc.ephemeris(0.0, 0.0, "sun");
        assertEquals(2, n.get());
    }

    @Test
    void diskWriteFailureDoesNotLeaveKeyStuckInFlight() {
        DiskCache failingCache = new DiskCache(cacheDir) {
            @Override
            public void put(String key, String text) {
                throw new UncheckedIOException(new IOException("disk full"));
            }
        };
        AtomicInteger n = new AtomicInteger();
        UpstreamClient upstream = params -> {
            n.incrementAndGet();
            return canned;
        };
        EphemerisService svc = new EphemerisService(failingCache, new HorizonsQueue(upstream, 2000));
        assertThrows(UncheckedIOException.class, () -> svc.ephemeris(0.0, 0.0, "sun"));
        // Key must not be stuck in inFlight: the retry really calls upstream.
        assertThrows(UncheckedIOException.class, () -> svc.ephemeris(0.0, 0.0, "sun"));
        assertEquals(2, n.get());
    }
    @Test
    void cacheBypassesFullQueueAndRejectedKeyCanRetry() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        DiskCache cache = new DiskCache(cacheDir);
        cache.put(EphemerisService.cacheKey("sun", 1.0, 2.0), canned);
        try (HorizonsQueue q = new HorizonsQueue(params -> {
            calls.incrementAndGet();
            started.countDown();
            assertTrue(release.await(5, TimeUnit.SECONDS));
            return canned;
        }, 0, 1, java.time.Duration.ofSeconds(10))) {
            EphemerisService svc = new EphemerisService(cache, q);
            var first = q.submit(Map.of());
            assertTrue(started.await(2, TimeUnit.SECONDS));
            var waiting = q.submit(Map.of());
            assertEquals("sun", svc.ephemeris(1.0, 2.0, "sun").get("body"));
            assertEquals(1, calls.get());
            assertThrows(QueueFullException.class, () -> svc.ephemeris(3.0, 4.0, "sun"));
            release.countDown();
            first.get(2, TimeUnit.SECONDS);
            waiting.get(2, TimeUnit.SECONDS);
            assertEquals("sun", svc.ephemeris(3.0, 4.0, "sun").get("body"));
        } finally {
            release.countDown();
        }
    }

    @Test
    void interruptingOneWaiterDoesNotCancelSharedOperation() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try (HorizonsQueue q = new HorizonsQueue(params -> {
            calls.incrementAndGet();
            started.countDown();
            assertTrue(release.await(5, TimeUnit.SECONDS));
            return canned;
        }, 0)) {
            EphemerisService svc = new EphemerisService(new DiskCache(cacheDir), q);
            var errors = new ConcurrentLinkedQueue<Throwable>();
            Thread a = Thread.startVirtualThread(() -> {
                try { svc.ephemeris(0.0, 0.0, "sun"); }
                catch (Throwable t) { errors.add(t); }
            });
            assertTrue(started.await(2, TimeUnit.SECONDS));
            a.interrupt();
            a.join(2000);
            assertTrue(!a.isAlive());
            assertEquals(1, errors.size());
            release.countDown();
            assertEquals("sun", svc.ephemeris(0.0, 0.0, "sun").get("body"));
            assertEquals(1, calls.get());
        } finally {
            release.countDown();
        }
    }

    @Test
    void configuredQueueLimitsCanBeInjected() {
        new org.springframework.boot.test.context.runner.ApplicationContextRunner()
                .withUserConfiguration(EphemerisService.class, BackendConfig.class)
                .withPropertyValues("ephemeris.cache-dir=" + cacheDir,
                        "ephemeris.queue-capacity=2", "ephemeris.request-timeout=5s")
                .run(context -> {
                    assertTrue(context.getStartupFailure() == null,
                            () -> String.valueOf(context.getStartupFailure()));
                    assertTrue(context.containsBean("ephemerisService"));
                });
    }

}
