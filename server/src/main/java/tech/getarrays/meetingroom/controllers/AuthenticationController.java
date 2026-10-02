package tech.getarrays.meetingroom.controllers;

import com.google.common.base.Strings;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.bind.annotation.*;

import tech.getarrays.meetingroom.constants.AssetConstants;
import tech.getarrays.meetingroom.constants.AuthConstants;
import tech.getarrays.meetingroom.dto.Auth.AuthenticationDTO;
import tech.getarrays.meetingroom.dto.Auth.AuthenticationResponse;
import tech.getarrays.meetingroom.dto.Auth.LogoutResponse;
import tech.getarrays.meetingroom.dto.Auth.SignupDTO;
import tech.getarrays.meetingroom.dto.UserDTO;
import tech.getarrays.meetingroom.exception.InvalidTokenException;
import tech.getarrays.meetingroom.models.User;
import tech.getarrays.meetingroom.repo.UserRepo;
import tech.getarrays.meetingroom.services.auth.auth.AuthService;
import tech.getarrays.meetingroom.services.auth.RefreshCookieService;
import tech.getarrays.meetingroom.services.auth.refreshToken.RefreshTokenService;
import tech.getarrays.meetingroom.services.auth.TokenPair;
import tech.getarrays.meetingroom.services.jwt.UserDetailsServiceImpl;
import tech.getarrays.meetingroom.util.EmailUtil;
import tech.getarrays.meetingroom.util.MeetingRoomUtils;
import tech.getarrays.meetingroom.util.JwtUtil;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;

import java.io.IOException;
import java.util.Map;
import java.util.Objects;

@Slf4j
@RestController
@RequestMapping("/auth")
public class AuthenticationController {

    private JwtUtil jwtUtil;

    private AuthenticationManager authenticationManager;

    private UserDetailsServiceImpl userDetailsService;

    private AuthService authService;

    private RefreshTokenService refreshTokenService;

    private RefreshCookieService refreshCookieService;

    private EmailUtil emailUtil;

    private UserRepo userRepo;

    @Autowired
    public AuthenticationController(JwtUtil jwtUtil,
                                    AuthenticationManager authenticationManager,
                                    UserDetailsServiceImpl userDetailsService,
                                    AuthService authService,
                                    RefreshTokenService refreshTokenService,
                                    RefreshCookieService refreshCookieService,
                                    EmailUtil emailUtil,
                                    UserRepo userRepo) {
        this.jwtUtil = jwtUtil;
        this.authenticationManager = authenticationManager;
        this.userDetailsService = userDetailsService;
        this.authService = authService;
        this.refreshTokenService = refreshTokenService;
        this.refreshCookieService = refreshCookieService;
        this.emailUtil = emailUtil;
        this.userRepo = userRepo;
    }

    @PostMapping("/login")
    public AuthenticationResponse login(@RequestBody AuthenticationDTO authenticationDTO,
                                        HttpServletResponse response)
            throws BadCredentialsException, DisabledException, UsernameNotFoundException, IOException {
        log.info("Start login {}", authenticationDTO.getEmail());
        try {
            authenticationManager.authenticate(new UsernamePasswordAuthenticationToken(authenticationDTO.getEmail(), authenticationDTO.getPassword()));
        } catch (BadCredentialsException e) {
            throw new BadCredentialsException("Incorrect username or password!");
        } catch (DisabledException disabledException) {
            response.sendError(HttpServletResponse.SC_NOT_FOUND, "User is not activated");
            return null;
        }

        String email = authenticationDTO.getEmail();
        final UserDetails userDetails = userDetailsService.loadUserByUsername(email);
        final User user = userRepo.findFirstByEmail(email);
        final User.Role role = user.getRole();
        final String jwt = jwtUtil.generateToken(userDetails.getUsername(), role);
        final String refreshToken = refreshTokenService.createToken(user);

        refreshCookieService.write(response, refreshToken);
        return new AuthenticationResponse(jwt);
    }

    @PostMapping("/signup")
    public ResponseEntity<?> signupUser(@RequestBody SignupDTO signupDTO, HttpServletResponse response) {
        log.info("Start signupUser {}", signupDTO.getEmail());
        UserDTO createdUser = authService.createUser(signupDTO);
        if (createdUser == null) {
            return new ResponseEntity<>("User not created, come again later!", HttpStatus.BAD_REQUEST);
        }
        User user = userRepo.findFirstByEmail(createdUser.getEmail());
        refreshCookieService.write(response, refreshTokenService.createToken(user));
        return new ResponseEntity<>(
                new AuthenticationResponse(jwtUtil.generateToken(user.getEmail(), user.getRole())),
                HttpStatus.CREATED);
    }

    /**
     * Cookie-authenticated: the HttpOnly refresh cookie is both the credential and the
     * token to rotate. A missing/expired/unknown cookie is a 401 so the client treats it
     * as "no session"; the cookie is also cleared on failure so a stale one never lingers.
     */
    @PostMapping("/refresh")
    public AuthenticationResponse refresh(
            @CookieValue(name = AuthConstants.REFRESH_TOKEN_COOKIE, required = false) String refreshToken,
            HttpServletResponse response) {
        if (refreshToken == null || refreshToken.isBlank()) {
            throw new InvalidTokenException("Invalid refresh token");
        }
        try {
            TokenPair pair = refreshTokenService.rotate(refreshToken);
            refreshCookieService.write(response, pair.refreshToken());
            return new AuthenticationResponse(pair.accessToken());
        } catch (InvalidTokenException e) {
            refreshCookieService.clear(response);
            throw e;
        }
    }

    @PostMapping("/logout")
    public LogoutResponse logout(
            @CookieValue(name = AuthConstants.REFRESH_TOKEN_COOKIE, required = false) String refreshToken,
            HttpServletResponse response) {
        log.info("User {} logout ", SecurityContextHolder.getContext().getAuthentication().getName());
        SecurityContextHolder.clearContext();
        refreshCookieService.clear(response);
        refreshTokenService.revoke(refreshToken);
        return new LogoutResponse("Logout OK");
    }

    @PostMapping("/forgot-password")
    public ResponseEntity<String> forgotPassword(@RequestBody Map<String, String> requestMap) {
        log.info("User {} forgotPassword ", requestMap.get("email"));
        try {
            String email = requestMap.get("email");
            User user = userRepo.findFirstByEmail(email);
            if (!Objects.isNull(user) && !Strings.isNullOrEmpty(user.getEmail())) {
                emailUtil.forgetMail(email, "Credentials by Asset Management System", user.getPasswordHash());
                return MeetingRoomUtils.getResponseEntity("Check Your mail for Credentials", HttpStatus.OK);
            } else if (Objects.isNull(user)) {
                return MeetingRoomUtils.getResponseEntity("Check your mail for credentials.", HttpStatus.OK);
            }
        } catch (Exception ex) {
            ex.printStackTrace();
        }
        return MeetingRoomUtils.getResponseEntity(AssetConstants.SOMETHING_WENT_WRONG, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    @PostMapping("/change-password")
    public ResponseEntity<String> changePassword(@RequestBody Map<String, String> requestMap,
                                                 HttpServletResponse response) {
        try {
            String currentUserEmail = SecurityContextHolder.getContext().getAuthentication().getName();
            User user = userRepo.findFirstByEmail(currentUserEmail);
            if (!Objects.isNull(user)) {
                final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
                if (passwordEncoder.matches(requestMap.get("oldPassword"), user.getPasswordHash())) {
                    user.setPasswordHash(new BCryptPasswordEncoder().encode(requestMap.get("newPassword")));
                    userRepo.save(user);
                    refreshTokenService.deleteAllByUserId(user.getId());
                    // All sessions are revoked — the browser's refresh cookie must go too.
                    refreshCookieService.clear(response);
                    return MeetingRoomUtils.getResponseEntity("Password Updated Successfully", HttpStatus.OK);
                }
                return MeetingRoomUtils.getResponseEntity("Incorrect Old Password", HttpStatus.BAD_REQUEST);
            }
            return MeetingRoomUtils.getResponseEntity(AssetConstants.SOMETHING_WENT_WRONG, HttpStatus.INTERNAL_SERVER_ERROR);
        } catch (Exception ex) {
            ex.printStackTrace();
        }
        return MeetingRoomUtils.getResponseEntity(AssetConstants.SOMETHING_WENT_WRONG, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    @GetMapping("/hello")
    public String hello() {
        return "Hello";
    }
}
