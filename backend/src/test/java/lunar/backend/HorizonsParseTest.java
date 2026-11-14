package lunar.backend;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/** Same reference values as pipeline/tests/test_horizons.py, from the same real fixtures. */
class HorizonsParseTest {
    static final Path FIXTURES = Path.of("..", "pipeline", "tests", "fixtures");

    static List<Horizons.Sample> load(String name) {
        try {
            return Horizons.parseTable(Files.readString(FIXTURES.resolve(name)));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @ParameterizedTest
    @CsvSource({
        "im2_sun.txt,   0, 2026-11-14T00:00:00Z, 97.597,  0.871",
        "im2_sun.txt,   1, 2026-11-22T00:00:00Z,  0.181,  6.756",
        "pole_sun.txt,  0, 2026-11-14T00:00:00Z, 126.620, 1.497",
        "pole_earth.txt,0, 2026-11-14T00:00:00Z, 358.773, -4.548",
    })
    void matchesHorizonsReferenceValues(
            String fixture, int index, String when, double azimuth, double elevation) {
        Horizons.Sample s = load(fixture).get(index);
        assertEquals(Instant.parse(when), s.time());
        assertEquals(azimuth, s.azimuthDeg(), 0.001);
        assertEquals(elevation, s.elevationDeg(), 0.001);
    }

    @Test
    void errorResponseIsRejected() {
        assertThrows(HorizonsException.class, () -> Horizons.parseTable("API ERROR: bad input"));
    }
}
