package tech.getarrays.meetingroom.repo;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import tech.getarrays.meetingroom.models.RefreshToken;

import java.util.Optional;

@Repository
public interface RefreshTokenRepo extends JpaRepository<RefreshToken, Long> {

    Optional<RefreshToken> findByToken(String token);

    @Modifying
    @Query("delete from RefreshToken r where r.token = :token")
    Integer deleteByToken(@Param("token") String token);

    @Modifying
    @Query("delete from RefreshToken r where r.user.id = :userId")
    Integer deleteAllByUserId(@Param("userId") Long userId);
}
