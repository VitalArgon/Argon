import definePlugin, { OptionType } from "@utils/types";
import { ArgonDevs } from "@utils/constants";

type Badge = {
  id: string;
  description?: string;
  icon: string;
  link?: string;
};

const BADGE_IMG_SELECTOR = 'img[src*="/badge-icons/"]';

class CustomBadges {
  private badgeData: Map<string, Badge[]> = new Map();
  private BADGE_DATA_URL = "https://raw.githubusercontent.com/Zarak199076/a/refs/heads/main/badges.json";
  private REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  private observer: MutationObserver | null = null;
  private intervalId: number | null = null;
  private abortController: AbortController | null = null;
  private patchedStore: any = null;
  private originalGetUserProfile: any = null;

  constructor() {}

  async onLoad() {}

  async onStart() {
    this.startImageFixerObserver();

    await this.loadBadgeData();

    this.patchProfileStore();

    this.intervalId = window.setInterval(() => void this.loadBadgeData(), this.REFRESH_INTERVAL_MS);
  }

  onStop() {
    if (this.patchedStore && this.originalGetUserProfile) {
      try {
        this.patchedStore.getUserProfile = this.originalGetUserProfile;
      } catch (e) {}
    }

    if (this.observer) {
      try {
        this.observer.disconnect();
      } catch (e) {}
      this.observer = null;
    }

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {}
      this.abortController = null;
    }

    this.badgeData.clear();
  }

  private async loadBadgeData() {
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {}
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const res = await fetch(this.BADGE_DATA_URL, { cache: "no-store", signal });
      if (!res.ok) {
        throw new Error("HTTP " + res.status);
      }
      const json = await res.json();
      this.setBadgeDataFromJSON(json);
    } catch (e: any) {
      // swallow errors except abort
      if (e?.name === "AbortError") {
      } else {
      }
    } finally {
      this.abortController = null;
    }
  }

  private setBadgeDataFromJSON(raw: any) {
    this.badgeData.clear();
    if (!raw || typeof raw !== "object") return;
    for (const [userId, arr] of Object.entries(raw)) {
      if (!Array.isArray(arr)) continue;
      const parsed: Badge[] = [];
      for (const item of arr) {
        if (!item || typeof item !== "object") continue;
        const id = String(item.id ?? item.badgeId ?? "");
        const icon = String(item.icon ?? "");
        if (!id || !icon) continue;
        if (!this.isValidIconUrl(icon)) continue;
        parsed.push({
          id,
          description: item.description ? String(item.description) : undefined,
          icon,
          link: item.link ? String(item.link) : undefined,
        });
      }
      if (parsed.length) this.badgeData.set(String(userId), parsed);
    }
  }

  private isValidIconUrl(u: string) {
    return /^(https?:\/\/|data:)/i.test(u);
  }

  private tryFixImage(img: HTMLImageElement) {
    try {
      if (!img || img.dataset?.argonBadgeFixed === "1") return;

      const src = img.getAttribute("src") || "";
      if (
        src.includes("/badge-icons/https://") ||
        src.includes("/badge-icons/http://") ||
        src.includes("/badge-icons/data:")
      ) {
        const m =
          src.match(/\/badge-icons\/(.+?)(?:\.(?:png|webp|jpg|jpeg|gif|svg))(?:\?|$)/i) ||
          src.match(/\/badge-icons\/(.+)$/i);
        if (!m) return;

        let raw = m[1];
        try {
          raw = decodeURIComponent(raw);
        } catch {}
        raw = raw.replace(/%2F/gi, "/");

        if (/^(https?:|data:)/.test(raw)) {
          try {
            img.setAttribute("referrerPolicy", "no-referrer");
          } catch {}
          try {
            img.loading = "eager";
          } catch {}
          try {
            (img as any).decoding = "async";
          } catch {}
          img.src = raw;
          img.dataset.argonBadgeFixed = "1";
        }
      }
    } catch (e) {
    }
  }

  private startImageFixerObserver() {
    try {
      document.querySelectorAll(BADGE_IMG_SELECTOR).forEach((el) => {
        if (el instanceof HTMLImageElement) this.tryFixImage(el);
      });
    } catch (e) {}

    if (this.observer) return;

    this.observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        mut.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const el = node as Element;
          try {
            if (el.matches?.(BADGE_IMG_SELECTOR) && el instanceof HTMLImageElement) this.tryFixImage(el as HTMLImageElement);
            el.querySelectorAll?.(BADGE_IMG_SELECTOR).forEach((child) => {
              if (child instanceof HTMLImageElement) this.tryFixImage(child);
            });
          } catch {}
        });
      }
    });

    try {
      this.observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {
      this.observer = null;
    }
  }

  private patchProfileStore() {
    try {
      const Vencord = (window as any).Vencord || (window as any).vencord;
      if (!Vencord?.Webpack) {
        return;
      }

      const filter = (m: any) =>
        m &&
        typeof m.getUserProfile === "function" &&
        typeof m.getGuildMemberProfile === "function";

      if (typeof Vencord.Webpack.waitFor === "function") {
        Vencord.Webpack.waitFor(filter, (store: any) => {
          try {
            this.applyPatch(store);
          } catch (e) {}
        });
      } else if (typeof Vencord.Webpack.findStore === "function") {
        const store = Vencord.Webpack.findStore(filter);
        if (store) {
          this.applyPatch(store);
        }
      }
    } catch (e) {}
  }

  private applyPatch(store: any) {
    try {
      if (!store) return;
      if (store.__customBadgesPatched) {
        return;
      }

      this.patchedStore = store;
      this.originalGetUserProfile = store.getUserProfile;

      const self = this;

      store.getUserProfile = function (userId: string) {
        const profile = self.originalGetUserProfile.apply(this, arguments);
        if (!profile) return profile;

        const badges = self.badgeData.get(userId);
        if (!badges || badges.length === 0) return profile;

        profile.badges = Array.isArray(profile.badges) ? profile.badges : [];

        for (let i = 0; i < badges.length; i++) {
          const b = badges[i];
          if (!profile.badges.some((x: any) => x?.id === b.id)) {
            profile.badges.splice(i, 0, {
              id: b.id,
              description: b.description,
              icon: b.icon,
              link: b.link || "#",
            });
          }
        }

        return profile;
      };

      store.__customBadgesPatched = true;
    } catch (e) {}
  }
}

let instance: CustomBadges | null = null;

export default definePlugin({
  name: "Argon Badges",
  description: "Custom Badges Added Via Argon. Join -> https://discord.gg/Y33UjmdsER",
  tags: ["Fun", "Argon"],
  authors: [ArgonDevs.Zarak],
  start() {
    if (!instance) instance = new CustomBadges();
    void instance.onStart();
  },
  stop() {
    if (!instance) return;
    instance.onStop();
    instance = null;
  },
});
