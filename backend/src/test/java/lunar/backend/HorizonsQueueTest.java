package lunar.backend;

import static org.junit.jupiter.api.Assertions.*;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class HorizonsQueueTest {
    private static void failure(CompletableFuture<String> future, Class<?> type) {
        ExecutionException e = assertThrows(ExecutionException.class,
                () -> future.get(3, TimeUnit.SECONDS));
        assertInstanceOf(type, e.getCause());
    }

    @Test
    void fullQueueRejectsImmediatelyAndRecoversAfterDrain() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try (HorizonsQueue q = new HorizonsQueue(params -> {
            started.countDown();
            assertTrue(release.await(3, TimeUnit.SECONDS));
            return "ok";
        }, 0, 1, Duration.ofSeconds(5))) {
            var first = q.submit(Map.of());
            assertTrue(started.await(2, TimeUnit.SECONDS));
            var waiting = q.submit(Map.of());
            var rejected = q.submit(Map.of());
            assertTrue(rejected.isDone());
            failure(rejected, QueueFullException.class);
            release.countDown();
            assertEquals("ok", first.get(2, TimeUnit.SECONDS));
            assertEquals("ok", waiting.get(2, TimeUnit.SECONDS));
            assertEquals("ok", q.submit(Map.of()).get(2, TimeUnit.SECONDS));
        } finally {
            release.countDown();
        }
    }

    @Test
    void queuedDeadlineReleasesCapacityWithoutCallingUpstream() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger calls = new AtomicInteger();
        try (HorizonsQueue q = new HorizonsQueue(params -> {
            calls.incrementAndGet();
            started.countDown();
            assertTrue(release.await(3, TimeUnit.SECONDS));
            return "ok";
        }, 0, 1, Duration.ofMillis(150))) {
            var first = q.submit(Map.of());
            assertTrue(started.await(2, TimeUnit.SECONDS));
            var expired = q.submit(Map.of());
            failure(expired, RequestDeadlineException.class);
            assertEquals(1, calls.get());
            var next = q.submit(Map.of());
            assertFalse(next.isDone(), "expired task must free its queue slot");
            release.countDown();
            failure(first, RequestDeadlineException.class);
            assertEquals("ok", next.get(2, TimeUnit.SECONDS));
            assertEquals(2, calls.get());
        } finally {
            release.countDown();
        }
    }

    @Test
    void requestSpacingCountsAgainstDeadline() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        try (HorizonsQueue q = new HorizonsQueue(params -> {
            calls.incrementAndGet();
            return "ok";
        }, 1000, 2, Duration.ofMillis(100))) {
            assertEquals("ok", q.submit(Map.of()).get(2, TimeUnit.SECONDS));
            failure(q.submit(Map.of()), RequestDeadlineException.class);
            assertEquals(1, calls.get());
        }
    }

    @Test
    void upstreamReceivesOnlyRemainingBudget() throws Exception {
        AtomicReference<Duration> received = new AtomicReference<>();
        UpstreamClient upstream = new UpstreamClient() {
            public String fetch(Map<String, String> params) {
                throw new AssertionError("must use deadline-aware overload");
            }
            public String fetch(Map<String, String> params, Duration remaining) {
                received.set(remaining);
                return "ok";
            }
        };
        try (HorizonsQueue q = new HorizonsQueue(upstream, 50, 2, Duration.ofSeconds(2))) {
            q.submit(Map.of()).get(2, TimeUnit.SECONDS);
            q.submit(Map.of()).get(2, TimeUnit.SECONDS);
            assertTrue(received.get().compareTo(Duration.ofMillis(1980)) < 0);
            assertTrue(received.get().isPositive());
        }
    }

    @Test
    void closeCompletesWaitingRequestsAndRejectsNewOnes() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        try (HorizonsQueue q = new HorizonsQueue(params -> {
            started.countDown();
            new CountDownLatch(1).await();
            return "never";
        }, 0, 2, Duration.ofSeconds(5))) {
            var first = q.submit(Map.of());
            assertTrue(started.await(2, TimeUnit.SECONDS));
            var waiting = q.submit(Map.of());
            q.close();
            failure(waiting, QueueFullException.class);
            assertThrows(ExecutionException.class, () -> first.get(2, TimeUnit.SECONDS));
            failure(q.submit(Map.of()), QueueFullException.class);
        }
    }
}
