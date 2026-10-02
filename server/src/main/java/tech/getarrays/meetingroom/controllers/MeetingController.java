package tech.getarrays.meetingroom.controllers;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tech.getarrays.meetingroom.dto.PagedResponseDTO;
import tech.getarrays.meetingroom.dto.meeting.CreateMeetingRequest;
import tech.getarrays.meetingroom.dto.meeting.MeetingDTO;
import tech.getarrays.meetingroom.services.meeting.MeetingService;

/**
 * Meeting lifecycle — creation, the host's list, pre-join metadata, and the
 * start/cancel/end transitions (host-only; state rules in the service layer).
 * Thin by house convention: services throw, AllExceptionHandler renders.
 */
@RestController
@RequestMapping("/meetings")
public class MeetingController {

    private final MeetingService meetingService;

    public MeetingController(MeetingService meetingService) {
        this.meetingService = meetingService;
    }

    @PostMapping
    public ResponseEntity<MeetingDTO> create(@RequestBody CreateMeetingRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(meetingService.create(request));
    }

    @GetMapping("/my")
    public ResponseEntity<PagedResponseDTO<MeetingDTO>> myMeetings(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {
        return ResponseEntity.ok(meetingService.myMeetings(page, size));
    }

    @GetMapping("/{joinCode}")
    public ResponseEntity<MeetingDTO> getByJoinCode(@PathVariable String joinCode) {
        return ResponseEntity.ok(meetingService.getByJoinCode(joinCode));
    }

    @PatchMapping("/{id}/start")
    public ResponseEntity<MeetingDTO> start(@PathVariable Long id) {
        return ResponseEntity.ok(meetingService.start(id));
    }

    @PatchMapping("/{id}/cancel")
    public ResponseEntity<MeetingDTO> cancel(@PathVariable Long id) {
        return ResponseEntity.ok(meetingService.cancel(id));
    }

    @PatchMapping("/{id}/end")
    public ResponseEntity<MeetingDTO> end(@PathVariable Long id) {
        return ResponseEntity.ok(meetingService.end(id));
    }
}
