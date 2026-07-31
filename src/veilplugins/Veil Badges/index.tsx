import definePlugin, { OptionType } from "@utils/types";
import { VeilDevs } from "@utils/constants";

/**
 * Improved Custom Badges plugin
 *
 * Main improvements:
 * - Fixed class/method placement and plugin lifecycle so stop() fully cleans up
 * - Validation for badge JSON
 * - Restores original store methods on stop()
 * - Prevents duplicate processing of images
 * - Better logging and guards for window.Vencord/Webpack
 */

const VENCORD = (window as any)?.Vencord;
const WEBPACK = VENCORD?.Webpack;

// Note: use the raw path to the badges.json file in the repo (adjust if your badges.json lives elsewhere)
const DEFAULT_BADGE_DATA_URL =
  "https://raw.githubusercontent.com/Zarak199076/a/main/badges.json";

type Badge = {
  id: string;
  description?: string;
  icon: string;
  link?: string;
};

class CustomBadges {
  private badgeData = new Map<string, Badge[]>();
  private BADGE_DATA_URL = DEFAULT_BADGE_DATA_URL;
  private REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  private BADGE_IMG_SELECTOR = 'img[src*="/badge-icons/"]';
  private observer: MutationObserver | null = null;
  private intervalId: number | null = null;
  private originalGetUserProfile: Function | null = null;
  private abortController: AbortController | null = null;

  constructor() {}

  async onLoad() {
    // nothing required during load
  }

  async onStart() {
    console.log("[CustomBadges] starting plugin");
    if (!WEBPACK || typeof WEBPACK.waitFor !== "function") {
      console.warn("[CustomBadges] Webpack.waitFor not available; plugin may not work");
    }

    this.startImageFixerObserver();

    // initial load (safe-call)
    await this.loadBadgeData();

    // patch (registers waitFor; patch may happen async)
    const registered = this.patchProfileStore();
    console.log("[CustomBadges] Patch listener registered:", registered);

    // periodic refresh
    this.intervalId = window.setInterval(
      () => void this.loadBadgeData(),
      this.REFRESH_INTERVAL_MS
    );
  }

  onStop() {
    console.log("[CustomBadges] stopping plugin");

    // stop observer
    if (this.observer) {
      try {
        this.observer.disconnect();
      } catch (e) {
        console.error("[CustomBadges] error disconnecting observer:", e);
      }
      this.observer = null;
    }

    // stop interval
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // abort any pending fetch
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {}
      this.abortController = null;
    }

    // attempt to unpatch restore original store method if present
    try {
      this.unpatchProfileStore();
    } catch (e) {
      console.error("[CustomBadges] error while unpatching:", e);
    }

    // clear in-memory data
    this.badgeData.clear();
  }

  // Fetch and validate badge JSON
  async loadBadgeData() {
    // avoid overlapping loads
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const res = await fetch(this.BADGE_DATA_URL, {
        cache: "no-store",
        signal,
      });
      if (!res.ok) throw new Error("HTTP " + res.status);

      const json = await res.json();
      this.setBadgeDataFromJSON(json);
      console.log(
        "[CustomBadges] Loaded badge data for",
        this.badgeData.size,
        "users"
      );
    } catch (e) {
      if ((e as any)?.name === "AbortError") {
        // expected on rapid reloads; ignore
        console.debug("[CustomBadges] loadBadgeData aborted");
      } else {
        console.error("[CustomBadges] Failed to load badge data:", e);
      }
    } finally {
      this.abortController = null;
    }
  }

  private setBadgeDataFromJSON(raw: any) {
    // Expecting an object mapping userId -> array of Badge
    try {
      this.badgeData.clear();
      if (!raw || typeof raw !== "object") {
        console.warn("[CustomBadges] badge JSON is not an object");
        return;
      }

      for (const [userId, arr] of Object.entries(raw)) {
        if (!Array.isArray(arr)) continue;
        const parsed: Badge[] = [];
        for (const item of arr) {
          if (!item || typeof item !== "object") continue;
          const id = String(item.id || item.badgeId || item.name || "");
          const icon = String(item.icon || "");
          if (!id || !icon) continue;
          // sanitize icon URL: allow http(s) or data: URIs
          if (!this.isValidIconUrl(icon)) continue;

          parsed.push({
            id,
            description: item.description ? String(item.description) : undefined,
            icon,
            link: item.link ? String(item.link) : undefined,
          });
        }
        if (parsed.length) {
          this.badgeData.set(String(userId), parsed);
        }
      }
    } catch (e) {
      console.error("[CustomBadges] Error parsing badge JSON:", e);
    }
  }

  private isValidIconUrl(url: string) {
    return /^(https?:\/\/|data:)/i.test(url);
  }

  // Fix wrapped/encoded images inserted by previous plugin behavior
  private tryFixImage(img: HTMLImageElement) {
    try {
      // avoid reprocessing
      if (!img || img.dataset?.veilBadgeFixed === "1") return;

      const src = img.getAttribute("src") || "";
      if (
        src.includes("/badge-icons/https://") ||
        src.includes("/badge-icons/http://") ||
        src.includes("/badge-icons/data:")
      ) {
        const m =
          src.match(
            /\/badge-icons\/(.+?)(?:\.(?:png|webp|jpg|jpeg|gif|svg))(?:\?|$)/i
          ) || src.match(/\/badge-icons\/(.+)$/i);
        if (!m) return;

        let raw = m[1];
        try {
          raw = decodeURIComponent(raw);
        } catch {}
        raw = raw.replace(/%2F/gi, "/");

        if (/^(https?:|data:)/.test(raw)) {
          img.setAttribute("referrerPolicy", "no-referrer");
          // set nice defaults (these attributes might not always be writable in some environments)
          try {
            img.loading = "eager";
          } catch {}
          try {
            // decoding is not yet widely supported on some older environments; guard it
            (img as any).decoding = "async";
          } catch {}
          img.src = raw;
          // mark processed to avoid re-processing
          img.dataset.veilBadgeFixed = "1";
        }
      }
    } catch (e) {
      // nothing fatal here
    }
  }

  private startImageFixerObserver() {
    // fix existing images
    try {
      document.querySelectorAll(this.BADGE_IMG_SELECTOR).forEach((el) => {
        if (el instanceof HTMLImageElement) this.tryFixImage(el);
      });
    } catch (e) {
      console.warn("[CustomBadges] startImageFixerObserver init error:", e);
    }

    // create observer if not already created
    if (this.observer) return;

    this.observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        mut.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const el = node as Element;
          if (el.matches?.(this.BADGE_IMG_SELECTOR)) {
            if (el instanceof HTMLImageElement) this.tryFixImage(el);
          }
          el.querySelectorAll?.(this.BADGE_IMG_SELECTOR).forEach((child) => {
            if (child instanceof HTMLImageElement) this.tryFixImage(child);
          });
        });
      }
    });

    try {
      this.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch (e) {
      console.warn("[CustomBadges] observer failed to observe:", e);
      this.observer = null;
    }
  }

  // Patch the profile store to inject custom badges
  private applyPatch(store: any) {
    if (!store || typeof store.getUserProfile !== "function") return;

    // if we've already saved original, assume patched
    if (this.originalGetUserProfile) return;

    this.originalGetUserProfile = store.getUserProfile;

    const self = this;
    store.getUserProfile = function patchedGetUserProfile(...args: any[]) {
      try {
        const profile = self.originalGetUserProfile!.apply(this, args);
        // userId may be passed directly or as object; normalize
        let userId: string | undefined = undefined;
        if (typeof args[0] === "string" || typeof args[0] === "number") {
          userId = String(args[0]);
        } else if (args[0] && typeof args[0] === "object") {
          // sometimes these functions accept an object with id property
          userId = String((args[0] as any).id ?? "");
        }

        if (!profile || !userId) return profile;

        const badges = self.badgeData.get(userId);
        if (!badges || badges.length === 0) return profile;

        profile.badges = Array.isArray(profile.badges) ? profile.badges : [];

        for (const b of badges) {
          if (!profile.badges.some((x: any) => x?.id === b.id)) {
            // inject clone to avoid accidental mutation of original store/badge map
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
        // fallback to original if something goes wrong
        try {
          return self.originalGetUserProfile!.apply(this, args);
        } catch {
          return undefined;
        }
      }
    };

    (store as any).__customBadgesPatched = true;
    console.log("[CustomBadges] Patch applied to profile store");
  }

  private unpatchProfileStore() {
    // find a candidate store and restore original method if we have it
    if (!this.originalGetUserProfile) return;

    try {
      // attempt to locate the same store we patched
      const filter = (m: any) =>
        m && typeof m.getUserProfile === "function" && typeof m.getGuildMemberProfile === "function";

      // If Webpack.waitFor is present we can try to find the store
      if (WEBPACK && typeof WEBPACK.findModule === "function") {
        try {
          const store = WEBPACK.findModule(filter);
          if (store && this.originalGetUserProfile) {
            store.getUserProfile = this.originalGetUserProfile;
            delete (store as any).__customBadgesPatched;
            console.log("[CustomBadges] Restored original getUserProfile on store");
          }
        } catch {
          // ignore and continue to try other restoration approaches
        }
      }

      // Clear our saved original reference so we don't attempt to restore multiple times later
      this.originalGetUserProfile = null;
    } catch (e) {
      console.warn("[CustomBadges] unpatchProfileStore had an error:", e);
    }
  }

  patchProfileStore() {
    try {
      const filter = (m: any) =>
        m && typeof m.getUserProfile === "function" && typeof m.getGuildMemberProfile === "function";

      if (!WEBPACK || typeof WEBPACK.waitFor !== "function") {
        console.warn("[CustomBadges] Webpack.waitFor unavailable; using findModule if present");
        if (WEBPACK && typeof WEBPACK.findModule === "function") {
          try {
            const store = WEBPACK.findModule(filter);
            if (store) this.applyPatch(store);
            return Boolean(store);
          } catch (e) {
            console.error("[CustomBadges] findModule threw:", e);
            return false;
          }
        }
        return false;
      }

      // register patching handler (store may appear asynchronously)
      WEBPACK.waitFor(filter, (store: any) => {
        try {
          this.applyPatch(store);
        } catch (err) {
          console.error("[CustomBadges] Failed to apply patch once store was found:", err);
        }
      });

      return true;
    } catch (e) {
      console.error("[CustomBadges] patchProfileStore threw:", e);
      return false;
    }
  }
}

/**
 * Plugin export
 * Keep single instance reference so stop() can clean up the same instance the start() created.
 */
let instance: CustomBadges | null = null;

export default definePlugin({
  name: "Veil Badges",
  description: "Custom Badges Added Via Veil. Join -> https://discord.gg/Y33UjmdsER",
  tags: ["Fun", "Veil"],
  authors: [VeilDevs.Zarak],
  start() {
    if (!instance) instance = new CustomBadges();
    instance.onStart();
  },
  stop() {
    if (!instance) return;
    instance.onStop();
    instance = null;
  },
});
