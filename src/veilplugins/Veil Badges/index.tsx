import { VeilDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const { Webpack } = window.Vencord;

export default definePlugin({
    name: "Veil Badges",
    description: "Custom Badges Added Via Veil. Join -> https://discord.gg/Y33UjmdsER",
    tags: ["Fun", "Veil"],
    authors: [VeilDevs.Zarak]
    
}
export default class CustomBadges {
  badgeData = {};
  BADGE_DATA_URL = 'https://raw.githubusercontent.com/Zarak199076/a/refs/heads/main/badges.json';
  REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  BADGE_IMG_SELECTOR = 'img[src*="/badge-icons/"]';
  observer = null;
  intervalId = null;

  constructor() {}

  async onLoad() {
    // Nothing needed here
  }

  async onStart() {
    console.log('[CustomBadges] Plugin started.');
    this.startImageFixerObserver();

    await this.loadBadgeData();

    const registered = this.patchProfileStore();
    console.log('[CustomBadges] Patch listener registered:', registered);

    this.intervalId = setInterval(() => this.loadBadgeData(), this.REFRESH_INTERVAL_MS);
  }

  onStop() {
    console.log('[CustomBadges] Plugin stopped.');
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async loadBadgeData() {
    try {
      const res = await fetch(this.BADGE_DATA_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      this.badgeData = await res.json();
      console.log('[CustomBadges] Loaded badge data for', Object.keys(this.badgeData).length, 'users');
    } catch (e) {
      console.error('[CustomBadges] Failed to load badge data:', e);
    }
  }

  tryFixImage(img) {
    try {
      const src = img.getAttribute('src') || '';
      if (
        src.includes('/badge-icons/https://') ||
        src.includes('/badge-icons/http://') ||
        src.includes('/badge-icons/data:')
      ) {
        const m =
          src.match(/\/badge-icons\/(.+?)(?:\.(?:png|webp|jpg|jpeg|gif|svg))(?:\?|$)/i) ||
          src.match(/\/badge-icons\/(.+)$/i);
        if (!m) return;

        let raw = m[1];
        try {
          raw = decodeURIComponent(raw);
        } catch {}
        raw = raw.replace(/%2F/gi, '/');

        if (/^(https?:|data:)/.test(raw)) {
          img.referrerPolicy = 'no-referrer';
          img.loading = 'eager';
          img.decoding = 'async';
          img.src = raw;
        }
      }
    } catch {}
  }

  startImageFixerObserver() {
    // Fix existing images
    document.querySelectorAll(this.BADGE_IMG_SELECTOR).forEach((img) => this.tryFixImage(img));

    this.observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        mut.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.matches?.(this.BADGE_IMG_SELECTOR)) this.tryFixImage(node);
          node.querySelectorAll?.(this.BADGE_IMG_SELECTOR).forEach((img) => this.tryFixImage(img));
        });
      }
    });

    this.observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  applyPatch(store) {
    if (store.__customBadgesPatched) return;

    const orig = store.getUserProfile;
    store.getUserProfile = (...args) => {
      const profile = orig.apply(store, args);

      const userId = args[0];
      const badges = this.badgeData[userId];
      if (!profile || !badges || badges.length === 0) return profile;

      profile.badges = Array.isArray(profile.badges) ? profile.badges : [];

      badges.forEach((b, index) => {
        if (!profile.badges.some((x) => x.id === b.id)) {
          profile.badges.splice(index, 0, {
            id: b.id,
            description: b.description,
            icon: b.icon,
            link: b.link || '#',
          });
        }
      });

      return profile;
    };

    store.__customBadgesPatched = true;
    console.log('[CustomBadges] Patch applied successfully.');
  }

  patchProfileStore() {
    try {
      const filter = (m) => m && typeof m.getUserProfile === 'function' && typeof m.getGuildMemberProfile === 'function';

      Webpack.waitFor(filter, (store) => {
        try {
          this.applyPatch(store);
        } catch (e) {
          console.error('[CustomBadges] Failed to apply patch once store was found:', e);
        }
      });

      return true; // patch request registered; actual patch may land async
    } catch (e) {
      console.error('[CustomBadges] patchProfileStore threw:', e);
      return false;
    }
  }
}
