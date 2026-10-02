package tech.getarrays.meetingroom.repo;

import jakarta.transaction.Transactional;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import tech.getarrays.meetingroom.models.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import tech.getarrays.meetingroom.wrapper.UserWrapper;

import java.util.List;

@Repository
public interface UserRepo extends JpaRepository<User, Long> {
    User findFirstByEmail(@Param("email") String email);

    /**
     * Same as findFirstByEmail but join-fetches the lazy accountLevel, so the
     * real AccountLevel (not an uninitialized Hibernate proxy) is serialized
     * when the wrapper reads it — Jackson cannot introspect the proxy class.
     */
    @Query("select u from User u join fetch u.accountLevel where u.email = :email")
    User findFirstWithAccountLevelByEmail(@Param("email") String email);

    User findFirstByAccountNumber(@Param("accountNumber") String accountNumber);

    List<UserWrapper> getAllUser();

    @Transactional
    @Modifying
    @Query("update User u set u.status = :status where u.id = :id")
    Integer updateStatus(@Param("status") String status, @Param("id") Long id);

    @Transactional
    @Modifying
    @Query("update User w set w.role =:role where w.id=:id")
    Integer updateRole(@Param("role") User.Role role, @Param("id") Long id);
}
