import { Component, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { take } from 'rxjs';
import { AutoHideScrollbar } from 'directive/auto-hide-scrollbar';
import { getApiErrorMessage } from 'util/api-util';
import { ModalService } from 'service/modal.service';
import { MeetingService } from 'service/meeting.service';
import { LanguageService } from 'service/language.service';
import { GlobalMessages } from 'component/shared/global-constants';
import { customFormattedDate } from 'util/time-util';
import {
  meetingStatusLabel as statusLabel,
  meetingTypeLabel as typeLabel,
} from 'util/meeting-labels';
import type { Meeting } from 'model/meeting.model';

/**
 * Join-by-code form: normalizes the pasted code, looks the meeting up for an
 * inline preview (title, status, host — the joinCode GET is public to any
 * authenticated user) and navigates into the room. Entering is possible in
 * any state; the room itself explains what "not started yet" or "ended"
 * means, and joining only truly seats the caller once the meeting is
 * IN_PROGRESS and unlocked.
 */
@Component({
  selector: 'app-join-meeting',
  imports: [FormsModule, AutoHideScrollbar],
  templateUrl: './join-meeting.html',
  styleUrl: './join-meeting.scss',
})
export class JoinMeeting {
  isVisible = signal(false);

  constructor(
    private modalService: ModalService,
    private meetingService: MeetingService,
    private router: Router,
    protected langService: LanguageService,
  ) {
    effect(() => {
      if (this.modalService.isJoinMeetingVisible()) {
        this.isVisible.set(true);
      }
    });
  }

  readonly code = signal('');
  readonly normalizedCode = computed(() => this.code().trim().toUpperCase());

  readonly finding = signal(false);
  readonly found = signal<Meeting | null>(null);
  readonly findError = signal('');

  readonly canFind = computed(
    () => this.normalizedCode() !== '' && !this.finding(),
  );

  protected readonly customFormattedDate = customFormattedDate;
  protected readonly statusLabel = statusLabel;
  protected readonly typeLabel = typeLabel;

  close(): void {
    this.isVisible.set(false);
    this.modalService.closeJoinMeeting();
    this.resetForm();
  }

  find(): void {
    if (!this.canFind()) {
      return;
    }
    this.finding.set(true);
    this.found.set(null);
    this.findError.set('');
    this.meetingService
      .getByJoinCode(this.normalizedCode())
      .pipe(take(1))
      .subscribe({
        next: (meeting) => {
          this.finding.set(false);
          this.found.set(meeting);
        },
        error: (error) => {
          this.finding.set(false);
          this.findError.set(
            getApiErrorMessage(error, GlobalMessages.genericError),
          );
        },
      });
  }

  enterRoom(): void {
    const meeting = this.found();
    if (meeting === null) {
      return;
    }
    this.router.navigate(['/meetings', meeting.joinCode, 'room']);
    this.close();
  }

  private resetForm(): void {
    this.code.set('');
    this.found.set(null);
    this.findError.set('');
    this.finding.set(false);
  }
}
