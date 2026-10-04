package tech.getarrays.meetingroom.controllers;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tech.getarrays.meetingroom.dto.meeting.JoinRequest;
import tech.getarrays.meetingroom.dto.meeting.HandRequest;
import tech.getarrays.meetingroom.dto.meeting.LockRequest;
import tech.getarrays.meetingroom.dto.meeting.MuteRequest;
import tech.getarrays.meetingroom.dto.meeting.MyMeetingStatusDTO;
import tech.getarrays.meetingroom.dto.meeting.ParticipantDTO;
import tech.getarrays.meetingroom.dto.meeting.RoleRequest;
import tech.getarrays.meetingroom.dto.meeting.ScreenShareRequest;
import tech.getarrays.meetingroom.dto.meeting.SpeakingRequest;
import tech.getarrays.meetingroom.dto.meeting.VideoRequest;
import tech.getarrays.meetingroom.models.meeting.MeetingParticipant.ParticipantRole;
import tech.getarrays.meetingroom.services.meeting.MeetingParticipantService;
import tech.getarrays.meetingroom.util.MeetingRoomUtils;

import java.util.List;

/**
 * Join, lobby, roster, moderation. Plain-string acknowledgements go through
 * {@link MeetingRoomUtils} like every other mutation in the codebase.
 */
@RestController
@RequestMapping("/meetings/{joinCode}")
public class MeetingParticipantController {

    private final MeetingParticipantService participantService;

    public MeetingParticipantController(MeetingParticipantService participantService) {
        this.participantService = participantService;
    }

    @PostMapping("/join")
    public ResponseEntity<MyMeetingStatusDTO> join(@PathVariable String joinCode,
                                                   @RequestBody(required = false) JoinRequest request) {
        return ResponseEntity.ok(participantService.join(joinCode, request == null ? null : request.password()));
    }

    @GetMapping("/me")
    public ResponseEntity<MyMeetingStatusDTO> me(@PathVariable String joinCode) {
        return ResponseEntity.ok(participantService.myStatus(joinCode));
    }

    @PostMapping("/leave")
    public ResponseEntity<String> leave(@PathVariable String joinCode) {
        participantService.leave(joinCode);
        return MeetingRoomUtils.getResponseEntity("Left the meeting", HttpStatus.OK);
    }

    @GetMapping("/lobby")
    public ResponseEntity<List<ParticipantDTO>> lobby(@PathVariable String joinCode) {
        return ResponseEntity.ok(participantService.lobby(joinCode));
    }

    @PostMapping("/lobby/{userId}/admit")
    public ResponseEntity<String> admit(@PathVariable String joinCode, @PathVariable Long userId) {
        participantService.admit(joinCode, userId);
        return MeetingRoomUtils.getResponseEntity("Participant admitted", HttpStatus.OK);
    }

    @PostMapping("/lobby/{userId}/deny")
    public ResponseEntity<String> deny(@PathVariable String joinCode, @PathVariable Long userId) {
        participantService.deny(joinCode, userId);
        return MeetingRoomUtils.getResponseEntity("Participant denied", HttpStatus.OK);
    }

    @GetMapping("/roster")
    public ResponseEntity<List<ParticipantDTO>> roster(@PathVariable String joinCode) {
        return ResponseEntity.ok(participantService.roster(joinCode));
    }

    @PatchMapping("/participants/me/mute")
    public ResponseEntity<String> selfMute(@PathVariable String joinCode, @RequestBody MuteRequest request) {
        participantService.selfMute(joinCode, Boolean.TRUE.equals(request.muted()));
        return MeetingRoomUtils.getResponseEntity("Mute state updated", HttpStatus.OK);
    }

    @PatchMapping("/participants/me/speaking")
    public ResponseEntity<String> selfSpeaking(@PathVariable String joinCode, @RequestBody SpeakingRequest request) {
        participantService.selfSpeaking(joinCode, Boolean.TRUE.equals(request.speaking()));
        return MeetingRoomUtils.getResponseEntity("Speaking state updated", HttpStatus.OK);
    }

    @PatchMapping("/participants/me/hand")
    public ResponseEntity<String> selfHand(@PathVariable String joinCode, @RequestBody HandRequest request) {
        participantService.selfHand(joinCode, Boolean.TRUE.equals(request.handRaised()));
        return MeetingRoomUtils.getResponseEntity("Hand state updated", HttpStatus.OK);
    }

    @PatchMapping("/participants/me/video")
    public ResponseEntity<String> selfVideo(@PathVariable String joinCode, @RequestBody VideoRequest request) {
        participantService.selfVideo(joinCode, Boolean.TRUE.equals(request.videoEnabled()));
        return MeetingRoomUtils.getResponseEntity("Video state updated", HttpStatus.OK);
    }

    @PatchMapping("/participants/me/screen-share")
    public ResponseEntity<String> selfScreenShare(@PathVariable String joinCode,
                                                  @RequestBody ScreenShareRequest request) {
        participantService.selfScreenShare(joinCode, Boolean.TRUE.equals(request.sharing()));
        return MeetingRoomUtils.getResponseEntity("Screen share state updated", HttpStatus.OK);
    }

    @PatchMapping("/participants/{userId}/mute")
    public ResponseEntity<String> muteParticipant(@PathVariable String joinCode,
                                                  @PathVariable Long userId,
                                                  @RequestBody MuteRequest request) {
        participantService.muteParticipant(joinCode, userId, Boolean.TRUE.equals(request.muted()));
        return MeetingRoomUtils.getResponseEntity("Participant mute state updated", HttpStatus.OK);
    }

    @PatchMapping("/participants/{userId}/hand")
    public ResponseEntity<String> handParticipant(@PathVariable String joinCode,
                                                  @PathVariable Long userId,
                                                  @RequestBody HandRequest request) {
        participantService.handParticipant(joinCode, userId, Boolean.TRUE.equals(request.handRaised()));
        return MeetingRoomUtils.getResponseEntity("Participant hand state updated", HttpStatus.OK);
    }

    @PatchMapping("/participants/{userId}/video")
    public ResponseEntity<String> videoParticipant(@PathVariable String joinCode,
                                                   @PathVariable Long userId,
                                                   @RequestBody VideoRequest request) {
        participantService.videoParticipant(joinCode, userId, Boolean.TRUE.equals(request.videoEnabled()));
        return MeetingRoomUtils.getResponseEntity("Participant video state updated", HttpStatus.OK);
    }

    @PatchMapping("/participants/{userId}/screen-share")
    public ResponseEntity<String> stopScreenShare(@PathVariable String joinCode,
                                                  @PathVariable Long userId,
                                                  @RequestBody ScreenShareRequest request) {
        participantService.stopScreenShare(joinCode, userId, Boolean.TRUE.equals(request.sharing()));
        return MeetingRoomUtils.getResponseEntity("Participant screen share stopped", HttpStatus.OK);
    }

    @DeleteMapping("/participants/{userId}")
    public ResponseEntity<String> removeParticipant(@PathVariable String joinCode, @PathVariable Long userId) {
        participantService.removeParticipant(joinCode, userId);
        return MeetingRoomUtils.getResponseEntity("Participant removed", HttpStatus.OK);
    }

    @PatchMapping("/lock")
    public ResponseEntity<String> lock(@PathVariable String joinCode, @RequestBody LockRequest request) {
        participantService.setLocked(joinCode, Boolean.TRUE.equals(request.locked()));
        return MeetingRoomUtils.getResponseEntity("Meeting lock state updated", HttpStatus.OK);
    }

    @PatchMapping("/participants/{userId}/role")
    public ResponseEntity<String> setRole(@PathVariable String joinCode,
                                          @PathVariable Long userId,
                                          @RequestBody RoleRequest request) {
        ParticipantRole role = request.role() == null ? null : request.role();
        participantService.setRole(joinCode, userId, role);
        return MeetingRoomUtils.getResponseEntity("Participant role updated", HttpStatus.OK);
    }
}
