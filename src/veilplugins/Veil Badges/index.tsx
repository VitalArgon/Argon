import definePlugin, { OptionType } from "@utils/types";
import { VeilDevs } from "@utils/constants";

/**
 * Veil Badges plugin — improved, robust version
 *
 * Fixes:
 * - Correct raw GitHub badges.json URL + fallback
 * - Robust Webpack store discovery (waitFor/findModule/findByProps + retry)
 * - Proper start/stop lifecycle with cleanup and unpatching
 * - Safer image fixer (marks processed images)
 */

const getVencord = () => (window as any).Vencord || (window as any).vencord || null;
const getWebpack = () => {
  // Read the helper dynamically at runtime (don't capture at module-eval time)
  const v = getVencord();
  return v?.Webpack || v?.webpack || (window as any).VencordWebpack || null;
};

type Badge = {
  id: string;
  description?: string;
  icon: string;
  link?: string;
};

class CustomBadges {
  private badgeData: Map<string, Badge[]> = new Map();
  private BADGE_DATA_URL = "https://raw.githubusercontent.com/Zarak199076/a/main/badges.json";
  private FALLBACK_BADGE_URL = "https://badges.vencord.dev/badges.json";
  private REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  private BADGE_IMG_SELECTOR = 'img[src*="/badge-icons/"]';
  private observer: MutationObserver | null = null;
  private intervalId: number | null = null;
  private retryPatchId: number | null = null;
  private originalGetUserProfile: Function | null = null;
  private abortController: AbortController | null = null;
  private retryLogged = false;

  constructor() {}

  async onLoad() {
    // no-op for now
  }

  async onStart() {
    console.log("[CustomBadges] Plugin started.");
    this.startImageFixerObserver();

    await this.loadBadgeData();

    const registered = this.patchProfileStore();
    console.log("[CustomBadges] Patch listener registered:", registered);

    // refresh periodically
    this.intervalId = window.setInterval(() => void this.loadBadgeData(), this.REFRESH_INTERVAL_MS);
  }

  onStop() {
    console.log("[CustomBadges] Plugin stopped.");

    // disconnect observer
    if (this.observer) {
      try {
        this.observer.disconnect();
      } catch (e) {
        console.warn("[CustomBadges] observer.disconnect error:", e);
      }
      this.observer = null;
    }

    // clear refresh interval
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // clear retry interval (if set)
    if (this.retryPatchId !== null) {
      clearInterval(this.retryPatchId);
      this.retryPatchId = null;
    }

    // abort any inflight fetch
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {}
      this.abortController = null;
    }

    // attempt to restore original store if patched
    try {
      this.unpatchProfileStore();
    } catch (e) {
      console.warn("[CustomBadges] unpatchProfileStore error:", e);
    }

    // clear data
    this.badgeData.clear();
  }

  // Load badges.json with fallback handling
  async loadBadgeData() {
    // abort previous if necessary
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
        if (res.status === 404 && this.FALLBACK_BADGE_URL) {
          console.warn("[CustomBadges] Primary badges.json not found (404), trying fallback.");
          const res2 = await fetch(this.FALLBACK_BADGE_URL, { cache: "no-store", signal });
          if (!res2.ok) throw new Error("Fallback HTTP " + res2.status);
          const json2 = await res2.json();
          this.setBadgeDataFromJSON(json2);
          console.log("[CustomBadges] Loaded badge data (fallback) for", this.badgeData.size, "users");
          return;
        }
        throw new Error("HTTP " + res.status);
      }
      const json = await res.json();
      this.setBadgeDataFromJSON(json);
      console.log("[CustomBadges] Loaded badge data for", this.badgeData.size, "users");
    } catch (e: any) {
      if (e?.name === "AbortError") {
        console.debug("[CustomBadges] loadBadgeData aborted");
      } else {
        console.error("[CustomBadges] Failed to load badge data:", e);
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

  // Fix image srcs inserted by older wrappers; mark processed to avoid repeats
  private tryFixImage(img: HTMLImageElement) {
    try {
      if (!img || img.dataset?.veilBadgeFixed === "1") return;

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
          img.dataset.veilBadgeFixed = "1";
        }
      }
    } catch (e) {
      // swallow image fixes errors
    }
  }

  private startImageFixerObserver() {
    try {
      document.querySelectorAll(this.BADGE_IMG_SELECTOR).forEach((el) => {
        if (el instanceof HTMLImageElement) this.tryFixImage(el);
      });
    } catch (e) {
      console.warn("[CustomBadges] init image fixer error:", e);
    }

    if (this.observer) return;

    this.observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        mut.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const el = node as Element;
          try {
            if (el.matches?.(this.BADGE_IMG_SELECTOR) && el instanceof HTMLImageElement) this.tryFixImage(el as HTMLImageElement);
            el.querySelectorAll?.(this.BADGE_IMG_SELECTOR).forEach((child) => {
              if (child instanceof HTMLImageElement) this.tryFixImage(child);
            });
          } catch {}
        });
      }
    });

    try {
      this.observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {
      console.warn("[CustomBadges] observer.observe failed:", e);
      this.observer = null;
    }
  }

  // Patch the profile store's getUserProfile to inject badges
  private applyPatch(store: any) {
    if (!store || typeof store.getUserProfile !== "function") return;
    if ((store as any).__customBadgesPatched) return;

    const orig = store.getUserProfile;
    this.originalGetUserProfile = orig;

    const self = this;
    store.getUserProfile = function patchedGetUserProfile(...args: any[]) {
      try {
        const profile = orig.apply(this, args);
        let userId: string | undefined;
        if (typeof args[0] === "string" || typeof args[0] === "number") userId = String(args[0]);
        else if (args[0] && typeof args[0] === "object") userId = String((args[0] as any).id ?? "");

        if (!profile || !userId) return profile;

        const badges = self.badgeData.get(userId);
        if (!badges || badges.length === 0) return profile;

        profile.badges = Array.isArray(profile.badges) ? profile.badges : [];
        for (const b of badges) {
          if (!profile.badges.some((x: any) => x?.id === b.id)) {
            profile.badges.unshift({
              id: b.id,
              description: b.description,
              icon: b.icon,
              link: b.link || "#",
            });
          }
        }
        return profile;
      } catch (e) {
        console.error("[CustomBadges] error in patched getUserProfile:", e);
        try {
          return orig.apply(this, args);
        } catch {
          return undefined;
        }
      }
    };

    (store as any).__customBadgesPatched = true;
    console.log("[CustomBadges] Patch applied to profile store");
  }

  private unpatchProfileStore() {
    if (!this.originalGetUserProfile) return;
    try {
      const filter = (m: any) =>
        m && (typeof m.getUserProfile === "function" || typeof m.getGuildMemberProfile === "function" || typeof m.getUser === "function");

      // try to find the store synchronously and restore
      let store: any = null;
      try {
        const WEBPACK = getWebpack();
        if (WEBPACK && typeof WEBPACK.findModule === "function") store = WEBPACK.findModule(filter);
        if (!store && WEBPACK && typeof WEBPACK.findByProps === "function") store = WEBPACK.findByProps("getUserProfile", "getGuildMemberProfile", "getUser");
      } catch {}

      if (store && store.getUserProfile && this.originalGetUserProfile) {
        try {
          store.getUserProfile = this.originalGetUserProfile;
          delete (store as any).__customBadgesPatched;
          console.log("[CustomBadges] Restored original getUserProfile on store");
        } catch (e) {
          console.warn("[CustomBadges] Failed to restore original getUserProfile:", e);
        }
      }

      this.originalGetUserProfile = null;
    } catch (e) {
      console.warn("[CustomBadges] unpatch error:", e);
    }
  }

  // Robust patch find: waitFor -> findModule -> findByProps -> short retry loop
  patchProfileStore() {
    try {
      const filter = (m: any) =>
        m &&
        (typeof m.getUserProfile === "function" ||
          typeof m.getGuildMemberProfile === "function" ||
          typeof m.getUser === "function" ||
          typeof m.getUserById === "function");

      const trySyncFind = (): any => {
        try {
          const WEBPACK = getWebpack();
          if (!WEBPACK) return null;
          if (typeof WEBPACK.findModule === "function") {
            try {
              const s = WEBPACK.findModule(filter);
              if (s) return s;
            } catch {}
          }
          if (typeof WEBPACK.findByProps === "function") {
            try {
              const s = WEBPACK.findByProps("getUserProfile", "getGuildMemberProfile", "getUser");
              if (s) return s;
            } catch {}
          }
          if (typeof WEBPACK.findModuleByProps === "function") {
            try {
              const s = WEBPACK.findModuleByProps(["getUserProfile", "getGuildMemberProfile", "getUser"]);
              if (s) return s;
            } catch {}
          }
        } catch (e) {
          console.debug("[CustomBadges] sync find threw:", e);
        }
        return null;
      };

      // If async waitFor exists, prefer it
      const WEBPACK = getWebpack();
      if (WEBPACK && typeof WEBPACK.waitFor === "function") {
        try {
          WEBPACK.waitFor(filter, (store: any) => {
            try {
              this.applyPatch(store);
            } catch (e) {
              console.error("[CustomBadges] Failed to apply patch once store was found:", e);
            }
          });
          return true;
        } catch (e) {
          console.warn("[CustomBadges] Webpack.waitFor threw; falling back:", e);
        }
      }

      // Try sync find once
      const store = trySyncFind();
      if (store) {
        try {
          this.applyPatch(store);
        } catch (e) {
          console.error("[CustomBadges] applyPatch threw:", e);
        }
        return true;
      }

      // Retry loop: short-lived to give environment time to load modules
      if (!this.retryLogged) {
        console.warn("[CustomBadges] Webpack.waitFor not available; starting short retry loop to find profile store.");
        this.retryLogged = true;
      }
      let tries = 0;
      const maxTries = 40; // increase attempts slightly to be more resilient
      const intervalMs = 1000;
      this.retryPatchId = window.setInterval(() => {
        tries++;
        const s = trySyncFind();
        if (s) {
          try {
            this.applyPatch(s);
            if (this.retryPatchId !== null) {
              clearInterval(this.retryPatchId);
              this.retryPatchId = null;
            }
          } catch (e) {
            console.error("[CustomBadges] Failed to apply patch during retry:", e);
          }
          return;
        }
        if (tries >= maxTries) {
          if (this.retryPatchId !== null) {
            clearInterval(this.retryPatchId);
            this.retryPatchId = null;
          }
          console.warn("[CustomBadges] Could not locate profile store after retries; plugin may not function.");
        }
      }, intervalMs) as unknown as number;

      return false;
    } catch (e) {
      console.error("[CustomBadges] patchProfileStore threw:", e);
      return false;
    }
  }
}

let instance: CustomBadges | null = null;

export default definePlugin({
  name: "Veil Badges",
  description: "Custom Badges Added Via Veil. Join -> https://discord.gg/Y33UjmdsER",
  tags: ["Fun", "Veil"],
  authors: [VeilDevs.Zarak],
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
