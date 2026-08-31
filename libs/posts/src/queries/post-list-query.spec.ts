import { MediaType, ProcessingStatus } from '@posts-media/domain';

import { normalizePostListQuery } from './post-list-query';

describe('normalizePostListQuery', () => {
  it('applies the default page, pageSize, sort, and includeDeleted', () => {
    expect(normalizePostListQuery({})).toEqual({
      page: 1,
      pageSize: 20,
      includeDeleted: false,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
  });

  it('clamps pageSize to the maximum of 100', () => {
    expect(normalizePostListQuery({ pageSize: 500 }).pageSize).toBe(100);
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'falls back to page 1 for an invalid page value %p',
    (page) => {
      expect(normalizePostListQuery({ page }).page).toBe(1);
    },
  );

  it.each([0, -1, 1.5, Number.NaN])(
    'falls back to the default pageSize for an invalid value %p',
    (pageSize) => {
      expect(normalizePostListQuery({ pageSize }).pageSize).toBe(20);
    },
  );

  it('rejects a non-allowlisted sortBy and falls back to createdAt', () => {
    expect(
      normalizePostListQuery({ sortBy: 'id; DROP TABLE "Post";--' }).sortBy,
    ).toBe('createdAt');
  });

  it('accepts every allowlisted sortBy field', () => {
    expect(normalizePostListQuery({ sortBy: 'title' }).sortBy).toBe('title');
    expect(normalizePostListQuery({ sortBy: 'updatedAt' }).sortBy).toBe(
      'updatedAt',
    );
  });

  it('rejects a non-allowlisted sortOrder and falls back to desc', () => {
    expect(normalizePostListQuery({ sortOrder: 'sideways' }).sortOrder).toBe(
      'desc',
    );
  });

  it('accepts ascending sortOrder', () => {
    expect(normalizePostListQuery({ sortOrder: 'asc' }).sortOrder).toBe('asc');
  });

  it('trims search and omits it entirely when blank', () => {
    expect(normalizePostListQuery({ search: '  hello  ' }).search).toBe(
      'hello',
    );
    expect(normalizePostListQuery({ search: '   ' }).search).toBeUndefined();
    expect(normalizePostListQuery({}).search).toBeUndefined();
  });

  it('passes through mediaType, processingStatus, and the date range untouched', () => {
    const createdFrom = new Date('2026-01-01T00:00:00.000Z');
    const createdTo = new Date('2026-02-01T00:00:00.000Z');

    expect(
      normalizePostListQuery({
        mediaType: MediaType.VIDEO,
        processingStatus: ProcessingStatus.FAILED,
        createdFrom,
        createdTo,
      }),
    ).toMatchObject({
      mediaType: MediaType.VIDEO,
      processingStatus: ProcessingStatus.FAILED,
      createdFrom,
      createdTo,
    });
  });

  it('normalizes includeDeleted to a boolean, defaulting to false', () => {
    expect(normalizePostListQuery({}).includeDeleted).toBe(false);
    expect(
      normalizePostListQuery({ includeDeleted: true }).includeDeleted,
    ).toBe(true);
  });
});
