/**
 * Messages the server sends to people (errors, update progress), in every language the app speaks.
 * They are kept as keys and translated when sent, so each device gets its own language.
 */

export type Lang = "en" | "de";
type Params = Record<string, string | number>;

const en = {
  invalidVideoId: "Invalid video ID.",
  emptyQuery: "Type something to search.",
  searchFailed: "Search is unavailable right now ({detail}). Try again in a moment.",
  missingTitle: "Give the song's title.",
  notBackup: "This file isn't a YoutiFy backup.",
  newerBackup: "This backup was made by a newer YoutiFy. Update the app to import it.",
  idMismatch: "The ID doesn't match.",
  tracksRequired: "Send a list of tracks.",
  invalidGenre: "Invalid genre.",
  invalidOffset: "Invalid position.",
  invalidArtist: "Invalid artist.",
  routeNotFound: "Route not found.",
  noFreePort: "No free port between {from} and {to}.",
  invalidTrack: "Invalid track.",
  playlistNotFound: "Playlist not found.",
  playlistNameRequired: "Give the playlist a name.",
  genresUnavailable: "Couldn't load the genres right now. Try again.",
  genreUnavailable: "Couldn't open this genre right now. Try again.",
  genreEmpty: "Nothing found for this genre.",
  artistUnavailable: "Couldn't open this artist right now. Try again.",
  artistNotFound: "Artist not found.",
  albumUnavailable: "Couldn't open this album right now. Try again.",
  albumNotFound: "Album not found.",
  invalidAlbum: "Invalid album.",
  ytdlpMissing: "yt-dlp wasn't found on this computer. Open Settings in YoutiFy to install it.",
  ytdlpTimeout: "yt-dlp took too long to answer.",
  ytdlpCantRun: "Couldn't run yt-dlp ({error}). Open Settings in YoutiFy.",
  botCheck: "YouTube is asking this connection to prove it's not a bot. If you're on a VPN, turn it off and try again.",
  videoUnavailable: "This video isn't available on YouTube.",
  ageRestricted: "Age-restricted video. It needs cookies from a signed-in account.",
  ytdlpFailed: "yt-dlp failed.",
  ytdlpOutdated: "{detail} YouTube may have changed: update yt-dlp in Settings.",
  noAudio: "No audio format available for this video.",
  noSdVideo: "This video has no combined SD version. Use HD.",
  streamRefused: "YouTube refused the stream (HTTP {status}). Try updating yt-dlp in Settings.",
  noWinget: "yt-dlp wasn't found and winget isn't available. Install it manually: https://github.com/yt-dlp/yt-dlp",
  installingYtdlp: "Installing yt-dlp",
  updatingYtdlp: "Updating yt-dlp",
  directUpdateFailed: "Direct update failed, trying winget",
  downloadingTools: "Downloading yt-dlp and Deno from GitHub",
  alreadyLatest: "Already on the latest version ({version})",
  ytdlpReady: "yt-dlp {version} is ready to use",
  updateFailed: "Couldn't update yt-dlp.",
  toolMissing: "{tool} wasn't found on this computer.",
  downloadFailed: "Downloading {tool} failed (HTTP {status}).",
  ffmpegPackage: "Unexpected FFmpeg package.",
  importBadLink: "That isn't a Spotify or YouTube playlist link.",
  importFailed: "Couldn't read this playlist. Is it public?",
  importEmpty: "No tracks found in this playlist.",
};

export type MsgKey = keyof typeof en;

const de: Record<MsgKey, string> = {
  invalidVideoId: "Ungültige Video-ID.",
  emptyQuery: "Gib etwas ein, um zu suchen.",
  searchFailed: "Die Suche ist gerade nicht verfügbar ({detail}). Versuch es gleich noch einmal.",
  missingTitle: "Gib den Titel des Songs an.",
  notBackup: "Diese Datei ist kein YoutiFy-Backup.",
  newerBackup: "Dieses Backup stammt von einer neueren YoutiFy-Version. Aktualisiere die App, um es zu importieren.",
  idMismatch: "Die ID stimmt nicht überein.",
  tracksRequired: "Schick eine Liste von Titeln.",
  invalidGenre: "Ungültiges Genre.",
  invalidOffset: "Ungültige Position.",
  invalidArtist: "Ungültiger Künstler.",
  routeNotFound: "Route nicht gefunden.",
  noFreePort: "Kein freier Port zwischen {from} und {to}.",
  invalidTrack: "Ungültiger Titel.",
  playlistNotFound: "Playlist nicht gefunden.",
  playlistNameRequired: "Gib der Playlist einen Namen.",
  genresUnavailable: "Die Genres konnten gerade nicht geladen werden. Versuch es noch einmal.",
  genreUnavailable: "Dieses Genre konnte gerade nicht geöffnet werden. Versuch es noch einmal.",
  genreEmpty: "Für dieses Genre wurde nichts gefunden.",
  artistUnavailable: "Dieser Künstler konnte gerade nicht geöffnet werden. Versuch es noch einmal.",
  artistNotFound: "Künstler nicht gefunden.",
  albumUnavailable: "Dieses Album konnte gerade nicht geöffnet werden. Versuch es noch einmal.",
  albumNotFound: "Album nicht gefunden.",
  invalidAlbum: "Ungültiges Album.",
  ytdlpMissing: "yt-dlp wurde auf diesem Computer nicht gefunden. Öffne die Einstellungen in YoutiFy, um es zu installieren.",
  ytdlpTimeout: "yt-dlp hat zu lange nicht geantwortet.",
  ytdlpCantRun: "yt-dlp konnte nicht ausgeführt werden ({error}). Öffne die Einstellungen in YoutiFy.",
  botCheck: "YouTube verlangt von dieser Verbindung einen Nachweis, dass sie kein Bot ist. Falls du ein VPN nutzt, schalte es aus und versuch es noch einmal.",
  videoUnavailable: "Dieses Video ist auf YouTube nicht verfügbar.",
  ageRestricted: "Video mit Altersbeschränkung. Dafür werden Cookies eines angemeldeten Kontos benötigt.",
  ytdlpFailed: "yt-dlp ist fehlgeschlagen.",
  ytdlpOutdated: "{detail} YouTube hat sich vielleicht geändert: Aktualisiere yt-dlp in den Einstellungen.",
  noAudio: "Für dieses Video gibt es kein Audioformat.",
  noSdVideo: "Dieses Video hat keine kombinierte SD-Version. Nutze HD.",
  streamRefused: "YouTube hat den Stream abgelehnt (HTTP {status}). Aktualisiere yt-dlp in den Einstellungen.",
  noWinget: "yt-dlp wurde nicht gefunden und winget ist nicht verfügbar. Installiere es manuell: https://github.com/yt-dlp/yt-dlp",
  installingYtdlp: "yt-dlp wird installiert",
  updatingYtdlp: "yt-dlp wird aktualisiert",
  directUpdateFailed: "Direktes Update fehlgeschlagen, versuche es mit winget",
  downloadingTools: "yt-dlp und Deno werden von GitHub geladen",
  alreadyLatest: "Bereits die neueste Version ({version})",
  ytdlpReady: "yt-dlp {version} ist einsatzbereit",
  updateFailed: "yt-dlp konnte nicht aktualisiert werden.",
  toolMissing: "{tool} wurde auf diesem Computer nicht gefunden.",
  downloadFailed: "Download von {tool} fehlgeschlagen (HTTP {status}).",
  ffmpegPackage: "Unerwartetes FFmpeg-Paket.",
  importBadLink: "Das ist kein Spotify- oder YouTube-Playlist-Link.",
  importFailed: "Die Playlist konnte nicht gelesen werden. Ist sie öffentlich?",
  importEmpty: "In dieser Playlist wurden keine Titel gefunden.",
};

const CATALOG: Record<Lang, Record<MsgKey, string>> = { en, de };

/** A message translated when it is sent: a key plus the values for its {placeholders}. */
export interface Msg {
  key: MsgKey;
  params?: Params;
}

/** Something to show a person: a message to translate, or text that needs none (tool output). */
export type Text = Msg | string;

export const msg = (key: MsgKey, params?: Params): Msg => ({ key, params });

export function tr(lang: Lang, text: Text): string {
  if (typeof text === "string") return text;
  return CATALOG[lang][text.key].replace(/\{(\w+)\}/g, (all, name: string) => String(text.params?.[name] ?? all));
}

export const isLang = (v: unknown): v is Lang => v === "en" || v === "de";

/** The language a request asked for. The app always says; anything else (media elements, curl) gets English. */
export function langOf(req: { headers: Record<string, string | string[] | undefined> }): Lang {
  const asked = req.headers["x-musike-lang"];
  return isLang(asked) ? asked : "en";
}

/** The code YouTube Music uses for its own words (genre names, artist bios). */
export const youtubeLang = (lang: Lang) => (lang === "de" ? "de" : "en");
