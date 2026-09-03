export * from "./renderer.js";

/**
 * Netslum Pages Architecture
 *
 * Each route/view is organized as a self-contained page entrypoint with an `index.tsx`:
 * - DefaultHomePage (`pages/home/index.tsx`): Server-owned gateway and portal
 * - PersonalHomePage (`pages/personal/index.tsx`): User-owned personal landing and dashboard
 * - TownPage (`pages/town/index.tsx`): Town square and public broadcast board
 * - StudioPage (`pages/studio/index.tsx`): Live site authoring workspace
 * - TimelinePage (`pages/timeline/index.tsx`): Followed timeline dispatches
 * - ProfilePage (`pages/profile/index.tsx`): Actor profiles, author feeds, graph actions
 * - MessagesPage (`pages/messages/index.tsx`): Direct messages, encrypted agent chats
 * - NotificationsPage (`pages/notifications/index.tsx`): Notifications & mentions
 * - SettingsPage (`pages/settings/index.tsx`): Home preferences, agent toggle, privacy
 * - SearchPage (`pages/search/index.tsx`): Search dispatches, actors, and feeds
 * - ThreadPage (`pages/thread/index.tsx`): Reply tree and discussions
 * - ZonePage (`pages/zone/index.tsx`): 2D interactive zone sector
 * - DistrictPage (`pages/district/index.tsx`): WebGPU/tools tenant district
 * - NotFoundPage (`pages/notfound/index.tsx`): 404 handler
 */

export * from "./home/index.js";
export * from "./personal/index.js";
export * from "./town/index.js";
export * from "./studio/index.js";
export * from "./timeline/index.js";
export * from "./profile/index.js";
export * from "./messages/index.js";
export * from "./notifications/index.js";
export * from "./settings/index.js";
export * from "./search/index.js";
export * from "./thread/index.js";
export * from "./zone/index.js";
export * from "./district/index.js";
export * from "./notfound/index.js";
