package tech.getarrays.meetingroom.websocket;

import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.util.UriComponentsBuilder;
import tech.getarrays.meetingroom.services.jwt.UserDetailsServiceImpl;
import tech.getarrays.meetingroom.util.JwtUtil;

import java.util.Map;

/**
 * The real auth gate for /ws/notifications. The browser WebSocket API cannot set
 * an Authorization header on the handshake GET, so the access token travels as a
 * {@code ?token=} query param (accepted trade-off: it may appear in access logs)
 * and this interceptor replays JwtRequestFilter's validation sequence:
 * extract username → typ=access check → UserDetails → signature/expiry validation.
 * The security chain permits /ws/** because this interceptor is the gate.
 */
@Slf4j
@Component
public class WebSocketAuthInterceptor implements HandshakeInterceptor {

    private JwtUtil jwtUtil;

    private UserDetailsServiceImpl userDetailsService;

    @Autowired
    public WebSocketAuthInterceptor(JwtUtil theJwtUtil, UserDetailsServiceImpl theUserDetailsService) {
        this.jwtUtil = theJwtUtil;
        this.userDetailsService = theUserDetailsService;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        try {
            String token = UriComponentsBuilder.fromUri(request.getURI())
                    .build()
                    .getQueryParams()
                    .getFirst("token");
            if (token == null || token.isBlank()) {
                return reject(response, "Missing token");
            }
            String username = jwtUtil.extractUsername(token);
            if (!jwtUtil.isAccessToken(token)) {
                return reject(response, "Invalid token");
            }
            UserDetails userDetails = userDetailsService.loadUserByUsername(username);
            if (!jwtUtil.validateToken(token, userDetails)) {
                return reject(response, "Invalid token");
            }
            return true;
        } catch (ExpiredJwtException e) {
            return reject(response, "Token expired");
        } catch (JwtException | IllegalArgumentException | UsernameNotFoundException e) {
            return reject(response, "Invalid token");
        }
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) {
        // nothing to clean up
    }

    private boolean reject(ServerHttpResponse response, String reason) {
        log.debug("Rejecting WebSocket handshake: {}", reason);
        response.setStatusCode(HttpStatus.UNAUTHORIZED);
        return false;
    }
}
