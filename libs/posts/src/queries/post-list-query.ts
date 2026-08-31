import { MediaType, ProcessingStatus } from '@posts-media/domain';

export type PostSortField = 'createdAt' | 'updatedAt' | 'title';
export type SortOrder = 'asc' | 'desc';

const SORT_FIELDS: readonly PostSortField[] = [
  'createdAt',
  'updatedAt',
  'title',
];
const SORT_ORDERS: readonly SortOrder[] = ['asc', 'desc'];

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * Raw, untrusted post-list query input straight off the HTTP query string
 * (already coerced to primitive types by the request DTO, but not yet
 * bounded, defaulted, or validated against the sort allowlist).
 */
export interface RawPostListQuery {
  readonly page?: number;
  readonly pageSize?: number;
  readonly search?: string;
  readonly mediaType?: MediaType;
  readonly processingStatus?: ProcessingStatus;
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
  readonly includeDeleted?: boolean;
  readonly sortBy?: string;
  readonly sortOrder?: string;
}

/**
 * A fully normalized post-list query (Part I §2.16): page defaults to 1,
 * pageSize defaults to 20 and is clamped to at most 100, sort field/order
 * fall back to a safe allowlisted default instead of ever reaching Prisma
 * with an arbitrary column name.
 */
export interface PostListQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search?: string;
  readonly mediaType?: MediaType;
  readonly processingStatus?: ProcessingStatus;
  readonly createdFrom?: Date;
  readonly createdTo?: Date;
  readonly includeDeleted: boolean;
  readonly sortBy: PostSortField;
  readonly sortOrder: SortOrder;
}

const normalizePage = (page: number | undefined): number =>
  page === undefined || !Number.isInteger(page) || page < 1
    ? DEFAULT_PAGE
    : page;

const normalizePageSize = (pageSize: number | undefined): number => {
  if (pageSize === undefined || !Number.isInteger(pageSize) || pageSize < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(pageSize, MAX_PAGE_SIZE);
};

const normalizeSortBy = (sortBy: string | undefined): PostSortField =>
  SORT_FIELDS.find((field) => field === sortBy) ?? 'createdAt';

const normalizeSortOrder = (sortOrder: string | undefined): SortOrder =>
  SORT_ORDERS.find((order) => order === sortOrder) ?? 'desc';

const normalizeSearch = (search: string | undefined): string | undefined => {
  const trimmed = search?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

export const normalizePostListQuery = (
  raw: RawPostListQuery,
): PostListQuery => ({
  page: normalizePage(raw.page),
  pageSize: normalizePageSize(raw.pageSize),
  ...(normalizeSearch(raw.search) !== undefined
    ? { search: normalizeSearch(raw.search) }
    : {}),
  ...(raw.mediaType !== undefined ? { mediaType: raw.mediaType } : {}),
  ...(raw.processingStatus !== undefined
    ? { processingStatus: raw.processingStatus }
    : {}),
  ...(raw.createdFrom !== undefined ? { createdFrom: raw.createdFrom } : {}),
  ...(raw.createdTo !== undefined ? { createdTo: raw.createdTo } : {}),
  includeDeleted: raw.includeDeleted ?? false,
  sortBy: normalizeSortBy(raw.sortBy),
  sortOrder: normalizeSortOrder(raw.sortOrder),
});
