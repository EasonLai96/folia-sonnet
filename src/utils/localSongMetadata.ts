import type { LocalSong } from '../types';
import type { LocalSongImportedMetadata, LocalSongOnlineMetadata } from '../types/localLibrary';
import { cleanLocalLibraryName, splitLocalLibraryArtistNames } from './localLibraryNames';

// src/utils/localSongMetadata.ts
// Resolves canonical local-song metadata while keeping imported and online snapshots internal.

export const stripLocalAudioExtension = (fileName: string): string => (
  fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/iu, '').trim()
);

export const buildImportedMetadataSnapshot = ({
  fileName,
  embeddedTitle,
  fallbackTitle,
  embeddedArtist,
  embeddedArtists,
  fallbackArtist,
  embeddedAlbum,
  fallbackAlbum,
}: {
  fileName: string;
  embeddedTitle?: string;
  fallbackTitle?: string;
  embeddedArtist?: string;
  embeddedArtists?: string[];
  fallbackArtist?: string;
  embeddedAlbum?: string;
  fallbackAlbum?: string;
}): LocalSongImportedMetadata => {
  const normalizedEmbeddedTitle = cleanLocalLibraryName(embeddedTitle);
  const title = normalizedEmbeddedTitle
    || cleanLocalLibraryName(fallbackTitle)
    || stripLocalAudioExtension(fileName)
    || fileName;
  const embeddedArtistNames = (embeddedArtists || []).flatMap(splitLocalLibraryArtistNames);
  return {
    title,
    titleSource: normalizedEmbeddedTitle ? 'embedded' : 'filename',
    artistNames: embeddedArtistNames.length > 0
      ? embeddedArtistNames
      : splitLocalLibraryArtistNames(embeddedArtist || fallbackArtist),
    albumName: cleanLocalLibraryName(embeddedAlbum || fallbackAlbum),
  };
};

/**
 * 这首歌的标题还归「导入时读到的那套」管吗。
 *
 * 'manual'（用户在管理歌曲里手改的名字）也算这一类：它只是把 title 换了个写法，并没有
 * 引入在线元数据，所以歌手 / 专辑仍然要看导入的那份快照。加了 'manual' 之后，凡是原本写
 * `titleOrigin === 'import'` 的地方都得换成这个判定 —— 否则手动改过名的歌会突然没有歌手。
 */
export const usesImportedSongMetadata = (
  song: Pick<LocalSong, 'titleOrigin'> | null | undefined,
): boolean => song?.titleOrigin === 'import' || song?.titleOrigin === 'manual';

export const getLocalSongImportedArtistNames = (song: LocalSong): string[] => (
  song.importedMetadata.artistNames
);

export const getLocalSongImportedAlbumName = (song: LocalSong): string | undefined => (
  song.importedMetadata.albumName
);

export const getLocalSongOnlineCoverUrl = (song: LocalSong): string | undefined => (
  song.onlineMetadata?.coverUrl
);

export const getLocalSongOnlineArtistNames = (online?: LocalSongOnlineMetadata): string[] => (
  online?.artists.map(artist => cleanLocalLibraryName(artist.name)).filter((name): name is string => Boolean(name)) || []
);
