package lunar.backend;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class BackendConfig {
    @Bean
    UpstreamClient upstreamClient() {
        return new HttpUpstreamClient();
    }
}
