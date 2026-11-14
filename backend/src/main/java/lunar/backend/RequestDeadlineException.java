package lunar.backend;

/** Queue wait and upstream execution exhausted the operation's time budget. */
public class RequestDeadlineException extends HorizonsException {
    public RequestDeadlineException() {
        super("Horizons request deadline exceeded");
    }
}
