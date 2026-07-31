import definePlugin, { OptionType } from "@utils/types";
import { VeilDevs } from "@utils/constants";

/**
 * Veil Badges plugin — injects badges by observing profile renders in the DOM
 *
 * Behavior:
 * - Loads badges.json (with fallback)
 * - Observes when profiles are rendered in the DOM
 * - Finds the user ID from the rendered profile
 * - Directly mutates the badge elements with custom badge data
 * - Injects once per profile load
 */

const BADGE_CONTAINER_SELECTOR = '[class*="profileBadges"]';
const BADGE_IMG_SELECTOR = 'img[src*="/badge-icons/"]';

type Badge = {
  id: string;
  description?: string;
  icon: string;
  link?: string;
};

class CustomBadges {
  private badgeData: Map<string, Badge[]> = new Map();
  private injectedProfiles: Set<string> = new Set();
  private BADGE_DATA_URL = "https://raw.githubusercontent.com/Zarak199076/a/refs/heads/main/badges.json";
  private FALLBACK_BADGE_URL = "https://badges.vencord.dev/badges.json";
  private REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  private observer: MutationObserver | null = null;
  private intervalId: number | null = null;
  private abortController: AbortController | null = null;

  constructor() {}

  async onLoad() {}

  async onStart() {
    console.log("[CustomBadges] Plugin started.");
    await this.loadBadgeData();
    this.startProfileObserver();
    this.intervalId = window.setInterval(() => void this.loadBadgeData(), this.REFRESH_INTERVAL_MS);
  }

  onStop() {
    console.log("[CustomBadges] Plugin stopped.");

    if (this.observer) {
      try {
        this.observer.disconnect();
      } catch (e) {
        console.warn("[CustomBadges] observer.disconnect error:", e);
      }
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
    this.injectedProfiles.clear();
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

  private startProfileObserver() {
    if (this.observer) return;

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const el = node as Element;

          // Look for badge containers that were just added
          let containers: Element[] = Array.from(el.querySelectorAll?.(BADGE_CONTAINER_SELECTOR) || []);
          if (el.matches?.(BADGE_CONTAINER_SELECTOR)) {
            containers = [el, ...containers];
          }

          containers.forEach((container) => {
            this.tryInjectBadges(container);
          });
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

  private tryInjectBadges(container: Element) {
    try {
      // Try to extract user ID from nearby elements or data attributes
      const userId = this.extractUserIdFromContainer(container);
      if (!userId) return;

      // Skip if already injected for this profile instance
      const containerKey = `${userId}-${container.innerHTML.length}`;
      if (this.injectedProfiles.has(containerKey)) return;

      const badges = this.badgeData.get(userId);
      if (!badges || badges.length === 0) return;

      this.injectedProfiles.add(containerKey);
      console.log("[CustomBadges] Attempting to inject badges for user", userId);

      // Try to find or create badge elements
      this.injectBadgeElements(container, badges, userId);
    } catch (e) {
      console.error("[CustomBadges] tryInjectBadges error:", e);
    }
  }

  private extractUserIdFromContainer(container: Element): string | null {
    try {
      // Try to find userId in data attributes
      let el: Element | null = container;
      while (el && el !== document.body) {
        const userId = 
          el.getAttribute?.("data-user-id") ||
          el.getAttribute?.("userid") ||
          (el as any).dataset?.userId ||
          null;
        if (userId) return userId;
        el = el.parentElement;
      }

      // Try to extract from text content or nearby elements
      const userLink = container.querySelector?.('a[href*="/users/"]');
      if (userLink) {
        const match = userLink.href.match(/\/users\/(\d+)/);
        if (match) return match[1];
      }

      return null;
    } catch (e) {
      console.debug("[CustomBadges] extractUserIdFromContainer error:", e);
      return null;
    }
  }

  private injectBadgeElements(container: Element, badges: Badge[], userId: string) {
    try {
      // Create a container for custom badges
      const customBadgeContainer = document.createElement("div");
      customBadgeContainer.className = "veil-custom-badges";
      customBadgeContainer.style.display = "flex";
      customBadgeContainer.style.gap = "4px";
      customBadgeContainer.style.alignItems = "center";

      for (const badge of badges) {
        const badgeImg = document.createElement("img");
        badgeImg.src = badge.icon;
        badgeImg.alt = badge.description || badge.id;
        badgeImg.title = badge.description || badge.id;
        badgeImg.style.width = "20px";
        badgeImg.style.height = "20px";
        badgeImg.style.objectFit = "contain";
        badgeImg.style.cursor = badge.link && badge.link !== "#" ? "pointer" : "default";

        if (badge.link && badge.link !== "#") {
          badgeImg.addEventListener("click", () => window.open(badge.link, "_blank"));
        }

        customBadgeContainer.appendChild(badgeImg);
      }

      // Try to append to existing badge container or after the username
      const existingBadges = container.querySelector('[class*="badges"]');
      if (existingBadges && existingBadges.parentElement) {
        existingBadges.parentElement.insertBefore(customBadgeContainer, existingBadges.nextSibling);
      } else {
        container.appendChild(customBadgeContainer);
      }

      console.debug("[CustomBadges] Injected badge elements for", userId, "->", badges.map((x) => x.id));
    } catch (e) {
      console.error("[CustomBadges] injectBadgeElements error:", e);
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
