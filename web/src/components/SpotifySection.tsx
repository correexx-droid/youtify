import { CheckCircleIcon, SpotifyLogoIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useT } from "../i18n";
import { getSpotifyKeys, setSpotifyKeys } from "../lib/spotifyKeys";
import { toast } from "../stores/ui";

/** Settings: the user's own Spotify app keys, so whole playlists (not only the first 100 songs) can be copied. */
export function SpotifySection() {
  const t = useT();
  const saved = getSpotifyKeys();
  const [id, setId] = useState(saved?.clientId ?? "");
  const [secret, setSecret] = useState(saved?.clientSecret ?? "");
  const [has, setHas] = useState(!!saved);
  const input =
    "h-11 w-full rounded-full bg-surface-1 px-4 text-sm ring-1 ring-line outline-none placeholder:text-fg-3 focus:ring-2 focus:ring-accent";

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-fg-3">
        <SpotifyLogoIcon size={14} weight="fill" /> {t.spotify.title}
      </h3>
      <p className="text-sm text-fg-2">{t.spotify.body}</p>
      <ol className="list-decimal space-y-1 pl-5 text-xs text-fg-2">
        {t.spotify.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <a
        href="https://developer.spotify.com/dashboard"
        target="_blank"
        rel="noreferrer"
        className="self-start text-xs font-semibold text-accent-text underline underline-offset-2"
      >
        developer.spotify.com/dashboard
      </a>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSpotifyKeys(id && secret ? { clientId: id, clientSecret: secret } : null);
          const ok = !!getSpotifyKeys();
          setHas(ok);
          toast(ok ? t.spotify.saved : t.spotify.removed);
        }}
      >
        <input className={input} value={id} onChange={(e) => setId(e.target.value)} placeholder="Client ID" aria-label="Client ID" autoComplete="off" spellCheck={false} />
        <input
          className={input}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Client Secret"
          aria-label="Client Secret"
          type="password"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="flex items-center gap-3">
          <button type="submit" className="h-10 rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink">
            {t.spotify.save}
          </button>
          {has && (
            <span className="flex items-center gap-1 text-xs text-accent-text">
              <CheckCircleIcon size={16} weight="fill" /> {t.spotify.active}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
