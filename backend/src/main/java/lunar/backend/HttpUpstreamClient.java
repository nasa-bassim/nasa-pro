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

public class HttpUpstreamClient implements UpstreamClient {
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(30))
            .build();
    private final Duration timeout = Duration.ofSeconds(120);

    @Override
    public String fetch(Map<String, String> params) throws Exception {
        return fetch(params, timeout);
    }

    @Override
    public String fetch(Map<String, String> params, Duration remaining) throws Exception {
        if (remaining.isNegative() || remaining.isZero()) throw new RequestDeadlineException();
        Duration limit = remaining.compareTo(timeout) < 0 ? remaining : timeout;
        StringBuilder query = new StringBuilder();
        for (Map.Entry<String, String> e : new TreeMap<>(params).entrySet()) {
            if (query.length() > 0) query.append('&');
            query.append(URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8))
                    .append('=')
                    .append(URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8));
        }
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(Horizons.API_URL + "?" + query))
                .timeout(limit)
                .GET()
                .build();
        HttpResponse<String> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (HttpTimeoutException e) {
            throw new RequestDeadlineException();
        }
        if (response.statusCode() != 200) {
            throw new HorizonsException("Horizons returned HTTP " + response.statusCode());
        }
        return response.body();
    }
}
