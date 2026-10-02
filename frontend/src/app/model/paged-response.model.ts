/** Query params accepted by the backend's paged list endpoints. */
export interface PageParams {
  page?: number;
  size?: number;
}

/** Mirrors the backend PagedResponseDTO<T>. */
export interface PagedResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
}
