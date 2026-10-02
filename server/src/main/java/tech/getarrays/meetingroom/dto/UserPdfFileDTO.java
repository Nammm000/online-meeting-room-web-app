package tech.getarrays.meetingroom.dto;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class UserPdfFileDTO {

    private Long id;

    private String fileName;

    private String contentType;

    private Long fileSize;

    private LocalDateTime createdAt;
}
