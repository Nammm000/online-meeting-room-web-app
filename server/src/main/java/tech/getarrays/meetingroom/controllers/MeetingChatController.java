package tech.getarrays.meetingroom.controllers;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tech.getarrays.meetingroom.dto.PagedResponseDTO;
import tech.getarrays.meetingroom.dto.meeting.ChatMessageDTO;
import tech.getarrays.meetingroom.dto.meeting.SendChatRequest;
import tech.getarrays.meetingroom.services.meeting.MeetingChatService;
import tech.getarrays.meetingroom.util.MeetingRoomUtils;

@RestController
@RequestMapping("/meetings/{joinCode}/chat")
public class MeetingChatController {

    private final MeetingChatService chatService;

    public MeetingChatController(MeetingChatService chatService) {
        this.chatService = chatService;
    }

    @GetMapping
    public ResponseEntity<PagedResponseDTO<ChatMessageDTO>> getMessages(
            @PathVariable String joinCode,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size) {
        return ResponseEntity.ok(chatService.getMessages(joinCode, page, size));
    }

    @PostMapping
    public ResponseEntity<ChatMessageDTO> send(@PathVariable String joinCode,
                                               @RequestBody SendChatRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(chatService.send(joinCode, request.content(), request.recipientUserId()));
    }

    @DeleteMapping("/{messageId}")
    public ResponseEntity<String> delete(@PathVariable String joinCode, @PathVariable Long messageId) {
        chatService.delete(joinCode, messageId);
        return MeetingRoomUtils.getResponseEntity("Message deleted", HttpStatus.OK);
    }
}
