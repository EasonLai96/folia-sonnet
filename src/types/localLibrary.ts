// src/types/localLibrary.ts
// Defines stable local-library identities independently from file paths and online source ids.

export type LocalLibraryEntityKind = 'artist' | 'album';

export interface LocalLibraryEntity {
  id: string;
  kind: LocalLibraryEntityKind;
  displayName: string;
  aliases: string[];
  normalizedAliases: string[];
  mergedInto?: string;
  needsReview?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type LocalLibraryAssignmentOrigin = 'import' | 'auto-match' | 'manual-match' | 'manual' | 'split';

/**
 * 'manual' 是用户在「管理歌曲」里直接改的名字（安卓上改不了磁盘文件名，改的就是它）。
 * 它不是在线匹配来的 —— 判断「歌手 / 专辑该看导入快照还是在线元数据」时和 'import' 一类，
 * 一律走 utils/localSongMetadata 的 usesImportedSongMetadata，别在这里手写 === 'import'。
 */
export type LocalSongTitleOrigin = 'import' | 'auto-match' | 'manual-match' | 'manual';
export type LocalSongMetadataSource = 'netease' | 'qq' | 'kugou';

export interface LocalSongImportedMetadata {
  title: string;
  titleSource: 'embedded' | 'filename';
  artistNames: string[];
  albumName?: string;
}

export interface LocalSongOnlineMetadata {
  source: LocalSongMetadataSource;
  songId?: number | string;
  albumId?: number | string;
  title?: string;
  artists: Array<{ id?: number | string; name: string }>;
  album?: { id?: number | string; name: string };
  coverUrl?: string;
  matchMode: 'auto' | 'manual' | 'legacy';
  matchedAt: number;
}

export interface LocalSongReference {
  songId: string;
}

export interface LocalLibraryAssignment {
  songId: string;
  artistEntityIds: string[];
  artistOrigin: LocalLibraryAssignmentOrigin;
  albumEntityId?: string;
  albumOrigin: LocalLibraryAssignmentOrigin;
  updatedAt: number;
}

export interface LocalLibrarySplitTarget {
  entityId?: string;
  displayName: string;
}

export type LocalLibraryArtistAssignmentMode = 'append' | 'replace';

