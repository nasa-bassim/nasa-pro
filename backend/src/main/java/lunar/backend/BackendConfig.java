package lunar.backend;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.Arrays;

@Configuration
public class BackendConfig {
    @Bean
    WebMvcConfigurer corsConfigurer(@Value("${app.cors.allowed-origins:http://localhost:5173}") String origins) {
        String[] allowed = Arrays.stream(origins.split(","))
                .map(String::trim).filter(s -> !s.isEmpty()).toArray(String[]::new);
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/api/**").allowedOrigins(allowed)
                        .allowedMethods("GET").exposedHeaders("Retry-After");
            }
        };
    }

    @Bean
    UpstreamClient upstreamClient() {
        return new HttpUpstreamClient();
    }
}
