package tech.getarrays.meetingroom.dto;

import lombok.Data;

import java.util.List;

@Data
public class BulkDeleteRequestDTO {

    private List<Long> ids;
}
