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

          // Log all significant additions to understand DOM structure
          if (el.className && typeof el.className === "string") {
            if (el.className.includes("user") || el.className.includes("profile") || el.className.includes("badge")) {
              console.debug("[CustomBadges] Added node with class:", el.className);
            }
          }

          // Search more broadly for elements that might contain profile info
          this.scanForProfiles(el);
        });
      }
    });

    try {
      this.observer.observe(document.documentElement, { childList: true, subtree: true });
      console.log("[CustomBadges] Profile observer started");
    } catch (e) {
      console.warn("[CustomBadges] observer.observe failed:", e);
      this.observer = null;
    }
  }

  private scanForProfiles(el: Element) {
    try {
      // Look for profile header or user card elements
      const profileElements = el.querySelectorAll?.('[class*="userProfile"], [class*="userCard"], [data-test-id*="user"]') || [];
      
      if (profileElements.length > 0) {
        console.debug("[CustomBadges] Found", profileElements.length, "profile elements");
      }

      profileElements.forEach((profile) => {
        this.tryInjectBadges(profile);
      });

      // Also check if the element itself is a profile
      if (el.className && (String(el.className).includes("userProfile") || String(el.className).includes("userCard"))) {
        console.debug("[CustomBadges] Found profile element:", el.className);
        this.tryInjectBadges(el);
      }
    } catch (e) {
      console.debug("[CustomBadges] scanForProfiles error:", e);
    }
  }

  private tryInjectBadges(container: Element) {
    try {
      // Try to extract user ID from nearby elements or data attributes
      const userId = this.extractUserIdFromContainer(container);
      if (!userId) {
        console.debug("[CustomBadges] Could not extract userId from container");
        return;
      }

      // Skip if already injected for this profile instance
      const containerKey = `${userId}-${container.innerHTML.substring(0, 100)}`;
      if (this.injectedProfiles.has(containerKey)) {
        return;
      }

      const badges = this.badgeData.get(userId);
      if (!badges || badges.length === 0) {
        console.debug("[CustomBadges] No badges for user", userId);
        return;
      }

      this.injectedProfiles.add(containerKey);
      console.log("[CustomBadges] Injecting badges for user", userId);

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
      let depth = 0;
      while (el && el !== document.body && depth < 10) {
        const userId = 
          el.getAttribute?.("data-user-id") ||
          el.getAttribute?.("userid") ||
          el.getAttribute?.("data-userid") ||
          (el as any).dataset?.userId ||
          null;
        if (userId) {
          console.debug("[CustomBadges] Found userId via attribute:", userId);
          return userId;
        }
        el = el.parentElement;
        depth++;
      }

      // Try to extract from text content or nearby elements
      const userLink = container.querySelector?.('a[href*="/users/"]');
      if (userLink) {
        const match = userLink.href.match(/\/users\/(\d+)/);
        if (match) {
          console.debug("[CustomBadges] Found userId via link:", match[1]);
          return match[1];
        }
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
      customBadgeContainer.style.gap = "6px";
      customBadgeContainer.style.alignItems = "center";
      customBadgeContainer.style.marginLeft = "8px";

      for (const badge of badges) {
        const badgeImg = document.createElement("img");
        badgeImg.src = badge.icon;
        badgeImg.alt = badge.description || badge.id;
        badgeImg.title = badge.description || badge.id;
        badgeImg.style.width = "24px";
        badgeImg.style.height = "24px";
        badgeImg.style.objectFit = "contain";
        badgeImg.style.cursor = badge.link && badge.link !== "#" ? "pointer" : "default";

        if (badge.link && badge.link !== "#") {
          badgeImg.addEventListener("click", () => window.open(badge.link, "_blank"));
        }

        customBadgeContainer.appendChild(badgeImg);
      }

      // Try to find a good insertion point
      let inserted = false;

      // Look for existing badge container
      const existingBadgeContainer = container.querySelector('[class*="badge"]');
      if (existingBadgeContainer?.parentElement) {
        existingBadgeContainer.parentElement.insertBefore(customBadgeContainer, existingBadgeContainer.nextSibling);
        console.debug("[CustomBadges] Inserted after existing badges");
        inserted = true;
      }

      // Look for username element
      if (!inserted) {
        const usernameEl = container.querySelector('[class*="username"], [class*="name"]');
        if (usernameEl?.parentElement) {
          usernameEl.parentElement.appendChild(customBadgeContainer);
          console.debug("[CustomBadges] Inserted after username");
          inserted = true;
        }
      }

      // Fall back to appending to container
      if (!inserted) {
        container.appendChild(customBadgeContainer);
        console.debug("[CustomBadges] Appended to container");
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
