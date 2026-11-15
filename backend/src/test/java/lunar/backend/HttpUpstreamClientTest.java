package lunar.backend;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class HttpUpstreamClientTest {
    @Test
    void stalledBodyTimesOutAndNextQueueRequestSucceeds() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var headersSent = new CountDownLatch(1);
        var releaseBody = new CountDownLatch(1);
        var disconnected = new CountDownLatch(1);
        var calls = new AtomicInteger();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor();
                var http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build()) {
            server.setExecutor(executor);
            server.createContext("/", exchange -> {
                try {
                    if (calls.incrementAndGet() == 1) {
                        exchange.sendResponseHeaders(200, 0);
                        exchange.getResponseBody().write('a');
                        exchange.getResponseBody().flush();
                        headersSent.countDown();
                        releaseBody.await(10, TimeUnit.SECONDS);
                        // A canceled HTTP/1.1 exchange closes its connection.
                        byte[] block = new byte[64 * 1024];
                        for (int i = 0; i < 256; i++) {
                            exchange.getResponseBody().write(block);
                            exchange.getResponseBody().flush();
                        }
                    } else {
                        byte[] body = "healthy".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                        exchange.sendResponseHeaders(200, body.length);
                        exchange.getResponseBody().write(body);
                    }
                } catch (IOException e) {
                    disconnected.countDown();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    exchange.close();
                }
            });
            server.start();
            var client = new HttpUpstreamClient(http,
                    URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/"));
            try (var queue = new HorizonsQueue(client, 0, 2, Duration.ofSeconds(1))) {
                var first = queue.submit(Map.of());
                assertTrue(headersSent.await(2, TimeUnit.SECONDS));
                // The server intentionally does not finish the response body.
                var failure = assertThrows(ExecutionException.class,
                        () -> first.get(3, TimeUnit.SECONDS));
                assertInstanceOf(RequestDeadlineException.class, failure.getCause());
                // The blocked server handler is still alive: recovery must not
                // depend on its finishing or on the body eventually arriving.
                assertEquals("healthy", queue.submit(Map.of()).get(3, TimeUnit.SECONDS));
                releaseBody.countDown();
                assertTrue(disconnected.await(3, TimeUnit.SECONDS), "HTTP transfer was not canceled");
            } finally {
                releaseBody.countDown();
                server.stop(0);
            }
        }
    }

    @Test
    void nonSuccessStatusStillReportsUpstreamFailure() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            exchange.sendResponseHeaders(503, -1);
            exchange.close();
        });
        server.start();
        try (var http = HttpClient.newHttpClient()) {
            var client = new HttpUpstreamClient(http,
                    URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/"));
            var failure = assertThrows(HorizonsException.class,
                    () -> client.fetch(Map.of(), Duration.ofSeconds(2)));
            assertEquals("Horizons returned HTTP 503", failure.getMessage());
        } finally {
            server.stop(0);
        }
    }
}
