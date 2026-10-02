package tech.getarrays.meetingroom.configuration;

import lombok.Getter;
import lombok.Setter;
import org.springframework.context.annotation.Scope;
import org.springframework.stereotype.Component;
import org.springframework.web.context.WebApplicationContext;

@Component
@Scope(value = WebApplicationContext.SCOPE_REQUEST, proxyMode = org.springframework.context.annotation.ScopedProxyMode.TARGET_CLASS)
public class RequestSecurityContext {

    @Getter
    @Setter
    private String username;

    @Getter
    @Setter
    private Long userId;

    @Getter
    @Setter
    private String role;

    @Getter
    @Setter
    private boolean authenticated = false;

    public void clear() {
        this.username = null;
        this.userId = null;
        this.role = null;
        this.authenticated = false;
    }
}
