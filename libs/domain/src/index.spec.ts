import { libraryName as configuration } from '@posts-media/configuration';
import { libraryName as database } from '@posts-media/database';
import { libraryName as domain } from '@posts-media/domain';
import { libraryName as media } from '@posts-media/media';
import { libraryName as mediaProcessing } from '@posts-media/media-processing';
import { libraryName as observability } from '@posts-media/observability';
import { libraryName as posts } from '@posts-media/posts';
import { libraryName as queues } from '@posts-media/queues';
import { libraryName as storage } from '@posts-media/storage';
import { libraryName as testing } from '@posts-media/testing';

describe('shared library public barrels', () => {
  it('exports one value from every shared library', () => {
    expect({
      configuration,
      database,
      domain,
      media,
      mediaProcessing,
      observability,
      posts,
      queues,
      storage,
      testing,
    }).toEqual({
      configuration: 'configuration',
      database: 'database',
      domain: 'domain',
      media: 'media',
      mediaProcessing: 'media-processing',
      observability: 'observability',
      posts: 'posts',
      queues: 'queues',
      storage: 'storage',
      testing: 'testing',
    });
  });
});
