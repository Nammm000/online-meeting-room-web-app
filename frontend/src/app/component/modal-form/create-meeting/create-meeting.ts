import { Component, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { take } from 'rxjs';
import { AutoHideScrollbar } from 'directive/auto-hide-scrollbar';
import { getApiErrorMessage } from 'util/api-util';
import { ModalService } from 'service/modal.service';
import { MeetingService } from 'service/meeting.service';
import { LanguageService } from 'service/language.service';
import { GlobalMessages } from 'component/shared/global-constants';
import type {
  CreateMeetingRequest,
  Meeting,
  MeetingType,
} from 'model/meeting.model';

/**
 * New-meeting form, mounted permanently and opened by the /meetings page via
 * ModalService. Validation mirrors the backend's manual checks so the user
 * never sees the 400s: title required; SCHEDULED needs both datetime-local
 * stamps with end after start; INSTANT never carries a schedule (the fields
 * are hidden and the values dropped). On 201 the modal hands the meeting to
 * the opener's callback — INSTANT creation means the room is already live
 * (host JOINED, media included), so the page navigates straight in.
 */
@Component({
  selector: 'app-create-meeting',
  imports: [FormsModule, AutoHideScrollbar],
  templateUrl: './create-meeting.html',
  styleUrl: './create-meeting.scss',
})
export class CreateMeeting {
  isVisible = signal(false);

  constructor(
    private modalService: ModalService,
    private meetingService: MeetingService,
    protected langService: LanguageService,
  ) {
    effect(() => {
      if (this.modalService.isCreateMeetingVisible()) {
        this.isVisible.set(true);
      }
    });
  }

  // Form values
  title = signal('');
  description = signal('');
  type = signal<MeetingType>('INSTANT');
  /** datetime-local values: "YYYY-MM-DDTHH:mm", naive local like the backend's LocalDateTime. */
  scheduledStartAt = signal('');
  scheduledEndAt = signal('');
  waitingRoomEnabled = signal(false);
  muteOnEntry = signal(false);
  /** Optional join password (4-100 chars, mirrored server check); blank = open meeting. */
  password = signal('');

  readonly isScheduled = computed(() => this.type() === 'SCHEDULED');

  readonly titleMissing = computed(() => this.title().trim() === '');

  readonly timesMissing = computed(
    () => this.scheduledStartAt() === '' || this.scheduledEndAt() === '',
  );

  readonly endNotAfterStart = computed(() => {
    const start = this.scheduledStartAt();
    const end = this.scheduledEndAt();
    if (start === '' || end === '') {
      return false;
    }
    return Date.parse(end) <= Date.parse(start);
  });

  readonly canSubmit = computed(() => {
    if (this.titleMissing() || this.submitting()) {
      return false;
    }
    if (this.isScheduled()) {
      return !this.timesMissing() && !this.endNotAfterStart();
    }
    return true;
  });

  readonly submitting = signal(false);
  readonly errorMessage = signal('');

  close(): void {
    this.isVisible.set(false);
    this.modalService.closeCreateMeeting();
    this.resetForm();
  }

  submit(): void {
    if (!this.canSubmit()) {
      return;
    }
    const scheduled = this.isScheduled();
    const request: CreateMeetingRequest = {
      title: this.title().trim(),
      description: this.description().trim() || null,
      type: this.type(),
      // INSTANT must not carry a schedule — the backend 400s it.
      scheduledStartAt: scheduled ? this.scheduledStartAt() : null,
      scheduledEndAt: scheduled ? this.scheduledEndAt() : null,
      waitingRoomEnabled: this.waitingRoomEnabled(),
      muteOnEntry: this.muteOnEntry(),
      password: this.password().trim() || null,
    };
    this.submitting.set(true);
    this.errorMessage.set('');
    this.meetingService
      .create(request)
      .pipe(take(1))
      .subscribe({
        next: (meeting: Meeting) => {
          // Notify before close() — closing clears the stored callback.
          this.modalService.notifyMeetingCreated(meeting);
          this.close();
        },
        error: (error) => {
          this.submitting.set(false);
          this.errorMessage.set(
            getApiErrorMessage(error, GlobalMessages.genericError),
          );
        },
      });
  }

  private resetForm(): void {
    this.title.set('');
    this.description.set('');
    this.type.set('INSTANT');
    this.scheduledStartAt.set('');
    this.scheduledEndAt.set('');
    this.waitingRoomEnabled.set(false);
    this.muteOnEntry.set(false);
    this.password.set('');
    this.submitting.set(false);
    this.errorMessage.set('');
  }
}
