package tech.getarrays.meetingroom.dto.meeting;

/**
 * Everything a client needs to connect to both media planes of a meeting:
 * a short-TTL LiveKit JWT for the video PeerConnection, and the AudioBridge
 * room id + pin for the audio one (join carries {@code id = users.id}).
 * Issued only when the DB says the participant is JOINED and the meeting
 * IN_PROGRESS — tokens are the only door into either server.
 */
public record MediaCredentialsDTO(
        String liveKitUrl,
        String liveKitToken,
        String janusWsUrl,
        Long janusRoomId,
        String janusPin,
        boolean muted) {
}
