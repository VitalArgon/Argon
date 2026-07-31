import definePlugin, { OptionType } from "@utils/types";
import { VeilDevs } from "@utils/constants";

/**
 * Veil Badges plugin — scans for profiles periodically and injects badges
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
  private scanIntervalId: number | null = null;
  private abortController: AbortController | null = null;

  constructor() {}

  async onLoad() {}

  async onStart() {
    console.log("[CustomBadges] Plugin started.");
    await this.loadBadgeData();
    
    // Scan for profiles every 500ms
    this.scanIntervalId = window.setInterval(() => this.scanAllProfiles(), 500) as unknown as number;
    
    // Reload badge data every 5 minutes
    window.setInterval(() => void this.loadBadgeData(), this.REFRESH_INTERVAL_MS);
  }

  onStop() {
    console.log("[CustomBadges] Plugin stopped.");

    if (this.scanIntervalId !== null) {
      clearInterval(this.scanIntervalId);
      this.scanIntervalId = null;
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

  private scanAllProfiles() {
    try {
      // Look for all possible profile containers
      const selectors = [
        '[class*="userProfile"]',
        '[class*="userCard"]',
        '[class*="profileBadges"]',
        '[data-test-id*="user-profile"]',
        '[data-test-id*="user-card"]',
        '.header-2Y0yW9',  // Discord user profile header
        '[class*="Popout"]', // For user popouts
      ];

      for (const selector of selectors) {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach((el) => this.tryInjectBadges(el));
        } catch (e) {
          // Ignore invalid selectors
        }
      }
    } catch (e) {
      console.debug("[CustomBadges] scanAllProfiles error:", e);
    }
  }

  private tryInjectBadges(container: Element) {
    try {
      // Try to extract user ID from nearby elements or data attributes
      const userId = this.extractUserIdFromContainer(container);
      if (!userId) {
        return;
      }

      // Create a unique key for this profile render
      const innerText = container.textContent?.substring(0, 100) || "";
      const containerKey = `${userId}-${innerText}`;
      
      if (this.injectedProfiles.has(containerKey)) {
        return;
      }

      const badges = this.badgeData.get(userId);
      if (!badges || badges.length === 0) {
        return;
      }

      this.injectedProfiles.add(containerKey);
      console.log("[CustomBadges] Injecting badges for user", userId);

      // Try to find or create badge elements
      this.injectBadgeElements(container, badges, userId);
    } catch (e) {
      console.debug("[CustomBadges] tryInjectBadges error:", e);
    }
  }

  private extractUserIdFromContainer(container: Element): string | null {
    try {
      // Try to find userId in data attributes by searching up the tree
      let el: Element | null = container;
      let depth = 0;
      while (el && el !== document.body && depth < 15) {
        const userId = 
          el.getAttribute?.("data-user-id") ||
          el.getAttribute?.("userid") ||
          el.getAttribute?.("data-userid") ||
          (el as any).dataset?.userId ||
          null;
        if (userId) {
          return userId;
        }
        el = el.parentElement;
        depth++;
      }

      // Try to extract from links
      const userLink = container.querySelector?.('a[href*="/users/"]');
      if (userLink) {
        const match = userLink.href.match(/\/users\/(\d+)/);
        if (match) {
          return match[1];
        }
      }

      // Try to find in the entire page if container has profile-like content
      if (container.textContent && (container.textContent.includes("@") || container.textContent.length > 100)) {
        // Look for user ID in any data attributes on the container or its children
        const allElements = container.querySelectorAll?.("[data-user-id]") || [];
        if (allElements.length > 0) {
          const userId = (allElements[0] as any).getAttribute?.("data-user-id");
          if (userId) return userId;
        }
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  private injectBadgeElements(container: Element, badges: Badge[], userId: string) {
    try {
      // Check if badges already exist in this container
      if (container.querySelector(".veil-custom-badges")) {
        return;
      }

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

      // Try to find a good insertion point - look for existing badges or username area
      let inserted = false;

      // Look for existing badge container
      const existingBadgeContainer = container.querySelector('[class*="badge"]');
      if (existingBadgeContainer?.parentElement) {
        existingBadgeContainer.parentElement.insertBefore(customBadgeContainer, existingBadgeContainer.nextSibling);
        inserted = true;
      }

      // Look for username or name element
      if (!inserted) {
        const nameElements = container.querySelectorAll?.('[class*="username"], [class*="name"], [class*="nick"]') || [];
        if (nameElements.length > 0) {
          const nameEl = nameElements[0];
          if (nameEl?.parentElement) {
            nameEl.parentElement.appendChild(customBadgeContainer);
            inserted = true;
          }
        }
      }

      // Try to append to first direct child container
      if (!inserted) {
        const firstChild = container.firstElementChild;
        if (firstChild) {
          firstChild.appendChild(customBadgeContainer);
          inserted = true;
        }
      }

      // Fall back to appending to container
      if (!inserted) {
        container.appendChild(customBadgeContainer);
      }

      console.debug("[CustomBadges] Injected badges for user", userId, "->", badges.map((x) => x.id));
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
