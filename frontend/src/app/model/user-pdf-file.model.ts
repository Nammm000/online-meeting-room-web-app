/**
 * Mirrors the backend UserPdfFileDTO. `createdAt` arrives as an ISO-8601
 * string (Jackson LocalDateTime); `fileName` is the sanitized original
 * filename — the MinIO object key never leaves the server.
 */
export interface UserPdfFile {
  id: number;
  fileName: string;
  contentType: string;
  fileSize: number;
  createdAt: string;
}
