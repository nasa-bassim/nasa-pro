package lunar.backend;

/** Client-supplied parameters failed validation. Maps to HTTP 400. */
public class BadRequestException extends RuntimeException {
    public BadRequestException(String message) {
        super(message);
    }
}
