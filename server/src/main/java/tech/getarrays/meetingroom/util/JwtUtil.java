package tech.getarrays.meetingroom.util;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Component;
import io.jsonwebtoken.io.Decoders;
import java.security.Key;
import java.util.Calendar;
import java.util.function.Function;
import io.jsonwebtoken.security.Keys;
import tech.getarrays.meetingroom.constants.AuthConstants;
import tech.getarrays.meetingroom.models.User;

import java.security.Key;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Function;

@Component
public class JwtUtil {

    public static final String SECRET = "5367566B59703373367639792F423F4528482B4D6251655468576D5A71347437";

    public String extractUsername(String token) {
        return extractClaim(token, Claims::getSubject);
    }

    public Date extractExpiration(String token) {
        return extractClaim(token, Claims::getExpiration);
    }

    public <T> T extractClaim(String token, Function<Claims, T> claimsResolver) {
        final Claims claims = extractAllClaims(token);
        return claimsResolver.apply(claims);
    }

    public Claims extractAllClaims(String token) {
        return Jwts
                .parserBuilder()
                .setSigningKey(getSignKey())
                .build()
                .parseClaimsJws(token)
                .getBody();
    }

    private Boolean isTokenExpired(String token) {
        return extractExpiration(token).before(new Date());
    }

    public Boolean validateToken(String token, UserDetails userDetails) {
        try {
            final String username = extractUsername(token);
            return (username.equals(userDetails.getUsername()) && !isTokenExpired(token));
        } catch (ExpiredJwtException e) {
            throw e;
        } catch (Exception e) {
            return false;
        }
    }

    public boolean isAccessToken(String token) {
        return AuthConstants.TOKEN_TYPE_ACCESS.equals(extractAllClaims(token).get("typ", String.class));
    }

    public String generateToken(String userName, User.Role role) {
        Map<String, Object> claims = new HashMap<>();
        claims.put("role", role);
        claims.put("typ", AuthConstants.TOKEN_TYPE_ACCESS);
        String token = createToken(claims, userName);
        return token;
    }

    private String createToken(Map<String, Object> claims, String userName) {
        Calendar calendar = Calendar.getInstance();
        calendar.add(Calendar.MINUTE, AuthConstants.ACCESS_TOKEN_EXPIRY_MINUTES);
//        System.out.println("calendar.getTime(): "+calendar.getTime());
//        System.out.println("new Date(System.currentTimeMillis() + 1000*60*60*24): "+(new Date(System.currentTimeMillis() + 1000*60*60*24)));
        return Jwts.builder()
                .setClaims(claims)
                .setSubject(userName)
                .setIssuedAt(new Date(System.currentTimeMillis()))
                .setExpiration(calendar.getTime()) // new Date(System.currentTimeMillis() + 1000*60*60*24)
                .signWith(getSignKey(), SignatureAlgorithm.HS256).compact();
    }

    private Key getSignKey() {
        byte[] keyBytes= Decoders.BASE64.decode(SECRET);
        return Keys.hmacShaKeyFor(keyBytes);
    }
}
