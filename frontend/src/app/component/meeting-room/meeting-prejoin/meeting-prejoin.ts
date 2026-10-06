import {
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { take } from 'rxjs';
import { MeetingRoomService } from 'service/meeting-room.service';
import { LanguageService } from 'service/language.service';
import { MediaDevicesService } from 'service/media-devices.service';
import { UserService } from 'service/user.service';
import { meetingStatusLabel as statusLabel } from 'util/meeting-labels';
import type { TranslationKey } from 'i18n/translations';

/**
 * The pre-join screen shown at /meetings/:joinCode/room before the user
 * touches the meeting: room facts (title, join code, status/locked/password
 * badges), the joining identity, device pickers and the camera preview with
 * mic/camera toggles. Meet-style two-column layout — the preview is
 * gesture-first (the camera toggle is the permission prompt, never the screen
 * itself) and the mic choice seeds self-mute once the join lands.
 */
@Component({
  selector: 'app-meeting-prejoin',
  imports: [],
  templateUrl: './meeting-prejoin.html',
  styleUrl: './meeting-prejoin.scss',
})
export class MeetingPrejoin implements OnInit {
  protected readonly roomService = inject(MeetingRoomService);
  protected readonly langService = inject(LanguageService);
  protected readonly devices = inject(MediaDevicesService);
  private readonly userService = inject(UserService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly statusLabel = statusLabel;

  /** The account name — seeded from a rejoin row, then confirmed by /current-user. */
  protected readonly userName = signal('');

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('previewVideo');

  constructor() {
    this.destroyRef.onDestroy(() => this.devices.release());
    // Signals → imperative DOM: the raw preview stream binds straight to the
    // <video> element (it is no LiveKit track, so appVideoTrack does not apply).
    effect(() => {
      const element = this.video()?.nativeElement;
      if (element !== undefined) {
        element.srcObject = this.devices.previewStream();
      }
    });
  }

  ngOnInit(): void {
    this.devices.init();
    const seed = this.roomService.me()?.name;
    if (seed !== undefined && seed !== '') {
      this.userName.set(seed);
    }
    this.userService
      .getCurrentUser()
      .pipe(take(1))
      .subscribe({
        next: (user) => this.userName.set(user.name),
        error: () => undefined, // keep the seed — the initials disc degrades gracefully
      });
  }

  /** Whether the join button says "Rejoin" (previously LEFT/DECLINED). */
  protected isRejoin(): boolean {
    const status = this.roomService.me()?.status;
    return status === 'LEFT' || status === 'DECLINED';
  }

  protected join(): void {
    this.roomService.join();
  }

  protected toggleMic(): void {
    this.devices.toggleMic();
  }

  protected toggleCamera(): void {
    void this.devices.toggleCamera();
  }

  protected onMicChange(event: Event): void {
    this.devices.selectMic((event.target as HTMLSelectElement).value);
  }

  protected onCameraChange(event: Event): void {
    this.devices.selectCamera((event.target as HTMLSelectElement).value);
  }

  protected onSpeakerChange(event: Event): void {
    this.devices.selectSpeaker((event.target as HTMLSelectElement).value);
  }

  /**
   * Whether a device select may list devices: granted, or 'unknown' (no
   * Permissions API — Safari/jsdom) where lists stay as the fallback UI.
   * 'prompt'/'denied' render "No permission" instead, select disabled.
   */
  protected listable(state: PermissionState | 'unknown'): boolean {
    return state === 'granted' || state === 'unknown';
  }

  /**
   * Label fallback: before the camera grant, enumerateDevices hides labels —
   * "Microphone 2" beats an empty option. t() has no interpolation, hence the
   * concatenation here.
   */
  protected deviceLabel(device: MediaDeviceInfo, kindKey: TranslationKey, index: number): string {
    return device.label !== '' ? device.label : `${this.langService.t(kindKey)} ${index + 1}`;
  }

  protected copyJoinCode(): void {
    const code = this.roomService.meeting()?.joinCode;
    if (code) {
      navigator.clipboard?.writeText(code);
    }
  }

  /** Preview avatar-fallback recipe: first letters of the first two words. */
  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('');
  }
}
