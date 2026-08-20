# MineSteam 2.4.0

Launcher de Minecraft centrado en una experiencia sencilla para usuarios nuevos, con una interfaz **Steampunk + Minecraft Vanilla** y herramientas avanzadas para gestionar instancias.

## Características

- Fabric, Forge y NeoForge.
- Java automático y Java por instancia.
- RAM por instancia hasta 32 GB.
- Backups y restauración.
- Reparación normal y avanzada.
- Assets e idiomas vanilla.
- Crash reports y diagnóstico.
- Logs por instancia.
- Perfiles y servidores.
- Modrinth para mods y modpacks.
- Gestión de mundos, resource packs y shaders.
- Configuración JVM por instancia.
- Interfaz simplificada y responsive.

## Requisitos

- Node.js compatible con Electron del proyecto.
- npm.
- Java según la versión de Minecraft que se vaya a ejecutar.

## Instalación para desarrollo

```bash
npm install
npm start
```

## Crear instalador Windows

```bash
npm run build:win
```

También están disponibles los scripts de build para Linux y macOS definidos en `package.json`.

## Pruebas

```bash
npm run test:architecture
```

## Estructura

```text
MineSteam-2.4.0/
├── assets/
├── scripts/
├── src/
│   ├── core/
│   ├── diagnostics/
│   ├── launcher/
│   ├── loaders/
│   ├── managers/
│   ├── minecraft/
│   ├── modpacks/
│   ├── mods/
│   └── utils/
├── index.html
├── main.js
├── preload.js
├── renderer.js
├── styles.css
├── package.json
├── package-lock.json
├── CHANGELOG.md
└── README.md
```

## GitHub

Repositorio oficial:
https://github.com/javierlarasanmartin/Minesteam

## Licencia

MIT
