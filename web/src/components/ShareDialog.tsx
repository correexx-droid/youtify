import { CheckIcon, CopyIcon, ShareNetworkIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { create } from "zustand";
import { useT } from "../i18n";
import { encodeShare, shareableIds, shareLink } from "../lib/shareCode";
import type { Track } from "../lib/types";
import { toast } from "../stores/ui";
import { Modal } from "./Modal";

/** Share a playlist or songs with other YoutiFy users as a short code (see lib/shareCode.ts). */

interface ShareState {
  open: { kind: "playlist" | "songs"; name: string; tracks: Track[] } | null;
}

const useShare = create<ShareState>(() => ({ open: null }));

export function sharePlaylist(name: string, tracks: Track[]) {
  useShare.setState({ open: { kind: "playlist", name, tracks } });
}

export function shareSongs(tracks: Track[]) {
  useShare.setState({ open: { kind: "songs", name: tracks.length === 1 ? tracks[0]!.title : "", tracks } });
}

async function systemShare(title: string, text: string): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title, text, dialogTitle: title });
      return true;
    }
  } catch {
    /* fall through */
  }
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function ShareDialog() {
  const t = useT();
  const open = useShare((s) => s.open);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  if (!open) return <Modal open={false} onClose={() => {}} title="" children={null} />;
  const ids = open.tracks.map((tr) => tr.id);
  const shareable = shareableIds(ids);
  const skipped = ids.length - shareable.length;
  const code = encodeShare({ kind: open.kind, name: open.name, ids: shareable });
  const message = t.share.message(open.kind === "playlist" ? open.name : t.share.songs(shareable.length), shareLink(code));
  const copy = async (what: "code" | "link") => {
    try {
      await navigator.clipboard.writeText(what === "code" ? code : shareLink(code));
      setCopied(what);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      toast(t.share.copyFailed);
    }
  };
  const close = () => useShare.setState({ open: null });

  return (
    <Modal open onClose={close} title={open.kind === "playlist" ? t.share.titlePlaylist(open.name) : t.share.titleSongs(shareable.length)}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg-2">{t.share.body}</p>
        <textarea
          readOnly
          value={code}
          onFocus={(e) => e.currentTarget.select()}
          rows={code.length > 300 ? 6 : 3}
          aria-label={t.share.code}
          className="w-full resize-none rounded-[14px] bg-surface-1 p-3 font-mono text-xs break-all text-fg ring-1 ring-line outline-none focus:ring-2 focus:ring-accent"
        />
        <p className="text-xs text-fg-3">
          {t.share.size(shareable.length, code.length)}
          {skipped > 0 && ` · ${t.share.skippedLocal(skipped)}`}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copy("code")}
            className="flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink"
          >
            {copied === "code" ? <CheckIcon size={18} weight="bold" /> : <CopyIcon size={18} />} {copied === "code" ? t.share.copied : t.share.copyCode}
          </button>
          <button
            type="button"
            onClick={() => void copy("link")}
            className="flex h-11 items-center gap-2 rounded-full bg-surface-3 px-4 text-sm font-semibold text-fg hover:bg-surface-4"
          >
            {copied === "link" ? <CheckIcon size={18} weight="bold" /> : <CopyIcon size={18} />} {copied === "link" ? t.share.copied : t.share.copyLink}
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!(await systemShare(open.name || "YoutiFy", message))) void copy("link");
            }}
            className="flex h-11 items-center gap-2 rounded-full bg-surface-3 px-4 text-sm font-semibold text-fg hover:bg-surface-4"
          >
            <ShareNetworkIcon size={18} /> {t.share.send}
          </button>
        </div>
        <p className="text-xs text-fg-3">{t.share.howToReceive}</p>
      </div>
    </Modal>
  );
}
