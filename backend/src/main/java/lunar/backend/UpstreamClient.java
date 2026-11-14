package lunar.backend;

import java.util.Map;
import java.time.Duration;

/** One call to the upstream Horizons API. Implementations return the raw text response. */
public interface UpstreamClient {
    String fetch(Map<String, String> params) throws Exception;
    /** Implementations doing network IO must honor this remaining time budget. */
    default String fetch(Map<String, String> params, Duration remaining) throws Exception {
        return fetch(params);
    }
}
