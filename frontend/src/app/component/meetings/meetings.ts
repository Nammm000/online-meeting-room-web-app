import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { take } from 'rxjs';
import { MeetingService } from 'service/meeting.service';
import { ModalService } from 'service/modal.service';
import { LanguageService } from 'service/language.service';
import type { Meeting } from 'model/meeting.model';
import { Pagination } from 'component/shared/pagination/pagination';
import { getApiErrorMessage } from 'util/api-util';
import { customFormattedDate } from 'util/time-util';
import {
  meetingStatusLabel as statusLabel,
  meetingTypeLabel as typeLabel,
} from 'util/meeting-labels';
import { GlobalMessages } from 'component/shared/global-constants';

/**
 * Meetings the caller hosts (GET /meetings/my is host-scoped by design —
 * joining happens by code, not from a list). Row actions follow the meeting
 * state machine: SCHEDULED offers Start (the response carries the host's
 * media credentials, so it navigates straight into the room) and Cancel;
 * IN_PROGRESS offers End; every state keeps Enter room — an ENDED room is a
 * read-only view with its chat history. Lifecycle transitions use the
 * internal numeric id the list rows carry; everything else in the app
 * addresses meetings by joinCode.
 */
@Component({
  selector: 'app-meetings',
  imports: [Pagination],
  templateUrl: './meetings.html',
  styleUrl: './meetings.scss',
})
export class Meetings implements OnInit {
  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly rows = signal<Meeting[]>([]);
  readonly page = signal(0);
  readonly totalPages = signal(1);
  readonly pageSize = signal(10);

  // The row with a lifecycle transition in flight (one at a time)
  readonly actingId = signal<number | null>(null);

  // "Join code copied" feedback under the toolbar
  readonly copiedCode = signal('');

  constructor(
    private meetingService: MeetingService,
    private modalService: ModalService,
    private router: Router,
    protected langService: LanguageService,
  ) {}

  // Formatting utils for the template
  protected readonly customFormattedDate = customFormattedDate;
  protected readonly statusLabel = statusLabel;
  protected readonly typeLabel = typeLabel;

  ngOnInit(): void {
    this.load();
  }

  load(page: number = this.page(), size: number = this.pageSize()): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.meetingService
      .getMyMeetings(page, size)
      .pipe(take(1))
      .subscribe({
        next: (response) => {
          this.rows.set(response.content);
          this.page.set(response.page);
          this.pageSize.set(response.size);
          this.totalPages.set(response.totalPages);
          this.loading.set(false);
        },
        error: (error) => {
          this.errorMessage.set(
            getApiErrorMessage(error, GlobalMessages.genericError),
          );
          this.loading.set(false);
        },
      });
  }

  onPageSizeChange(size: number): void {
    this.load(0, size);
  }

  openCreateModal(): void {
    this.modalService.openCreateMeeting((meeting) => this.onCreated(meeting));
  }

  private onCreated(meeting: Meeting): void {
    if (meeting.status === 'IN_PROGRESS') {
      // INSTANT creation seats the host JOINED and returns media — go straight in.
      this.router.navigate(['/meetings', meeting.joinCode, 'room']);
    } else {
      this.load(0);
    }
  }

  openJoinModal(): void {
    this.modalService.openJoinMeeting();
  }

  enterRoom(row: Meeting): void {
    this.router.navigate(['/meetings', row.joinCode, 'room']);
  }

  copyJoinCode(row: Meeting): void {
    navigator.clipboard?.writeText(row.joinCode).then(
      () => {
        this.copiedCode.set(row.joinCode);
        setTimeout(() => {
          if (this.copiedCode() === row.joinCode) {
            this.copiedCode.set('');
          }
        }, 2000);
      },
      () => this.copiedCode.set(''),
    );
  }

  start(row: Meeting): void {
    if (this.actingId() !== null) {
      return;
    }
    this.actingId.set(row.id);
    this.errorMessage.set('');
    this.meetingService
      .start(row.id)
      .pipe(take(1))
      .subscribe({
        next: (meeting) => {
          this.actingId.set(null);
          // The started meeting carries the host's media credentials.
          this.router.navigate(['/meetings', meeting.joinCode, 'room']);
        },
        error: (error) => {
          this.actingId.set(null);
          this.errorMessage.set(
            getApiErrorMessage(error, GlobalMessages.genericError),
          );
        },
      });
  }

  confirmCancel(row: Meeting): void {
    this.modalService.openConfirmation({
      title: this.langService.t('meetings.cancelTitle'),
      message: this.langService.t('meetings.cancelMessage'),
      confirmLabel: this.langService.t('meetings.cancelConfirm'),
      danger: true,
      onConfirm: () => this.transition(row, 'cancel'),
    });
  }

  confirmEnd(row: Meeting): void {
    this.modalService.openConfirmation({
      title: this.langService.t('meetings.endTitle'),
      message: this.langService.t('meetings.endMessage'),
      confirmLabel: this.langService.t('meetings.endConfirm'),
      danger: true,
      onConfirm: () => this.transition(row, 'end'),
    });
  }

  private transition(
    row: Meeting,
    action: 'cancel' | 'end',
  ): void {
    if (this.actingId() !== null) {
      return;
    }
    this.actingId.set(row.id);
    this.errorMessage.set('');
    this.meetingService[action](row.id)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.actingId.set(null);
          this.load();
        },
        error: (error) => {
          this.actingId.set(null);
          this.errorMessage.set(
            getApiErrorMessage(error, GlobalMessages.genericError),
          );
        },
      });
  }
}
