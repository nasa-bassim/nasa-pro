package lunar.backend;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** HTTP-level checks: 400 on invalid input, 502 on upstream failure. No network. */
class EphemerisControllerTest {
    static final Path FIXTURES = Path.of("..", "pipeline", "tests", "fixtures");

    @TempDir
    Path cacheDir;

    String canned;
    MockMvc ok;
    MockMvc failing;

    @BeforeEach
    void setUp() throws IOException {
        canned = Files.readString(FIXTURES.resolve("im2_sun.txt"));
        EphemerisController controller = new EphemerisController(
                new EphemerisService(new DiskCache(cacheDir),
                        new HorizonsQueue(params -> canned, 0)));
        EphemerisController broken = new EphemerisController(
                new EphemerisService(new DiskCache(cacheDir.resolve("bad")),
                        new HorizonsQueue(params -> {
                            throw new IOException("down");
                        }, 0)));
        ApiErrorAdvice advice = new ApiErrorAdvice();
        ok = MockMvcBuilders.standaloneSetup(controller).setControllerAdvice(advice).build();
        failing = MockMvcBuilders.standaloneSetup(broken).setControllerAdvice(advice).build();
    }

    @Test
    void validRequestReturnsDocument() throws Exception {
        ok.perform(get("/api/ephemeris")
                        .param("lat", "-84.78")
                        .param("lon_e", "29.13")
                        .param("body", "sun"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.body").value("sun"))
                .andExpect(jsonPath("$.lat").value(-84.78))
                .andExpect(jsonPath("$.samples[0].t").value("2026-11-14T00:00:00Z"));
    }

    @Test
    void invalidInputReturns400Json() throws Exception {
        ok.perform(get("/api/ephemeris").param("lat", "-91").param("lon_e", "0").param("body", "sun"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
        ok.perform(get("/api/ephemeris").param("lat", "0").param("lon_e", "0").param("body", "moon"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
        ok.perform(get("/api/ephemeris").param("lat", "abc").param("lon_e", "0").param("body", "sun"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
        ok.perform(get("/api/ephemeris").param("lat", "0").param("body", "sun"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
    }

    @Test
    void upstreamFailureReturns502Json() throws Exception {
        failing.perform(get("/api/ephemeris").param("lat", "0").param("lon_e", "0").param("body", "sun"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error").exists());
    }
    @Test
    void overloadAndDeadlineHaveDistinctHttpResponses() throws Exception {
        for (HorizonsException error : new HorizonsException[] {
                new QueueFullException(), new RequestDeadlineException() }) {
            try (var q = new HorizonsQueue(params -> { throw error; }, 0)) {
                var svc = new EphemerisService(new DiskCache(cacheDir), q);
                var mvc = MockMvcBuilders.standaloneSetup(new EphemerisController(svc))
                        .setControllerAdvice(new ApiErrorAdvice()).build();
                var result = mvc.perform(get("/api/ephemeris").param("lat", "0")
                        .param("lon_e", "0").param("body", "sun"))
                        .andExpect(status().is(error instanceof QueueFullException ? 503 : 504))
                        .andExpect(jsonPath("$.error").exists());
                if (error instanceof QueueFullException) {
                    result.andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
                            .header().string("Retry-After", "2"));
                }
            }
        }
    }

}
