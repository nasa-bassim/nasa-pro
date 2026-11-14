package lunar.backend;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class EphemerisController {
    private final EphemerisService service;

    public EphemerisController(EphemerisService service) {
        this.service = service;
    }

    @GetMapping("/api/ephemeris")
    public Map<String, Object> ephemeris(
            @RequestParam(required = false) Double lat,
            @RequestParam(required = false) Double lon_e,
            @RequestParam(required = false) String body) {
        return service.ephemeris(lat, lon_e, body);
    }
}
