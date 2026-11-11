/**
 * The user's own Spotify app keys (developer.spotify.com → Dashboard → Create app). With them, playlists are read
 * through Spotify's official Web API, so long playlists come over completely. Kept on this device only.
 */
const KEY = "youtify:spotify-keys";

export interface SpotifyKeys {
  clientId: string;
  clientSecret: string;
}

export function getSpotifyKeys(): SpotifyKeys | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return v?.clientId && v?.clientSecret ? { clientId: String(v.clientId), clientSecret: String(v.clientSecret) } : null;
  } catch {
    return null;
  }
}

export function setSpotifyKeys(keys: SpotifyKeys | null) {
  try {
    if (keys?.clientId.trim() && keys.clientSecret.trim())
      localStorage.setItem(KEY, JSON.stringify({ clientId: keys.clientId.trim(), clientSecret: keys.clientSecret.trim() }));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}
