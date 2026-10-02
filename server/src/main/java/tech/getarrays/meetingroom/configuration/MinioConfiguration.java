package tech.getarrays.meetingroom.configuration;

import io.minio.BucketExistsArgs;
import io.minio.MakeBucketArgs;
import io.minio.MinioClient;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Slf4j
@Configuration
public class MinioConfiguration {

    @Bean
    public MinioClient minioClient(@Value("${app.minio.endpoint}") String endpoint,
                                   @Value("${app.minio.access-key}") String accessKey,
                                   @Value("${app.minio.secret-key}") String secretKey,
                                   @Value("${app.minio.bucket}") String bucket,
                                   @Value("${app.minio.pdf-bucket}") String pdfBucket) {
        MinioClient client = MinioClient.builder()
                .endpoint(endpoint)
                .credentials(accessKey, secretKey)
                .build();
        bootstrapBucket(client, bucket);
        bootstrapBucket(client, pdfBucket);
        return client;
    }

    private void bootstrapBucket(MinioClient client, String bucket) {
        try {
            if (!client.bucketExists(BucketExistsArgs.builder().bucket(bucket).build())) {
                client.makeBucket(MakeBucketArgs.builder().bucket(bucket).build());
                log.info("Created MinIO bucket '{}'", bucket);
            }
        } catch (Exception e) {
            throw new IllegalStateException("Failed to bootstrap MinIO bucket '" + bucket + "': " + e.getMessage(), e);
        }
    }
}
