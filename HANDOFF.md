# YoutiFy – Übergabe für Coding-Agents

Stand: Version **2.3.0** (Commit „iOS: allow joining jam sessions in the local network“).
Fork von `Ernani1234/musike`, umgebaut zu **YoutiFy** · „Made by Ka I.“. Repo: https://github.com/correexx-droid/youtify

Die fertigen 2.3.0-Installer liegen im Ordner `release/` dieser ZIP (nicht im Git-Repo). **Nicht neu bauen**, solange
nur Code gelesen oder geändert wird. Gebaut wird erst, wenn eine neue Version ausgeliefert werden soll.

## Aufbau (pnpm-Monorepo)

| Ordner | Inhalt |
|---|---|
| `web/` | Die eigentliche App: React + Vite + Tailwind v4 + zustand. Läuft im Browser, in Android/iOS (Capacitor) und in beiden PC-Programmen. |
| `server/` | Fastify-Server (youtubei.js, yt-dlp): Suche, Streams, Lyrics, Playlist-Import. Im Handy-Build läuft dieser Code über Shims direkt in der App (`web/src/native/`). |
| `mobile/` | Capacitor 8: `android/` (APK) und `ios/` (IPA, wird über GitHub Actions gebaut). Eigene Java-Plugins in `android/app/src/main/java/app/musike/android/` (u. a. `JamServerPlugin.java`). |
| `phone/` | „YoutiFy Mobile“: die Handy-App als Windows-Programm (Electron, lädt `web/dist-native` über `youtify://app`). |
| `desktop/` | Klassisches PC-Programm (Electron mit eingebautem Server). |

## Wichtige Dateien

- Player, Warteschlange, Genre-Mix: `web/src/player/player.ts`, `web/src/components/Queue.tsx`
- Offline-Downloads (Quellen, Tiefensuche, Kompression, Speicherort): `web/src/stores/offline.ts`, `web/src/components/Offline.tsx`
- Eigenes Kompressionsformat YTFY: `web/src/lib/ytfy.ts`, `web/src/lib/transcode.ts`
- Speicherorte (App / Android-Dokumente / Android-Gerätespeicher / PC-Ordner): `web/src/lib/fileStores.ts`, `web/src/components/StorageLocation.tsx`, PC-Seite `phone|desktop/src/fsBridge.ts`
- Freie Quellen (Audius, Internet Archive mit Lizenz): `web/src/lib/freeMusic.ts`
- Teilen-Codes (`YTF1…`, `youtify://share/…`): `web/src/lib/shareCode.ts`, `web/src/components/ShareDialog.tsx`, Import in `ImportPlaylist.tsx`
- Jam-Session (LAN, PIN, Port 4190): `web/src/lib/jam.ts`, `web/src/lib/jamGuestPage.ts`, `web/src/components/JamDialog.tsx`, PC `phone|desktop/src/jamBridge.ts`, Android `JamServerPlugin.java`
- Spotify-/YouTube-Playlist-Import: `server/src/*`, `web/src/components/ImportPlaylist.tsx`, `SpotifySection.tsx`
- Farbwelten/Design: `web/src/lib/theme.ts`, `web/src/stores/appearance.ts`
- Sprachen (nur Deutsch + Englisch): `web/src/i18n/de.ts`, `en.ts`

## Prüfen ohne Bauen

```bash
pnpm install
pnpm --filter ./web typecheck          # Web + Handy-Build
(cd phone && npx tsc --noEmit -p .)    # YoutiFy Mobile
(cd desktop && npx tsc --noEmit -p .)
pnpm dev                               # Browser-Version: Server + Vite
```

## Bauen (nur für eine neue Version)

1. Version überall anheben: alle `package.json` + `mobile/ios/App/App.xcodeproj/project.pbxproj`
   (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION` = z. B. 20300 für 2.3.0).
2. APK: `ANDROID_HOME=<sdk> node mobile/scripts/build-apk.mjs` → `release/YoutiFy-Setup-<v>-Android.apk`.
   Signiert wird nur, wenn `mobile/android/keystore.properties` + `youtify-release.jks` vorhanden sind
   (liegen NICHT im Repo, separat beim Besitzer). Ohne denselben Schlüssel lässt sich die APK nicht über die alte installieren.
3. YoutiFy Mobile (Windows): `cd phone && pnpm dist` (unter Linux mit wine) → `phone/out/YoutiFy-Mobile-Setup-<v>-Windows.exe`.
   Die Fehlermeldung am Ende („update info“) ist harmlos, die .exe ist dann schon fertig.
4. Desktop: `cd desktop && pnpm dist`.
5. iOS: Push auf `main` startet `.github/workflows/ios.yml` (macos-15-intel), Artefakt „YoutiFy-iOS“.

## Regeln aus dem bisherigen Verlauf

- Keine Downloadseiten von Drittanbietern ohne Lizenz einbauen; zusätzliche Quellen nur YouTube/YouTube Music oder freie, lizenzierte Quellen.
- Spotify nur über offizielle Client-Credentials mit den eigenen Schlüsseln des Nutzers.
- Lange Builds kurz halten, APK zuerst liefern.
