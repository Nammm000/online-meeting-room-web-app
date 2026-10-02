/**
 * Mirrors the backend UserImageDTO returned by POST /images/avatar (metadata
 * only — the bytes live in MinIO and are served by GET /images/avatar).
 */
export interface UserImage {
  id: number;
  contentType: string;
  fileSize: number;
}
