package lunar.backend;

/** Upstream call failed or the response could not be parsed. Maps to HTTP 502. */
public class HorizonsException extends RuntimeException {
    public HorizonsException(String message) {
        super(message);
    }

    public HorizonsException(String message, Throwable cause) {
        super(message, cause);
    }
}
