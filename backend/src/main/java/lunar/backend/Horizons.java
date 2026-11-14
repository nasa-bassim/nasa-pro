package lunar.backend;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Port of pipeline/src/pipeline/horizons.py: request params and table parsing. */
public final class Horizons {
    public static final String API_URL = "https://ssd.jpl.nasa.gov/api/horizons.api";
    public static final String SUN = "10";
    public static final String EARTH = "399";
    /** Horizons publishes no numeric rate limit, so requests stay sequential and spaced. */
    public static final long REQUEST_INTERVAL_MILLIS = 2000;

    public static final String START = "2026-Nov-01 00:00";
    public static final String STOP = "2027-May-01 00:00";
    public static final String STEP = "1h";

    private static final Pattern ROW = Pattern.compile(
            "^\\s*(\\d{4}-[A-Za-z]{3}-\\d{2} \\d{2}:\\d{2}) (.)(.)\\s+([\\d.]+)\\s+(-?[\\d.]+)\\s*$");
    private static final DateTimeFormatter ROW_TIME =
            DateTimeFormatter.ofPattern("yyyy-MMM-dd HH:mm", Locale.ENGLISH);
    private static final Pattern SIGNATURE = Pattern.compile(
            "\"source\"\\s*:\\s*\"([^\"]+)\".*?\"version\"\\s*:\\s*\"([^\"]+)\"", Pattern.DOTALL);

    private Horizons() {}

    public record Sample(Instant time, double azimuthDeg, double elevationDeg, String flags) {}

    /** Altitude stays 0: a site altitude only matters through terrain, handled elsewhere. */
    public static Map<String, String> requestParams(
            String body, double lonE, double lat, String start, String stop, String step) {
        Map<String, String> p = new LinkedHashMap<>();
        p.put("format", "text");
        p.put("COMMAND", "'" + body + "'");
        p.put("OBJ_DATA", "'NO'");
        p.put("MAKE_EPHEM", "'YES'");
        p.put("EPHEM_TYPE", "'OBSERVER'");
        p.put("CENTER", "'coord@301'");
        p.put("COORD_TYPE", "'GEODETIC'");
        p.put("SITE_COORD", "'" + lonE + "," + lat + ",0'");
        p.put("START_TIME", "'" + start + "'");
        p.put("STOP_TIME", "'" + stop + "'");
        p.put("STEP_SIZE", "'" + step + "'");
        p.put("QUANTITIES", "'4'");
        return p;
    }

    public static List<Sample> parseTable(String text) {
        int start = text.indexOf("$$SOE");
        int end = text.indexOf("$$EOE");
        if (start == -1 || end == -1) {
            int limit = Math.min(300, text.length());
            throw new HorizonsException("no ephemeris table in response: " + text.substring(0, limit));
        }
        List<Sample> samples = new ArrayList<>();
        String[] lines = text.substring(start, end).split("\\R");
        for (int i = 1; i < lines.length; i++) {
            String line = lines[i];
            if (line.isEmpty()) continue;
            Matcher m = ROW.matcher(line);
            if (!m.matches()) {
                throw new HorizonsException("unexpected table row: " + line);
            }
            Instant t = LocalDateTime.parse(m.group(1), ROW_TIME).toInstant(ZoneOffset.UTC);
            String flags = (m.group(2) + m.group(3)).trim();
            samples.add(new Sample(t, Double.parseDouble(m.group(4)), Double.parseDouble(m.group(5)), flags));
        }
        return samples;
    }

    /** The API's own attribution string, e.g. "NASA/JPL Horizons API 1.2". */
    public static String signature(String text) {
        Matcher m = SIGNATURE.matcher(text);
        if (!m.find()) return "NASA/JPL Horizons API";
        return m.group(1) + " " + m.group(2);
    }
}
