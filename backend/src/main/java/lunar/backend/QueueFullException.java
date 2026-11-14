package lunar.backend;

/** No capacity for another distinct upstream operation. */
public class QueueFullException extends HorizonsException {
    public QueueFullException() {
        super("Horizons queue is full; retry later");
    }
}
