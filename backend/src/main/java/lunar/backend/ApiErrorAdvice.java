package lunar.backend;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

@RestControllerAdvice
public class ApiErrorAdvice {
    @ExceptionHandler(BadRequestException.class)
    ResponseEntity<Map<String, String>> badRequest(BadRequestException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler({MissingServletRequestParameterException.class,
            MethodArgumentTypeMismatchException.class})
    ResponseEntity<Map<String, String>> badParams(Exception e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("error", "missing or invalid parameters"));
    }

    @ExceptionHandler(QueueFullException.class)
    ResponseEntity<Map<String, String>> overloaded(QueueFullException e) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .header("Retry-After", "2").body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(RequestDeadlineException.class)
    ResponseEntity<Map<String, String>> deadline(RequestDeadlineException e) {
        return ResponseEntity.status(HttpStatus.GATEWAY_TIMEOUT).body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(HorizonsException.class)
    ResponseEntity<Map<String, String>> upstream(HorizonsException e) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of("error", e.getMessage()));
    }
}
