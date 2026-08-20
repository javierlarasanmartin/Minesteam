MineSteam 2.4.0 - Offline login fix

Fix:
- Added missing Electron IPC handler: login-offline.
- Added logout-offline handler.
- Offline login validates Minecraft-style names (3-16 chars, A-Z/a-z/0-9/_).
- Stores only local offline profile data; no Microsoft OAuth/token flow is used.
- Generates a stable OfflinePlayer UUID from the username.
- Launcher reuses the stored offline UUID instead of generating a new UUID every launch.
- preload exposes loginOffline/logoutOffline.
- Renderer logout calls the IPC logout handler.

Note: Minecraft itself may still attempt service checks from its authlib. This launcher does not authenticate with Microsoft and supplies an offline profile/token. Servers requiring authenticated accounts will not accept offline identities.
