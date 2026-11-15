FROM eclipse-temurin:21-jdk AS build
WORKDIR /build/backend
COPY backend/gradlew gradlew
COPY backend/gradle gradle
COPY backend/settings.gradle backend/build.gradle ./
RUN chmod +x gradlew
COPY backend/src src
COPY pipeline/tests/fixtures /build/pipeline/tests/fixtures
RUN ./gradlew --no-daemon test bootJar

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /build/backend/build/libs/backend-0.0.0.jar /app/app.jar
RUN mkdir /app/cache && chown 10001:10001 /app/cache
USER 10001:10001
ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70.0"
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
