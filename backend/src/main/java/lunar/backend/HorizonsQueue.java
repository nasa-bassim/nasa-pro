package lunar.backend;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/** Bounded, sequential upstream operations. The deadline starts at submission. */
public class HorizonsQueue implements AutoCloseable {
    private static final class Task {
        final Map<String, String> params;
        final CompletableFuture<String> result = new CompletableFuture<>();
        final long deadline;
        boolean started;

        Task(Map<String, String> params, long budgetNanos) {
            this.params = Map.copyOf(params);
            this.deadline = System.nanoTime() + budgetNanos;
        }
    }

    private final BlockingQueue<Task> queue;
    private final UpstreamClient upstream;
    private final long intervalNanos;
    private final long budgetNanos;
    private final ScheduledThreadPoolExecutor expiry;
    private final Thread worker;
    private volatile boolean closed;

    public HorizonsQueue(UpstreamClient upstream, long intervalMillis) {
        this(upstream, intervalMillis, 16, Duration.ofSeconds(120));
    }

    public HorizonsQueue(UpstreamClient upstream, long intervalMillis, int capacity, Duration budget) {
        if (intervalMillis < 0 || capacity < 1 || budget.isNegative() || budget.isZero()) {
            throw new IllegalArgumentException("invalid queue limits");
        }
        this.queue = new ArrayBlockingQueue<>(capacity);
        this.upstream = upstream;
        this.intervalNanos = TimeUnit.MILLISECONDS.toNanos(intervalMillis);
        this.budgetNanos = budget.toNanos();
        this.expiry = new ScheduledThreadPoolExecutor(1, Thread.ofVirtual().factory());
        this.expiry.setRemoveOnCancelPolicy(true);
        this.worker = Thread.ofVirtual().start(this::run);
    }

    public synchronized CompletableFuture<String> submit(Map<String, String> params) {
        if (closed) return CompletableFuture.failedFuture(new QueueFullException());
        Task task = new Task(params, budgetNanos);
        if (!queue.offer(task)) return CompletableFuture.failedFuture(new QueueFullException());
        ScheduledFuture<?> timer = expiry.schedule(() -> {
            // Running calls enforce the remaining budget in the HTTP client.
            // Never release inFlight while that call is still running.
            synchronized (task) {
                if (!task.started) {
                    queue.remove(task);
                    task.result.completeExceptionally(new RequestDeadlineException());
                }
            }
        }, budgetNanos, TimeUnit.NANOSECONDS);
        task.result.whenComplete((value, failure) -> timer.cancel(false));
        return task.result;
    }

    private void run() {
        long lastCallEnd = 0;
        boolean hasCalled = false;
        while (!closed) {
            Task task = null;
            try {
                task = queue.take();
                if (hasCalled) {
                    long wait = intervalNanos - (System.nanoTime() - lastCallEnd);
                    if (wait > 0) TimeUnit.NANOSECONDS.sleep(wait);
                }
                long remaining;
                synchronized (task) {
                    remaining = task.deadline - System.nanoTime();
                    if (task.result.isDone()) continue;
                    if (remaining <= 0) {
                        task.result.completeExceptionally(new RequestDeadlineException());
                        continue;
                    }
                    task.started = true;
                }
                try {
                    String response = upstream.fetch(task.params, Duration.ofNanos(remaining));
                    if (System.nanoTime() - task.deadline >= 0) {
                        task.result.completeExceptionally(new RequestDeadlineException());
                    } else {
                        task.result.complete(response);
                    }
                } catch (Throwable t) {
                    task.result.completeExceptionally(t);
                } finally {
                    lastCallEnd = System.nanoTime();
                    hasCalled = true;
                }
            } catch (InterruptedException e) {
                if (task != null) task.result.completeExceptionally(new QueueFullException());
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    @Override
    public synchronized void close() {
        closed = true;
        worker.interrupt();
        expiry.shutdownNow();
        Task task;
        while ((task = queue.poll()) != null) {
            task.result.completeExceptionally(new QueueFullException());
        }
    }
}
