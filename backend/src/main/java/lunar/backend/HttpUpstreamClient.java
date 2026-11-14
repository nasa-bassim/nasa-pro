package lunar.backend;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpTimeoutException;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.TreeMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public class HttpUpstreamClient implements UpstreamClient {
    private final HttpClient http;
    private final URI endpoint;

    public HttpUpstreamClient() {
        this(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(30)).build(),
                URI.create(Horizons.API_URL));
    }

    /** Inject a local endpoint and an explicitly owned HTTP client in tests. */
    HttpUpstreamClient(HttpClient http, URI endpoint) {
        this.http = http;
        this.endpoint = endpoint;
    }
    private final Duration timeout = Duration.ofSeconds(120);

    @Override
    public String fetch(Map<String, String> params) throws Exception {
        return fetch(params, timeout);
    }

    @Override
    public String fetch(Map<String, String> params, Duration remaining) throws Exception {
        if (remaining.isNegative() || remaining.isZero()) throw new RequestDeadlineException();
        Duration limit = remaining.compareTo(timeout) < 0 ? remaining : timeout;
        long started = System.nanoTime();
        StringBuilder query = new StringBuilder();
        for (Map.Entry<String, String> e : new TreeMap<>(params).entrySet()) {
            if (query.length() > 0) query.append('&');
            query.append(URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8))
                    .append('=')
                    .append(URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8));
        }
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(endpoint + "?" + query))
                .timeout(limit)
                .GET()
                .build();
        // ofString completes only after the entire body has arrived. Waiting on
        // this original future bounds body reception too; request.timeout alone
        // does not cover a stalled body after headers have been received.
        var transfer = http.sendAsync(request, HttpResponse.BodyHandlers.ofString());
        HttpResponse<String> response;
        try {
            long budget = limit.toNanos() - (System.nanoTime() - started);
            if (budget <= 0) throw new TimeoutException();
            response = transfer.get(budget, TimeUnit.NANOSECONDS);
        } catch (TimeoutException e) {
            transfer.cancel(true); // Cancel the actual exchange, not a derived future.
            throw new RequestDeadlineException();
        } catch (InterruptedException e) {
            transfer.cancel(true);
            Thread.currentThread().interrupt();
            throw e;
        } catch (ExecutionException e) {
            if (e.getCause() instanceof HttpTimeoutException) throw new RequestDeadlineException();
            if (e.getCause() instanceof Exception failure) throw failure;
            throw new HorizonsException("Horizons HTTP exchange failed", e.getCause());
        }
        if (response.statusCode() != 200) {
            throw new HorizonsException("Horizons returned HTTP " + response.statusCode());
        }
        return response.body();
    }
}
