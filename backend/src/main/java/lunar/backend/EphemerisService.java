package lunar.backend;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class EphemerisService implements AutoCloseable {
    private final DiskCache cache;
    private final HorizonsQueue queue;
    private final ConcurrentHashMap<String, CompletableFuture<String>> inFlight = new ConcurrentHashMap<>();

    @Autowired
    public EphemerisService(
            @Value("${ephemeris.cache-dir:cache}") String cacheDir,
            UpstreamClient upstream,
            @Value("${ephemeris.queue-capacity:16}") int capacity,
            @Value("${ephemeris.request-timeout:120s}") String timeout) {
        this(new DiskCache(java.nio.file.Path.of(cacheDir)),
                new HorizonsQueue(upstream, Horizons.REQUEST_INTERVAL_MILLIS, capacity,
                        org.springframework.boot.convert.DurationStyle.detectAndParse(timeout)));
    }

    /** For tests: inject the queue and cache. */
    EphemerisService(DiskCache cache, HorizonsQueue queue) {
        this.cache = cache;
        this.queue = queue;
    }

    public Map<String, Object> ephemeris(Double lat, Double lonE, String body) {
        if (lat == null || lat < -90 || lat > 90 || lat.isNaN()) {
            throw new BadRequestException("lat must be a number in [-90, 90]");
        }
        if (lonE == null || lonE < -360 || lonE > 360 || lonE.isNaN()) {
            throw new BadRequestException("lon_e must be a number in [-360, 360]");
        }
        if (!"sun".equals(body) && !"earth".equals(body)) {
            throw new BadRequestException("body must be 'sun' or 'earth'");
        }
        double rLat = round4(lat);
        double rLon = round4(lonE);
        String bodyCode = "sun".equals(body) ? Horizons.SUN : Horizons.EARTH;
        Map<String, String> params = Horizons.requestParams(
                bodyCode, rLon, rLat, Horizons.START, Horizons.STOP, Horizons.STEP);
        String key = cacheKey(body, rLat, rLon);

        String text = cache.get(key);
        if (text == null) {
            CompletableFuture<String> candidate = new CompletableFuture<>();
            CompletableFuture<String> future = inFlight.putIfAbsent(key, candidate);
            if (future == null) {
                future = candidate;
                try {
                    // A previous operation may have published after our first miss.
                    String cached = cache.get(key);
                    if (cached != null) {
                        finishLoad(key, candidate, cached, null);
                    } else {
                        queue.submit(params).whenComplete((response, failure) -> {
                            if (failure == null) {
                                try {
                                    Horizons.parseTable(response);
                                    cache.put(key, response);
                                } catch (Throwable t) {
                                    failure = t;
                                }
                            }
                            finishLoad(key, candidate, response, failure);
                        });
                    }
                } catch (Throwable t) {
                    finishLoad(key, candidate, null, t);
                }
            }
            try {
                // The shared operation includes validation and cache publication.
                text = future.get();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new HorizonsException("interrupted waiting for Horizons", e);
            } catch (ExecutionException e) {
                if (e.getCause() instanceof java.io.UncheckedIOException io) throw io;
                throw upstreamFailure(e.getCause());
            }
        }

        List<Horizons.Sample> samples = Horizons.parseTable(text);
        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("site", "custom");
        doc.put("name", "직접 입력 좌표");
        doc.put("body", body);
        doc.put("lat", rLat);
        doc.put("lon_e", rLon);
        doc.put("source", Horizons.signature(text));
        List<Map<String, Object>> rows = new ArrayList<>(samples.size());
        for (Horizons.Sample s : samples) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("t", s.time().toString());
            row.put("az", s.azimuthDeg());
            row.put("el", s.elevationDeg());
            row.put("flags", s.flags());
            rows.add(row);
        }
        doc.put("samples", rows);
        return doc;
    }

    private void finishLoad(String key, CompletableFuture<String> future,
            String text, Throwable failure) {
        // Remove only after publication, and before waking callers so a failed
        // request can retry immediately. Interrupted waiters never remove the task.
        inFlight.remove(key, future);
        if (failure == null) future.complete(text);
        else future.completeExceptionally(failure);
    }

    @jakarta.annotation.PreDestroy
    @Override
    public void close() {
        queue.close();
    }

    static double round4(double v) {
        return BigDecimal.valueOf(v).setScale(4, RoundingMode.HALF_UP).doubleValue();
    }

    static String cacheKey(String body, double lat, double lonE) {
        return body + "|" + lat + "|" + lonE;
    }

    private static HorizonsException upstreamFailure(Throwable cause) {
        if (cause instanceof HorizonsException he) return he;
        String msg = cause == null ? "unknown" : cause.getMessage();
        return new HorizonsException("Horizons request failed: " + msg, cause);
    }
}
