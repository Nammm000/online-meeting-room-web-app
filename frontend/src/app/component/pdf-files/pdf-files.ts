import { Component, OnInit, signal } from '@angular/core';
import { take } from 'rxjs';
import { UserPdfFileService } from 'service/user-pdf-file.service';
import { ModalService } from 'service/modal.service';
import { LanguageService } from 'service/language.service';
import type { UserPdfFile } from 'model/user-pdf-file.model';
import { Pagination } from 'component/shared/pagination/pagination';
import { getApiErrorMessage } from 'util/api-util';
import { customFormattedDate } from 'util/time-util';
import { GlobalMessages } from 'component/shared/global-constants';

/** Mirrors the backend's PDF validation (UserPdfFileService limits). */
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 10;

/** Identity of a picked file — dedupes re-adding the same selection. */
function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/** Mirrors the backend's isPdf: MIME first, extension fallback for MIME-less drops. */
function isPdfFile(file: File): boolean {
  if (file.type === 'application/pdf') {
    return true;
  }
  return file.type === '' && file.name.toLowerCase().endsWith('.pdf');
}

/** A file skipped during selection, with the already-localized reason. */
interface RejectedFile {
  name: string;
  reason: string;
}

/**
 * PDF documents page: a drag-and-drop / click-to-browse drop zone collects
 * files (validated against the backend's limits before any request), one
 * multipart POST uploads them together, and the paged table below manages
 * what is already stored — download via a JWT-fetched Blob saved through an
 * invisible anchor, delete behind the shared confirmation modal.
 */
@Component({
  selector: 'app-pdf-files',
  imports: [Pagination],
  templateUrl: './pdf-files.html',
  styleUrl: './pdf-files.scss',
})
export class PdfFiles implements OnInit {
  readonly loading = signal(false);
  readonly errorMessage = signal('');
  readonly rows = signal<UserPdfFile[]>([]);
  readonly page = signal(0);
  readonly totalPages = signal(1);
  readonly pageSize = signal(10);

  // Drop zone highlight — set on dragover, cleared on real leave/drop
  readonly dragOver = signal(false);

  // Selection staged for upload — shared by the picker and the drop zone
  readonly accepted = signal<File[]>([]);
  readonly rejections = signal<RejectedFile[]>([]);

  readonly uploading = signal(false);
  readonly uploadError = signal('');
  readonly uploadSuccess = signal('');

  // The row currently being fetched for download (one at a time)
  readonly downloadingId = signal<number | null>(null);

  constructor(
    private pdfFileService: UserPdfFileService,
    private modalService: ModalService,
    protected langService: LanguageService,
  ) {}

  // Formatting utils for the template
  protected readonly customFormattedDate = customFormattedDate;

  ngOnInit(): void {
    this.load();
  }

  load(page: number = this.page(), size: number = this.pageSize()): void {
    this.loading.set(true);
    this.errorMessage.set('');
    this.pdfFileService
      .getAll(page, size)
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

  // Page indexes are size-dependent — a new size always restarts at page 0
  onPageSizeChange(size: number): void {
    this.load(0, size);
  }

  /** Stages files from the picker or a drop, rejecting what the server would refuse. */
  addFiles(list: FileList | File[]): void {
    const files = Array.from(list);
    if (!files.length) {
      return;
    }
    this.uploadSuccess.set('');
    this.uploadError.set('');
    const accepted = [...this.accepted()];
    const known = new Set(accepted.map(fileKey));
    const rejections: RejectedFile[] = [];
    for (const file of files) {
      const key = fileKey(file);
      if (known.has(key)) {
        rejections.push({
          name: file.name,
          reason: this.langService.t('pdfFiles.duplicate'),
        });
      } else if (!isPdfFile(file)) {
        rejections.push({
          name: file.name,
          reason: this.langService.t('pdfFiles.invalidType'),
        });
      } else if (file.size > MAX_PDF_BYTES) {
        rejections.push({
          name: file.name,
          reason: this.langService.t('pdfFiles.tooLarge'),
        });
      } else if (accepted.length >= MAX_FILES) {
        rejections.push({
          name: file.name,
          reason: this.langService.t('pdfFiles.tooMany'),
        });
      } else {
        accepted.push(file);
        known.add(key);
      }
    }
    this.accepted.set(accepted);
    this.rejections.update((current) => [...current, ...rejections]);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    // Read the selection first, then reset so picking the same file twice
    // re-fires change (avatar gotcha).
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.addFiles(files);
  }

  // preventDefault is what allows the drop at all — without it the browser
  // navigates to the dropped file.
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    // Child elements fire dragleave while the pointer is still inside the
    // zone — only clear when it truly left.
    const zone = event.currentTarget as Node | null;
    const related = event.relatedTarget as Node | null;
    if (!zone || !related || !zone.contains(related)) {
      this.dragOver.set(false);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver.set(false);
    this.addFiles(event.dataTransfer?.files ?? []);
  }

  removePending(index: number): void {
    this.accepted.update((files) => files.filter((_, i) => i !== index));
  }

  upload(): void {
    const files = this.accepted();
    if (!files.length || this.uploading()) {
      return;
    }
    this.uploading.set(true);
    this.uploadError.set('');
    this.uploadSuccess.set('');
    this.pdfFileService
      .upload(files)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.uploading.set(false);
          this.uploadSuccess.set(this.langService.t('pdfFiles.uploaded'));
          this.accepted.set([]);
          this.rejections.set([]);
          this.load(0);
        },
        error: (error) => {
          this.uploading.set(false);
          this.uploadError.set(
            getApiErrorMessage(error, GlobalMessages.genericError),
          );
        },
      });
  }

  download(row: UserPdfFile): void {
    if (this.downloadingId() !== null) {
      return;
    }
    this.downloadingId.set(row.id);
    this.pdfFileService
      .download(row.id)
      .pipe(take(1))
      .subscribe({
        next: (blob) => {
          this.saveBlob(blob, row.fileName);
          this.downloadingId.set(null);
        },
        error: (error) => {
          this.downloadingId.set(null);
          this.errorMessage.set(
            getApiErrorMessage(error, GlobalMessages.genericError),
          );
        },
      });
  }

  /** Saves a JWT-fetched Blob like the avatar bytes: object URL -> anchor click -> revoke. */
  private saveBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    // Give the click a tick to read the URL before revoking it.
    setTimeout(() => URL.revokeObjectURL(url));
  }

  confirmDelete(row: UserPdfFile): void {
    this.modalService.openConfirmation({
      title: this.langService.t('pdfFiles.deleteTitle'),
      message: this.langService.t('pdfFiles.deleteMessage'),
      confirmLabel: this.langService.t('pdfFiles.deleteConfirm'),
      danger: true,
      onConfirm: () => this.deleteFile(row.id),
    });
  }

  private deleteFile(id: number): void {
    this.pdfFileService
      .delete(id)
      .pipe(take(1))
      .subscribe({
        next: () => this.load(),
        error: (error) =>
          this.errorMessage.set(
            getApiErrorMessage(error, GlobalMessages.genericError),
          ),
      });
  }

  protected formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
